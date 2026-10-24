// Self-test for the shared-folder inbox. Run: node test/inbox-selftest.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { pack, inspect } = require('../aipack'); const { scan, insideFolder } = require('../aiinbox');
let n = 0; const ok = (m) => console.log('  ok', ++n, m);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bryt-inbox-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
const mk = (name, files, from, note) => { const d = path.join(root, 'src-' + name); fs.mkdirSync(d, { recursive: true }); for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(d, f), b); return pack(d, { name, from, note }).buf; };
const ME = { id: 'me123', name: 'Me' }, KIZ = { id: 'kiz999', name: 'Kizito' };

let i = inspect(mk('x', { 'a.txt': 'a' }, KIZ)); assert(i.ok && i.from.id === 'kiz999' && i.from.name === 'Kizito'); ok('a package remembers who sent it (a label, nothing more)');
i = inspect(mk('y', { 'a.txt': 'a' })); assert(i.ok && i.from === null); ok('old packages without a sender still open');
const weird = inspect(mk('z', { 'a.txt': 'a' }, { id: '../../x y!', name: 'A\u0007B'.padEnd(80, 'c') })); assert(weird.from.id === 'xy' || /^[\w-]*$/.test(weird.from.id)); assert(weird.from.name.length <= 40 && !/\u0007/.test(weird.from.name)); ok('sender labels are cleaned (no odd characters, short)');

fs.writeFileSync(path.join(shared, 'site.brytproject'), mk('site', { 'index.html': '<h1>hi</h1>' }, KIZ, 'Have a look'));
fs.writeFileSync(path.join(shared, 'mine.brytproject'), mk('mine', { 'a.js': 'a' }, ME));
fs.writeFileSync(path.join(shared, 'nosender.brytproject'), mk('nosender', { 'a.js': 'a' }));
fs.writeFileSync(path.join(shared, 'half.brytproject'), Buffer.from('this file is still syncing...................'));
fs.writeFileSync(path.join(shared, 'notes.txt'), 'not a package');
const cache = new Map(); let items = scan(shared, { deviceId: 'me123', cache });
assert(items.map((x) => x.name).sort().join() === 'nosender,site'); ok('lists what arrived: your own packages, damaged files and other files are left out');
const site = items.find((x) => x.name === 'site'); assert(site.from === 'Kizito' && site.note === 'Have a look' && site.files === 1 && /^[0-9a-f]{64}$/.test(site.hash)); ok('each item shows name, sender label, note and size');
assert(cache.size === 4); const before = cache.size; scan(shared, { deviceId: 'me123', cache }); assert(cache.size === before); ok('unchanged files are not read again (cache)');
items = scan(shared, { deviceId: 'me123', cache, seen: { [site.hash]: true } }); assert(items.length === 1 && items[0].name === 'nosender'); ok('imported or dismissed packages stay gone');
fs.writeFileSync(path.join(shared, 'half.brytproject'), mk('late', { 'a.js': 'a' }, KIZ)); items = scan(shared, { deviceId: 'me123', cache, now: Date.now() + 3 * 60 * 1000 }); assert(items.some((x) => x.name === 'late')); ok('a file that finished syncing shows up (damaged files are checked again later)');
assert(scan(path.join(root, 'nope'), { deviceId: 'x' }).length === 0); ok('a missing folder is just empty');
assert(insideFolder(shared, path.join(shared, 'site.brytproject')) && !insideFolder(shared, path.join(shared, '..', 'x.brytproject')) && !insideFolder(shared, path.join(shared, 'notes.txt')) && !insideFolder(shared, '/etc/passwd')); ok('only package files inside the inbox folder can be opened from it');
fs.writeFileSync(path.join(shared, 'evil.brytproject'), require('zlib').gzipSync(Buffer.from(JSON.stringify({ format: 'brytproject', v: 1, name: 'e', files: [{ p: '../x.txt', n: 1, h: 'aa', d: 'eA==' }] })))); assert(!scan(shared, { deviceId: 'x', cache: new Map() }).some((x) => x.name === 'e')); ok('a hostile package never even shows up in the list');
console.log('\nAll ' + n + ' checks passed');
