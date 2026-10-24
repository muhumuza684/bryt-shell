// Bryt Shell relay: passes encrypted "live watch" messages between the person sharing and the people watching.
// It CANNOT read anything: the messages are encrypted on the sharing PC with a key that only exists in the share code.
// It keeps nothing on disk, logs no message contents, and forgets a room as soon as the sharer is gone.
//
// Run it anywhere Node 18+ runs:   cd relay && npm install && node relay.js     (PORT=8787 by default)
// Put it behind HTTPS/WSS (any host, or a free tunnel such as `cloudflared tunnel --url http://localhost:8787`).
const http = require('http');
const { WebSocketServer } = require('ws');

const MAX_FRAME = 256 * 1024, MAX_VIEWERS = 8, MAX_ROOMS = 500, GRACE_MS = 60 * 1000, VIEWER_MSGS_PER_SEC = 5;

function start({ port = +process.env.PORT || 8787, host = process.env.HOST || '0.0.0.0', tap } = {}) {
  const rooms = new Map();                                    // roomId -> { host, viewers:Set, timer }
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Bryt Shell relay is running.\n'); });
  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME });
  const send = (ws, s) => { try { if (ws.readyState === 1) ws.send(s); } catch {} };
  const ctl = (ws, o) => send(ws, JSON.stringify({ relay: o }));
  const tellHost = (r) => { if (r.host) ctl(r.host, { viewers: r.viewers.size }); };

  wss.on('connection', (ws, req) => {
    let u; try { u = new URL(req.url, 'http://x'); } catch { return ws.close(4000, 'bad address'); }
    const room = u.searchParams.get('room') || '', role = u.searchParams.get('role');
    if (!/^[0-9a-f]{32}$/.test(room) || (role !== 'host' && role !== 'viewer')) return ws.close(4000, 'bad address');
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    let r = rooms.get(room);

    if (role === 'host') {
      if (!r && rooms.size >= MAX_ROOMS) return ws.close(4003, 'relay is full');
      if (r && r.host) return ws.close(4001, 'this code is already being shared');
      if (!r) { r = { host: null, viewers: new Set(), timer: null }; rooms.set(room, r); }
      clearTimeout(r.timer); r.timer = null; r.host = ws;
      r.viewers.forEach((v) => ctl(v, { host: 'back' }));
      tellHost(r);
      ws.on('message', (data) => { const s = data.toString(); if (tap) tap('host', s); r.viewers.forEach((v) => send(v, s)); });
      ws.on('close', () => {
        if (r.host === ws) r.host = null;
        r.viewers.forEach((v) => ctl(v, { host: 'left' }));
        clearTimeout(r.timer);
        r.timer = setTimeout(() => { r.viewers.forEach((v) => { try { v.close(4002, 'the sharing has ended'); } catch {} }); rooms.delete(room); }, GRACE_MS);   // a short grace period covers a flaky connection
      });
    } else {
      if (!r || !r.host) return ws.close(4004, 'nobody is sharing with this code');
      if (r.viewers.size >= MAX_VIEWERS) return ws.close(4005, 'too many people are watching');
      r.viewers.add(ws); tellHost(r);
      let count = 0, sec = 0;
      ws.on('message', (data) => {
        const now = Math.floor(Date.now() / 1000); if (now !== sec) { sec = now; count = 0; }
        if (++count > VIEWER_MSGS_PER_SEC || data.length > 2048) return;       // viewers may only send tiny "send me a refresh" notes
        const s = data.toString(); if (tap) tap('viewer', s); if (r.host) send(r.host, s);
      });
      ws.on('close', () => { r.viewers.delete(ws); tellHost(r); });
    }
    ws.on('error', () => {});
  });

  const beat = setInterval(() => wss.clients.forEach((c) => { if (!c.isAlive) return c.terminate(); c.isAlive = false; try { c.ping(); } catch {} }), 25000);
  wss.on('close', () => clearInterval(beat));
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    port: server.address().port, rooms,
    close: () => new Promise((done) => { clearInterval(beat); wss.clients.forEach((c) => c.terminate()); rooms.forEach((r) => clearTimeout(r.timer)); wss.close(); server.close(() => done()); })
  })));
}
module.exports = { start };
if (require.main === module) start().then((s) => console.log('Bryt Shell relay listening on port ' + s.port));
