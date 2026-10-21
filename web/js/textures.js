// Procedural, tileable ground textures for every biome, packed into one
// texture array for the terrain shader. Each pattern is tinted so its average
// colour matches the biome's palette colour, so custom palettes still work.

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

export const TEX_SIZE = 256;

// periodic value noise with independent x / y periods (so it tiles)
function pnoise(seed, px, py = px) {
  const rand = mulberry32(seed);
  const v = new Float32Array(px * py);
  for (let i = 0; i < v.length; i++) v[i] = rand();
  return (u, w) => {
    const x = u * px, y = w * py;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % px) + px) % px, xb = (xa + 1) % px;
    const ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
    const a = v[ya * px + xa], b = v[ya * px + xb], c = v[yb * px + xa], d = v[yb * px + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(seed, period, octaves = 4, gain = 0.5, py = period) {
  const ns = [];
  for (let o = 0; o < octaves; o++) ns.push(pnoise(seed + o * 101, period << o, py << o));
  return (u, v) => {
    let s = 0, a = 1, n = 0;
    for (const f of ns) { s += f(u, v) * a; n += a; a *= gain; }
    return s / n;
  };
}

// periodic cellular noise: returns [f1, f2, cellId] (distances in cell units)
function worley(seed, cells) {
  const rand = mulberry32(seed);
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rand();
  return (u, v) => {
    const x = u * cells, y = v * cells, cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
      const k = (wy * cells + wx) * 2;
      const d = Math.hypot(gx + pts[k] - x, gy + pts[k + 1] - y);
      if (d < f1) { f2 = f1; f1 = d; id = wy * cells + wx; } else if (d < f2) f2 = d;
    }
    return [f1, f2, id];
  };
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Each recipe returns (u, v) => [r, g, b, glow] with colours in 0..1
const RECIPES = {
  grass(s) {
    const big = fbm(s, 4, 4), blades = fbm(s + 1, 64, 2, 0.5, 16), spec = pnoise(s + 2, 96);
    return (u, v) => {
      let c = mix([0.2, 0.42, 0.12], [0.42, 0.66, 0.22], big(u, v));
      c = mul(c, 0.72 + 0.5 * blades(u, v));
      if (spec(u, v) > 0.8) c = mix(c, [0.78, 0.76, 0.32], 0.5);
      return c;
    };
  },
  forest(s) {
    const big = fbm(s, 4, 4), moss = fbm(s + 1, 32, 3), litter = worley(s + 2, 20);
    return (u, v) => {
      let c = mix([0.13, 0.3, 0.1], [0.27, 0.45, 0.16], big(u, v));
      c = mul(c, 0.75 + 0.45 * moss(u, v));
      const [f1, , id] = litter(u, v);
      if (f1 < 0.28 && hash(id) > 0.45) c = mix(c, [0.45, 0.3, 0.15], 0.7 * (1 - f1 / 0.28));
      return c;
    };
  },
  jungle(s) {
    const big = fbm(s, 4, 4), leaves = worley(s + 1, 14), fine = fbm(s + 2, 48, 2);
    return (u, v) => {
      const [f1, f2] = leaves(u, v);
      let c = mix([0.06, 0.25, 0.07], [0.2, 0.5, 0.15], big(u, v));
      c = mul(c, 0.6 + 0.6 * smooth(0, 0.6, f2 - f1) * (0.7 + 0.5 * fine(u, v)));
      return c;
    };
  },
  swamp(s) {
    const big = fbm(s, 4, 5), pud = fbm(s + 1, 6, 3), fine = fbm(s + 2, 64, 2);
    return (u, v) => {
      let c = mix([0.22, 0.27, 0.12], [0.38, 0.42, 0.2], big(u, v));
      const p = pud(u, v);
      if (p > 0.58) c = mix(c, [0.1, 0.13, 0.08], smooth(0.58, 0.66, p));
      return mul(c, 0.8 + 0.35 * fine(u, v));
    };
  },
  farmland(s) {
    const big = fbm(s, 4, 3), fine = fbm(s + 1, 64, 2), wob = fbm(s + 2, 4, 2);
    return (u, v) => {
      const row = Math.sin((v * 16 + wob(u, v) * 0.6) * Math.PI * 2);
      let c = row > 0.2 ? mix([0.42, 0.5, 0.18], [0.65, 0.6, 0.25], big(u, v)) : [0.4, 0.28, 0.16];
      return mul(c, 0.75 + 0.45 * fine(u, v));
    };
  },
  dirt(s) {
    const big = fbm(s, 4, 4), fine = fbm(s + 1, 48, 3), peb = worley(s + 2, 28);
    return (u, v) => {
      let c = mix([0.36, 0.25, 0.15], [0.55, 0.4, 0.25], big(u, v));
      c = mul(c, 0.75 + 0.45 * fine(u, v));
      const [f1, , id] = peb(u, v);
      if (f1 < 0.22 && hash(id) > 0.6) c = mix(c, [0.62, 0.58, 0.52], 0.8);
      return c;
    };
  },
  beach(s) {
    const big = fbm(s, 4, 3), grain = pnoise(s + 1, 128), wob = fbm(s + 2, 4, 2);
    return (u, v) => {
      const rip = 0.5 + 0.5 * Math.sin((u * 10 + v * 3 + wob(u, v) * 1.5) * Math.PI * 2);
      let c = mix([0.78, 0.7, 0.5], [0.92, 0.85, 0.65], big(u, v));
      return mul(c, 0.88 + 0.1 * rip + 0.12 * (grain(u, v) - 0.5));
    };
  },
  desert(s) {
    const big = fbm(s, 3, 3), grain = pnoise(s + 1, 128), wob = fbm(s + 2, 3, 3);
    return (u, v) => {
      const dune = Math.sin((u * 6 + wob(u, v) * 2.2) * Math.PI * 2);
      let c = mix([0.8, 0.6, 0.35], [0.95, 0.78, 0.5], big(u, v));
      return mul(c, 0.86 + 0.12 * dune + 0.1 * (grain(u, v) - 0.5));
    };
  },
  savanna(s) {
    const big = fbm(s, 4, 4), blades = fbm(s + 1, 64, 2, 0.5, 16), patch = fbm(s + 2, 6, 3);
    return (u, v) => {
      let c = mix([0.55, 0.5, 0.22], [0.75, 0.68, 0.35], big(u, v));
      if (patch(u, v) > 0.62) c = mix(c, [0.55, 0.42, 0.25], 0.6);
      return mul(c, 0.75 + 0.45 * blades(u, v));
    };
  },
  rock(s) {
    const big = fbm(s, 4, 5), cells = worley(s + 1, 7), strata = fbm(s + 2, 4, 3), fine = fbm(s + 3, 64, 2);
    return (u, v) => {
      const [f1, f2, id] = cells(u, v);
      let c = mix([0.38, 0.36, 0.34], [0.62, 0.6, 0.57], big(u, v) * 0.7 + hash(id) * 0.3);
      c = mul(c, 0.85 + 0.2 * Math.sin((v * 9 + strata(u, v) * 2) * Math.PI * 2));
      c = mul(c, 0.7 + 0.3 * smooth(0.0, 0.12, f2 - f1)); // cracks
      return mul(c, 0.85 + 0.3 * fine(u, v));
    };
  },
  snow(s) {
    const big = fbm(s, 4, 4), fine = fbm(s + 1, 64, 2), spark = pnoise(s + 2, 128);
    return (u, v) => {
      let c = mix([0.82, 0.86, 0.94], [0.98, 0.99, 1], big(u, v));
      c = mul(c, 0.93 + 0.08 * fine(u, v));
      if (spark(u, v) > 0.88) c = [1, 1, 1];
      return c;
    };
  },
  tundra(s) {
    const big = fbm(s, 4, 4), moss = fbm(s + 1, 32, 3), stones = worley(s + 2, 16);
    return (u, v) => {
      let c = mix([0.42, 0.45, 0.38], [0.58, 0.62, 0.5], big(u, v));
      c = mul(c, 0.8 + 0.35 * moss(u, v));
      const [f1, , id] = stones(u, v);
      if (f1 < 0.3 && hash(id) > 0.7) c = mix(c, [0.6, 0.6, 0.6], 0.75);
      return c;
    };
  },
  volcanic(s) {
    const big = fbm(s, 4, 4), cells = worley(s + 1, 9), fine = fbm(s + 2, 64, 2);
    return (u, v) => {
      const [f1, f2] = cells(u, v);
      let c = mix([0.12, 0.1, 0.1], [0.3, 0.26, 0.25], big(u, v));
      c = mul(c, 0.7 + 0.3 * smooth(0, 0.1, f2 - f1));
      return mul(c, 0.8 + 0.4 * fine(u, v));
    };
  },
  lava(s) {
    const cells = worley(s, 6), big = fbm(s + 1, 4, 3), fine = fbm(s + 2, 32, 3);
    return (u, v) => {
      const [f1, f2] = cells(u, v);
      const crack = 1 - smooth(0.0, 0.18 + 0.1 * big(u, v), f2 - f1);
      const crust = mul([0.18, 0.1, 0.08], 0.8 + 0.4 * fine(u, v));
      const hot = mix([0.9, 0.25, 0.04], [1, 0.75, 0.2], fine(u, v));
      const c = mix(crust, hot, crack);
      return [c[0], c[1], c[2], crack];
    };
  },
  paved(s) {
    const cells = worley(s, 12), fine = fbm(s + 1, 64, 2);
    return (u, v) => {
      const [f1, f2, id] = cells(u, v);
      let c = mix([0.5, 0.47, 0.43], [0.7, 0.67, 0.62], hash(id));
      c = mul(c, 0.85 + 0.25 * fine(u, v) - 0.15 * f1);
      if (f2 - f1 < 0.07) c = [0.25, 0.23, 0.2];
      return c;
    };
  },
  corrupted(s) {
    const big = fbm(s, 4, 4), veins = worley(s + 1, 8), fine = fbm(s + 2, 48, 2);
    return (u, v) => {
      const [f1, f2] = veins(u, v);
      const vein = 1 - smooth(0, 0.06, f2 - f1);
      let c = mix([0.25, 0.15, 0.3], [0.42, 0.28, 0.48], big(u, v));
      c = mul(c, 0.8 + 0.35 * fine(u, v));
      c = mix(c, [0.85, 0.4, 1], vein * 0.8);
      return [c[0], c[1], c[2], vein * 0.6];
    };
  },
  seabed(s) {
    const big = fbm(s, 4, 4), fine = fbm(s + 1, 48, 2);
    return (u, v) => mul(mix([0.45, 0.42, 0.32], [0.65, 0.6, 0.45], big(u, v)), 0.8 + 0.35 * fine(u, v));
  },
  generic(s) {
    const big = fbm(s, 4, 4), fine = fbm(s + 1, 48, 3);
    return (u, v) => mul([0.6, 0.6, 0.6], 0.7 + 0.3 * big(u, v) + 0.25 * (fine(u, v) - 0.5));
  },
};
const ALIAS = { deep_water: 'seabed', shallow_water: 'seabed' };

function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

function renderLayer(recipe, seed, tint, out, offset) {
  const S = TEX_SIZE, f = RECIPES[recipe](seed);
  const px = new Float32Array(S * S * 4);
  let mr = 0, mg = 0, mb = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = f((x + 0.5) / S, (y + 0.5) / S);
    const o = (y * S + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3] || 0;
    mr += c[0]; mg += c[1]; mb += c[2];
  }
  const n = S * S;
  // tint in linear light so the average matches the palette colour
  let k = [1, 1, 1];
  if (tint) {
    const t = [srgbToLin(tint[0]), srgbToLin(tint[1]), srgbToLin(tint[2])];
    const m = [srgbToLin(mr / n), srgbToLin(mg / n), srgbToLin(mb / n)];
    k = t.map((tv, i) => tv / Math.max(1e-4, m[i]));
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let ch = 0; ch < 3; ch++) {
      const lin = srgbToLin(clamp01(px[o + ch])) * k[ch];
      const sr = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
      out[offset + o + ch] = Math.round(clamp01(sr) * 255);
    }
    out[offset + o + 3] = Math.round(clamp01(px[o + 3]) * 255);
  }
}

