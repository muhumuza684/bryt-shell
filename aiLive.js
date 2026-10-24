// Live watch: one person shares their tabs, others watch (read-only), through a relay that cannot read anything.
//  - The share code (16 letters/digits, like ABCD-EFGH-JKLM-NPQR) is the only secret. Two things are derived from it with scrypt:
//    the room name (the relay sees only this) and the encryption key (the relay never sees this). Everything sent is AES-256-GCM encrypted.
//  - Watchers cannot type into your tabs, run anything or change anything. They can only ask for a fresh copy of what is on screen.
//  - You see how many people watch, and you can stop at any moment.
// No Electron imports, so it can be tested on its own.
const crypto = require('crypto');
const WebSocket = require('ws');
const { EventEmitter } = require('events');

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CHUNK = 32 * 1024, SNAP = 48 * 1024;

function newCode() {
  const b = crypto.randomBytes(10); let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i < 80; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}
const normalize = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const validCode = (c) => normalize(c).length === 16;
function derive(code) {
  const n = normalize(code);
  if (n.length !== 16) throw new Error('A share code has 16 letters and numbers, like ABCD-EFGH-JKLM-NPQR.');
  const k = crypto.scryptSync(n, 'bryt-live-v1', 48, { N: 16384, r: 8, p: 1 });
  return { room: k.subarray(0, 16).toString('hex'), key: k.subarray(16, 48) };
}
function seal(key, obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ e: Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64') });
}
function open(key, str) {
  try {
    const m = JSON.parse(str); if (!m || typeof m.e !== 'string') return null;
    const raw = Buffer.from(m.e, 'base64'); if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8'));
  } catch { return null; }
}
function relayUrl(relay, room, role) {
  let u = String(relay || '').trim().replace(/\/+$/, '');
  if (!/^(wss?|https?):\/\//i.test(u)) throw new Error('The relay address must start with wss:// (or ws:// for a test on your own network).');
  u = u.replace(/^http/i, 'ws');
  return u + '/?room=' + room + '&role=' + role;
}

/* ---------- the person sharing ---------- */
// o: { relay, code?, scope: 'ai'|'all', label, listTabs() -> [{id,title,state,ai}], logSize(id), readLog(id, from, to) -> Buffer }
function createHost(o) {
  const ev = new EventEmitter(), code = o.code || newCode(), { room, key } = derive(code);
  let ws = null, stopped = false, backoff = 1000, viewers = 0, tabsKey = '', pumpT = null, retryT = null, status = 'connecting';
  const offsets = new Map();
  const setStatus = (s) => { status = s; ev.emit('status', s); };
  const frame = (obj) => { if (ws && ws.readyState === 1) { try { ws.send(seal(key, obj)); } catch {} } };
  const shared = () => o.listTabs().filter((t) => o.scope === 'all' || t.ai);
  const tabsFrame = (force) => { const list = shared().map((t) => ({ id: t.id, title: t.title, state: t.state })), k = JSON.stringify(list); if (force || k !== tabsKey) { tabsKey = k; frame({ t: 'tabs', tabs: list, label: o.label || '' }); } };
  function snap(id, reset) {
    const size = o.logSize(id), start = Math.max(0, size - SNAP), buf = size > start ? o.readLog(id, start, size) : Buffer.alloc(0);
    frame({ t: 'snap', tab: id, off: start, d: buf.toString('base64'), reset: !!reset }); offsets.set(id, start + buf.length);
  }
  function pump() {
    try {
      tabsFrame(false);
      for (const t of shared()) {
        if (!offsets.has(t.id)) { snap(t.id, false); continue; }
        let off = offsets.get(t.id), size = o.logSize(t.id);
        if (size < off) { snap(t.id, true); continue; }                              // the log was cleared: send a fresh copy
        for (let n = 0; off < size && n < 8; n++) {
          const to = Math.min(size, off + CHUNK), buf = o.readLog(t.id, off, to); if (!buf.length) break;
          frame({ t: 'chunk', tab: t.id, off, d: buf.toString('base64') }); off += buf.length;
        }
        offsets.set(t.id, off);
      }
    } catch {}
  }
  function connect() {
    if (stopped) return;
    let url; try { url = relayUrl(o.relay, room, 'host'); } catch (e) { setStatus('error'); ev.emit('error', e); return; }
    ws = new WebSocket(url, { handshakeTimeout: 10000, maxPayload: 512 * 1024 });
    ws.on('open', () => { backoff = 1000; setStatus('live'); tabsFrame(true); clearInterval(pumpT); pumpT = setInterval(pump, 400); });
    ws.on('message', (data) => {
      const s = data.toString(); let m; try { m = JSON.parse(s); } catch { return; }
      if (m && m.relay && typeof m.relay.viewers === 'number') { if (m.relay.viewers !== viewers) { viewers = m.relay.viewers; ev.emit('viewers', viewers); } return; }
      const msg = open(key, s); if (!msg) return;
      if (msg.t === 'hello' || msg.t === 'resync') { offsets.clear(); tabsFrame(true); for (const t of shared()) snap(t.id, false); }
    });
    ws.on('close', (c, reason) => {
      clearInterval(pumpT); if (stopped) return;
      if (c === 4001 || c === 4000 || c === 4003) { setStatus('error'); ev.emit('error', new Error(String(reason || 'The relay refused this share.'))); return; }
      setStatus('reconnecting'); retryT = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 15000);
    });
    ws.on('error', () => {});
  }
  Object.assign(ev, {
    code, room,
    start() { connect(); return code; },
    pushActivity(e) { frame({ t: 'act', e: { t: e.t, client: String(e.client || '').slice(0, 40), op: String(e.op || '').slice(0, 30), summary: String(e.summary || '').slice(0, 120), decision: e.decision || '' } }); },
    stop() {
      if (stopped) return; frame({ t: 'bye' }); stopped = true; clearInterval(pumpT); clearTimeout(retryT);
      const w = ws; setTimeout(() => { try { w && w.close(1000); } catch {} }, 150); setStatus('stopped');
    }
  });
  Object.defineProperty(ev, 'viewers', { get: () => viewers }); Object.defineProperty(ev, 'status', { get: () => status });   // live values, not copies
  return ev;
}

