const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onMetrics: (cb) => ipcRenderer.on('metrics', (_e, data) => cb(data)),
  onCollectorError: (cb) => ipcRenderer.on('collector-error', (_e, msg) => cb(msg)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, config) => cb(config)),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.send('config:set', patch),
  resize: (height) => ipcRenderer.send('widget:resize', height),
  openSettings: () => ipcRenderer.send('settings:open'),
  resetPosition: () => ipcRenderer.send('widget:reset-position'),
  toggleExpand: () => ipcRenderer.send('widget:toggle-expand'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, state) => cb(state)),
  checkUpdate: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
});
