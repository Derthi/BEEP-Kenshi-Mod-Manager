const fs = require('fs');
const path = require('path');
const { parseLevelData } = require('./mod-data-parser');

// All base-game versions of a sector (the world is assembled from these layers).
function findVanillaZones(gamePath, zx, zy) {
  if (!gamePath) return [];
  const name = `zone.${zx}.${zy}.zone`;
  const candidates = [
    path.join(gamePath, 'data', 'newland', 'leveldata', 'Newwworld', name),
    path.join(gamePath, 'data', 'newland', 'leveldata', 'rebirth', name),
    path.join(gamePath, 'data', 'leveldata', name),
  ];
  return candidates.filter((c) => { try { return fs.existsSync(c); } catch { return false; } });
}

// Index a parsed sector by object id -> { type, props }
function indexZone(touches) {
  const objs = {};
  for (const t of touches) {
    if (!objs[t.name]) objs[t.name] = { type: t.type, props: {} };
    objs[t.name].props[t.key] = t.value;
  }
  return objs;
}

// Union of all base layers for a sector, indexed by id (first layer wins on id collision).
function indexBasePaths(basePaths) {
  const V = {};
  for (const p of basePaths) {
    const t = parseLevelData(p);
    if (!t) continue;
    const idx = indexZone(t);
    for (const k of Object.keys(idx)) if (!(k in V)) V[k] = idx[k];
  }
  return V;
}

function friendly(type) {
  const map = { GAMESTATE_BUILDING: 'structure', GAMESTATE_CHARACTER: 'character', GAMESTATE_TOWN: 'town', GRASS: 'foliage' };
  return map[type] || String(type || '').toLowerCase().replace(/_/g, ' ') || 'object';
}
function labelOf(o) {
  const p = o.props || {};
  return p.name || p['exterior layout name'] || p['interior layout name'] || friendly(o.type);
}

// Real placement props; everything else (resident/handle refs) is renumbered on every save.
const GEO = /(pos|rotation|scale)/i;
const POS = { 'world X pos': 'x', 'world Y pos': 'y', 'world Z pos': 'z' };

// [name, name, ...] -> [{ name, count }] sorted by count desc, then name
function aggregate(names) {
  const m = {};
  for (const n of names) m[n] = (m[n] || 0) + 1;
  return Object.entries(m)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

/**
 * One indexed mod sector (M) vs the indexed base union (V).
 * Returns moved/added/removed plus byId — the base-derived per-object changes (moved/removed)
 * keyed by object id, which is stable across mods that derive from the same base (used for overlap).
 */
function changeset(M, V) {
  const moved = [];
  const addedNames = [];
  const removedNames = [];
  const byId = {}; // id -> { kind:'moved'|'removed', label, dist }
  for (const id of Object.keys(M)) {
    if (!(id in V)) { addedNames.push(labelOf(M[id])); continue; }
    let dx = 0, dy = 0, dz = 0, changed = false;
    for (const k of Object.keys(M[id].props)) {
      const mv = M[id].props[k];
      const vv = V[id].props[k];
      if (vv === mv || vv === undefined || !GEO.test(k)) continue;
      if (POS[k]) {
        const d = parseFloat(mv) - parseFloat(vv);
        if (!Number.isNaN(d)) { changed = true; if (POS[k] === 'x') dx = d; else if (POS[k] === 'y') dy = d; else dz = d; }
      } else { changed = true; } // rotation / scale
    }
    if (changed) {
      const label = labelOf(M[id]);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      moved.push({ name: label, dist });
      byId[id] = { kind: 'moved', label, dist };
    }
  }
  for (const id of Object.keys(V)) if (!(id in M)) {
    const label = labelOf(V[id]);
    removedNames.push(label);
    byId[id] = { kind: 'removed', label };
  }
  moved.sort((a, b) => b.dist - a.dist);
  return { moved, addedNames, removedNames, byId };
}

/**
 * Diff a mod's edited sector against the base game.
 * "moved" is reliable (matched objects whose placement changed). "added"/"removed" are approximate —
 * base town objects the editor re-saves can appear as added/removed (no full base sector to compare).
 */
function diffSector(modZonePath, gamePath, zx, zy) {
  const modT = parseLevelData(modZonePath);
  if (!modT) return null;
  const basePaths = findVanillaZones(gamePath, zx, zy);
  if (!basePaths.length) return { baseline: false };

  const cs = changeset(indexZone(modT), indexBasePaths(basePaths));
  return {
    baseline: true,
    moved: cs.moved,
    added: aggregate(cs.addedNames),
    removed: aggregate(cs.removedNames),
    summary: { moved: cs.moved.length, added: cs.addedNames.length, removed: cs.removedNames.length },
  };
}

/**
 * Compare what MULTIPLE mods each changed in the same sector and surface where they collide.
 * Overlap is computed on base-derived object ids (moved/removed), which are stable across mods that
 * derive from the same base — so "both moved the same gate" is detectable. Added objects get mod-local
 * ids that can't be cross-matched, so they count as each mod's own change, never as overlap.
 *
 * @param {Object} zonePathsByMod  { "ModA.mod": "/path/zone.x.y.zone", ... }
 * @returns { baseline, zx, zy, overlap:[{name, mods:[{mod,kind,dist}]}], mods:[{mod,moved,added,removed,summary}], summary }
 */
function diffSectorConflict(zonePathsByMod, gamePath, zx, zy) {
  const modFiles = Object.keys(zonePathsByMod || {});
  if (modFiles.length < 2) return null;
  const basePaths = findVanillaZones(gamePath, zx, zy);
  if (!basePaths.length) return { baseline: false, zx, zy };
  const V = indexBasePaths(basePaths);

  const mods = [];          // per-mod change summary
  const changedBy = {};     // objectId -> [{ mod, kind, label, dist }]
  for (const mod of modFiles) {
    const t = parseLevelData(zonePathsByMod[mod]);
    if (!t) continue;
    const cs = changeset(indexZone(t), V);
    for (const id of Object.keys(cs.byId)) {
      (changedBy[id] = changedBy[id] || []).push({ mod, ...cs.byId[id] });
    }
    mods.push({
      mod,
      moved: cs.moved,
      added: aggregate(cs.addedNames),
      removed: aggregate(cs.removedNames),
      summary: { moved: cs.moved.length, added: cs.addedNames.length, removed: cs.removedNames.length },
    });
  }

  // Overlap = a base object changed by 2+ mods. A *real* collision needs at least one mod to have
  // MOVED it — "removed by everyone" is just a shared base object absent from per-sector .zone files
  // (the same false-data that makes raw "removed" unreliable), not a genuine contest.
  const overlap = [];
  for (const id of Object.keys(changedBy)) {
    const list = changedBy[id];
    if (list.length < 2) continue;
    if (!list.some((e) => e.kind === 'moved')) continue;
    overlap.push({ name: list[0].label, mods: list.map((e) => ({ mod: e.mod, kind: e.kind, dist: e.dist || 0 })) });
  }
  overlap.sort((a, b) => (b.mods.length - a.mods.length) || a.name.localeCompare(b.name));

  return { baseline: true, zx, zy, overlap, mods, summary: { overlap: overlap.length, modCount: mods.length } };
}

module.exports = { findVanillaZones, diffSector, diffSectorConflict };
