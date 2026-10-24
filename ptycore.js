// Shared terminal engine: used in-process (Closes mode) and by daemon.js (Daemon mode).
// Besides running shells it tracks each tab's state (idle / running / ok / fail / stopped)
// from standard OSC 133 marks printed by a small PowerShell prompt wrapper, and fills
// "levels" for commands that match an entry in recipes.json.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pty = require('@lydell/node-pty');

const MAX_LOG = 2 * 1024 * 1024; // logs above 2 MB are trimmed when the engine starts

/* ---------- PowerShell integration (same approach as VS Code's shellIntegration.ps1) ----------
   Emits: OSC 133;C;<b64 command>   when a command starts   (PSConsoleHostReadLine wrapper)
          OSC 133;D;<0|1>;<b64 cmd> when it finishes        (prompt wrapper; $? read FIRST)
          OSC 133;D                 empty Enter / nothing ran
          OSC 133;A                 prompt shown
   The user's own prompt (oh-my-posh etc.) is kept and gets its original $? back.            */
const INIT = String.raw`
try {
  Set-StrictMode -Off
  $global:__bryt = @{ Orig = $function:prompt; LastId = -1; Exec = $false; RL = $false }
  function global:__b64([string]$s) { if (-not $s) { return '' }; if ($s.Length -gt 300) { $s = $s.Substring(0, 300) }; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
  function global:prompt {
    $fake = [int](-not $global:?)
    $e = [char]27; $b = [char]7
    $h = Get-History -Count 1 -ErrorAction SilentlyContinue
    $out = ''
    if ($global:__bryt.LastId -ne -1 -and ($global:__bryt.RL -eq $false -or $global:__bryt.Exec)) {
      $global:__bryt.Exec = $false
      if ($h -and $h.Id -ne $global:__bryt.LastId) { $out += "$e]133;D;$fake;$(__b64 $h.CommandLine)$b" } else { $out += "$e]133;D$b" }
    }
    $out += "$e]133;A$b"
    if ($fake -ne 0) { Write-Error 'x' -ErrorAction Ignore }
    $out += & $global:__bryt.Orig
    $global:__bryt.LastId = if ($h) { $h.Id } else { 0 }
    return $out
  }
  if (Get-Module PSReadLine) {
    $global:__bryt.RL = $true
    $global:__bryt.OrigRL = $function:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {
      $line = $global:__bryt.OrigRL.Invoke()
      if (-not [string]::IsNullOrWhiteSpace([string]$line)) {   # blank Enter is not a command
        $global:__bryt.Exec = $true
        [Console]::Write(([char]27) + ']133;C;' + (__b64 ([string]$line)) + ([char]7))
      }
      $line
    }
  }
} catch {}
`;
const INIT_B64 = Buffer.from(INIT, 'utf16le').toString('base64');

/* ---------- level recipes ---------- */
const DEFAULT_RECIPES = [
  { name: 'Docker compose up', match: '^\\s*docker[ -]compose\\b.*\\bup\\b|^\\s*docker\\s+compose\\b.*\\bup\\b',
    levels: [{ name: 'Pull', on: 'Pull(ing|ed)' }, { name: 'Create', on: 'Created' }, { name: 'Start', on: 'Started' }, { name: 'Healthy', on: 'Healthy' }] },
  { name: 'Git clone', match: '^\\s*git\\s+clone\\b',
    levels: [{ name: 'Connect', on: 'Cloning into' }, { name: 'Count', on: '(Enumerating|Counting) objects' }, { name: 'Download', on: 'Receiving objects' }, { name: 'Unpack', on: 'Resolving deltas' }] },
  { name: 'pip install', match: '^\\s*(pip3?|python\\d*(\\.\\d+)?\\s+-m\\s+pip)\\s+install\\b',
    levels: [{ name: 'Collect', on: 'Collecting ' }, { name: 'Download', on: 'Downloading ' }, { name: 'Install', on: 'Installing collected packages' }, { name: 'Done', on: 'Successfully installed' }] }
];
function ensureRecipes(file) {
  try { if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(DEFAULT_RECIPES, null, 2)); } catch {}
}

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const MARK = /\x1b\]133;([A-D])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
const b64 = (s) => { try { return Buffer.from(s || '', 'base64').toString('utf8'); } catch { return ''; } };

