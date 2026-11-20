const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  readFileBase64: (filePath) => ipcRenderer.invoke('file:readBase64', filePath),
  downloadVideo: (params) => ipcRenderer.invoke('download:video', params),
  openFolder: (folderPath) => ipcRenderer.invoke('shell:openPath', folderPath),
  openDirectoryInExplorer: (folderPath) => ipcRenderer.invoke('shell:openPath', folderPath),
  saveProbeDump: (data) => ipcRenderer.invoke('debug:saveDump', data),
  logoutRunningHub: () => ipcRenderer.invoke('session:logout'),
  getLicenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAndInstallUpdate: (updateInfo) => ipcRenderer.invoke('updater:download-install', updateInfo),
  simulateUpdateTest: () => ipcRenderer.invoke('updater:simulate-test'),
  onUpdateAvailable: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('updater:new-version-available', handler);
    return () => ipcRenderer.removeListener('updater:new-version-available', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  }
});
