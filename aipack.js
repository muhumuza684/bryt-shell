// Project packages: one small file (.brytproject) that carries a project's files from one PC to another.
// Safe by design: it only ever WRITES files. Secrets (.env, keys) are never packed, programs (.exe, .dll ...) are never unpacked,
// every path is checked so nothing can land outside the new project folder, and nothing is run for you.
// No Electron imports, so it can be tested on its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.nuxt', 'target', '.gradle', '.idea', '.vs', '.cache', 'coverage', '.pytest_cache', '_outbox']);
const SECRET = /^(\.env(\..*)?|.*\.(pem|key|pfx|p12|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|secrets?\.(json|ya?ml|txt)|credentials(\.json)?)$/i;
const ENV_SAFE = /^\.env\.(example|sample|template)$/i;
const BLOCKED = /\.(exe|dll|msi|msp|scr|com|lnk|pif|sys|drv|cpl|hta|jar|apk)$/i;     // programs: never unpacked
const SCRIPTS = /\.(bat|cmd|ps1|psm1|vbs|vbe|wsf|reg)$/i;                              // unpacked, but you are told they are there
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_FILE = 5 * 1024 * 1024, MAX_TOTAL = 40 * 1024 * 1024, MAX_FILES = 2000;

function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || /[\u0000-\u001f<>:"|?*\\]/.test(p) || p.startsWith('/')) return null;
  const parts = p.split('/');
  for (const s of parts) {
    if (!s || s === '.' || s === '..' || /[. ]$/.test(s) || RESERVED.test(s) || SKIP_DIRS.has(s.toLowerCase())) return null;
  }
  return parts.join('/');
}
const cleanName = (n) => String(n || 'project').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/^[ .-]+|[ .]+$/g, '').slice(0, 60) || 'project';

function pack(dir, opts = {}) {
  const root = path.resolve(dir);
  if (!fs.statSync(root).isDirectory()) throw new Error('Not a folder: ' + root);
  const files = [], skipped = [], scripts = []; let total = 0;
  (function walk(d, depth) {
    if (depth > 12) { skipped.push({ p: path.relative(root, d).split(path.sep).join('/'), why: 'too deep' }); return; }
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name), rel = path.relative(root, full).split(path.sep).join('/');
      if (e.isSymbolicLink()) { skipped.push({ p: rel, why: 'shortcut/link' }); continue; }
      if (e.isDirectory()) { if (SKIP_DIRS.has(e.name.toLowerCase())) skipped.push({ p: rel + '/', why: 'generated or private folder' }); else walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (SECRET.test(e.name) && !ENV_SAFE.test(e.name)) { skipped.push({ p: rel, why: 'may hold secrets' }); continue; }
      if (BLOCKED.test(e.name)) { skipped.push({ p: rel, why: 'program file' }); continue; }
      const sz = fs.statSync(full).size;
      if (sz > MAX_FILE) { skipped.push({ p: rel, why: 'larger than 5 MB' }); continue; }
      if (files.length >= MAX_FILES || total + sz > MAX_TOTAL) { skipped.push({ p: rel, why: 'package size limit' }); continue; }
      if (!safeRel(rel)) { skipped.push({ p: rel, why: 'unsupported file name' }); continue; }
      const buf = fs.readFileSync(full); total += buf.length;
      if (SCRIPTS.test(e.name)) scripts.push(rel);
      files.push({ p: rel, n: buf.length, h: crypto.createHash('sha256').update(buf).digest('hex'), d: buf.toString('base64') });
    }
  })(root, 0);
  if (!files.length) throw new Error('Nothing to pack: the folder has no files that can be sent.');
  const setup = (Array.isArray(opts.setup) ? opts.setup : []).map((s) => String(s).slice(0, 300)).slice(0, 10);
  const from = opts.from && opts.from.id ? { id: String(opts.from.id).replace(/[^\w-]/g, '').slice(0, 40), name: String(opts.from.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40) } : undefined;   // who sent it: a label, never verified
  const manifest = { format: 'brytproject', v: 1, name: cleanName(opts.name || path.basename(root)), created: new Date().toISOString(), note: String(opts.note || '').slice(0, 500), from, setup, files };
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(manifest)), { level: 9 });
  return { buf, summary: { name: manifest.name, files: files.length, bytes: total, skipped, scripts, setup } };
}