function findShell() {
  try { return execSync('where pwsh.exe', { encoding: 'utf8' }).split(/\r?\n/)[0].trim(); } catch {}
  return 'powershell.exe';
}

class PtyManager {
  // opts: { onState(id, state), recipesFile }
  constructor(logDir, onData, onExit, opts = {}) {
    this.logDir = logDir; this.onData = onData; this.onExit = onExit; this.opts = opts;
    this.ptys = {}; this.shell = process.env.BRYT_SHELL || findShell(); // BRYT_SHELL: test hook
    this.q = {}; this.timer = null; // log writes are batched: one disk write per tab every 250 ms
    this.st = {}; this.carry = {}; this.act = {}; this.intr = {};
    this.recipes = []; this.recipesMtime = -1;
    fs.mkdirSync(logDir, { recursive: true });
    if (opts.recipesFile) ensureRecipes(opts.recipesFile);
    for (const f of fs.readdirSync(logDir)) {
      try {
        const p = path.join(logDir, f);
        if (f.endsWith('.log') && fs.statSync(p).size > MAX_LOG) {
          const b = fs.readFileSync(p); fs.writeFileSync(p, b.subarray(b.length - MAX_LOG / 2));
        }
      } catch {}
    }
  }

  /* ----- log files ----- */
  logFile(id) { return path.join(this.logDir, id + '.log'); }
  queue(id, d) { (this.q[id] = this.q[id] || []).push(d); if (!this.timer) this.timer = setTimeout(() => this.flush(), 250); }
  flush() {
    this.timer = null;
    for (const id of Object.keys(this.q)) {
      const s = this.q[id].join(''); delete this.q[id];
      if (s) try { fs.appendFileSync(this.logFile(id), s); } catch {}
    }
  }
  count() { return Object.keys(this.ptys).length; }
  readLog(id) { this.flush(); try { return fs.readFileSync(this.logFile(id), 'utf8'); } catch { return ''; } }
  clearLog(id) { delete this.q[id]; try { fs.writeFileSync(this.logFile(id), ''); } catch {} }
  deleteLog(id) { delete this.q[id]; try { fs.unlinkSync(this.logFile(id)); } catch {} }
  has(id) { return !!this.ptys[id]; }

  /* ----- state tracking ----- */
  getStates() { return { ...this.st }; }
  emit(id) { if (this.opts.onState) this.opts.onState(id, this.st[id] || null); }

