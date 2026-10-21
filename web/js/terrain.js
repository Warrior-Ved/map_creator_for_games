// Terrain algorithms: noise, procedural generation, erosion, biome
// classification, sculpt/paint brushes and the shaded 2D image.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D simplex noise, output roughly in [-1, 1]
export function makeNoise2D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = grad[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = grad[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = grad[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  };
}

function fbm(noise, x, y, octaves, lacunarity, gain) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 17.31, y * freq - o * 11.7);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function ridged(noise, x, y, octaves, lacunarity, gain) {
  let amp = 0.5, freq = 1, sum = 0, weight = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x * freq + 91.7 + o * 7.1, y * freq - 33.1));
    n *= n * weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export const GEN_DEFAULTS = {
  seed: 1337,
  shape: 'island', // island | continent | archipelago | inland | valley
  featureSize: 0.35, // 0..1, larger = bigger landmasses
  octaves: 6,
  roughness: 0.5,
  mountains: 0.45,
  warp: 0.35,
  seaLevel: 0.3,
  landCoverage: 0.55,
  plains: 0.5, // 0 = rugged everywhere, 1 = wide flat lowlands
  erosion: 0.4,
  autoBiomes: true,
  moistureBias: 0,
  temperatureBias: 0,
};

// Fill map.heights from noise. Returns nothing; caller handles history.
export function generateHeights(map, opts) {
  const o = { ...GEN_DEFAULTS, ...opts };
  const W = map.width, H = map.height, out = map.heights;
  const noise = makeNoise2D(o.seed);
  const warpN = makeNoise2D(o.seed + 101);
  const base = 1.2 + (1 - o.featureSize) * 6; // number of large features across the map
  const lac = 2.0, gain = 0.35 + o.roughness * 0.3;
  const raw = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let u = (x / (W - 1)) * base, v = (y / (H - 1)) * base;
      if (o.warp > 0) {
        u += o.warp * 0.8 * fbm(warpN, u * 0.7, v * 0.7, 3, 2, 0.5);
        v += o.warp * 0.8 * fbm(warpN, u * 0.7 + 50, v * 0.7 + 50, 3, 2, 0.5);
      }
      let e = fbm(noise, u, v, o.octaves, lac, gain) * 0.5 + 0.5;
      const r = ridged(noise, u * 1.3, v * 1.3, Math.max(3, o.octaves - 1), lac, 0.5);
      const mountainMask = Math.max(0, fbm(warpN, u * 0.5 - 20, v * 0.5 + 9, 2, 2, 0.5) * 0.5 + 0.5 - 0.35) / 0.65;
      e = e + o.mountains * r * mountainMask * 1.1 - o.mountains * 0.15;

      const nx = x / (W - 1) * 2 - 1, ny = y / (H - 1) * 2 - 1;
      const d = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2 * 1.414);
      const edge = Math.max(Math.abs(nx), Math.abs(ny));
      switch (o.shape) {
        case 'island': e = e * 0.55 + 0.55 - Math.pow(d, 2.2) * 0.9; break;
        case 'continent': e = e * 0.75 + 0.35 - Math.pow(edge, 4) * 0.6; break;
        case 'archipelago': e = e * 1.05 - Math.pow(d, 3) * 0.35 + 0.02; break;
        case 'valley': e = e * 0.45 + 0.22 + Math.pow(Math.abs(nx), 1.6) * 0.6; break;
        case 'inland': default: e = e * 0.8 + 0.2; break;
      }
      raw[y * W + x] = e;
    }
  }
  // remap so that `landCoverage` of the map ends up above sea level
  const sorted = Float32Array.from(raw).sort();
  const cut = sorted[Math.min(sorted.length - 1, Math.floor((1 - o.landCoverage) * sorted.length))];
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const sea = o.seaLevel;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    out[i] = v < cut
      ? sea * (v - lo) / Math.max(1e-6, cut - lo)
      // a higher exponent flattens lowlands into walkable plains and keeps peaks tall
      : sea + (1 - sea) * Math.pow((v - cut) / Math.max(1e-6, hi - cut), 1.35 + o.plains * 1.6);
  }
  map.seaLevel = sea;
  if (o.erosion > 0) {
    hydraulicErosion(map, Math.round(W * H * 0.6 * o.erosion), o.seed);
    thermalErosion(map, Math.round(4 + 10 * o.erosion), 0.6);
  }
}

