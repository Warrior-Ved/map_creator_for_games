// 3D preview with three.js. World axes: X east, Y up, Z south.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { objectType, pathType, regionType } from './model.js';
import { buildShapes, idHash, UP } from './shapes3d.js';
import { buildBiomeTextures, buildWaterNormals } from './textures.js';
import { GrassField } from './grass.js';
import { WalkMode } from './walk.js';

const SKY_TOP = new THREE.Color('#3f86d6'), SKY_HORIZON = new THREE.Color('#cfe5f3'), SKY_GROUND = new THREE.Color('#8fa7b5');

function skyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, ground: { value: SKY_GROUND }, sunDir: { value: sunDir } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y > 0.0 ? mix(horizon, top, pow(d.y, 0.55)) : mix(horizon, ground, pow(-d.y, 0.35));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// biome texture blending on top of MeshStandardMaterial
function terrainMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2DArray uBiomeTex;
        uniform sampler2D uLayerMap;
        uniform vec2 uGrid;
        uniform float uCell, uTile, uRock, uSnow, uNoise, uCliff, uSnowY, uSeaY;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        vec4 layerSample(vec2 uv, float layer) {
          // a second, rotated sample at another scale hides the tiling
          vec4 a = texture(uBiomeTex, vec3(uv, layer));
          vec4 b = texture(uBiomeTex, vec3(mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.27 + vec2(0.37, 0.71), layer));
          return mix(a, b, 0.35);
        }
        float layerAt(vec2 c) {
          ivec2 ic = ivec2(clamp(c, vec2(0.0), uGrid - 1.0));
          return floor(texelFetch(uLayerMap, ic, 0).r * 255.0 + 0.5);
        }`)
      .replace('#include <map_fragment>', `
        vec2 uvT = vWPos.xz / uTile;
        vec4 nz = texture(uBiomeTex, vec3(vWPos.xz / 97.0, uNoise));
        // jitter the lookup so biome borders are organic instead of grid aligned
        vec4 nz2 = texture(uBiomeTex, vec3(vWPos.xz / 23.0, uNoise));
        vec2 cp = vWPos.xz / uCell + (nz.rg - 0.5) * 2.2 + (nz2.gr - 0.5) * 1.1;
        vec2 b0 = floor(cp);
        vec2 f = cp - b0;
        float l00 = layerAt(b0), l10 = layerAt(b0 + vec2(1.0, 0.0)), l01 = layerAt(b0 + vec2(0.0, 1.0)), l11 = layerAt(b0 + vec2(1.0, 1.0));
        vec4 c00 = layerSample(uvT, l00);
        vec4 tcol = c00;
        if (!(l00 == l10 && l00 == l01 && l00 == l11)) {
          vec4 c10 = layerSample(uvT, l10), c01 = layerSample(uvT, l01), c11 = layerSample(uvT, l11);
          // height-based blend: brighter texels win at borders
          float h00 = dot(c00.rgb, vec3(0.33)) + (1.0 - f.x) * (1.0 - f.y);
          float h10 = dot(c10.rgb, vec3(0.33)) + f.x * (1.0 - f.y);
          float h01 = dot(c01.rgb, vec3(0.33)) + (1.0 - f.x) * f.y;
          float h11 = dot(c11.rgb, vec3(0.33)) + f.x * f.y;
          float ma = max(max(h00, h10), max(h01, h11)) - 0.4;
          float w00 = max(h00 - ma, 0.0), w10 = max(h10 - ma, 0.0), w01 = max(h01 - ma, 0.0), w11 = max(h11 - ma, 0.0);
          tcol = (c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11) / (w00 + w10 + w01 + w11);
        }
        vec3 tn = normalize(vWNrm);
        float slope = 1.0 - tn.y;
        float cliff = smoothstep(0.3, 0.48, slope + (nz.r - 0.5) * 0.15) * uCliff;
        if (cliff > 0.001) {
          vec3 bw = pow(abs(tn), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec4 rx = texture(uBiomeTex, vec3(vWPos.zy / uTile, uRock));
          vec4 ry = texture(uBiomeTex, vec3(vWPos.xz / uTile, uRock));
          vec4 rz = texture(uBiomeTex, vec3(vWPos.xy / uTile, uRock));
          tcol = mix(tcol, rx * bw.x + ry * bw.y + rz * bw.z, cliff);
        }
        float snowAmt = smoothstep(uSnowY - 4.0, uSnowY + 4.0, vWPos.y + (nz.g - 0.5) * 16.0) * smoothstep(0.55, 0.35, slope);
        if (snowAmt > 0.001) tcol = mix(tcol, layerSample(uvT, uSnow), snowAmt);
        float wet = 1.0 - smoothstep(uSeaY, uSeaY + 0.8, vWPos.y);
        tcol.rgb *= 1.0 - 0.35 * wet;
        float tGlow = tcol.a;
        diffuseColor.rgb *= tcol.rgb;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * tGlow * 3.0;');
  };
  return mat;
}

