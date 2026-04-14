// Pre-fetched load order guide from:
// https://steamcommunity.com/sharedfiles/filedetails/?id=1850250979
// "Proper Load Order & You" by the Kenshi modding community
//
// Embedded as a constant so we never need to fetch it at runtime.

const LOAD_ORDER_GUIDE = `
KENSHI MOD LOAD ORDER GUIDE
============================

Core Rule: Mods lower in the order overwrite mods higher in the order.

CATEGORY 1: UI, Graphics, Performance
--------------------------------------
Loads FIRST. Foundational visual and performance changes.
Includes:
- World textures and texture replacements
- Weather effects and weather overhauls
- Foliage, ground clutter, grass mods
- Map modifications and map texture changes
- UI/HUD/interface mods (menus, fonts, health bars, inventory UI)
- Performance optimization mods (reduced particles, simplified meshes)
- Camera mods
- Lighting changes

CATEGORY 2: Animations
-----------------------
Loads second. Major base game modifications affecting gameplay visuals.
Includes:
- Combat animation overhauls
- Character animation replacements
- Movement animation changes
- Idle animation mods
- Martial arts animation edits

CATEGORY 3: New Races & Race Edits
------------------------------------
Establishes character customization foundation.
Load order within category:
1. Base game race unlocks (making existing hidden races playable)
2. New custom races
3. Cosmetics (new hair, eyes, body features, skin colors)
4. Race stat modifications and balance edits
Base game race edits should remain near the top of this section.

CATEGORY 4: Animals
--------------------
Animal-related content that isn't part of larger overhauls.
Includes:
- New animal species
- Animal stat edits
- Animal backpacks and armor
- Taming/recruitment mechanics for animals
- Animal AI behavior changes
Note: Mods that add both animals AND major world changes belong in Overhauls.

CATEGORY 5: Game Starts
-------------------------
Character and game beginning modifications.
Includes:
- New game start scenarios
- Starting location changes
- Recruit mods and companion additions
- Minor character additions
- Starting equipment/money changes
Note: Mods combining new races + game starts should load before standalone starts.

CATEGORY 6: Faction Edits & Additions
---------------------------------------
Minor faction changes that don't constitute full overhauls.
Includes:
- Minor faction squad/patrol changes
- Bounty system additions
- Spawn mechanic edits
- Small new faction additions
- Faction dialogue edits
- Town population changes
Follows the overwrite rule with flexible ordering within the category.

CATEGORY 7: Buildings
----------------------
Construction and building-related content.
Load order within category:
1. Standalone building additions (new placeable buildings)
2. Furniture and interior additions
3. Major standalone building packs
4. Training dummies and furniture overhauls
5. Building overhauls (changing existing buildings)
6. Building stat edits
7. Building placement mechanic edits

CATEGORY 8: Armor & Weapons
-----------------------------
Equipment and gear modifications.
Load order within category:
1. Standalone new items (individual weapons/armor)
2. Larger item packs and collections
3. Faction-specific equipment additions
4. Equipment overhauls (rebalancing existing items)
5. Crafting system changes
Faction equipment additions should load last in this section.

CATEGORY 9: Overhauls & World Changes
---------------------------------------
CRITICAL: "THESE MODS ARE NOT COMPATIBLE WITH EACH OTHER UNLESS SPECIFICALLY STATED SO."
The most complex section. Read mod descriptions carefully.
Load order within category:
1. Minor faction additions (small new factions with bases)
2. Item overhauls that add locations
3. Armor/weapon overhauls that add world locations
4. Sectional map overhauls (editing parts of the map)
5. Faction overhauls (major faction reworks)
6. World overhauls (large-scale world changes)
7. Mechanic + item combination overhauls
8. Total/complete overhauls (Genesis, Kaizo, Reactive World, etc.)
Many overhauls in this section are mutually exclusive.

CATEGORY 10: Patches
---------------------
Compatibility patches between mods. MUST load after all mods they patch.
Includes:
- Compatibility patches for overhaul mods
- Conflict resolution patches
- Balance patches between major mods
- Bug fix patches for other mods
Load LAST among the mods they affect to prevent accidental overwrites.

CATEGORY 11: Economy
---------------------
Loads LAST. Affects all in-game merchants regardless of which mod added them.
Includes:
- Merchant inventory changes
- Economy rebalancing
- Shop/store modifications
- Trade system overhauls
- Price adjustments
`;

const CATEGORIES = [
  'UI, Graphics, Performance',
  'Animations',
  'New Races & Race Edits',
  'Animals',
  'Game Starts',
  'Faction Edits & Additions',
  'Buildings',
  'Armor & Weapons',
  'Overhauls & World Changes',
  'Patches',
  'Economy',
];

module.exports = { LOAD_ORDER_GUIDE, CATEGORIES };
