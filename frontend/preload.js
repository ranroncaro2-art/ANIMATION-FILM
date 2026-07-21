const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMacAddress: () => ipcRenderer.invoke('get-mac-address'),
  verifyLogin: (payload) => ipcRenderer.invoke('verify-login', payload),
  sendWindowAction: (action) => ipcRenderer.send('window-action', action)
});