// Particle-based hydraulic erosion (droplets carry and deposit sediment).
export function hydraulicErosion(map, droplets, seed = 1, rect = null) {
  const W = map.width, H = map.height, h = map.heights;
  const rand = mulberry32(seed * 7 + 3);
  const scale = map.heightScale / map.cellSize; // keeps behaviour similar across map sizes
  const inertia = 0.05, capacityF = 4, minCap = 0.01, deposit = 0.3, erode = 0.3, evap = 0.02, gravity = 4, maxLife = 40;
  const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0;
  const x1 = rect ? rect.x1 : W - 1, y1 = rect ? rect.y1 : H - 1;
  const sample = (px, py) => {
    const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy, i = iy * W + ix;
    const a = h[i], b = h[i + 1], c = h[i + W], d = h[i + W + 1];
    return {
      height: a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy,
      gx: ((b - a) * (1 - fy) + (d - c) * fy) * scale,
      gy: ((c - a) * (1 - fx) + (d - b) * fx) * scale,
    };
  };
  for (let n = 0; n < droplets; n++) {
    let px = x0 + rand() * (x1 - x0 - 1), py = y0 + rand() * (y1 - y0 - 1);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < maxLife; life++) {
      const ix = px | 0, iy = py | 0;
      if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) break;
      const fx = px - ix, fy = py - iy, idx = iy * W + ix;
      const s = sample(px, py);
      dx = dx * inertia - s.gx * (1 - inertia);
      dy = dy * inertia - s.gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-8) break;
      dx /= len; dy /= len;
      px += dx; py += dy;
      if (px < 0 || py < 0 || px >= W - 1 || py >= H - 1) break;
      const nh = sample(px, py).height;
      const dh = nh - s.height;
      const cap = Math.max(-dh * speed * water * capacityF, minCap * 0.01);
      if (sediment > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposit;
        sediment -= amt;
        h[idx] += amt * (1 - fx) * (1 - fy);
        h[idx + 1] += amt * fx * (1 - fy);
        h[idx + W] += amt * (1 - fx) * fy;
        h[idx + W + 1] += amt * fx * fy;
      } else {
        const amt = Math.min((cap - sediment) * erode, -dh) * 0.5;
        // erode from a small 3x3 footprint to avoid pits
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const ex = ix + ox, ey = iy + oy;
          if (ex < 0 || ey < 0 || ex >= W || ey >= H) continue;
          const w = (ox === 0 && oy === 0) ? 0.36 : 0.08;
          const e = ey * W + ex;
          const take = Math.min(h[e], amt * w);
          h[e] -= take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + Math.abs(dh) * gravity * scale * 0.05));
      water *= 1 - evap;
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, Math.max(0, h[i]));
}

// Moves material down slopes steeper than `talus` (in world-unit rise per cell).
export function thermalErosion(map, iterations, talus = 0.6) {
  const W = map.width, H = map.height, h = map.heights;
  const t = talus * map.cellSize / map.heightScale;
  for (let it = 0; it < iterations; it++) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        let maxD = 0, mi = -1;
        const nb = [i - 1, i + 1, i - W, i + W];
        for (const j of nb) {
          const d = h[i] - h[j];
          if (d > maxD) { maxD = d; mi = j; }
        }
        if (maxD > t) {
          const move = (maxD - t) * 0.25;
          h[i] -= move;
          h[mi] += move;
        }
      }
    }
  }
}

export function smoothAll(map, passes = 1, rect = null) {
  const W = map.width, H = map.height;
  const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0, x1 = rect ? rect.x1 : W - 1, y1 = rect ? rect.y1 : H - 1;
  for (let p = 0; p < passes; p++) {
    const src = map.heights.slice();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let s = 0, c = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += src[yy * W + xx]; c++;
      }
      map.heights[y * W + x] = s / c;
    }
  }
}

// --------------------------------------------------------------- biomes

const B = { DEEP: 0, SHALLOW: 1, BEACH: 2, GRASS: 3, FOREST: 4, JUNGLE: 5, SWAMP: 6, DIRT: 8, DESERT: 9, SAVANNA: 10, ROCK: 11, SNOW: 12, TUNDRA: 13 };

