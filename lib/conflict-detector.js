const { parseModData } = require('./mod-data-parser');

/**
 * Detect conflicts across all active mods.
 *
 * @param {Array} activeMods - array of { filename, filePath } objects, in load order
 * @returns {{ modConflicts: Object, totalConflicts: number }}
 *   modConflicts: { filename: [ { type, name, key, otherMods, winner } ] }
 *   totalConflicts: number of unique conflicting item+property combos
 */
function detectConflicts(activeMods) {
  // Phase 1: Parse all mods and collect what each touches
  const modTouches = {}; // filename -> Set of hash keys
  const hashToMods = {}; // hash -> [{ filename, type, name, key }]
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
      });
    }

    modTouches[mod.filename] = seen;
  }

  // Phase 2: Find conflicts (hashes with 2+ mods)
  const modConflicts = {};
  let totalConflicts = 0;

  for (const [hash, entries] of Object.entries(hashToMods)) {
    if (entries.length < 2) continue;
    totalConflicts++;

    const { type, name, key } = entries[0];

    // Build ordered list with load positions, sorted by load order
    const modsInOrder = entries.map((e) => ({
      filename: e.filename,
      loadOrder: activeMods.findIndex((m) => m.filename === e.filename) + 1,
    })).sort((a, b) => a.loadOrder - b.loadOrder);

    // Winner is always the mod with the highest load order number
    const winner = modsInOrder[modsInOrder.length - 1].filename;

    for (const entry of entries) {
      if (!modConflicts[entry.filename]) modConflicts[entry.filename] = [];
      modConflicts[entry.filename].push({
        type,
        name,
        key,
        allMods: modsInOrder,
        winner,
      });
    }
  }

  return { modConflicts, totalConflicts, parseErrors };
}

module.exports = { detectConflicts };
