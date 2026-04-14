#!/usr/bin/env node

// Fetches ALL Kenshi Workshop mods from Steam in two steps:
// 1. Enumerate all mod IDs via IPublishedFileService/QueryFiles
// 2. Fetch full details via ISteamRemoteStorage/GetPublishedFileDetails
//
// All results are cached to tools/mod-db-builder/cache/ to avoid re-fetching.
// Run: node tools/mod-db-builder/fetch-mods.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const KENSHI_APP_ID = '233860';
const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const CACHE_DIR = path.join(__dirname, 'cache');
const ALL_MODS_FILE = path.join(CACHE_DIR, 'all-mods.json');
const DETAILS_DIR = path.join(CACHE_DIR, 'details');

// Ensure cache directories exist
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(DETAILS_DIR)) fs.mkdirSync(DETAILS_DIR, { recursive: true });

// --- HTTP helpers ---

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function httpsPost(hostname, path, postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Step 1: Enumerate all Kenshi workshop mod IDs ---

async function enumerateAllMods() {
  if (!STEAM_API_KEY) {
    console.error('Error: STEAM_API_KEY environment variable is required.');
    console.error('Get a free key at: https://steamcommunity.com/dev/apikey');
    console.error('Then run: STEAM_API_KEY=your_key node tools/mod-db-builder/fetch-mods.js');
    process.exit(1);
  }

  // Check if we already have a cached list
  if (fs.existsSync(ALL_MODS_FILE)) {
    const cached = JSON.parse(fs.readFileSync(ALL_MODS_FILE, 'utf-8'));
    console.log(`[enumerate] Using cached mod list: ${cached.length} mods`);
    return cached;
  }

  console.log('[enumerate] Fetching all Kenshi workshop mod IDs...');
  const allMods = [];
  let cursor = '*';
  let page = 0;

  while (true) {
    page++;
    const url = 'https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/'
      + `?key=${STEAM_API_KEY}`
      + `&appid=${KENSHI_APP_ID}`
      + '&numperpage=100'
      + '&return_metadata=true'
      + '&return_tags=true'
      + '&query_type=1' // ranked by publication date
      + `&cursor=${encodeURIComponent(cursor)}`;

    console.log(`[enumerate] Page ${page}, cursor: ${cursor.substring(0, 20)}..., total so far: ${allMods.length}`);

    let json;
    try {
      json = await httpsGet(url);
    } catch (e) {
      console.error(`[enumerate] Error on page ${page}: ${e.message}. Retrying in 5s...`);
      await sleep(5000);
      continue;
    }

    const response = json?.response;
    if (!response) {
      console.error('[enumerate] No response object, stopping.');
      break;
    }

    const items = response.publishedfiledetails || [];
    if (items.length === 0) {
      console.log('[enumerate] No more items. Done.');
      break;
    }

    for (const item of items) {
      allMods.push({
        publishedfileid: item.publishedfileid,
        title: item.title || '',
        filename: item.filename || '',
        tags: (item.tags || []).map((t) => t.tag || t.display_name || '').filter(Boolean),
        short_description: item.short_description || '',
        time_created: item.time_created,
        time_updated: item.time_updated,
      });
    }

    // Cache each page
    const pageCachePath = path.join(CACHE_DIR, `query_page_${page}.json`);
    fs.writeFileSync(pageCachePath, JSON.stringify(items, null, 2));

    cursor = response.next_cursor || '';
    if (!cursor || cursor === '*') {
      console.log('[enumerate] No next cursor. Done.');
      break;
    }

    // Small delay to be nice to Steam API
    await sleep(200);
  }

  console.log(`[enumerate] Total mods found: ${allMods.length}`);
  fs.writeFileSync(ALL_MODS_FILE, JSON.stringify(allMods, null, 2));
  return allMods;
}

// --- Step 2: Fetch full details for all mods ---

async function fetchFullDetails(modList) {
  console.log(`[details] Fetching full details for ${modList.length} mods...`);

  const BATCH_SIZE = 100; // Steam API limit per request
  const batches = [];
  for (let i = 0; i < modList.length; i += BATCH_SIZE) {
    batches.push(modList.slice(i, i + BATCH_SIZE));
  }

  let processed = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchFile = path.join(DETAILS_DIR, `batch_${i}.json`);

    // Skip already-fetched batches
    if (fs.existsSync(batchFile)) {
      processed += batches[i].length;
      continue;
    }

    const batch = batches[i];
    const ids = batch.map((m) => m.publishedfileid);

    // Build POST data (same format as lib/steam-api.js)
    const params = [`itemcount=${ids.length}`];
    ids.forEach((id, j) => {
      params.push(`publishedfileids[${j}]=${id}`);
    });
    const postData = params.join('&');

    let json;
    try {
      json = await httpsPost(
        'api.steampowered.com',
        '/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
        postData,
      );
    } catch (e) {
      console.error(`[details] Error on batch ${i}: ${e.message}. Retrying in 5s...`);
      await sleep(5000);
      i--; // retry this batch
      continue;
    }

    const items = json?.response?.publishedfiledetails || [];
    const details = [];
    for (const item of items) {
      if (item.result === 1) {
        details.push({
          publishedfileid: item.publishedfileid,
          title: item.title || '',
          filename: item.filename || '',
          description: item.description || '',
          tags: (item.tags || []).map((t) => t.tag).filter(Boolean),
          time_created: item.time_created,
          time_updated: item.time_updated,
          creator: item.creator || '',
        });
      }
    }

    fs.writeFileSync(batchFile, JSON.stringify(details, null, 2));
    processed += batch.length;
    console.log(`[details] Batch ${i + 1}/${batches.length} — ${processed}/${modList.length} processed (${details.length} valid)`);

    await sleep(300); // rate limit courtesy
  }

  // Merge all detail batches into a single file
  console.log('[details] Merging all batches...');
  const allDetails = [];
  const batchFiles = fs.readdirSync(DETAILS_DIR)
    .filter((f) => f.startsWith('batch_') && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0], 10);
      const numB = parseInt(b.match(/\d+/)[0], 10);
      return numA - numB;
    });

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(DETAILS_DIR, file), 'utf-8'));
    allDetails.push(...data);
  }

  const outputFile = path.join(CACHE_DIR, 'all-details.json');
  fs.writeFileSync(outputFile, JSON.stringify(allDetails, null, 2));
  console.log(`[details] Saved ${allDetails.length} mod details to ${outputFile}`);
  return allDetails;
}

// --- Main ---

async function main() {
  console.log('=== Kenshi Mod Database Builder — Steam Fetch ===\n');

  const modList = await enumerateAllMods();
  console.log('');

  const details = await fetchFullDetails(modList);
  console.log('');

  console.log(`Done! ${details.length} mods with full details cached.`);
  console.log(`Cache location: ${CACHE_DIR}`);
  console.log('\nNext step: run categorization via Claude Code.');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
