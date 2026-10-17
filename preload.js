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
  onRestored: (cb) => ipcRenderer.on('restored', (_, ok) => cb(ok))
});