export function slopeAt(map, x, y) {
  const W = map.width, H = map.height, h = map.heights;
  const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
  const gx = (h[y * W + xr] - h[y * W + xl]) * map.heightScale / ((xr - xl) * map.cellSize);
  const gy = (h[yd * W + x] - h[yu * W + x]) * map.heightScale / ((yd - yu) * map.cellSize);
  return Math.hypot(gx, gy); // rise over run
}

export function autoBiomes(map, { seed = 1, moistureBias = 0, temperatureBias = 0, rect = null } = {}) {
  const W = map.width, H = map.height, h = map.heights, out = map.biomes, sea = map.seaLevel;
  const mN = makeNoise2D(seed + 555), tN = makeNoise2D(seed + 777);
  const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0, x1 = rect ? rect.x1 : W - 1, y1 = rect ? rect.y1 : H - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x, e = h[i];
      if (e < sea) { out[i] = e < sea - 0.06 ? B.DEEP : B.SHALLOW; continue; }
      const u = x / W * 4, v = y / H * 4;
      const alt = (e - sea) / Math.max(1e-6, 1 - sea); // 0 at coast, 1 at peak
      const moisture = fbm(mN, u, v, 4, 2, 0.5) * 0.5 + 0.5 + moistureBias;
      const temp = 1 - alt * 1.1 + fbm(tN, u * 0.6, v * 0.6, 3, 2, 0.5) * 0.25 + temperatureBias;
      const slope = slopeAt(map, x, y);
      let b;
      if (alt < 0.025) b = B.BEACH;
      else if (slope > 1.1) b = alt > 0.6 && temp < 0.25 ? B.SNOW : B.ROCK;
      else if (temp < 0.12) b = B.SNOW;
      else if (temp < 0.3) b = moisture > 0.5 ? B.FOREST : B.TUNDRA;
      else if (alt > 0.7) b = B.ROCK;
      else if (moisture < 0.24) b = temp > 0.7 ? B.DESERT : B.SAVANNA;
      else if (moisture < 0.5) b = B.GRASS;
      else if (moisture < 0.66) b = B.FOREST;
      else if (alt < 0.08) b = B.SWAMP;
      else b = temp > 0.75 ? B.JUNGLE : B.FOREST;
      out[i] = b;
    }
  }
}

// --------------------------------------------------------------- brushes

export function brushWeight(d, radius, falloff) {
  if (d >= radius) return 0;
  const t = d / radius;
  const hard = 1 - falloff; // inner fully-weighted part
  if (t <= hard) return 1;
  const k = (t - hard) / Math.max(1e-6, falloff);
  return 0.5 * (1 + Math.cos(Math.PI * k));
}

