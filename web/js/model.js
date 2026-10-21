// Map document model: the .wmap.json format, palettes and the object catalog.
// Coordinates of objects/paths/regions are in world units, origin at the
// north-west corner, x = east, y = south. Terrain sample (i, j) sits at
// world (i * cellSize, j * cellSize).

export const FORMAT = 'worldmap';
export const VERSION = 1;

export const DEFAULT_BIOMES = [
  { id: 0, key: 'deep_water', name: 'Deep Water', color: '#1d3f6e' },
  { id: 1, key: 'shallow_water', name: 'Shallow Water', color: '#3f7fae' },
  { id: 2, key: 'beach', name: 'Beach / Sand', color: '#dccb8f' },
  { id: 3, key: 'grassland', name: 'Grassland', color: '#7fae4e' },
  { id: 4, key: 'forest', name: 'Forest', color: '#3f7a37' },
  { id: 5, key: 'jungle', name: 'Jungle', color: '#2b5f2b' },
  { id: 6, key: 'swamp', name: 'Swamp', color: '#58693c' },
  { id: 7, key: 'farmland', name: 'Farmland', color: '#b9a85c' },
  { id: 8, key: 'dirt', name: 'Dirt', color: '#8a6a45' },
  { id: 9, key: 'desert', name: 'Desert', color: '#e2c27b' },
  { id: 10, key: 'savanna', name: 'Savanna', color: '#b4ad58' },
  { id: 11, key: 'rock', name: 'Rock / Cliff', color: '#8a8580' },
  { id: 12, key: 'snow', name: 'Snow', color: '#eef1f5' },
  { id: 13, key: 'tundra', name: 'Tundra', color: '#9ba696' },
  { id: 14, key: 'volcanic', name: 'Volcanic Ash', color: '#45393a' },
  { id: 15, key: 'lava', name: 'Lava', color: '#e2531d' },
  { id: 16, key: 'paved', name: 'Paved / Town', color: '#9d9384' },
  { id: 17, key: 'corrupted', name: 'Corrupted Land', color: '#6b4a7a' },
];

