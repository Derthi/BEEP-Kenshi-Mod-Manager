const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const configStore = require('./lib/config-store');
const modDiscovery = require('./lib/mod-discovery');
const loadOrder = require('./lib/load-order');
const steamDetect = require('./lib/steam-detect');
const steamApi = require('./lib/steam-api');
const conflictDetector = require('./lib/conflict-detector');
const updater = require('./lib/updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// IPC Handlers

ipcMain.handle('get-config', () => {
  return configStore.loadConfig(app.getPath('userData'));
});

ipcMain.handle('save-config', (_event, config) => {
  configStore.saveConfig(app.getPath('userData'), config);
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('detect-steam', () => {
  return steamDetect.detectKenshiPaths();
});

ipcMain.handle('discover-mods', (_event, config) => {
  return modDiscovery.discoverMods(config.gamePath, config.steamModsPath);
});

ipcMain.handle('save-load-order', (_event, data) => {
  return loadOrder.saveLoadOrder(data.gamePath, data.activeModFilenames);
});

// Mod Packs
ipcMain.handle('get-packs', () => {
  return configStore.loadPacks(app.getPath('userData'));
});

ipcMain.handle('save-pack', (_event, pack) => {
  configStore.savePack(app.getPath('userData'), pack);
});

ipcMain.handle('delete-pack', (_event, packName) => {
  configStore.deletePack(app.getPath('userData'), packName);
});

// Steam API
ipcMain.handle('fetch-workshop-details', (_event, workshopIds) => {
  return steamApi.fetchWorkshopDetails(workshopIds);
});

// Save file dialog
ipcMain.handle('save-file-dialog', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('write-file', (_event, filePath, content) => {
  const fs = require('fs');
  fs.writeFileSync(filePath, content, 'utf8');
});

// Launch game
ipcMain.handle('launch-game', (_event, gamePath) => {
  const fs = require('fs');
  const { spawn } = require('child_process');
  const exePath = path.join(gamePath, 'kenshi_x64.exe');
  if (!fs.existsSync(exePath)) {
    // Try 32-bit fallback
    const exe32 = path.join(gamePath, 'kenshi_GOG_x64.exe');
    const exe32b = path.join(gamePath, 'kenshi.exe');
    const actual = fs.existsSync(exe32) ? exe32 : fs.existsSync(exe32b) ? exe32b : null;
    if (!actual) return { success: false, error: 'Could not find Kenshi executable in ' + gamePath };
    spawn(actual, [], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
    return { success: true };
  }
  spawn(exePath, [], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
  return { success: true };
});

// Conflict detection
ipcMain.handle('generate-conflicts', (_event, activeMods) => {
  return conflictDetector.detectConflicts(activeMods);
});

// Updater
ipcMain.handle('check-for-update', () => {
  return updater.checkForUpdate();
});

ipcMain.handle('download-update', async (_event, downloadUrl) => {
  const appPath = path.dirname(app.getPath('exe'));
  const result = await updater.downloadAndApplyUpdate(downloadUrl, appPath);
  if (result.success) {
    // Relaunch after a short delay
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 1000);
  }
  return result;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
