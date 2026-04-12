# BEEP Kenshi Mod Manager

**Beep Enhances Every Playthrough**

A lightweight Electron-based mod load order manager for [Kenshi](https://store.steampowered.com/app/233860/Kenshi/). Organize your mods into categories, detect conflicts at every level, and get AI-assisted sorting suggestions.

[Steam Workshop Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3704937622)

## Features

- **Category-based sorting** — Organize mods into customizable categories (UI, Animations, Races, Weapons, etc.) displayed as columns. Load order reads left-to-right, top-to-bottom.
- **Drag and drop** — Reorder mods within and between categories. Drag column headers to reorder categories.
- **Pin Uncategorized** — Pin uncategorized mods to a resizable side panel so you can scroll and sort them into categories easily.
- **Horizontal & vertical layouts** — Toggle between column view and stacked list view.

### Conflict Detection
- **Deep conflict detection** — Parses .mod binary files, leveldata, and interior data to detect when multiple mods modify the same game data. Shows actual conflicting values inline with expandable property details.
- **Asset override detection** — Scans mod directories for file-level overrides (meshes, textures, sounds) where one mod's files replace another's.
- **Level data parsing** — Deep-parses .level files to detect exterior (world placement) and interior (building layout) conflicts at the item/property level, filtering out false positives where values are identical.
- **Three-way conflict indicators** — Green (winning), red (overridden), and yellow (both overridden by a third mod) for clear conflict visualization.
- **Interactive conflict map** — 4K Kenshi world map showing conflict zones with zoom, pan, and a sidebar listing conflicts grouped by winning mod. Toggle between exterior and interior conflict layers.

### Other Features
- **Dependency warnings** — Highlights mods that load before their dependencies (orange) or after mods that need them (yellow).
- **AI-assisted sorting** — Export your mod list with full Steam Workshop descriptions, paste it into an AI chatbot (Claude, ChatGPT), and import the sorted result. Supports compact mode for large mod lists (500+).
- **Mod packs** — Save and load complete mod configurations (categories, order, active/inactive state).
- **Kenshi & Dark themes** — Toggle between a warm Kenshi-inspired theme with grain texture and a dark grey theme.
- **Steam auto-detection** — Automatically finds your Kenshi installation and Steam Workshop folder.
- **Mod preview images** — Displays Steam Workshop thumbnails in the detail panel.
- **Integrated browsing** — View mod Steam/Nexus pages, the Kenshi load order guide, and the Steam Workshop directly in the app.
- **Auto-update** — Checks for updates on launch and notifies you when a new version is available.
- **Launch game** — Save your load order and launch Kenshi directly from the app.

## Install

### From release (recommended)

1. Download the latest release from the [Releases](https://github.com/Derthi/BEEP-Kenshi-Mod-Manager/releases) page.
2. Extract anywhere.
3. Run `BEEP Kenshi Mod Manager.exe`.

### From source

```bash
git clone https://github.com/Derthi/BEEP-Kenshi-Mod-Manager.git
cd BEEP-Kenshi-Mod-Manager
npm install
npm start
```

### Build

```bash
npm run build
```

Output is in `dist/win-unpacked/`.

## How it works

- Mods are discovered from `{GamePath}/Mods/` (local) and Steam Workshop (`steamapps/workshop/content/233860/`).
- Mod metadata (author, description, dependencies) is read from the binary `.mod` file header.
- Conflict detection parses `.mod` files for data conflicts, `.level` files for world/interior conflicts, and scans directories for asset overrides.
- Load order is saved to `{GamePath}/data/mods.cfg` — the same file Kenshi reads.
- Categories, mod assignments, and ordering are persisted in `%APPDATA%/kenshi-mod-sorter/config.json`.

## AI Sort

The AI Sort feature generates a text file containing your mod names and descriptions, which you paste into an AI chatbot. The AI sorts them into categories based on the [Kenshi mod load order guide](https://steamcommunity.com/sharedfiles/filedetails/?id=1850250979). You then paste the response back into the app to apply the order.

No data is sent automatically — you are the middleman. The app only contacts Steam's public API to fetch mod descriptions.

Export modes:
- **Uncategorized Only** — Only unsorted mods, full descriptions
- **Uncategorized Compact** — Unsorted mods with tags + truncated descriptions (best for 50+ mods)
- **All Mods Compact** — Everything in one file with tags + short descriptions (handles 500+ mods)
- **All Mods Full** — Complete descriptions (most accurate, largest file)
- **Split Batches** — Multiple files with ~50 mods each

## License

[MIT](LICENSE)