// Reads a package WITHOUT writing anything: returns what is inside and any problems. Hash and path checks happen here.
function inspect(buf) {
  const bad = (m) => ({ ok: false, problems: [m] });
  let m;
  try { m = JSON.parse(zlib.gunzipSync(buf, { maxOutputLength: 120 * 1024 * 1024 }).toString('utf8')); } catch { return bad('This is not a Bryt Shell project package, or it is damaged.'); }
  if (!m || m.format !== 'brytproject' || m.v !== 1 || !Array.isArray(m.files)) return bad('This is not a Bryt Shell project package (wrong format or version).');
  if (m.files.length === 0 || m.files.length > MAX_FILES) return bad('The package has an unexpected number of files.');
  const seen = new Set(), keep = [], blocked = [], scripts = []; let total = 0;
  for (const f of m.files) {
    const rel = f && safeRel(f.p);
    if (!rel) return bad('The package contains an unsafe file path and was rejected: ' + String(f && f.p).slice(0, 80));
    const key = rel.toLowerCase(); if (seen.has(key)) return bad('The package lists the same file twice: ' + rel); seen.add(key);
    if (typeof f.d !== 'string' || typeof f.h !== 'string') return bad('A file in the package is damaged: ' + rel);
    const data = Buffer.from(f.d, 'base64');
    if (data.length > MAX_FILE || (total += data.length) > MAX_TOTAL) return bad('The package is larger than allowed.');
    if (crypto.createHash('sha256').update(data).digest('hex') !== f.h) return bad('A file failed its integrity check and the package was rejected: ' + rel);
    if (BLOCKED.test(rel) || (SECRET.test(rel.split('/').pop()) && !ENV_SAFE.test(rel.split('/').pop()))) { blocked.push(rel); continue; }
    if (SCRIPTS.test(rel)) scripts.push(rel);
    keep.push({ p: rel, data });
  }
  if (!keep.length) return bad('Nothing in the package can be imported.');
  const setup = (Array.isArray(m.setup) ? m.setup : []).filter((s) => typeof s === 'string').map((s) => s.slice(0, 300)).slice(0, 10);
  const from = m.from && typeof m.from === 'object' ? { id: String(m.from.id || '').replace(/[^\w-]/g, '').slice(0, 40), name: String(m.from.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40) } : null;
  return { ok: true, problems: [], name: cleanName(m.name), note: String(m.note || '').slice(0, 500), created: String(m.created || '').slice(0, 40), from, files: keep, blocked, scripts, setup, bytes: total };
}

// Writes the files into a NEW folder under destParent (never over existing files).
function unpack(buf, destParent) {
  const info = inspect(buf); if (!info.ok) throw new Error(info.problems[0]);
  const parent = path.resolve(destParent); fs.mkdirSync(parent, { recursive: true });
  let dir = path.join(parent, info.name);
  for (let i = 2; fs.existsSync(dir) && fs.readdirSync(dir).length; i++) { if (i > 99) throw new Error('Too many folders with that name.'); dir = path.join(parent, info.name + ' (' + i + ')'); }
  fs.mkdirSync(dir, { recursive: true });
  const base = path.resolve(dir) + path.sep;
  for (const f of info.files) {
    const target = path.resolve(dir, ...f.p.split('/'));
    if (!target.startsWith(base)) throw new Error('Unsafe path rejected: ' + f.p);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data, { flag: 'wx' });
  }
  return { dir, written: info.files.length, blocked: info.blocked, scripts: info.scripts, setup: info.setup, name: info.name };
}
const describe = (info) => `Package "${info.name}": ${info.files.length} files, ${(info.bytes / 1024).toFixed(0)} KB` + (info.note ? `\nNote: ${info.note}` : '') +
  (info.scripts.length ? `\nContains scripts that run if you start them: ${info.scripts.slice(0, 8).join(', ')}` : '') +
  (info.blocked.length ? `\nWill NOT be imported (programs or secrets): ${info.blocked.slice(0, 8).join(', ')}` : '') +
  (info.setup.length ? `\nSuggested setup commands (not run automatically):\n  ${info.setup.join('\n  ')}` : '');
module.exports = { pack, inspect, unpack, describe, safeRel };
