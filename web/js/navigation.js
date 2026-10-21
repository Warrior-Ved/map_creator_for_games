// Walkability grid: one category per terrain sample. The same grid drives
// the 2D overlay, walk-mode collisions and the exported walkmap.png.

import { objectType, objectDecks, NAV_DEFAULTS } from './model.js';

export const NAV = { BLOCKED: 0, WALK: 1, ROAD: 2, SHALLOW: 3, WATER: 4, CLIFF: 5, OBSTACLE: 6 };

export const NAV_LEGEND = [
  [NAV.BLOCKED, 'Blocked (no-go area / lava)', [120, 30, 30]],
  [NAV.WALK, 'Walkable', [60, 200, 90]],
  [NAV.ROAD, 'Road / trail / bridge / platform', [240, 200, 80]],
  [NAV.SHALLOW, 'Shallow water (wade)', [90, 200, 230]],
  [NAV.WATER, 'Deep water (swim)', [40, 90, 220]],
  [NAV.CLIFF, 'Too steep (cliff)', [230, 60, 60]],
  [NAV.OBSTACLE, 'Obstacle (building, wall, tree trunk)', [255, 140, 30]],
];

export const objectRadius = (o) => (objectType(o.type).r || 0) * (o.scale || 1);

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Marks every sample within `radius` (world units) of segment a-b.
function stampSegment(grid, map, a, b, radius, value, onlyIf) {
  const cs = map.cellSize, W = map.width, H = map.height;
  const r = Math.max(radius, cs * 0.5);
  const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r) / cs)), x1 = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0]) + r) / cs));
  const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - r) / cs)), y1 = Math.min(H - 1, Math.ceil((Math.max(a[1], b[1]) + r) / cs));
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x * cs, py = y * cs;
    let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy) > r) continue;
    const i = y * W + x;
    if (!onlyIf || onlyIf(grid[i])) grid[i] = value;
  }
}

export function computeWalkGrid(map) {
  const nav = { ...NAV_DEFAULTS, ...(map.navigation || {}) };
  const W = map.width, H = map.height, h = map.heights, cs = map.cellSize, hs = map.heightScale;
  const grid = new Uint8Array(W * H);
  const maxSlope = Math.tan(nav.maxSlopeDeg * Math.PI / 180);
  const lava = new Set(map.palette.filter((p) => p.key === 'lava').map((p) => p.id));
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const depth = (map.seaLevel - h[i]) * hs;
      if (depth > nav.maxWadeDepth) { grid[i] = NAV.WATER; continue; }
      const xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x;
      const gx = (h[y * W + xr] - h[y * W + xl]) * hs / ((xr - xl) * cs);
      const gy = (h[yd * W + x] - h[yu * W + x]) * hs / ((yd - yu) * cs);
      if (Math.hypot(gx, gy) > maxSlope) grid[i] = NAV.CLIFF;
      else if (lava.has(map.biomes[i])) grid[i] = NAV.BLOCKED;
      else grid[i] = depth > 0 ? NAV.SHALLOW : NAV.WALK;
    }
  }
  // roads make walking faster (and bridge shallow water)
  for (const p of map.paths) {
    const pts = p.closed ? [...p.points, p.points[0]] : p.points;
    if (p.type === 'road' || p.type === 'trail') {
      for (let k = 0; k < pts.length - 1; k++) stampSegment(grid, map, pts[k], pts[k + 1], p.width / 2, NAV.ROAD, (v) => v === NAV.WALK || v === NAV.SHALLOW);
    } else if (p.type === 'wall' || p.type === 'fence') {
      for (let k = 0; k < pts.length - 1; k++) stampSegment(grid, map, pts[k], pts[k + 1], p.width / 2, NAV.OBSTACLE);
    }
  }
  // bridges, piers, platforms and runways are walkable surfaces, even over water
  for (const o of map.objects) {
    for (const d of objectDecks(o)) stampSegment(grid, map, d.a, d.b, d.w / 2, NAV.ROAD);
  }
  for (const o of map.objects) {
    const r = objectRadius(o);
    if (r > 0) stampSegment(grid, map, [o.x, o.y], [o.x, o.y], r, NAV.OBSTACLE);
  }
  for (const r of map.regions) {
    if (r.type !== 'no_build' || r.points.length < 3) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of r.points) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    for (let y = Math.max(0, Math.floor(y0 / cs)); y <= Math.min(H - 1, Math.ceil(y1 / cs)); y++) {
      for (let x = Math.max(0, Math.floor(x0 / cs)); x <= Math.min(W - 1, Math.ceil(x1 / cs)); x++) {
        if (pointInPoly(x * cs, y * cs, r.points)) grid[y * W + x] = NAV.BLOCKED;
      }
    }
  }
  return grid;
}

export function walkStats(grid) {
  const counts = new Array(7).fill(0);
  for (const v of grid) counts[v]++;
  return counts;
}
