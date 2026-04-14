const fs = require('fs');
const path = require('path');

/**
 * Parses Kenshi's fcs.def file to build a property description lookup.
 *
 * Returns: {
 *   types: { TYPE_NAME: { propertyName: { type, description, group }, ... } },
 *   typeAliases: { "TYPE_A,TYPE_B": ["TYPE_A", "TYPE_B"] }
 * }
 *
 * Usage: lookup types[typeName][propertyKey].description to get human-readable text.
 */
function parseFcsDef(gamePath) {
  const fcsPath = path.join(gamePath, 'fcs.def');
  if (!fs.existsSync(fcsPath)) return null;

  let content;
  try {
    content = fs.readFileSync(fcsPath, 'utf8');
  } catch {
    return null;
  }

  const types = {};
  const typeAliases = {};
  let currentTypes = [];
  let currentGroup = '';

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    // Type header: [TYPE_NAME] or [TYPE_A,TYPE_B]
    const typeMatch = line.match(/^\[([A-Z_,\s]+)\]$/);
    if (typeMatch) {
      const raw = typeMatch[1].trim();
      currentTypes = raw.split(',').map((s) => s.trim());
      currentGroup = '';
      for (const t of currentTypes) {
        if (!types[t]) types[t] = {};
      }
      if (currentTypes.length > 1) {
        typeAliases[raw] = currentTypes;
      }
      continue;
    }

    if (currentTypes.length === 0) continue;

    // Group header (indented label ending with colon, no value)
    const groupMatch = line.match(/^([a-z][a-z0-9 /\-]*):$/i);
    if (groupMatch && !line.includes('"') && !line.includes('(')) {
      currentGroup = groupMatch[1].trim();
      continue;
    }

    // Property line: "name: TYPE/VALUE "description""
    const propMatch = line.match(/^([a-z][a-z0-9 _\-]*\w):\s+(.+)$/i);
    if (propMatch) {
      const propName = propMatch[1].trim();
      const rest = propMatch[2].trim();

      // Extract description from quotes
      let description = '';
      const descMatch = rest.match(/"([^"]+)"\s*$/);
      if (descMatch) {
        description = descMatch[1];
      }

      // Extract value type (everything before the description or the whole thing)
      let valueType = descMatch ? rest.substring(0, rest.lastIndexOf('"' + descMatch[1])).trim().replace(/"$/, '').trim() : rest;

      for (const t of currentTypes) {
        types[t][propName] = {
          type: valueType,
          description,
          group: currentGroup,
        };
      }
    }
  }

  return { types, typeAliases };
}

module.exports = { parseFcsDef };
