const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PtyManager, ensureRecipes, findShell } = require('./ptycore');
const { startAiApi, ACCESS_DEFAULT, ACCESS_PRESETS } = require('./aiapi');
const { detectClients, connectFile, isConnected, heal } = require('./aiclients');
const { createAsker } = require('./aiask');
const pack = require('./aipack');
const inbox = require('./aiinbox');
const live = require('./aiLive');

process.on('uncaughtException', (e) => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} ${e.stack || e}\n`); } catch {}
  try { dialog.showErrorBox('Bryt Shell error', String(e.stack || e)); } catch {}
});

let win, backend, notice = '';
let backendReady = Promise.resolve();   // the window opens at once; anything that needs the terminals waits for this
let closing = false; // true once we have decided what to do with the programs
const states = {};   // tabId -> latest command state (idle/running/ok/fail/stopped), from either backend
const recipesFile = () => path.join(root(), 'recipes.json');
let tabs = [];

// Are we elevated? No child process on the normal path: it used to run `net session` here, before anything else.
const admin = (() => {
  if (process.argv.includes('--bryt-admin')) return true;
  if (process.platform !== 'win32') return false;     // our own "Run as admin" button starts the elevated copy with this flag
  try { fs.closeSync(fs.openSync('\\\\.\\PHYSICALDRIVE0', 'r')); return true; }   // only an elevated process may open the raw disk
  catch (e) { if (e && (e.code === 'EPERM' || e.code === 'EACCES')) return false; }
  try { execSync('net session', { stdio: 'ignore' }); return true; } catch { return false; }   // rare fallback: the old, slower check
})();
const profile = admin ? 'admin' : 'user'; // admin and normal workspaces are separate
const root = () => app.getPath('userData');
const base = () => { const d = path.join(root(), profile); fs.mkdirSync(d, { recursive: true }); return d; };
const pipeName = () => `\\\\.\\pipe\\brytma-shell-${os.userInfo().username.replace(/\W/g, '_')}-${profile}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- settings (mode) ---------- */
const settingsFile = () => path.join(root(), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { mode: 'daemon' }; } }
function writeSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }

/* ---------- tabs ---------- */
const sessFile = () => path.join(base(), 'sessions.json');
const newTab = (title) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  title, cwd: process.env.USERPROFILE || process.cwd(), startup: '' });
const saveTabs = () => fs.writeFileSync(sessFile(), JSON.stringify(tabs, null, 2));
function loadTabs() {
  try { tabs = JSON.parse(fs.readFileSync(sessFile(), 'utf8')); } catch { tabs = []; }
  if (!tabs.length) tabs.push(newTab('Tab 1'));
  saveTabs();
}
const opts = (id, cols, rows) => { const t = tabs.find((x) => x.id === id) || {}; return { id, cols, rows, cwd: t.cwd, startup: t.startup }; };

/* ---------- Closes mode: terminals live inside this app ---------- */
function localBackend(onData, onExit, onState) {
  const m = new PtyManager(path.join(base(), 'logs'), onData, onExit, { onState, recipesFile: recipesFile() });
  return {
    kind: 'normal',
    attach: async (id, o) => { const log = m.readLog(id); m.ensure(id, o); m.resize(id, o.cols, o.rows); return log; },
    ensure: async (id, o) => { m.ensure(id, o); },
    write: (id, d) => m.write(id, d),
    resize: (id, c, r) => m.resize(id, c, r),
    del: async (id) => { m.kill(id); m.deleteLog(id); },
    clearLog: async (id) => m.clearLog(id),
    flush: () => m.flush(),
    shutdown: async () => m.killAll()
  };
}

