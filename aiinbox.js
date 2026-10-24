// The project inbox: a shared folder (OneDrive, Dropbox, Google Drive, a network share ...) where project packages arrive.
// This only READS the folder and checks each package with the same safety rules as "Open a project package".
// Names of senders are labels that anybody can type, they are never verified. No Electron imports, so it can be tested on its own.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pack = require('./aipack');

const MAX_FILES = 100, MAX_BYTES = 60 * 1024 * 1024, RETRY_MS = 2 * 60 * 1000;

// Returns the packages waiting in the folder, newest first, leaving out your own, ones you already imported or dismissed, and anything damaged.
// cache: a Map kept between scans, so unchanged files are not read again every time.
function scan(folder, { deviceId, seen = {}, cache = new Map(), now = Date.now() } = {}) {
  let names; try { names = fs.readdirSync(folder); } catch { return []; }
  const out = [];
  for (const n of names.filter((x) => /\.brytproject$/i.test(x)).slice(0, MAX_FILES)) {
    const file = path.join(folder, n); let st; try { st = fs.statSync(file); if (!st.isFile() || st.size > MAX_BYTES || st.size < 20) continue; } catch { continue; }
    const key = file + '|' + st.size + '|' + st.mtimeMs; let hit = cache.get(key);
    if (!hit || (!hit.ok && now - hit.t > RETRY_MS)) {            // a file that is still syncing looks damaged for a while: look again later
      try {
        const buf = fs.readFileSync(file), info = pack.inspect(buf);
        hit = info.ok ? { ok: true, t: now, hash: crypto.createHash('sha256').update(buf).digest('hex'), name: info.name, files: info.files.length, bytes: info.bytes, note: info.note, from: info.from, scripts: info.scripts, blocked: info.blocked, setup: info.setup }
                      : { ok: false, t: now };
      } catch { hit = { ok: false, t: now }; }
      cache.set(key, hit);
    }
    if (!hit.ok || seen[hit.hash] || (hit.from && hit.from.id && hit.from.id === deviceId)) continue;
    out.push({ file, hash: hit.hash, name: hit.name, files: hit.files, bytes: hit.bytes, note: hit.note, from: hit.from ? hit.from.name || '' : '', scripts: hit.scripts, blocked: hit.blocked, setup: hit.setup, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
// Only files that really sit inside the inbox folder may be opened from it.
const insideFolder = (folder, file) => { const f = path.resolve(file).toLowerCase(), d = path.resolve(folder).toLowerCase() + path.sep; return f.startsWith(d) && /\.brytproject$/i.test(f); };
module.exports = { scan, insideFolder };
