const fs = require('fs');
const path = require('path');

function saveLoadOrder(gamePath, activeModFilenames) {
  const dataDir = path.join(gamePath, 'data');
  const cfgPath = path.join(dataDir, 'mods.cfg');
  const backupPath = path.join(dataDir, 'mods.cfg.backup');

  if (!fs.existsSync(dataDir)) {
    return { success: false, error: 'Kenshi data directory not found: ' + dataDir };
  }

  try {
    // Backup existing mods.cfg
    if (fs.existsSync(cfgPath)) {
      fs.copyFileSync(cfgPath, backupPath);
    }

    // Write new load order
    const content = activeModFilenames.join('\r\n');
    fs.writeFileSync(cfgPath, content, 'utf8');

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { saveLoadOrder };