// Applies one dab at cell position (cx, cy). Returns the touched rect.
// mode: raise | lower | smooth | flatten | noise | erode | paint
export function applyDab(map, cx, cy, brush, state) {
  const W = map.width, H = map.height, h = map.heights;
  const r = brush.size / 2;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1) return null;
  const s = brush.strength * (state.pressure ?? 1);
  const mode = brush.mode;
  let src = null;
  if (mode === 'smooth') src = h.slice(Math.max(0, (y0 - 1) * W), Math.min(h.length, (y1 + 2) * W));
  const srcOff = Math.max(0, (y0 - 1) * W);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const w = brushWeight(Math.hypot(x - cx, y - cy), r, brush.falloff);
      if (w <= 0) continue;
      const i = y * W + x;
      switch (mode) {
        case 'raise': h[i] = Math.min(1, h[i] + 0.004 * s * w); break;
        case 'lower': h[i] = Math.max(0, h[i] - 0.004 * s * w); break;
        case 'flatten': h[i] += (state.target - h[i]) * Math.min(1, 0.25 * s * w); break;
        case 'set': h[i] += (brush.targetHeight - h[i]) * Math.min(1, 0.35 * s * w); break;
        case 'noise': h[i] = Math.min(1, Math.max(0, h[i] + (state.noise(x * 0.35, y * 0.35)) * 0.004 * s * w)); break;
        case 'terrace': {
          const step = (brush.terraceStep || 6) / map.heightScale;
          const lv = Math.round(h[i] / step) * step;
          // keep a little slope on the step edges so they read as stairs, not walls
          const t = (h[i] - lv) / step;
          h[i] += (lv + t * step * 0.25 - h[i]) * Math.min(1, 0.3 * s * w);
          break;
        }
        case 'smooth': {
          let sum = 0, c = 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox, yy = y + oy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            sum += src[yy * W + xx - srcOff]; c++;
          }
          h[i] += (sum / c - h[i]) * Math.min(1, 0.5 * s * w);
          break;
        }
        case 'paint':
          // dithered edges give natural looking biome borders
          if (w >= 1 || state.rand() < w * Math.min(1, s * 1.5)) map.biomes[i] = brush.biome;
          break;
        case 'land':
        case 'water':
        case 'beach': {
          const cn = coastNoise(map.meta?.seed || 1);
          // noise on the weight gives ragged, natural coastlines from a round brush
          const wn = Math.min(1, Math.max(0, w + (cn(x * 0.035, y * 0.035) * 0.75 + cn(x * 0.11, y * 0.11) * 0.25) * 0.5 * (1 - w * 0.5)));
          if (wn <= 0) break;
          const n01 = 0.5 + 0.5 * cn(x * 0.05 + 40, y * 0.05 - 40);
          // these brushes move toward a fixed level, so they can act strongly: one pass reaches it
          const k = Math.min(1, (0.5 + 0.9 * s) * wn);
          const hs = map.heightScale;
          if (mode === 'land') {
            // lower toward the brush edge so a gentle shore (and a beach) forms on its own
            const tgt = map.seaLevel + (0.3 + (brush.landHeight ?? 4) * (0.6 + 0.8 * n01) * Math.min(1, wn * 1.6)) / hs;
            if (h[i] < tgt) h[i] += (tgt - h[i]) * k;
          } else if (mode === 'water') {
            const tgt = map.seaLevel - (brush.waterDepth ?? 8) * (0.7 + 0.6 * n01) / hs;
            if (h[i] > tgt) h[i] += (tgt - h[i]) * k;
          } else {
            const tgt = map.seaLevel + (0.5 + 0.9 * n01) / hs;
            h[i] += (tgt - h[i]) * k;
          }
          fixCoastBiome(map, i, coastIds(map), mode === 'beach' && wn > 0.4);
          break;
        }
      }
    }
  }
  return { x0, y0, x1, y1 };
}

// --------------------------------------------------------------- 2D shading

