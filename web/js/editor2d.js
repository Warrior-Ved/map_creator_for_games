// The 2D map canvas: view transform, touch/pen/mouse input, tools, drawing.

import { objectType, pathType, regionType, newObject, newPath, newRegion, objectDecks, OBJECT_TYPES } from './model.js';
import { applyDab, shadeRegion, makeNoise2D, mulberry32, carvePath, slopeAt, applyStamp, shapeAlongPath, levelSegments, STAMPS } from './terrain.js';
import { computeWalkGrid, NAV_LEGEND } from './navigation.js';
import { extractPatch } from './history.js';

const clone = (v) => structuredClone(v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

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

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// Ramer–Douglas–Peucker simplification
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

export class Editor2D {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.view = { scale: 2, ox: 0, oy: 0 };
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.walkCanvas = document.createElement('canvas');
    this._walkTimer = 0;
    this.imgData = null;
    this.layers = { hillshade: true, water: true, contours: false, heightTint: false, walk: false, grid: false, objects: true, paths: true, regions: true, labels: true, pixelated: false };
    this.contourInterval = 10;
    this.tool = 'select';
    this.brush = { mode: 'raise', size: 16, strength: 0.5, falloff: 0.6, targetHeight: 0.5, biome: 3, terraceStep: 6, landHeight: 4, waterDepth: 8 };
    this.place = { type: 'house', randomRotation: false, scaleJitter: 0 };
    this.scatter = { types: ['tree_oak', 'tree_pine'], size: 24, density: 0.35, minSpacing: 3, erase: false, eraseAll: true, avoidWater: true, maxSlope: 1.2, randomRotation: true, scaleJitter: 0.25 };
    this.pathType = 'road';
    this.regionType = 'zone';
    this.stylusMode = false;
    this.selection = []; // [{coll, id}]
    this.draft = null; // {kind:'path'|'region', type, points}
    this.pointers = new Map();
    this.gesture = null;
    this.hover = null; // {x, y} screen
    this.iconCache = new Map();
    this.spaceDown = false;
    this._raf = 0;
    this._lastTap = { t: 0, x: 0, y: 0 };
    this._bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  // ------------------------------------------------------------ setup

  setMap(map) {
    this.map = map;
    this.base.width = map.width;
    this.base.height = map.height;
    this.imgData = this.baseCtx.createImageData(map.width, map.height);
    this.walkCanvas.width = map.width;
    this.walkCanvas.height = map.height;
    if (this.layers.walk) this.updateWalkOverlay(true);
    this.selection = [];
    this.draft = null;
    this.updateBase();
    this.resize();
    this.fit();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return; // hidden (3D-only mode)
    if (this.cssW > 1 && this.cssH > 1) {
      // keep the same map point in the middle when the viewport changes size
      this.view.ox += (r.width - this.cssW) / 2;
      this.view.oy += (r.height - this.cssH) / 2;
    }
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    this.dpr = dpr;
    this.requestRender();
  }

  fit() {
    if (!this.map) return;
    const s = Math.min(this.cssW / this.map.width, this.cssH / this.map.height) * 0.92;
    this.view.scale = s;
    this.view.ox = (this.cssW - this.map.width * s) / 2;
    this.view.oy = (this.cssH - this.map.height * s) / 2;
    this.requestRender();
  }

  zoomBy(f, sx = this.cssW / 2, sy = this.cssH / 2) {
    const v = this.view;
    const ns = Math.min(64, Math.max(0.05, v.scale * f));
    const k = ns / v.scale;
    v.ox = sx - (sx - v.ox) * k;
    v.oy = sy - (sy - v.oy) * k;
    v.scale = ns;
    this.requestRender();
  }

  updateBase(rect = null) {
    const m = this.map;
    if (!m) return;
    let r = rect ? { x0: rect.x0 - 1, y0: rect.y0 - 1, x1: rect.x1 + 1, y1: rect.y1 + 1 } : { x0: 0, y0: 0, x1: m.width - 1, y1: m.height - 1 };
    r = { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(m.width - 1, r.x1), y1: Math.min(m.height - 1, r.y1) };
    shadeRegion(m, this.imgData.data, r, { ...this.layers, contourInterval: this.layers.contours ? this.contourInterval : 0 });
    this.baseCtx.putImageData(this.imgData, 0, 0, r.x0, r.y0, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1);
    this.requestRender();
  }

  // Walkability overlay; recomputed lazily because it looks at the whole map.
  updateWalkOverlay(now = false) {
    if (!this.layers.walk || !this.map) return;
    clearTimeout(this._walkTimer);
    const run = () => {
      const m = this.map, grid = computeWalkGrid(m);
      this.walkGrid = grid;
      const ctx = this.walkCanvas.getContext('2d');
      const img = ctx.createImageData(m.width, m.height);
      const cols = [];
      for (const [v, , c] of NAV_LEGEND) cols[v] = c;
      for (let i = 0; i < grid.length; i++) {
        const c = cols[grid[i]], o = i * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
        img.data[o + 3] = grid[i] === 1 ? 70 : 150;
      }
      ctx.putImageData(img, 0, 0);
      this.requestRender();
    };
    if (now) run(); else this._walkTimer = setTimeout(run, 250);
  }

  // ------------------------------------------------------------ coords

  // world units -> CSS pixels
  w2s(x, y) {
    const cs = this.map.cellSize, v = this.view;
    return [(x / cs + 0.5) * v.scale + v.ox, (y / cs + 0.5) * v.scale + v.oy];
  }

  s2w(sx, sy) {
    const cs = this.map.cellSize, v = this.view;
    return [((sx - v.ox) / v.scale - 0.5) * cs, ((sy - v.oy) / v.scale - 0.5) * cs];
  }

  clampWorld(x, y) {
    return [Math.min(Math.max(x, 0), this.map.worldWidth), Math.min(Math.max(y, 0), this.map.worldHeight)];
  }

  pxToWorld(px) { return (px / this.view.scale) * this.map.cellSize; }

  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ------------------------------------------------------------ selection

  setSelection(sel) {
    this.selection = sel;
    this.app.selectionChanged();
    this.requestRender();
  }

  isSelected(coll, id) { return this.selection.some((s) => s.coll === coll && s.id === id); }

  selectedItems() {
    return this.selection.map((s) => ({ ...s, item: this.map[s.coll].find((e) => e.id === s.id) })).filter((s) => s.item);
  }

  deleteSelection() {
    const sel = this.selectedItems();
    if (!sel.length) return;
    this.app.history.entities(`Delete ${sel.length} item(s)`, (track) => {
      for (const s of sel) {
        track(s.coll, s.id);
        const arr = this.map[s.coll];
        arr.splice(arr.indexOf(s.item), 1);
      }
    });
    this.setSelection([]);
    this.app.entitiesChanged();
  }

  duplicateSelection() {
    const sel = this.selectedItems();
    if (!sel.length) return;
    const off = this.map.cellSize * 4;
    const added = [];
    this.app.history.entities('Duplicate', () => {
      for (const s of sel) {
        const c = clone(s.item);
        c.id = s.item.id.split('_')[0] + '_' + Math.random().toString(36).slice(2, 10);
        if (s.coll === 'objects') { c.x += off; c.y += off; } else c.points = c.points.map(([x, y]) => [x + off, y + off]);
        this.map[s.coll].push(c);
        added.push({ coll: s.coll, id: c.id });
      }
    });
    this.setSelection(added);
    this.app.entitiesChanged();
  }

  // ------------------------------------------------------------ hit tests

  objectScreenSize(o, def = objectType(o.type)) {
    const real = (def.size * (o.scale || 1) / this.map.cellSize) * this.view.scale;
    const min = def.marker ? 26 : def.cat === 'Gameplay' ? 22 : def.cat === 'Structures' ? 16 : 5;
    return Math.min(def.marker ? 56 : 64, Math.max(min, real));
  }

  hitTest(sx, sy, touch) {
    const tol = touch ? 16 : 8;
    const m = this.map;
    // handles of a single selected path / region
    const sel = this.selectedItems();
    if (sel.length === 1 && sel[0].coll !== 'objects') {
      const it = sel[0].item, pts = it.points;
      for (let i = 0; i < pts.length; i++) {
        const [hx, hy] = this.w2s(pts[i][0], pts[i][1]);
        if (dist(sx, sy, hx, hy) <= tol + 4) return { kind: 'vertex', coll: sel[0].coll, id: it.id, index: i };
      }
      const closed = sel[0].coll === 'regions' || it.closed;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const [hx, hy] = this.w2s((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        if (dist(sx, sy, hx, hy) <= tol) return { kind: 'midpoint', coll: sel[0].coll, id: it.id, index: i + 1 };
      }
    }
    if (this.layers.objects) {
      for (let i = m.objects.length - 1; i >= 0; i--) {
        const o = m.objects[i];
        const [ox, oy] = this.w2s(o.x, o.y);
        const r = this.objectScreenSize(o) / 2 + (touch ? 6 : 2);
        if (Math.abs(sx - ox) <= r && Math.abs(sy - oy) <= r && dist(sx, sy, ox, oy) <= r) return { kind: 'item', coll: 'objects', id: o.id };
      }
    }
    if (this.layers.paths) {
      for (let i = m.paths.length - 1; i >= 0; i--) {
        const p = m.paths[i];
        const halfW = Math.max(tol, (p.width / m.cellSize) * this.view.scale / 2);
        const pts = p.points.map(([x, y]) => this.w2s(x, y));
        const n = p.closed ? pts.length : pts.length - 1;
        for (let k = 0; k < n; k++) {
          const a = pts[k], b = pts[(k + 1) % pts.length];
          if (segDist(sx, sy, a[0], a[1], b[0], b[1]) <= halfW) return { kind: 'item', coll: 'paths', id: p.id };
        }
      }
    }
    if (this.layers.regions) {
      const [wx, wy] = this.s2w(sx, sy);
      const hits = m.regions.filter((r) => r.points.length > 2 && pointInPoly(wx, wy, r.points));
      if (hits.length) {
        hits.sort((a, b) => polyArea(a.points) - polyArea(b.points));
        return { kind: 'item', coll: 'regions', id: hits[0].id };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ input

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e, true));
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { this.hover = null; this.requestRender(); } });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = this.eventPos(e);
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
      else { this.view.ox -= e.deltaX; this.requestRender(); }
    }, { passive: false });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('input,textarea,select')) { this.spaceDown = true; } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
  }

  _down(e) {
    if (!this.map) return;
    if (e.pointerType === 'pen' && !this.stylusMode) {
      this.stylusMode = true;
      this.app.stylusDetected?.();
    }
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this.eventPos(e);
    this.pointers.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });

    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (this.pointers.size >= 2 && touches.length >= 2) {
      this._cancelGesture();
      const [a, b] = [...this.pointers.values()].filter((p) => p.type === 'touch');
      this.gesture = { kind: 'pinch', d0: dist(a.x, a.y, b.x, b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...this.view } };
      return;
    }
    if (this.gesture) return; // pen + resting finger etc.

    const navOnly = e.button === 1 || e.button === 2 || this.spaceDown || this.tool === 'pan' || (this.stylusMode && e.pointerType === 'touch');
    if (navOnly) {
      this.gesture = { kind: 'pan', id: e.pointerId, sx, sy, view: { ...this.view } };
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._toolDown(e, sx, sy);
  }

  _move(e) {
    if (!this.map) return;
    const [sx, sy] = this.eventPos(e);
    if (e.pointerType !== 'touch') this.hover = { x: sx, y: sy };
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = sx; p.y = sy; }
    this._reportCursor(sx, sy);
    const g = this.gesture;
    if (!g) { if (e.pointerType !== 'touch') this.requestRender(); return; }
    if (g.kind === 'pinch') {
      const pts = [...this.pointers.values()].filter((q) => q.type === 'touch');
      if (pts.length < 2) return;
      const [a, b] = pts;
      const d = dist(a.x, a.y, b.x, b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ns = Math.min(64, Math.max(0.05, g.view.scale * d / Math.max(1, g.d0)));
      const k = ns / g.view.scale;
      this.view.scale = ns;
      this.view.ox = mx - (g.mx - g.view.ox) * k;
      this.view.oy = my - (g.my - g.view.oy) * k;
      this.requestRender();
      return;
    }
    if (g.kind === 'pan') {
      if (e.pointerId !== g.id) return;
      this.view.ox = g.view.ox + sx - g.sx;
      this.view.oy = g.view.oy + sy - g.sy;
      this.requestRender();
      return;
    }
    if (e.pointerId !== g.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs.length ? evs : [e]) {
      const [cx, cy] = this.eventPos(ce);
      this._toolMove(ce, cx, cy);
    }
    this.requestRender();
  }

  _up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === 'pan') { this.gesture = null; return; }
    const [sx, sy] = this.eventPos(e);
    if (cancelled) this._cancelGesture();
    else this._toolUp(e, sx, sy);
    this.gesture = null;
    this.requestRender();
  }

  _reportCursor(sx, sy) {
    const m = this.map;
    const [wx, wy] = this.s2w(sx, sy);
    const cx = Math.round(wx / m.cellSize), cy = Math.round(wy / m.cellSize);
    if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) { this.app.onCursor(null); return; }
    const i = cy * m.width + cx;
    this.app.onCursor({ wx, wy, cx, cy, h: m.heights[i], y: m.heights[i] * m.heightScale, biome: m.biome(m.biomes[i]).name, water: m.heights[i] < m.seaLevel });
  }

  _pressure(e) {
    if (e.pointerType !== 'pen') return 1;
    return Math.max(0.1, Math.min(1.5, (e.pressure || 0.5) * 1.6));
  }

  // undo whatever an unfinished gesture has done (a second finger turned it into a pinch)
  _cancelGesture() {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'stroke') {
      clearInterval(g.timer);
      this.map.heights.set(g.snapshot.heights);
      this.map.biomes.set(g.snapshot.biomes);
      if (g.rect) { this.updateBase(g.rect); this.app.terrainChanged(g.rect, true); }
    } else if (g.kind === 'drag') {
      for (const b of g.before) {
        const arr = this.map[b.coll];
        const i = arr.findIndex((x) => x.id === b.id);
        if (i >= 0) arr[i] = clone(b.value);
      }
      this.app.entitiesChanged();
    } else if (g.kind === 'scatter') {
      clearInterval(g.timer);
      for (const coll of ['objects']) {
        this.map[coll] = this.map[coll].filter((o) => !g.added.has(o.id));
        for (const r of g.removed.values()) this.map[coll].splice(Math.min(r.index, this.map[coll].length), 0, r.value);
      }
      this.app.entitiesChanged();
    } else if (g.kind === 'freehand' && this.draft) {
      this.draft.points.length = g.startLen;
      this.app.draftChanged();
    }
    this.gesture = null;
    this.requestRender();
  }

  // ------------------------------------------------------------ tools

  _toolDown(e, sx, sy) {
    const touch = e.pointerType === 'touch';
    const [wx, wy] = this.s2w(sx, sy);
    switch (this.tool) {
      case 'sculpt':
      case 'paint': return this._strokeStart(e, sx, sy);
      case 'scatter': return this._scatterStart(e, sx, sy);
      case 'place':
        this.gesture = { kind: 'tap', id: e.pointerId, sx, sy };
        return;
      case 'path':
      case 'region':
        this.gesture = { kind: 'drawtap', id: e.pointerId, sx, sy, startLen: this.draft ? this.draft.points.length : 0 };
        return;
      case 'select':
      default: {
        const hit = this.hitTest(sx, sy, touch);
        if (!hit) {
          this.gesture = { kind: 'box', id: e.pointerId, sx, sy, ex: sx, ey: sy, additive: e.shiftKey };
          return;
        }
        if (hit.kind === 'vertex' || hit.kind === 'midpoint') {
          const item = this.map[hit.coll].find((x) => x.id === hit.id);
          const before = [{ coll: hit.coll, id: hit.id, index: this.map[hit.coll].indexOf(item), value: clone(item) }];
          if (hit.kind === 'midpoint') item.points.splice(hit.index, 0, this.clampWorld(wx, wy));
          this.gesture = { kind: 'drag', mode: 'vertex', id: e.pointerId, item, vi: hit.index, before, moved: hit.kind === 'midpoint', sx, sy, coll: hit.coll };
          return;
        }
        if (!this.isSelected(hit.coll, hit.id)) this.setSelection(e.shiftKey ? [...this.selection, { coll: hit.coll, id: hit.id }] : [{ coll: hit.coll, id: hit.id }]);
        const items = this.selectedItems();
        this.gesture = {
          kind: 'drag', mode: 'move', id: e.pointerId, sx, sy, wx, wy, moved: false,
          before: items.map((s) => ({ coll: s.coll, id: s.id, index: this.map[s.coll].indexOf(s.item), value: clone(s.item) })),
        };
      }
    }
  }

  _toolMove(e, sx, sy) {
    const g = this.gesture;
    if (!g) return;
    const [wx, wy] = this.s2w(sx, sy);
    switch (g.kind) {
      case 'stroke': return this._strokeMove(e, sx, sy);
      case 'scatter': return this._scatterMove(sx, sy);
      case 'box': g.ex = sx; g.ey = sy; return;
      case 'drawtap':
        if (dist(sx, sy, g.sx, g.sy) > 10) {
          // turn into freehand drawing
          if (!this.draft) this._newDraft();
          g.kind = 'freehand';
          this.draft.points.push(this.clampWorld(...this.s2w(g.sx, g.sy)));
          this.app.draftChanged();
        }
        return;
      case 'freehand': {
        const last = this.draft.points[this.draft.points.length - 1];
        const step = Math.max(this.map.cellSize * 1.5, this.pxToWorld(8));
        if (dist(wx, wy, last[0], last[1]) >= step) { this.draft.points.push(this.clampWorld(wx, wy)); this.app.draftChanged(); }
        return;
      }
      case 'drag': {
        if (!g.moved && dist(sx, sy, g.sx, g.sy) < 4) return;
        g.moved = true;
        if (g.mode === 'vertex') {
          g.item.points[g.vi] = this.clampWorld(wx, wy);
        } else {
          const dx = wx - g.wx, dy = wy - g.wy;
          for (const b of g.before) {
            const it = this.map[b.coll].find((x) => x.id === b.id);
            if (!it) continue;
            if (b.coll === 'objects') [it.x, it.y] = this.clampWorld(b.value.x + dx, b.value.y + dy);
            else it.points = b.value.points.map(([x, y]) => [x + dx, y + dy]);
          }
        }
        this.app.entitiesChanged(true);
      }
    }
  }

  _toolUp(e, sx, sy) {
    const g = this.gesture;
    const touch = e.pointerType === 'touch';
    switch (g.kind) {
      case 'stroke': return this._strokeEnd();
      case 'scatter': return this._scatterEnd();
      case 'tap':
        if (dist(sx, sy, g.sx, g.sy) < 12) this._placeObject(...this.s2w(sx, sy));
        return;
      case 'drawtap': return this._draftTap(sx, sy, touch);
      case 'freehand': {
        const d = this.draft;
        d.points = d.points.slice(0, g.startLen).concat(simplify(d.points.slice(g.startLen), this.map.cellSize * 0.6));
        if (g.startLen === 0 && d.points.length >= (d.kind === 'region' ? 3 : 2)) this.finishDraft();
        else this.app.draftChanged();
        return;
      }
      case 'box': {
        if (dist(g.sx, g.sy, g.ex, g.ey) < 6) { if (!g.additive) this.setSelection([]); return; }
        const [ax, ay] = this.s2w(Math.min(g.sx, g.ex), Math.min(g.sy, g.ey));
        const [bx, by] = this.s2w(Math.max(g.sx, g.ex), Math.max(g.sy, g.ey));
        const sel = g.additive ? [...this.selection] : [];
        for (const o of this.map.objects) if (o.x >= ax && o.x <= bx && o.y >= ay && o.y <= by && !sel.some((s) => s.id === o.id)) sel.push({ coll: 'objects', id: o.id });
        this.setSelection(sel);
        return;
      }
      case 'drag': {
        if (!g.moved) {
          // tap on an already selected item in a multi-selection selects just it
          const hit = this.hitTest(sx, sy, touch);
          if (hit?.kind === 'item' && this.selection.length > 1 && !e.shiftKey) this.setSelection([{ coll: hit.coll, id: hit.id }]);
          if (hit?.kind === 'vertex' && this._isDoubleTap(sx, sy)) this._removeVertex(hit);
          this._lastTap = { t: performance.now(), x: sx, y: sy };
          return;
        }
        const changes = g.before.map((b) => {
          const it = this.map[b.coll].find((x) => x.id === b.id);
          return { coll: b.coll, id: b.id, index: b.index, before: b.value, after: clone(it) };
        });
        this.app.history.push({ label: g.mode === 'vertex' ? 'Edit shape' : 'Move', changes });
        this.app.entitiesChanged();
      }
    }
  }

  _isDoubleTap(sx, sy) {
    return performance.now() - this._lastTap.t < 350 && dist(sx, sy, this._lastTap.x, this._lastTap.y) < 20;
  }

  _removeVertex(hit) {
    const item = this.map[hit.coll].find((x) => x.id === hit.id);
    const min = hit.coll === 'regions' ? 3 : 2;
    if (!item || item.points.length <= min) return;
    this.app.history.entities('Remove point', (track) => { track(hit.coll, hit.id); item.points.splice(hit.index, 1); });
    this.app.entitiesChanged();
  }

  // ---- sculpt & paint strokes

  _strokeStart(e, sx, sy) {
    const m = this.map;
    const [wx, wy] = this.s2w(sx, sy);
    const cx = wx / m.cellSize, cy = wy / m.cellSize;
    const brush = { ...this.brush, mode: this.tool === 'paint' ? 'paint' : this.brush.mode };
    const g = {
      kind: 'stroke', id: e.pointerId, brush, lastC: [cx, cy], rect: null,
      snapshot: { heights: m.heights.slice(), biomes: m.biomes.slice() },
      state: { target: m.heightAtCell(cx, cy), noise: makeNoise2D((Math.random() * 1e9) | 0), rand: mulberry32((Math.random() * 1e9) | 0), pressure: this._pressure(e) },
      lastMove: performance.now(),
    };
    this.gesture = g;
    if (STAMPS.includes(brush.mode)) {
      // landform stamps apply once per tap
      g.stamp = true;
      const r = applyStamp(m, cx, cy, brush.mode, brush.size, brush.strength * g.state.pressure, (Math.random() * 1e9) | 0);
      if (r) { g.rect = r; this.updateBase(r); this.app.terrainChanged(r, false); }
      return;
    }
    this._dab(cx, cy);
    if (brush.mode !== 'paint' && brush.mode !== 'flatten' && brush.mode !== 'set') {
      // holding the brush still keeps sculpting
      g.timer = setInterval(() => {
        if (this.gesture !== g) return clearInterval(g.timer);
        if (performance.now() - g.lastMove > 60) { this._dab(g.lastC[0], g.lastC[1]); this.requestRender(); }
      }, 50);
    }
  }

  _strokeMove(e, sx, sy) {
    const g = this.gesture, m = this.map;
    if (g.stamp) return;
    const [wx, wy] = this.s2w(sx, sy);
    const cx = wx / m.cellSize, cy = wy / m.cellSize;
    g.state.pressure = this._pressure(e);
    const spacing = Math.max(0.5, g.brush.size * 0.12);
    const [lx, ly] = g.lastC;
    const d = dist(cx, cy, lx, ly);
    if (d < spacing) return;
    const n = Math.floor(d / spacing);
    for (let k = 1; k <= n; k++) this._dab(lx + (cx - lx) * k / n, ly + (cy - ly) * k / n);
    g.lastC = [cx, cy];
    g.lastMove = performance.now();
  }

  _dab(cx, cy) {
    const g = this.gesture;
    const r = applyDab(this.map, cx, cy, g.brush, g.state);
    if (!r) return;
    g.rect = g.rect ? { x0: Math.min(g.rect.x0, r.x0), y0: Math.min(g.rect.y0, r.y0), x1: Math.max(g.rect.x1, r.x1), y1: Math.max(g.rect.y1, r.y1) } : r;
    this.updateBase(r);
    this.app.terrainChanged(r, false);
  }

  _strokeEnd() {
    const g = this.gesture;
    clearInterval(g.timer);
    if (!g.rect) return;
    const label = g.brush.mode === 'paint' ? 'Paint ' + this.map.biome(g.brush.biome).name : (g.stamp ? 'Stamp ' : 'Sculpt ') + g.brush.mode.replace('_stamp', '');
    this.app.history.push({ label, terrain: extractPatch(this.map, g.snapshot, g.rect) });
    this.app.terrainChanged(g.rect, true);
  }

  // ---- scatter

  _scatterStart(e, sx, sy) {
    const m = this.map;
    const cell = Math.max(this.scatter.minSpacing, 1);
    const grid = new Map();
    const key = (x, y) => ((x / cell) | 0) + ',' + ((y / cell) | 0);
    for (const o of m.objects) {
      const k = key(o.x, o.y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
    const g = { kind: 'scatter', id: e.pointerId, grid, gcell: cell, key, added: new Set(), removed: new Map(), rand: mulberry32((Math.random() * 1e9) | 0), last: null, sx, sy, lastMove: performance.now() };
    this.gesture = g;
    this._scatterDab(sx, sy);
    g.timer = setInterval(() => {
      if (this.gesture !== g) return clearInterval(g.timer);
      if (!this.scatter.erase && performance.now() - g.lastMove > 120) this._scatterDab(g.sx, g.sy);
    }, 150);
  }

  _scatterMove(sx, sy) {
    const g = this.gesture;
    g.sx = sx; g.sy = sy; g.lastMove = performance.now();
    const [wx, wy] = this.s2w(sx, sy);
    const r = this.scatter.size / 2 * this.map.cellSize;
    if (!g.last || dist(wx, wy, g.last[0], g.last[1]) > r * 0.5) this._scatterDab(sx, sy);
  }

  _scatterDab(sx, sy) {
    const g = this.gesture, m = this.map, S = this.scatter;
    const [wx, wy] = this.s2w(sx, sy);
    g.last = [wx, wy];
    const r = S.size / 2 * m.cellSize;
    if (S.erase) {
      const types = new Set(S.types);
      const keep = [];
      let changed = false;
      m.objects.forEach((o, index) => {
        if (dist(o.x, o.y, wx, wy) <= r && (!types.size || types.has(o.type) || S.eraseAll)) {
          if (g.added.has(o.id)) g.added.delete(o.id);
          else g.removed.set(o.id, { index, value: o });
          changed = true;
        } else keep.push(o);
      });
      if (changed) { m.objects = keep; this.app.entitiesChanged(true); }
      return;
    }
    if (!S.types.length) return;
    const area = Math.PI * r * r;
    const spacing = Math.max(0.5, S.minSpacing);
    // density 1 = as tightly packed as min spacing allows
    const target = Math.max(1, Math.round(area / (spacing * spacing * 4) * S.density * 0.35));
    let placed = 0;
    for (let attempt = 0; attempt < target * 3 && placed < target; attempt++) {
      const a = g.rand() * Math.PI * 2, rr = Math.sqrt(g.rand()) * r;
      const [x, y] = [wx + Math.cos(a) * rr, wy + Math.sin(a) * rr];
      if (x < 0 || y < 0 || x > m.worldWidth || y > m.worldHeight) continue;
      const cx = Math.round(x / m.cellSize), cy = Math.round(y / m.cellSize);
      if (S.avoidWater && m.heightAtCell(x / m.cellSize, y / m.cellSize) < m.seaLevel) continue;
      if (S.maxSlope < 5 && slopeAt(m, cx, cy) > S.maxSlope) continue;
      if (this._tooClose(g, x, y, spacing)) continue;
      const type = S.types[Math.floor(g.rand() * S.types.length)];
      const o = newObject(type, Math.round(x * 100) / 100, Math.round(y * 100) / 100, {
        rotation: S.randomRotation ? Math.round(g.rand() * 360) : 0,
        scale: Math.round((1 + (g.rand() * 2 - 1) * S.scaleJitter) * 100) / 100,
      });
      m.objects.push(o);
      g.added.add(o.id);
      const k = g.key(x, y);
      if (!g.grid.has(k)) g.grid.set(k, []);
      g.grid.get(k).push(o);
      placed++;
    }
    if (placed) this.app.entitiesChanged(true);
  }

  _tooClose(g, x, y, spacing) {
    const c = g.gcell, gx = (x / c) | 0, gy = (y / c) | 0;
    const reach = Math.ceil(spacing / c);
    for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
      const list = g.grid.get((gx + ox) + ',' + (gy + oy));
      if (!list) continue;
      for (const o of list) if (dist(o.x, o.y, x, y) < spacing) return true;
    }
    return false;
  }

  _scatterEnd() {
    const g = this.gesture, m = this.map;
    clearInterval(g.timer);
    const changes = [];
    for (const [id, r] of g.removed) changes.push({ coll: 'objects', id, index: r.index, before: clone(r.value), after: null });
    for (const o of m.objects) if (g.added.has(o.id)) changes.push({ coll: 'objects', id: o.id, index: -1, before: null, after: clone(o) });
    if (changes.length) this.app.history.push({ label: this.scatter.erase ? `Erase ${g.removed.size} objects` : `Scatter ${g.added.size} objects`, changes });
    this.app.entitiesChanged();
  }

  // ---- place

  _placeObject(wx, wy) {
    const P = this.place;
    [wx, wy] = this.clampWorld(wx, wy);
    const o = newObject(P.type, Math.round(wx * 100) / 100, Math.round(wy * 100) / 100, {
      rotation: P.randomRotation ? Math.round(Math.random() * 360) : 0,
      scale: Math.round((1 + (Math.random() * 2 - 1) * P.scaleJitter) * 100) / 100,
    });
    this.app.history.entities('Place ' + objectType(P.type).name, () => this.map.objects.push(o));
    this.setSelection([{ coll: 'objects', id: o.id }]);
    this.app.entitiesChanged();
  }

  // ---- path / region drafts

  _newDraft() {
    const kind = this.tool === 'region' ? 'region' : 'path';
    this.draft = { kind, type: kind === 'region' ? this.regionType : this.pathType, points: [] };
  }

  _draftTap(sx, sy, touch) {
    const [wx, wy] = this.clampWorld(...this.s2w(sx, sy));
    if (!this.draft) this._newDraft();
    const d = this.draft;
    if (d.points.length) {
      const [fx, fy] = this.w2s(d.points[0][0], d.points[0][1]);
      const [lx, ly] = this.w2s(d.points[d.points.length - 1][0], d.points[d.points.length - 1][1]);
      const tol = touch ? 18 : 10;
      // tap the first point to close, tap the last point again to finish
      if (dist(sx, sy, fx, fy) < tol && d.points.length >= 3) { if (d.kind === 'path') d.closed = true; return this.finishDraft(); }
      if (dist(sx, sy, lx, ly) < tol && d.points.length >= 2) return this.finishDraft();
    }
    d.points.push([wx, wy]);
    this.app.draftChanged();
    this.requestRender();
  }

  undoDraftPoint() {
    if (!this.draft) return;
    this.draft.points.pop();
    if (!this.draft.points.length) this.draft = null;
    this.app.draftChanged();
    this.requestRender();
  }

  cancelDraft() {
    this.draft = null;
    this.app.draftChanged();
    this.requestRender();
  }

  finishDraft() {
    const d = this.draft;
    if (!d) return;
    const min = d.kind === 'region' ? 3 : 2;
    if (d.points.length < min) { this.app.toast(`Need at least ${min} points`); return; }
    const pts = d.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    const item = d.kind === 'region' ? newRegion(d.type, pts) : newPath(d.type, pts);
    if (d.closed) item.closed = true;
    const coll = d.kind === 'region' ? 'regions' : 'paths';
    this.app.history.entities('Add ' + (d.kind === 'region' ? regionType(d.type).name : pathType(d.type).name), () => this.map[coll].push(item));
    this.draft = null;
    this.setSelection([{ coll, id: item.id }]);
    this.app.draftChanged();
    this.app.entitiesChanged();
  }

  // Flatten (and pave) the ground under the selected airport / station / port quay
  levelUnderSelected() {
    const sel = this.selectedItems().find((s) => s.coll === 'objects');
    if (!sel) return;
    const m = this.map, o = sel.item, cs = m.cellSize;
    const decks = objectDecks(o).filter((d) => d.level);
    if (!decks.length) return;
    // build at the ground height under the object, but never below the shore
    const target = Math.max(m.heightAtCell(o.x / cs, o.y / cs), m.seaLevel + 1.2 / m.heightScale);
    const paved = m.palette.find((p) => p.key === 'paved')?.id ?? null;
    const snapshot = { heights: m.heights.slice(), biomes: m.biomes.slice() };
    const rect = levelSegments(m, decks.map((d) => ({ a: [d.a[0] / cs, d.a[1] / cs], b: [d.b[0] / cs, d.b[1] / cs], r: d.w / 2 / cs })), target, paved);
    if (!rect) return;
    const changes = this._clearNature(decks.map((d) => ({ a: d.a, b: d.b, r: d.w / 2 + 1 })));
    this.app.history.push({ label: 'Level ground under ' + objectType(o.type).name, terrain: extractPatch(m, snapshot, rect), changes });
    this.updateBase(rect);
    this.app.terrainChanged(rect, true);
    this.app.entitiesChanged(); // objects sit on the new ground height
    if (changes.length) this.app.toast(`Cleared ${changes.length} trees / rocks from the site`);
  }

  // Removes plants and rocks within world-space segments; returns history changes.
  _clearNature(segs) {
    const m = this.map, changes = [];
    const hit = (o) => segs.some(({ a, b, r }) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let t = l2 ? ((o.x - a[0]) * dx + (o.y - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(o.x - a[0] - t * dx, o.y - a[1] - t * dy) <= r;
    });
    m.objects = m.objects.filter((o, index) => {
      if (objectType(o.type).cat !== 'Nature' || !hit(o)) return true;
      changes.push({ coll: 'objects', id: o.id, index, before: clone(o), after: null });
      return false;
    });
    return changes;
  }

  // Carve the selected road/river into the terrain
  carveSelectedPath() {
    const sel = this.selectedItems().find((s) => s.coll === 'paths');
    if (!sel) return;
    const m = this.map, p = sel.item;
    const snapshot = { heights: m.heights.slice(), biomes: m.biomes.slice() };
    const pts = p.points.map(([x, y]) => [x / m.cellSize, y / m.cellSize]);
    if (p.closed) pts.push(pts[0]);
    const rect = pathType(p.type).guide
      ? shapeAlongPath(m, pts, p.width / m.cellSize, p.type, p.props, (Math.random() * 1e9) | 0)
      : carvePath(m, pts, p.width / m.cellSize, p.type);
    if (!rect) return;
    const pp = p.closed ? [...p.points, p.points[0]] : p.points;
    const changes = p.type === 'railway' || p.type === 'road'
      ? this._clearNature(pp.slice(1).map((b, k) => ({ a: pp[k], b, r: p.width / 2 + 1 })))
      : [];
    this.app.history.push({ label: 'Carve ' + pathType(p.type).name, terrain: extractPatch(m, snapshot, rect), changes });
    if (changes.length) { this.app.entitiesChanged(); this.app.toast(`Cleared ${changes.length} trees / rocks from the route`); }
    this.updateBase(rect);
    this.app.terrainChanged(rect, true);
  }

  // ------------------------------------------------------------ drawing

  // Renders the whole map (terrain + overlays) to a new canvas, e.g. for a minimap image.
  renderImage(maxPx = 4096) {
    const m = this.map;
    const s = Math.min(16, maxPx / Math.max(m.width, m.height));
    const c = document.createElement('canvas');
    c.width = Math.round(m.width * s);
    c.height = Math.round(m.height * s);
    const keys = ['ctx', 'view', 'cssW', 'cssH', 'dpr', 'hover', 'selection', 'draft', 'gesture', 'iconCache'];
    const saved = Object.fromEntries(keys.map((k) => [k, this[k]]));
    Object.assign(this, { ctx: c.getContext('2d'), view: { scale: s, ox: 0, oy: 0 }, cssW: c.width, cssH: c.height, dpr: 1, hover: null, selection: [], draft: null, gesture: null, iconCache: new Map() });
    try { this.render(); } finally { Object.assign(this, saved); }
    return c;
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }

  _icon(def, px) {
    const size = Math.max(8, Math.min(72, Math.round(px / 2) * 2));
    const key = def.type + ':' + size;
    let c = this.iconCache.get(key);
    if (c) return c;
    const dpr = this.dpr || 1;
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr * 1.25);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const mid = size * 0.625;
    if (def.marker || def.cat === 'Gameplay') {
      g.beginPath();
      g.arc(mid, mid, size * 0.55, 0, Math.PI * 2);
      g.fillStyle = 'rgba(15,18,24,0.72)';
      g.fill();
      g.lineWidth = Math.max(1.5, size * 0.07);
      g.strokeStyle = def.color;
      g.stroke();
    }
    g.font = `${Math.round(size * (def.marker || def.cat === 'Gameplay' ? 0.62 : 0.9))}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(def.icon, mid, mid + size * 0.04);
    this.iconCache.set(key, c);
    return c;
  }

  render() {
    const ctx = this.ctx, m = this.map, v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg') || '#15181d';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (!m) return;

    ctx.imageSmoothingEnabled = !this.layers.pixelated && v.scale < 24;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, v.ox, v.oy, m.width * v.scale, m.height * v.scale);
    if (this.layers.walk) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.walkCanvas, v.ox, v.oy, m.width * v.scale, m.height * v.scale);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(v.ox, v.oy, m.width * v.scale, m.height * v.scale);

    if (this.layers.grid) this._drawGrid(ctx);
    if (this.layers.regions) for (const r of m.regions) this._drawRegion(ctx, r);
    if (this.layers.paths) for (const p of m.paths) this._drawPath(ctx, p);
    if (this.layers.objects) this._drawObjects(ctx);
    this._drawSelection(ctx);
    if (this.draft) this._drawDraft(ctx);
    if (this.layers.labels) this._drawLabels(ctx);

    const g = this.gesture;
    if (g?.kind === 'box') {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = 'rgba(120,170,255,0.12)';
      const x = Math.min(g.sx, g.ex), y = Math.min(g.sy, g.ey), w = Math.abs(g.ex - g.sx), h = Math.abs(g.ey - g.sy);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    this._drawBrushCursor(ctx);
  }

  _drawGrid(ctx) {
    const m = this.map, v = this.view;
    // pick a world spacing that is at least ~24px on screen
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const pxPerUnit = v.scale / m.cellSize;
    const step = steps.find((s) => s * pxPerUnit >= 24) || 10000;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= m.worldWidth; x += step) { const [sx] = this.w2s(x, 0); ctx.moveTo(Math.round(sx) + 0.5, v.oy); ctx.lineTo(Math.round(sx) + 0.5, v.oy + m.height * v.scale); }
    for (let y = 0; y <= m.worldHeight; y += step) { const [, sy] = this.w2s(0, y); ctx.moveTo(v.ox, Math.round(sy) + 0.5); ctx.lineTo(v.ox + m.width * v.scale, Math.round(sy) + 0.5); }
    ctx.stroke();
  }

  _tracePoly(ctx, pts, closed) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [sx, sy] = this.w2s(x, y);
      if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
    });
    if (closed) ctx.closePath();
  }

  _drawRegion(ctx, r) {
    if (r.points.length < 2) return;
    const col = r.color || regionType(r.type).color;
    this._tracePoly(ctx, r.points, true);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash(r.type === 'no_build' || r.type === 'danger' ? [8, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _drawPath(ctx, p) {
    if (p.points.length < 2) return;
    const def = pathType(p.type), v = this.view, m = this.map;
    const w = Math.max(def.virtual ? 2 : 1.5, (p.width / m.cellSize) * v.scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this._tracePoly(ctx, p.points, p.closed);
    if (def.guide) {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = def.color;
      ctx.setLineDash([10, 6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (p.type === 'railway') {
      // classic map style: dark line with light dashes
      const rw = Math.max(3, w);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = rw;
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#f2efe8';
      ctx.lineWidth = Math.max(1.2, rw * 0.45);
      ctx.setLineDash([rw * 2, rw * 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (p.type === 'road' || p.type === 'wall') {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = w + 2.5;
      ctx.stroke();
    }
    ctx.strokeStyle = def.color;
    ctx.lineWidth = w;
    if (p.type === 'fence' || p.type === 'route' || p.type === 'cliff_edge') ctx.setLineDash(p.type === 'route' ? [10, 6] : [4, 4]);
    if (p.type === 'fence' || p.type === 'route') ctx.lineWidth = Math.max(2, w);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawObjects(ctx) {
    const m = this.map;
    const pad = 40;
    // footprints of runways, quays, platforms, piers and bridges
    ctx.lineCap = 'butt';
    for (const o of m.objects) {
      if (!objectType(o.type).deck) continue;
      for (const d of objectDecks(o)) {
        const px = (d.w / m.cellSize) * this.view.scale;
        if (px < 1.5) continue;
        const [ax, ay] = this.w2s(d.a[0], d.a[1]), [bx, by] = this.w2s(d.b[0], d.b[1]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = d.level ? 'rgba(80,84,92,0.9)' : 'rgba(139,106,69,0.95)';
        ctx.lineWidth = px;
        ctx.stroke();
      }
    }
    ctx.lineCap = 'round';
    for (const o of m.objects) {
      const [sx, sy] = this.w2s(o.x, o.y);
      if (sx < -pad || sy < -pad || sx > this.cssW + pad || sy > this.cssH + pad) continue;
      const def = objectType(o.type);
      const s = this.objectScreenSize(o, def);
      if (s < 9) {
        ctx.fillStyle = def.color;
        ctx.fillRect(sx - s / 2, sy - s / 2, Math.max(1.5, s), Math.max(1.5, s));
        continue;
      }
      const icon = this._icon(def, s);
      const isz = icon.width / (this.dpr || 1);
      ctx.drawImage(icon, sx - isz / 2, sy - isz / 2, isz, isz);
    }
  }

  _drawLabels(ctx) {
    const m = this.map;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const label = (text, sx, sy, color = '#fff') => {
      if (sx < -100 || sy < -30 || sx > this.cssW + 100 || sy > this.cssH + 30) return;
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = color;
      ctx.fillText(text, sx, sy);
    };
    if (this.layers.regions) for (const r of m.regions) {
      if (!r.name || r.points.length < 3) continue;
      const [cx, cy] = centroid(r.points);
      const [sx, sy] = this.w2s(cx, cy);
      ctx.font = '700 13px system-ui, sans-serif';
      label(r.name, sx, sy - 7, r.color || '#fff');
    }
    ctx.font = '600 12px system-ui, sans-serif';
    if (this.layers.objects) for (const o of m.objects) {
      if (!o.name) continue;
      const [sx, sy] = this.w2s(o.x, o.y);
      label(o.name, sx, sy + this.objectScreenSize(o) / 2 + 2);
    }
    if (this.layers.paths) for (const p of m.paths) {
      if (!p.name || p.points.length < 2) continue;
      const mid = p.points[Math.floor(p.points.length / 2)];
      const [sx, sy] = this.w2s(mid[0], mid[1]);
      label(p.name, sx, sy + 6, '#e8f0ff');
    }
  }

  _drawSelection(ctx) {
    const sel = this.selectedItems();
    for (const s of sel) {
      if (s.coll === 'objects') {
        const [sx, sy] = this.w2s(s.item.x, s.item.y);
        const r = this.objectScreenSize(s.item) / 2 + 5;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        // facing direction
        const a = (s.item.rotation || 0) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(sx + Math.sin(a) * r, sy - Math.cos(a) * r);
        ctx.lineTo(sx + Math.sin(a) * (r + 8), sy - Math.cos(a) * (r + 8));
        ctx.stroke();
        continue;
      }
      const pts = s.item.points;
      const closed = s.coll === 'regions' || s.item.closed;
      this._tracePoly(ctx, pts, closed);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (sel.length !== 1) continue;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const [mx, my] = this.w2s((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        ctx.beginPath();
        ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fill();
      }
      pts.forEach(([x, y], i) => {
        const [sx, sy] = this.w2s(x, y);
        ctx.beginPath();
        ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#ffd166' : '#fff';
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
  }

  _drawDraft(ctx) {
    const d = this.draft;
    if (!d.points.length) return;
    const col = d.kind === 'region' ? regionType(d.type).color : pathType(d.type).color;
    this._tracePoly(ctx, d.points, false);
    if (this.hover && this.gesture?.kind !== 'freehand') {
      ctx.lineTo(this.hover.x, this.hover.y);
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    d.points.forEach(([x, y], i) => {
      const [sx, sy] = this.w2s(x, y);
      ctx.beginPath();
      ctx.arc(sx, sy, i === 0 ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#ffd166' : col;
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  _drawBrushCursor(ctx) {
    const p = this.gesture?.kind === 'stroke' || this.gesture?.kind === 'scatter'
      ? [...this.pointers.values()].find(() => true) : this.hover;
    if (!p) return;
    let r = 0;
    if (this.tool === 'sculpt' || this.tool === 'paint') r = (this.brush.size / 2) * this.view.scale;
    else if (this.tool === 'scatter') r = (this.scatter.size / 2) * this.view.scale;
    else return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, r), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = this.tool === 'scatter' && this.scatter.erase ? '#ff6b6b' : '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (this.tool !== 'scatter' && this.brush.falloff > 0.05) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, r * (1 - this.brush.falloff)), 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

export { OBJECT_TYPES };