/* ---------- Daemon mode: terminals live in a background process ---------- */
function ensureToken() {
  const f = path.join(base(), 'token');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(24).toString('hex'));
  return fs.readFileSync(f, 'utf8').trim();
}
const daemonLog = () => path.join(root(), 'daemon.log');
let daemonWhy = '';
function startDaemon() {
  let out = 'ignore';
  try {   // the background service writes what it prints into daemon.log, so a failure can explain itself
    const f = daemonLog();
    try { if (fs.statSync(f).size > 200 * 1024) fs.writeFileSync(f, ''); } catch {}
    out = fs.openSync(f, 'a');
    fs.writeSync(out, `\n--- ${new Date().toISOString()} starting the background service ${app.getVersion()} ---\n`);
  } catch {}
  const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js'), base(), pipeName()], {
    detached: true, stdio: ['ignore', out, out], windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  child.unref();
  try { if (typeof out === 'number') fs.closeSync(out); } catch {}
  return child;
}
function connectPipe(pipe, token) {
  return new Promise((resolve, reject) => {
    const s = net.connect(pipe); let done = false;
    const fail = (e) => { if (!done) { done = true; s.destroy(); reject(e); } };
    s.setTimeout(3000, () => fail(new Error('timeout')));
    s.once('error', fail);
    s.once('close', () => fail(new Error('closed')));   // e.g. rejected token: fail now, do not wait
    s.once('connect', () => s.write(JSON.stringify({ t: 'hello', token }) + '\n'));
    s.once('data', (d) => {
      if (done) return; done = true; s.setTimeout(0); s.removeListener('error', fail);
      let m = {}; try { m = JSON.parse(String(d).split('\n')[0]); } catch {}
      m.t === 'ready' ? resolve({ sock: s, ver: m.ver || null }) : (s.destroy(), reject(new Error('auth')));
    });
  });
}
// Connect to the background service, starting it if needed. Polls quickly at first, waits up to 30 s (the first launch
// after an install can be slow while Windows scans the new program), and notices at once if the service crashes.
async function connectDaemon(pipe, token) {
  try { return await connectPipe(pipe, token); }       // already running: instant
  catch (e) {
    if (e && e.message === 'timeout') {                  // something owns the pipe but never answers: a stuck service from an earlier session
      appLog('the background service owns the pipe but does not answer (stuck); stopping it');
      stopStuckService(); await sleep(500);
    }
  }
  const child = startDaemon();
  let exited = null, spawnErr = null;
  child.once('exit', (c) => { exited = c == null ? -1 : c; });
  child.once('error', (e) => { spawnErr = e; });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await sleep(Date.now() - t0 < 3000 ? 100 : 250);
    try { return await connectPipe(pipe, token); } catch {}
    if (spawnErr || exited !== null) {
      await sleep(300);                                          // it may have exited only because another copy already owns the pipe
      try { return await connectPipe(pipe, token); } catch {}
      daemonWhy = spawnErr ? spawnErr.message : 'the background service stopped right after it started (code ' + exited + ')';
      return null;
    }
  }
  daemonWhy = 'the background service did not answer within 30 seconds';
  return null;
}
const HB_EVERY = +process.env.BRYT_HEARTBEAT_MS || 10000, HB_DEAD = HB_EVERY * 4.5;   // a live service answers in milliseconds; 45 s of silence means it is stuck
const appLog = (m) => { try { fs.appendFileSync(daemonLog(), '[' + new Date().toISOString() + '] window: ' + m + '\n'); } catch {} };
const lostError = (why) => Object.assign(new Error(why || 'the connection to the background service was lost'), { lost: true });
function remoteBackend(sock, onData, onExit, onLost, onState) {
  let buf = '', rid = 0, dead = false, lastSeen = Date.now(); const waits = {};
  const send = (m) => { if (dead) return false; try { sock.write(JSON.stringify(m) + '\n'); return true; } catch { return false; } };
  const die = (why, hung) => {         // the connection is gone: everything that was waiting for an answer fails at once, instead of waiting forever
    if (dead) return; dead = true; clearInterval(beat);
    Object.keys(waits).forEach((k) => { clearTimeout(waits[k].t); waits[k].rej(lostError()); delete waits[k]; });
    try { sock.destroy(); } catch {}
    appLog('lost the connection to the background service' + (why ? ' (' + why + ')' : '') + '; ' + servicePidNote());
    onLost(!!hung);
  };
  sock.setEncoding('utf8');
  sock.on('data', (c) => {
    lastSeen = Date.now(); buf += c; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'data') onData(m.id, m.d);
      else if (m.t === 'exit') onExit(m.id);
      else if (m.t === 'state') onState(m.id, m.st);
      else if (m.t === 'states') Object.keys(m.map).forEach((k) => onState(k, m.map[k]));
      else if (m.t === 'log' && waits[m.rid]) { clearTimeout(waits[m.rid].t); waits[m.rid].res(m.log); delete waits[m.rid]; }
    }
  });
  sock.on('close', () => die('the connection closed'));
  sock.on('error', () => {});
  const beat = setInterval(() => {
    if (dead) return;
    if (Date.now() - lastSeen > HB_DEAD) { die('no answer for ' + Math.round((Date.now() - lastSeen) / 1000) + ' s', true); return; }
    send({ t: 'status' });
  }, HB_EVERY);
  if (beat.unref) beat.unref();
  send({ t: 'status' });   // learn the state of programs that kept running while the window was closed
  return {
    kind: 'daemon',
    isDead: () => dead,
    attach: (id, o) => new Promise((res, rej) => {
      if (dead) return rej(lostError());
      const r = ++rid;
      const t = setTimeout(() => { delete waits[r]; rej(lostError('the background service did not answer')); die('it did not answer an attach request', true); }, 15000);
      waits[r] = { res, rej, t };
      if (!send({ t: 'attach', rid: r, ...o })) { clearTimeout(t); delete waits[r]; rej(lostError()); }
    }),
    ensure: async (id, o) => { if (!send({ t: 'ensure', ...o })) throw lostError(); },
    write: (id, d) => { send({ t: 'write', id, d }); },
    resize: (id, cols, rows) => { send({ t: 'resize', id, cols, rows }); },
    del: async (id) => { send({ t: 'delete', id }); },
    clearLog: async (id) => { send({ t: 'clearLog', id }); },
    shutdown: async () => { send({ t: 'shutdown' }); await sleep(400); }
  };
}

