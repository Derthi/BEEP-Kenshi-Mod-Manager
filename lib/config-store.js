const fs = require('fs');
const path = require('path');

const CONFIG_NAME = 'config.json';

function getConfigPath(userDataPath) {
  return path.join(userDataPath, CONFIG_NAME);
}

function loadConfig(userDataPath) {
  const configPath = getConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate old configs without category data
    if (!config.categories) config.categories = [];
    if (!config.modCategories) config.modCategories = {};
    if (!config.modOrders) config.modOrders = {};
    return config;
  } catch {
    return null;
  }
}

function saveConfig(userDataPath, config) {
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(userDataPath), JSON.stringify(config, null, 2), 'utf8');
}

// ===== Mod Packs =====

const PACKS_DIR = 'modpacks';

function getPacksDir(userDataPath) {
  return path.join(userDataPath, PACKS_DIR);
}

function loadPacks(userDataPath) {
  const dir = getPacksDir(userDataPath);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return data;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function savePack(userDataPath, pack) {
  const dir = getPacksDir(userDataPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeName = pack.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.writeFileSync(path.join(dir, safeName + '.json'), JSON.stringify(pack, null, 2), 'utf8');
}

function deletePack(userDataPath, packName) {
  const dir = getPacksDir(userDataPath);
  const safeName = packName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(dir, safeName + '.json');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { loadConfig, saveConfig, loadPacks, savePack, deletePack };
