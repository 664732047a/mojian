const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name, ...args) => ipcRenderer.invoke(`mojian:${name}`, ...args);
const pendingOpenFiles = [];
const openFileSubscribers = new Set();
ipcRenderer.on('mojian:open-file', (_event, document) => {
  if (!openFileSubscribers.size) pendingOpenFiles.push(document);
  else for (const callback of openFileSubscribers) callback(document);
});
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(`mojian:${channel}`, listener);
  return () => ipcRenderer.removeListener(`mojian:${channel}`, listener);
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  openFile: () => invoke('open-file'),
  openFolder: () => invoke('open-folder'),
  readFile: path => invoke('read-file', path),
  saveFile: options => invoke('save-file', options),
  listFolder: path => invoke('list-folder', path),
  watchFolder: path => invoke('watch-folder', path),
  unwatchFolder: path => invoke('unwatch-folder', path),
  createFile: options => invoke('create-file', options),
  getSettings: () => invoke('get-settings'),
  saveSettings: patch => invoke('save-settings', patch),
  getRecentFiles: () => invoke('get-recent-files'),
  exportFile: options => invoke('export-file', options),
  pickImages: options => invoke('pick-images', options),
  saveImage: options => invoke('save-image', options),
  assetUrl: path => `mojian-file://local/?path=${encodeURIComponent(path)}`,
  resolveAsset: options => invoke('resolve-asset', options),
  revealInFinder: path => invoke('reveal-in-finder', path),
  openExternal: url => invoke('open-external', url),
  getRecovery: () => invoke('get-recovery'),
  saveRecovery: documents => invoke('save-recovery', documents),
  clearRecovery: () => invoke('clear-recovery'),
  getVersions: path => invoke('get-versions', path),
  restoreVersion: options => invoke('restore-version', options),
  confirmClose: () => ipcRenderer.send('mojian:confirm-close'),
  cancelClose: () => ipcRenderer.send('mojian:cancel-close'),
  onMenu: callback => subscribe('menu', callback),
  onOpenFile: callback => {
    openFileSubscribers.add(callback);
    for (const document of pendingOpenFiles.splice(0)) callback(document);
    return () => openFileSubscribers.delete(callback);
  },
  onFolderChanged: callback => subscribe('folder-changed', callback),
  onExternalChange: callback => subscribe('external-change', callback),
});
