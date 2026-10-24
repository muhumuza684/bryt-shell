// BrytMa Shell daemon. Started by main.js with ELECTRON_RUN_AS_NODE=1:
//   daemon.js <profileDir> <pipeName>
// Owns the terminals, so they keep running when the window is closed.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { PtyManager } = require('./ptycore');

// Everything the service does that matters goes to stderr, which main.js saves as daemon.log. If the service ever
// stops, the last lines of that file say why.
const logLine = (m) => { try { process.stderr.write('[' + new Date().toISOString() + '] service ' + process.pid + ': ' + m + '\n'); } catch {} };

const dir = process.argv[2];
const pipe = process.argv[3];
logLine('started, version ' + require('./package.json').version + ', node ' + process.versions.node + (process.versions.electron ? ', electron ' + process.versions.electron : ''));
const pidFile = path.join(dir, 'daemon.pid');
try { fs.writeFileSync(pidFile, String(process.pid)); } catch {}
process.on('exit', (code) => { logLine('exiting with code ' + code); try { if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch {} });
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
      mgr.resize(m.id, m.cols, m.rows);    // a tab started by an AI app learns this window's real size
      send(sock, { t: 'log', rid: m.rid, log });
      break;
    }
    case 'ensure': mgr.ensure(m.id, m); break;
    case 'status': send(sock, { t: 'states', map: mgr.getStates() }); break;
    case 'write': mgr.write(m.id, m.d); break;
    case 'resize': mgr.resize(m.id, m.cols, m.rows); break;
    case 'clearLog': mgr.clearLog(m.id); break;
    case 'delete': mgr.kill(m.id); mgr.deleteLog(m.id); delete subs[m.id]; break;
    case 'shutdown': logLine('shutdown requested by a window'); mgr.killAll(); server.close(); setTimeout(() => process.exit(0), 100); break;
  }
}

const server = net.createServer((sock) => {
  let buf = '';
  clients.add(sock);
  logLine('window connected (' + clients.size + ' connected)');
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      handle(sock, m);
    }
  });
  sock.on('close', () => { clients.delete(sock); Object.values(subs).forEach((s) => s.delete(sock)); logLine('window disconnected (' + clients.size + ' connected)'); });
  sock.on('error', () => {});
});
// Only a failure to START listening means "another service already owns the pipe". An error later on (a client that
// connects and vanishes, a busy pipe) must NEVER take the service down: it owns every shell you have running.
let listening = false;
server.on('listening', () => { listening = true; logLine('listening'); });
server.on('error', (e) => {
  if (!listening) { logLine('could not start listening (' + (e && e.code) + '): another service probably owns the pipe, so this one exits'); process.exit(0); }
  logLine('pipe error (ignored, the service keeps running): ' + ((e && e.stack) || e));
});
server.listen(pipe);
process.on('uncaughtException', (e) => logLine('unexpected error (ignored, the service keeps running): ' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => logLine('unexpected rejection (ignored, the service keeps running): ' + ((e && e.stack) || e)));
// A stray console or hang-up event must not end the service either; only a real "terminate" does.
['SIGHUP', 'SIGINT', 'SIGBREAK'].forEach((sg) => { try { process.on(sg, () => logLine('received ' + sg + ' (ignored)')); } catch {} });
try { process.on('SIGTERM', () => { logLine('received SIGTERM, shutting down'); try { mgr.killAll(); } catch {} process.exit(0); }); } catch {}

// Idle guard: with no window open and no shell running for 5 minutes, the daemon quits.
// It is started again automatically the next time you open Bryt Shell.
let idleSince = Date.now();
setInterval(() => {
  if (clients.size || mgr.count()) { idleSince = Date.now(); return; }
  if (Date.now() - idleSince > 5 * 60 * 1000) { logLine('idle for 5 minutes with no window and no running program: exiting'); mgr.flush(); server.close(); process.exit(0); }
}, 30000);
