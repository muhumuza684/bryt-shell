const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
const send = (c) => (...a) => ipcRenderer.send(c, ...a);
contextBridge.exposeInMainWorld('api', {
  list: inv('tabs:list'), create: inv('tabs:create'), rename: inv('tabs:rename'),
  startup: inv('tabs:startup'), del: inv('tabs:delete'),
  attach: inv('pty:attach'), ensure: inv('pty:ensure'),
  write: send('pty:write'), resize: send('pty:resize'),
  clearLog: inv('log:clear'), exportLog: inv('log:export'), info: inv('app:info'), admin: inv('app:admin'),
  autostart: inv('app:autostart'), sysinfo: inv('app:sysinfo'), openExternal: inv('app:openExternal'), setMode: inv('app:setMode'), resetClose: inv('app:resetClose'), quitAll: inv('app:quitAll'), restartApp: inv('app:restart'), setBg: send('app:setBg'),
  onData: (cb) => ipcRenderer.on('data', (_, id, d) => cb(id, d)),
  onExit: (cb) => ipcRenderer.on('exit', (_, id) => cb(id)),
  states: inv('life:states'), openRecipes: inv('life:recipes'),
  onState: (cb) => ipcRenderer.on('state', (_, id, st) => cb(id, st)),
  onNotice: (cb) => ipcRenderer.on('notice', (_, m) => cb(m)),
  onRestored: (cb) => ipcRenderer.on('restored', (_, ok) => cb(ok)),
  aiGet: inv('ai:get'), aiSet: inv('ai:set'), aiConfig: inv('ai:config'), aiAudit: inv('ai:audit'), aiLog: inv('ai:log'), aiAnswer: inv('ai:answer'), aiAccessSet: inv('ai:access-set'), aiAccessPreset: inv('ai:access-preset'), aiStop: inv('ai:stop'), aiTrustAdd: inv('ai:trust-add'), aiTrustRemove: inv('ai:trust-remove'),
  inboxGet: inv('inbox:get'), inboxFolder: inv('inbox:folder'), inboxName: inv('inbox:name'), inboxPreview: inv('inbox:preview'), inboxDismiss: inv('inbox:dismiss'), onInbox: (cb) => ipcRenderer.on('inbox', (_, q) => cb(q)),
  liveGet: inv('live:get'), liveSetRelay: inv('live:set-relay'), liveShareStart: inv('live:share-start'), liveShareStop: inv('live:share-stop'), liveWatch: inv('live:watch'), liveUnwatch: inv('live:unwatch'), onLive: (cb) => ipcRenderer.on('live', (_, m) => cb(m)),
  pkgSend: inv('pkg:send'), pkgOpen: inv('pkg:open'), pkgImport: inv('pkg:import'), pkgReveal: inv('pkg:reveal'),
  onAiAsk: (cb) => ipcRenderer.on('aiask', (_, q) => cb(q)), onAiAskCancel: (cb) => ipcRenderer.on('aiaskcancel', (_, q) => cb(q)),
  aiClients: inv('ai:clients'), aiConnectAll: inv('ai:connect-all'), aiOfferNo: inv('ai:offer-no'), onAiOffer: (cb) => ipcRenderer.on('aioffer', (_, q) => cb(q)), aiConnect: inv('ai:connect'), aiCheck: inv('ai:check'),
  onTabs: (cb) => ipcRenderer.on('tabs', (_, list) => cb(list)),
  onAi: (cb) => ipcRenderer.on('ai', (_, s) => cb(s))
});
