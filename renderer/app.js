// State
let mods = [];
let selectedMod = null;
let config = null;
let categories = []; // { id, name, color, order }
let modCategories = {}; // filename -> categoryId
let modOrders = {}; // categoryId -> [filename, ...]
let contextTarget = null; // category id for context menu
let verticalLayout = false;
let conflictData = null; // { modConflicts, totalConflicts, parseErrors }
let selectedMods = new Set(); // multi-select filenames
let lastClickedMod = null; // for shift-click range select
let uncategorizedPinned = false;
let tutorialDismissed = false;
let minimizedCategories = new Set();
let justMovedMods = new Set();

const UNCATEGORIZED = 'uncategorized';

// ===== Modal Prompt (replaces window.prompt) =====

function showInputModal(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('input-modal');
    const input = document.getElementById('input-modal-input');
    const okBtn = document.getElementById('input-modal-ok');
    const cancelBtn = document.getElementById('input-modal-cancel');
    const titleEl = document.getElementById('input-modal-title');

    titleEl.textContent = title;
    input.value = defaultValue || '';
    overlay.classList.remove('hidden');
    input.focus();
    input.select();

    function cleanup() {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }

    function onOk() {
      cleanup();
      resolve(input.value);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function showConfirmModal(title) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('input-modal');
    const input = document.getElementById('input-modal-input');
    const okBtn = document.getElementById('input-modal-ok');
    const cancelBtn = document.getElementById('input-modal-cancel');
    const titleEl = document.getElementById('input-modal-title');

    titleEl.textContent = title;
    input.classList.add('hidden');
    overlay.classList.remove('hidden');
    okBtn.focus();

    function cleanup() {
      overlay.classList.add('hidden');
      input.classList.remove('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// DOM refs
const setupScreen = document.getElementById('setup-screen');
const mainScreen = document.getElementById('main-screen');
const gamePathInput = document.getElementById('game-path-input');
const steamPathInput = document.getElementById('steam-path-input');
const gamePathBtn = document.getElementById('game-path-btn');
const steamPathBtn = document.getElementById('steam-path-btn');
const continueBtn = document.getElementById('setup-continue-btn');
const columnsContainer = document.getElementById('category-columns');
const modCount = document.getElementById('mod-count');
const statusBar = document.getElementById('status-bar');
const refreshBtn = document.getElementById('refresh-btn');
const saveBtn = document.getElementById('save-btn');
const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const addCategoryBtn = document.getElementById('add-category-btn');
const contextMenu = document.getElementById('context-menu');
const colorPicker = document.getElementById('color-picker');

// ===== Setup Screen =====

const autoDetectBtn = document.getElementById('auto-detect-btn');
const autoDetectStatus = document.getElementById('auto-detect-status');

async function autoDetect() {
  autoDetectStatus.textContent = 'Searching...';
  autoDetectStatus.className = 'auto-detect-status';
  autoDetectBtn.disabled = true;
  try {
    const result = await window.api.detectSteam();
    if (result && result.gamePath) {
      gamePathInput.value = result.gamePath;
      if (result.steamModsPath) steamPathInput.value = result.steamModsPath;
      autoDetectStatus.textContent = 'Found Kenshi installation!';
      autoDetectStatus.className = 'auto-detect-status success';
      updateContinueBtn();
    } else {
      autoDetectStatus.textContent = 'Could not find Kenshi. Use Browse to set paths manually.';
      autoDetectStatus.className = 'auto-detect-status error';
    }
  } catch {
    autoDetectStatus.textContent = 'Detection failed. Use Browse to set paths manually.';
    autoDetectStatus.className = 'auto-detect-status error';
  }
  autoDetectBtn.disabled = false;
}

autoDetectBtn.addEventListener('click', autoDetect);

gamePathBtn.addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) { gamePathInput.value = folder; updateContinueBtn(); }
});

steamPathBtn.addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) steamPathInput.value = folder;
});

function updateContinueBtn() {
  continueBtn.disabled = !gamePathInput.value;
}

continueBtn.addEventListener('click', async () => {
  config.gamePath = gamePathInput.value;
  config.steamModsPath = steamPathInput.value || '';
  await persistConfig();
  showMainScreen();
});

// ===== Main Screen =====

async function showMainScreen() {
  setupScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  await loadMods();
}

async function loadMods() {
  setStatus('Loading mods...');
  try {
    mods = await window.api.discoverMods(config);
    applyCategoriesToMods();

    // Preserve mods.cfg load order for uncategorized mods on first load
    if (!modOrders[UNCATEGORIZED] || modOrders[UNCATEGORIZED].length === 0) {
      const uncatMods = mods.filter((m) => m.category === UNCATEGORIZED);
      // Sort by mods.cfg order (active mods first in load order, then inactive)
      uncatMods.sort((a, b) => {
        if (a.order >= 0 && b.order >= 0) return a.order - b.order;
        if (a.order >= 0) return -1;
        if (b.order >= 0) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
      modOrders[UNCATEGORIZED] = uncatMods.map((m) => m.filename);
    }

    selectedMod = null;
    renderColumns();
    const activeCount = mods.filter((m) => m.active).length;
    modCount.textContent = `${mods.length} mods, ${activeCount} active`;
    setStatus('Ready');
  } catch (err) {
    setStatus('Error loading mods: ' + err.message, 'error');
  }
}

function applyCategoriesToMods() {
  for (const mod of mods) {
    const catId = modCategories[mod.filename];
    if (catId && (catId === UNCATEGORIZED || categories.find((c) => c.id === catId))) {
      mod.category = catId;
    } else {
      mod.category = UNCATEGORIZED;
    }
  }
}

refreshBtn.addEventListener('click', loadMods);

const settingsBtn = document.getElementById('settings-btn');
settingsBtn.addEventListener('click', () => {
  gamePathInput.value = config.gamePath || '';
  steamPathInput.value = config.steamModsPath || '';
  autoDetectStatus.textContent = '';
  autoDetectStatus.className = 'auto-detect-status';
  updateContinueBtn();
  mainScreen.classList.add('hidden');
  setupScreen.classList.remove('hidden');
});

// Layout toggle
const layoutToggleBtn = document.getElementById('layout-toggle-btn');
layoutToggleBtn.addEventListener('click', () => {
  verticalLayout = !verticalLayout;
  columnsContainer.classList.toggle('vertical', verticalLayout);
  layoutToggleBtn.title = verticalLayout ? 'Switch to horizontal layout' : 'Switch to vertical layout';
  renderColumns();
});

// Theme toggle
const themeToggleCb = document.getElementById('theme-toggle-cb');
themeToggleCb.addEventListener('change', () => {
  document.body.classList.toggle('kenshi-theme', themeToggleCb.checked);
  persistConfig();
});

// Tutorial modal
const tutorialModal = document.getElementById('tutorial-modal');
const tutorialOkBtn = document.getElementById('tutorial-ok-btn');
const tutorialDismissCb = document.getElementById('tutorial-dismiss-cb');

tutorialOkBtn.addEventListener('click', () => {
  tutorialModal.classList.add('hidden');
  if (tutorialDismissCb.checked) {
    tutorialDismissed = true;
    persistConfig();
  }
});

const tutorialShowBtn = document.getElementById('tutorial-show-btn');
tutorialShowBtn.addEventListener('click', () => {
  tutorialModal.classList.add('hidden');
  if (tutorialDismissCb.checked) {
    tutorialDismissed = true;
    persistConfig();
  }
  switchTab(tabTutorial);
});

// Pin Uncategorized toggle
const pinUncatBtn = document.getElementById('pin-uncat-btn');
pinUncatBtn.addEventListener('click', () => {
  uncategorizedPinned = !uncategorizedPinned;
  pinUncatBtn.classList.toggle('btn-pinned-active', uncategorizedPinned);
  pinUncatBtn.textContent = uncategorizedPinned ? 'Unpin Uncategorized' : 'Pin Uncategorized';
  persistConfig();
  renderColumns();
});

// ===== Panel Resize =====

const resizeHandle = document.getElementById('panel-resize-handle');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = 'none');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const contentRect = document.querySelector('.content').getBoundingClientRect();
  let newWidth = e.clientX - contentRect.left;
  if (newWidth < 100) newWidth = 100;
  if (newWidth > contentRect.width - 100) newWidth = contentRect.width - 100;
  detailPanel.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = '');
  }
});

// ===== Pinned Panel Resize =====

const pinnedResizeHandle = document.getElementById('pinned-resize-handle');
const pinnedPanel = document.getElementById('pinned-uncat-panel');
let isPinnedResizing = false;

pinnedResizeHandle.addEventListener('mousedown', (e) => {
  isPinnedResizing = true;
  pinnedResizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = 'none');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isPinnedResizing) return;
  const panelRect = pinnedPanel.getBoundingClientRect();
  let newWidth = e.clientX - panelRect.left;
  if (newWidth < 150) newWidth = 150;
  if (newWidth > 500) newWidth = 500;
  pinnedPanel.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (isPinnedResizing) {
    isPinnedResizing = false;
    pinnedResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = '');
  }
});

// Horizontal scroll wheel support
columnsContainer.addEventListener('wheel', (e) => {
  if (!verticalLayout) {
    e.preventDefault();
    columnsContainer.scrollLeft += e.deltaY;
  }
}, { passive: false });

// ===== Drag Auto-Scroll =====

let dragMouseX = -1;
let dragMouseY = -1;
let dragScrollInterval = null;

function onDragMove(e) {
  dragMouseX = e.clientX;
  dragMouseY = e.clientY;
}

function scrollTick() {
  const edge = 50;
  const speed = 6;
  const x = dragMouseX;
  const y = dragMouseY;

  if (x < 0 || y < 0) return; // no mouse position yet

  // Scroll the columns container
  const rect = columnsContainer.getBoundingClientRect();
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
    if (verticalLayout) {
      if (y - rect.top < edge) columnsContainer.scrollTop -= speed;
      else if (rect.bottom - y < edge) columnsContainer.scrollTop += speed;
    } else {
      if (x - rect.left < edge) columnsContainer.scrollLeft -= speed;
      else if (rect.right - x < edge) columnsContainer.scrollLeft += speed;
    }
  }

  // Scroll individual column mod lists
  for (const col of document.querySelectorAll('.column-mods')) {
    const cr = col.getBoundingClientRect();
    if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) {
      if (y - cr.top < edge) col.scrollTop -= speed;
      else if (cr.bottom - y < edge) col.scrollTop += speed;
    }
  }
}

document.addEventListener('dragstart', () => {
  document.addEventListener('dragover', onDragMove);
  dragScrollInterval = setInterval(scrollTick, 16);
});
document.addEventListener('dragend', () => {
  document.removeEventListener('dragover', onDragMove);
  if (dragScrollInterval) { clearInterval(dragScrollInterval); dragScrollInterval = null; }
  dragMouseX = -1;
  dragMouseY = -1;
});

saveBtn.addEventListener('click', async () => {
  const ordered = computeLoadOrder();
  setStatus('Saving load order...');
  const result = await window.api.saveLoadOrder({
    gamePath: config.gamePath,
    activeModFilenames: ordered,
  });
  if (result.success) {
    setStatus('Load order saved successfully!', 'success');
  } else {
    setStatus('Error saving: ' + result.error, 'error');
  }
});

// Play button — save load order then launch game
const playBtn = document.getElementById('play-btn');
playBtn.addEventListener('click', async () => {
  // Save first
  const ordered = computeLoadOrder();
  setStatus('Saving and launching...');
  const saveResult = await window.api.saveLoadOrder({
    gamePath: config.gamePath,
    activeModFilenames: ordered,
  });
  if (!saveResult.success) {
    setStatus('Error saving: ' + saveResult.error, 'error');
    return;
  }

  const launchResult = await window.api.launchGame(config.gamePath);
  if (launchResult.success) {
    setStatus('Kenshi launched!', 'success');
  } else {
    setStatus('Error launching: ' + launchResult.error, 'error');
  }
});

// ===== Conflict Detection =====

const generateConflictsBtn = document.getElementById('generate-conflicts-btn');