  loadRecipes() {
    const f = this.opts.recipesFile; if (!f) return;
    try {
      const m = fs.statSync(f).mtimeMs; if (m === this.recipesMtime) return;
      this.recipesMtime = m;
      this.recipes = JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => {
        try { return { name: r.name, _re: new RegExp(r.match, 'i'), levels: r.levels.map((l) => ({ name: l.name, _re: new RegExp(l.on, 'i') })) }; } catch { return null; }
      }).filter((r) => r && r.levels.length);
    } catch { this.recipes = []; }
  }

  track(id, d) {
    const s = (this.carry[id] || '') + d;
    this.carry[id] = '';
    let last = 0, m;
    if (s.indexOf('\x1b]133;') !== -1) {
      MARK.lastIndex = 0;
      while ((m = MARK.exec(s))) {
        if (this.act[id]) this.levelScan(id, s.slice(last, m.index));
        last = MARK.lastIndex;
        this.mark(id, m[1], m[2] || '');
      }
    }
    const rest = s.slice(last);
    if (this.act[id]) this.levelScan(id, rest);
    // a mark split across two chunks: keep the unfinished tail for next time
    const k = rest.lastIndexOf('\x1b');
    if (k !== -1 && rest.length - k < 400 &&
        (k === rest.length - 1 || (rest[k + 1] === ']' && rest.indexOf('\x07', k) === -1))) this.carry[id] = rest.slice(k);
  }

  mark(id, t, arg) {
    if (t === 'C') {                                   // command started
      const cmd = b64(arg.split(';')[0]);
      this.loadRecipes();
      const r = this.recipes.find((x) => x._re.test(cmd));
      this.intr[id] = false;
      this.act[id] = r ? { r, lv: 0, tail: '' } : null;
      this.st[id] = { s: 'running', t0: Date.now(), cmd, lv: 0, n: r ? r.levels.length : 0, names: r ? r.levels.map((l) => l.name) : null, rname: r ? r.name : null };
      this.emit(id);
    } else if (t === 'D') {                            // command finished (or nothing ran)
      const parts = arg.split(';');
      const cur = this.st[id];
      if (parts[0] === '') {                           // empty Enter / Ctrl+C with no history entry
        if (cur && cur.s === 'running') { this.st[id] = { s: 'idle' }; delete this.act[id]; this.emit(id); }
        return;
      }
      const code = parseInt(parts[0], 10) || 0;
      const cmd = b64(parts[1]) || (cur && cur.cmd) || '';
      const wasRunning = cur && cur.s === 'running';
      const s = code === 0 ? 'ok' : (this.intr[id] ? 'stopped' : 'fail');
      const lv = wasRunning ? (s === 'ok' ? cur.n : cur.lv) : 0;
      this.st[id] = { ...(wasRunning ? cur : {}), s, code, cmd, lv, dur: wasRunning ? Date.now() - cur.t0 : 0, end: Date.now() };
      delete this.act[id];
      this.emit(id);
    }
  }

  levelScan(id, text) {
    const a = this.act[id]; if (!a || !text) return;
    const clean = (a.tail + text.replace(ANSI, '')); a.tail = clean.slice(-200);
    let reached = a.lv;
    for (let i = a.r.levels.length - 1; i >= a.lv; i--) if (a.r.levels[i]._re.test(clean)) { reached = i + 1; break; }
    if (reached > a.lv) { a.lv = reached; this.st[id] = { ...this.st[id], lv: reached }; this.emit(id); }
  }

  /* ----- terminals ----- */
  ensure(id, o = {}) {
    if (this.ptys[id]) return false;
    const cwd = o.cwd && fs.existsSync(o.cwd) ? o.cwd : process.env.USERPROFILE;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // must not leak into your terminals
    const p = pty.spawn(this.shell, ['-NoLogo', '-NoExit', '-EncodedCommand', INIT_B64], {
      name: 'xterm-256color', cols: o.cols || 100, rows: o.rows || 30, cwd, env, useConpty: true
    });
    this.ptys[id] = p;
    (this.sz = this.sz || {})[id] = [o.cols || 100, o.rows || 30];
    this.st[id] = { s: 'idle' }; this.emit(id);
    p.onData((d) => { this.queue(id, d); this.track(id, d); this.onData(id, d); });
    p.onExit(() => {
      if (this.ptys[id] === p) delete this.ptys[id];
      delete this.act[id]; this.st[id] = { s: 'idle' }; this.emit(id);
      this.flush(); this.onExit(id);
    });
    if (o.startup) setTimeout(() => { if (this.ptys[id] === p) p.write(o.startup + '\r'); }, 1200);
    return true;
  }
  write(id, d) {
    const s = this.st[id];
    if (s && s.s === 'running' && d.indexOf('\x03') !== -1) this.intr[id] = true; // you pressed Ctrl+C
    if (this.ptys[id]) this.ptys[id].write(d);
  }
  // A resize that changes nothing is skipped: every real resize makes PowerShell redraw its prompt, which shows up as blank prompts.
  resize(id, c, r) {
    if (!this.ptys[id] || !(c > 0 && r > 0)) return;
    const z = (this.sz = this.sz || {})[id];
    if (z && z[0] === c && z[1] === r) return;
    try { this.ptys[id].resize(c, r); this.sz[id] = [c, r]; } catch {}
  }
  kill(id) { if (this.ptys[id]) { try { this.ptys[id].kill(); } catch {} delete this.ptys[id]; } delete this.st[id]; delete this.act[id]; }
  killAll() { Object.keys(this.ptys).forEach((id) => this.kill(id)); this.flush(); }
}
module.exports = { PtyManager, ensureRecipes, DEFAULT_RECIPES, findShell };
