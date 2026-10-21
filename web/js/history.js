// Undo / redo. Each entry can hold a terrain patch (rect of before/after
// heights and biomes), entity changes and map-setting changes.

const LIMIT = 80;

export function extractPatch(map, before, rect) {
  const { x0, y0, x1, y1 } = rect;
  const w = x1 - x0 + 1, hgt = y1 - y0 + 1, W = map.width;
  const p = {
    x0, y0, w, h: hgt,
    hBefore: new Float32Array(w * hgt), hAfter: new Float32Array(w * hgt),
    bBefore: new Uint8Array(w * hgt), bAfter: new Uint8Array(w * hgt),
  };
  for (let y = 0; y < hgt; y++) {
    const src = (y0 + y) * W + x0;
    p.hBefore.set(before.heights.subarray(src, src + w), y * w);
    p.hAfter.set(map.heights.subarray(src, src + w), y * w);
    p.bBefore.set(before.biomes.subarray(src, src + w), y * w);
    p.bAfter.set(map.biomes.subarray(src, src + w), y * w);
  }
  return p;
}

function applyPatch(map, p, which) {
  const H = which === 'before' ? p.hBefore : p.hAfter;
  const Bi = which === 'before' ? p.bBefore : p.bAfter;
  for (let y = 0; y < p.h; y++) {
    const dst = (p.y0 + y) * map.width + p.x0;
    map.heights.set(H.subarray(y * p.w, (y + 1) * p.w), dst);
    map.biomes.set(Bi.subarray(y * p.w, (y + 1) * p.w), dst);
  }
  return { x0: p.x0, y0: p.y0, x1: p.x0 + p.w - 1, y1: p.y0 + p.h - 1 };
}

const clone = (v) => (v == null ? v : structuredClone(v));

export class History {
  constructor(app) {
    this.app = app;
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() { this.undoStack = []; this.redoStack = []; this.app.onHistoryChange?.(); }

  push(entry) {
    if (!entry.terrain && !entry.changes?.length && !entry.settings) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.app.onHistoryChange?.();
  }

  // records entity changes made by fn(). fn receives a `track(coll, id)`
  // helper that must be called before mutating/removing an existing entity;
  // added entities are discovered automatically.
  entities(label, fn) {
    const map = this.app.map;
    const before = new Map();
    const track = (coll, id) => {
      const key = coll + ':' + id;
      if (before.has(key)) return;
      const idx = map[coll].findIndex((e) => e.id === id);
      before.set(key, { coll, id, index: idx, value: idx >= 0 ? clone(map[coll][idx]) : null });
    };
    const ids = { objects: new Set(map.objects.map((e) => e.id)), paths: new Set(map.paths.map((e) => e.id)), regions: new Set(map.regions.map((e) => e.id)) };
    const result = fn(track);
    const changes = [];
    for (const b of before.values()) {
      const idx = map[b.coll].findIndex((e) => e.id === b.id);
      const after = idx >= 0 ? clone(map[b.coll][idx]) : null;
      if (JSON.stringify(after) !== JSON.stringify(b.value)) changes.push({ coll: b.coll, id: b.id, index: b.index, before: b.value, after });
    }
    for (const coll of ['objects', 'paths', 'regions']) {
      map[coll].forEach((e, index) => {
        if (!ids[coll].has(e.id) && !before.has(coll + ':' + e.id)) changes.push({ coll, id: e.id, index, before: null, after: clone(e) });
      });
    }
    this.push({ label, changes });
    return result;
  }

  _applyChanges(changes, which) {
    const map = this.app.map;
    const list = which === 'before' ? [...changes].reverse() : changes;
    for (const c of list) {
      const value = c[which];
      const arr = map[c.coll];
      const idx = arr.findIndex((e) => e.id === c.id);
      if (value == null) { if (idx >= 0) arr.splice(idx, 1); }
      else if (idx >= 0) arr[idx] = clone(value);
      else arr.splice(Math.min(c.index >= 0 ? c.index : arr.length, arr.length), 0, clone(value));
    }
  }

  _apply(entry, which) {
    const map = this.app.map;
    let rect = null;
    if (entry.settings) Object.assign(map, clone(entry.settings[which]));
    if (entry.terrain) rect = applyPatch(map, entry.terrain, which);
    if (entry.changes) this._applyChanges(entry.changes, which);
    this.app.afterHistoryApply(rect, entry);
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this._apply(e, 'before');
    this.redoStack.push(e);
    this.app.onHistoryChange?.();
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this._apply(e, 'after');
    this.undoStack.push(e);
    this.app.onHistoryChange?.();
    return e.label;
  }
}