async function runConflictCheck() {
  const ordered = computeLoadOrder();
  const activeMods = ordered.map((filename) => {
    const mod = mods.find((m) => m.filename === filename);
    return mod ? { filename: mod.filename, filePath: mod.filePath } : null;
  }).filter(Boolean);

  if (activeMods.length === 0) {
    setStatus('No active mods to check.', 'error');
    return;
  }

  setStatus(`Scanning ${activeMods.length} mods for conflicts...`);
  generateConflictsBtn.disabled = true;

  try {
    conflictData = await window.api.generateConflicts(activeMods);
    const conflictModCount = Object.keys(conflictData.modConflicts).length;
    if (conflictData.totalConflicts > 0) {
      setStatus(`Found ${conflictData.totalConflicts} conflicts across ${conflictModCount} mods.`, 'error');
    } else {
      setStatus('No conflicts found!', 'success');
    }
    renderColumns(); // re-render to show conflict indicators
  } catch (err) {
    setStatus('Error checking conflicts: ' + err.message, 'error');
  }

  generateConflictsBtn.disabled = false;
}

generateConflictsBtn.addEventListener('click', runConflictCheck);

// ===== Export / Import Mod List =====

const exportListBtn = document.getElementById('export-list-btn');
const importListBtn = document.getElementById('import-list-btn');

exportListBtn.addEventListener('click', async () => {
  const filePath = await window.api.saveFileDialog('BEEP-mod-list.txt');
  if (!filePath) return;

  // Build full export: categories + order + active state
  const lines = ['# BEEP Kenshi Mod Manager - Mod List Export', '# Format: [Category] then filename|active/inactive', ''];

  const sorted = [...categories].sort((a, b) => a.order - b.order);
  sorted.push({ id: UNCATEGORIZED, name: 'Uncategorized', color: '#555' });

  for (const cat of sorted) {
    const catMods = getModsForCategory(cat.id);
    if (catMods.length === 0) continue;
    lines.push(`[${cat.name}]`);
    for (const mod of catMods) {
      lines.push(`${mod.filename}|${mod.active ? 'active' : 'inactive'}`);
    }
    lines.push('');
  }

  await window.api.writeFile(filePath, lines.join('\n'));
  setStatus('Mod list exported!', 'success');
});

importListBtn.addEventListener('click', async () => {
  const file = await window.api.openFileDialog([{ name: 'Text Files', extensions: ['txt'] }]);
  if (!file) return;

  const content = file.content;
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  // Detect format: BEEP export (has [Category] headers + |active/inactive) or generic (just filenames)
  const hasCategories = lines.some((l) => l.startsWith('['));
  const hasPipes = lines.some((l) => l.includes('|'));
  const isBeepFormat = hasCategories && hasPipes;

  if (isBeepFormat) {
    // Full BEEP import: categories, order, active state
    let currentCat = null;
    const catMap = {}; // catName -> [{ filename, active }]

    for (const line of lines) {
      const catMatch = line.match(/^\[(.+)\]$/);
      if (catMatch) {
        currentCat = catMatch[1];
        if (!catMap[currentCat]) catMap[currentCat] = [];
        continue;
      }
      if (!currentCat) continue;
      const parts = line.split('|');
      const filename = parts[0].trim();
      const active = parts.length > 1 ? parts[1].trim() === 'active' : true;
      if (filename.endsWith('.mod')) {
        catMap[currentCat].push({ filename, active });
      }
    }

    // Apply: create missing categories, assign mods
    for (const [catName, catMods] of Object.entries(catMap)) {
      let catId;
      if (catName === 'Uncategorized') {
        catId = UNCATEGORIZED;
      } else {
        let cat = categories.find((c) => c.name === catName);
        if (!cat) {
          cat = { id: generateId(), name: catName, color: '#' + Math.floor(Math.random() * 0xCCCCCC + 0x333333).toString(16), order: categories.length };
          categories.push(cat);
        }
        catId = cat.id;
      }

      modOrders[catId] = [];
      for (const { filename, active } of catMods) {
        const mod = mods.find((m) => m.filename === filename);
        if (!mod) continue;
        mod.category = catId;
        mod.active = active;
        if (catId !== UNCATEGORIZED) modCategories[mod.filename] = catId;
        else delete modCategories[mod.filename];
        modOrders[catId].push(mod.filename);
      }
    }

    syncModCategories();
    persistConfig();
    renderColumns();
    setStatus(`Imported BEEP mod list (${Object.keys(catMap).length} categories).`, 'success');
  } else {
    // Generic import: just a list of .mod filenames — apply as uncategorized order
    const filenames = lines.filter((l) => l.endsWith('.mod'));
    if (filenames.length === 0) {
      setStatus('No .mod filenames found in file.', 'error');
      return;
    }

    // Reorder uncategorized mods to match the import list
    const newOrder = [];
    for (const fn of filenames) {
      const mod = mods.find((m) => m.filename === fn);
      if (mod) {
        mod.category = UNCATEGORIZED;
        delete modCategories[mod.filename];
        newOrder.push(fn);
      }
    }
    // Append any uncategorized mods not in the list
    for (const mod of mods) {
      if (mod.category === UNCATEGORIZED && !newOrder.includes(mod.filename)) {
        newOrder.push(mod.filename);
      }
    }
    modOrders[UNCATEGORIZED] = newOrder;

    syncModCategories();
    persistConfig();
    renderColumns();
    setStatus(`Imported generic mod list (${filenames.length} mods reordered in Uncategorized).`, 'success');
  }
});

// ===== Auto-Sort from Database =====

const autoSortBtn = document.getElementById('auto-sort-btn');

autoSortBtn.addEventListener('click', async () => {
  setStatus('Loading mod database...');
  const db = await window.api.loadModDatabase();
  if (!db) {
    setStatus('No mod database found (mod-database.json).', 'error');
    return;
  }

  // db format: { "filename.mod": "Category Name", ... }
  let sorted = 0;
  let created = 0;

  for (const mod of mods) {
    if (mod.category !== UNCATEGORIZED) continue; // skip already-categorized
    const catName = db[mod.filename];
    if (!catName) continue;

    // Find or create the category
    let cat = categories.find((c) => c.name === catName);
    if (!cat) {
      cat = { id: generateId(), name: catName, color: randomColor(), order: categories.length };
      categories.push(cat);
      modOrders[cat.id] = [];
      created++;
    }

    // Move mod to category (skip render)
    moveMod(mod, cat.id, null, true);
    sorted++;
  }

  if (sorted > 0) {
    syncModCategories();
    persistConfig();
    renderColumns();
    setStatus(`Auto-sorted ${sorted} mods into categories (${created} new categories created).`, 'success');
  } else {
    setStatus('No uncategorized mods matched the database.', 'error');
  }
});

// Build database from current categories (dev tool — Ctrl+Shift+B)
document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'B') {
    const db = {};
    for (const mod of mods) {
      if (mod.category === UNCATEGORIZED) continue;
      const cat = categories.find((c) => c.id === mod.category);
      if (cat) db[mod.filename] = cat.name;
    }
    const count = Object.keys(db).length;
    const dbPath = await window.api.saveModDatabase(db);
    setStatus(`Database built: ${count} mods saved to ${dbPath}`, 'success');
  }
});

// ===== Update Check =====

const updateBtn = document.getElementById('update-btn');
updateBtn.addEventListener('click', async () => {
  setStatus('Checking for updates...');
  updateBtn.disabled = true;

  const info = await window.api.checkForUpdate();
  if (!info) {
    setStatus('Could not check for updates.', 'error');
    updateBtn.disabled = false;
    return;
  }

  if (!info.hasUpdate) {
    setStatus(`You're on the latest version (v${info.currentVersion}).`, 'success');
    updateBtn.disabled = false;
    return;
  }

  if (!info.downloadUrl) {
    setStatus(`Update v${info.latestVersion} available! Download manually from GitHub.`, 'success');
    updateBtn.disabled = false;
    return;
  }

  const confirmed = await showConfirmModal(
    `Update available: v${info.currentVersion} → v${info.latestVersion}\n\nDownload and install? The app will restart automatically.`
  );
  if (!confirmed) {
    updateBtn.disabled = false;
    setStatus('Update cancelled.');
    return;
  }

  setStatus(`Downloading v${info.latestVersion}...`);
  const result = await window.api.downloadUpdate(info.downloadUrl);
  if (result.success) {
    setStatus('Update installed! Restarting...', 'success');
  } else {
    setStatus('Update failed: ' + result.error, 'error');
    updateBtn.disabled = false;
  }
});

// ===== Update Modal =====

const updateModal = document.getElementById('update-modal');
const updateDismissBtn = document.getElementById('update-dismiss-btn');
updateDismissBtn.addEventListener('click', () => updateModal.classList.add('hidden'));

async function autoCheckForUpdate() {
  const info = await window.api.checkForUpdate();
  if (!info || !info.hasUpdate) return;

  document.getElementById('update-version-text').textContent =
    `v${info.currentVersion} → v${info.latestVersion}`;

  const downloadLink = document.getElementById('update-download-link');
  const githubLink = document.getElementById('update-github-link');

  const releaseUrl = info.releaseUrl || 'https://github.com/Derthi/BEEP-Kenshi-Mod-Manager/releases';

  if (info.downloadUrl) {
    downloadLink.onclick = () => { window.open(info.downloadUrl); };
  } else {
    downloadLink.classList.add('hidden');
  }

  githubLink.onclick = () => { window.open(releaseUrl); };

  updateModal.classList.remove('hidden');
}

// ===== Zone Map Modal =====

const zoneMapModal = document.getElementById('zone-map-modal');
const zoneMapClose = document.getElementById('zone-map-close');
const zoneMapContainer = document.getElementById('zone-map-container');
const zoneMapWrapper = document.getElementById('zone-map-wrapper');
const zoneMapImg = document.getElementById('zone-map-img');
const zoneMapOverlays = document.getElementById('zone-map-overlays');
const zoneSidebarList = document.getElementById('zone-sidebar-list');
const zoneShowAllBtn = document.getElementById('zone-show-all-btn');
const zoneLayerBtn = document.getElementById('zone-layer-btn');
const mapBtn = document.getElementById('map-btn');

let mapScale = 1;
let mapPanX = 0, mapPanY = 0;
let mapDragging = false;
let mapDragStartX = 0, mapDragStartY = 0;
let mapPanStartX = 0, mapPanStartY = 0;
let showAllZones = true;
let selectedZoneKey = null;
let zoneLayer = 'exterior'; // 'exterior' or 'interior'
let zoneConflicts = []; // [{ key, zx, zy, mods: [{ filename, winner }] }]
let allZoneConflicts = { exterior: [], interior: [] };

zoneMapClose.addEventListener('click', () => zoneMapModal.classList.add('hidden'));
zoneMapModal.addEventListener('click', (e) => {
  if (e.target === zoneMapModal) zoneMapModal.classList.add('hidden');
});

// Map button handler
mapBtn.addEventListener('click', async () => {
  if (!conflictData) {
    await runConflictCheck();
  }
  if (conflictData) openZoneMap();
});

function openZoneMap(focusZone) {
  // Extract zone-mappable conflicts, separated by layer
  const layers = { exterior: {}, interior: {} };

  const detailSeen = {}; // layer:zoneKey -> Set of detailKeys

  for (const [modFile, conflicts] of Object.entries(conflictData.modConflicts)) {
    for (const c of conflicts) {
      if (!c.type.startsWith('LEVEL:') || !c.zones) continue;

      const layer = c.type === 'LEVEL:INTERIORS' ? 'interior' : 'exterior';
      const zoneMap = layers[layer];

      for (const z of c.zones) {
        const key = `${z.zx},${z.zy}`;
        if (!zoneMap[key]) {
          zoneMap[key] = { key: `zone.${z.zx}.${z.zy}`, zx: z.zx, zy: z.zy, mods: {}, winner: c.winner, details: [] };
        }
        for (const m of c.allMods) {
          zoneMap[key].mods[m.filename] = { filename: m.filename, loadOrder: m.loadOrder };
        }
        zoneMap[key].winner = c.winner;

        const seenKey = `${layer}:${key}`;
        if (!detailSeen[seenKey]) detailSeen[seenKey] = new Set();
        const detailKey = `${c.type}|${c.name}|${c.key}`;
        if (!detailSeen[seenKey].has(detailKey)) {
          detailSeen[seenKey].add(detailKey);
          // Cap details to prevent massive lists
          if (zoneMap[key].details.length < 50) {
            zoneMap[key].details.push({ key: detailKey, type: c.type, name: c.name, prop: c.key, values: c.values, winner: c.winner });
          }
        }
      }
    }
  }

  const sortZones = (map) => Object.values(map).sort((a, b) => a.zy !== b.zy ? a.zy - b.zy : a.zx - b.zx);
  allZoneConflicts.exterior = sortZones(layers.exterior);
  allZoneConflicts.interior = sortZones(layers.interior);
  zoneConflicts = allZoneConflicts[zoneLayer];

  // Reset view
  mapScale = 1;
  mapPanX = 0;
  mapPanY = 0;
  // Convert zone filename to key format
  let focusKey = null;
  if (focusZone) {
    const m = focusZone.match(/zone\.(\d+)\.(\d+)/i);
    if (m) focusKey = `${parseInt(m[1])},${parseInt(m[2])}`;
  }
  selectedZoneKey = focusKey;
  showAllZones = true;
  zoneLayer = 'exterior';
  zoneShowAllBtn.textContent = 'Hide All Zones';
  zoneLayerBtn.textContent = 'Exterior';

  zoneMapModal.classList.remove('hidden');

  const init = () => {
    updateMapTransform();
    renderZoneOverlays();
    renderZoneSidebar();
    if (focusKey) selectZone(focusKey);
  };

  if (zoneMapImg.complete) {
    requestAnimationFrame(init);
  } else {
    zoneMapImg.onload = init;
  }
}