/* ---------- a person watching ---------- */
function createViewer({ relay, code }) {
  const ev = new EventEmitter(), { room, key } = derive(code), next = new Map();
  let ws = null, stopped = false, backoff = 1000, retryT = null, lastAsk = 0, everLive = false;
  const setStatus = (s) => ev.emit('status', s);
  const ask = (t) => { if (ws && ws.readyState === 1) { try { ws.send(seal(key, { t })); } catch {} } };
  const resync = () => { const n = Date.now(); if (n - lastAsk > 2000) { lastAsk = n; ask('resync'); } };
  function onMsg(m) {
    if (m.t === 'tabs') ev.emit('tabs', { tabs: m.tabs || [], label: m.label || '' });
    else if (m.t === 'act') ev.emit('activity', m.e || {});
    else if (m.t === 'bye') { ev.emit('ended', 'The person stopped sharing.'); stop(); }
    else if (m.t === 'snap' || m.t === 'chunk') {
      const bytes = Buffer.from(String(m.d || ''), 'base64'), off = +m.off || 0, end = off + bytes.length, cur = next.get(m.tab);
      if (m.t === 'snap') {
        if (m.reset || cur === undefined || cur < off) { ev.emit('data', { tab: m.tab, bytes, reset: true }); next.set(m.tab, end); }
        else if (end > cur) { ev.emit('data', { tab: m.tab, bytes: bytes.subarray(cur - off), reset: false }); next.set(m.tab, end); }
      } else {
        if (cur === undefined || off > cur) return resync();                                // we missed something
        if (end <= cur) return;                                                              // already have it
        ev.emit('data', { tab: m.tab, bytes: off < cur ? bytes.subarray(cur - off) : bytes, reset: false }); next.set(m.tab, end);
      }
    }
  }
  function connect() {
    if (stopped) return;
    let url; try { url = relayUrl(relay, room, 'viewer'); } catch (e) { ev.emit('error', e); return; }
    setStatus(everLive ? 'reconnecting' : 'connecting');
    ws = new WebSocket(url, { handshakeTimeout: 10000, maxPayload: 512 * 1024 });
    ws.on('open', () => { backoff = 1000; everLive = true; setStatus('live'); ask('hello'); });
    ws.on('message', (data) => {
      const s = data.toString(); let m; try { m = JSON.parse(s); } catch { return; }
      if (m && m.relay) { if (m.relay.host === 'left') setStatus('host-away'); else if (m.relay.host === 'back') { setStatus('live'); ask('hello'); } return; }
      const msg = open(key, s); if (msg) onMsg(msg);
    });
    ws.on('close', (c, reason) => {
      if (stopped) return;
      if (c === 4004 || c === 4005 || c === 4000) { ev.emit('error', new Error(String(reason || 'Could not join.'))); stop(); return; }
      if (c === 4002) { ev.emit('ended', 'The sharing has ended.'); stop(); return; }
      setStatus('reconnecting'); retryT = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 15000);
    });
    ws.on('error', () => {});
  }
  function stop() { if (stopped) return; stopped = true; clearTimeout(retryT); try { ws && ws.close(1000); } catch {} setStatus('stopped'); }
  return Object.assign(ev, { start() { connect(); }, stop });
}

// Reads the tab logs the app already keeps (one file per tab).
function logReader(dir) {
  const fs = require('fs'), path = require('path');
  const f = (id) => path.join(dir, String(id).replace(/[^\w-]/g, '') + '.log');
  return {
    size: (id) => { try { return fs.statSync(f(id)).size; } catch { return 0; } },
    read: (id, from, to) => { let fd; try { fd = fs.openSync(f(id), 'r'); const b = Buffer.alloc(Math.max(0, to - from)); const n = fs.readSync(fd, b, 0, b.length, from); return b.subarray(0, n); } catch { return Buffer.alloc(0); } finally { try { fd && fs.closeSync(fd); } catch {} } }
  };
}
module.exports = { newCode, normalize, validCode, derive, seal, open, relayUrl, createHost, createViewer, logReader };
