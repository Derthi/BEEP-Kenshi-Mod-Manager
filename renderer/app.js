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
});

// ===== Panel Resize =====

const resizeHandle = document.getElementById('panel-resize-handle');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
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

let dragMouseX = 0;
let dragMouseY = 0;
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
generateConflictsBtn.addEventListener('click', async () => {
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
});

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
  for (const cat of allCats) {
    columnsContainer.appendChild(createColumn(
      cat.id, cat.name, cat.color || '#555', globalOrder
    ));
  }

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

  const headerCount = document.createElement('span');
  headerCount.className = 'column-header-count';
  if (activeInCat.length > 0) {
    const first = globalOrder[activeInCat[0].filename];
    const last = globalOrder[activeInCat[activeInCat.length - 1].filename];
    headerCount.textContent = `#${first}-${last}`;
  } else {
    headerCount.textContent = '0';
  }

  header.append(headerCb, headerName, headerCount);

  // Right-click context menu (not for uncategorized)
  if (catId !== UNCATEGORIZED) {
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, catId);
    });

    // Drag column headers to reorder categories
    header.draggable = true;

    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/category-id', catId);
      // Prevent mod card drag data from conflicting
      e.stopPropagation();
    });

    header.addEventListener('dragover', (e) => {
      // Only accept category drags
      if (!e.dataTransfer.types.includes('application/category-id')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      header.classList.add('header-drag-over');
    });

    header.addEventListener('dragleave', () => {
      header.classList.remove('header-drag-over');
    });

    header.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove('header-drag-over');
      const srcId = e.dataTransfer.getData('application/category-id');
      if (!srcId || srcId === catId) return;
      reorderCategory(srcId, catId);
    });
  }

  col.appendChild(header);

  // Mod list
  const modsList = document.createElement('div');
  modsList.className = 'column-mods';
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
    const filename = e.dataTransfer.getData('text/plain');
    if (!filename) return;
    const mod = mods.find((m) => m.filename === filename);
    if (!mod) return;

    // If dropping on empty area of column, append to end
    if (e.target === modsList || e.target === col) {
      moveMod(mod, catId, null);
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
  if (selectedMod && selectedMod.filePath === mod.filePath) card.classList.add('selected');
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

  // Click to select
  card.addEventListener('click', () => {
    selectedMod = mod;
    renderColumns();
  });

  // Right-click to assign category
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showModContextMenu(e.clientX, e.clientY, mod);
  });

  // Drag
  card.draggable = true;

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', mod.filename);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over-card, .drag-over-column').forEach((el) => {
      el.classList.remove('drag-over-card', 'drag-over-column');
    });
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-over-card');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-card');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drag-over-card');
    const filename = e.dataTransfer.getData('text/plain');
    if (!filename || filename === mod.filename) return;
    const draggedMod = mods.find((m) => m.filename === filename);
    if (!draggedMod) return;

    // Drop onto this card — insert before it in this card's category
    moveMod(draggedMod, mod.category, mod.filename);
  });

  return card;
}

// ===== Drag Move =====