function updateMapTransform() {
  const containerW = zoneMapContainer.clientWidth;
  const containerH = zoneMapContainer.clientHeight;
  // Set image size based on scale
  const baseSize = Math.min(containerW, containerH);
  const imgSize = baseSize * mapScale;
  zoneMapImg.style.width = imgSize + 'px';
  zoneMapImg.style.height = imgSize + 'px';
  // Apply pan via scroll
  zoneMapWrapper.style.width = imgSize + 'px';
  zoneMapWrapper.style.height = imgSize + 'px';
}

function renderZoneOverlays() {
  zoneMapOverlays.innerHTML = '';
  const imgW = zoneMapImg.clientWidth;
  const imgH = zoneMapImg.clientHeight;
  if (!imgW || !imgH) return;

  const zoneW = imgW / 64;
  const zoneH = imgH / 64;

  for (const zc of zoneConflicts) {
    const zcKey = `${zc.zx},${zc.zy}`;
    if (!showAllZones && zcKey !== selectedZoneKey) continue;

    const el = document.createElement('div');
    el.className = 'zone-map-highlight';
    if (zcKey === selectedZoneKey) el.classList.add('selected');
    el.style.left = (zc.zx * zoneW) + 'px';
    el.style.top = (zc.zy * zoneH) + 'px';
    el.style.width = zoneW + 'px';
    el.style.height = zoneH + 'px';

    const label = document.createElement('div');
    label.className = 'zone-map-label';
    const modCount = Object.keys(zc.mods).length;
    label.textContent = `${zc.zx},${zc.zy} (${modCount})`;
    el.appendChild(label);

    el.addEventListener('click', () => selectZone(zcKey));
    zoneMapOverlays.appendChild(el);
  }
}

function renderZoneSidebar() {
  zoneSidebarList.innerHTML = '';

  if (zoneConflicts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'zone-no-conflicts';
    empty.textContent = `No ${zoneLayer} conflicts detected.`;
    zoneSidebarList.appendChild(empty);
    return;
  }

  // Group zones by winning mod
  const byWinner = {};
  for (const zc of zoneConflicts) {
    const winnerName = zc.winner.replace(/\.mod$/i, '');
    if (!byWinner[winnerName]) byWinner[winnerName] = { filename: zc.winner, zones: [] };
    byWinner[winnerName].zones.push(zc);
  }

  for (const [modName, group] of Object.entries(byWinner)) {
    const modGroup = document.createElement('div');
    modGroup.className = 'zone-mod-group';

    // Mod header (expandable)
    const modHeader = document.createElement('div');
    modHeader.className = 'zone-mod-header';

    const arrow = document.createElement('span');
    arrow.className = 'zone-mod-arrow';
    arrow.textContent = '\u25BC';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = modName;

    const countSpan = document.createElement('span');
    countSpan.className = 'zone-mod-count';
    countSpan.textContent = `${group.zones.length} zones`;

    modHeader.append(arrow, nameSpan, countSpan);

    // Zone sub-list
    const zonesDiv = document.createElement('div');
    zonesDiv.className = 'zone-mod-zones';

    for (const zc of group.zones) {
      const zcKey = `${zc.zx},${zc.zy}`;
      const item = document.createElement('div');
      item.className = 'zone-conflict-item';
      if (zcKey === selectedZoneKey) item.classList.add('active');

      const name = document.createElement('span');
      name.className = 'zone-conflict-name';
      name.textContent = `zone ${zc.zx}, ${zc.zy}`;

      const count = document.createElement('span');
      count.className = 'zone-conflict-count';
      count.textContent = Object.keys(zc.mods).length + ' mods';

      item.append(name, count);
      item.addEventListener('click', () => selectZone(zcKey));
      zonesDiv.appendChild(item);

      // Detail panel (shown when selected)
      if (zcKey === selectedZoneKey) {
        const detail = document.createElement('div');
        detail.className = 'zone-conflict-detail';

        // Other mods involved
        const modsArr = Object.values(zc.mods).sort((a, b) => a.loadOrder - b.loadOrder);
        for (const m of modsArr) {
          const row = document.createElement('div');
          row.className = 'zone-detail-mod';
          if (m.filename === zc.winner) row.classList.add('winner');
          const mName = m.filename.replace(/\.mod$/i, '');
          row.textContent = `#${m.loadOrder} ${mName}${m.filename === zc.winner ? ' (winner)' : ''}`;
          detail.appendChild(row);
        }

        // Conflict property details
        if (zc.details && zc.details.length > 0) {
          const detailHeader = document.createElement('div');
          detailHeader.style.cssText = 'margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#888;';
          detailHeader.textContent = `${zc.details.length} conflicting properties:`;
          detail.appendChild(detailHeader);

          for (const d of zc.details.slice(0, 10)) {
            const dRow = document.createElement('div');
            dRow.style.cssText = 'font-size:9px;color:#999;padding:1px 0 1px 6px;';
            dRow.textContent = `${d.name} → ${d.prop}`;
            detail.appendChild(dRow);
          }
          if (zc.details.length > 10) {
            const more = document.createElement('div');
            more.style.cssText = 'font-size:9px;color:#666;padding:1px 0 1px 6px;';
            more.textContent = `...and ${zc.details.length - 10} more`;
            detail.appendChild(more);
          }
        }

        zonesDiv.appendChild(detail);
      }
    }

    modHeader.addEventListener('click', () => {
      const isOpen = !zonesDiv.classList.contains('hidden');
      zonesDiv.classList.toggle('hidden');
      arrow.textContent = isOpen ? '\u25B6' : '\u25BC';
    });

    modGroup.append(modHeader, zonesDiv);
    zoneSidebarList.appendChild(modGroup);
  }
}

function selectZone(key) {
  selectedZoneKey = key;
  renderZoneOverlays();
  renderZoneSidebar();

  // Pan map to center the selected zone
  const zc = zoneConflicts.find((z) => `${z.zx},${z.zy}` === key);
  if (zc) {
    const imgW = zoneMapImg.clientWidth;
    const imgH = zoneMapImg.clientHeight;
    const containerW = zoneMapContainer.clientWidth;
    const containerH = zoneMapContainer.clientHeight;
    const zoneW = imgW / 64;
    const zoneH = imgH / 64;
    const centerX = (zc.zx + 0.5) * zoneW - containerW / 2;
    const centerY = (zc.zy + 0.5) * zoneH - containerH / 2;
    zoneMapContainer.scrollLeft = Math.max(0, centerX);
    zoneMapContainer.scrollTop = Math.max(0, centerY);
  }

  // Expand the parent mod group and scroll sidebar to the active item
  const activeItem = zoneSidebarList.querySelector('.zone-conflict-item.active');
  if (activeItem) {
    const parentZones = activeItem.closest('.zone-mod-zones');
    if (parentZones && parentZones.classList.contains('hidden')) {
      parentZones.classList.remove('hidden');
      const arrow = parentZones.previousElementSibling?.querySelector('.zone-mod-arrow');
      if (arrow) arrow.textContent = '\u25BC';
    }
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Show All toggle
zoneShowAllBtn.addEventListener('click', () => {
  showAllZones = !showAllZones;
  zoneShowAllBtn.textContent = showAllZones ? 'Hide All Zones' : 'Show All Zones';
  renderZoneOverlays();
});

// Layer toggle (exterior / interior)
zoneLayerBtn.addEventListener('click', () => {
  zoneLayer = zoneLayer === 'exterior' ? 'interior' : 'exterior';
  zoneLayerBtn.textContent = zoneLayer === 'exterior' ? 'Exterior' : 'Interior';
  zoneConflicts = allZoneConflicts[zoneLayer];
  selectedZoneKey = null;
  renderZoneOverlays();
  renderZoneSidebar();
});

// Zoom via mouse wheel
zoneMapContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.2 : 0.2;
  const oldScale = mapScale;
  mapScale = Math.max(0.5, Math.min(6, mapScale + delta));

  // Zoom toward cursor position
  const rect = zoneMapContainer.getBoundingClientRect();
  const mx = e.clientX - rect.left + zoneMapContainer.scrollLeft;
  const my = e.clientY - rect.top + zoneMapContainer.scrollTop;
  const ratio = mapScale / oldScale;

  updateMapTransform();
  renderZoneOverlays();

  // Adjust scroll to keep cursor point stable
  zoneMapContainer.scrollLeft = mx * ratio - (e.clientX - rect.left);
  zoneMapContainer.scrollTop = my * ratio - (e.clientY - rect.top);
}, { passive: false });

// Pan via mouse drag
zoneMapContainer.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('zone-map-highlight') || e.target.classList.contains('zone-map-label')) return;
  mapDragging = true;
  mapDragStartX = e.clientX;
  mapDragStartY = e.clientY;
  mapPanStartX = zoneMapContainer.scrollLeft;
  mapPanStartY = zoneMapContainer.scrollTop;
  zoneMapContainer.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!mapDragging) return;
  zoneMapContainer.scrollLeft = mapPanStartX - (e.clientX - mapDragStartX);
  zoneMapContainer.scrollTop = mapPanStartY - (e.clientY - mapDragStartY);
});

document.addEventListener('mouseup', () => {
  if (mapDragging) {
    mapDragging = false;
    zoneMapContainer.classList.remove('dragging');
  }
});

// Keep showZoneOnMap for clicking from conflict view
function showZoneOnMap(zoneFile) {
  if (!conflictData) return;
  openZoneMap(zoneFile);
}

// Make container scrollable for pan
zoneMapContainer.style.overflow = 'auto';

// ===== Status Bar =====

function setStatus(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = 'status-bar';
  if (type) statusBar.classList.add(type);
}

// ===== Load Order Computation =====

function computeLoadOrder() {
  const result = [];
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  // Add uncategorized at end
  sorted.push({ id: UNCATEGORIZED });

  for (const cat of sorted) {
    const catMods = getModsForCategory(cat.id);
    for (const mod of catMods) {
      if (mod.active) result.push(mod.filename);
    }
  }
  return result;
}

// ===== Category Helpers =====

