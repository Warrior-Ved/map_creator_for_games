// Grass tufts that grow around the camera. Placement is a deterministic
// function of the grid cell, so the field stays the same as you move.

import * as THREE from 'three';

// density 0..1 and height multiplier per biome key
const GRASS = {
  grassland: [1, 1], savanna: [0.75, 1.2], farmland: [0.55, 1.1], forest: [0.5, 0.8], jungle: [0.85, 1.5],
  swamp: [0.6, 1.3], tundra: [0.35, 0.5], beach: [0.04, 0.6], corrupted: [0.4, 0.9],
};

const SPACING = 0.9; // metres between candidate tufts

function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tuftGeometry() {
  const pos = [], col = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b, r = 0.12 + 0.1 * Math.sin(b * 3.7);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.45 + 0.25 * Math.sin(b * 1.9 + 1);
    const w = 0.035, lean = 0.12;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, x + Math.cos(a) * lean, h, z + Math.sin(a) * lean);
    col.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1.15, 1.15, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // grass looks better lit from above than by its own blade normals
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

export class GrassField {
  constructor(scene) {
    this.scene = scene;
    this.max = 26000;
    this.radius = 70;
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix[3];
          float sway = sin(uTime * 1.8 + ip.x * 0.35 + ip.z * 0.27) * 0.5 + sin(uTime * 3.1 + ip.x * 0.9) * 0.2;
          transformed.x += sway * 0.12 * position.y * position.y * 4.0;
          transformed.z += sway * 0.06 * position.y * position.y * 4.0;`);
    };
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    scene.add(this.mesh);
    this.center = null;
    this.enabled = true;
  }

  setMap(map, ground) {
    this.map = map;
    this.ground = ground;
    this.byBiome = new Map();
    const c = new THREE.Color();
    for (const p of map.palette) {
      const g = GRASS[p.key];
      if (!g) continue;
      c.set(p.color);
      // a bit brighter and more saturated than the ground under it
      const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), Math.min(0.75, hsl.l * 1.12));
      this.byBiome.set(p.id, { density: g[0], height: g[1], color: c.clone() });
    }
    this.center = null;
  }

  invalidate() { this.center = null; }

  // cx, cz = world position to grow around; returns true if instances changed
  update(cx, cz, active) {
    if (!this.map || !this.enabled || !active) {
      if (this.mesh.count) { this.mesh.count = 0; return true; }
      return false;
    }
    if (this.center && Math.hypot(cx - this.center[0], cz - this.center[1]) < this.radius * 0.2) return false;
    this.center = [cx, cz];
    const m = this.map, R = this.radius, cs = m.cellSize;
    const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    const gx0 = Math.floor((cx - R) / SPACING), gx1 = Math.ceil((cx + R) / SPACING);
    const gz0 = Math.floor((cz - R) / SPACING), gz1 = Math.ceil((cz + R) / SPACING);
    for (let gz = gz0; gz <= gz1 && n < this.max; gz++) {
      for (let gx = gx0; gx <= gx1 && n < this.max; gx++) {
        const x = (gx + hash2(gx, gz, 1)) * SPACING, z = (gz + hash2(gx, gz, 2)) * SPACING;
        const d = Math.hypot(x - cx, z - cz);
        if (d > R || x < 0 || z < 0 || x > m.worldWidth || z > m.worldHeight) continue;
        const i = Math.round(z / cs) * m.width + Math.round(x / cs);
        const g = this.byBiome.get(m.biomes[i]);
        if (!g) continue;
        // thin out towards the edge of the field so it fades instead of ending
        const fade = 1 - Math.max(0, (d - R * 0.6) / (R * 0.4));
        if (hash2(gx, gz, 3) > g.density * fade) continue;
        if (m.heights[i] < m.seaLevel) continue;
        const y = this.ground(x, z);
        const sc = (0.7 + 0.6 * hash2(gx, gz, 4)) * g.height;
        p.set(x, y - 0.03, z);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash2(gx, gz, 5) * Math.PI * 2);
        s.set(sc, sc * (0.8 + 0.4 * hash2(gx, gz, 6)), sc);
        this.mesh.setMatrixAt(n, tmp.compose(p, q, s));
        col.copy(g.color).multiplyScalar(0.85 + 0.3 * hash2(gx, gz, 7));
        this.mesh.setColorAt(n, col);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    return true;
  }
}
