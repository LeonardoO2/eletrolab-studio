const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#10151d',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

// Atualização automática (só no app instalado): consulta as versões publicadas no GitHub,
// baixa em segundo plano e pergunta se quer reiniciar para instalar.
function setupUpdates(win) {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1,
      title: 'Atualização disponível', message: 'A versão ' + info.version + ' foi baixada.',
      detail: 'Reinicie para instalar. Se preferir, ela será instalada ao fechar o programa.'
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', e => console.error('Atualização:', e && e.message));
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  const win = createWindow();
  setupUpdates(win);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) setupUpdates(createWindow()); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
