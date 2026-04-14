const { parseModData, parseLevelData } = require('./mod-data-parser');
const { parseFcsDef } = require('./fcs-parser');
const path = require('path');
const fs = require('fs');

/**
 * Recursively collect all asset files in a directory.
 * Returns array of relative paths from the root dir.
 */
function walkDir(dir, rootDir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, rootDir));
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      // Skip .mod files and preview images
      if (lower.endsWith('.mod') || lower.endsWith('.img')) continue;
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Detect conflicts across all active mods (data + asset).
 *
 * @param {Array} activeMods - array of { filename, filePath } objects, in load order
 * @returns {{ modConflicts: Object, totalConflicts: number }}
 *   modConflicts: { filename: [ { type, name, key, otherMods, winner } ] }
 *   totalConflicts: number of unique conflicting item+property combos
 */
function detectConflicts(activeMods, gamePath) {
  // Load FCS definitions for property descriptions
  let fcsDef = null;
  if (gamePath) {
    fcsDef = parseFcsDef(gamePath);
  }

  // Phase 1: Parse all mods and collect what each touches
  const modTouches = {}; // filename -> Set of hash keys
  const hashToMods = {}; // hash -> [{ filename, type, name, key, value }]
  const parseErrors = [];

  for (const mod of activeMods) {
    const touches = parseModData(mod.filePath);
    if (!touches) {
      parseErrors.push(mod.filename);
      continue;
    }

    const seen = new Set();
    for (const t of touches) {
      const hash = `${t.type}|${t.name}|${t.key}`;
      if (seen.has(hash)) continue; // dedupe within same mod
      seen.add(hash);

      if (!hashToMods[hash]) hashToMods[hash] = [];
      hashToMods[hash].push({
        filename: mod.filename,
        type: t.type,
        name: t.name,
        key: t.key,
        value: t.value,
      });
    }

    modTouches[mod.filename] = seen;
  }

  // Phase 2: Find data conflicts (hashes with 2+ mods)
  const modConflicts = {};
  let totalConflicts = 0;

  for (const [hash, entries] of Object.entries(hashToMods)) {
    if (entries.length < 2) continue;

    // Skip if all mods set the same value (not a real conflict)
    const vals = entries.map((e) => e.value).filter((v) => v !== undefined);
    if (vals.length > 1 && vals.every((v) => v === vals[0])) continue;

    totalConflicts++;

    const { type, name, key } = entries[0];

    // Build ordered list with load positions, sorted by load order
    const modsInOrder = entries.map((e) => ({
      filename: e.filename,
      loadOrder: activeMods.findIndex((m) => m.filename === e.filename) + 1,
    })).sort((a, b) => a.loadOrder - b.loadOrder);

    // Winner is always the mod with the highest load order number
    const winner = modsInOrder[modsInOrder.length - 1].filename;

    // Build values map: { modFilename -> value }
    const values = {};
    for (const e of entries) {
      if (e.value !== undefined) values[e.filename] = e.value;
    }

    // Look up property description from fcs.def
    let keyDesc = '';
    if (fcsDef && fcsDef.types[type]) {
      const propInfo = fcsDef.types[type][key];
      if (propInfo && propInfo.description) {
        keyDesc = propInfo.description;
      }
    }

    for (const entry of entries) {
      if (!modConflicts[entry.filename]) modConflicts[entry.filename] = [];
      modConflicts[entry.filename].push({
        type,
        name,
        key,
        keyDesc,
        allMods: modsInOrder,
        winner,
        values,
      });
    }
  }

  // Phase 3: Scan mod directories for asset files and .level data files
  const assetToMods = {}; // relativePath -> [{ filename }]
  const levelFiles = [];  // [{ modFilename, filePath, relPath }]

  for (const mod of activeMods) {
    const modDir = path.dirname(mod.filePath);
    const assets = walkDir(modDir, modDir);
    for (const relPath of assets) {
      const lowerPath = relPath.toLowerCase();
      if (lowerPath.endsWith('.level')) {
        // Collect .level files for deep parsing in Phase 4
        levelFiles.push({
          modFilename: mod.filename,
          filePath: path.join(modDir, relPath),
          relPath,
        });
      } else if (lowerPath.endsWith('.zone')) {
        // Skip zone files — foliage data, merged by engine, not real conflicts
        continue;
      } else {
        // Regular asset file — track for file-level conflicts
        if (!assetToMods[lowerPath]) assetToMods[lowerPath] = [];
        assetToMods[lowerPath].push({ filename: mod.filename, relPath });
      }
    }
  }

  // Asset file conflicts (meshes, textures, sounds, etc.)
  for (const [lowerPath, entries] of Object.entries(assetToMods)) {
    if (entries.length < 2) continue;
    totalConflicts++;

    const relPath = entries[0].relPath;
    const folder = path.dirname(relPath) || '.';
    const file = path.basename(relPath);

    const modsInOrder = entries.map((e) => ({
      filename: e.filename,
      loadOrder: activeMods.findIndex((m) => m.filename === e.filename) + 1,
    })).sort((a, b) => a.loadOrder - b.loadOrder);

    const winner = modsInOrder[modsInOrder.length - 1].filename;

    for (const entry of entries) {
      if (!modConflicts[entry.filename]) modConflicts[entry.filename] = [];
      modConflicts[entry.filename].push({
        type: 'ASSET',
        name: folder,
        key: file,
        allMods: modsInOrder,
        winner,
      });
    }
  }

  // Phase 4: Deep-parse .level files for item-level conflicts
  const levelHashToMods = {}; // hash -> [{ filename, type, name, key, value }]

  // Parse all .level files once, cache results and collect zones per mod
  const modZones = {}; // modFilename -> [{ zx, zy }]
  const parsedLevels = []; // [{ lf, touches, prefix }]

  for (const lf of levelFiles) {
    const touches = parseLevelData(lf.filePath);
    if (!touches) continue;
    const prefix = path.basename(lf.relPath, '.level').toUpperCase();
    parsedLevels.push({ lf, touches, prefix });

    // Collect zones from leveldata files
    if (prefix === 'LEVELDATA') {
      const zones = [];
      for (const t of touches) {
        if (t.zones) {
          for (const z of t.zones) {
            if (!zones.find((e) => e.zx === z.zx && e.zy === z.zy)) zones.push(z);
          }
        }
      }
      if (zones.length > 0) modZones[lf.modFilename] = zones;
    }
  }

  // Process cached results
  for (const { lf, touches, prefix } of parsedLevels) {
    const seen = new Set();
    const isInteriors = prefix === 'INTERIORS';

    for (const t of touches) {
      const hash = `${prefix}:${t.type}|${t.name}|${t.key}`;
      if (seen.has(hash)) continue;
      seen.add(hash);

      // For interiors, use the mod's leveldata zones as approximate positions
      let zones = t.zones || null;
      if (!zones && isInteriors && modZones[lf.modFilename]) {
        zones = modZones[lf.modFilename];
      }

      if (!levelHashToMods[hash]) levelHashToMods[hash] = [];
      levelHashToMods[hash].push({
        filename: lf.modFilename,
        type: `LEVEL:${prefix}`,
        name: t.name || '(unnamed)',
        key: t.key,
        value: t.value,
        zones,
      });
    }
  }

  for (const [hash, entries] of Object.entries(levelHashToMods)) {
    if (entries.length < 2) continue;

    // Skip if all mods set the same value (not a real conflict)
    const vals = entries.map((e) => e.value).filter((v) => v !== undefined);
    if (vals.length > 1 && vals.every((v) => v === vals[0])) continue;

    totalConflicts++;

    const { type, name, key } = entries[0];

    const modsInOrder = entries.map((e) => ({
      filename: e.filename,
      loadOrder: activeMods.findIndex((m) => m.filename === e.filename) + 1,
    })).sort((a, b) => a.loadOrder - b.loadOrder);

    const winner = modsInOrder[modsInOrder.length - 1].filename;

    const values = {};
    for (const e of entries) {
      if (e.value !== undefined) values[e.filename] = e.value;
    }

    // Collect zone coordinates from any entry that has them
    let zones = null;
    for (const e of entries) {
      if (e.zones) { zones = e.zones; break; }
    }

    for (const entry of entries) {
      if (!modConflicts[entry.filename]) modConflicts[entry.filename] = [];
      modConflicts[entry.filename].push({
        type,
        name,
        key,
        allMods: modsInOrder,
        winner,
        values,
        zones,
      });
    }
  }

  return { modConflicts, totalConflicts, parseErrors };
}

module.exports = { detectConflicts };