// shape = how the 3D preview draws it; size = rough height/footprint in metres;
// r = collision radius in metres at scale 1 (0 or missing = the player walks through it)
export const OBJECT_TYPES = [
  // Nature
  { type: 'tree_oak', cat: 'Nature', name: 'Oak Tree', icon: '🌳', color: '#2f6b2a', size: 7, shape: 'tree_round', r: 0.45 },
  { type: 'tree_birch', cat: 'Nature', name: 'Birch Tree', icon: '🌳', color: '#6fa83e', size: 8, shape: 'tree_birch', r: 0.3 },
  { type: 'tree_pine', cat: 'Nature', name: 'Pine Tree', icon: '🌲', color: '#22553a', size: 9, shape: 'tree_cone', r: 0.4 },
  { type: 'tree_snowpine', cat: 'Nature', name: 'Snowy Pine', icon: '🌲', color: '#2b5a45', size: 9, shape: 'tree_snowpine', r: 0.4 },
  { type: 'tree_jungle', cat: 'Nature', name: 'Jungle Tree', icon: '🌴', color: '#2f7a2c', size: 13, shape: 'tree_jungle', r: 0.7 },
  { type: 'tree_palm', cat: 'Nature', name: 'Palm Tree', icon: '🌴', color: '#4c8a32', size: 8, shape: 'tree_palm', r: 0.3 },
  { type: 'tree_dead', cat: 'Nature', name: 'Dead Tree', icon: '🥀', color: '#6d5a48', size: 6, shape: 'tree_dead', r: 0.35 },
  { type: 'cactus', cat: 'Nature', name: 'Cactus', icon: '🌵', color: '#4f8a3a', size: 4, shape: 'cactus', r: 0.4 },
  { type: 'bush', cat: 'Nature', name: 'Bush', icon: '🌿', color: '#3d7d32', size: 1.6, shape: 'bush' },
  { type: 'fern', cat: 'Nature', name: 'Fern', icon: '🌱', color: '#4f9a3a', size: 1.2, shape: 'fern' },
  { type: 'reeds', cat: 'Nature', name: 'Reeds', icon: '🌾', color: '#8a9a4a', size: 1.8, shape: 'reeds' },
  { type: 'flowers', cat: 'Nature', name: 'Flowers', icon: '🌼', color: '#e5c84a', size: 0.6, shape: 'flowers' },
  { type: 'rock', cat: 'Nature', name: 'Rock', icon: '🪨', color: '#7d7a76', size: 1.5, shape: 'rock', r: 0.6 },
  { type: 'boulder', cat: 'Nature', name: 'Boulder', icon: '⛰️', color: '#6c6965', size: 4, shape: 'rock', r: 1.8 },
  { type: 'crystal', cat: 'Nature', name: 'Crystal', icon: '💎', color: '#7fd3f0', size: 2.5, shape: 'crystal', r: 0.6 },
  { type: 'mushroom', cat: 'Nature', name: 'Giant Mushroom', icon: '🍄', color: '#c8473d', size: 3, shape: 'mushroom', r: 0.35 },
  // Structures
  { type: 'house', cat: 'Structures', name: 'House', icon: '🏠', color: '#b5835a', size: 6, shape: 'house', r: 3 },
  { type: 'barn', cat: 'Structures', name: 'Farm / Barn', icon: '🛖', color: '#9c4a35', size: 7, shape: 'house', r: 3.5 },
  { type: 'shop', cat: 'Structures', name: 'Shop / Inn', icon: '🏪', color: '#c99a5b', size: 7, shape: 'house', r: 3.5 },
  { type: 'tower', cat: 'Structures', name: 'Tower', icon: '🗼', color: '#8f8a83', size: 16, shape: 'tower', r: 3 },
  { type: 'castle', cat: 'Structures', name: 'Castle', icon: '🏰', color: '#a19c94', size: 22, shape: 'castle', r: 10 },
  { type: 'temple', cat: 'Structures', name: 'Temple / Shrine', icon: '⛩️', color: '#c9b48a', size: 9, shape: 'temple', r: 4.5 },
  { type: 'ruins', cat: 'Structures', name: 'Ruins', icon: '🏛️', color: '#9a9488', size: 5, shape: 'ruins', r: 1.5 },
  { type: 'windmill', cat: 'Structures', name: 'Windmill', icon: '🌬️', color: '#cfc3a8', size: 12, shape: 'tower', r: 2.5 },
  { type: 'lighthouse', cat: 'Structures', name: 'Lighthouse', icon: '🚨', color: '#e9e4dc', size: 20, shape: 'tower', r: 3.5 },
  { type: 'well', cat: 'Structures', name: 'Well', icon: '🪣', color: '#7d7a76', size: 1.5, shape: 'well', r: 0.7 },
  { type: 'camp', cat: 'Structures', name: 'Camp / Tent', icon: '⛺', color: '#c2a06a', size: 3, shape: 'tent', r: 1.5 },
  { type: 'mine', cat: 'Structures', name: 'Mine', icon: '⛏️', color: '#5b4c3e', size: 5, shape: 'cave', r: 2.5 },
  { type: 'bridge', cat: 'Structures', name: 'Bridge', icon: '🌉', color: '#8b6a45', size: 2, shape: 'bridge', deck: [{ a: [-1.5, 0], b: [1.5, 0], w: 1, y: 0.15 }] },
  // Transport hubs. `deck` = walkable surfaces in shape units (x east, z south at rotation 0,
  // scaled by size): they count as roads for walkability and walk mode can stand on them.
  // `level: true` decks are flattened by "Level the ground here".
  {
    type: 'port', cat: 'Structures', name: 'Port / Harbor', icon: '⚓', color: '#8b6a45', size: 40, shape: 'port',
    props: { portId: '', targetMap: '', targetSpawn: '' },
    deck: [{ a: [-0.5, 0.12], b: [0.5, 0.12], w: 0.35, y: 0.05, level: true }, { a: [0, 0], b: [0, -0.95], w: 0.1, y: 0.05 }],
  },
  {
    type: 'airport', cat: 'Structures', name: 'Airport', icon: '✈️', color: '#c9d3dc', size: 160, shape: 'airport',
    props: { airportId: '', targetMap: '', targetSpawn: '' },
    deck: [{ a: [-0.5, 0.25], b: [0.5, 0.25], w: 0.06, y: 0.004, level: true }, { a: [-0.2, 0.05], b: [0.2, 0.05], w: 0.14, y: 0.004, level: true }, { a: [0, 0.1], b: [0, 0.25], w: 0.03, y: 0.004, level: true }],
  },
  {
    type: 'train_station', cat: 'Structures', name: 'Train Station', icon: '🚉', color: '#b5835a', size: 24, shape: 'train_station',
    props: { stationId: '', lineId: '', targetMap: '', targetSpawn: '' },
    deck: [{ a: [-0.5, 0.15], b: [0.5, 0.15], w: 0.16, y: 0.05, level: true }, { a: [-0.25, -0.1], b: [0.25, -0.1], w: 0.3, y: 0, level: true }],
  },
  // Settlements (map markers)
  { type: 'city', cat: 'Settlements', name: 'City', icon: '🏙️', color: '#e0b04f', size: 30, shape: 'settlement', marker: true },
  { type: 'town', cat: 'Settlements', name: 'Town', icon: '🏘️', color: '#e0b04f', size: 20, shape: 'settlement', marker: true },
  { type: 'village', cat: 'Settlements', name: 'Village', icon: '🏡', color: '#e0b04f', size: 12, shape: 'settlement', marker: true },
  // Gameplay
  { type: 'player_spawn', cat: 'Gameplay', name: 'Player Spawn', icon: '🚩', color: '#3ecf6e', size: 3, shape: 'marker', props: { spawnId: 'start' } },
  { type: 'enemy_spawn', cat: 'Gameplay', name: 'Enemy Spawn', icon: '👹', color: '#e04848', size: 3, shape: 'marker', props: { enemy: '', count: 3, level: 1, respawnSeconds: 120 } },
  { type: 'boss', cat: 'Gameplay', name: 'Boss', icon: '💀', color: '#b02a2a', size: 5, shape: 'marker', props: { boss: '', level: 10 } },
  { type: 'npc', cat: 'Gameplay', name: 'NPC', icon: '🧑', color: '#5aa5e8', size: 2, shape: 'marker', props: { npcId: '', dialogue: '' } },
  { type: 'quest_giver', cat: 'Gameplay', name: 'Quest Giver', icon: '❗', color: '#f5c542', size: 2, shape: 'marker', props: { npcId: '', questId: '' } },
  { type: 'merchant', cat: 'Gameplay', name: 'Merchant', icon: '💰', color: '#d9a640', size: 2, shape: 'marker', props: { shopId: '' } },
  { type: 'chest', cat: 'Gameplay', name: 'Chest / Loot', icon: '🧰', color: '#b8862f', size: 1, shape: 'chest', props: { lootTable: '' }, r: 0.5 },
  { type: 'resource', cat: 'Gameplay', name: 'Resource Node', icon: '🔶', color: '#d48a2c', size: 1.5, shape: 'crystal', props: { resource: 'iron_ore', amount: 5 }, r: 0.5 },
  { type: 'portal', cat: 'Gameplay', name: 'Portal / Map Link', icon: '🌀', color: '#a066ff', size: 4, shape: 'portal', props: { targetMap: '', targetSpawn: 'start' } },
  { type: 'dungeon_entrance', cat: 'Gameplay', name: 'Dungeon Entrance', icon: '🕳️', color: '#4b3b5c', size: 5, shape: 'cave', props: { targetMap: '', targetSpawn: 'start' } },
  { type: 'cave', cat: 'Gameplay', name: 'Cave', icon: '🦇', color: '#4a4038', size: 5, shape: 'cave', props: { targetMap: '' } },
  { type: 'waypoint', cat: 'Gameplay', name: 'Waypoint / Fast Travel', icon: '🔷', color: '#45c4e0', size: 3, shape: 'marker', props: { waypointId: '' } },
  { type: 'sign', cat: 'Gameplay', name: 'Signpost / Lore', icon: '🪧', color: '#a07a4a', size: 2, shape: 'sign', props: { text: '' } },
  { type: 'trigger', cat: 'Gameplay', name: 'Trigger Point', icon: '⚡', color: '#ffd23f', size: 2, shape: 'marker', props: { event: '', radius: 5 } },
  { type: 'custom', cat: 'Gameplay', name: 'Custom Marker', icon: '📍', color: '#ff6b9a', size: 2, shape: 'marker' },
];