const toWin = (ch) => (...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };
const onData = (...a) => toWin('data')(...a), onExit = (...a) => toWin('exit')(...a);
const onState = (id, st) => { if (st) states[id] = st; else delete states[id]; toWin('state')(id, st); };
function servicePidNote() {            // is the background service process still alive? (helps explain a drop)
  try {
    const pid = +fs.readFileSync(path.join(base(), 'daemon.pid'), 'utf8').trim();
    if (!pid) return 'no service process id on file';
    try { process.kill(pid, 0); return 'the service process (' + pid + ') is still running'; } catch (e) { return 'the service process (' + pid + ') is gone'; }
  } catch { return 'no service process id on file'; }
}
let reconnecting = null;
// The connection to the background service dropped. Instead of leaving the window stuck, reconnect to the service,
// or start a fresh one; if that is impossible, carry on with the window's own terminals.
function findServicePids() {        // fallback for services without a pid file (older versions): find them by their command line
  try {
    const dir = base();
    if (process.platform === 'win32') {
      const out = execSync('powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*daemon.js*\' -and $_.CommandLine -like \'*' + dir.replace(/'/g, "''") + '*\' } | ForEach-Object { $_.ProcessId }"', { timeout: 8000, windowsHide: true }).toString();
      return out.split(/\s+/).map(Number).filter((p) => p && p !== process.pid);
    }
    return execSync('pgrep -f "daemon.js .*' + dir.replace(/(["$`\\])/g, '\\$1') + '"').toString().split(/\s+/).map(Number).filter((p) => p && p !== process.pid);
  } catch { return []; }
}
function stopStuckService() {   // a service that is alive but silent still owns the pipe: stop it so a fresh one can start
  let killed = 0;
  try {
    const pid = +fs.readFileSync(path.join(base(), 'daemon.pid'), 'utf8').trim();
    if (pid && pid !== process.pid) { process.kill(pid, 'SIGKILL'); killed++; appLog('stopped the stuck background service (' + pid + ')'); }
  } catch {}
  if (!killed) for (const pid of findServicePids()) { try { process.kill(pid, 'SIGKILL'); killed++; appLog('stopped a stuck background service found by its command line (' + pid + ')'); } catch {} }
  if (process.platform !== 'win32') { try { fs.unlinkSync(pipeName()); } catch {} }   // (Windows pipes vanish with their process)
  return killed;
}
function lostConnection(hung) {
  if (closing || reconnecting) return;
  if (hung) stopStuckService();
  toWin('notice')('Lost connection to the background service. Reconnecting\u2026');
  reconnecting = (async () => {
    let conn = null;
    for (let i = 0; i < 2 && !conn && !closing; i++) { conn = await connectDaemon(pipeName(), ensureToken()); if (!conn && !closing) await sleep(800); }
    if (closing) return;
    if (conn) {
      backend = remoteBackend(conn.sock, onData, onExit, lostConnection, onState);
      appLog('reconnected to the background service');
      toWin('restored')(true);
    } else {
      appLog('could not reconnect' + (daemonWhy ? ' (' + daemonWhy + ')' : '') + '; continuing with this window\'s own terminals');
      backend = localBackend(onData, onExit, onState);
      toWin('notice')('The background service is unavailable, so this window now runs its own terminals ("Closes with window" mode). Try again to bring the service back.');
      toWin('restored')(false);
    }
  })().finally(() => { reconnecting = null; });
  backendReady = reconnecting;
}
// Run a request against the backend; if the connection drops meanwhile, wait for the reconnect and run it again.
async function withBackend(fn) {
  for (let i = 0; i < 4; i++) {
    await backendReady;
    try { return await fn(backend); }
    catch (e) { if (e && e.lost && !closing) { if (reconnecting) await reconnecting; else await sleep(300); continue; } throw e; }
  }
  throw lostError('the background service is unavailable');
}

async function initBackend() {
  if (readSettings().mode === 'daemon') {
    try {
      const token = ensureToken(), pipe = pipeName();
      const conn = await connectDaemon(pipe, token);
      if (conn) {
        // A background service that survived an app update still runs the OLD code.
        if (conn.ver !== app.getVersion())
          notice = 'The background service is from an older version' + (conn.ver ? ' (' + conn.ver + ')' : '') + '. Your programs are still running, but Lab lights and faces need the new version. Click "Quit & stop all", then reopen Bryt Shell.';
        backend = remoteBackend(conn.sock, onData, onExit, lostConnection, onState); return;
      }
    } catch (e) { daemonWhy = daemonWhy || String((e && e.message) || e); }
    notice = 'Daemon mode could not start' + (daemonWhy ? ' (' + daemonWhy + ')' : '') + ', so this session is running in "Closes with window" mode. Details: ' + daemonLog();
  }
  backend = localBackend(onData, onExit, onState);
}

app.setAppUserModelId('ug.brytma.shell'); // taskbar grouping + the name shown on notifications
// ---------- only one Bryt Shell at a time ----------
// Several windows would share ONE background service, and closing any of them with "Stop everything" would kill it for the
// others ("Lost connection"). So a second launch just brings the first window to the front and exits. The normal and the
// administrator copy each have their own lock. The Windows-login copy (--daemon-only) has no window and takes no lock.
const uiPipe = () => process.platform === 'win32' ? `\\\\.\\pipe\\brytma-shell-ui-${os.userInfo().username.replace(/\W/g, '_')}-${profile}` : path.join(os.tmpdir(), `brytma-shell-ui-${os.userInfo().username.replace(/\W/g, '_')}-${profile}.sock`);
let uiServer = null, frontWhenReady = false;
function bringToFront() {
  appLog('another launch was started: bringing this window to the front');
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else frontWhenReady = true;
}
function releaseSingleInstance() {   // let go of the lock BEFORE relaunching, so the new copy is not mistaken for a second launch
  try { if (uiServer) uiServer.close(); } catch {}
  uiServer = null;
  if (process.platform !== 'win32') { try { fs.unlinkSync(uiPipe()); } catch {} }
}
function askOwner(pipe) {            // is another Bryt Shell running, and does it answer?  'ok' | 'bye' (it is closing) | 'none' | 'hung'
  return new Promise((resolve) => {
    const sk = net.connect(pipe); let done = false;
    const end = (r) => { if (!done) { done = true; try { sk.destroy(); } catch {} resolve(r); } };
    sk.setTimeout(2000, () => end('hung'));
    sk.once('error', (e) => end(e && e.code === 'ECONNREFUSED' ? 'stale' : 'none'));   // 'stale': a socket file nobody listens on (never happens with Windows pipes)
    sk.once('close', () => end('none'));
    sk.once('connect', () => sk.write('focus\n'));
    sk.once('data', (d) => end(/bye/.test(String(d)) ? 'bye' : 'ok'));
  });
}
function stopStuckWindow() {         // the other copy holds the lock but never answers: it is stuck, stop it and take over
  try {
    const pid = +fs.readFileSync(path.join(base(), 'ui.pid'), 'utf8').trim();
    if (pid && pid !== process.pid) { process.kill(pid, 'SIGKILL'); appLog('stopped an earlier Bryt Shell window that was stuck (' + pid + ')'); }
  } catch {}
  if (process.platform !== 'win32') { try { fs.unlinkSync(uiPipe()); } catch {} }
}
async function claimSingleInstance() {   // true: we are THE Bryt Shell; false: another one is running and was told to come forward
  const pipe = uiPipe();
  for (let attempt = 0; attempt < 6; attempt++) {
    let r = await askOwner(pipe);
    if (r === 'stale') { await sleep(250); r = await askOwner(pipe); }       // maybe another launch is binding it at this very moment
    if (r === 'ok') return false;
    if (r === 'bye') { await sleep(700); continue; }                       // the other copy is closing right now: wait, then take over
    if (r === 'hung') { stopStuckWindow(); await sleep(400); }
    else if (r === 'stale' && process.platform !== 'win32') { try { fs.unlinkSync(pipe); } catch {} }   // a leftover socket file (Windows pipes vanish with their process)
    const got = await new Promise((resolve) => {
      const server = net.createServer((sock) => { sock.on('data', () => { try { sock.write(closing ? 'bye\n' : 'ok\n'); } catch {} if (!closing) bringToFront(); }); sock.on('error', () => {}); });
      server.once('error', () => resolve(false));                          // two launches at the same instant: the other one won, ask it
      server.listen(pipe, () => { uiServer = server; resolve(true); });
    });
    if (got) { try { fs.writeFileSync(path.join(base(), 'ui.pid'), String(process.pid)); } catch {} return true; }
  }
  return true;                                                             // could not decide: better to open than to show nothing
}

app.whenReady().then(async () => {
  if (!process.argv.includes('--daemon-only') && !(await claimSingleInstance())) { app.exit(0); return; }
  loadTabs();
  backendReady = initBackend();     // starts in parallel with the window below: the window never waits for the background service
  if (!process.argv.includes('--daemon-only')) { syncAi(); setTimeout(maybeOfferAi, 6000); setTimeout(inboxWatch, 9000); }   // AI access (off unless you switched it on in Settings)

  // Started by Windows at login: bring the daemon up, start tabs that have a
  // startup command, then exit. No window. The daemon keeps running.
  if (process.argv.includes('--daemon-only')) {
    await backendReady;
    if (backend.kind === 'daemon') {
      for (const t of tabs) if (t.startup) { try { await backend.attach(t.id, opts(t.id, 100, 30)); } catch {} }
      await sleep(2500); // let the daemon fire the startup commands
    }
    app.quit(); return;
  }

  if (app.isPackaged) Menu.setApplicationMenu(null);   // no menu bar to build in the installed app
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 980, minHeight: 560, show: false,
    backgroundColor: readSettings().bg || '#faf6ee',    // the colour of your theme, so the first frame is already right
    title: 'Bryt Shell | BrytMa Tech Uganda',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false }
  });
  win.once('ready-to-show', () => { win.show(); if (frontWhenReady) win.focus(); });
  setTimeout(() => { try { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); } catch {} }, 2500);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));          // the window never opens other pages
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.loadFile('index.html');

  // Daemon mode: be explicit about what happens to your programs when the window closes.
  win.on('close', async (e) => {
    if (closing || !backend || backend.kind !== 'daemon') return;   // Closes mode: nothing to ask
    let action = readSettings().closeAction;                         // 'keep' | 'stop' | undefined
    if (action === 'keep') return;
    e.preventDefault();
    if (!action) {
      const r = await dialog.showMessageBox(win, {
        type: 'question', title: 'Close Bryt Shell', message: 'Keep your programs running in the background?',
        detail: 'Keep running: your programs continue and use CPU until you stop them. Reopen Bryt Shell to see them again.\n\nStop everything: all programs in all tabs are stopped. Saved logs are kept.',
        buttons: ['Keep running', 'Stop everything', 'Cancel'], defaultId: 0, cancelId: 2,
        checkboxLabel: 'Remember my choice (you can change it later in the Mode window)'
      });
      if (r.response === 2) return;
      action = r.response === 0 ? 'keep' : 'stop';
      if (r.checkboxChecked) writeSettings({ ...readSettings(), closeAction: action });
    }
    closing = true;
    if (action === 'stop') await backend.shutdown();
    win.close();
  });
});