function hexToRgb(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Writes the shaded map colours into an ImageData-like RGBA buffer.
export function shadeRegion(map, rgba, rect, opts) {
  const W = map.width, H = map.height, h = map.heights, bi = map.biomes, sea = map.seaLevel;
  const lut = new Array(256);
  for (const p of map.palette) lut[p.id] = hexToRgb(p.color);
  const fallback = [255, 0, 255];
  const zk = map.heightScale / (2 * map.cellSize);
  const lx = -0.5, ly = -0.5, lz = 0.7071;
  const contourStep = opts.contourInterval > 0 ? opts.contourInterval / map.heightScale : 0;
  const water = [38, 92, 140];
  for (let y = rect.y0; y <= rect.y1; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = y * W + x;
      const xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x;
      const e = h[i];
      let col = lut[bi[i]] || fallback;
      let r = col[0], g = col[1], b = col[2];
      if (opts.hillshade) {
        const gx = (h[y * W + xr] - h[y * W + xl]) * zk * 2 / (xr - xl);
        const gy = (h[yd * W + x] - h[yu * W + x]) * zk * 2 / (yd - yu);
        const len = Math.sqrt(gx * gx + gy * gy + 1);
        let sh = (-gx * lx - gy * ly + lz) / len;
        sh = Math.min(1.3, Math.max(0.35, 0.45 + 0.75 * sh));
        r *= sh; g *= sh; b *= sh;
      }
      if (opts.heightTint) {
        const v = e * 255;
        r = r * 0.35 + v * 0.65; g = g * 0.35 + v * 0.65; b = b * 0.35 + v * 0.65;
      }
      if (e < sea && opts.water) {
        const depth = Math.min(1, (sea - e) * 6);
        const m = 0.55 + 0.4 * depth;
        r = r * (1 - m) + water[0] * m; g = g * (1 - m) + water[1] * m; b = b * (1 - m) + water[2] * m;
      }
      if (contourStep > 0) {
        const lv = Math.floor(e / contourStep);
        if (Math.floor(h[y * W + xr] / contourStep) !== lv || Math.floor(h[yd * W + x] / contourStep) !== lv) {
          r *= 0.72; g *= 0.72; b *= 0.72;
        }
      }
      const o = i * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
}

// --------------------------------------------------------------- path carving

// Flattens a road / carves a river along a polyline (cell-space points).
export function carvePath(map, cellPts, widthCells, kind) {
  const W = map.width, H = map.height, h = map.heights;
  if (cellPts.length < 2) return null;
  const r = Math.max(1, widthCells / 2 + 1.5);
  // target heights along the line, smoothed
  const dense = [];
  for (let k = 0; k < cellPts.length - 1; k++) {
    const [ax, ay] = cellPts[k], [bx, by] = cellPts[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s < n; s++) dense.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]);
  }
  dense.push(cellPts[cellPts.length - 1]);
  let target = dense.map(([x, y]) => map.heightAtCell(x, y));
  // railways need long, gentle gradients; roads may follow the terrain more closely
  const passes = kind === 'railway' ? 60 : 6;
  for (let pass = 0; pass < passes; pass++) {
    target = target.map((v, i) => (target[Math.max(0, i - 2)] + target[Math.max(0, i - 1)] + v + target[Math.min(target.length - 1, i + 1)] + target[Math.min(target.length - 1, i + 2)]) / 5);
  }
  if (kind === 'river' || kind === 'stream') {
    // rivers must flow downhill: make target monotonic from the first point
    const depth = Math.min(0.03, 2.5 / map.heightScale);
    for (let i = 1; i < target.length; i++) target[i] = Math.min(target[i], target[i - 1]);
    target = target.map((v) => Math.max(0, v - depth));
  }
  let rect = { x0: W, y0: H, x1: 0, y1: 0 };
  const best = new Float32Array(W * H).fill(-1);
  const tgt = new Float32Array(W * H);
  dense.forEach(([px, py], k) => {
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(W - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(H - 1, Math.ceil(py + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w = brushWeight(Math.hypot(x - px, y - py), r, 0.6);
      const i = y * W + x;
      if (w > best[i]) { best[i] = w; tgt[i] = target[k]; }
    }
    rect = { x0: Math.min(rect.x0, x0), y0: Math.min(rect.y0, y0), x1: Math.max(rect.x1, x1), y1: Math.max(rect.y1, y1) };
  });
  for (let i = 0; i < best.length; i++) {
    if (best[i] <= 0) continue;
    if ((kind === 'river' || kind === 'stream') && h[i] < tgt[i]) continue;
    h[i] += (tgt[i] - h[i]) * best[i];
  }
  return rect;
}

// --------------------------------------------------------------- landform stamps

export const STAMPS = ['island', 'mountain', 'hill', 'plateau', 'crater', 'volcano', 'desert', 'dunes', 'beach_stamp'];

// One-shot landform at cell position (cx, cy). size = diameter in cells,
// strength 0..1 scales the height. Returns the touched rect.
export function applyStamp(map, cx, cy, kind, size, strength, seed = 1) {
  const W = map.width, H = map.height, h = map.heights;
  const r = Math.max(2, size / 2);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  if (x0 > x1 || y0 > y1) return null;
  const noise = makeNoise2D(seed);
  const metres = r * map.cellSize; // footprint radius in world units
  const k = 1 / map.heightScale;
  const base = map.heightAtCell(cx, cy);
  const lava = map.palette.find((p) => p.key === 'lava')?.id;
  const ash = map.palette.find((p) => p.key === 'volcanic')?.id;
  const rock = map.palette.find((p) => p.key === 'rock')?.id;
  const snow = map.palette.find((p) => p.key === 'snow')?.id;
  const fq = 4 / r; // noise frequency relative to the stamp size
  const sea = map.seaLevel;
  const ids = coastIds(map);
  const windA = (seed % 360) * Math.PI / 180, windX = Math.cos(windA), windY = Math.sin(windA);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      // a noisy radius keeps the outline organic
      const wobble = 1 + 0.18 * noise(x * fq * 0.5 + 31, y * fq * 0.5 - 17);
      const t = Math.hypot(dx, dy) / (r * wobble);
      if (t >= 1) continue;
      const i = y * W + x;
      const fall = 0.5 * (1 + Math.cos(Math.PI * t)); // 1 at centre, 0 at edge
      switch (kind) {
        case 'mountain': {
          const peak = metres * 0.6 * strength * k;
          let n = 0, amp = 0.55, f = fq * 0.6, norm = 0;
          for (let o = 0; o < 3; o++) { n += amp * (1 - Math.abs(noise(x * f + o * 9.1, y * f - o * 4.7))); norm += amp; amp *= 0.45; f *= 2; }
          n /= norm;
          h[i] = softAdd(h[i], peak * Math.pow(fall, 1.3) * (0.6 + 0.5 * n));
          if (snow != null && h[i] > map.seaLevel + (1 - map.seaLevel) * 0.72) map.biomes[i] = snow;
          break;
        }
        case 'hill':
          h[i] = softAdd(h[i], metres * 0.25 * strength * k * fall * fall * (0.85 + 0.3 * noise(x * fq, y * fq)));
          break;
        case 'plateau': {
          const top = base + metres * 0.35 * strength * k;
          const edge = 1 - Math.min(1, Math.max(0, (t - 0.72) / 0.22)); // steep cliff band
          if (top > h[i]) h[i] += (top + noise(x * fq * 2, y * fq * 2) * 1.5 * k - h[i]) * edge;
          if (rock != null && t > 0.7 && t < 0.95) map.biomes[i] = rock;
          break;
        }
        case 'crater': {
          const depth = metres * 0.22 * strength * k;
          const rim = Math.exp(-Math.pow((t - 0.78) / 0.12, 2));
          const bowl = t < 0.78 ? Math.pow(1 - t / 0.78, 0.6) : 0;
          h[i] = Math.min(1, Math.max(0, h[i] + depth * (rim * 0.6 - bowl)));
          break;
        }
        case 'volcano': {
          const height = metres * 0.75 * strength * k;
          const cone = Math.pow(1 - t, 1.6);
          const craterR = 0.16;
          let add = height * cone * (0.9 + 0.2 * noise(x * fq * 1.5, y * fq * 1.5));
          if (t < craterR) add = height * Math.pow(1 - craterR, 1.6) * (0.75 + 0.25 * t / craterR);
          h[i] = softAdd(h[i], add);
          if (t < craterR * 0.8 && lava != null) map.biomes[i] = lava;
          else if (ash != null && t < 0.75) map.biomes[i] = ash;
          break;
        }
        case 'island': {
          // coastline at ~78% of the radius, then a shallow shelf down to the sea floor
          const tc = t / 0.78 * (1 + 0.2 * noise(x * fq * 0.55 + 7, y * fq * 0.55 - 3) + 0.05 * noise(x * fq * 2, y * fq * 2));
          const n01 = 0.5 + 0.5 * noise(x * fq * 0.8, y * fq * 0.8);
          const hillH = Math.max(4, metres * 0.12 * strength); // metres
          const shore = 0.86; // outer band of the island is a low sandy beach
          let tgt;
          if (tc < shore) tgt = sea + (2.2 + hillH * Math.pow((shore - tc) / shore, 0.9) * (0.55 + 0.9 * n01)) * k;
          else if (tc < 1) tgt = sea + (0.3 + 1.9 * (1 - tc) / (1 - shore)) * k;
          else tgt = sea - Math.min(1, (tc - 1) / 0.28) * 6 * k;
          if (h[i] < tgt) h[i] = tgt;
          fixCoastBiome(map, i, ids, false, n01 > 0.68 ? ids.forest : ids.grass);
          break;
        }
        case 'desert':
        case 'dunes': {
          const dunes = kind === 'dunes';
          const e = 1 - smoothstep01((t - 0.65) / 0.35); // blend into the surroundings
          const ground = Math.max(base, sea + 3 * k);
          // long wind-blown ridges with a steep lee side
          const wl = (dunes ? 26 : 60) / map.cellSize;
          const u = (x * windX + y * windY) / wl + noise(x * fq * 0.7, y * fq * 0.7) * 1.4;
          const ph = u - Math.floor(u);
          const ridge = ph < 0.75 ? ph / 0.75 : (1 - ph) / 0.25;
          const amp = dunes ? 4 + 8 * strength : 0.8 + 1.5 * strength;
          const tgt = ground + (amp * Math.pow(ridge, 1.6) * (0.6 + 0.4 * noise(x * fq * 2, y * fq * 2)) + noise(x * 0.2, y * 0.2) * 0.4) * k;
          h[i] += (tgt - h[i]) * e;
          if (e > 0.45 + 0.25 * noise(x * 0.3 + 11, y * 0.3)) map.biomes[i] = ids.desert;
          fixCoastBiome(map, i, ids);
          break;
        }
        case 'beach_stamp': {
          // sandy shore sloping gently from ~2 m above the sea into shallow water
          const e = 1 - smoothstep01((t - 0.55) / 0.45);
          const tgt = sea + (2.2 * (1 - t) - 0.6 + 0.5 * noise(x * 0.15, y * 0.15)) * k;
          h[i] += (tgt - h[i]) * e;
          if (e > 0.35) map.biomes[i] = h[i] >= sea ? ids.beach : ids.shallow;
          break;
        }
      }
      if (kind !== 'desert' && kind !== 'dunes' && kind !== 'island' && kind !== 'beach_stamp') fixCoastBiome(map, i, ids);
    }
  }
  return { x0, y0, x1, y1 };
}