// guide: shapes the terrain when you press "Apply to terrain"; not drawn in 3D
export const PATH_TYPES = [
  { type: 'road', name: 'Road', color: '#b08a5a', width: 4, icon: '🛣️' },
  { type: 'trail', name: 'Trail', color: '#c9a978', width: 1.5, icon: '👣' },
  { type: 'river', name: 'River', color: '#3d86c6', width: 6, icon: '🌊' },
  { type: 'stream', name: 'Stream', color: '#5ea2d8', width: 2, icon: '💧' },
  { type: 'wall', name: 'Wall', color: '#9a958c', width: 1.5, icon: '🧱', height: 5 },
  { type: 'fence', name: 'Fence', color: '#8b6a45', width: 0.3, icon: '🪵', height: 1.3 },
  { type: 'cliff_edge', name: 'Cliff Edge', color: '#5f5a55', width: 1, icon: '🧗' },
  { type: 'ridge', name: 'Mountain Range', color: '#e8e0d4', width: 70, icon: '🏔️', guide: true, props: { height: 70 } },
  { type: 'rift', name: 'Rift / Canyon', color: '#c0703d', width: 24, icon: '🏜️', guide: true, props: { depth: 30 } },
  { type: 'railway', name: 'Train Line', color: '#3b3734', width: 3.5, icon: '🚆', props: { lineId: '', speedKmh: 80 } },
  { type: 'route', name: 'Patrol / Quest Route', color: '#ff7ad9', width: 1, icon: '🧭', virtual: true },
];

