const fs = require('fs');

const SKIPPABLE = new Set([
  'gamedata.base', 'rebirth.mod', 'newwworld.mod', 'dialogue.mod',
]);

function parseModFile(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  if (buffer.length < 8) return null;

  let offset = 0;

  function readInt32() {
    if (offset + 4 > buffer.length) throw new Error('EOF');
    const val = buffer.readInt32LE(offset);
    offset += 4;
    return val;
  }

  function readString() {
    const len = readInt32();
    if (len <= 0) return '';
    if (offset + len > buffer.length) throw new Error('EOF');
    const str = buffer.toString('utf8', offset, offset + len);
    offset += len;
    return str;
  }

  try {
    const header = readInt32();
    if (header <= 15) return null;

    const version = readInt32();
    const author = readString();
    const description = readString();

    const depsRaw = readString();
    const refsRaw = readString();

    const filterSkippable = (arr) =>
      arr.filter((s) => s && !SKIPPABLE.has(s.toLowerCase()));

    const dependencies = filterSkippable(depsRaw.split(','));
    const references = filterSkippable(refsRaw.split(','));

    return { version, author, description, dependencies, references };
  } catch {
    return null;
  }
}

module.exports = { parseModFile };
