// Self-test for live watch: a real relay on this machine, real encrypted clients. Run: node test/live-selftest.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), WebSocket = require('ws');
const L = require('../aiLive'); const { start } = require('../relay/relay');
let n = 0; const ok = (m) => console.log('  ok', ++n, m); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(40); } throw new Error('timed out waiting for ' + what); };

(async () => {
  // ---- codes and crypto
  const c1 = L.newCode(); assert(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/.test(c1) && L.validCode(c1) && c1 !== L.newCode()); ok('share codes look like ABCD-EFGH-JKLM-NPQR, 80 random bits, never repeat');
  assert(L.derive(c1).room === L.derive(c1.toLowerCase().replace(/-/g, ' ')).room && L.derive(c1).room !== L.derive(L.newCode()).room && /^[0-9a-f]{32}$/.test(L.derive(c1).room)); ok('typing the code in lower case, with spaces, gives the same room; different codes give different rooms');
  assert.throws(() => L.derive('ABC')); assert(!L.validCode('ABCD-EFGH')); ok('a code of the wrong length is refused with a clear message');
  const k = L.derive(c1).key, k2 = L.derive(L.newCode()).key, sealed = L.seal(k, { t: 'x', secret: 'HELLO-WORLD' });
  assert(!/HELLO-WORLD/.test(sealed) && L.open(k, sealed).secret === 'HELLO-WORLD' && L.open(k2, sealed) === null); const tam = JSON.parse(sealed); tam.e = tam.e.slice(0, 40) + (tam.e[40] === 'A' ? 'B' : 'A') + tam.e.slice(41); assert(L.open(k, JSON.stringify(tam)) === null && L.open(k, 'garbage') === null); ok('encrypted messages hide their content, open only with the right key, and any tampering is detected');

  // ---- a relay and a sharer with a fake set of tabs
  const seen = []; const relay = await start({ port: 0, host: '127.0.0.1', tap: (role, s) => seen.push([role, s]) }); const url = 'ws://127.0.0.1:' + relay.port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bryt-live-')); const rd = L.logReader(dir);
  const tabs = [{ id: 'ai1', title: 'AI build', state: 'running', ai: true }, { id: 'me1', title: 'my private tab', state: 'idle', ai: false }];
  const log = (id, s) => fs.appendFileSync(path.join(dir, id + '.log'), s);
  log('ai1', 'start \x1b[32mSECRET-MARKER-1\x1b[0m\r\n'); log('me1', 'PRIVATE-TAB-CONTENT\r\n');
  const mkHost = (extra = {}) => L.createHost({ relay: url, scope: 'ai', label: 'Kizito', listTabs: () => tabs, logSize: rd.size, readLog: rd.read, ...extra });
  const host = mkHost(); const code = host.start(); await until(() => host.status === 'live', 4000, 'host live');
  const mkViewer = (c = code) => { const v = L.createViewer({ relay: url, code: c }); const s = { text: {}, tabs: null, label: '', acts: [], status: [], ended: null, error: null, resets: 0, events: 0 }; v.on('data', (d) => { s.events++; if (d.reset) { s.resets++; s.text[d.tab] = ''; } s.text[d.tab] = (s.text[d.tab] || '') + d.bytes.toString('utf8'); }); v.on('tabs', (t) => { s.tabs = t.tabs; s.label = t.label; }); v.on('activity', (a) => s.acts.push(a)); v.on('status', (x) => s.status.push(x)); v.on('ended', (m) => { s.ended = m; }); v.on('error', (e) => { s.error = e.message; }); v.start(); return { v, s }; };
  const A = mkViewer(); await until(() => A.s.text.ai1 && A.s.tabs, 5000, 'viewer sees the tab');
  assert(/SECRET-MARKER-1/.test(A.s.text.ai1) && A.s.label === 'Kizito' && A.s.tabs.length === 1 && A.s.tabs[0].title === 'AI build'); ok('a viewer with the code sees the AI tab and what it already printed');
  assert(host.viewers === 1); ok('the sharer is told one person is watching');
  assert(!A.s.text.me1 && !JSON.stringify(A.s.tabs).includes('private')); ok('with "AI tabs only" your other tabs are never sent, not even their names');
  log('ai1', 'line two\r\nline three\r\n'); await until(() => /line three/.test(A.s.text.ai1 || ''), 4000, 'live chunk'); assert(A.s.text.ai1.indexOf('line two') < A.s.text.ai1.indexOf('line three')); ok('new output arrives live, in order');
  tabs[0].state = 'ok'; await until(() => A.s.tabs && A.s.tabs[0].state === 'ok', 3000, 'tab state'); ok('tab status (running, ok, failed) follows along');
  host.pushActivity({ t: Date.now(), client: 'Visual Studio Code 1.1', op: 'run_in_tab', summary: 'npm install express', decision: 'ok' }); await until(() => A.s.acts.length, 3000, 'activity'); assert(A.s.acts[0].op === 'run_in_tab' && A.s.acts[0].summary === 'npm install express'); ok('what the AI does shows up as an activity feed');

  // the relay only ever saw ciphertext
  const all = seen.map((x) => x[1]).join('\n'); assert(seen.length > 5 && !/SECRET-MARKER|line two|npm install|AI build|Kizito|PRIVATE/.test(all) && !all.includes(c1) && !all.includes(c1.replace(/-/g, ''))); ok('the relay saw ' + seen.length + ' messages and not one readable word: no output, tab names, commands, name or code');

  // late joiner, no flicker for the first viewer
  const before = A.s.events; const B = mkViewer(); await until(() => /line three/.test(B.s.text.ai1 || ''), 5000, 'late joiner history'); await sleep(300);
  assert(host.viewers === 2 && B.s.text.ai1 === A.s.text.ai1); assert(A.s.resets === 1 && A.s.events - before <= 1); ok('a person who joins late gets the history; the first viewer is not reset or shown anything twice');
  // wrong code / nobody sharing
  const W = mkViewer(L.newCode()); await until(() => W.s.error, 4000, 'wrong code'); assert(/nobody is sharing/.test(W.s.error)); ok('a wrong code gets "nobody is sharing with this code" and nothing else');
  // second sharer with the same code
  const dup = L.createHost({ relay: url, code, scope: 'ai', listTabs: () => [], logSize: rd.size, readLog: rd.read }); let dupErr = null; dup.on('error', (e) => { dupErr = e.message; }); dup.start(); await until(() => dupErr, 4000, 'duplicate'); assert(/already being shared/.test(dupErr)); dup.stop(); ok('a second person cannot take over a code that is already being shared');

  // viewers are read-only and rate/size limited at the relay
  const raw = new WebSocket(url + '/?room=' + host.room + '&role=viewer'); await new Promise((r) => raw.on('open', r)); const hostFrames = () => seen.filter((x) => x[0] === 'viewer').length; const b0 = hostFrames();
  raw.send('x'.repeat(5000)); for (let i = 0; i < 20; i++) raw.send('{"e":"AAAA"}'); await sleep(300); assert(hostFrames() - b0 <= 5); ok('a watcher can send only a few tiny messages: big or rapid ones are dropped before they reach the sharer');
  const big = new WebSocket(url + '/?room=' + host.room + '&role=viewer'); await new Promise((r) => big.on('open', r)); const closed = new Promise((r) => big.on('close', r)); big.send('y'.repeat(300 * 1024)); const cc = await Promise.race([closed, sleep(2000).then(() => 'open')]); assert(cc === 1009); ok('a frame over 256 KB closes the connection (relay protection)');
  raw.close();

  // log cleared
  fs.writeFileSync(path.join(dir, 'ai1.log'), 'fresh\r\n'); await until(() => A.s.text.ai1 === 'fresh\r\n', 4000, 'reset'); ok('if the log is cleared the viewers get a clean copy');

  // dropped sharer connection: viewers are told, then it comes back by itself
  const room = relay.rooms.get(host.room); const status0 = A.s.status.length; room.host.terminate();
  await until(() => A.s.status.slice(status0).includes('host-away'), 4000, 'host-away'); await until(() => host.status === 'live' && A.s.status.slice(status0).lastIndexOf('live') > A.s.status.slice(status0).indexOf('host-away'), 8000, 'host back');
  log('ai1', 'after reconnect\r\n'); await until(() => /after reconnect/.test(A.s.text.ai1), 5000, 'data after reconnect'); ok('if the sharer\'s connection drops, viewers see "away" and it resumes by itself');

  // viewer cap
  const extra = []; for (let i = 0; i < 6; i++) extra.push(mkViewer()); await sleep(1200); const over = mkViewer(); await until(() => over.s.error, 4000, 'cap'); assert(/too many/.test(over.s.error)); ok('no more than 8 people can watch one share');
  extra.forEach((e) => e.v.stop()); over.v.stop();

  // viewer logic against a hand-made sharer (gaps, overlaps, duplicates)
  const code2 = L.newCode(), kk = L.derive(code2); const hw = new WebSocket(url + '/?room=' + kk.room + '&role=host'); await new Promise((r) => hw.on('open', r)); const got = []; hw.on('message', (d) => { const m = L.open(kk.key, d.toString()); if (m) got.push(m.t); });
  const V = mkViewer(code2); await until(() => got.includes('hello'), 3000, 'hello'); const S = (o) => hw.send(L.seal(kk.key, o)); const b64 = (s) => Buffer.from(s).toString('base64');
  S({ t: 'snap', tab: 't', off: 0, d: b64('0123456789') }); await until(() => V.s.text.t === '0123456789', 2000, 'snap');
  S({ t: 'snap', tab: 't', off: 5, d: b64('56789abcde') }); await until(() => V.s.text.t === '0123456789abcde', 2000, 'overlap'); ok('overlapping copies are merged without repeating text');
  S({ t: 'chunk', tab: 't', off: 10, d: b64('abcde') }); S({ t: 'chunk', tab: 't', off: 15, d: b64('fgh') }); await until(() => V.s.text.t === '0123456789abcdefgh', 2000, 'chunks'); ok('duplicate pieces are ignored, the next piece is appended');
  const g0 = got.filter((x) => x === 'resync').length; S({ t: 'chunk', tab: 't', off: 500, d: b64('zzz') }); await until(() => got.filter((x) => x === 'resync').length > g0, 3000, 'resync'); assert(V.s.text.t === '0123456789abcdefgh'); ok('a gap (a missed piece) is never guessed at: the viewer asks for a fresh copy');
  S({ t: 'bye' }); await until(() => V.s.ended, 3000, 'bye'); ok('"bye" ends the watch with a friendly message'); hw.close();

  // sharer stops
  host.stop(); await until(() => A.s.ended && B.s.ended, 3000, 'stop'); assert(/stopped sharing/.test(A.s.ended)); await sleep(300); ok('when the sharer stops, every viewer is told and disconnected');
  await sleep(200); const w2 = mkViewer(); await until(() => w2.s.error, 4000, 'after stop'); ok('after stopping, the code no longer works');
  [A, B, W, V, w2].forEach((x) => x.v.stop()); await relay.close(); console.log('\nAll ' + n + ' checks passed'); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e && e.stack || e); process.exit(1); });