/* ---------- AI access (MCP): off by default, see aiapi.js and mcp/bryt-shell-mcp.js ---------- */
let aiApi = null, aiShell = null, aiActivity = null;
const aiCfg = () => { const u = readSettings().ai || {}; return Object.assign({ enabled: false, policy: 'risky', allowAdmin: false, projectsRoot: path.join(os.homedir(), 'BrytProjects'), trusted: [] }, u, { access: Object.assign({}, ACCESS_DEFAULT, u.access || {}) }); };
const aiPermitted = () => aiCfg().enabled && (!admin || aiCfg().allowAdmin);
// Questions to you show as a banner inside the window; if the window is hidden or minimised they use a Windows dialog instead.
const winUp = () => !!(win && !win.isDestroyed());
const asker = createAsker({
  canUseBanner: () => winUp() && win.isVisible() && !win.isMinimized(),
  send: (k, p) => { if (!winUp()) return; if (k === 'ask') { try { win.flashFrame(true); } catch {} } toWin(k === 'ask' ? 'aiask' : 'aiaskcancel')(p); },
  native: async (q) => {
    const trust = !!q.folder, btns = trust ? ['Allow once', 'Allow and trust this folder', 'Deny'] : ['Allow once', 'Deny'];
    const r = await dialog.showMessageBox(winUp() ? win : undefined, { type: 'question', title: 'Bryt Shell | ' + q.title, message: q.message, detail: String(q.detail || '').slice(0, 1800), buttons: btns, defaultId: btns.length - 1, cancelId: btns.length - 1, noLink: true });
    return r.response === 0 ? 'once' : trust && r.response === 1 ? 'trust' : 'deny';
  }
});
const aiAsk = (q) => asker.ask(q);
const trustFolder = (f) => { const c = aiCfg(), p = path.resolve(String(f)); if (!c.trusted.includes(p)) writeSettings({ ...readSettings(), ai: { ...c, trusted: [...c.trusted, p] } }); toWin('ai')({ on: true }); };
function removeTabById(id) {
  return (async () => {
    await backendReady; await backend.del(id); delete states[id];
    tabs = tabs.filter((x) => x.id !== id);
    if (!tabs.length) tabs.push(newTab('Tab 1'));
    saveTabs(); toWin('tabs')(tabs);
  })();
}
function syncAi() {
  if (aiApi && !aiPermitted()) { asker.cancelAll(); aiApi.stop(); aiApi = null; toWin('ai')({ on: false }); }
  if (!aiApi && aiPermitted()) {
    setTimeout(() => { try { const e = aiEntry(); for (const c of aiClients()) heal(c, e); } catch {} }, 1500);   // after an update or a move, existing connections are quietly pointed at this Bryt Shell
    aiApi = startAiApi({
      profile, dir: base(), root: root(), version: app.getVersion(), home: os.homedir(),
      get shell() { return aiShell || (aiShell = process.env.BRYT_SHELL || findShell()); },
      getSettings: () => ({ ai: aiCfg() }), getTabs: () => tabs, saveTabs, newTab, states,
      notifyTabs: () => toWin('tabs')(tabs),
      logDir: path.join(base(), 'logs'), removeTab: removeTabById, askUser: aiAsk, trustFolder, isAdmin: () => admin,
      ensure: (id) => withBackend((b) => b.ensure(id, opts(id, 120, 30))),     // same reconnect-safe path the window uses
      write: (id, d) => { if (backend) backend.write(id, d); },
      flush: () => { if (backend && backend.flush) backend.flush(); },
      onActivity: (a) => { aiActivity = a; toWin('ai')({ on: true, activity: a }); try { if (liveHost) liveHost.pushActivity(a); } catch {} }
    });
    toWin('ai')({ on: true });
  }
}
const aiStatus = () => ({ ...aiCfg(), listening: !!(aiApi && aiApi.status().listening), connections: aiApi ? aiApi.status().connections : 0, lastActivity: aiActivity, admin, presets: ACCESS_PRESETS, auditFile: path.join(root(), 'ai-audit.log') });
ipcMain.handle('ai:get', () => aiStatus());
async function aiSet(patch) {
  const cur = aiCfg(), next = { ...cur };
  if (patch && typeof patch === 'object') {
    if (typeof patch.policy === 'string' && ['risky', 'all'].includes(patch.policy)) next.policy = patch.policy;
    if (typeof patch.allowAdmin === 'boolean') next.allowAdmin = patch.allowAdmin;
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  }
  if (next.enabled && !cur.enabled) {   // turning it on: say plainly what it means, and only continue if you agree
    const r = await dialog.showMessageBox(win, { type: 'warning', title: 'Allow AI apps to use Bryt Shell?', buttons: ['Turn on AI access', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      message: 'AI apps you connect will be able to run PowerShell commands, create projects and read and write files on this PC.',
      detail: 'It works only on this PC (a local pipe, protected by a secret token). Risky actions (deleting folders, registry, downloading and running code, and so on) always ask you first, and every action is written to the audit log. You can switch it off at any time. Only connect AI apps you trust, and remember that an AI can be misled by text it reads.' });
    if (r.response !== 0) return aiStatus();
  }
  if (next.allowAdmin && !cur.allowAdmin && admin) {
    const r = await dialog.showMessageBox(win, { type: 'warning', title: 'AI in the administrator copy?', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      message: 'AI would be able to run commands with administrator rights.', detail: 'This is much more powerful (and dangerous) than the normal copy. Only do this if you really need it.' });
    if (r.response !== 0) next.allowAdmin = false;
  }
  writeSettings({ ...readSettings(), ai: next });
  syncAi();
  return aiStatus();
}
ipcMain.handle('ai:set', (_, patch) => aiSet(patch));
// What an AI app has to start: Bryt Shell's own runtime running the bridge script, told where the pipe and token are.
function aiEntry() {
  const pipe = require('./aiapi').pipeFor(profile), tokenFile = path.join(base(), 'ai-token'), script = path.join(__dirname, 'mcp', 'bryt-shell-mcp.js');
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString('hex'));
  const env = { ELECTRON_RUN_AS_NODE: '1', BRYT_AI_PIPE: pipe, BRYT_AI_TOKEN_FILE: tokenFile };
  if (app.isPackaged) env.BRYT_SHELL_EXE = process.execPath;      // lets the bridge open Bryt Shell if it is closed
  return { command: process.execPath, args: [script], env };
}
const claudeCodeCmd = (e) => 'claude mcp add ' + Object.entries(e.env).map(([k, v]) => '--env "' + k + '=' + v + '"').join(' ') + ' --scope user bryt-shell -- "' + e.command + '" "' + e.args[0] + '"';
ipcMain.handle('ai:config', () => {
  const e = aiEntry();
  return { json: JSON.stringify({ mcpServers: { 'bryt-shell': e } }, null, 2), claudeCode: claudeCodeCmd(e) };
});