// Rules for the walkability grid. Saved in the map so games can use the same rules.
export const NAV_DEFAULTS = { maxSlopeDeg: 40, maxWadeDepth: 0.8, eyeHeight: 1.7 };

export const REGION_TYPES = [
  { type: 'zone', name: 'Named Area', color: '#ffd166', props: { music: '', ambience: '' } },
  { type: 'quest', name: 'Quest Area', color: '#f5c542', props: { questId: '', stage: '' } },
  { type: 'level', name: 'Level / Difficulty Zone', color: '#ef8354', props: { levelMin: 1, levelMax: 5 } },
  { type: 'spawn_area', name: 'Enemy Spawn Area', color: '#e04848', props: { enemies: '', density: 0.5 } },
  { type: 'safe', name: 'Safe Zone', color: '#3ecf6e', props: {} },
  { type: 'danger', name: 'Danger / Hazard', color: '#b02a2a', props: { damagePerSecond: 5 } },
  { type: 'kingdom', name: 'Kingdom / Faction', color: '#7aa2ff', props: { faction: '' } },
  { type: 'no_build', name: 'Blocked / No-Go', color: '#888888', props: {} },
];

export const MAP_KINDS = [
  ['world', 'Main World'], ['quest', 'Quest World'], ['dungeon', 'Dungeon'],
  ['town', 'Town / Hub'], ['arena', 'Arena'], ['other', 'Other'],
];

export const objectType = (t) => OBJECT_TYPES.find((o) => o.type === t) || OBJECT_TYPES[OBJECT_TYPES.length - 1];
export const pathType = (t) => PATH_TYPES.find((p) => p.type === t) || PATH_TYPES[0];

