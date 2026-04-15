const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#18181e',
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

// Mod Packs — stored alongside the app for portability
const packsBasePath = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : __dirname;

ipcMain.handle('get-packs', () => {
  return configStore.loadPacks(packsBasePath);
});

ipcMain.handle('save-pack', (_event, pack) => {
  configStore.savePack(packsBasePath, pack);
});

ipcMain.handle('delete-pack', (_event, packName) => {
  configStore.deletePack(packsBasePath, packName);
});

// Steam API
ipcMain.handle('fetch-workshop-details', (_event, workshopIds) => {
  return steamApi.fetchWorkshopDetails(workshopIds);
});

// Mod database
ipcMain.handle('load-mod-database', () => {
  const fs = require('fs');
  // Look for database in app directory (portable)
  const basePath = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
  const dbPath = path.join(basePath, 'mod-database.json');
  if (!fs.existsSync(dbPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('save-mod-database', (_event, data) => {
  const fs = require('fs');
  const basePath = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
  const dbPath = path.join(basePath, 'mod-database.json');
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  return dbPath;
});

// Open file dialog
ipcMain.handle('open-file-dialog', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: filters || [{ name: 'Text Files', extensions: ['txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const fs = require('fs');
  return { path: result.filePaths[0], content: fs.readFileSync(result.filePaths[0], 'utf8') };
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

  // Find Kenshi executable
  const candidates = ['kenshi_x64.exe', 'kenshi_GOG_x64.exe', 'kenshi.exe'];
  let exePath = null;
  for (const name of candidates) {
    const p = path.join(gamePath, name);
    if (fs.existsSync(p)) { exePath = p; break; }
  }
  if (!exePath) {
    return { success: false, error: 'Could not find Kenshi executable in ' + gamePath };
  }

  if (process.platform === 'linux') {
    // On Linux, launch via Steam (Proton) or directly with Wine
    const steamRunUrl = `steam://rungameid/233860`;
    const { exec } = require('child_process');
    // Try Steam first, fall back to xdg-open
    exec(`xdg-open "${steamRunUrl}"`, { timeout: 5000 }, (err) => {
      if (err) {
        // Fallback: try running the exe directly (may work under Wine/Proton)
        spawn('wine', [exePath], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
      }
    });
  } else {
    spawn(exePath, [], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
  }
  return { success: true };
});

// Launch FCS
ipcMain.handle('launch-fcs', (_event, gamePath) => {
  const fs = require('fs');
  const { spawn } = require('child_process');

  const fcsPath = path.join(gamePath, 'forgotten construction set.exe');
  if (!fs.existsSync(fcsPath)) {
    return { success: false, error: 'Could not find "forgotten construction set.exe" in ' + gamePath };
  }

  if (process.platform === 'linux') {
    const { exec } = require('child_process');
    // Try Steam launch first (FCS app ID 285220), fall back to Wine
    exec(`xdg-open "steam://rungameid/285220"`, { timeout: 5000 }, (err) => {
      if (err) {
        spawn('wine', [fcsPath], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
      }
    });
  } else {
    spawn(fcsPath, [], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
  }
  return { success: true };
});

// Conflict detection
ipcMain.handle('generate-conflicts', (_event, activeMods, gamePath) => {
  return conflictDetector.detectConflicts(activeMods, gamePath);
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

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Relaunch the app with admin privileges
ipcMain.handle('relaunch-as-admin', () => {
  const { spawn } = require('child_process');
  const exePath = app.isPackaged ? app.getPath('exe') : process.argv[0];
  const psArgs = [
    '-Command',
    `Start-Process -FilePath "${exePath}" -Verb RunAs`
  ];
  const child = spawn('powershell.exe', psArgs, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {}); // ignore spawn errors
  // Give PowerShell a moment to launch the UAC prompt before quitting
  setTimeout(() => app.quit(), 500);
});

// Symlink management for Steam mods → game Mods folder
// Uses mod filename (without .mod extension) as the link folder name,
// matching how the old Kenshi Mod Manager worked and how FCS expects it.

function getModLinkName(modFilename) {
  // "TameBeasties.mod" → "TameBeasties"
  return path.parse(modFilename).name;
}

ipcMain.handle('check-mod-links', (_event, { gamePath, steamMods }) => {
  const fs = require('fs');
  const linkedMods = [];
  for (const mod of steamMods) {
    const linkPath = path.join(gamePath, 'Mods', getModLinkName(mod.filename));
    try {
      if (fs.lstatSync(linkPath).isSymbolicLink()) {
        linkedMods.push(mod.filename);
      }
    } catch {
      // Path doesn't exist — not linked
    }
  }
  return { linkedMods };
});

ipcMain.handle('create-mod-links', (_event, { gamePath, mods }) => {
  const fs = require('fs');
  const modsDir = path.join(gamePath, 'Mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

  const created = [];
  const skipped = [];
  const errors = [];

  for (const mod of mods) {
    const workshopDir = path.dirname(mod.filePath);
    const linkName = getModLinkName(mod.filename);
    const linkPath = path.join(modsDir, linkName);
    try {
      if (fs.existsSync(linkPath)) {
        skipped.push(mod.filename);
        continue;
      }
      // Use 'dir' symlinks (same as old Kenshi Mod Manager) — works with FCS.
      // On Windows this requires admin privileges.
      // On Linux, regular symlinks work without special privileges.
      fs.symlinkSync(workshopDir, linkPath, 'dir');
      created.push(mod.filename);
    } catch (err) {
      if (err.code === 'EPERM' && process.platform === 'win32') {
        return { created, skipped, errors, needsAdmin: true };
      }
      errors.push({ filename: mod.filename, error: err.message });
    }
  }
  return { created, skipped, errors, needsAdmin: false };
});

ipcMain.handle('remove-mod-links', (_event, { gamePath, mods }) => {
  const fs = require('fs');
  const modsDir = path.join(gamePath, 'Mods');
  const removed = [];
  const skipped = [];
  const errors = [];

  for (const mod of mods) {
    const linkName = getModLinkName(mod.filename);
    const linkPath = path.join(modsDir, linkName);
    try {
      const stat = fs.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        skipped.push(mod.filename);
        continue;
      }
      if (process.platform === 'win32') {
        fs.rmSync(linkPath);
      } else {
        fs.unlinkSync(linkPath);
      }
      removed.push(mod.filename);
    } catch (err) {
      if (err.code === 'ENOENT') {
        skipped.push(mod.filename);
      } else {
        errors.push({ filename: mod.filename, error: err.message });
      }
    }
  }
  return { removed, skipped, errors };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