export class View3D {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.map = null;
    this.ready = false;
    this.visible = false;
    this.maxRes = 512;
    this.layers = { objects: true, paths: true, regions: true, water: true, shadows: false, skirt: true, textures: true, cliffs: true, grass: true };
    this.snowLine = 1.01; // fraction of heightScale; above 1 = off
    this.verticalScale = 1;
    this._dirtyTerrain = false;
    this._dirtyEntities = false;
    this._timer = 0;
    this.ground = (x, z) => this.map.groundY(x, z) * this.verticalScale;
  }

  _init() {
    if (this.ready) return;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 100000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => this.requestRender());
    this.hemi = new THREE.HemisphereLight('#e4f1ff', '#7d6c55', 1.05);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    // late-morning sun from the south-west, so slopes facing the default camera are lit
    this.sunDir = new THREE.Vector3(-0.5, 0.72, 0.42).normalize();

    // sky dome + matching environment lighting for reflections
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial(this.sunDir));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(this.sunDir)));
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    this.shapes = buildShapes();
    this.waterNormals = buildWaterNormals();
    this.groups = { terrain: new THREE.Group(), objects: new THREE.Group(), paths: new THREE.Group(), regions: new THREE.Group() };
    Object.values(this.groups).forEach((g) => this.scene.add(g));
    this.grass = new GrassField(this.scene);
    this.walk = new WalkMode(this);
    this.walk.onWalkChange = (on) => {
      if (!on) this.onWalkEnded();
      this.grass.invalidate();
      this.app.walkChanged?.(on);
    };
    this.clock = new THREE.Clock();
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.ready = true;
  }

  show() {
    this.visible = true;
    this._init();
    if (this.map && !this.terrainMesh) this._buildAll(true);
    else this._flush();
    this.resize();
    if (!this._looping) this._loop();
  }

  hide() {
    if (this.walk?.active) this.walk.exit();
    this.visible = false;
  }

  resize() {
    if (!this.ready) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setMap(map) {
    if (this.walk?.active) this.walk.exit();
    this.map = map;
    if (this.ready && this.visible) this._buildAll(true);
    else this.terrainMesh = null;
  }

  terrainChanged() { this._dirtyTerrain = true; this._schedule(); }
  entitiesChanged() { this._dirtyEntities = true; this._schedule(); }

  _schedule() {
    if (!this.visible || this._timer) return;
    this._timer = setTimeout(() => { this._timer = 0; this._flush(); }, 120);
  }

  _flush() {
    if (!this.ready || !this.map) return;
    if (this._dirtyTerrain) { this._updateTerrain(); this._buildEntities(); this.grass.invalidate(); }
    else if (this._dirtyEntities) this._buildEntities();
    if (this._dirtyEntities && this.walk.active) this.walk.buildColliders();
    this._dirtyTerrain = this._dirtyEntities = false;
    this.requestRender();
  }

  rebuild() { if (this.ready && this.map) this._buildAll(false); }

  requestRender() { this._needsRender = true; }

  _loop() {
    this._looping = this.visible;
    if (!this.visible) return;
    requestAnimationFrame(() => this._loop());
    const dt = this.clock.getDelta();
    const walking = this.walk.active;
    if (walking) this.walk.update(dt);
    else if (this.controls.update()) {
      this._needsRender = true;
      // never let the orbit camera dive under the ground or the water
      const c = this.camera.position, m = this.map;
      if (m && this.terrainMesh) {
        const minY = Math.max(this.ground(Math.min(Math.max(c.x, 0), m.worldWidth), Math.min(Math.max(c.z, 0), m.worldHeight)),
          m.seaLevel * m.heightScale * this.verticalScale) + 2;
        if (c.y < minY) c.y = minY;
      }
    }
    const animate = walking || this.animateWater;
    if (animate) {
      this.grass.uniforms.uTime.value += dt;
      if (this.water) { this.waterNormals.offset.x += dt * 0.012; this.waterNormals.offset.y += dt * 0.007; }
      this._needsRender = true;
    }
    // grass only matters near the ground
    const cam = this.camera.position;
    const nearGround = this.map && this.terrainMesh && cam.y - this.ground(Math.min(Math.max(cam.x, 0), this.map.worldWidth), Math.min(Math.max(cam.z, 0), this.map.worldHeight)) < 90;
    if (this.map && this.grass.update(cam.x, cam.z, this.layers.grass && nearGround)) this._needsRender = true;
    if (walking && this.layers.shadows) this._followSun(cam);
    if (this._needsRender) {
      this._needsRender = false;
      this.sky.position.copy(cam);
      this.renderer.render(this.scene, this.camera);
    }
  }

  get animateWater() { return this._animateWater ?? false; }
  set animateWater(v) { this._animateWater = v; this.requestRender(); }

  frame() {
    const m = this.map;
    const cx = m.worldWidth / 2, cz = m.worldHeight / 2, size = Math.max(m.worldWidth, m.worldHeight);
    this.controls.target.set(cx, m.seaLevel * m.heightScale * this.verticalScale, cz);
    this.camera.position.set(cx - size * 0.15, size * 0.55, cz + size * 0.85);
    this.controls.update();
    this.requestRender();
  }

  focusOn(x, y) {
    const m = this.map;
    const gy = this.ground(x, y);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const want = Math.max(40, Math.min(offset.length(), m.cellSize * 120));
    offset.setLength(want);
    this.controls.target.set(x, gy, y);
    this.camera.position.copy(this.controls.target).add(offset);
    this.requestRender();
  }

  startWalk(at) {
    if (!this.ready || !this.map) return;
    this.walk.enter(at);
  }

  // ------------------------------------------------------------ building

  _ground(x, z, lift = 0) { return this.ground(x, z) + lift; }

  _clearGroup(g) {
    for (const c of [...g.children]) {
      g.remove(c);
      if (!c.userData.keepGeometry) c.geometry?.dispose();
      c.material?.dispose?.();
    }
  }

  _buildAll(reframe) {
    const m = this.map;
    for (const g of Object.values(this.groups)) this._clearGroup(g);
    this.terrainMesh = null;
    const size = Math.max(m.worldWidth, m.worldHeight);
    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), size * 1.2, size * 4);
    this.camera.near = Math.max(0.1, m.cellSize * 0.1);
    this.camera.far = size * 8;
    this.camera.updateProjectionMatrix();
    this.sky.scale.setScalar(size * 6);
    this.controls.maxDistance = size * 4;
    this._mapSun();
    this.tex = buildBiomeTextures(m.palette);
    this.grass.setMap(m, this.ground);
    this._buildTerrain();
    this._buildEntities();
    this.setShadows(this.layers.shadows);
    if (reframe) this.frame();
    this.requestRender();
  }

  // shadow camera covering the whole map
  _mapSun() {
    const m = this.map, size = Math.max(m.worldWidth, m.worldHeight);
    const c = new THREE.Vector3(m.worldWidth / 2, 0, m.worldHeight / 2);
    this.sun.position.copy(c).addScaledVector(this.sunDir, size);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = -size * 0.75; sc.right = size * 0.75; sc.top = size * 0.75; sc.bottom = -size * 0.75;
    sc.near = 1; sc.far = size * 3;
    sc.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.5;
  }

  // tight shadow camera around the walker for crisp shadows
  _followSun(p) {
    const sc = this.sun.shadow.camera, R = 90;
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 400);
    if (sc.right !== R) {
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 1200;
      sc.updateProjectionMatrix();
      this.sun.shadow.normalBias = 0.05;
    }
  }

  onWalkEnded() { if (this.map) this._mapSun(); }

  _buildTerrain() {
    const m = this.map;
    const step = Math.max(1, Math.ceil(Math.max(m.width, m.height) / this.maxRes));
    const axis = (n) => { const a = []; for (let i = 0; i < n; i += step) a.push(i); if (a[a.length - 1] !== n - 1) a.push(n - 1); return a; };
    this.xs = axis(m.width);
    this.ys = axis(m.height);
    const cols = this.xs.length, rows = this.ys.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cols * rows * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols * rows * 3), 3));
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    // per-sample texture layer, read by the shader with texelFetch
    this.layerData = new Uint8Array(m.width * m.height);
    this.layerTex = new THREE.DataTexture(this.layerData, m.width, m.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.layerTex.unpackAlignment = 1;
    this.layerTex.magFilter = this.layerTex.minFilter = THREE.NearestFilter;
    this.layerTex.generateMipmaps = false;
    this.terrainUniforms = {
      uBiomeTex: { value: this.tex.texture }, uLayerMap: { value: this.layerTex },
      uGrid: { value: new THREE.Vector2(m.width, m.height) }, uCell: { value: m.cellSize }, uTile: { value: 5 },
      uRock: { value: this.tex.rockLayer }, uSnow: { value: this.tex.snowLayer }, uNoise: { value: this.tex.noiseLayer },
      uCliff: { value: this.layers.cliffs ? 1 : 0 }, uSnowY: { value: 1e6 }, uSeaY: { value: 0 },
    };
    this.texMat = terrainMaterial(this.terrainUniforms);
    this.flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
    this.terrainMesh = new THREE.Mesh(geo, this.layers.textures ? this.texMat : this.flatMat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.groups.terrain.add(this.terrainMesh);

    // water is a box whose top sits at sea level, so the diorama sides look like water too
    const nm = this.waterNormals;
    nm.repeat.set(m.worldWidth / 40, m.worldHeight / 40);
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(m.worldWidth, 1, m.worldHeight).translate(m.worldWidth / 2, -0.5, m.worldHeight / 2),
      new THREE.MeshStandardMaterial({
        color: '#2378ad', transparent: true, opacity: 0.8, roughness: 0.06, metalness: 0.05,
        normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2, depthWrite: false,
      }),
    );
    water.material.userData.keep = true;
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.water = water;
    this.groups.terrain.add(water);

    this.skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: '#4b3a2b', roughness: 1, side: THREE.DoubleSide }));
    this.groups.terrain.add(this.skirt);
    this._updateTerrain();
  }

  _updateTerrain() {
    const m = this.map;
    if (!this.terrainMesh) return;
    const geo = this.terrainMesh.geometry;
    const pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const xs = this.xs, ys = this.ys, cols = xs.length, cs = m.cellSize, hs = m.heightScale * this.verticalScale;
    const lut = new Array(256);
    const c = new THREE.Color();
    for (const p of m.palette) { c.set(p.color); lut[p.id] = [c.r, c.g, c.b]; }
    for (let r = 0; r < ys.length; r++) {
      const j = ys[r];
      for (let q = 0; q < cols; q++) {
        const i = xs[q], s = j * m.width + i, v = (r * cols + q) * 3;
        pos[v] = i * cs; pos[v + 1] = m.heights[s] * hs; pos[v + 2] = j * cs;
        const bc = lut[m.biomes[s]] || [1, 0, 1];
        const n = 0.93 + 0.14 * (((i * 73856093) ^ (j * 19349663)) & 1023) / 1023;
        col[v] = bc[0] * n; col[v + 1] = bc[1] * n; col[v + 2] = bc[2] * n;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    // texture layers
    const lo = this.tex.layerOf;
    for (let i = 0; i < this.layerData.length; i++) this.layerData[i] = lo.get(m.biomes[i]) ?? 0;
    this.layerTex.needsUpdate = true;
    const u = this.terrainUniforms;
    u.uSeaY.value = m.seaLevel * hs;
    u.uSnowY.value = this.snowLine <= 1 ? this.snowLine * hs : 1e6;
    u.uCliff.value = this.layers.cliffs ? 1 : 0;
    const base = -0.04 * hs - cs * 2;
    const seaY = m.seaLevel * hs;
    this.water.scale.y = Math.max(0.01, seaY - base);
    this.water.position.y = seaY;
    this.water.visible = this.layers.water;
    this._updateSkirt();
  }

  _updateSkirt() {
    const m = this.map, cs = m.cellSize, hs = m.heightScale * this.verticalScale;
    this.skirt.visible = this.layers.skirt;
    const base = -0.04 * hs - cs * 2;
    const edges = [
      this.xs.map((i) => [i, 0]),
      this.ys.map((j) => [m.width - 1, j]),
      [...this.xs].reverse().map((i) => [i, m.height - 1]),
      [...this.ys].reverse().map((j) => [0, j]),
    ];
    const v = [];
    for (const e of edges) {
      for (let k = 0; k < e.length - 1; k++) {
        const [i0, j0] = e[k], [i1, j1] = e[k + 1];
        const y0 = m.heights[j0 * m.width + i0] * hs, y1 = m.heights[j1 * m.width + i1] * hs;
        const x0 = i0 * cs, z0 = j0 * cs, x1 = i1 * cs, z1 = j1 * cs;
        v.push(x0, y0, z0, x0, base, z0, x1, y1, z1, x1, y1, z1, x0, base, z0, x1, base, z1);
      }
    }
    const geo = this.skirt.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  setShadows(on) {
    this.layers.shadows = on;
    if (!this.ready) return;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.requestRender();
  }

  setVerticalScale(v) { this.verticalScale = v; this._dirtyTerrain = true; this._flush(); }
  setMaxRes(v) { this.maxRes = v; this.rebuild(); }
  setSnowLine(v) { this.snowLine = v; if (this.terrainMesh) { this._updateTerrain(); this.requestRender(); } }

  _buildEntities() {
    if (!this.map) return;
    this._buildObjects();
    this._buildPaths();
    this._buildRegions();
  }

  _buildObjects() {
    const g = this.groups.objects;
    this._clearGroup(g);
    g.visible = this.layers.objects;
    if (!this.layers.objects) return;
    const m = this.map;
    const snowIds = new Set(m.palette.filter((p) => p.key === 'snow').map((p) => p.id));
    const groups = new Map(); // shape key + type -> objects
    for (const o of m.objects) {
      const def = objectType(o.type);
      let shape = def.shape;
      // pines standing in snow get snowy tops automatically
      if (shape === 'tree_cone' && snowIds.has(m.biomes[Math.round(o.y / m.cellSize) * m.width + Math.round(o.x / m.cellSize)])) shape = 'tree_snowpine';
      const key = o.type + '|' + shape;
      if (!groups.has(key)) groups.set(key, { def, shape, list: [] });
      groups.get(key).list.push(o);
    }
    const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color(), base = new THREE.Color();
    for (const { def, shape, list } of groups.values()) {
      const parts = this.shapes[shape] || this.shapes.marker;
      const nature = def.cat === 'Nature';
      const mats = list.map((o) => {
        const size = def.size * (o.scale || 1);
        p.set(o.x, this._ground(o.x, o.y, (o.elevation || 0) - (nature ? 0.1 : 0)), o.y);
        q.setFromAxisAngle(UP, -(o.rotation || 0) * Math.PI / 180);
        if (shape === 'rock') s.set(size * (0.75 + 0.5 * idHash(o.id, 1)), size * (0.6 + 0.6 * idHash(o.id, 2)), size * (0.75 + 0.5 * idHash(o.id, 3)));
        else s.set(size, size * (nature ? 0.85 + 0.3 * idHash(o.id, 4) : 1), size);
        return new THREE.Matrix4().compose(p, q, s);
      });
      for (const part of parts) {
        base.set(part.color || def.color);
        const mat = new THREE.MeshStandardMaterial({
          color: '#ffffff', roughness: 0.85, flatShading: true, envMapIntensity: 0.4,
          transparent: part.opacity != null, opacity: part.opacity ?? 1,
          emissive: part.glow ? base.clone().multiplyScalar(part.glow) : (def.cat === 'Gameplay' ? base.clone().multiplyScalar(0.25) : 0x000000),
          side: part.side ?? (part.opacity != null ? THREE.DoubleSide : THREE.FrontSide),
        });
        const im = new THREE.InstancedMesh(part.geo, mat, list.length);
        im.castShadow = true;
        im.receiveShadow = true;
        list.forEach((o, i) => {
          tmp.copy(mats[i]);
          if (part.matrix) tmp.multiply(part.matrix);
          im.setMatrixAt(i, tmp);
          // natural variety: each plant gets a slightly different shade
          const k = nature ? 0.82 + 0.36 * idHash(o.id, 9) : 1;
          col.copy(base).multiplyScalar(k);
          if (nature && !part.color) col.offsetHSL((idHash(o.id, 8) - 0.5) * 0.04, 0, 0);
          im.setColorAt(i, col);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.userData.keepGeometry = true; // shape geometries are shared
        g.add(im);
      }
    }
  }

  _densify(points, closed, step) {
    const pts = closed ? [...points, points[0]] : points;
    const out = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let s = 0; s < n; s++) out.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  _ribbon(pts, width, lift) {
    const v = [];
    const n = pts.length;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz * width / 2, nz = dx * width / 2;
      const [x, z] = pts[i];
      L.push([x + nx, z + nz]); R.push([x - nx, z - nz]);
    }
    for (let i = 0; i < n - 1; i++) {
      const P = (q) => [q[0], this._ground(q[0], q[1], lift), q[1]];
      const A = P(L[i]), B = P(R[i]), C = P(L[i + 1]), D = P(R[i + 1]);
      v.push(...A, ...C, ...B, ...B, ...C, ...D);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    geo.computeVertexNormals();
    return geo;
  }

  _wall(pts, height) {
    const v = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const y0 = this._ground(x0, z0, -0.5), y1 = this._ground(x1, z1, -0.5);
      const t0 = y0 + height + 0.5, t1 = y1 + height + 0.5;
      v.push(x0, y0, z0, x1, y1, z1, x0, t0, z0, x0, t0, z0, x1, y1, z1, x1, t1, z1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    geo.computeVertexNormals();
    return geo;
  }

  _buildPaths() {
    const g = this.groups.paths;
    this._clearGroup(g);
    g.visible = this.layers.paths;
    if (!this.layers.paths) return;
    const m = this.map;
    const step = Math.max(0.5, m.cellSize);
    for (const p of m.paths) {
      const def = pathType(p.type);
      if (p.points.length < 2 || def.guide) continue;
      const pts = this._densify(p.points, p.closed, step);
      if (p.type === 'railway') {
        this._buildRailway(g, this._densify(p.points, p.closed, Math.max(0.5, m.cellSize * 0.5)), p.width);
        continue;
      }
      if (p.type === 'wall' || p.type === 'fence') {
        const mesh = new THREE.Mesh(this._wall(pts, def.height || 3), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.9, side: THREE.DoubleSide }));
        mesh.castShadow = true;
        g.add(mesh);
      } else if (def.virtual || p.type === 'cliff_edge') {
        const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, this._ground(x, z, 1), z)));
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: def.color, dashSize: 3, gapSize: 2 }));
        line.computeLineDistances();
        g.add(line);
      } else {
        const water = p.type === 'river' || p.type === 'stream';
        const mesh = new THREE.Mesh(this._ribbon(pts, p.width, water ? 0.25 : 0.12), new THREE.MeshStandardMaterial({
          color: def.color, roughness: water ? 0.08 : 1, transparent: water, opacity: water ? 0.85 : 1,
          envMapIntensity: water ? 1.2 : 0.3, normalMap: water ? this.waterNormals : null,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
        mesh.receiveShadow = true;
        g.add(mesh);
      }
    }
  }

  // polyline shifted sideways by `off` metres (left of travel direction is positive)
  _offsetPts(pts, off) {
    const n = pts.length;
    return pts.map(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
      return [x - dz / len * off, z + dx / len * off];
    });
  }

  _buildRailway(g, pts, width) {
    // ballast bed
    const bed = new THREE.Mesh(this._ribbon(pts, width, 0.12), new THREE.MeshStandardMaterial({
      color: '#7d746a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    bed.receiveShadow = true;
    g.add(bed);
    // sleepers every ~0.9 m, oriented across the track
    const spots = [];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0.9 - acc; d < len; d += 0.9) spots.push([ax + (bx - ax) * d / len, az + (bz - az) * d / len, bx - ax, bz - az]);
      acc = (acc + len) % 0.9;
    }
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.14, 0.24), new THREE.MeshStandardMaterial({ color: '#5a4334', roughness: 0.95 }), Math.max(1, spots.length));
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, dx, dz], i) => {
      q.setFromAxisAngle(UP, Math.atan2(-dx, -dz));
      p.set(x, this._ground(x, z, 0.2), z);
      sleepers.setMatrixAt(i, mtx.compose(p, q, one));
    });
    sleepers.count = spots.length;
    sleepers.receiveShadow = true;
    g.add(sleepers);
    // two steel rails, standard gauge
    const railMat = new THREE.MeshStandardMaterial({ color: '#a9b1ba', metalness: 0.7, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const off of [-0.72, 0.72]) g.add(new THREE.Mesh(this._ribbon(this._offsetPts(pts, off), 0.1, 0.34), railMat.clone()));
  }

  _buildRegions() {
    const g = this.groups.regions;
    this._clearGroup(g);
    g.visible = this.layers.regions;
    if (!this.layers.regions) return;
    const m = this.map;
    const step = Math.max(1, m.cellSize * 2);
    for (const r of m.regions) {
      if (r.points.length < 3) continue;
      const col = r.color || regionType(r.type).color;
      const pts = this._densify(r.points, true, step);
      g.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, this._ground(x, z, 0.6), z))),
        new THREE.LineBasicMaterial({ color: col }),
      ));
      g.add(new THREE.Mesh(this._wall(pts, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })));
    }
  }

  setLayer(name, on) {
    this.layers[name] = on;
    if (!this.ready || !this.map || !this.terrainMesh) return;
    if (name === 'water') this.water.visible = on;
    else if (name === 'skirt') this.skirt.visible = on;
    else if (name === 'shadows') this.setShadows(on);
    else if (name === 'textures') this.terrainMesh.material = on ? this.texMat : this.flatMat;
    else if (name === 'cliffs') this.terrainUniforms.uCliff.value = on ? 1 : 0;
    else if (name === 'grass') this.grass.invalidate();
    else this._buildEntities();
    this.requestRender();
  }

  screenshot() {
    if (!this.ready) return null;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