// An object's walkable decks in world space: [{ a: [x, y], b: [x, y], w, y: height above the object's base, level }]
export function objectDecks(o) {
  const def = objectType(o.type);
  if (!def.deck) return [];
  const s = def.size * (o.scale || 1), th = (o.rotation || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
  const tf = ([x, z]) => [o.x + (x * c - z * sn) * s, o.y + (x * sn + z * c) * s];
  return def.deck.map((d) => ({ a: tf(d.a), b: tf(d.b), w: d.w * s, y: d.y * s, level: !!d.level }));
}
export const regionType = (t) => REGION_TYPES.find((r) => r.type === t) || REGION_TYPES[0];

let idCounter = 0;
export function uid(prefix) {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}${idCounter.toString(36)}`;
}

export function slugify(name) {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return s || 'map';
}

// ------------------------------------------------------------ base64 arrays

function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------ the map

export class WorldMap {
  constructor({ width = 256, height = 256, cellSize = 4, heightScale = 150, seaLevel = 0.3, name = 'Untitled World', kind = 'world' } = {}) {
    const now = new Date().toISOString();
    this.meta = { id: slugify(name), name, kind, description: '', author: '', created: now, modified: now, tags: [], seed: 0 };
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.heightScale = heightScale;
    this.seaLevel = seaLevel;
    this.heights = new Float32Array(width * height).fill(Math.min(1, seaLevel + 0.08));
    this.biomes = new Uint8Array(width * height).fill(3);
    this.palette = DEFAULT_BIOMES.map((b) => ({ ...b }));
    this.objects = [];
    this.paths = [];
    this.regions = [];
    this.properties = {};
    this.navigation = { ...NAV_DEFAULTS };
  }

  get worldWidth() { return (this.width - 1) * this.cellSize; }
  get worldHeight() { return (this.height - 1) * this.cellSize; }

  biome(id) { return this.palette.find((b) => b.id === id) || this.palette[0]; }

  // bilinear normalized height at cell coordinates
  heightAtCell(fx, fy) {
    const w = this.width, h = this.height;
    fx = Math.min(Math.max(fx, 0), w - 1);
    fy = Math.min(Math.max(fy, 0), h - 1);
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const ax = fx - x0, ay = fy - y0, H = this.heights;
    const top = H[y0 * w + x0] * (1 - ax) + H[y0 * w + x1] * ax;
    const bot = H[y1 * w + x0] * (1 - ax) + H[y1 * w + x1] * ax;
    return top * (1 - ay) + bot * ay;
  }

  // ground height in world units at world position
  groundY(x, y) { return this.heightAtCell(x / this.cellSize, y / this.cellSize) * this.heightScale; }

  findEntity(id) {
    for (const coll of ['objects', 'paths', 'regions']) {
      const i = this[coll].findIndex((e) => e.id === id);
      if (i >= 0) return { coll, index: i, item: this[coll][i] };
    }
    return null;
  }

  toJSON() {
    this.meta.modified = new Date().toISOString();
    return {
      format: FORMAT,
      version: VERSION,
      meta: this.meta,
      terrain: {
        width: this.width,
        height: this.height,
        cellSize: this.cellSize,
        heightScale: this.heightScale,
        seaLevel: this.seaLevel,
        heights: { encoding: 'base64-f32le', data: bytesToB64(new Uint8Array(this.heights.buffer, this.heights.byteOffset, this.heights.byteLength)) },
        biomes: { encoding: 'base64-u8', data: bytesToB64(this.biomes) },
        biomePalette: this.palette,
      },
      objects: this.objects,
      paths: this.paths,
      regions: this.regions,
      properties: this.properties,
      navigation: this.navigation,
    };
  }

  static fromJSON(doc) {
    if (doc.format !== FORMAT) throw new Error('Not a worldmap file');
    if (doc.version > VERSION) throw new Error(`File version ${doc.version} is newer than this editor (${VERSION})`);
    const t = doc.terrain;
    const m = new WorldMap({ width: t.width, height: t.height, cellSize: t.cellSize, heightScale: t.heightScale, seaLevel: t.seaLevel });
    m.meta = { ...m.meta, ...doc.meta };
    const hb = b64ToBytes(t.heights.data);
    m.heights = new Float32Array(hb.buffer, 0, t.width * t.height).slice();
    m.biomes = b64ToBytes(t.biomes.data).slice(0, t.width * t.height);
    if (m.heights.length !== t.width * t.height || m.biomes.length !== t.width * t.height) throw new Error('Terrain data is truncated');
    if (Array.isArray(t.biomePalette) && t.biomePalette.length) m.palette = t.biomePalette;
    m.objects = doc.objects || [];
    m.paths = doc.paths || [];
    m.regions = doc.regions || [];
    m.properties = doc.properties || {};
    m.navigation = { ...NAV_DEFAULTS, ...(doc.navigation || {}) };
    return m;
  }
}

export function newObject(type, x, y, extra = {}) {
  const def = objectType(type);
  return { id: uid('o'), type, name: '', x, y, rotation: 0, scale: 1, elevation: 0, props: { ...(def.props || {}) }, ...extra };
}

export function newPath(type, points) {
  const def = pathType(type);
  return { id: uid('p'), type, name: '', width: def.width, closed: false, points, props: { ...(def.props || {}) } };
}

export function newRegion(type, points) {
  const def = regionType(type);
  return { id: uid('r'), type, name: def.name, color: def.color, points, props: { ...(def.props || {}) } };
}
