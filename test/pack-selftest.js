// Self-test for project packages. Run: node test/pack-selftest.js
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), assert = require('assert');
const { pack, inspect, unpack } = require('../aipack');
let n = 0; const ok = (m) => console.log('  ok', ++n, m);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bryt-pack-')), src = path.join(root, 'my app');
const w = (rel, body) => { const f = path.join(src, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
w('index.js', 'console.log("hi é")'); w('src/util.js', 'x'); w('.env', 'TOKEN=secret'); w('.env.example', 'TOKEN='); w('id_rsa', 'KEY'); w('server.pem', 'KEY');
w('node_modules/lib/i.js', 'x'); w('.git/config', 'x'); w('tool.exe', 'MZ'); w('run.bat', 'echo hi'); w('big.bin', Buffer.alloc(5 * 1024 * 1024 + 1));
try { fs.symlinkSync(path.join(src, 'index.js'), path.join(src, 'link.js')); } catch {}

const r = pack(src, { note: 'hello', setup: ['npm install'] });
const names = (s) => s.skipped.map((x) => x.p);
assert(r.summary.files === 4 && r.summary.name === 'my app'); ok('packs only what should travel: ' + r.summary.files + ' files');
for (const x of ['.env', 'id_rsa', 'server.pem', 'tool.exe', 'big.bin', 'node_modules/', '.git/']) assert(names(r.summary).includes(x), x); ok('secrets, keys, programs, big files, node_modules and .git are left out and reported');
assert(!names(r.summary).includes('.env.example')); ok('.env.example is kept (it holds no secrets)');
assert(r.summary.scripts.includes('run.bat')); ok('scripts are flagged');
const info = inspect(r.buf); assert(info.ok && info.files.length === 4 && info.setup[0] === 'npm install' && info.note === 'hello'); ok('inspect reads it back without writing anything');
const out = path.join(root, 'out'); let u = unpack(r.buf, out); assert(fs.readFileSync(path.join(u.dir, 'index.js'), 'utf8') === 'console.log("hi é")' && fs.existsSync(path.join(u.dir, 'src', 'util.js')) && !fs.existsSync(path.join(u.dir, '.env'))); ok('unpacks into a new folder, contents identical');
u = unpack(r.buf, out); assert(path.basename(u.dir) === 'my app (2)'); ok('importing again never overwrites: "my app (2)"');

const make = (files, extra = {}) => { const fl = files.map(([p, body, h]) => ({ p, n: body.length, h: h || crypto.createHash('sha256').update(body).digest('hex'), d: Buffer.from(body).toString('base64') })); return zlib.gzipSync(Buffer.from(JSON.stringify({ format: 'brytproject', v: 1, name: 'evil', files: fl, ...extra }))); };
for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/Windows/x.txt', 'a\\b.txt', '.git/config', 'CON.txt', 'dir/NUL', 'a/b./c', 'x:y', 'node_modules/p/i.js', '']) {
  const i = inspect(make([['ok.txt', 'x'], [bad, 'x']])); assert(!i.ok, 'accepted ' + bad);
} ok('path traversal, absolute, drive, backslash, .git, reserved-name and empty paths are all rejected');
assert(!inspect(make([['a.txt', 'x', 'deadbeef']])).ok); ok('a file whose hash does not match rejects the whole package');
assert(!inspect(make([['A.txt', 'x'], ['a.TXT', 'y']])).ok); ok('case-insensitive duplicates are rejected');
let i2 = inspect(make([['ok.txt', 'x'], ['setup.exe', 'MZ'], ['.env', 'S=1']])); assert(i2.ok && i2.files.length === 1 && i2.blocked.length === 2); ok('a package that smuggles programs or secrets in: they are dropped, the rest imports');
assert(!inspect(Buffer.from('not a package')).ok && !inspect(zlib.gzipSync(Buffer.from('{"format":"other"}'))).ok); ok('garbage and wrong formats are rejected with a clear message');
assert(!inspect(make([['a.txt', 'x']], { v: 2 })).ok); ok('unknown versions are rejected');
const evil = path.join(root, 'out2'); assert.throws(() => unpack(make([['../../x.txt', 'x']]), evil)); assert(!fs.existsSync(path.join(root, 'x.txt'))); ok('nothing is written outside the destination when a package is hostile');
console.log('\nAll ' + n + ' checks passed');
