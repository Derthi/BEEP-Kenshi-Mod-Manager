const fs = require('fs');
const path = require('path');
const { parseModFile } = require('./mod-parser');

function readModsCfg(gamePath) {
  const cfgPath = path.join(gamePath, 'data', 'mods.cfg');
  if (!fs.existsSync(cfgPath)) return [];
  try {
    return fs.readFileSync(cfgPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scanFolder(folderPath, activeMods, source) {
  const mods = [];
  if (!fs.existsSync(folderPath)) return mods;

  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return mods;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(folderPath, entry.name);

    // Skip symlinks
    try {
      if (fs.lstatSync(dirPath).isSymbolicLink()) continue;
    } catch {
      continue;
    }

    // Find *.mod file
    let modFile = null;
    try {
      const files = fs.readdirSync(dirPath);
      modFile = files.find((f) => f.toLowerCase().endsWith('.mod'));
    } catch {
      continue;
    }

    if (!modFile) continue;

    const modFilePath = path.join(dirPath, modFile);
    const metadata = parseModFile(modFilePath);

    // Look for preview image: _ModName.img (PNG despite extension)
    const modBaseName = path.basename(modFile, path.extname(modFile));
    const imgFile = path.join(dirPath, `_${modBaseName}.img`);
    const imagePath = fs.existsSync(imgFile) ? imgFile : null;

    const filename = modFile;
    const orderIndex = activeMods.indexOf(filename);

    // Build workshop URL for Steam mods (folder name = workshop ID)
    let url = '';
    if (source === 'steam') {
      url = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + entry.name;
    } else {
      url = 'https://www.nexusmods.com/kenshi/search/?gsearch=' + encodeURIComponent(modBaseName);
    }

    mods.push({
      filename,
      displayName: modBaseName,
      filePath: modFilePath,
      imagePath,
      url,
      author: metadata?.author || '',
      description: metadata?.description || '',
      version: metadata?.version || 0,
      dependencies: metadata?.dependencies || [],
      references: metadata?.references || [],
      source,
      active: orderIndex >= 0,
      order: orderIndex,
    });
  }

  return mods;
}

function discoverMods(gamePath, steamModsPath) {
  const activeMods = readModsCfg(gamePath);

  const localPath = path.join(gamePath, 'Mods');
  const localMods = scanFolder(localPath, activeMods, 'local');

  let steamMods = [];
  if (steamModsPath && steamModsPath !== 'NONE') {
    steamMods = scanFolder(steamModsPath, activeMods, 'steam');
  }

  return [...localMods, ...steamMods];
}

module.exports = { discoverMods };