function moveMod(mod, targetCatId, beforeFilename) {
  // If moving to uncategorized and it was active in another category, keep active
  // If deactivated, it's already in uncategorized

  mod.category = targetCatId;
  modCategories[mod.filename] = targetCatId === UNCATEGORIZED ? undefined : targetCatId;
  if (targetCatId === UNCATEGORIZED) delete modCategories[mod.filename];

  // Update order lists
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

  syncModCategories();
  persistConfig();
  renderColumns();
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

  // Build category list
  modContextCategories.innerHTML = '';
  const allCats = [...categories].sort((a, b) => a.order - b.order);
  allCats.push({ id: UNCATEGORIZED, name: 'Uncategorized', color: '#555' });

  for (const cat of allCats) {
    if (cat.id === mod.category) continue; // skip current category
    const item = document.createElement('div');
    item.className = 'context-item';
    const dot = document.createElement('span');
    dot.className = 'context-cat-dot';
    dot.style.backgroundColor = cat.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(cat.name));
    item.addEventListener('click', () => {
      moveMod(mod, cat.id, null);
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

addCategoryBtn.addEventListener('click', async () => {
  const name = await showInputModal('New category name:', '');
  if (!name || !name.trim()) return;

  const newCat = {
    id: generateId(),
    name: name.trim(),
    color: randomColor(),
    order: categories.length,
  };
  categories.push(newCat);
  modOrders[newCat.id] = [];
  syncModCategories();
  persistConfig();
  renderColumns();
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
const tabConflicts = document.getElementById('tab-conflicts');
const tabGuide = document.getElementById('tab-guide');
const tabPacks = document.getElementById('tab-packs');
const tabWorkshop = document.getElementById('tab-workshop');
const detailView = document.getElementById('detail-view');
const modpageView = document.getElementById('modpage-view');
const conflictsView = document.getElementById('conflicts-view');
const guideView = document.getElementById('guide-view');
const packsView = document.getElementById('packs-view');
const workshopView = document.getElementById('workshop-view');

function switchTab(activeTab) {
  const tabs = [tabDetails, tabModpage, tabConflicts, tabGuide, tabPacks, tabWorkshop];
  const views = [detailView, modpageView, conflictsView, guideView, packsView, workshopView];
  tabs.forEach((t, i) => {
    t.classList.toggle('active', t === activeTab);
    views[i].classList.toggle('hidden', t !== activeTab);
  });
}

tabDetails.addEventListener('click', () => switchTab(tabDetails));
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

// AI Sort Guide
const aiGuideBtn = document.getElementById('ai-guide-btn');
const aiGuideModal = document.getElementById('ai-guide-modal');
const aiGuideClose = document.getElementById('ai-guide-close');

aiGuideBtn.addEventListener('click', () => {
  aiGuideModal.classList.remove('hidden');
});
aiGuideClose.addEventListener('click', () => {
  aiGuideModal.classList.add('hidden');
});

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
  let selfOrder = 0;
  let otherOrder = 0;

  for (const c of selfConflicts) {
    const selfEntry = c.allMods.find((m) => m.filename === selfFilename);
    const otherEntry = c.allMods.find((m) => m.filename === otherFilename);
    if (!otherEntry) continue;
    hasConflict = true;
    selfOrder = selfEntry.loadOrder;
    otherOrder = otherEntry.loadOrder;
    break;
  }

  if (!hasConflict) return null;
  // Higher load order number = loads later = wins
  return selfOrder > otherOrder ? 'overwriting' : 'overwritten';
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

  // Get selected mod's load order position
  const selfEntry = modConflicts[0]?.allMods?.find((m) => m.filename === selectedMod.filename);
  const selfOrder = selfEntry ? selfEntry.loadOrder : 0;

  // Group conflicts by other mod, using load order to determine direction
  const byMod = {}; // otherModFilename -> { conflicts: [], loadOrder, thisModWins }

  for (const c of modConflicts) {
    for (const m of c.allMods) {
      if (m.filename === selectedMod.filename) continue;
      if (!byMod[m.filename]) {
        byMod[m.filename] = {
          conflicts: [],
          loadOrder: m.loadOrder,
          thisModWins: selfOrder > m.loadOrder, // higher load order = wins
        };
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

    const statusEl = document.createElement('span');
    statusEl.style.marginLeft = '6px';
    statusEl.style.fontSize = '10px';
    if (info.thisModWins) {
      statusEl.className = 'conflict-mod-winner';
      statusEl.textContent = `this mod overrides (${info.conflicts.length})`;
    } else {
      statusEl.className = 'conflict-mod-loser';
      statusEl.textContent = `overrides this mod (${info.conflicts.length})`;
    }

    header.append(arrow, nameEl, countEl, statusEl);

    // Body (hidden by default)
    const body = document.createElement('div');
    body.className = 'conflict-dropdown-body hidden';

    const sec = document.createElement('div');
    sec.className = 'conflict-sub-section';
    const secTitle = document.createElement('div');
    if (info.thisModWins) {
      secTitle.className = 'conflict-mod-winner';
      secTitle.textContent = `${selectedMod.displayName} overrides ${displayName} on ${info.conflicts.length} properties:`;
    } else {
      secTitle.className = 'conflict-mod-loser';
      secTitle.textContent = `${displayName} overrides ${selectedMod.displayName} on ${info.conflicts.length} properties:`;
    }
    sec.appendChild(secTitle);
    renderPropertyList(sec, info.conflicts);
    body.appendChild(sec);

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
      prop.textContent = c.key;
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
    ensureDefaultCategories();
    showMainScreen();
  } else {
    config = config || { categories: [], modCategories: {}, modOrders: {} };
    ensureDefaultCategories();
    setupScreen.classList.remove('hidden');
    autoDetect();
  }
}

init();