// Which AI apps are on this PC, and where their MCP settings live (see aiclients.js).
function whichClaude() { try { return execSync('where claude', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null; } catch { return null; } }
function aiClients() {
  const home = os.homedir();
  return detectClients({ home, appdata: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), local: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), hasClaudeCli: !!whichClaude() });
}
const claudeCodeConnected = () => new Promise((res) => require('child_process').exec('claude mcp get bryt-shell', { windowsHide: true, timeout: 8000 }, (err) => res(!err)));
ipcMain.handle('ai:clients', async () => Promise.all(aiClients().map(async (c) => ({ id: c.id, name: c.name, how: c.how, found: c.found, restart: c.restart, file: c.file || null,
  connected: c.how === 'file' ? isConnected(c) : (c.found ? await claudeCodeConnected() : false) }))));
// The one-button path: turn AI access on (with the usual explanation) and connect every AI app found on this PC.
ipcMain.handle('ai:connect-all', async () => {
  if (!aiCfg().enabled) { await aiSet({ enabled: true }); if (!aiCfg().enabled) return { cancelled: true, status: aiStatus() }; }
  const results = [];
  for (const c of aiClients()) { if (!c.found) continue; const r = await aiConnectOne(c); results.push({ id: c.id, name: c.name, ok: !!r.ok, error: r.error, restart: r.restart }); }
  return { results, status: aiStatus() };
});
// One friendly offer after start-up when AI apps are on this PC but not connected yet. "No thanks" is remembered.
function maybeOfferAi() {
  try {
    if (admin || aiCfg().offerDismissed || !winUp()) return;
    const todo = aiClients().filter((c) => c.found && c.how === 'file' && !isConnected(c));
    if (todo.length) toWin('aioffer')({ names: todo.map((c) => c.name) });
  } catch {}
}
ipcMain.handle('ai:offer-no', () => { writeSettings({ ...readSettings(), ai: { ...aiCfg(), offerDismissed: true } }); return true; });
async function aiConnectOne(c) {
  const e = aiEntry();
  if (c.how === 'cli') {
    const run = (cmd) => new Promise((res) => require('child_process').exec(cmd, { windowsHide: true, timeout: 30000 }, (err, so, se) => res({ err, out: String(so || '') + String(se || '') })));
    if (!c.found) return { ok: false, error: 'Claude Code was not found on this PC. Use "Copy command" and run it where Claude Code works.', command: claudeCodeCmd(e) };
    await run('claude mcp remove bryt-shell --scope user');       // a clean re-add; fine if it was not there
    const r = await run(claudeCodeCmd(e));
    return r.err ? { ok: false, error: 'Claude Code said: ' + r.out.trim().slice(0, 300), command: claudeCodeCmd(e) } : { ok: true, restart: c.restart };
  }
  return connectFile(c, e);
}
ipcMain.handle('ai:connect', async (_, id) => { const c = aiClients().find((x) => x.id === id); return c ? aiConnectOne(c) : { ok: false, error: 'Unknown app.' }; });
// "Check my setup": start the bridge exactly as an AI app would, speak MCP to it, and ask for the tab list.
ipcMain.handle('ai:check', () => new Promise((resolve) => {
  if (!aiApi) return resolve({ ok: false, error: 'AI access is off. Turn it on first.' });
  const e = aiEntry(); let out = '', done = false, step = 0, child;
  const fin = (r) => { if (done) return; done = true; clearTimeout(tm); try { child.kill(); } catch {} resolve(r); };
  const tm = setTimeout(() => fin({ ok: false, error: 'No answer from the bridge within 20 seconds.' }), 20000);
  try { child = spawn(e.command, e.args, { env: { ...process.env, ...e.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (err) { return fin({ ok: false, error: 'Could not start the bridge: ' + err.message }); }
  let errText = ''; child.stderr.on('data', (d) => { errText += d; });
  child.on('error', (err) => fin({ ok: false, error: 'Could not start the bridge: ' + err.message }));
  child.on('exit', () => fin({ ok: false, error: 'The bridge stopped. ' + errText.trim().slice(0, 300) }));
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  child.stdout.on('data', (d) => {
    out += d; let i;
    while ((i = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, i); out = out.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id === 1 && step === 0) { step = 1; send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); }
      else if (m.id === 2 && step === 1) { step = 2; const n = ((m.result && m.result.tools) || []).length; send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_tabs', arguments: {} } }); child.__tools = n; }
      else if (m.id === 3 && step === 2) { const bad = !m.result || m.result.isError; fin(bad ? { ok: false, error: (m.result && m.result.content && m.result.content[0] && m.result.content[0].text) || 'The bridge could not reach Bryt Shell.' } : { ok: true, tools: child.__tools || 0 }); }
    }
  });
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Bryt Shell setup check', version: '1' } } });
}));
// Access and Web switches: each is off, on, or admin (only in the administrator copy). Presets fill them all at once.
ipcMain.handle('ai:access-set', (_, key, value) => {
  if (!(key in ACCESS_DEFAULT)) return aiStatus();
  const ok = key === 'web_local' ? typeof value === 'boolean' : ['off', 'on', 'admin'].includes(value);
  if (!ok) return aiStatus();
  const c = aiCfg(); writeSettings({ ...readSettings(), ai: { ...c, access: { ...c.access, [key]: value } } });
  return aiStatus();
});
ipcMain.handle('ai:access-preset', (_, name) => {
  if (!ACCESS_PRESETS[name]) return aiStatus();
  const c = aiCfg(); writeSettings({ ...readSettings(), ai: { ...c, access: { ...ACCESS_PRESETS[name] } } });
  return aiStatus();
});
ipcMain.handle('ai:answer', (_, id, d) => asker.answer(String(id), d));
ipcMain.handle('ai:stop', () => {      // the red "Stop AI" button: Ctrl+C where an AI is running things, cancel questions, and switch AI access off
  const ids = new Set(aiApi ? aiApi.interrupt() : []);
  for (const t of tabs) { const s = states[t.id]; if (t.ai && s && s.s === 'running' && backend && !ids.has(t.id)) { try { backend.write(t.id, '\x03'); ids.add(t.id); } catch {} } }
  asker.cancelAll();
  writeSettings({ ...readSettings(), ai: { ...aiCfg(), enabled: false } });
  syncAi();
  return { ...aiStatus(), stopped: ids.size };
});
ipcMain.handle('ai:trust-add', async () => {
  const c = aiCfg(), r = await dialog.showOpenDialog(win, { title: 'Choose a folder AI apps may work in without asking', defaultPath: fs.existsSync(c.projectsRoot) ? c.projectsRoot : os.homedir(), properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) trustFolder(r.filePaths[0]);
  return aiStatus();
});
ipcMain.handle('ai:trust-remove', (_, p) => { const c = aiCfg(); writeSettings({ ...readSettings(), ai: { ...c, trusted: c.trusted.filter((x) => x !== p) } }); return aiStatus(); });

/* ---------- project packages: send a project to another PC as one file (see aipack.js) ---------- */
let pkgPending = null;
ipcMain.handle('pkg:send', async () => {
  const c = aiCfg();
  const pick = await dialog.showOpenDialog(win, { title: 'Choose the project folder to send', defaultPath: fs.existsSync(c.projectsRoot) ? c.projectsRoot : os.homedir(), properties: ['openDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
  let r; try { r = pack.pack(pick.filePaths[0], { from: { id: ensureDeviceId(), name: inboxCfg().name } }); } catch (e) { return { error: e.message }; }
  const ib = inboxCfg().folder;
  const save = await dialog.showSaveDialog(win, { title: 'Save the project package' + (ib ? ' (your shared inbox folder is suggested)' : ''), defaultPath: path.join(ib && fs.existsSync(ib) ? ib : app.getPath('desktop'), r.summary.name + '.brytproject'), filters: [{ name: 'Bryt Shell project package', extensions: ['brytproject'] }] });
  if (save.canceled || !save.filePath) return { canceled: true };
  try { fs.writeFileSync(save.filePath, r.buf); } catch (e) { return { error: 'Could not save the file: ' + e.message }; }
  return { ok: true, file: save.filePath, ...r.summary };
});
ipcMain.handle('pkg:open', async () => {
  const pick = await dialog.showOpenDialog(win, { title: 'Open a project package', filters: [{ name: 'Bryt Shell project package', extensions: ['brytproject'] }], properties: ['openFile'] });
  if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
  let buf; try { const st = fs.statSync(pick.filePaths[0]); if (st.size > 60 * 1024 * 1024) return { error: 'This file is too large to be a project package.' }; buf = fs.readFileSync(pick.filePaths[0]); } catch (e) { return { error: 'Could not read the file: ' + e.message }; }
  const info = pack.inspect(buf); if (!info.ok) return { error: info.problems[0] };
  pkgPending = { buf };
  return { ok: true, name: info.name, files: info.files.length, bytes: info.bytes, note: info.note, created: info.created, blocked: info.blocked, scripts: info.scripts, setup: info.setup, dest: path.join(aiCfg().projectsRoot, info.name) };
});
ipcMain.handle('pkg:import', () => {
  if (!pkgPending) return { error: 'Nothing to import. Open a package first.' };
  const { buf, hash } = pkgPending; pkgPending = null;
  let r; try { r = pack.unpack(buf, aiCfg().projectsRoot); } catch (e) { return { error: e.message }; }
  if (hash) { writeInbox({ seen: { ...inboxCfg().seen, [hash]: true } }); setTimeout(inboxCheck, 300); }
  const t = newTab(r.name); t.cwd = r.dir; tabs.push(t); saveTabs(); toWin('tabs')(tabs);
  return { ok: true, dir: r.dir, id: t.id, name: r.name };
});
/* ---------- project inbox: a shared folder where projects arrive (see aiinbox.js) ---------- */
const inboxCfg = () => { const u = readSettings().inbox || {}; return { folder: u.folder || '', name: u.name || '', deviceId: u.deviceId || null, seen: u.seen || {} }; };
const writeInbox = (patch) => writeSettings({ ...readSettings(), inbox: { ...inboxCfg(), ...patch } });
const ensureDeviceId = () => { const c = inboxCfg(); if (c.deviceId) return c.deviceId; const id = crypto.randomBytes(8).toString('hex'); writeInbox({ deviceId: id }); return id; };
const inboxCache = new Map(); let inboxNotified = new Set(), inboxWatcher = null, inboxTimer = null, inboxDebounce = null;
const inboxItems = () => { const c = inboxCfg(); return c.folder ? inbox.scan(c.folder, { deviceId: ensureDeviceId(), seen: c.seen, cache: inboxCache }) : []; };
const inboxView = () => { const c = inboxCfg(); return { folder: c.folder, name: c.name, items: inboxItems().map(({ file, hash, name, files, bytes, note, from, scripts, blocked, mtime }) => ({ file, hash, name, files, bytes, note, from, scripts, blocked, mtime })) }; };
function inboxCheck() {      // tells the window what is waiting, and says it out loud once per new package
  try {
    const items = inboxItems(), fresh = items.filter((x) => !inboxNotified.has(x.hash));
    fresh.forEach((x) => inboxNotified.add(x.hash));
    toWin('inbox')({ count: items.length, fresh: fresh.slice(0, 3).map((x) => ({ name: x.name, from: x.from })) });
  } catch {}
}
function inboxWatch() {
  try { if (inboxWatcher) inboxWatcher.close(); } catch {} inboxWatcher = null; clearInterval(inboxTimer);
  const f = inboxCfg().folder; if (!f || !fs.existsSync(f)) return;
  try { inboxWatcher = fs.watch(f, () => { clearTimeout(inboxDebounce); inboxDebounce = setTimeout(inboxCheck, 2500); }); inboxWatcher.on('error', () => {}); } catch {}
  inboxTimer = setInterval(inboxCheck, 30000);      // sync services do not always raise file events, so look every 30 seconds too
  inboxCheck();
}
ipcMain.handle('inbox:get', () => inboxView());
ipcMain.handle('inbox:folder', async () => {
  const c = inboxCfg(), r = await dialog.showOpenDialog(win, { title: 'Choose the shared folder where projects arrive (for example a OneDrive, Dropbox or Google Drive folder you share)', defaultPath: c.folder || os.homedir(), properties: ['openDirectory', 'createDirectory'] });
  if (!r.canceled && r.filePaths[0]) { writeInbox({ folder: r.filePaths[0] }); inboxNotified = new Set(); inboxCache.clear(); inboxWatch(); }
  return inboxView();
});
ipcMain.handle('inbox:name', (_, n) => { writeInbox({ name: String(n || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40) }); return inboxView(); });
ipcMain.handle('inbox:dismiss', (_, hash) => { writeInbox({ seen: { ...inboxCfg().seen, [String(hash)]: true } }); setTimeout(inboxCheck, 200); return inboxView(); });
ipcMain.handle('inbox:preview', (_, file) => {      // same preview and same safety rules as "Open a project package", but only for files inside the inbox folder
  const c = inboxCfg(); if (!c.folder || !inbox.insideFolder(c.folder, String(file))) return { error: 'That file is not in the inbox folder.' };
  let buf; try { buf = fs.readFileSync(String(file)); } catch (e) { return { error: 'Could not read the file: ' + e.message }; }
  const info = pack.inspect(buf); if (!info.ok) return { error: info.problems[0] };
  pkgPending = { buf, hash: crypto.createHash('sha256').update(buf).digest('hex') };
  return { ok: true, name: info.name, files: info.files.length, bytes: info.bytes, note: info.note, created: info.created, from: info.from ? info.from.name : '', blocked: info.blocked, scripts: info.scripts, setup: info.setup, dest: path.join(aiCfg().projectsRoot, info.name) };
});
app.on('before-quit', () => { try { if (inboxWatcher) inboxWatcher.close(); clearInterval(inboxTimer); } catch {} });
/* ---------- live watch: share your tabs, or watch someone else's, through an encrypted relay (see aiLive.js and relay/) ---------- */
let liveHost = null, liveViewer = null;
const liveCfg = () => Object.assign({ relay: '', scope: 'ai' }, readSettings().live || {});
const writeLive = (p) => writeSettings({ ...readSettings(), live: { ...liveCfg(), ...p } });
const liveGet = () => ({ relay: liveCfg().relay, scope: liveCfg().scope, name: inboxCfg().name,
  hosting: liveHost ? { code: liveHost.code, viewers: liveHost.viewers, status: liveHost.status } : null, watching: !!liveViewer });
ipcMain.handle('live:get', () => liveGet());
ipcMain.handle('live:set-relay', (_, u) => { writeLive({ relay: String(u || '').trim().slice(0, 300) }); return liveGet(); });
ipcMain.handle('live:share-start', (_, o) => {
  if (liveHost) return liveGet();
  const relay = String((o && o.relay) || liveCfg().relay).trim(), scope = o && o.scope === 'all' ? 'all' : 'ai';
  try { live.relayUrl(relay, 'a'.repeat(32), 'host'); } catch (e) { return { error: e.message }; }
  if (o && typeof o.name === 'string') writeInbox({ name: o.name.replace(/[\u0000-\u001f]/g, '').slice(0, 40) });
  writeLive({ relay, scope });
  const logs = live.logReader(path.join(base(), 'logs'));
  const h = live.createHost({ relay, scope, label: inboxCfg().name, logSize: logs.size, readLog: logs.read,
    listTabs: () => tabs.map((t) => ({ id: t.id, title: t.title, ai: !!t.ai, state: (states[t.id] || {}).s || 'idle' })) });
  liveHost = h;
  h.on('viewers', (n) => toWin('live')({ kind: 'host', viewers: n, status: h.status }));
  h.on('status', (s) => toWin('live')({ kind: 'host', viewers: h.viewers, status: s }));
  h.on('error', (e) => { toWin('live')({ kind: 'host-error', message: e.message }); if (liveHost === h) liveHost = null; });
  h.start();
  return liveGet();
});
ipcMain.handle('live:share-stop', () => { if (liveHost) { liveHost.stop(); liveHost = null; } toWin('live')({ kind: 'host', viewers: 0, status: 'stopped' }); return liveGet(); });
ipcMain.handle('live:watch', (_, o) => {
  if (liveViewer) { liveViewer.stop(); liveViewer = null; }
  const relay = String((o && o.relay) || liveCfg().relay).trim(); let v;
  try { v = live.createViewer({ relay, code: String((o && o.code) || '') }); live.relayUrl(relay, 'a'.repeat(32), 'viewer'); } catch (e) { return { error: e.message }; }
  writeLive({ relay }); liveViewer = v;
  v.on('status', (s) => toWin('live')({ kind: 'v-status', status: s }));
  v.on('tabs', (t) => toWin('live')({ kind: 'v-tabs', tabs: t.tabs, label: t.label }));
  v.on('data', (d) => toWin('live')({ kind: 'v-data', tab: d.tab, b64: d.bytes.toString('base64'), reset: !!d.reset }));
  v.on('activity', (e) => toWin('live')({ kind: 'v-act', e }));
  v.on('ended', (m) => toWin('live')({ kind: 'v-ended', message: m }));
  v.on('error', (e) => toWin('live')({ kind: 'v-error', message: e.message }));
  v.start();
  return { ok: true };
});
ipcMain.handle('live:unwatch', () => { if (liveViewer) { liveViewer.stop(); liveViewer = null; } return true; });
app.on('before-quit', () => { try { if (liveHost) liveHost.stop(); if (liveViewer) liveViewer.stop(); } catch {} });
ipcMain.handle('pkg:reveal', (_, p) => { try { shell.showItemInFolder(String(p)); } catch {} });
ipcMain.handle('ai:log', () => require('./aiapi').readAudit(path.join(root(), 'ai-audit.log'), 40));
ipcMain.handle('ai:audit', () => { const f = path.join(root(), 'ai-audit.log'); try { if (!fs.existsSync(f)) fs.writeFileSync(f, ''); } catch {} return shell.openPath(f); });
app.on('before-quit', () => { try { if (aiApi) aiApi.stop(); } catch {} });

/* ---------- IPC ---------- */
ipcMain.handle('tabs:list', () => tabs);
ipcMain.handle('tabs:create', () => { const t = newTab('Tab ' + (tabs.length + 1)); tabs.push(t); saveTabs(); return t; });
ipcMain.handle('tabs:rename', (_, id, title) => { const t = tabs.find((x) => x.id === id); if (t) { t.title = title; saveTabs(); } });
ipcMain.handle('tabs:startup', (_, id, cmd) => { const t = tabs.find((x) => x.id === id); if (t) { t.startup = cmd; saveTabs(); } });
ipcMain.handle('tabs:delete', async (_, id) => {
  await backendReady; await backend.del(id); delete states[id];
  tabs = tabs.filter((x) => x.id !== id);
  if (!tabs.length) tabs.push(newTab('Tab 1'));
  saveTabs(); return tabs;
});
ipcMain.handle('pty:attach', (_, id, cols, rows) => withBackend((b) => b.attach(id, opts(id, cols, rows))));
ipcMain.handle('pty:ensure', (_, id, cols, rows) => withBackend((b) => b.ensure(id, opts(id, cols, rows))));
ipcMain.on('pty:write', (_, id, d) => { if (backend) backend.write(id, d); });
ipcMain.on('pty:resize', (_, id, c, r) => { if (backend) backend.resize(id, c, r); });
ipcMain.handle('log:clear', async (_, id) => { await backendReady; return backend.clearLog(id); });
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g;
ipcMain.handle('log:export', async (_, id) => {
  const t = tabs.find((x) => x.id === id); if (!t) return null;
  let raw = ''; try { raw = fs.readFileSync(path.join(base(), 'logs', id + '.log'), 'utf8'); } catch {}
  const text = raw.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
  const r = await dialog.showSaveDialog(win, {
    defaultPath: `${t.title.replace(/[\\/:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.txt`,
    filters: [{ name: 'Plain text', extensions: ['txt'] }, { name: 'Raw log (keeps colors)', extensions: ['log'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, r.filePath.endsWith('.log') ? raw : text);
  return r.filePath;
});
ipcMain.handle('app:info', async () => { await backendReady; return { admin, mode: backend.kind, notice, closeAction: readSettings().closeAction || null }; });
ipcMain.handle('life:states', () => states);
ipcMain.handle('life:recipes', () => { ensureRecipes(recipesFile()); return shell.openPath(recipesFile()); });
// Only these links can be opened from the window (support email and the project pages)
const ALLOWED_LINKS = ['mailto:muhumuzabright26@gmail.com', 'https://github.com/muhumuza684/bryt-shell', 'https://muhumuza684.github.io/bryt-shell'];
ipcMain.handle('app:openExternal', (_, u) => {
  const ok = typeof u === 'string' && ALLOWED_LINKS.some((a) => u === a || u.startsWith(a + '?') || u.startsWith(a + '/'));
  if (ok) shell.openExternal(u);
  return ok;
});
ipcMain.handle('app:sysinfo', () => {
  let sh = 'powershell.exe';
  try { sh = path.basename(execSync('where pwsh.exe', { encoding: 'utf8' }).split(/\r?\n/)[0].trim()); } catch {}
  return { appVersion: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
           platform: process.platform, osRelease: os.release(), arch: process.arch, mode: backend ? backend.kind : 'unknown', admin, shell: sh };
});
ipcMain.handle('app:resetClose', () => { const s = readSettings(); delete s.closeAction; writeSettings(s); });

ipcMain.handle('app:setMode', async (_, mode) => {
  writeSettings({ ...readSettings(), mode });
  closing = true;
  await backendReady; await backend.shutdown();           // stops the old backend's programs; logs stay on disk
  releaseSingleInstance(); app.relaunch(); app.exit(0);
});
ipcMain.handle('app:autostart', (_, on) => {
  if (!app.isPackaged) return null; // only meaningful in the installed app
  const o = { args: ['--daemon-only'] };
  if (on !== undefined) app.setLoginItemSettings({ openAtLogin: !!on, ...o });
  return app.getLoginItemSettings(o).openAtLogin;
});
ipcMain.handle('app:quitAll', async () => { closing = true; await backendReady; await backend.shutdown(); app.quit(); });
ipcMain.handle('app:restart', () => { closing = true; releaseSingleInstance(); app.relaunch(); app.exit(0); });   // used by the "Try again" button
ipcMain.on('app:setBg', (_, c) => { if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) { const st = readSettings(); if (st.bg !== c) { st.bg = c; writeSettings(st); } } });
ipcMain.handle('app:admin', () => new Promise((resolve) => {
  const target = app.isPackaged ? `-ArgumentList '--bryt-admin'` : `-ArgumentList '"${app.getAppPath()}"','--bryt-admin'`;
  // Wait for Windows to answer the UAC prompt. Only close this window if the admin copy really started.
  const script = `try { Start-Process -FilePath '${process.execPath}' ${target} -Verb RunAs -ErrorAction Stop; exit 0 } catch { Write-Output $_.Exception.Message; exit 1 }`;
  const p = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
  let msg = '';
  p.stdout.on('data', (d) => (msg += d));
  p.on('error', (e) => resolve({ ok: false, error: e.message }));
  p.on('exit', async (code) => {
    if (code === 0) { closing = true; await sleep(1500); resolve({ ok: true }); app.quit(); }
    else resolve({ ok: false, error: msg.trim() || 'The administrator prompt was cancelled.' });
  });
}));

app.on('window-all-closed', async () => {
  // Closes mode: stop programs. Daemon mode: leave them running in the background.
  if (backend && backend.kind === 'normal') await backend.shutdown();
  app.quit();
});
