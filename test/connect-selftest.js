// Self-test for the "Connect an AI app" journey: finding apps, merging settings safely, and the raw MCP handshake that
// "Check my setup" performs. Run:  node test/connect-selftest.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), { spawn } = require('child_process');
const { detectClients, connectFile } = require('../aiclients');
const { startAiApi } = require('../aiapi');
let n = 0; const ok = (m) => console.log('  ok', ++n, m);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bryt-conn-')), home = path.join(root, 'u'), appdata = path.join(home, 'AppData', 'Roaming'), local = path.join(home, 'AppData', 'Local');
fs.mkdirSync(appdata, { recursive: true }); fs.mkdirSync(local, { recursive: true });
const entry = { command: 'C:\\Bryt Shell\\Bryt Shell.exe', args: ['C:\\x\\bridge.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const find = (id, o = {}) => detectClients({ home, appdata, local, hasClaudeCli: false, ...o }).find((c) => c.id === id);

assert(!find('claude-desktop').found && !find('cursor').found && !find('vscode').found && !find('claude-code').found); ok('nothing installed: nothing found');
fs.mkdirSync(path.join(appdata, 'Claude'), { recursive: true }); assert(find('claude-desktop').found); ok('Claude Desktop found (classic install)');
fs.mkdirSync(path.join(local, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude'), { recursive: true });
assert(find('claude-desktop').file.includes('Packages')); ok('Microsoft Store install path preferred when present');
assert(find('claude-code', { hasClaudeCli: true }).found); ok('Claude Code found when the CLI exists');

let c = find('claude-desktop'); fs.writeFileSync(c.file, '\ufeff' + JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
let r = connectFile(c, entry); assert(r.ok); let cfg = JSON.parse(fs.readFileSync(c.file, 'utf8'));
assert(cfg.theme === 'dark' && cfg.mcpServers.other.command === 'x' && cfg.mcpServers['bryt-shell'].command === entry.command); assert(fs.existsSync(c.file + '.bryt-backup')); ok('existing settings and servers kept, backup written, BOM tolerated');
r = connectFile(c, { ...entry, args: ['new.js'] }); cfg = JSON.parse(fs.readFileSync(c.file, 'utf8')); assert(r.ok && cfg.mcpServers['bryt-shell'].args[0] === 'new.js' && Object.keys(cfg.mcpServers).length === 2); ok('connecting again refreshes the entry (no duplicates)');
fs.writeFileSync(c.file, '{ broken json'); r = connectFile(c, entry); assert(!r.ok && fs.readFileSync(c.file, 'utf8') === '{ broken json'); ok('invalid JSON is never overwritten');
fs.writeFileSync(c.file, '[]'); assert(!connectFile(c, entry).ok); ok('unexpected file shape is left alone');
c = find('cursor'); fs.mkdirSync(path.dirname(c.file), { recursive: true }); r = connectFile(c, entry); assert(r.ok && JSON.parse(fs.readFileSync(c.file, 'utf8')).mcpServers['bryt-shell']); ok('Cursor: file created when it did not exist');
fs.mkdirSync(path.join(appdata, 'Code', 'User'), { recursive: true }); c = find('vscode'); r = connectFile(c, entry);
cfg = JSON.parse(fs.readFileSync(c.file, 'utf8')); assert(r.ok && cfg.servers['bryt-shell'].type === 'stdio' && !cfg.mcpServers); ok('VS Code: "servers" key with type stdio');

// already connected? stale after an update? healed quietly?
const { isConnected, heal, readEntry } = require('../aiclients');
c = find('claude-desktop'); assert(isConnected(find('vscode'))); ok('a connected app is recognised as connected (even when the app is not running)');
const cur = find('cursor'); fs.writeFileSync(cur.file, JSON.stringify({ mcpServers: { other: { command: 'x' } } })); assert(!isConnected(cur) && !heal(cur, entry) && !readEntry(cur)); ok('an app without Bryt Shell is not connected, and healing never adds an entry on its own');
fs.writeFileSync(c.file, JSON.stringify({ mcpServers: { other: { command: 'x' }, 'bryt-shell': { command: 'D:\\old\\electron.exe', args: ['old.js'], env: {} } } }));
assert(heal(c, entry) === true); let hc = JSON.parse(fs.readFileSync(c.file, 'utf8')); assert(hc.mcpServers['bryt-shell'].command === entry.command && hc.mcpServers.other.command === 'x'); ok('a stale entry (app moved or reinstalled) is quietly pointed at the current Bryt Shell, other servers untouched');
assert(heal(c, entry) === false); ok('an up-to-date entry is left alone (no rewrite)');
fs.writeFileSync(c.file, '{ broken'); assert(!heal(c, entry) && fs.readFileSync(c.file, 'utf8') === '{ broken'); ok('healing never touches a file it cannot read');

// the same raw handshake "Check my setup" performs against the real bridge
const dir = path.join(root, 'user'), logDir = path.join(dir, 'logs'); fs.mkdirSync(logDir, { recursive: true });
const api = startAiApi({ profile: 'user', dir, root, version: 't', home, shell: 'sh', logDir, states: {}, getSettings: () => ({ ai: {} }), getTabs: () => [{ id: 'a', title: 'one', cwd: home }], saveTabs() {}, newTab() {}, notifyTabs() {}, ensure: async () => {}, write() {}, flush() {}, removeTab: async () => {}, askUser: async () => true });
const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'bryt-shell-mcp.js')], { env: { ...process.env, BRYT_AI_PIPE: api.pipe, BRYT_AI_TOKEN_FILE: api.tokenFile } });
let out = '', step = 0; const send = (m) => child.stdin.write(JSON.stringify(m) + '\n'); let tools = 0;
const tm = setTimeout(() => { console.error('TIMEOUT in handshake'); process.exit(1); }, 15000);
child.stdout.on('data', (d) => { out += d; let i; while ((i = out.indexOf('\n')) >= 0) { const m = JSON.parse(out.slice(0, i)); out = out.slice(i + 1);
  if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); }
  else if (m.id === 2) { tools = m.result.tools.length; send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_tabs', arguments: {} } }); }
  else if (m.id === 3) { assert(!m.result.isError && /one/.test(m.result.content[0].text) && tools === 19); ok('raw MCP handshake works: ' + tools + ' tools, list_tabs answered'); clearTimeout(tm); child.kill(); api.stop(); console.log('\nAll ' + n + ' checks passed'); process.exit(0); } } });
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '1' } } });
