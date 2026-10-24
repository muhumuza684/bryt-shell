// Self-test for the approval broker. Run: node test/ask-selftest.js
const assert = require('assert'); const { createAsker } = require('../aiask'); let n = 0; const ok = (m) => console.log('  ok', ++n, m);
(async () => {
  const sent = []; let banner = true, nat = 'once';
  const a = createAsker({ send: (k, p) => sent.push([k, p]), canUseBanner: () => banner, native: async () => { if (nat === 'throw') throw new Error('x'); return nat; }, timeoutMs: 150 });
  let p = a.ask({ title: 't', message: 'm', detail: 'd', folder: 'C:\\x' }); assert(sent[0][0] === 'ask' && sent[0][1].folder === 'C:\\x' && a.pendingCount() === 1);
  assert(a.answer(sent[0][1].id, 'trust') && (await p) === 'trust' && a.pendingCount() === 0); ok('banner: answer "trust" resolves the question');
  p = a.ask({ title: 't', message: 'm' }); a.answer(sent[1][1].id, 'whatever'); assert((await p) === 'deny'); ok('an unknown answer counts as deny');
  assert(a.answer('nope', 'once') === false); ok('answers for unknown questions are ignored');
  const before = sent.length; p = a.ask({ title: 't', message: 'm' }); assert((await p) === 'deny' && sent.some((s, i) => i >= before && s[0] === 'cancel')); ok('no answer: deny after the timeout, and the banner is told to close');
  p = a.ask({ title: 't', message: 'm' }); a.cancelAll(); assert((await p) === 'deny' && a.pendingCount() === 0); ok('cancelAll (Stop AI) denies everything waiting');
  banner = false; nat = 'trust'; assert((await a.ask({ title: 't', message: 'm' })) === 'trust'); nat = true; assert((await a.ask({ title: 't', message: 'm' })) === 'once'); ok('window hidden: falls back to the Windows dialog');
  nat = 'throw'; assert((await a.ask({ title: 't', message: 'm' })) === 'deny'); ok('a failing dialog counts as deny');
  console.log('\nAll ' + n + ' checks passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