function smoothstep01(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

// Raise a mountain range ('ridge') or cut a rift / canyon ('rift') along a
// polyline in cell space. props.height / props.depth are in world units.
export function shapeAlongPath(map, cellPts, widthCells, kind, props = {}, seed = 7) {
  const W = map.width, H = map.height, h = map.heights;
  if (cellPts.length < 2) return null;
  const r = Math.max(2, widthCells / 2);
  const noise = makeNoise2D(seed);
  const rock = map.palette.find((p) => p.key === 'rock')?.id;
  const snow = map.palette.find((p) => p.key === 'snow')?.id;
  // nearest distance to the polyline and position along it, per sample
  const dist = new Float32Array(W * H).fill(Infinity);
  const along = new Float32Array(W * H);
  let rect = { x0: W, y0: H, x1: 0, y1: 0 };
  let acc = 0;
  for (let k = 0; k < cellPts.length - 1; k++) {
    const [ax, ay] = cellPts[k], [bx, by] = cellPts[k + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, len = Math.sqrt(l2);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      const i = y * W + x;
      if (d < dist[i]) { dist[i] = d; along[i] = acc + t * len; }
    }
    rect = { x0: Math.min(rect.x0, x0), y0: Math.min(rect.y0, y0), x1: Math.max(rect.x1, x1), y1: Math.max(rect.y1, y1) };
    acc += len;
  }
  if (kind === 'ridge') {
    const height = (props.height ?? 70) / map.heightScale;
    for (let i = 0; i < h.length; i++) {
      if (!(dist[i] < r)) continue;
      const x = i % W, y = (i / W) | 0;
      const wob = 1 + 0.25 * noise(along[i] * 0.05, 3.3);
      const t = dist[i] / (r * wob);
      if (t >= 1) continue;
      // peaks rise and fall along the range; ridged noise carves gullies
      const peaks = 0.65 + 0.35 * noise(along[i] * 0.04, 11.1) + 0.2 * noise(along[i] * 0.11, 5.7);
      // ridged noise carves gullies and spurs; kept low-frequency so peaks stay massive, not spiky
      let n = 0, amp = 0.55, f = 2 / r, norm = 0;
      for (let o = 0; o < 3; o++) { n += amp * (1 - Math.abs(noise(x * f + o * 9.1, y * f - o * 4.7))); norm += amp; amp *= 0.45; f *= 2; }
      n /= norm;
      const prof = Math.pow(0.5 * (1 + Math.cos(Math.PI * t)), 1.2);
      h[i] = softAdd(h[i], height * prof * peaks * (0.6 + 0.5 * n));
      const alt = (h[i] - map.seaLevel) / Math.max(1e-6, 1 - map.seaLevel);
      if (snow != null && alt > 0.72) map.biomes[i] = snow;
    }
  } else {
    // rift: flat-ish floor well below the lowest ground along the line, steep walls
    const depth = (props.depth ?? 30) / map.heightScale;
    let floor = 1;
    for (let i = 0; i < h.length; i++) if (dist[i] < r * 0.5) floor = Math.min(floor, h[i]);
    floor = Math.max(0, floor - depth);
    for (let i = 0; i < h.length; i++) {
      if (!(dist[i] < r)) continue;
      const wob = 1 + 0.2 * noise(along[i] * 0.08, 1.7);
      const t = dist[i] / (r * wob);
      if (t >= 1) continue;
      const wall = 1 - Math.min(1, Math.max(0, (t - 0.55) / 0.3)); // steep band near the edge
      const target = floor + Math.abs(noise(along[i] * 0.2, t * 3)) * depth * 0.15;
      if (target < h[i]) h[i] += (target - h[i]) * wall;
      if (rock != null && t > 0.35) map.biomes[i] = rock;
    }
  }
  return rect;
}

// Adds `a` to height `h` but eases into the 1.0 ceiling instead of flattening
// peaks against it.
function softAdd(h, a) {
  const room = Math.max(0, 1 - h);
  return a <= 0 ? h + a : h + (a * room) / (a + room + 1e-9);
}

// --------------------------------------------------------------- coastlines

const _coastNoise = new Map();
function coastNoise(seed) {
  if (!_coastNoise.has(seed)) _coastNoise.set(seed, makeNoise2D(seed * 13 + 5));
  return _coastNoise.get(seed);
}

const _ids = new WeakMap();
export function coastIds(map) {
  let ids = _ids.get(map.palette);
  if (!ids) {
    const id = (key, def) => map.palette.find((p) => p.key === key)?.id ?? def;
    ids = { deep: id('deep_water', 0), shallow: id('shallow_water', 1), beach: id('beach', 2), grass: id('grassland', 3), forest: id('forest', 4), desert: id('desert', 9) };
    _ids.set(map.palette, ids);
  }
  return ids;
}

// Keeps biomes consistent with the water line after the height changed:
// underwater -> shallow/deep water, new land -> beach at the shore, grass inland.
export function fixCoastBiome(map, i, ids, forceBeach = false, landBiome = ids.grass) {
  const b = map.biomes[i];
  const above = (map.heights[i] - map.seaLevel) * map.heightScale; // metres above sea
  const isWater = b === ids.deep || b === ids.shallow;
  if (above < 0) {
    map.biomes[i] = above < -6 ? ids.deep : ids.shallow;
  } else if (forceBeach || ((isWater || b === ids.beach) && above < 2.4)) {
    map.biomes[i] = ids.beach;
  } else if (isWater || (b === ids.beach && above >= 2.4)) {
    map.biomes[i] = landBiome;
  }
}

// Flattens the ground under segments (cell space, r = half width in cells) to
// `target` (normalized height), feathering the edges. Paints `paveId` under them.
export function levelSegments(map, segs, target, paveId = null) {
  const W = map.width, H = map.height, h = map.heights;
  let rect = null;
  const best = new Map();
  for (const { a, b, r } of segs) {
    const margin = Math.max(2, r * 0.6);
    const R = r + margin;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - R)), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + R));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - R)), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + R));
    if (x0 > x1 || y0 > y1) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      if (d > R) continue;
      const w = d <= r ? 1 : 0.5 * (1 + Math.cos(Math.PI * (d - r) / margin));
      const i = y * W + x;
      if (w > (best.get(i) ?? 0)) best.set(i, w);
    }
    rect = rect ? { x0: Math.min(rect.x0, x0), y0: Math.min(rect.y0, y0), x1: Math.max(rect.x1, x1), y1: Math.max(rect.y1, y1) } : { x0, y0, x1, y1 };
  }
  for (const [i, w] of best) {
    h[i] += (target - h[i]) * w;
    if (paveId != null && w >= 1) map.biomes[i] = paveId;
  }
  return rect;
}
