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
        readBool(); // skip value
        touches.push({ type: typeName, name: itemName, key });
      }

      // Float properties
      const floatCount = readInt32();
      for (let f = 0; f < floatCount; f++) {
        const key = readString();
        skipBytes(4); // skip float
        touches.push({ type: typeName, name: itemName, key });
      }

      // Integer properties
      const intCount = readInt32();
      for (let n = 0; n < intCount; n++) {
        const key = readString();
        skipBytes(4); // skip int
        touches.push({ type: typeName, name: itemName, key });
      }

      // Vec3 properties (version > 8, guaranteed)
      const vec3Count = readInt32();
      for (let v = 0; v < vec3Count; v++) {
        const key = readString();
        skipBytes(12); // 3 floats
        touches.push({ type: typeName, name: itemName, key });
      }

      // Quaternion properties
      const quatCount = readInt32();
      for (let q = 0; q < quatCount; q++) {
        const key = readString();
        skipBytes(16); // 4 floats
        touches.push({ type: typeName, name: itemName, key });
      }

      // String properties
      const strCount = readInt32();
      for (let s = 0; s < strCount; s++) {
        const key = readString();
        readString(); // skip value
        touches.push({ type: typeName, name: itemName, key });
      }

      // File references
      const fileCount = readInt32();
      for (let f = 0; f < fileCount; f++) {
        const key = readString();
        readString(); // skip filename
        touches.push({ type: typeName, name: itemName, key });
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
          touches.push({ type: typeName, name: itemName, key: `ref:${sectionName}:${refId}` });
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

// Kenshi ItemType enum values (subset — covers common types)
const ITEM_TYPES = {
  0: 'BUILDING', 1: 'CHARACTER', 2: 'SQUAD', 3: 'AI_TASK',
  4: 'AI_PACKAGE', 5: 'FACTION', 6: 'RESEARCH', 7: 'CONSTANTS',
  8: 'DIALOGUE', 9: 'DIALOGUE_PACKAGE', 10: 'EFFECT',
  11: 'ATTACHMENT', 12: 'ANIMATION', 13: 'LOCATION',
  14: 'ITEM', 15: 'WEAPON', 16: 'ARMOUR', 17: 'CROSSBOW',
  18: 'CONTAINER', 19: 'NEST_ITEM', 20: 'LIGHT',
  21: 'BIOMES', 22: 'STATS', 23: 'QUEST',
  24: 'ANIMAL_CHARACTER', 25: 'ANIMAL_ANIMATION',
  26: 'HEAD', 27: 'RACE', 28: 'MATERIAL_SPECS',
  29: 'MATERIAL_SPEC_ICONS', 30: 'VENDOR_LIST',
  31: 'SQUAD_TEMPLATE', 32: 'MAP_ITEM',
  33: 'FACTION_TEMPLATE', 34: 'FOLIAGE_MESH',
  35: 'GRASS', 36: 'BUILDING_PART', 37: 'ROAD_SECTION',
  38: 'SEASON', 39: 'WEATHER', 40: 'DAY',
  41: 'FOLIAGE_BUILDING', 42: 'FOLIAGE_LAYER',
  43: 'TOWN', 44: 'WORLD_EVENT_STATE',
  45: 'DIPLOMATIC_ASSAULTS', 46: 'PERSONALITY',
  47: 'WORD_SWAPS', 48: 'TOWN_RESIDENT',
  49: 'COMBAT_TECHNIQUE', 50: 'ENVIRONMENT_RESOURCES',
  51: 'FACTION_CAMPAIGN', 52: 'ARTIFACTS',
  53: 'UNIQUE_REPLACEMENT',
};

module.exports = { parseModData };
