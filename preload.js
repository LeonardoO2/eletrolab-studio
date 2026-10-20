// Expõe só a versão do programa para a interface (contextIsolation ligado, sem acesso ao Node).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', { version: () => ipcRenderer.invoke('app-version') });
