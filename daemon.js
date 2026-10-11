// BrytMa Shell daemon. Started by main.js with ELECTRON_RUN_AS_NODE=1:
//   daemon.js <profileDir> <pipeName>
// Owns the terminals, so they keep running when the window is closed.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { PtyManager } = require('./ptycore');

const dir = process.argv[2];
const pipe = process.argv[3];
const token = fs.readFileSync(path.join(dir, 'token'), 'utf8').trim();
const subs = {}; // tabId -> Set of sockets
const clients = new Set(); // connected windows

const send = (c, m) => { try { c.write(JSON.stringify(m) + '\n'); } catch {} };
const mgr = new PtyManager(
  path.join(dir, 'logs'),
  (id, d) => (subs[id] || []).forEach((c) => send(c, { t: 'data', id, d })),
  (id) => (subs[id] || []).forEach((c) => send(c, { t: 'exit', id })),
  {
    // state changes go to every connected window, so tab dots stay right for tabs not yet opened
    onState: (id, st) => clients.forEach((c) => send(c, { t: 'state', id, st })),
    recipesFile: path.join(path.dirname(dir), 'recipes.json')   // shared by the normal and admin workspaces
  }
);

function handle(sock, m) {
  if (!sock.authed) {
    if (m.t === 'hello' && m.token === token) { sock.authed = true; send(sock, { t: 'ready', ver: require('./package.json').version }); }
    else sock.destroy();
    return;
  }
  switch (m.t) {
    case 'attach': {
      (subs[m.id] = subs[m.id] || new Set()).add(sock);
      const log = mgr.readLog(m.id);       // read, subscribe and spawn in one tick:
      mgr.ensure(m.id, m);                 // no output is lost or duplicated
      send(sock, { t: 'log', rid: m.rid, log });
      break;
    }
    case 'ensure': mgr.ensure(m.id, m); break;
    case 'status': send(sock, { t: 'states', map: mgr.getStates() }); break;
    case 'write': mgr.write(m.id, m.d); break;
    case 'resize': mgr.resize(m.id, m.cols, m.rows); break;
    case 'clearLog': mgr.clearLog(m.id); break;
    case 'delete': mgr.kill(m.id); mgr.deleteLog(m.id); delete subs[m.id]; break;
    case 'shutdown': mgr.killAll(); server.close(); setTimeout(() => process.exit(0), 100); break;
  }
}

const server = net.createServer((sock) => {
  let buf = '';
  clients.add(sock);
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      handle(sock, m);
    }
  });
  sock.on('close', () => { clients.delete(sock); Object.values(subs).forEach((s) => s.delete(sock)); });
  sock.on('error', () => {});
});
server.on('error', () => process.exit(0)); // another daemon already owns the pipe
server.listen(pipe);
process.on('uncaughtException', () => {});

// Idle guard: with no window open and no shell running for 5 minutes, the daemon quits.
// It is started again automatically the next time you open Bryt Shell.
let idleSince = Date.now();
setInterval(() => {
  if (clients.size || mgr.count()) { idleSince = Date.now(); return; }
  if (Date.now() - idleSince > 5 * 60 * 1000) { mgr.flush(); server.close(); process.exit(0); }
}, 30000);