const cache = new Map();

// Returns { texture, layerOf: Map(biomeId -> layer), rockLayer, snowLayer, noiseLayer }
export function buildBiomeTextures(palette) {
  const sig = palette.map((p) => `${p.id}:${p.key}:${p.color}`).join('|');
  if (cache.has(sig)) return cache.get(sig);
  const S = TEX_SIZE;
  const entries = [...palette].sort((a, b) => a.id - b.id);
  const layers = entries.length + 1; // + a pure noise layer for the shader
  const data = new Uint8Array(S * S * 4 * layers);
  const layerOf = new Map();
  entries.forEach((p, i) => {
    const recipe = RECIPES[p.key] ? p.key : ALIAS[p.key] || 'generic';
    const c = new THREE.Color(p.color);
    renderLayer(recipe, 1000 + i * 17, [c.r, c.g, c.b].map((v) => v), data, i * S * S * 4);
    layerOf.set(p.id, i);
  });
  // noise layer: two independent tileable fbm channels
  const nA = fbm(91, 4, 4), nB = fbm(92, 4, 4), off = entries.length * S * S * 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = off + (y * S + x) * 4;
    data[o] = nA(x / S, y / S) * 255; data[o + 1] = nB(x / S, y / S) * 255; data[o + 2] = 128; data[o + 3] = 0;
  }
  const tex = new THREE.DataArrayTexture(data, S, S, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  const find = (key) => entries.findIndex((p) => p.key === key);
  const res = { texture: tex, layerOf, rockLayer: Math.max(0, find('rock')), snowLayer: Math.max(0, find('snow')), noiseLayer: entries.length };
  cache.set(sig, res);
  return res;
}

// tileable normal map for water ripples
export function buildWaterNormals(size = 256) {
  const hA = fbm(7, 8, 4, 0.5), hB = fbm(8, 16, 3, 0.5);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hgt[y * size + x] = hA(x / size, y / size) + 0.5 * hB(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = hgt[y * size + ((x - 1 + size) % size)], r = hgt[y * size + ((x + 1) % size)];
    const u = hgt[((y - 1 + size) % size) * size + x], d = hgt[((y + 1) % size) * size + x];
    let nx = (l - r) * 6, ny = (u - d) * 6, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const o = (y * size + x) * 4;
    data[o] = (nx / len * 0.5 + 0.5) * 255; data[o + 1] = (ny / len * 0.5 + 0.5) * 255; data[o + 2] = (nz / len * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
