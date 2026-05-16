const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  signalingUrl: process.env.SIGNALING_URL || 'https://your-signaling-server.com',

  getDesktopSources: (opts) => ipcRenderer.invoke('get-desktop-sources', opts),

  simulateInput: (data) => ipcRenderer.invoke('simulate-input', data),
});
