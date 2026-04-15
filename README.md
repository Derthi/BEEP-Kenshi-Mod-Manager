# BEEP Kenshi Mod Manager

**Beep Enhances Every Playthrough**

A lightweight Electron-based mod load order manager for [Kenshi](https://store.steampowered.com/app/233860/Kenshi/). Works with both **Steam** and **GOG** installations. Organize your mods into categories, detect conflicts at every level, visualize them on the world map, and get AI-assisted sorting suggestions.

[Steam Workshop Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3704937622)

[Discord](https://discord.gg/QvFTmRKHSz)

## Features

### Mod Sorting
- **Category-based sorting** — Organize mods into customizable categories (UI, Animations, Races, Weapons, etc.) displayed as columns. Load order reads left-to-right, top-to-bottom.
- **Drag and drop** — Reorder mods within and between categories. Drag column headers to reorder entire categories.
- **Multi-select** — Ctrl+click to toggle, Shift+click for range select. Right-click to move all selected mods to a category at once.
- **Group drag** — Drag multiple selected mods together with a visual preview of all mod names.
- **Pin Uncategorized** — Pin uncategorized mods to a resizable side panel for easy sorting.
- **Horizontal & vertical layouts** — Toggle between column view and stacked list view.
- **Preserved load order** — First launch respects your existing mods.cfg load order instead of alphabetical.

### Categories
- **Click to rename** — Click category names directly to rename them.
- **Inline controls** — Arrow buttons to reorder, color picker, collapse/expand, and delete on every header.
- **Position picker** — Choose where new categories appear when creating them.
- **Reset Categories** — Restore the default category set.

### Dependency Detection
- **Missing dependency warnings** — Mods with uninstalled dependencies are highlighted in red.
- **Inactive dependency detection** — Dependencies that exist but are disabled are flagged.
- **Load order validation** — Dependencies that load after the mods that need them are caught.
- **Hover for details** — Hover over red-highlighted mods to see the specific dependency issue.
- **Status bar alerts** — Summary of all dependency problems shown in the status bar, updated in real-time.
- **Detail panel** — Missing dependencies shown in red in the Dependencies/References rows.

### Conflict Detection
- **Deep conflict detection** — Parses .mod binary files, leveldata, and interior data to detect when multiple mods modify the same game data.
- **Actual values shown** — Expand any conflicting property to see what each mod sets, with the winning value highlighted in green.
- **Same-value filtering** — Conflicts where all mods set identical values are hidden (no false positives from FCS saving unchanged properties).
- **Asset override detection** — Scans mod directories for file-level overrides (meshes, textures, sounds) where one mod's files replace another's.
- **Level data parsing** — Deep-parses .level files to detect exterior (world placement) and interior (building layout) conflicts at the item/property level.
- **Three-way conflict indicators** — Green (winning), red (overridden), and yellow (both overridden by a third mod).
- **Focus mode** — Dims all non-conflicting mods to 15% opacity for easy identification.

### Interactive Conflict Map
- **4K Kenshi world map** — Converted from the game's GUI map texture.
- **Conflict zone overlays** — Red squares highlight zones with conflicts, click to see details.
- **Zoom and pan** — Scroll wheel to zoom toward cursor, click and drag to pan.
- **Exterior/Interior toggle** — Switch between viewing world placement and building interior conflicts.
- **Sidebar grouped by winning mod** — Collapsible mod groups with zone sub-items showing conflicting mods and properties.
- **Click-to-focus** — Click a zone on the map to scroll the sidebar to details. Click zone filenames in the conflicts tab to open the map.

### Import & Export
- **Export List** — Save your full setup (categories, load order, active/inactive state) to a shareable text file.
- **Import List (BEEP format)** — Restore categories, ordering, and active state from a BEEP export file.
- **Import List (generic)** — Import a plain list of .mod filenames to reorder uncategorized mods.
- **Mod Packs** — Save and load complete mod configurations. Great for switching between playthroughs or backing up before AI sort.

### AI-Assisted Sorting
- **AI Sort Export** — Fetches Steam Workshop descriptions and builds a text file for AI chatbots.
- **AI Sort Import** — Paste the AI's sorted response to apply the new category order.
- No data is sent automatically — you are the middleman. The app only contacts Steam's public API.
- Supports Claude (recommended for large lists) and ChatGPT.

### Other Features
- **Steam & GOG support** — Auto-detects Kenshi from Steam libraries, GOG Galaxy registry, and common install paths on all drives.
- **Folder Setup** — Easily change or clear game paths from the toolbar or welcome screen.
- **Kenshi & Dark themes** — Toggle between a warm Kenshi-inspired theme with grain texture and a dark grey theme.
- **Built-in tutorial** — Full usage guide accessible from the Tutorial tab.
- **Mod preview images** — Displays Steam Workshop thumbnails in the detail panel.
- **Integrated browsing** — View mod Steam/Nexus pages, the Kenshi modding guide, and the Steam Workshop directly in the app.
- **Auto-update** — Checks for updates on launch and notifies you with download links.
- **Launch game** — Save your load order and launch Kenshi directly from the app.
- **GitHub link** — Quick access to the project repository from the toolbar.

## Install

### From release (recommended)

1. Download the latest release from the [Releases](https://github.com/Derthi/BEEP-Kenshi-Mod-Manager/releases) page.
2. Extract anywhere.
3. Run `BEEP Kenshi Mod Manager.exe`.

Works with both **Steam** and **GOG** versions of Kenshi. Windows 64-bit only.

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
- Dependencies are matched using case-insensitive substring matching.
- Conflict detection parses `.mod` files for data conflicts, `.level` files for world/interior conflicts, and scans directories for asset overrides.
- Level data items with zone coordinates are mapped to the Kenshi world map for visual conflict display.
- Load order is saved to `{GamePath}/data/mods.cfg` — the same file Kenshi reads.
- Categories, mod assignments, and ordering are persisted in `%APPDATA%/kenshi-mod-sorter/config.json`.

## AI Sort Export Modes

- **Uncategorized Only** — Only unsorted mods, full descriptions (recommended)
- **Uncategorized Compact** — Unsorted mods with tags + truncated descriptions (best for 50+ mods)
- **All Mods Compact** — Everything in one file with tags + short descriptions (handles 500+ mods)
- **All Mods Full** — Complete descriptions (most accurate, largest file)
- **Split Batches** — Multiple files with ~50 mods each

## License

[MIT](LICENSE)
