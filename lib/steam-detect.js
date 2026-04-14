const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const KENSHI_APP_ID = '233860';
const IS_LINUX = process.platform === 'linux';
const IS_WIN = process.platform === 'win32';

// Windows defaults
const DEFAULT_STEAM_PATH_WIN = 'C:\\Program Files (x86)\\Steam';
const STEAM_REGISTRY_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam';

// Linux defaults
const HOME = os.homedir();
const LINUX_STEAM_PATHS = [
  path.join(HOME, '.steam', 'steam'),
  path.join(HOME, '.local', 'share', 'Steam'),
  path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'steam'), // Flatpak
  path.join(HOME, 'snap', 'steam', 'common', '.steam', 'steam'), // Snap
];

/**
 * Try to find the Steam install path from the Windows registry.
 */
function getSteamPathFromRegistry() {
  if (!IS_WIN) return null;
  try {
    const output = execSync(
      `reg query "${STEAM_REGISTRY_KEY}" /v InstallPath`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const match = output.match(/InstallPath\s+REG_SZ\s+(.+)/);
    if (match) return match[1].trim();
  } catch {
    // Registry key not found
  }
  return null;
}

/**
 * Find Steam install path on Linux.
 */
function getSteamPathLinux() {
  for (const p of LINUX_STEAM_PATHS) {
    if (fs.existsSync(path.join(p, 'steamapps'))) {
      return p;
    }
  }
  return null;
}

/**
 * Parse Steam's libraryfolders.vdf to find all Steam library paths.
 * Returns an array of library root paths.
 */
function parseLibraryFolders(vdfPath) {
  if (!fs.existsSync(vdfPath)) return [];

  const content = fs.readFileSync(vdfPath, 'utf8');
  const libraries = [];

  // Match numbered entries with their "path" values
  const blockRegex = /"\d+"\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const block = blockMatch[1];

    // Extract path
    const pathMatch = block.match(/"path"\s+"([^"]+)"/);
    if (!pathMatch) continue;

    const libPath = pathMatch[1].replace(/\\\\/g, IS_WIN ? '\\' : '/');
    libraries.push(libPath);
  }

  return libraries;
}

/**
 * Auto-detect Kenshi game path and Steam workshop path.
 * Returns { gamePath, steamModsPath } or null if not found.
 */
function detectKenshiPaths() {
  // Step 1: Find Steam installation
  let steamPath = IS_WIN ? getSteamPathFromRegistry() : getSteamPathLinux();

  if (!steamPath || !fs.existsSync(steamPath)) {
    if (IS_WIN && fs.existsSync(DEFAULT_STEAM_PATH_WIN)) {
      steamPath = DEFAULT_STEAM_PATH_WIN;
    } else if (IS_LINUX) {
      steamPath = getSteamPathLinux();
    }
    if (!steamPath) {
      // No Steam found, try GOG
      return detectGogPaths();
    }
  }

  // Step 2: Parse libraryfolders.vdf to find all library locations
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  let libraries = parseLibraryFolders(vdfPath);

  // Always include the main Steam path as a library
  if (!libraries.includes(steamPath)) {
    libraries.unshift(steamPath);
  }

  // Step 3: Search each library for Kenshi (app 233860)
  for (const libPath of libraries) {
    const manifestPath = path.join(libPath, 'steamapps', `appmanifest_${KENSHI_APP_ID}.acf`);
    const gamePath = path.join(libPath, 'steamapps', 'common', 'Kenshi');
    const workshopPath = path.join(libPath, 'steamapps', 'workshop', 'content', KENSHI_APP_ID);

    if (fs.existsSync(manifestPath) || fs.existsSync(gamePath)) {
      return {
        gamePath: fs.existsSync(gamePath) ? gamePath : null,
        steamModsPath: fs.existsSync(workshopPath) ? workshopPath : '',
      };
    }
  }

  // Step 4: Last resort — check default paths directly
  const defaultGame = path.join(steamPath, 'steamapps', 'common', 'Kenshi');
  const defaultWorkshop = path.join(steamPath, 'steamapps', 'workshop', 'content', KENSHI_APP_ID);

  if (fs.existsSync(defaultGame)) {
    return {
      gamePath: defaultGame,
      steamModsPath: fs.existsSync(defaultWorkshop) ? defaultWorkshop : '',
    };
  }

  // Step 5: Try GOG paths
  return detectGogPaths();
}