function getModsForCategory(catId) {
  const catMods = mods.filter((m) => m.category === catId);
  const orderList = modOrders[catId] || [];

  catMods.sort((a, b) => {
    const ai = orderList.indexOf(a.filename);
    const bi = orderList.indexOf(b.filename);
    // Mods in the order list come first, in that order
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return catMods;
}

function generateId() {
  return 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function randomColor() {
  const colors = ['#4a9f4a', '#4a6fa5', '#a54a4a', '#a5894a', '#7a4aa5', '#4aa5a5', '#a54a7a', '#6b8f3e'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function reorderCategory(srcId, targetId) {
  const src = categories.find((c) => c.id === srcId);
  const target = categories.find((c) => c.id === targetId);
  if (!src || !target) return;

  // Remove src from array and insert at target's position
  categories = categories.filter((c) => c.id !== srcId);
  const targetIdx = categories.findIndex((c) => c.id === targetId);
  categories.splice(targetIdx, 0, src);

  // Reassign order values
  categories.forEach((c, i) => c.order = i);

  syncModCategories();
  persistConfig();
  renderColumns();
}

// ===== Persist =====

async function persistConfig() {
  config.categories = categories;
  config.modCategories = modCategories;
  config.modOrders = modOrders;
  config.uncategorizedPinned = uncategorizedPinned;
  config.kenshiTheme = document.body.classList.contains('kenshi-theme');
  config.tutorialDismissed = tutorialDismissed;
  await window.api.saveConfig(config);
}

function syncModCategories() {
  // Rebuild modCategories and modOrders from current mod state
  modCategories = {};
  for (const mod of mods) {
    if (mod.category !== UNCATEGORIZED) {
      modCategories[mod.filename] = mod.category;
    }
  }
  // Rebuild modOrders per category
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  sorted.push({ id: UNCATEGORIZED });
  for (const cat of sorted) {
    const catMods = getModsForCategory(cat.id);
    modOrders[cat.id] = catMods.map((m) => m.filename);
  }
}

// ===== Rendering =====

function renderColumns() {
  // Preserve scroll position across re-renders
  const savedScrollTop = columnsContainer.scrollTop;
  const savedScrollLeft = columnsContainer.scrollLeft;
  // Also save pinned panel mod list scroll
  const pinnedModsList = document.querySelector('#pinned-uncat-panel .column-mods');
  const savedPinnedScroll = pinnedModsList ? pinnedModsList.scrollTop : 0;
  // Save per-column scroll positions
  const savedColScrolls = {};
  for (const col of document.querySelectorAll('.column-mods')) {
    const catId = col.closest('.category-column')?.dataset.category;
    if (catId) savedColScrolls[catId] = col.scrollTop;
  }
  columnsContainer.innerHTML = '';

  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const allCats = [...sorted, { id: UNCATEGORIZED, name: 'Uncategorized', color: '#555' }];

  // Pre-compute global load order numbers for active mods
  const globalOrder = {};
  let orderNum = 1;
  for (const cat of allCats) {
    const catMods = getModsForCategory(cat.id);
    for (const mod of catMods) {
      if (mod.active) {
        globalOrder[mod.filename] = orderNum++;
      }
    }
  }

  // Render columns
  const pinnedPanel = document.getElementById('pinned-uncat-panel');
  const pinnedHandle = document.getElementById('pinned-resize-handle');
  // Preserve search value across re-renders
  const prevSearch = pinnedPanel.querySelector('.pinned-search-input');
  const searchVal = prevSearch ? prevSearch.value : '';
  pinnedPanel.innerHTML = '';

  for (const cat of allCats) {
    const column = createColumn(cat.id, cat.name, cat.color || '#555', globalOrder);
    if (uncategorizedPinned && cat.id === UNCATEGORIZED) {
      // Add search filter input
      const searchBox = document.createElement('div');
      searchBox.className = 'pinned-search';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'pinned-search-input';
      searchInput.placeholder = 'Search mods...';
      searchInput.value = searchVal;
      searchBox.appendChild(searchInput);

      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        const cards = pinnedPanel.querySelectorAll('.mod-card');
        cards.forEach((card) => {
          const name = card.querySelector('.card-name');
          const text = name ? name.textContent.toLowerCase() : '';
          card.style.display = text.includes(query) ? '' : 'none';
        });
      });

      pinnedPanel.appendChild(searchBox);
      pinnedPanel.appendChild(column);
      pinnedPanel.classList.remove('hidden');
      pinnedHandle.classList.remove('hidden');

      // Apply existing filter
      if (searchVal) {
        requestAnimationFrame(() => searchInput.dispatchEvent(new Event('input')));
      }
    } else {
      columnsContainer.appendChild(column);
    }
  }

  if (!uncategorizedPinned) {
    pinnedPanel.classList.add('hidden');
    pinnedHandle.classList.add('hidden');
  }

  // Clear just-moved tracking after cards are created
  justMovedMods.clear();

  // Restore scroll positions after layout
  requestAnimationFrame(() => {
    columnsContainer.scrollTop = savedScrollTop;
    columnsContainer.scrollLeft = savedScrollLeft;
    // Restore pinned panel scroll
    const newPinnedMods = document.querySelector('#pinned-uncat-panel .column-mods');
    if (newPinnedMods) newPinnedMods.scrollTop = savedPinnedScroll;
    // Restore per-column scroll positions
    for (const col of document.querySelectorAll('.column-mods')) {
      const catId = col.closest('.category-column')?.dataset.category;
      if (catId && savedColScrolls[catId]) col.scrollTop = savedColScrolls[catId];
    }
  });

  updateDetailPanel();
}

function createColumn(catId, name, color, globalOrder) {
  const col = document.createElement('div');
  col.className = 'category-column';
  col.dataset.category = catId;

  // Header
  const header = document.createElement('div');
  header.className = 'column-header';
  header.style.borderTopColor = color;

  // Category toggle checkbox
  const catMods = getModsForCategory(catId);
  const activeInCat = catMods.filter((m) => m.active);
  const headerCb = document.createElement('input');
  headerCb.type = 'checkbox';
  headerCb.className = 'column-header-checkbox';
  headerCb.checked = catMods.length > 0 && activeInCat.length === catMods.length;
  headerCb.addEventListener('click', (e) => {
    e.stopPropagation();
    const turnOn = headerCb.checked;
    for (const mod of catMods) {
      mod.active = turnOn;
    }
    syncModCategories();
    persistConfig();
    renderColumns();
  });

  const headerName = document.createElement('span');
  headerName.className = 'column-header-name';
  headerName.textContent = name;
  // Make name clickable to rename (not for uncategorized)
  if (catId !== UNCATEGORIZED) {
    headerName.classList.add('column-header-name-editable');
    headerName.title = 'Click to rename';
    headerName.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return;
      const newName = await showInputModal('Category name:', cat.name);
      if (newName && newName.trim()) {
        cat.name = newName.trim();
        syncModCategories();
        persistConfig();
        renderColumns();
      }
    });
  }

  const headerCount = document.createElement('span');
  headerCount.className = 'column-header-count';
  if (activeInCat.length > 0) {
    const first = globalOrder[activeInCat[0].filename];
    const last = globalOrder[activeInCat[activeInCat.length - 1].filename];
    headerCount.textContent = `#${first}-${last}`;
  } else {
    headerCount.textContent = '0';
  }

  // Collapse/expand button
  const minimizeBtn = document.createElement('span');
  minimizeBtn.className = 'column-move-btn';
  const isMinimized = minimizedCategories.has(catId);
  minimizeBtn.textContent = isMinimized ? '+' : '\u2212';
  minimizeBtn.title = isMinimized ? 'Expand category' : 'Collapse category';
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (minimizedCategories.has(catId)) {
      minimizedCategories.delete(catId);
    } else {
      minimizedCategories.add(catId);
    }
    renderColumns();
  });

  // Right-click context menu (not for uncategorized)
  if (catId !== UNCATEGORIZED) {
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, catId);
    });

    // Direction-aware move buttons
    const upIcon = verticalLayout ? '\u25B2' : '\u25C0';
    const downIcon = verticalLayout ? '\u25BC' : '\u25B6';

    function swapCategory(direction) {
      const sorted = [...categories].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === catId);
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;
      // Simple order value swap
      const tmp = sorted[idx].order;
      sorted[idx].order = sorted[swapIdx].order;
      sorted[swapIdx].order = tmp;
      syncModCategories();
      persistConfig();
      renderColumns();
    }

    const moveUp = document.createElement('span');
    moveUp.className = 'column-move-btn';
    moveUp.textContent = upIcon;
    moveUp.title = verticalLayout ? 'Move category up' : 'Move category left';
    moveUp.addEventListener('click', (e) => { e.stopPropagation(); swapCategory(-1); });

    const moveDown = document.createElement('span');
    moveDown.className = 'column-move-btn';
    moveDown.textContent = downIcon;
    moveDown.title = verticalLayout ? 'Move category down' : 'Move category right';
    moveDown.addEventListener('click', (e) => { e.stopPropagation(); swapCategory(1); });

    const headerRow1 = document.createElement('div');
    headerRow1.className = 'column-header-row';
    headerRow1.append(headerName, headerCount);

    // Color button
    const colorBtn = document.createElement('span');
    colorBtn.className = 'column-move-btn';
    colorBtn.style.backgroundColor = color;
    colorBtn.style.width = '16px';
    colorBtn.style.height = '16px';
    colorBtn.style.borderRadius = '3px';
    colorBtn.style.display = 'inline-block';
    colorBtn.textContent = '';
    colorBtn.title = 'Change color';
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      colorPicker.value = color;
      colorPicker.dataset.catId = catId;
      colorPicker.click();
    });

    // Delete button
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'column-move-btn column-delete-btn';
    deleteBtn.textContent = '\u2715';
    deleteBtn.title = 'Delete category';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return;
      const confirmed = await showConfirmModal(`Delete category "${cat.name}"?\n\nAll mods will be moved to Uncategorized.`);
      if (!confirmed) return;
      for (const mod of mods) {
        if (mod.category === cat.id) {
          mod.category = UNCATEGORIZED;
          delete modCategories[mod.filename];
        }
      }
      categories = categories.filter((c) => c.id !== cat.id);
      delete modOrders[cat.id];
      categories.sort((a, b) => a.order - b.order).forEach((c, i) => c.order = i);
      syncModCategories();
      persistConfig();
      renderColumns();
    });

    const headerRow2 = document.createElement('div');
    headerRow2.className = 'column-header-row';
    headerRow2.append(headerCb, moveUp, moveDown, colorBtn, minimizeBtn, deleteBtn);

    header.append(headerRow1, headerRow2);
  } else {
    const headerRow1 = document.createElement('div');
    headerRow1.className = 'column-header-row';
    headerRow1.append(headerName, headerCount);

    const headerRow2 = document.createElement('div');
    headerRow2.className = 'column-header-row';
    headerRow2.append(headerCb, minimizeBtn);

    header.append(headerRow1, headerRow2);
  }

  col.appendChild(header);

  // Mod list
  const modsList = document.createElement('div');
  modsList.className = 'column-mods';
  if (minimizedCategories.has(catId)) modsList.classList.add('hidden');
  modsList.dataset.category = catId;

  for (const mod of catMods) {
    modsList.appendChild(createModCard(mod, color, globalOrder));
  }

  // Drop zone for the column (empty area)
  modsList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Only highlight column if not over a card
    if (e.target === modsList) {
      col.classList.add('drag-over-column');
    }
  });

  modsList.addEventListener('dragleave', (e) => {
    if (e.target === modsList) {
      col.classList.remove('drag-over-column');
    }
  });

  modsList.addEventListener('drop', (e) => {
    e.preventDefault();
    col.classList.remove('drag-over-column');
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const filenames = data.split('\n').filter(Boolean);

    // If dropping on empty area of column, append to end
    if (e.target === modsList || e.target === col) {
      const isBulk = filenames.length > 1;
      for (const fn of filenames) {
        const mod = mods.find((m) => m.filename === fn);
        if (mod) moveMod(mod, catId, null, isBulk);
      }
      if (isBulk) { syncModCategories(); persistConfig(); renderColumns(); }
    }
  });

  col.appendChild(modsList);
  return col;
}

