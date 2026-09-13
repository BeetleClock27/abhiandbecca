// Asks for the password, then serves the desk.
// Nothing is public: every request comes through here.
//
// Two doors, both serving the same desk from the same api/app.html:
//
//   /            full desk        password below
//   /arrivals    volunteer desk   VOLUNTEER_PASSWORD (or the full one)
//
// The volunteer door only ever shows the arrivals list — no editing, no phone
// numbers, no other tabs. The path decides that, not the password, so a link
// can be handed out without worrying which password someone types.

const fs = require('fs');
const path = require('path');

const PASSWORD = 'abhibecca21';
const VOLUNTEER_PASSWORD = '1234';

// Where the shared data lives. Paste the PRODUCTION Deployment URL from the
// Convex dashboard (Settings → URL & Deploy Key), e.g.
//   https://good-salamander-993.convex.cloud
// Vercel env vars win if you'd rather set it there.
const CONVEX_URL =
  process.env.CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.VITE_CONVEX_URL ||
  'https://good-salamander-993.convex.cloud';

const CONVEX_OK = /^https:\/\/[A-Za-z0-9-]+\.convex\.(cloud|site)$/.test((CONVEX_URL || '').trim());

// The shared Google sheet the guest list is kept in. The desk asks this
// function for it (never Google directly) so there is no CORS to negotiate and
// no key in the page. The sheet must be shared: Share -> General access ->
// Anyone with the link -> Viewer. Nothing is written back to it.
const SHEET_ID =
  process.env.SHEET_ID || '1eLrBCxfGjcFMWGkuikaXI5tuIzO6BWIpBDo2aGxfIT4';
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';

function serveSheet(res) {
  const send = obj => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  if (typeof fetch !== 'function') {
    send({ ok: false, error: 'This deployment runs an old Node version with no fetch. Set the Vercel project to Node 18 or newer.' });
    return;
  }
  fetch(SHEET_CSV, { redirect: 'follow' })
    .then(r => r.text().then(body => ({ ok: r.ok, status: r.status, body })))
    .then(r => {
      if (!r.ok) { send({ ok: false, error: 'Google answered ' + r.status + ' for that sheet.' }); return; }
      // A private sheet answers with a sign-in page, not CSV.
      if (/^\s*</.test(r.body)) {
        send({ ok: false, error: 'The sheet is not shared for reading. In Google Sheets: Share \u2192 General access \u2192 Anyone with the link \u2192 Viewer.' });
        return;
      }
      send({ ok: true, csv: r.body, at: Date.now() });
    })
    .catch(e => send({ ok: false, error: 'Could not reach Google: ' + ((e && e.message) || 'unknown error') }));
}

module.exports = (req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { pathname = '/'; }
  const volunteer = /^\/arrivals\/?$/i.test(pathname);

  const header = req.headers.authorization || '';
  const sp = header.indexOf(' ');
  const scheme = sp === -1 ? '' : header.slice(0, sp);
  const encoded = sp === -1 ? '' : header.slice(sp + 1);

  let ok = false;
  let full = false;
  if (scheme === 'Basic' && encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const given = decoded.slice(decoded.indexOf(':') + 1);
      full = given === PASSWORD;
      ok = full || (volunteer && given === VOLUNTEER_PASSWORD);
    } catch (e) { ok = false; }
  }

  if (!ok) {
    // Separate realms, so a volunteer's saved password never unlocks the full
    // desk and vice versa.
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="' +
      (volunteer ? 'Arrivals desk' : 'Abhishek and Rebecca - boarding pass desk') + '"');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Password required.');
    return;
  }

  // The guest sheet carries phone numbers, so only the full password reads it.
  if (/^\/sheet\/?$/i.test(pathname)) {
    if (!full) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'The guest sheet is only readable from the full desk.' }));
      return;
    }
    serveSheet(res);
    return;
  }

  const tries = [
    path.join(__dirname, 'app.html'),
    path.join(process.cwd(), 'api', 'app.html')
  ];
  for (const file of tries) {
    try {
      let html = fs.readFileSync(file, 'utf8');
      const flags = [];
      // The desk reads these on load.
      if (CONVEX_OK) flags.push('window.__CONVEX_URL=' + JSON.stringify(CONVEX_URL.trim()) + ';');
      if (volunteer) flags.push('window.__VOLUNTEER=true;');
      if (flags.length) html = html.replace('<head>', '<head><script>' + flags.join('') + '</script>');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.end(html);
      return;
    } catch (e) { /* try the next path */ }
  }

  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('app.html was not found next to this function.');
};
