// Automatic vegetation / rock placement based on biomes.

import { newObject, objectType } from './model.js';
import { mulberry32, slopeAt } from './terrain.js';

// per biome key: chance per sample point and weighted object types
const RULES = {
  forest: { chance: 0.5, types: [['tree_oak', 0.32], ['tree_pine', 0.25], ['tree_birch', 0.15], ['bush', 0.16], ['fern', 0.12]] },
  jungle: { chance: 0.75, types: [['tree_jungle', 0.35], ['tree_palm', 0.15], ['fern', 0.3], ['bush', 0.2]] },
  grassland: { chance: 0.05, types: [['bush', 0.3], ['flowers', 0.35], ['tree_oak', 0.2], ['tree_birch', 0.15]] },
  savanna: { chance: 0.04, types: [['tree_oak', 0.3], ['bush', 0.5], ['tree_dead', 0.2]] },
  swamp: { chance: 0.25, types: [['reeds', 0.4], ['tree_dead', 0.3], ['bush', 0.15], ['mushroom', 0.15]] },
  farmland: { chance: 0.01, types: [['bush', 0.7], ['tree_oak', 0.3]] },
  tundra: { chance: 0.05, types: [['tree_snowpine', 0.5], ['tree_pine', 0.2], ['rock', 0.3]] },
  beach: { chance: 0.02, types: [['tree_palm', 1]] },
  rock: { chance: 0.07, types: [['rock', 0.7], ['boulder', 0.3]] },
  snow: { chance: 0.03, types: [['tree_snowpine', 0.45], ['rock', 0.55]] },
  desert: { chance: 0.012, types: [['cactus', 0.5], ['rock', 0.3], ['boulder', 0.1], ['tree_dead', 0.1]] },
  volcanic: { chance: 0.03, types: [['rock', 0.5], ['boulder', 0.3], ['tree_dead', 0.2]] },
  corrupted: { chance: 0.06, types: [['tree_dead', 0.5], ['crystal', 0.3], ['mushroom', 0.2]] },
};

export const NATURE_TYPES = new Set(['tree_oak', 'tree_birch', 'tree_pine', 'tree_snowpine', 'tree_jungle', 'tree_palm', 'tree_dead', 'cactus', 'bush', 'fern', 'reeds', 'flowers', 'rock', 'boulder', 'crystal', 'mushroom']);

function pick(types, r) {
  let acc = 0;
  for (const [t, w] of types) { acc += w; if (r <= acc) return t; }
  return types[types.length - 1][0];
}

// Mutates map.objects. Returns the number of objects added.
export function autoDecorate(map, { density = 0.5, seed = 1, spacing = 4, clearExisting = true, maxObjects = 60000 } = {}) {
  const rand = mulberry32(seed * 31 + 7);
  if (clearExisting) map.objects = map.objects.filter((o) => !(o.auto || (NATURE_TYPES.has(o.type) && objectType(o.type).cat === 'Nature' && o.name === '' && Object.keys(o.props || {}).length === 0)));
  const step = Math.max(spacing, map.cellSize * 0.75);
  const keyOf = new Map(map.palette.map((p) => [p.id, p.key]));
  let added = 0;
  for (let y = 0; y <= map.worldHeight && added < maxObjects; y += step) {
    for (let x = 0; x <= map.worldWidth && added < maxObjects; x += step) {
      const px = x + (rand() - 0.5) * step * 0.9, py = y + (rand() - 0.5) * step * 0.9;
      if (px < 0 || py < 0 || px > map.worldWidth || py > map.worldHeight) continue;
      const cx = Math.round(px / map.cellSize), cy = Math.round(py / map.cellSize);
      const i = cy * map.width + cx;
      if (map.heights[i] < map.seaLevel) continue;
      const rule = RULES[keyOf.get(map.biomes[i])];
      if (!rule || rand() > rule.chance * density * 2) continue;
      const type = pick(rule.types, rand());
      if (type.startsWith('tree') && slopeAt(map, cx, cy) > 1.2) continue;
      map.objects.push(newObject(type, Math.round(px * 100) / 100, Math.round(py * 100) / 100, {
        rotation: Math.round(rand() * 360),
        scale: Math.round((0.8 + rand() * 0.45) * 100) / 100,
        auto: true,
      }));
      added++;
    }
  }
  return added;
}