function createModCard(mod, catColor, globalOrder) {
  const card = document.createElement('div');
  card.className = 'mod-card';
  card.style.borderLeftColor = catColor;
  if (!mod.active) card.classList.add('inactive');
  if (selectedMods.has(mod.filename) || (selectedMod && selectedMod.filePath === mod.filePath)) card.classList.add('selected');

  // Flash animation for just-moved mods
  if (justMovedMods.has(mod.filename)) {
    card.classList.add('mod-placed');
    card.addEventListener('animationend', () => card.classList.remove('mod-placed'), { once: true });
  }
  card.dataset.filename = mod.filename;

  // Load order number (replaces drag handle)
  const handle = document.createElement('span');
  handle.className = 'card-handle';
  const num = globalOrder[mod.filename];
  handle.textContent = num != null ? num : '';

  // Checkbox
  const cbWrap = document.createElement('span');
  cbWrap.className = 'card-checkbox';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = mod.active;
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    toggleModActive(mod);
  });
  cb.addEventListener('click', (e) => e.stopPropagation());
  cbWrap.appendChild(cb);

  // Name
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = mod.displayName;

  // Source badge
  const src = document.createElement('span');
  src.className = 'card-source';
  const badge = document.createElement('span');
  badge.className = 'source-badge ' + mod.source;
  badge.textContent = mod.source;
  src.appendChild(badge);

  // Conflict indicator + highlight
  if (conflictData && conflictData.modConflicts[mod.filename]) {
    const count = conflictData.modConflicts[mod.filename].length;
    const badge = document.createElement('span');
    badge.className = 'conflict-count-badge';
    badge.textContent = count;
    card.append(handle, cbWrap, name, badge, src);
  } else {
    card.append(handle, cbWrap, name, src);
  }

  // Highlight mods this selection conflicts with
  if (selectedMod && conflictData && selectedMod.filePath !== mod.filePath) {
    const selConflicts = conflictData.modConflicts[selectedMod.filename];
    if (selConflicts) {
      const relationship = getConflictRelationship(selectedMod.filename, mod.filename, selConflicts);
      if (relationship === 'overwriting') {
        card.classList.add('conflict-highlight-green');
      } else if (relationship === 'overwritten') {
        card.classList.add('conflict-highlight-red');
      } else if (relationship === 'dead') {
        card.classList.add('conflict-highlight-yellow');
      }
    }
  }

  // Dependency order warnings — only show when load order is wrong
  if (mod.active && globalOrder[mod.filename]) {
    const myOrder = globalOrder[mod.filename];
    const modDeps = (mod.dependencies || []).concat(mod.references || []);

    // Orange: this mod loads BEFORE a dependency it needs (broken order)
    for (const dep of modDeps) {
      const depMod = mods.find((m) => m.filename.toLowerCase() === dep.toLowerCase());
      if (depMod && depMod.active && globalOrder[depMod.filename]) {
        if (myOrder < globalOrder[depMod.filename]) {
          card.classList.add('dep-highlight-orange');
          break;
        }
      }
    }

    // Yellow: this mod should load before another mod that depends on it, but loads after
    for (const other of mods) {
      if (!other.active || other.filename === mod.filename) continue;
      const otherDeps = (other.dependencies || []).concat(other.references || []);
      const dependsOnMe = otherDeps.some((d) => d.toLowerCase() === mod.filename.toLowerCase());
      if (dependsOnMe && globalOrder[other.filename] && globalOrder[other.filename] < myOrder) {
        card.classList.add('dep-highlight-yellow');
        break;
      }
    }
  }

  // Click to select (with multi-select support)
  card.addEventListener('click', (e) => {
    if (e.shiftKey && lastClickedMod) {
      // Shift+click: range select within the same category
      const catMods = getModsForCategory(mod.category);
      const startIdx = catMods.findIndex((m) => m.filename === lastClickedMod.filename);
      const endIdx = catMods.findIndex((m) => m.filename === mod.filename);
      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        for (let i = lo; i <= hi; i++) {
          selectedMods.add(catMods[i].filename);
        }
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle individual selection
      if (selectedMods.has(mod.filename)) {
        selectedMods.delete(mod.filename);
      } else {
        selectedMods.add(mod.filename);
      }
    } else {
      // Normal click: single select
      selectedMods.clear();
      selectedMods.add(mod.filename);
    }
    selectedMod = mod;
    lastClickedMod = mod;
    renderColumns();
  });

  // Right-click to assign category (bulk if multi-selected)
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking a non-selected mod, switch selection to it
    if (!selectedMods.has(mod.filename)) {
      selectedMods.clear();
      selectedMods.add(mod.filename);
      selectedMod = mod;
    }
    showModContextMenu(e.clientX, e.clientY, mod);
  });

  // Drag
  card.draggable = true;

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    // If dragging a selected mod, include all selected mods
    if (selectedMods.has(mod.filename) && selectedMods.size > 1) {
      e.dataTransfer.setData('text/plain', [...selectedMods].join('\n'));

      // Custom drag image showing all selected mods
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      const names = [...selectedMods].slice(0, 5).map((fn) => {
        const m = mods.find((mod) => mod.filename === fn);
        return m ? m.displayName : fn;
      });
      ghost.innerHTML = names.map((n) => `<div class="drag-ghost-item">${n}</div>`).join('');
      if (selectedMods.size > 5) {
        ghost.innerHTML += `<div class="drag-ghost-more">+${selectedMods.size - 5} more</div>`;
      }
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    } else {
      e.dataTransfer.setData('text/plain', mod.filename);
    }
    requestAnimationFrame(() => card.classList.add('dragging'));
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over-card, .drag-over-column, .drop-above, .drop-below').forEach((el) => {
      el.classList.remove('drag-over-card', 'drag-over-column', 'drop-above', 'drop-below');
    });
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    // Show insertion indicator based on cursor position (top/bottom half)
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    card.classList.remove('drop-above', 'drop-below');
    if (e.clientY < midY) {
      card.classList.add('drop-above');
    } else {
      card.classList.add('drop-below');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drop-above', 'drop-below');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedAbove = card.classList.contains('drop-above');
    card.classList.remove('drop-above', 'drop-below');
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const filenames = data.split('\n').filter(Boolean);
    if (filenames.length === 0 || (filenames.length === 1 && filenames[0] === mod.filename)) return;

    // Insert before this card (if dropped above) or after (if dropped below)
    const beforeFilename = droppedAbove ? mod.filename : null;
    const afterFilename = droppedAbove ? null : mod.filename;

    const isBulk = filenames.length > 1;
    for (const fn of filenames) {
      const draggedMod = mods.find((m) => m.filename === fn);
      if (draggedMod && draggedMod.filename !== mod.filename) {
        if (droppedAbove) {
          moveMod(draggedMod, mod.category, mod.filename, isBulk);
        } else {
          const catMods = getModsForCategory(mod.category);
          const idx = catMods.findIndex((m) => m.filename === mod.filename);
          const nextMod = idx >= 0 && idx < catMods.length - 1 ? catMods[idx + 1].filename : null;
          moveMod(draggedMod, mod.category, nextMod, isBulk);
        }
      }
    }
    if (isBulk) { syncModCategories(); persistConfig(); renderColumns(); }
  });

  return card;
}

// ===== Drag Move =====

function moveMod(mod, targetCatId, beforeFilename, skipRender) {
  mod.category = targetCatId;
  modCategories[mod.filename] = targetCatId === UNCATEGORIZED ? undefined : targetCatId;
  if (targetCatId === UNCATEGORIZED) delete modCategories[mod.filename];

  // Remove from all order lists
  for (const key of Object.keys(modOrders)) {
    modOrders[key] = (modOrders[key] || []).filter((f) => f !== mod.filename);
  }

  // Insert into target
  if (!modOrders[targetCatId]) modOrders[targetCatId] = [];
  const targetList = modOrders[targetCatId];

  if (beforeFilename) {
    const idx = targetList.indexOf(beforeFilename);
    if (idx >= 0) {
      targetList.splice(idx, 0, mod.filename);
    } else {
      targetList.push(mod.filename);
    }
  } else {
    targetList.push(mod.filename);
  }

  justMovedMods.add(mod.filename);
  if (!skipRender) {
    syncModCategories();
    persistConfig();
    renderColumns();
  }
}

// ===== Active/Inactive Toggle =====

function toggleModActive(mod) {
  mod.active = !mod.active;
  syncModCategories();
  persistConfig();
  renderColumns();
}

// ===== Context Menu =====

function clampMenuPosition(menu, x, y) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (x + w > window.innerWidth) x = window.innerWidth - w - 4;
  if (y + h > window.innerHeight) y = window.innerHeight - h - 4;
  if (x < 0) x = 4;
  if (y < 0) y = 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function showContextMenu(x, y, catId) {
  contextTarget = catId;
  clampMenuPosition(contextMenu, x, y);
}

const modContextMenu = document.getElementById('mod-context-menu');
const modContextCategories = document.getElementById('mod-context-categories');
let modContextTarget = null;

function hideContextMenu() {
  contextMenu.classList.add('hidden');
  modContextMenu.classList.add('hidden');
  contextTarget = null;
  modContextTarget = null;
}

function showModContextMenu(x, y, mod) {
  hideContextMenu();
  modContextTarget = mod;

  // Get all selected mods for bulk move
  const bulkMods = selectedMods.size > 1
    ? mods.filter((m) => selectedMods.has(m.filename))
    : [mod];

  // Build category list
  modContextCategories.innerHTML = '';

  // Show count header if bulk
  if (bulkMods.length > 1) {
    const header = document.createElement('div');
    header.className = 'context-item';
    header.style.cssText = 'color:#8ab4f8;font-weight:600;cursor:default;font-size:10px;';
    header.textContent = `Move ${bulkMods.length} mods to:`;
    modContextCategories.appendChild(header);
  }

  const allCats = [...categories].sort((a, b) => a.order - b.order);
  allCats.push({ id: UNCATEGORIZED, name: 'Uncategorized', color: '#555' });

  for (const cat of allCats) {
    // For single mod, skip current category
    if (bulkMods.length === 1 && cat.id === mod.category) continue;
    const item = document.createElement('div');
    item.className = 'context-item';
    const dot = document.createElement('span');
    dot.className = 'context-cat-dot';
    dot.style.backgroundColor = cat.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(cat.name));
    item.addEventListener('click', () => {
      for (const m of bulkMods) {
        moveMod(m, cat.id, null, true);
      }
      syncModCategories();
      persistConfig();
      renderColumns();
      selectedMods.clear();
      hideContextMenu();
    });
    modContextCategories.appendChild(item);
  }

  clampMenuPosition(modContextMenu, x, y);
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.column-header') && !e.target.closest('.mod-card')) {
    hideContextMenu();
  }
});

contextMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !contextTarget) return;

  const cat = categories.find((c) => c.id === contextTarget);
  if (!cat) return;

  if (action === 'rename') {
    hideContextMenu();
    const newName = await showInputModal('Category name:', cat.name);
    if (newName && newName.trim()) {
      cat.name = newName.trim();
      syncModCategories();
      persistConfig();
      renderColumns();
    }
    return;
  } else if (action === 'color') {
    colorPicker.value = cat.color;
    colorPicker.dataset.catId = cat.id;
    colorPicker.click();
  } else if (action === 'delete') {
    // Move all mods in this category to uncategorized
    for (const mod of mods) {
      if (mod.category === cat.id) {
        mod.category = UNCATEGORIZED;
        delete modCategories[mod.filename];
      }
    }
    categories = categories.filter((c) => c.id !== cat.id);
    delete modOrders[cat.id];
    // Reindex order
    categories.sort((a, b) => a.order - b.order).forEach((c, i) => c.order = i);
    syncModCategories();
    persistConfig();
    renderColumns();
  }

  hideContextMenu();
});

colorPicker.addEventListener('input', () => {
  const catId = colorPicker.dataset.catId;
  const cat = categories.find((c) => c.id === catId);
  if (cat) {
    cat.color = colorPicker.value;
    syncModCategories();
    persistConfig();
    renderColumns();
  }
});

// ===== Add Category =====

addCategoryBtn.addEventListener('click', () => {
  // Build position options for the select
  const sorted = [...categories].sort((a, b) => a.order - b.order);

  // Create a custom modal with name input + position select
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.minWidth = '320px';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'New Category';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'modal-input';
  nameInput.placeholder = 'Category name...';
  nameInput.autocomplete = 'off';
  nameInput.style.marginBottom = '10px';

  const posLabel = document.createElement('div');
  posLabel.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;';
  posLabel.textContent = 'Load in front of:';

  const posSelect = document.createElement('select');
  posSelect.className = 'modal-input';
  posSelect.style.marginBottom = '10px';

  for (const cat of sorted) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    posSelect.appendChild(opt);
  }
  const endOpt = document.createElement('option');
  endOpt.value = '__end__';
  endOpt.textContent = '(at the end)';
  endOpt.selected = true;
  posSelect.appendChild(endOpt);

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-primary';
  okBtn.textContent = 'Create';

  buttons.append(cancelBtn, okBtn);
  box.append(title, nameInput, posLabel, posSelect, buttons);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  nameInput.focus();

  function close() { document.body.removeChild(overlay); }

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') okBtn.click();
    if (e.key === 'Escape') close();
  });

  okBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;

    const posId = posSelect.value;
    const insertOrder = posId === '__end__' ? categories.length : categories.find((c) => c.id === posId)?.order ?? categories.length;

    for (const c of categories) {
      if (c.order >= insertOrder) c.order++;
    }

    const newCat = {
      id: generateId(),
      name,
      color: randomColor(),
      order: insertOrder,
    };
    categories.push(newCat);
    modOrders[newCat.id] = [];
    syncModCategories();
    persistConfig();
    renderColumns();
    close();
  });
});

