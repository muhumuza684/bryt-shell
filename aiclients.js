// Finds the AI apps on this PC and adds Bryt Shell to their MCP settings, without touching anything else in those files.
// No Electron imports, so it can be tested on its own.
const fs = require('fs');
const path = require('path');

const dirOk = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function detectClients({ home, appdata, local, hasClaudeCli }) {
  let cdDir = path.join(appdata, 'Claude');
  try { const pk = fs.readdirSync(path.join(local, 'Packages')).find((n) => /^Claude_/i.test(n)); if (pk) { const q = path.join(local, 'Packages', pk, 'LocalCache', 'Roaming', 'Claude'); if (dirOk(q)) cdDir = q; } } catch {}   // Microsoft Store install
  return [
    { id: 'claude-desktop', name: 'Claude Desktop', how: 'file', key: 'mcpServers', file: path.join(cdDir, 'claude_desktop_config.json'), found: dirOk(cdDir) || dirOk(path.join(local, 'AnthropicClaude')) || dirOk(path.join(local, 'Programs', 'Claude')), restart: 'Quit Claude Desktop completely (right-click its tray icon, then Quit) and open it again.' },
    { id: 'claude-code', name: 'Claude Code', how: 'cli', found: !!hasClaudeCli, restart: 'Start a new Claude Code session.' },
    { id: 'cursor', name: 'Cursor', how: 'file', key: 'mcpServers', file: path.join(home, '.cursor', 'mcp.json'), found: dirOk(path.join(home, '.cursor')), restart: 'Restart Cursor.' },
    { id: 'vscode', name: 'VS Code (Copilot agent mode)', how: 'file', key: 'servers', typed: true, file: path.join(appdata, 'Code', 'User', 'mcp.json'), found: dirOk(path.join(appdata, 'Code', 'User')), restart: 'Restart VS Code, then use Copilot Chat in Agent mode.' }
  ];
}

// Adds (or refreshes) the "bryt-shell" entry. A file that is not valid JSON is never overwritten. A backup is kept next to it.
function connectFile(c, entry) {
  let cfg = {}, raw = '';
  try { raw = fs.readFileSync(c.file, 'utf8').replace(/^\ufeff/, ''); } catch {}
  if (raw.trim()) { try { cfg = JSON.parse(raw); } catch { return { ok: false, error: 'The settings file of ' + c.name + ' is not valid JSON, so Bryt Shell left it alone: ' + c.file }; } }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, error: 'Unexpected settings file, left alone: ' + c.file };
  try {
    if (raw.trim()) fs.copyFileSync(c.file, c.file + '.bryt-backup');
    fs.mkdirSync(path.dirname(c.file), { recursive: true });
    cfg[c.key] = cfg[c.key] && typeof cfg[c.key] === 'object' ? cfg[c.key] : {};
    cfg[c.key]['bryt-shell'] = c.typed ? { type: 'stdio', ...entry } : entry;      // other servers you already have stay untouched
    fs.writeFileSync(c.file, JSON.stringify(cfg, null, 2));
  } catch (err) { return { ok: false, error: 'Could not write ' + c.file + ': ' + err.message }; }
  return { ok: true, file: c.file, restart: c.restart };
}
// Is Bryt Shell already in this app's settings, and is the entry still the right one (the app may have moved or been reinstalled)?
function readEntry(c) {
  if (c.how !== 'file') return null;
  try { const cfg = JSON.parse(fs.readFileSync(c.file, 'utf8').replace(/^\ufeff/, '')); const e = cfg && cfg[c.key] && cfg[c.key]['bryt-shell']; return e && typeof e === 'object' ? e : null; } catch { return null; }
}
const sameEntry = (a, b) => !!a && !!b && a.command === b.command && JSON.stringify(a.args || []) === JSON.stringify(b.args || []) && JSON.stringify(a.env || {}) === JSON.stringify(b.env || {});
const isConnected = (c) => !!readEntry(c);
// After an update or a move, quietly point an existing entry at the current Bryt Shell. Never creates one, never touches other servers.
function heal(c, entry) { const e = readEntry(c); return !!e && !sameEntry(e, entry) && connectFile(c, entry).ok; }
module.exports = { detectClients, connectFile, readEntry, isConnected, heal, sameEntry };
