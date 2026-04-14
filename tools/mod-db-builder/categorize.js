#!/usr/bin/env node

// Categorization helper for Claude Code.
//
// Usage (run via Claude Code):
//   node tools/mod-db-builder/categorize.js [--batch N] [--size S]
//
// Reads cached mod details from cache/all-details.json,
// filters out mods already in mod-database.json (incremental),
// and outputs a batch of uncategorized mods for Claude Code to process.
//
// Flags:
//   --batch N   Which batch to output (default: 0, the first batch)
//   --size S    Mods per batch (default: 20)
//   --stats     Print stats only (how many mods total, categorized, remaining)
//   --save      Read categorization results from stdin and merge into mod-database.json

const fs = require('fs');
const path = require('path');
const { CATEGORIES } = require('./guide-text');

const CACHE_DIR = path.join(__dirname, 'cache');
const DETAILS_FILE = path.join(CACHE_DIR, 'all-details.json');
const DB_FILE = path.join(__dirname, 'mod-database.json');

function loadDatabase() {
  if (fs.existsSync(DB_FILE)) {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  }
  return {};
}

function saveDatabase(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadDetails() {
  if (!fs.existsSync(DETAILS_FILE)) {
    console.error(`Error: ${DETAILS_FILE} not found. Run fetch-mods.js first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DETAILS_FILE, 'utf-8'));
}

function getUncategorized(details, db) {
  return details.filter((mod) => {
    const filename = mod.filename || '';
    return filename && !db[filename];
  });
}

function formatModForClaude(mod) {
  let entry = `=== MOD: ${mod.title} ===\n`;
  entry += `Filename: ${mod.filename}\n`;
  entry += `Workshop ID: ${mod.publishedfileid}\n`;
  if (mod.creator) entry += `Creator: ${mod.creator}\n`;
  if (mod.tags && mod.tags.length > 0) entry += `Tags: ${mod.tags.join(', ')}\n`;
  if (mod.description) {
    entry += `\nDescription:\n${mod.description}\n`;
  }
  entry += '\n---\n\n';
  return entry;
}

// --- CLI ---

const args = process.argv.slice(2);
const flagIndex = (flag) => args.indexOf(flag);

if (args.includes('--stats')) {
  const details = loadDetails();
  const db = loadDatabase();
  const uncategorized = getUncategorized(details, db);
  const categorized = details.length - uncategorized.length;

  console.log('=== Mod Database Stats ===');
  console.log(`Total mods with details: ${details.length}`);
  console.log(`Already categorized:     ${categorized}`);
  console.log(`Remaining to categorize: ${uncategorized.length}`);
  console.log(`Database entries:        ${Object.keys(db).length}`);
  console.log('');

  // Category breakdown
  const counts = {};
  for (const cat of CATEGORIES) counts[cat] = 0;
  counts['Uncategorized'] = 0;
  for (const [, cat] of Object.entries(db)) {
    if (counts[cat] !== undefined) counts[cat]++;
    else counts[cat] = 1;
  }
  console.log('Category breakdown:');
  for (const [cat, count] of Object.entries(counts)) {
    if (count > 0) console.log(`  ${cat}: ${count}`);
  }
  process.exit(0);
}

if (args.includes('--save')) {
  // Read JSON from stdin: { "filename.mod": "Category Name", ... }
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const newEntries = JSON.parse(input);
      const db = loadDatabase();
      let added = 0;
      for (const [filename, category] of Object.entries(newEntries)) {
        if (!db[filename] && CATEGORIES.includes(category)) {
          db[filename] = category;
          added++;
        }
      }
      saveDatabase(db);
      console.log(`Saved ${added} new entries to ${DB_FILE}`);
      console.log(`Total database size: ${Object.keys(db).length}`);
    } catch (e) {
      console.error(`Error parsing input: ${e.message}`);
      process.exit(1);
    }
  });
  return;
}

// Default: output a batch of uncategorized mods
const batchIdx = flagIndex('--batch') >= 0 ? parseInt(args[flagIndex('--batch') + 1], 10) : 0;
const batchSize = flagIndex('--size') >= 0 ? parseInt(args[flagIndex('--size') + 1], 10) : 20;

const details = loadDetails();
const db = loadDatabase();
const uncategorized = getUncategorized(details, db);

if (uncategorized.length === 0) {
  console.log('All mods are categorized!');
  process.exit(0);
}

const start = batchIdx * batchSize;
const batch = uncategorized.slice(start, start + batchSize);

if (batch.length === 0) {
  console.log(`Batch ${batchIdx} is empty (only ${uncategorized.length} mods remaining, ${Math.ceil(uncategorized.length / batchSize)} batches total).`);
  process.exit(0);
}

console.log(`=== BATCH ${batchIdx} (${batch.length} mods, ${uncategorized.length} total remaining) ===\n`);
console.log(`Categories: ${CATEGORIES.join(', ')}\n`);

for (const mod of batch) {
  console.log(formatModForClaude(mod));
}

console.log(`=== END BATCH ${batchIdx} ===`);
console.log(`\nTo categorize, assign each mod filename to one of: ${CATEGORIES.join(', ')}`);
console.log(`Then save with: echo '{"filename.mod":"Category"}' | node categorize.js --save`);