// ===== Reset Categories =====

const resetCategoriesBtn = document.getElementById('reset-categories-btn');
resetCategoriesBtn.addEventListener('click', async () => {
  const confirmed = await showConfirmModal('Reset all categories? All mods will move to Uncategorized and default categories will be restored.');
  if (!confirmed) return;

  // Move all mods to uncategorized
  for (const mod of mods) {
    mod.category = UNCATEGORIZED;
  }
  modCategories = {};
  modOrders = {};

  // Rebuild defaults
  categories = DEFAULT_CATEGORIES.map((def, i) => ({
    id: generateId(),
    name: def.name,
    color: def.color,
    order: i,
  }));

  syncModCategories();
  persistConfig();
  renderColumns();
  setStatus('Categories reset to defaults.', 'success');
});

// ===== Detail Panel Tabs =====

const tabDetails = document.getElementById('tab-details');
const tabModpage = document.getElementById('tab-modpage');
const tabTutorial = document.getElementById('tab-tutorial');
const tabConflicts = document.getElementById('tab-conflicts');
const tabGuide = document.getElementById('tab-guide');
const tabPacks = document.getElementById('tab-packs');
const tabWorkshop = document.getElementById('tab-workshop');
const detailView = document.getElementById('detail-view');
const modpageView = document.getElementById('modpage-view');
const tutorialView = document.getElementById('tutorial-view');
const conflictsView = document.getElementById('conflicts-view');
const guideView = document.getElementById('guide-view');
const packsView = document.getElementById('packs-view');
const workshopView = document.getElementById('workshop-view');

function switchTab(activeTab) {
  const tabs = [tabDetails, tabModpage, tabTutorial, tabConflicts, tabGuide, tabPacks, tabWorkshop];
  const views = [detailView, modpageView, tutorialView, conflictsView, guideView, packsView, workshopView];
  tabs.forEach((t, i) => {
    t.classList.toggle('active', t === activeTab);
    views[i].classList.toggle('hidden', t !== activeTab);
  });
}

tabDetails.addEventListener('click', () => switchTab(tabDetails));
tabTutorial.addEventListener('click', () => switchTab(tabTutorial));
tabGuide.addEventListener('click', () => switchTab(tabGuide));
tabModpage.addEventListener('click', () => {
  if (selectedMod && selectedMod.url) {
    modpageView.src = selectedMod.url;
  }
  switchTab(tabModpage);
});
tabConflicts.addEventListener('click', () => {
  switchTab(tabConflicts);
  renderConflictsTab();
});

// Conflict focus toggle — dims non-conflicting mods
const conflictFocusCb = document.getElementById('conflict-focus-cb');
conflictFocusCb.addEventListener('change', () => {
  document.getElementById('category-columns').classList.toggle('conflict-focus-active', conflictFocusCb.checked);
  const pinnedPanel = document.getElementById('pinned-uncat-panel');
  pinnedPanel.classList.toggle('conflict-focus-active', conflictFocusCb.checked);
});
tabPacks.addEventListener('click', () => {
  switchTab(tabPacks);
  refreshPacksList();
});
tabWorkshop.addEventListener('click', () => switchTab(tabWorkshop));

// ===== Mod Packs =====

const savePackBtn = document.getElementById('save-pack-btn');
const packsList = document.getElementById('packs-list');

savePackBtn.addEventListener('click', async () => {
  const name = await showInputModal('Save mod pack as:', '');
  if (!name || !name.trim()) return;

  const pack = {
    name: name.trim(),
    savedAt: new Date().toISOString(),
    categories: JSON.parse(JSON.stringify(categories)),
    modCategories: { ...modCategories },
    modOrders: JSON.parse(JSON.stringify(modOrders)),
    activeMods: mods.filter((m) => m.active).map((m) => m.filename),
  };

  await window.api.savePack(pack);
  setStatus(`Mod pack "${pack.name}" saved!`, 'success');
  refreshPacksList();
});

async function refreshPacksList() {
  const packs = await window.api.getPacks();
  packsList.innerHTML = '';

  if (packs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'detail-placeholder';
    empty.textContent = 'No saved mod packs yet.';
    empty.style.marginTop = '20px';
    packsList.appendChild(empty);
    return;
  }

  for (const pack of packs) {
    const item = document.createElement('div');
    item.className = 'pack-item';

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'pack-name';
    nameEl.textContent = pack.name;
    const meta = document.createElement('div');
    meta.className = 'pack-meta';
    const date = new Date(pack.savedAt);
    meta.textContent = `${pack.activeMods?.length || 0} mods \u00B7 ${date.toLocaleDateString()}`;
    info.append(nameEl, meta);

    const actions = document.createElement('div');
    actions.className = 'pack-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-primary';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(`Load mod pack "${pack.name}"? This will replace your current categories and load order.`);
      if (!confirmed) return;
      applyPack(pack);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger-subtle';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(`Delete mod pack "${pack.name}"?`);
      if (!confirmed) return;
      await window.api.deletePack(pack.name);
      refreshPacksList();
      setStatus(`Mod pack "${pack.name}" deleted.`, 'success');
    });

    actions.append(loadBtn, delBtn);
    item.append(info, actions);
    packsList.appendChild(item);
  }
}

async function applyPack(pack) {
  // Restore categories
  categories = pack.categories || [];
  modCategories = pack.modCategories || {};
  modOrders = pack.modOrders || {};

  // Restore active/inactive state
  const activeSet = new Set(pack.activeMods || []);
  for (const mod of mods) {
    mod.active = activeSet.has(mod.filename);
  }

  applyCategoriesToMods();
  syncModCategories();
  await persistConfig();
  renderColumns();

  const activeCount = mods.filter((m) => m.active).length;
  modCount.textContent = `${mods.length} mods, ${activeCount} active`;
  setStatus(`Mod pack "${pack.name}" loaded!`, 'success');
}

// ===== AI Sort =====

// AI Sort Guide modal (kept for reference, opened from tutorial)
const aiGuideModal = document.getElementById('ai-guide-modal');
const aiGuideClose = document.getElementById('ai-guide-close');
if (aiGuideClose) {
  aiGuideClose.addEventListener('click', () => {
    aiGuideModal.classList.add('hidden');
  });
}

const aiExportBtn = document.getElementById('ai-export-btn');
const aiImportBtn = document.getElementById('ai-import-btn');

function getWorkshopId(mod) {
  const parts = mod.filePath.replace(/\\/g, '/').split('/');
  const contentIdx = parts.indexOf('content');
  if (contentIdx >= 0 && contentIdx + 2 < parts.length) {
    return parts[contentIdx + 2];
  }
  return null;
}

const BATCH_SIZE = 50;

function showExportChoiceModal() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('ai-export-modal');
    const uncatBtn = document.getElementById('ai-export-uncat');
    const uncatCompactBtn = document.getElementById('ai-export-uncat-compact');
    const compactBtn = document.getElementById('ai-export-compact');
    const allBtn = document.getElementById('ai-export-all');
    const splitBtn = document.getElementById('ai-export-split');
    const cancelBtn = document.getElementById('ai-export-cancel');
    const warning = document.getElementById('ai-export-warning');

    const activeMods = mods.filter((m) => m.active);
    const uncatCount = activeMods.filter((m) => m.category === UNCATEGORIZED).length;
    const sortedCount = activeMods.length - uncatCount;
    const modsToSort = uncatCount > 0 ? uncatCount : activeMods.length;
    const batchCount = Math.ceil(modsToSort / BATCH_SIZE);

    const uncatCountEl = document.getElementById('ai-export-uncat-count');
    if (uncatCount > 50) {
      uncatCountEl.textContent = `${uncatCount} mods — not recommended, use Compact instead`;
      uncatBtn.classList.add('export-not-recommended');
    } else {
      uncatCountEl.textContent = `${uncatCount} mods to sort, ${sortedCount} already placed`;
      uncatBtn.classList.remove('export-not-recommended');
    }
    document.getElementById('ai-export-uncat-compact-count').textContent =
      `${uncatCount} mods to sort — compact, single file`;
    document.getElementById('ai-export-compact-count').textContent =
      `${activeMods.length} mods — compact format, single file`;
    document.getElementById('ai-export-all-count').textContent =
      `${activeMods.length} mods — full descriptions`;
    document.getElementById('ai-export-split-count').textContent =
      `${batchCount} files with ~${BATCH_SIZE} mods each`;

    if (modsToSort > 100) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }

    overlay.classList.remove('hidden');

    function cleanup() {
      overlay.classList.add('hidden');
      uncatBtn.removeEventListener('click', onUncat);
      uncatCompactBtn.removeEventListener('click', onUncatCompact);
      compactBtn.removeEventListener('click', onCompact);
      allBtn.removeEventListener('click', onAll);
      splitBtn.removeEventListener('click', onSplit);
      cancelBtn.removeEventListener('click', onCancel);
    }

    function onUncat() { cleanup(); resolve('uncategorized'); }
    function onUncatCompact() { cleanup(); resolve('uncategorized-compact'); }
    function onCompact() { cleanup(); resolve('compact'); }
    function onAll() { cleanup(); resolve('all'); }
    function onSplit() { cleanup(); resolve('split'); }
    function onCancel() { cleanup(); resolve(null); }

    uncatBtn.addEventListener('click', onUncat);
    uncatCompactBtn.addEventListener('click', onUncatCompact);
    compactBtn.addEventListener('click', onCompact);
    allBtn.addEventListener('click', onAll);
    splitBtn.addEventListener('click', onSplit);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function buildPromptHeader(catNames) {
  let h = '';
  h += 'I need you to sort my Kenshi mods into the correct load order categories.\n\n';
  h += 'Use this load order guide as reference:\n';
  h += 'https://steamcommunity.com/sharedfiles/filedetails/?id=1850250979\n\n';
  h += 'Reply with ONLY the sorted list using this exact format — nothing else:\n\n';
  h += '[Category Name]\n';
  h += 'filename.mod\n\n';
  h += '[Next Category]\n';
  h += 'anothermod.mod\n\n';
  h += 'Important:\n';
  h += '- Start your reply with [ — no intro text, nothing before it\n';
  h += '- End your reply with the last .mod filename — no notes after it\n';
  h += '- No markdown, no code blocks, no commentary, no reasoning\n';
  h += '- Use the exact filenames I provide (case-sensitive, with .mod)\n';
  h += '- Use the exact category names in square brackets\n';
  h += '- Every mod in this prompt must appear exactly once\n';
  h += '- Include empty categories too (just the [Header])\n';
  h += '- Put anything you are unsure about in [Uncategorized]\n\n';
  h += 'My categories in load order:\n';
  h += catNames.map((n) => `  ${n}`).join('\n');
  h += '\n\n';
  return h;
}

function buildModEntry(mod, workshopDetails) {
  let e = `=== MOD: ${mod.displayName} ===\n`;
  e += `Filename: ${mod.filename}\n`;
  e += `Source: ${mod.source}\n`;
  if (mod.author) e += `Author: ${mod.author}\n`;
  let desc = mod.description || '';
  const wid = getWorkshopId(mod);
  if (wid && workshopDetails[wid]) desc = workshopDetails[wid].description || desc;
  if (desc) e += `\nDescription:\n${desc}\n`;
  e += '\n---\n\n';
  return e;
}

function buildModEntryCompact(mod, workshopDetails) {
  let e = `${mod.filename}`;
  const wid = getWorkshopId(mod);
  const detail = wid ? workshopDetails[wid] : null;
  const tags = detail?.tags;
  if (tags && tags.length > 0) e += ` | Tags: ${tags.join(', ')}`;
  let desc = (detail?.description || mod.description || '').replace(/\[.*?\]/g, '').replace(/\n/g, ' ').trim();
  if (desc.length > 200) desc = desc.substring(0, 200) + '...';
  if (desc) e += ` | ${desc}`;
  return e + '\n';
}

