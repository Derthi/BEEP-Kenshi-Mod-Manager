const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectConflicts } = require('../lib/conflict-detector');

test('ignores selected asset files without hiding other conflicts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beep-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const mods = ['A', 'B'].map((name) => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

    const filename = `${name}.mod`;
    const filePath = path.join(dir, filename);
    const modData = Buffer.alloc(32);
    modData.writeInt32LE(16, 0);
    fs.writeFileSync(filePath, modData);

    fs.writeFileSync(path.join(dir, 'credits.txt'), '');
    fs.writeFileSync(path.join(dir, 'docs', 'license.txt'), '');
    fs.writeFileSync(path.join(dir, 'armor.dds'), '');
    fs.writeFileSync(path.join(dir, 'zone.1.2.zone'), '');

    return { filename, filePath };
  });

  const original = detectConflicts(mods);
  assert.deepEqual(original.parseErrors, []);
  assert.equal(original.totalConflicts, 4);

  const filtered = detectConflicts(mods, undefined, [
    ' CREDITS.TXT ',
    'license.txt',
    'zone.1.2.zone',
  ]);

  assert.equal(filtered.totalConflicts, 2);
  assert.ok(filtered.modConflicts['A.mod'].some(
    (c) => c.type === 'ASSET' && c.key === 'armor.dds'
  ));
  assert.ok(filtered.modConflicts['A.mod'].some(
    (c) => c.type === 'LEVEL:EXTERIORS'
  ));

  assert.equal(detectConflicts(mods, undefined, []).totalConflicts, 4);
});