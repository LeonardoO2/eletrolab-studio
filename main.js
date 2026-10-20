const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null, autoUpdater = null, manualCheck = false;

function logUpdate(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* sem log */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#10151d',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

function info(message, detail, type) {
  return dialog.showMessageBox(win, { type: type || 'info', buttons: ['OK'], title: 'EletroLab Studio', message, detail: detail || '' });
}

// Atualização automática (só no app instalado): consulta as versões publicadas no GitHub,
// baixa em segundo plano e pergunta se quer reiniciar para instalar.
function setupUpdates() {
  if (!app.isPackaged) { logUpdate('modo desenvolvimento: atualização desligada'); return; }
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { logUpdate('electron-updater indisponível: ' + e.message); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: m => logUpdate('info ' + m), warn: m => logUpdate('warn ' + m), error: m => logUpdate('erro ' + m), debug: () => {} };
  autoUpdater.on('checking-for-update', () => logUpdate('verificando… (versão atual ' + app.getVersion() + ')'));
  autoUpdater.on('update-available', i => {
    logUpdate('versão nova encontrada: ' + i.version);
    if (manualCheck) info('Versão ' + i.version + ' encontrada.', 'Baixando em segundo plano. Você será avisado quando terminar.');
  });
  autoUpdater.on('update-not-available', i => {
    logUpdate('sem versão nova (mais recente publicada: ' + (i && i.version) + ')');
    if (manualCheck) info('Você já está na versão mais recente.', 'Versão instalada: ' + app.getVersion() + '.');
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', i => {
    logUpdate('download concluído: ' + i.version);
    manualCheck = false;
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1,
      title: 'Atualização disponível', message: 'A versão ' + i.version + ' foi baixada.',
      detail: 'Reinicie para instalar. Se preferir, ela será instalada ao fechar o programa.'
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', e => {
    logUpdate('erro: ' + (e && e.message));
    if (manualCheck) info('Não foi possível verificar atualizações.', String((e && e.message) || e).slice(0, 400), 'error');
    manualCheck = false;
  });
  autoUpdater.checkForUpdates().catch(e => logUpdate('falha ao verificar: ' + e.message));
}

function checkNow() {
  if (!autoUpdater) {
    info('Atualização automática indisponível.', app.isPackaged ? 'O módulo de atualização não foi carregado.' : 'Só funciona no programa instalado (não em npm start).', 'warning');
    return;
  }
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(e => { logUpdate('falha ao verificar: ' + e.message); info('Não foi possível verificar atualizações.', e.message, 'error'); manualCheck = false; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { label: 'Ajuda', submenu: [
      { label: 'Verificar atualizações…', click: checkNow },
      { label: 'Abrir registro de atualização', click: () => { const f = path.join(app.getPath('userData'), 'update.log'); require('electron').shell.openPath(f); } },
      { type: 'separator' },
      { label: 'Sobre o EletroLab Studio', click: () => info('EletroLab Studio', 'Versão ' + app.getVersion() + '\nSimulador didático de comandos elétricos e CLP (Ladder).') }
    ] }
  ]));
}

ipcMain.handle('app-version', () => app.getVersion());
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  setupUpdates();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
