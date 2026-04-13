# BEEP Mod Database Builder — Implementation Plan

## Goal
Build a separate Node.js tool that auto-categorizes all ~20,832 Kenshi Steam Workshop mods into load order categories. The output is a `mod-database.json` file that ships with BEEP Kenshi Mod Manager, powering the "Auto-Sort" button so users never need to manually sort or use AI chat.

## How it works
1. **Fetch all Kenshi mods from Steam API** — use the IPublishedFileService/QueryFiles endpoint to page through all workshop items (appid 233860), collecting workshop ID, filename, title, description, and tags
2. **Batch-process with Claude API** — send mod descriptions in batches of ~50-100 to Claude, asking it to assign each mod to one of the standard Kenshi load order categories
3. **Output mod-database.json** — format: `{ "ModFilename.mod": "Category Name", ... }`
4. **Incremental updates** — track which mods have been categorized, only process new/updated mods on subsequent runs

## Categories (matching BEEP's defaults)
- UI, Graphics, Performance
- Animations
- New Races & Race Edits
- Animals
- Game Starts
- Faction Edits & Additions
- Buildings
- Armor & Weapons
- Overhauls & World Changes
- Patches
- Economy

## Technical Details

### Steam API
- Endpoint: `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/`
- Params: `appid=233860`, `numperpage=100`, `return_metadata=true`, `return_short_description=true`
- Page through with `cursor` parameter
- Rate limit: ~100K calls/day, we need ~210 pages = trivial
- No API key required for public data

### Claude API
- Use `@anthropic-ai/sdk` npm package
- Model: claude-sonnet (fast, cheap, good enough for categorization)
- Each batch: ~50 mods with title + truncated description (first 200 chars)
- Estimated ~420 API calls for 20K mods
- Cost: ~$1-2 total (sonnet pricing)
- Prompt: provide the category list + Kenshi load order guide context, ask for JSON output mapping each filename to a category

### Database Format
```json
{
  "Dark UI.mod": "UI, Graphics, Performance",
  "AnimationOverhaul.mod": "Animations",
  "Reactive World.mod": "Overhauls & World Changes"
}
```
~1MB uncompressed, ~200-300KB compressed

### File Structure
```
kenshi-mod-database-builder/
  index.js          — main script
  fetch-mods.js     — Steam API fetcher, outputs raw mod data
  categorize.js     — Claude API batch categorizer
  merge.js          — merges new results with existing database
  mod-database.json — output file (copy to BEEP app folder)
  cache/            — cached Steam API responses
```

### Workflow for the developer (Derthi)
1. Run `node index.js` — fetches new mods, categorizes them, updates database
2. Copy `mod-database.json` to the BEEP app folder
3. Commit and release — users get the updated database with the next version
4. Optionally: auto-push to GitHub so BEEP can fetch the latest database on launch

## Integration with BEEP Mod Manager
- Auto-Sort button already exists in v1.2.4 (reads `mod-database.json`)
- Ctrl+Shift+B builds database from current user categories (seeds the database)
- Future: BEEP could fetch latest `mod-database.json` from GitHub on launch (like auto-update but just for the database)

## Phase 1: MVP
- Fetch all mods from Steam
- Categorize with Claude in batches
- Output mod-database.json
- Manual copy to BEEP folder

## Phase 2: Polish
- Incremental updates (only new mods)
- Confidence scoring (skip uncertain categorizations)
- Nexus Mods support
- Auto-fetch latest database in BEEP on launch

## Notes
- The BEEP app's Ctrl+Shift+B shortcut can seed the initial database from the developer's own categorized mod list — good starting point before running Claude on the rest
- Some mods won't have useful descriptions — those get left as "Uncategorized"
- Patches should be auto-detected by checking if the title/description references other mods