function buildPromptFooter(count) {
  let f = '---\n\n';
  f += `That is all ${count} mods. Sort them into the categories above.\n\n`;
  f += 'IMPORTANT: I am pasting your response directly into a machine parser.\n';
  f += 'The parser reads ONLY lines matching [Category Name] and filename.mod — everything else is discarded.\n';
  f += 'So please just give me the clean sorted list with no other text.\n';
  return f;
}

function buildCurrentSortSection(sortedCats) {
  let s = '=== MY CURRENT SORTED MODS (keep these in place) ===\n\n';
  for (const cat of sortedCats) {
    const catMods = getModsForCategory(cat.id).filter((m) => m.active);
    s += `[${cat.name}]\n`;
    for (const mod of catMods) s += `${mod.filename}\n`;
    s += '\n';
  }
  return s;
}

aiExportBtn.addEventListener('click', async () => {
  const activeMods = mods.filter((m) => m.active);
  if (activeMods.length === 0) {
    setStatus('No active mods to export.', 'error');
    return;
  }

  const choice = await showExportChoiceModal();
  if (!choice) return;

  const uncatMods = activeMods.filter((m) => m.category === UNCATEGORIZED);
  const sortedCats = [...categories].sort((a, b) => a.order - b.order);
  const catNames = sortedCats.map((c) => c.name);
  catNames.push('Uncategorized');

  const isUncatMode = choice === 'uncategorized' || choice === 'uncategorized-compact';
  if (isUncatMode && uncatMods.length === 0) {
    setStatus('No uncategorized mods to sort — everything is already placed!', 'success');
    return;
  }

  const modsToDescribe = (choice === 'all' || choice === 'compact') ? activeMods : uncatMods;
  setStatus(`Fetching Steam data for ${modsToDescribe.length} mods...`);
  aiExportBtn.disabled = true;

  const workshopIds = modsToDescribe
    .filter((m) => m.source === 'steam')
    .map(getWorkshopId)
    .filter(Boolean);

  let workshopDetails = {};
  if (workshopIds.length > 0) {
    workshopDetails = await window.api.fetchWorkshopDetails(workshopIds);
  }

  if (choice === 'split') {
    // === SPLIT MODE — multiple files ===
    const batches = [];
    for (let i = 0; i < modsToDescribe.length; i += BATCH_SIZE) {
      batches.push(modsToDescribe.slice(i, i + BATCH_SIZE));
    }

    const filePath = await window.api.saveFileDialog('kenshi_ai_sort_batch_1.txt');
    if (!filePath) {
      setStatus('Export cancelled.');
      aiExportBtn.disabled = false;
      return;
    }

    const baseDir = filePath.replace(/[/\\][^/\\]+$/, '');
    const baseName = filePath.replace(/^.*[/\\]/, '').replace(/\.txt$/, '').replace(/_?\d+$/, '');

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      let output = buildPromptHeader(catNames);

      // Always include current sort context
      output += buildCurrentSortSection(sortedCats);

      output += `=== UNSORTED MODS — BATCH ${i + 1} of ${batches.length} (place these into the right categories) ===\n\n`;

      for (const mod of batch) {
        output += buildModEntry(mod, workshopDetails);
      }

      output += buildPromptFooter(batch.length);

      const batchPath = `${baseDir}/${baseName}_${i + 1}.txt`;
      await window.api.writeFile(batchPath, output);
    }

    setStatus(`Exported ${modsToDescribe.length} mods across ${batches.length} batch files!`, 'success');
  } else {
    // === SINGLE FILE MODE ===
    let output = buildPromptHeader(catNames);

    if (choice === 'uncategorized-compact') {
      output += 'I already have some mods sorted. Keep them in their current categories and positions.\n';
      output += 'I need you to place ONLY the unsorted mods into the right categories.\n';
      output += 'Each unsorted mod line has: filename | Steam tags | short description.\n\n';
      output += buildCurrentSortSection(sortedCats);
      output += '=== UNSORTED MODS (place these into the right categories) ===\n\n';
      for (const mod of uncatMods) {
        output += buildModEntryCompact(mod, workshopDetails);
      }
      output += '\n';
      output += `That is all. Place the ${uncatMods.length} unsorted mods while keeping sorted mods in place.\n\n`;
      output += 'IMPORTANT: I am pasting your response directly into a machine parser.\n';
      output += 'The parser reads ONLY lines matching [Category Name] and filename.mod — everything else is discarded.\n';
      output += 'So please just give me the clean sorted list with no other text.\n';
    } else if (choice === 'compact') {
      output += 'Sort ALL of these mods from scratch.\n';
      output += 'Each line below has: filename | Steam tags | short description.\n\n';
      for (const mod of activeMods) {
        output += buildModEntryCompact(mod, workshopDetails);
      }
      output += '\n';
      output += buildPromptFooter(activeMods.length);
    } else if (choice === 'all') {
      output += 'Sort ALL of these mods from scratch:\n\n';
      for (const mod of activeMods) {
        output += buildModEntry(mod, workshopDetails);
      }
      output += buildPromptFooter(activeMods.length);
    } else {
      output += 'I already have some mods sorted. Keep them in their current categories and positions.\n';
      output += 'I need you to place ONLY the unsorted mods into the right categories.\n\n';
      output += buildCurrentSortSection(sortedCats);
      output += '=== UNSORTED MODS (place these into the right categories) ===\n\n';
      for (const mod of uncatMods) {
        output += buildModEntry(mod, workshopDetails);
      }
      output += '---\n\n';
      output += `That is all. Place the ${uncatMods.length} unsorted mods into the right categories while keeping the already-sorted mods in place.\n\n`;
      output += 'IMPORTANT: I am pasting your response directly into a machine parser.\n';
      output += 'The parser reads ONLY lines matching [Category Name] and filename.mod — everything else is discarded.\n';
      output += 'So please just give me the clean sorted list with no other text.\n';
    }

    const filePath = await window.api.saveFileDialog('kenshi_ai_sort_prompt.txt');
    if (!filePath) {
      setStatus('Export cancelled.');
      aiExportBtn.disabled = false;
      return;
    }
    await window.api.writeFile(filePath, output);
    setStatus(`Exported ${modsToDescribe.length} mods to prompt file!`, 'success');
  }

  aiExportBtn.disabled = false;
});

// Import AI response
aiImportBtn.addEventListener('click', () => {
  const overlay = document.getElementById('ai-import-modal');
  const textarea = document.getElementById('ai-import-textarea');
  const okBtn = document.getElementById('ai-import-ok');
  const cancelBtn = document.getElementById('ai-import-cancel');

  textarea.value = '';
  overlay.classList.remove('hidden');
  textarea.focus();

  function cleanup() {
    overlay.classList.add('hidden');
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
  }

  function onCancel() { cleanup(); }

  function onOk() {
    const text = textarea.value;
    cleanup();
    parseAndApplyAiResponse(text);
  }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
});

