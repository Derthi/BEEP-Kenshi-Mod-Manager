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
  const zoneFiles = [];   // [{ modFilename, zx, zy }] — per-sector placement edits (zone.X.Y.zone)

  for (const mod of activeMods) {
    const modDir = path.dirname(mod.filePath);
    const assets = walkDir(modDir, modDir);
    for (const relPath of assets) {
      const lowerPath = relPath.toLowerCase();
      if (lowerPath.endsWith('.level')) {
        // leveldata.level is a region INDEX (it lists every sector), not edit data — skip it.
        // Real per-sector placement edits are in zone.X.Y.zone files (handled below).
        if (path.basename(lowerPath) === 'leveldata.level') continue;
        levelFiles.push({
          modFilename: mod.filename,
          filePath: path.join(modDir, relPath),
          relPath,
        });
      } else if (lowerPath.endsWith('.zone')) {
        // zone.X.Y.zone = the actual placement data for sector (X,Y); the sector is in the filename
        const zm = path.basename(lowerPath).match(/^zone\.(\d+)\.(\d+)\.zone$/);
        if (zm) zoneFiles.push({ modFilename: mod.filename, zx: parseInt(zm[1], 10), zy: parseInt(zm[2], 10), filePath: path.join(modDir, relPath) });
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

  // Per-mod exterior sectors from zone.X.Y.zone filenames (authoritative; the sector is in the name)
  const exteriorZonesByMod = {}; // modFile -> Map("zx,zy" -> {zx,zy})
  const sectorToMods = {};       // "zx,zy" -> [modFile, ...]
  for (const zf of zoneFiles) {
    const key = `${zf.zx},${zf.zy}`;
    if (!exteriorZonesByMod[zf.modFilename]) exteriorZonesByMod[zf.modFilename] = new Map();
    exteriorZonesByMod[zf.modFilename].set(key, { zx: zf.zx, zy: zf.zy, zonePath: zf.filePath });
    if (!sectorToMods[key]) sectorToMods[key] = [];
    if (!sectorToMods[key].includes(zf.modFilename)) sectorToMods[key].push(zf.modFilename);
  }

  // Phase 4: Deep-parse .level files for item-level conflicts
  const levelHashToMods = {}; // hash -> [{ filename, type, name, key, value }]

  // Parse the remaining .level files (interiors) once
  const modZones = {}; // modFilename -> [{ zx, zy }] — the mod's edited sectors (from its .zone files)
  const parsedLevels = []; // [{ lf, touches, prefix }]
  const perModEdits = {}; // modFilename -> { exterior: {}, interior: {} } (for the map "All Edits" mode)

  // Interior edits have no sector of their own — place them at the mod's edited sectors.
  for (const [modFile, zoneMap] of Object.entries(exteriorZonesByMod)) {
    modZones[modFile] = [...zoneMap.values()];
  }

  for (const lf of levelFiles) {
    const touches = parseLevelData(lf.filePath);
    if (!touches) continue;
    const prefix = path.basename(lf.relPath, '.level').toUpperCase();
    parsedLevels.push({ lf, touches, prefix });
  }

  // Process cached results
  for (const { lf, touches, prefix } of parsedLevels) {
    const seen = new Set();
    const isInteriors = prefix === 'INTERIORS';

    for (const t of touches) {
      const hash = `${prefix}:${t.type}|${t.name}|${t.key}`;
      if (seen.has(hash)) continue;
      seen.add(hash);

      // Interiors have no sector of their own — approximate to the mod's edited sectors.
      const zones = isInteriors ? (modZones[lf.modFilename] || null) : null;

      // Harvest interior edits for the map "All Edits" mode (exterior comes from .zone files below).
      if (isInteriors && zones) {
        if (!perModEdits[lf.modFilename]) perModEdits[lf.modFilename] = { exterior: {}, interior: {} };
        const layerMap = perModEdits[lf.modFilename].interior;
        for (const z of zones) {
          const zKey = `${z.zx},${z.zy}`;
          if (!layerMap[zKey]) layerMap[zKey] = { zx: z.zx, zy: z.zy, items: [], itemCount: 0 };
          const bucket = layerMap[zKey];
          bucket.itemCount++;
          if (bucket.items.length < 40) {
            bucket.items.push({ type: t.type, name: t.name || '(unnamed)', prop: t.key });
          }
        }
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

  // Exterior placement: each zone.X.Y.zone is one sector the mod overrides.
  // "All Edits" = every such sector; a conflict = 2+ mods overriding the same sector.
  for (const [key, mods] of Object.entries(sectorToMods)) {
    if (mods.length < 2) continue;
    totalConflicts++;
    const [zx, zy] = key.split(',').map(Number);
    const modsInOrder = mods.map((f) => ({
      filename: f,
      loadOrder: activeMods.findIndex((m) => m.filename === f) + 1,
    })).sort((a, b) => a.loadOrder - b.loadOrder);
    const winner = modsInOrder[modsInOrder.length - 1].filename;
    // Each participant's .zone path for this sector, so the UI can diff their edits object-by-object.
    const zonePaths = {};
    for (const f of mods) {
      const z = exteriorZonesByMod[f] && exteriorZonesByMod[f].get(key);
      if (z && z.zonePath) zonePaths[f] = z.zonePath;
    }
    for (const m of modsInOrder) {
      if (!modConflicts[m.filename]) modConflicts[m.filename] = [];
      modConflicts[m.filename].push({
        type: 'LEVEL:EXTERIORS', name: `sector ${zx},${zy}`, key: 'placement',
        allMods: modsInOrder, winner, zones: [{ zx, zy }], zonePaths,
      });
    }
  }

  // Per-mod exterior "All Edits" = the sectors it overrides (from its .zone files)
  for (const [modFile, zoneMap] of Object.entries(exteriorZonesByMod)) {
    if (!perModEdits[modFile]) perModEdits[modFile] = { exterior: {}, interior: {} };
    for (const z of zoneMap.values()) {
      perModEdits[modFile].exterior[`${z.zx},${z.zy}`] = { zx: z.zx, zy: z.zy, items: [], itemCount: 0, zonePath: z.zonePath };
    }
  }

  // Build sorted per-mod edits output for the map "All Edits" mode.
  // Sort top-to-bottom, left-to-right; drop mods with no mappable zones.
  const perModEditsOut = {};
  for (const [modFile, layers] of Object.entries(perModEdits)) {
    const toArr = (m) => Object.values(m).sort((a, b) => (a.zy !== b.zy ? a.zy - b.zy : a.zx - b.zx));
    const exterior = toArr(layers.exterior);
    const interior = toArr(layers.interior);
    if (exterior.length === 0 && interior.length === 0) continue;
    perModEditsOut[modFile] = { exterior, interior, extZoneCount: exterior.length, intZoneCount: interior.length };
  }

  return { modConflicts, totalConflicts, parseErrors, perModEdits: perModEditsOut };
}

module.exports = { detectConflicts };
