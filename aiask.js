// Asks you before an AI does something: an in-app banner when Bryt Shell is on screen, a Windows dialog when it is not
// (minimised or hidden), so a request is never silently stuck. No answer in ~2 minutes counts as "no".
// Answers: 'once' | 'trust' (allow and trust the folder) | 'deny'. No Electron imports, so it can be tested on its own.
function createAsker({ send, canUseBanner, native, timeoutMs = 115000 }) {
  let seq = 0; const pending = new Map();
  const norm = (d) => (d === true ? 'once' : d === 'once' || d === 'trust' ? d : 'deny');
  async function ask(q) {
    if (!canUseBanner()) { try { return norm(await native(q)); } catch { return 'deny'; } }
    const id = 'q' + (++seq);
    return new Promise((resolve) => {
      const done = (d, notify) => { const p = pending.get(id); if (!p) return; clearTimeout(p.t); pending.delete(id); if (notify) send('cancel', { id }); resolve(d); };
      pending.set(id, { done, t: setTimeout(() => done('deny', true), timeoutMs) });
      send('ask', { id, title: q.title, message: q.message, detail: String(q.detail || '').slice(0, 1800), folder: q.folder || null });
    });
  }
  const answer = (id, d) => { const p = pending.get(id); if (!p) return false; p.done(d === 'once' || d === 'trust' ? d : 'deny', false); return true; };
  const cancelAll = () => { for (const p of [...pending.values()]) p.done('deny', true); };
  return { ask, answer, cancelAll, pendingCount: () => pending.size };
}
module.exports = { createAsker };