function parseAndApplyAiResponse(text) {
  // Strip everything before the first [ and after the last .mod line
  const firstBracket = text.indexOf('[');
  if (firstBracket > 0) text = text.substring(firstBracket);

  const lastMod = text.lastIndexOf('.mod');
  if (lastMod > 0) {
    const lineEnd = text.indexOf('\n', lastMod);
    if (lineEnd > 0) text = text.substring(0, lineEnd);
  }

  // Strip markdown code blocks if the AI wrapped it
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```$/gm, '');

  const lines = text.split(/\r?\n/);
  let currentCat = null;
  const assignments = {}; // catName -> [filename, ...]

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Check for category header: [Category Name]
    const catMatch = line.match(/^\[(.+)\]$/);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      if (!assignments[currentCat]) assignments[currentCat] = [];
      continue;
    }

    // Otherwise it's a mod filename (be lenient — accept lines ending in .mod)
    if (currentCat && line.match(/\.mod$/i)) {
      // Strip any leading numbering like "1. " or "- "
      line = line.replace(/^[\d]+\.\s*/, '').replace(/^[-*]\s*/, '').trim();
      if (line.endsWith('.mod')) {
        assignments[currentCat].push(line);
      }
    }
  }

  // Map category names to IDs
  const catNameMap = {};
  for (const cat of categories) {
    catNameMap[cat.name.toLowerCase()] = cat.id;
  }
  catNameMap['uncategorized'] = UNCATEGORIZED;

  let matched = 0;
  let unmatched = 0;

  // Apply assignments
  for (const [catName, filenames] of Object.entries(assignments)) {
    const catId = catNameMap[catName.toLowerCase()];
    if (!catId) {
      unmatched += filenames.length;
      continue;
    }

    for (const filename of filenames) {
      const mod = mods.find((m) => m.filename === filename);
      if (!mod) { unmatched++; continue; }

      mod.category = catId;
      mod.active = true;
      if (catId !== UNCATEGORIZED) {
        modCategories[mod.filename] = catId;
      } else {
        delete modCategories[mod.filename];
      }
      matched++;
    }

    // Set the order for this category
    modOrders[catId] = filenames.filter((f) => mods.find((m) => m.filename === f));
  }

  syncModCategories();
  persistConfig();
  renderColumns();

  const activeCount = mods.filter((m) => m.active).length;
  modCount.textContent = `${mods.length} mods, ${activeCount} active`;

  if (unmatched > 0) {
    setStatus(`AI order applied: ${matched} mods sorted, ${unmatched} could not be matched.`, 'success');
  } else {
    setStatus(`AI order applied: ${matched} mods sorted successfully!`, 'success');
  }
}

// ===== Detail Panel =====

function updateDetailPanel() {
  const placeholder = detailPanel.querySelector('.detail-placeholder');

  if (!selectedMod) {
    placeholder.classList.remove('hidden');
    detailContent.classList.add('hidden');
    return;
  }

  placeholder.classList.add('hidden');
  detailContent.classList.remove('hidden');

  const detailImage = document.getElementById('detail-image');
  if (selectedMod.imagePath) {
    detailImage.src = 'file:///' + selectedMod.imagePath.replace(/\\/g, '/');
    detailImage.classList.remove('hidden');
  } else {
    detailImage.classList.add('hidden');
    detailImage.src = '';
  }

  // Update mod page webview if that tab is active
  if (tabModpage.classList.contains('active') && selectedMod.url) {
    modpageView.src = selectedMod.url;
  }

  document.getElementById('detail-name').textContent = selectedMod.displayName;
  document.getElementById('detail-author').textContent = selectedMod.author || 'Unknown';
  document.getElementById('detail-version').textContent = selectedMod.version || 'N/A';
  document.getElementById('detail-source').textContent = selectedMod.source === 'steam' ? 'Steam Workshop' : 'Local';
  document.getElementById('detail-path').textContent = selectedMod.filePath;
  document.getElementById('detail-desc').textContent = selectedMod.description || 'No description available.';

  const depsRow = document.getElementById('detail-deps-row');
  const depsEl = document.getElementById('detail-deps');
  if (selectedMod.dependencies && selectedMod.dependencies.length > 0) {
    depsRow.classList.remove('hidden');
    depsEl.textContent = selectedMod.dependencies.join(', ');
  } else {
    depsRow.classList.add('hidden');
  }

  const refsRow = document.getElementById('detail-refs-row');
  const refsEl = document.getElementById('detail-refs');
  if (selectedMod.references && selectedMod.references.length > 0) {
    refsRow.classList.remove('hidden');
    refsEl.textContent = selectedMod.references.join(', ');
  } else {
    refsRow.classList.add('hidden');
  }

  // "Needed by" — mods that depend on the selected mod
  const neededByRow = document.getElementById('detail-needed-by-row');
  const neededByEl = document.getElementById('detail-needed-by');
  const dependents = mods.filter((m) => {
    const allDeps = (m.dependencies || []).concat(m.references || []);
    return allDeps.some((d) => d.toLowerCase() === selectedMod.filename.toLowerCase());
  });
  if (dependents.length > 0) {
    neededByRow.classList.remove('hidden');
    neededByEl.textContent = dependents.map((m) => m.displayName).join(', ');
  } else {
    neededByRow.classList.add('hidden');
  }

  // Update conflicts tab if it's active
  if (tabConflicts.classList.contains('active')) {
    renderConflictsTab();
  }
}

// ===== Conflicts Tab =====

function getConflictRelationship(selfFilename, otherFilename, selfConflicts) {
  // Check if these two mods share any conflict
  let hasConflict = false;
  let selfWinsAny = false;
  let otherWinsAny = false;

  for (const c of selfConflicts) {
    const otherEntry = c.allMods.find((m) => m.filename === otherFilename);
    if (!otherEntry) continue;
    hasConflict = true;
    if (c.winner === selfFilename) selfWinsAny = true;
    if (c.winner === otherFilename) otherWinsAny = true;
  }

  if (!hasConflict) return null;
  // If self is the overall winner for any shared conflict
  if (selfWinsAny) return 'overwriting';
  // If other is the overall winner for any shared conflict
  if (otherWinsAny) return 'overwritten';
  // Neither wins — a third mod overrides both
  return 'dead';
}

function renderConflictsTab() {
  const placeholder = document.getElementById('conflicts-placeholder');
  const content = document.getElementById('conflicts-content');
  const title = document.getElementById('conflicts-title');

  content.innerHTML = '';

  if (!conflictData) {
    placeholder.textContent = 'Click "Check Conflicts" in the toolbar to scan your mods.';
    placeholder.classList.remove('hidden');
    return;
  }

  if (!selectedMod) {
    placeholder.textContent = 'Select a mod to view its conflicts.';
    placeholder.classList.remove('hidden');
    return;
  }

  placeholder.classList.add('hidden');

  const modConflicts = conflictData.modConflicts[selectedMod.filename];

  if (!modConflicts || modConflicts.length === 0) {
    title.textContent = `${selectedMod.displayName} — Conflicts`;
    const noConf = document.createElement('div');
    noConf.className = 'no-conflicts';
    noConf.textContent = 'No conflicts detected for this mod.';
    content.appendChild(noConf);
    return;
  }

  // Group conflicts by other mod
  const byMod = {}; // otherModFilename -> { conflicts: [], loadOrder }

  for (const c of modConflicts) {
    for (const m of c.allMods) {
      if (m.filename === selectedMod.filename) continue;
      if (!byMod[m.filename]) {
        byMod[m.filename] = { conflicts: [], loadOrder: m.loadOrder };
      }
      byMod[m.filename].conflicts.push(c);
    }
  }

  const modNames = Object.keys(byMod);
  title.textContent = `${selectedMod.displayName} — conflicts with ${modNames.length} mods`;

  // Sort by load order
  modNames.sort((a, b) => byMod[a].loadOrder - byMod[b].loadOrder);

  for (const otherMod of modNames) {
    const info = byMod[otherMod];
    const displayName = otherMod.replace(/\.mod$/i, '');

    // Categorize conflicts by winner
    const greenConflicts = info.conflicts.filter((c) => c.winner === selectedMod.filename);
    const redConflicts = info.conflicts.filter((c) => c.winner === otherMod);
    const deadConflicts = info.conflicts.filter((c) => c.winner !== selectedMod.filename && c.winner !== otherMod);

    // Dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'conflict-dropdown';

    // Header (clickable)
    const header = document.createElement('div');
    header.className = 'conflict-dropdown-header';

    const arrow = document.createElement('span');
    arrow.className = 'conflict-dropdown-arrow';
    arrow.textContent = '\u25B6';

    const nameEl = document.createElement('span');
    nameEl.className = 'conflict-dropdown-name';
    nameEl.textContent = `#${info.loadOrder} ${displayName}`;

    const countEl = document.createElement('span');
    countEl.className = 'conflict-count-badge';
    countEl.textContent = info.conflicts.length;

    // Build header status labels based on winner categories
    const statusWrap = document.createElement('span');
    statusWrap.style.marginLeft = '6px';
    statusWrap.style.fontSize = '10px';

    if (greenConflicts.length > 0) {
      const s = document.createElement('span');
      s.className = 'conflict-mod-winner';
      s.textContent = `this mod overrides (${greenConflicts.length})`;
      statusWrap.appendChild(s);
    }
    if (redConflicts.length > 0) {
      if (statusWrap.childNodes.length > 0) statusWrap.append(' · ');
      const s = document.createElement('span');
      s.className = 'conflict-mod-loser';
      s.textContent = `overrides this mod (${redConflicts.length})`;
      statusWrap.appendChild(s);
    }
    if (deadConflicts.length > 0) {
      if (statusWrap.childNodes.length > 0) statusWrap.append(' · ');
      const s = document.createElement('span');
      s.className = 'conflict-mod-dead';
      s.textContent = `both overridden (${deadConflicts.length})`;
      statusWrap.appendChild(s);
    }

    header.append(arrow, nameEl, countEl, statusWrap);

    // Body (hidden by default)
    const body = document.createElement('div');
    body.className = 'conflict-dropdown-body hidden';

    // Green section — this mod wins
    if (greenConflicts.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'conflict-sub-section';
      const secTitle = document.createElement('div');
      secTitle.className = 'conflict-mod-winner';
      secTitle.textContent = `${selectedMod.displayName} overrides ${displayName} on ${greenConflicts.length} properties:`;
      sec.appendChild(secTitle);
      renderPropertyList(sec, greenConflicts);
      body.appendChild(sec);
    }

    // Red section — other mod wins
    if (redConflicts.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'conflict-sub-section';
      const secTitle = document.createElement('div');
      secTitle.className = 'conflict-mod-loser';
      secTitle.textContent = `${displayName} overrides ${selectedMod.displayName} on ${redConflicts.length} properties:`;
      sec.appendChild(secTitle);
      renderPropertyList(sec, redConflicts);
      body.appendChild(sec);
    }

    // Yellow section — both overridden by a third mod
    if (deadConflicts.length > 0) {
      // Group dead conflicts by actual winner for clarity
      const byWinner = {};
      for (const c of deadConflicts) {
        if (!byWinner[c.winner]) byWinner[c.winner] = [];
        byWinner[c.winner].push(c);
      }
      for (const [winnerFile, conflicts] of Object.entries(byWinner)) {
        const winnerName = winnerFile.replace(/\.mod$/i, '');
        const sec = document.createElement('div');
        sec.className = 'conflict-sub-section';
        const secTitle = document.createElement('div');
        secTitle.className = 'conflict-mod-dead';
        secTitle.textContent = `Both overridden by ${winnerName} on ${conflicts.length} properties:`;
        sec.appendChild(secTitle);
        renderPropertyList(sec, conflicts);
        body.appendChild(sec);
      }
    }

    header.addEventListener('click', () => {
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      arrow.textContent = isOpen ? '\u25B6' : '\u25BC';
    });

    dropdown.append(header, body);
    content.appendChild(dropdown);
  }
}

function renderPropertyList(container, conflicts) {
  // Group by item type+name
  const grouped = {};
  for (const c of conflicts) {
    const groupKey = `${c.type}: ${c.name}`;
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(c);
  }

  for (const [group, entries] of Object.entries(grouped)) {
    const item = document.createElement('div');
    item.className = 'conflict-prop-group';

    const itemTitle = document.createElement('div');
    itemTitle.className = 'conflict-key';
    itemTitle.textContent = `${group} (${entries.length})`;
    item.appendChild(itemTitle);

    for (const c of entries) {
      const prop = document.createElement('div');
      prop.className = 'conflict-prop';

      const hasValues = c.values && Object.keys(c.values).length > 0;

      // Check if this is a clickable zone file
      const isZone = /^zone\.\d+\.\d+\.zone$/i.test(c.key);

      if (hasValues) {
        // Expandable property with value details
        const propHeader = document.createElement('div');
        propHeader.className = 'conflict-prop-header';

        const arrow = document.createElement('span');
        arrow.className = 'conflict-prop-arrow';
        arrow.textContent = '\u25B6';

        const keySpan = document.createElement('span');
        keySpan.textContent = c.key;
        if (isZone) {
          keySpan.className = 'conflict-prop-zone';
          keySpan.title = 'Click to view on map';
          keySpan.addEventListener('click', (e) => { e.stopPropagation(); showZoneOnMap(c.key); });
        }

        propHeader.append(arrow, keySpan);

        const valuesDiv = document.createElement('div');
        valuesDiv.className = 'conflict-values-list hidden';

        // Winner row first (green, larger)
        const winnerVal = c.values[c.winner];
        if (winnerVal !== undefined) {
          const winnerName = c.winner.replace(/\.mod$/i, '');
          const winRow = document.createElement('div');
          winRow.className = 'conflict-value-row conflict-value-winner';

          const winMod = document.createElement('span');
          winMod.className = 'conflict-value-mod';
          winMod.textContent = winnerName + ':';

          const winVal = document.createElement('span');
          winVal.className = 'conflict-value-val';
          winVal.textContent = winnerVal;

          winRow.append(winMod, winVal);
          valuesDiv.appendChild(winRow);

          // Divider
          const divider = document.createElement('div');
          divider.className = 'conflict-value-divider';
          valuesDiv.appendChild(divider);
        }

        // Other mod values
        for (const [modFile, val] of Object.entries(c.values)) {
          if (modFile === c.winner) continue;
          const modName = modFile.replace(/\.mod$/i, '');
          const row = document.createElement('div');
          row.className = 'conflict-value-row';

          const modSpan = document.createElement('span');
          modSpan.className = 'conflict-value-mod';
          modSpan.textContent = modName + ':';

          const valSpan = document.createElement('span');
          valSpan.className = 'conflict-value-val';
          valSpan.textContent = val;

          row.append(modSpan, valSpan);
          valuesDiv.appendChild(row);
        }

        propHeader.addEventListener('click', () => {
          const open = !valuesDiv.classList.contains('hidden');
          valuesDiv.classList.toggle('hidden');
          arrow.textContent = open ? '\u25B6' : '\u25BC';
        });

        prop.append(propHeader, valuesDiv);
      } else if (isZone) {
        const keySpan = document.createElement('span');
        keySpan.className = 'conflict-prop-zone';
        keySpan.textContent = c.key;
        keySpan.title = 'Click to view on map';
        keySpan.addEventListener('click', () => showZoneOnMap(c.key));
        prop.appendChild(keySpan);
      } else {
        prop.textContent = c.key;
      }

      item.appendChild(prop);
    }

    container.appendChild(item);
  }
}

// ===== Default Categories =====

const DEFAULT_CATEGORIES = [
  { name: 'UI, Graphics, Performance', color: '#4a9f4a' },
  { name: 'Animations',               color: '#4a6fa5' },
  { name: 'New Races & Race Edits',    color: '#a5894a' },
  { name: 'Animals',                  color: '#8a6b3e' },
  { name: 'Game Starts',              color: '#7a4aa5' },
  { name: 'Faction Edits & Additions', color: '#4aa5a5' },
  { name: 'Buildings',                color: '#6b8f3e' },
  { name: 'Armor & Weapons',          color: '#a54a4a' },
  { name: 'Overhauls & World Changes', color: '#cc7a33' },
  { name: 'Patches',                  color: '#a54a7a' },
  { name: 'Economy',                  color: '#5a8a5a' },
];

function ensureDefaultCategories() {
  if (categories.length === 0) {
    categories = DEFAULT_CATEGORIES.map((def, i) => ({
      id: generateId(),
      name: def.name,
      color: def.color,
      order: i,
    }));
  }
}

// ===== Init =====

async function init() {
  config = await window.api.getConfig();
  if (config && config.gamePath) {
    categories = config.categories || [];
    modCategories = config.modCategories || {};
    modOrders = config.modOrders || {};
    uncategorizedPinned = config.uncategorizedPinned || false;
    if (uncategorizedPinned) {
      pinUncatBtn.classList.add('btn-pinned-active');
      pinUncatBtn.textContent = 'Unpin Uncategorized';
    }
    // Default to Kenshi theme unless explicitly set to false
    if (config.kenshiTheme !== false) {
      document.body.classList.add('kenshi-theme');
      themeToggleCb.checked = true;
    }
    tutorialDismissed = config.tutorialDismissed || false;
    if (!tutorialDismissed) {
      tutorialModal.classList.remove('hidden');
    }
    ensureDefaultCategories();
    showMainScreen();
    autoCheckForUpdate();
  } else {
    config = config || { categories: [], modCategories: {}, modOrders: {} };
    // Default to Kenshi theme on first launch
    document.body.classList.add('kenshi-theme');
    themeToggleCb.checked = true;
    ensureDefaultCategories();
    setupScreen.classList.remove('hidden');
    autoDetect();
  }
}

init();
