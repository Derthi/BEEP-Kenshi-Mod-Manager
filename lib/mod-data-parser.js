const fs = require('fs');

/**
 * Deep-parses a .mod binary file to extract all item+property keys it touches.
 * Used for conflict detection — we only need to know WHAT each mod changes,
 * not the actual values.
 *
 * Returns: array of { type, name, key } objects, or null on failure.
 */
function parseModData(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  if (buffer.length < 12) return null;

  let offset = 0;
  const touches = [];

  function readInt32() {
    if (offset + 4 > buffer.length) throw new Error('EOF');
    const val = buffer.readInt32LE(offset);
    offset += 4;
    return val;
  }

  function readFloat() {
    if (offset + 4 > buffer.length) throw new Error('EOF');
    const val = buffer.readFloatLE(offset);
    offset += 4;
    return val;
  }

  function readBool() {
    if (offset + 1 > buffer.length) throw new Error('EOF');
    const val = buffer[offset];
    offset += 1;
    return val !== 0;
  }

  function readString() {
    const len = readInt32();
    if (len <= 0) return '';
    if (offset + len > buffer.length) throw new Error('EOF');
    const str = buffer.toString('utf8', offset, offset + len);
    offset += len;
    return str;
  }

  function skipBytes(n) {
    if (offset + n > buffer.length) throw new Error('EOF');
    offset += n;
  }

  try {
    // File version header
    const fileVersion = readInt32();
    if (fileVersion <= 15) return null; // Too old or not a valid mod

    // Skip metadata header (author, desc, deps, refs)
    readInt32(); // version
    if (fileVersion >= 17) readInt32(); // extra field in v17+
    readString(); // author
    readString(); // description
    readString(); // dependencies
    readString(); // references

    // lastID
    readInt32();

    // Item count
    const itemCount = readInt32();

    for (let i = 0; i < itemCount; i++) {
      readInt32(); // legacy ID

      const itemType = readInt32();
      const typeName = ITEM_TYPES[itemType] || `TYPE_${itemType}`;

      readInt32(); // id number

      const itemName = readString();
      const stringID = readString(); // stringID (version >= 7 guaranteed since > 15)

      // --- Item.Load() ---

      // Load flags (version >= 15)
      readInt32(); // flags, masked with 0x7FFFFFFF — we don't need to interpret

      // Tag dictionary — skip entirely, just consume bytes
      // Note: version >= 15 uses flags above, NOT the tag dict
      // Tags are only for 11 <= version < 15, which we skip since we require > 15

      // Boolean properties
      const boolCount = readInt32();
      for (let b = 0; b < boolCount; b++) {
        const key = readString();
        const value = readBool() ? 'true' : 'false';
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // Float properties
      const floatCount = readInt32();
      for (let f = 0; f < floatCount; f++) {
        const key = readString();
        const value = String(readFloat());
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // Integer properties
      const intCount = readInt32();
      for (let n = 0; n < intCount; n++) {
        const key = readString();
        const value = String(readInt32());
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // Vec3 properties (version > 8, guaranteed)
      const vec3Count = readInt32();
      for (let v = 0; v < vec3Count; v++) {
        const key = readString();
        const x = readFloat(), y = readFloat(), z = readFloat();
        const value = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // Quaternion properties
      const quatCount = readInt32();
      for (let q = 0; q < quatCount; q++) {
        const key = readString();
        const w = readFloat(), x = readFloat(), y = readFloat(), z = readFloat();
        const value = `${w.toFixed(2)}, ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`;
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // String properties
      const strCount = readInt32();
      for (let s = 0; s < strCount; s++) {
        const key = readString();
        let value = readString();
        if (value.length > 80) value = value.substring(0, 77) + '...';
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // File references
      const fileCount = readInt32();
      for (let f = 0; f < fileCount; f++) {
        const key = readString();
        const value = readString();
        touches.push({ type: typeName, name: itemName, key, value });
      }

      // Reference sections
      const sectionCount = readInt32();
      for (let s = 0; s < sectionCount; s++) {
        const sectionName = readString();
        const refCount = readInt32();
        for (let r = 0; r < refCount; r++) {
          const refId = readString();
          readInt32(); // v0
          readInt32(); // v1 (version >= 10, guaranteed)
          readInt32(); // v2
          touches.push({ type: typeName, name: itemName, key: `ref:${sectionName}:${refId}`, value: refId });
        }
      }

      // Instances
      const instanceCount = readInt32();
      for (let inst = 0; inst < instanceCount; inst++) {
        readString(); // instance ID (version >= 15)
        readString(); // ref (version >= 8)
        skipBytes(28); // x,y,z + qw,qx,qy,qz (7 floats)

        // State references (version > 6, guaranteed)
        const stateCount = readInt32();
        for (let st = 0; st < stateCount; st++) {
          readString(); // state ID (version >= 15)
        }
      }
    }

    return touches;
  } catch {
    return null;
  }
}

// Kenshi ItemType enum — from the gamedata/mod/save file-format spec and community FCS tools.
// (Gaps are types not seen in tested files; they fall back to TYPE_<n>.)
const ITEM_TYPES = {
  0: 'BUILDING', 1: 'CHARACTER', 2: 'WEAPON', 3: 'ARMOUR', 4: 'ITEM',
  5: 'ANIMAL_ANIMATION', 6: 'ATTACHMENT', 7: 'RACE', 9: 'NATURE', 10: 'FACTION',
  13: 'TOWN', 16: 'LOCATIONAL_DAMAGE', 17: 'COMBAT_TECHNIQUE', 18: 'DIALOGUE',
  19: 'DIALOGUE_LINE', 21: 'RESEARCH', 22: 'AI_TASK', 24: 'ANIMATION', 25: 'STATS',
  26: 'PERSONALITY', 27: 'CONSTANTS', 28: 'BIOMES', 29: 'BUILDING_PART',
  30: 'INSTANCE_COLLECTION', 31: 'DIALOG_ACTION', 32: 'TEMPORARY_INFO', 33: 'MOD_FILENAME',
  34: 'PLATOON', 35: 'GAMESTATE_BUILDING', 36: 'GAMESTATE_CHARACTER', 37: 'GAMESTATE_FACTION',
  38: 'GAMESTATE_TOWN_INSTANCE_LIST', 39: 'STATE', 40: 'SAVED_STATE', 41: 'INVENTORY_STATE',
  42: 'INVENTORY_ITEM_STATE', 43: 'REPEATABLE_BUILDING_PART_SLOT', 44: 'MATERIAL_SPEC',
  45: 'MATERIAL_SPECS_COLLECTION', 46: 'CONTAINER', 47: 'MATERIAL_SPECS_CLOTHING',
  49: 'VENDOR_LIST', 50: 'MATERIAL_SPECS_WEAPON', 51: 'WEAPON_MANUFACTURER', 52: 'SQUAD_TEMPLATE',
  53: 'ROAD', 55: 'COLOR_DATA', 56: 'CAMERA', 57: 'MEDICAL_STATE', 59: 'FOLIAGE_LAYER',
  60: 'FOLIAGE_MESH', 61: 'GRASS', 62: 'BUILDING_FUNCTIONALITY', 63: 'DAY_SCHEDULE',
  64: 'NEW_GAME_STARTOFF', 66: 'CHARACTER_APPEARANCE', 67: 'GAMESTATE_AI', 68: 'WILDLIFE_BIRDS',
  69: 'MAP_FEATURES', 70: 'DIPLOMATIC_ASSAULTS', 71: 'SINGLE_DIPLOMATIC_ASSAULT', 72: 'AI_PACKAGE',
  73: 'DIALOGUE_PACKAGE', 74: 'GUN_DATA', 76: 'ANIMAL_CHARACTER', 77: 'UNIQUE_SQUAD_TEMPLATE',
  78: 'FACTION_TEMPLATE', 80: 'WEATHER', 81: 'SEASON', 82: 'EFFECT', 83: 'ITEM_PLACEMENT_GROUP',
  84: 'WORD_SWAPS', 86: 'NEST_ITEM', 87: 'CHARACTER_PHYSICS_ATTACHMENT', 88: 'LIGHT', 89: 'HEAD',
  92: 'FOLIAGE_BUILDING', 93: 'FACTION_CAMPAIGN', 94: 'GAMESTATE_TOWN', 95: 'BIOME_GROUP',
  96: 'EFFECT_FOG_VOLUME', 97: 'FARM_DATA', 98: 'FARM_PART', 99: 'ENVIRONMENT_RESOURCES',
  100: 'RACE_GROUP', 101: 'ARTIFACTS', 102: 'MAP_ITEM', 103: 'BUILDINGS_SWAP', 104: 'ITEMS_CULTURE',
  105: 'ANIMATION_EVENT', 107: 'CROSSBOW',
};

/**
 * Parses a .level file (leveldata.level, interiors.level).
 * Same item/property format as .mod but with a simpler header
 * (no author/description/dependencies/references).
 *
 * Returns: array of { type, name, key } objects, or null on failure.
 */
function parseLevelData(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  if (buffer.length < 12) return null;

  let offset = 0;
  const touches = [];

  function readInt32() {
    if (offset + 4 > buffer.length) throw new Error('EOF');
    const val = buffer.readInt32LE(offset);
    offset += 4;
    return val;
  }

  function readFloat() {
    if (offset + 4 > buffer.length) throw new Error('EOF');
    const val = buffer.readFloatLE(offset);
    offset += 4;
    return val;
  }

  function readBool() {
    if (offset + 1 > buffer.length) throw new Error('EOF');
    const val = buffer[offset];
    offset += 1;
    return val !== 0;
  }

  function readString() {
    const len = readInt32();
    if (len <= 0) return '';
    if (offset + len > buffer.length) throw new Error('EOF');
    const str = buffer.toString('utf8', offset, offset + len);
    offset += len;
    return str;
  }

  function skipBytes(n) {
    if (offset + n > buffer.length) throw new Error('EOF');
    offset += n;
  }

  try {
    // .level header: version, lastId, itemCount (no metadata strings)
    const fileVersion = readInt32();
    if (fileVersion < 15) return null;

    readInt32(); // lastId
    const itemCount = readInt32();

    for (let i = 0; i < itemCount; i++) {
      readInt32(); // legacy ID
      const itemType = readInt32();
      const typeName = ITEM_TYPES[itemType] || `TYPE_${itemType}`;
      readInt32(); // id number
      const itemName = readString();
      const stringId = readString();
      // Use stringId as display name since itemName is often just "0"
      const displayName = stringId || itemName || '(unnamed)';
      readInt32(); // flags
      const itemTouchStart = touches.length;

      // Boolean properties
      const boolCount = readInt32();
      for (let b = 0; b < boolCount; b++) {
        const key = readString();
        const value = readBool() ? 'true' : 'false';
        touches.push({ type: typeName, name: displayName, key, value });
      }

      // Float properties
      const floatCount = readInt32();
      for (let f = 0; f < floatCount; f++) {
        const key = readString();
        const value = String(readFloat());
        touches.push({ type: typeName, name: displayName, key, value });
      }

      // Integer properties — also extract zone coordinates
      const intCount = readInt32();
      const itemZones = []; // [{ zx, zy }]
      for (let n = 0; n < intCount; n++) {
        const key = readString();
        const value = String(readInt32());
        touches.push({ type: typeName, name: displayName, key, value });
        // Capture zone coordinates
        const zm = key.match(/^zone_x_(\d+)$/);
        if (zm) {
          const idx = parseInt(zm[1]);
          if (!itemZones[idx]) itemZones[idx] = {};
          itemZones[idx].zx = parseInt(value);
        }
        const zm2 = key.match(/^zone_y_(\d+)$/);
        if (zm2) {
          const idx = parseInt(zm2[1]);
          if (!itemZones[idx]) itemZones[idx] = {};
          itemZones[idx].zy = parseInt(value);
        }
      }
      // Resolve item zone coordinates
      const zones = itemZones.filter((z) => z && z.zx !== undefined && z.zy !== undefined);

      // Vec3 properties
      const vec3Count = readInt32();
      for (let v = 0; v < vec3Count; v++) {
        const key = readString();
        const x = readFloat(), y = readFloat(), z = readFloat();
        const value = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
        touches.push({ type: typeName, name: displayName, key, value });
      }

      // Quaternion properties
      const quatCount = readInt32();
      for (let q = 0; q < quatCount; q++) {
        const key = readString();
        const w = readFloat(), x = readFloat(), y = readFloat(), z = readFloat();
        const value = `${w.toFixed(2)}, ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`;
        touches.push({ type: typeName, name: displayName, key, value });
      }

      // String properties
      const strCount = readInt32();
      for (let s = 0; s < strCount; s++) {
        const key = readString();
        let value = readString();
        if (value.length > 80) value = value.substring(0, 77) + '...';
        touches.push({ type: typeName, name: displayName, key, value });
      }

      // File references
      const fileCount = readInt32();
      for (let f = 0; f < fileCount; f++) {
        const key = readString();
        const value = readString();
        touches.push({ type: typeName, name: displayName, key, value });
      }

      // Reference sections
      const sectionCount = readInt32();
      for (let s = 0; s < sectionCount; s++) {
        const sectionName = readString();
        const refCount = readInt32();
        for (let r = 0; r < refCount; r++) {
          const refId = readString();
          readInt32();
          readInt32();
          readInt32();
          touches.push({ type: typeName, name: displayName, key: `ref:${sectionName}`, value: refId });
        }
      }

      // Instances
      const instanceCount = readInt32();
      for (let inst = 0; inst < instanceCount; inst++) {
        readString();
        readString();
        skipBytes(28);
        const stateCount = readInt32();
        for (let st = 0; st < stateCount; st++) { readString(); }
      }

      // Stamp zone coordinates on all touches from this item
      if (zones.length > 0) {
        for (let t = itemTouchStart; t < touches.length; t++) {
          touches[t].zones = zones;
        }
      }
    }

    return touches;
  } catch {
    return null;
  }
}

module.exports = { parseModData, parseLevelData };
