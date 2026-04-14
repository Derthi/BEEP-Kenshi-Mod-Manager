const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KENSHI_APP_ID = '233860';
const DEFAULT_STEAM_PATH = 'C:\\Program Files (x86)\\Steam';
const STEAM_REGISTRY_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam';

/**
 * Try to find the Steam install path from the Windows registry.
 */
function getSteamPathFromRegistry() {
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
 * Parse Steam's libraryfolders.vdf to find all Steam library paths.
 * Returns an array of library root paths.
 */
function parseLibraryFolders(vdfPath) {
  if (!fs.existsSync(vdfPath)) return [];

  const content = fs.readFileSync(vdfPath, 'utf8');
  const libraries = [];

  // Match numbered entries with their "path" values
  // Format: "0" { "path" "C:\\..." ... "apps" { "233860" "..." } }
  const blockRegex = /"\d+"\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const block = blockMatch[1];

    // Extract path
    const pathMatch = block.match(/"path"\s+"([^"]+)"/);
    if (!pathMatch) continue;

    const libPath = pathMatch[1].replace(/\\\\/g, '\\');
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
  let steamPath = getSteamPathFromRegistry();

  if (!steamPath || !fs.existsSync(steamPath)) {
    // Fallback to default location
    if (fs.existsSync(DEFAULT_STEAM_PATH)) {
      steamPath = DEFAULT_STEAM_PATH;
    } else {
      return null;
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
    // Check if Kenshi's appmanifest exists (proves the game is in this library)
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
 * Checks GOG Galaxy registry, common GOG paths, and common game directories.
 */
function detectGogPaths() {
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

/**
 * Check if a folder looks like a Kenshi installation.
 */
function isKenshiFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return false;
  // Kenshi has a 'data' folder and typically kenshi_x64.exe or kenshi.exe
  const hasData = fs.existsSync(path.join(folderPath, 'data'));
  const hasExe = fs.existsSync(path.join(folderPath, 'kenshi_x64.exe'))
    || fs.existsSync(path.join(folderPath, 'kenshi_GOG_x64.exe'))
    || fs.existsSync(path.join(folderPath, 'kenshi.exe'));
  return hasData && hasExe;
}

module.exports = { detectKenshiPaths };
