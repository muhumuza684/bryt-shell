const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
let closing = false; // true once we have decided what to do with the programs
const states = {};   // tabId -> latest command state (idle/running/ok/fail/stopped), from either backend
const recipesFile = () => path.join(root(), 'recipes.json');
let tabs = [];

const admin = (() => { try { execSync('net session', { stdio: 'ignore' }); return true; } catch { return false; } })();
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
function startDaemon() {
  spawn(process.execPath, [path.join(__dirname, 'daemon.js'), base(), pipeName()], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }).unref();
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
      let conn;
      try { conn = await connectPipe(pipe, token); }
      catch {
        startDaemon();
        for (let i = 0; i < 30 && !conn; i++) { await sleep(250); try { conn = await connectPipe(pipe, token); } catch {} }
      }
      if (conn) {
        // A background service that survived an app update still runs the OLD code.
        if (conn.ver !== app.getVersion())
          notice = 'The background service is from an older version' + (conn.ver ? ' (' + conn.ver + ')' : '') + '. Your programs are still running, but Life lights and faces need the new version. Click "Quit & stop all", then reopen Bryt Shell.';
        backend = remoteBackend(conn.sock, onData, onExit, onLost, onState); return;
      }
    } catch {}
    notice = 'Daemon mode could not start, so this session is running in "Closes with window" mode.';
  }
  backend = localBackend(onData, onExit, onState);
}

app.setAppUserModelId('ug.brytma.shell'); // taskbar grouping + the name shown on notifications
app.whenReady().then(async () => {
  loadTabs();
  await initBackend();

  // Started by Windows at login: bring the daemon up, start tabs that have a
  // startup command, then exit. No window. The daemon keeps running.
  if (process.argv.includes('--daemon-only')) {
    if (backend.kind === 'daemon') {
      for (const t of tabs) if (t.startup) await backend.attach(t.id, opts(t.id, 100, 30));
      await sleep(2500); // let the daemon fire the startup commands
    }
    app.quit(); return;
  }

  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 980, minHeight: 560, backgroundColor: '#f4f5f7', title: 'Bryt Shell | BrytMa Tech Uganda',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
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
  await backend.del(id); delete states[id];
  tabs = tabs.filter((x) => x.id !== id);
  if (!tabs.length) tabs.push(newTab('Tab 1'));
  saveTabs(); return tabs;
});
ipcMain.handle('pty:attach', (_, id, cols, rows) => backend.attach(id, opts(id, cols, rows)));
ipcMain.handle('pty:ensure', (_, id, cols, rows) => backend.ensure(id, opts(id, cols, rows)));
ipcMain.on('pty:write', (_, id, d) => backend.write(id, d));
ipcMain.on('pty:resize', (_, id, c, r) => backend.resize(id, c, r));
ipcMain.handle('log:clear', (_, id) => backend.clearLog(id));
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
ipcMain.handle('app:info', () => ({ admin, mode: backend.kind, notice, closeAction: readSettings().closeAction || null }));
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
  await backend.shutdown();           // stops the old backend's programs; logs stay on disk
  app.relaunch(); app.exit(0);
});
ipcMain.handle('app:autostart', (_, on) => {
  if (!app.isPackaged) return null; // only meaningful in the installed app
  const o = { args: ['--daemon-only'] };
  if (on !== undefined) app.setLoginItemSettings({ openAtLogin: !!on, ...o });
  return app.getLoginItemSettings(o).openAtLogin;
});
ipcMain.handle('app:quitAll', async () => { closing = true; await backend.shutdown(); app.quit(); });
ipcMain.handle('app:admin', () => new Promise((resolve) => {
  const target = app.isPackaged ? '' : `-ArgumentList '"${app.getAppPath()}"'`;
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