/**
 * Try to find Kenshi installed via GOG Galaxy or standalone GOG installer.
 */
function detectGogPaths() {
  if (IS_WIN) return detectGogPathsWindows();
  if (IS_LINUX) return detectGogPathsLinux();
  return null;
}

function detectGogPathsWindows() {
  // Check GOG Galaxy registry for Kenshi (GOG game ID: 1193046833)
  const GOG_KENSHI_ID = '1193046833';
  try {
    const output = execSync(
      `reg query "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${GOG_KENSHI_ID}" /v path`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const match = output.match(/path\s+REG_SZ\s+(.+)/);
    if (match) {
      const gogPath = match[1].trim();
      if (fs.existsSync(gogPath)) {
        return { gamePath: gogPath, steamModsPath: '' };
      }
    }
  } catch {
    // GOG Galaxy not installed or Kenshi not registered
  }

  // Check common GOG / game install locations across all drives
  const drives = [];
  for (let i = 67; i <= 90; i++) { // C-Z
    const drive = String.fromCharCode(i) + ':';
    try {
      fs.accessSync(drive + '\\');
      drives.push(drive);
    } catch {
      // Drive doesn't exist
    }
  }

  const commonPaths = [
    'GOG Games\\Kenshi',
    'GOG\\Kenshi',
    'Games\\Kenshi',
    'Program Files\\Kenshi',
    'Program Files (x86)\\Kenshi',
    'Program Files (x86)\\GOG Galaxy\\Games\\Kenshi',
    'Program Files\\GOG Galaxy\\Games\\Kenshi',
  ];

  for (const drive of drives) {
    for (const relPath of commonPaths) {
      const fullPath = path.join(drive + '\\', relPath);
      if (isKenshiFolder(fullPath)) {
        return { gamePath: fullPath, steamModsPath: '' };
      }
    }
  }

  return null;
}

function detectGogPathsLinux() {
  const commonPaths = [
    path.join(HOME, 'GOG Games', 'Kenshi'),
    path.join(HOME, 'Games', 'Kenshi'),
    path.join(HOME, 'games', 'Kenshi'),
    path.join(HOME, 'games', 'kenshi'),
    path.join(HOME, '.local', 'share', 'GOG', 'Kenshi'),
    '/opt/GOG Games/Kenshi',
    '/opt/games/Kenshi',
  ];

  // Also check Lutris/Wine prefixes
  const lutrisPath = path.join(HOME, 'Games');
  if (fs.existsSync(lutrisPath)) {
    try {
      const dirs = fs.readdirSync(lutrisPath, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.toLowerCase().includes('kenshi')) {
          const fullPath = path.join(lutrisPath, d.name);
          if (isKenshiFolder(fullPath)) {
            return { gamePath: fullPath, steamModsPath: '' };
          }
        }
      }
    } catch { /* ignore */ }
  }

  for (const p of commonPaths) {
    if (isKenshiFolder(p)) {
      return { gamePath: p, steamModsPath: '' };
    }
  }

  return null;
}

/**
 * Check if a folder looks like a Kenshi installation.
 * On Linux, Kenshi runs via Proton/Wine so the exe names are the same.
 */
function isKenshiFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return false;
  const hasData = fs.existsSync(path.join(folderPath, 'data'));
  // Check for exe (even on Linux, Proton/Wine games have .exe files)
  const hasExe = fs.existsSync(path.join(folderPath, 'kenshi_x64.exe'))
    || fs.existsSync(path.join(folderPath, 'kenshi_GOG_x64.exe'))
    || fs.existsSync(path.join(folderPath, 'kenshi.exe'));
  return hasData && hasExe;
}

module.exports = { detectKenshiPaths };
