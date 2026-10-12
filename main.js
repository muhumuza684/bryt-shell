const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PtyManager, ensureRecipes } = require('./ptycore');

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
  if (process.platform !== 'win32') return false;
  if (process.argv.includes('--bryt-admin')) return true;     // our own "Run as admin" button starts the elevated copy with this flag
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
    attach: async (id, o) => { const log = m.readLog(id); m.ensure(id, o); return log; },
    ensure: async (id, o) => { m.ensure(id, o); },
    write: (id, d) => m.write(id, d),
    resize: (id, c, r) => m.resize(id, c, r),
    del: async (id) => { m.kill(id); m.deleteLog(id); },
    clearLog: async (id) => m.clearLog(id),
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
  try { return await connectPipe(pipe, token); } catch {}       // already running: instant
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
function remoteBackend(sock, onData, onExit, onLost, onState) {
  let buf = '', rid = 0; const waits = {};
  const send = (m) => { try { sock.write(JSON.stringify(m) + '\n'); } catch {} };
  sock.setEncoding('utf8');
  sock.on('data', (c) => {
    buf += c; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'data') onData(m.id, m.d);
      else if (m.t === 'exit') onExit(m.id);
      else if (m.t === 'state') onState(m.id, m.st);
      else if (m.t === 'states') Object.keys(m.map).forEach((k) => onState(k, m.map[k]));
      else if (m.t === 'log' && waits[m.rid]) { waits[m.rid](m.log); delete waits[m.rid]; }
    }
  });
  sock.on('close', onLost); sock.on('error', () => {});
  send({ t: 'status' });   // learn the state of programs that kept running while the window was closed
  return {
    kind: 'daemon',
    attach: (id, o) => new Promise((res) => { const r = ++rid; waits[r] = res; send({ t: 'attach', rid: r, ...o }); }),
    ensure: async (id, o) => send({ t: 'ensure', ...o }),
    write: (id, d) => send({ t: 'write', id, d }),
    resize: (id, cols, rows) => send({ t: 'resize', id, cols, rows }),
    del: async (id) => send({ t: 'delete', id }),
    clearLog: async (id) => send({ t: 'clearLog', id }),
    shutdown: async () => { send({ t: 'shutdown' }); await sleep(400); }
  };
}

async function initBackend() {
  const toWin = (ch) => (...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };
  const onData = toWin('data'), onExit = toWin('exit');
  const onState = (id, st) => { if (st) states[id] = st; else delete states[id]; toWin('state')(id, st); };
  const onLost = () => toWin('notice')('Lost connection to the background service. Close and reopen Bryt Shell.');

  if (readSettings().mode === 'daemon') {
    try {
      const token = ensureToken(), pipe = pipeName();
      const conn = await connectDaemon(pipe, token);
      if (conn) {
        // A background service that survived an app update still runs the OLD code.
        if (conn.ver !== app.getVersion())
          notice = 'The background service is from an older version' + (conn.ver ? ' (' + conn.ver + ')' : '') + '. Your programs are still running, but Life lights and faces need the new version. Click "Quit & stop all", then reopen Bryt Shell.';
        backend = remoteBackend(conn.sock, onData, onExit, onLost, onState); return;
      }
    } catch (e) { daemonWhy = daemonWhy || String((e && e.message) || e); }
    notice = 'Daemon mode could not start' + (daemonWhy ? ' (' + daemonWhy + ')' : '') + ', so this session is running in "Closes with window" mode. Details: ' + daemonLog();
  }
  backend = localBackend(onData, onExit, onState);
}

app.setAppUserModelId('ug.brytma.shell'); // taskbar grouping + the name shown on notifications
app.whenReady().then(async () => {
  loadTabs();
  backendReady = initBackend();     // starts in parallel with the window below: the window never waits for the background service

  // Started by Windows at login: bring the daemon up, start tabs that have a
  // startup command, then exit. No window. The daemon keeps running.
  if (process.argv.includes('--daemon-only')) {
    await backendReady;
    if (backend.kind === 'daemon') {
      for (const t of tabs) if (t.startup) await backend.attach(t.id, opts(t.id, 100, 30));
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
  win.once('ready-to-show', () => win.show());
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
ipcMain.handle('pty:attach', async (_, id, cols, rows) => { await backendReady; return backend.attach(id, opts(id, cols, rows)); });
ipcMain.handle('pty:ensure', async (_, id, cols, rows) => { await backendReady; return backend.ensure(id, opts(id, cols, rows)); });
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
  await backendReady; await backend.shutdown();           // stops the old backend's programs; logs stay on disk
  app.relaunch(); app.exit(0);
});
ipcMain.handle('app:autostart', (_, on) => {
  if (!app.isPackaged) return null; // only meaningful in the installed app
  const o = { args: ['--daemon-only'] };
  if (on !== undefined) app.setLoginItemSettings({ openAtLogin: !!on, ...o });
  return app.getLoginItemSettings(o).openAtLogin;
});
ipcMain.handle('app:quitAll', async () => { closing = true; await backendReady; await backend.shutdown(); app.quit(); });
ipcMain.handle('app:restart', () => { closing = true; app.relaunch(); app.exit(0); });   // used by the "Try again" button
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
