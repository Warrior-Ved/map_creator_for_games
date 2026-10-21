// First-person walk mode for checking the scale and feel of a map.
// Desktop: click to look, WASD move, Shift run, Space jump, F fly, Esc exit.
// Touch: left stick moves, drag anywhere else to look, buttons for jump / run / fly.

import * as THREE from 'three';
import { NAV_DEFAULTS, regionType, objectDecks } from './model.js';
import { objectRadius } from './navigation.js';

const GRAVITY = 24, JUMP = 8, WALK = 5.5, RUN = 11, FLY = 45, BODY = 0.35;

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

export class WalkMode {
  constructor(view) {
    this.view = view;
    this.active = false;
    this.keys = new Set();
    this.stick = { x: 0, y: 0, id: null };
    this.look = { id: null, x: 0, y: 0 };
    this.run = false;
    this.fly = false;
    this._jump = false;
    this._on = [];
  }

  _listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._on.push(() => target.removeEventListener(type, fn, opts));
  }

  enter(start) {
    const v = this.view, m = v.map;
    if (this.active || !m) return;
    this.nav = { ...NAV_DEFAULTS, ...(m.navigation || {}) };
    this.saved = { pos: v.camera.position.clone(), target: v.controls.target.clone(), near: v.camera.near };
    v.controls.enabled = false;
    const spawn = m.objects.find((o) => o.type === 'player_spawn');
    const [sx, sz] = start || (spawn ? [spawn.x, spawn.y] : [v.controls.target.x, v.controls.target.z]);
    this.x = Math.min(Math.max(sx, 0), m.worldWidth);
    this.z = Math.min(Math.max(sz, 0), m.worldHeight);
    this.y = v.ground(this.x, this.z);
    this.vy = 0;
    this.onGround = true;
    if (!start && spawn) {
      // face the way the Player Spawn is rotated (rotation is clockwise from north)
      this.yaw = -(spawn.rotation || 0) * Math.PI / 180;
    } else {
      const dir = new THREE.Vector3();
      v.camera.getWorldDirection(dir);
      this.yaw = Math.atan2(-dir.x, -dir.z);
    }
    this.pitch = 0;
    v.camera.near = 0.1;
    v.camera.updateProjectionMatrix();
    this.region = null;
    this.buildColliders();
    this._buildHud();
    this.active = true;
    this.onWalkChange?.(true);
  }

  exit() {
    if (!this.active) return;
    const v = this.view;
    this.active = false;
    for (const off of this._on) off();
    this._on = [];
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud?.remove();
    v.camera.position.copy(this.saved.pos);
    v.controls.target.copy(this.saved.target);
    v.camera.near = this.saved.near;
    v.camera.updateProjectionMatrix();
    v.controls.enabled = true;
    v.controls.update();
    this.keys.clear();
    v.requestRender();
    this.onWalkChange?.(false);
  }

  // spatial hash of solid objects + wall segments
  buildColliders() {
    const m = this.view.map;
    this.cell = 8;
    this.grid = new Map();
    for (const o of m.objects) {
      const r = objectRadius(o);
      if (r <= 0) continue;
      const k = Math.floor(o.x / this.cell) + ',' + Math.floor(o.y / this.cell);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push({ x: o.x, z: o.y, r });
    }
    this.walls = [];
    for (const p of m.paths) {
      if (p.type !== 'wall' && p.type !== 'fence') continue;
      const pts = p.closed ? [...p.points, p.points[0]] : p.points;
      for (let k = 0; k < pts.length - 1; k++) this.walls.push({ a: pts[k], b: pts[k + 1], r: p.width / 2 });
    }
    // piers, bridges, platforms: surfaces you can stand on above the terrain
    this.decks = [];
    for (const o of m.objects) {
      for (const d of objectDecks(o)) {
        this.decks.push({ ...d, top: this.view.ground(o.x, o.y) + (o.elevation || 0) + d.y });
      }
    }
    this.regions = m.regions.filter((r) => r.points.length > 2).map((r) => ({ r, area: polyArea(r.points) })).sort((a, b) => a.area - b.area);
  }

  // standing height: terrain or a deck above it
  floor(x, z) {
    let g = this.view.ground(x, z);
    for (const d of this.decks) {
      if (d.top <= g) continue;
      const [ax, az] = d.a, [bx, bz] = d.b, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) <= d.w / 2) g = d.top;
    }
    return g;
  }

  _collide() {
    const c = this.cell;
    const gx = Math.floor(this.x / c), gz = Math.floor(this.z / c);
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
      const list = this.grid.get((gx + ox) + ',' + (gz + oz));
      if (!list) continue;
      for (const o of list) {
        const dx = this.x - o.x, dz = this.z - o.z, d = Math.hypot(dx, dz), min = o.r + BODY;
        if (d < min && d > 1e-6) { this.x = o.x + dx / d * min; this.z = o.z + dz / d * min; }
      }
    }
    for (const w of this.walls) {
      const [ax, az] = w.a, [bx, bz] = w.b, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 ? ((this.x - ax) * dx + (this.z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, pz = az + t * dz, ex = this.x - px, ez = this.z - pz, d = Math.hypot(ex, ez), min = w.r + BODY;
      if (d < min && d > 1e-6) { this.x = px + ex / d * min; this.z = pz + ez / d * min; }
    }
  }

  update(dt) {
    if (!this.active) return;
    const v = this.view, m = v.map;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.stick.x;
    let iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.stick.y;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const seaY = m.seaLevel * m.heightScale * v.verticalScale;
    const groundHere = this.floor(this.x, this.z);
    const swimming = !this.fly && groundHere < seaY - 1.3 && this.y < seaY - 1.0;
    const running = this.run || k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = this.fly ? FLY * (running ? 2.5 : 1) : (running ? RUN : WALK) * (swimming ? 0.55 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const mx = (fx * iz + rx * ix) * speed * dt, mz = (fz * iz + rz * ix) * speed * dt;
    const maxRise = Math.tan(this.nav.maxSlopeDeg * Math.PI / 180);
    const canStep = (nx, nz) => {
      if (this.fly || swimming || !this.onGround) return true;
      const run = Math.hypot(nx - this.x, nz - this.z);
      return run < 1e-6 || (this.floor(nx, nz) - groundHere) / run <= maxRise;
    };
    if (mx || mz) {
      const nx = this.x + mx, nz = this.z + mz;
      if (canStep(nx, nz)) { this.x = nx; this.z = nz; }
      else if (canStep(this.x + mx, this.z)) this.x += mx; // slide along the slope
      else if (canStep(this.x, this.z + mz)) this.z += mz;
    }
    if (!this.fly) this._collide();
    this.x = Math.min(Math.max(this.x, 0), m.worldWidth);
    this.z = Math.min(Math.max(this.z, 0), m.worldHeight);
    const g = this.floor(this.x, this.z);
    if (this.fly) {
      const up = (k.has('Space') || this._jump ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') ? 1 : 0);
      this.y = Math.max(g, this.y + up * speed * 0.6 * dt);
      this.vy = 0;
    } else {
      if ((k.has('Space') || this._jump) && (this.onGround || swimming)) { this.vy = swimming ? 4 : JUMP; this.onGround = false; }
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      const floatY = seaY - 1.3; // swimming: head stays above water
      if (g < floatY && this.y < floatY) { this.y = floatY; this.vy = Math.max(0, this.vy); this.onGround = false; }
      if (this.y <= g || (this.onGround && this.y - g < 0.6 && this.vy <= 0)) { this.y = g; this.vy = 0; this.onGround = true; }
      else if (this.y > g + 0.01) this.onGround = false;
    }
    this._jump = false;
    const cam = v.camera;
    cam.position.set(this.x, this.y + this.nav.eyeHeight, this.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this._updateHud(swimming);
  }

  // ------------------------------------------------------------ HUD & input

  _buildHud() {
    const v = this.view;
    const el = document.createElement('div');
    el.className = 'walk-hud';
    const touch = matchMedia('(pointer: coarse)').matches;
    el.innerHTML = `
      <div class="walk-look"></div>
      <div class="walk-top"><div class="walk-info"></div><div class="walk-banner"></div></div>
      <div class="walk-help">${touch ? 'Left stick: move · drag: look' : 'Click to look around · WASD move · Shift run · Space jump · F fly (C down) · Esc exit'}</div>
      <div class="walk-stick"><div class="walk-knob"></div></div>
      <div class="walk-btns">
        <button data-w="exit" title="Exit walk mode (Esc)">✕ Exit</button>
        <button data-w="fly" title="Fly (F)">🕊 Fly</button>
        <button data-w="run" title="Run (Shift)">🏃 Run</button>
        <button data-w="jump" class="big" title="Jump (Space)">⤒</button>
      </div>
      <div class="walk-cross"></div>`;
    v.container.appendChild(el);
    this.hud = el;
    this.info = el.querySelector('.walk-info');
    this.banner = el.querySelector('.walk-banner');
    const look = el.querySelector('.walk-look');
    const stick = el.querySelector('.walk-stick'), knob = el.querySelector('.walk-knob');

    this._listen(el.querySelector('[data-w=exit]'), 'click', () => this.exit());
    const flyBtn = el.querySelector('[data-w=fly]'), runBtn = el.querySelector('[data-w=run]');
    this._listen(flyBtn, 'click', () => { this.fly = !this.fly; flyBtn.classList.toggle('on', this.fly); });
    this._listen(runBtn, 'click', () => { this.run = !this.run; runBtn.classList.toggle('on', this.run); });
    this._listen(el.querySelector('[data-w=jump]'), 'pointerdown', (e) => { e.preventDefault(); this._jump = true; });

    // look: pointer lock for mouse, drag for touch / pen
    this._listen(look, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse') { look.requestPointerLock?.(); return; }
      if (this.look.id !== null) return;
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      look.setPointerCapture(e.pointerId);
    });
    this._listen(look, 'pointermove', (e) => {
      if (e.pointerId !== this.look.id) return;
      this._turn((e.clientX - this.look.x) * 0.006, (e.clientY - this.look.y) * 0.006);
      this.look.x = e.clientX; this.look.y = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === this.look.id) this.look.id = null; };
    this._listen(look, 'pointerup', endLook);
    this._listen(look, 'pointercancel', endLook);
    this._listen(document, 'mousemove', (e) => { if (document.pointerLockElement === look) this._turn(e.movementX * 0.0025, e.movementY * 0.0025); });

    // virtual stick
    const R = 50;
    const setStick = (e) => {
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / R; this.stick.y = dy / R;
    };
    this._listen(stick, 'pointerdown', (e) => { e.preventDefault(); this.stick.id = e.pointerId; stick.setPointerCapture(e.pointerId); setStick(e); });
    this._listen(stick, 'pointermove', (e) => { if (e.pointerId === this.stick.id) setStick(e); });
    const endStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { x: 0, y: 0, id: null };
      knob.style.transform = '';
    };
    this._listen(stick, 'pointerup', endStick);
    this._listen(stick, 'pointercancel', endStick);

    this._listen(window, 'keydown', (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.code === 'Escape') { if (!document.pointerLockElement) this.exit(); return; }
      if (e.code === 'KeyF') { this.fly = !this.fly; flyBtn.classList.toggle('on', this.fly); }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    this._listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this._listen(window, 'blur', () => this.keys.clear());
  }

  _turn(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy));
  }

  _updateHud(swimming) {
    const m = this.view.map;
    const cx = Math.round(this.x / m.cellSize), cz = Math.round(this.z / m.cellSize);
    const biome = m.biome(m.biomes[Math.min(m.height - 1, cz) * m.width + Math.min(m.width - 1, cx)]).name;
    let deg = (-this.yaw * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const hit = this.regions.find((r) => pointInPoly(this.x, this.z, r.r.points));
    const name = hit ? (hit.r.name || regionType(hit.r.type).name) : null;
    const mode = this.fly ? 'Flying' : swimming ? 'Swimming' : this.run ? 'Running' : 'Walking';
    const text = `${dirs[Math.round(deg / 45) % 8]} ${Math.round(deg)}° · ${mode} · ${biome}${name ? ' · ' + name : ''}  ·  x ${this.x.toFixed(0)} y ${this.z.toFixed(0)} · alt ${this.y.toFixed(1)}`;
    if (text !== this._lastInfo) { this.info.textContent = text; this._lastInfo = text; }
    if (name !== this.region) {
      this.region = name;
      if (name) {
        this.banner.textContent = name;
        this.banner.style.color = hit.r.color || '#fff';
        this.banner.classList.remove('show');
        void this.banner.offsetWidth; // restart the animation
        this.banner.classList.add('show');
      }
    }
  }
}
