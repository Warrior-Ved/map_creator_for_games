// Application shell: wires the editor, 3D view, panels, dialogs and storage.

import { WorldMap, OBJECT_TYPES, PATH_TYPES, REGION_TYPES, MAP_KINDS, objectType, pathType, regionType, slugify } from './model.js';
import { Editor2D } from './editor2d.js';
import { View3D } from './view3d.js';
import { History, extractPatch } from './history.js';
import { GEN_DEFAULTS, generateHeights, autoBiomes, hydraulicErosion, thermalErosion, smoothAll, shadeRegion } from './terrain.js';
import { autoDecorate } from './decorate.js';
import { api, saveDraft, loadDraft, clearDraft, downloadBlob } from './api.js';
import { computeWalkGrid, NAV_LEGEND, walkStats } from './navigation.js';
import { NAV_DEFAULTS } from './model.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const clone = (v) => structuredClone(v);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

function loadPref(key, def) {
  try { const v = localStorage.getItem('mc:' + key); return v ? { ...def, ...JSON.parse(v) } : def; } catch { return def; }
}
function savePref(key, v) { try { localStorage.setItem('mc:' + key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

// ------------------------------------------------------------ app state

const app = {
  map: null,
  serverId: null, // id this map was loaded from / saved as on the PC
  dirty: false,
  draftDirty: false,
  lastSaved: 0,
  mapList: [],
  info: null,
  prefs: loadPref('prefs', { autoSaveServer: true, viewMode: '2d' }),

  terrainChanged(rect, final) { view3d.terrainChanged(); markDirty(); if (final) editor.updateWalkOverlay(); },
  entitiesChanged(live) {
    view3d.entitiesChanged();
    editor.requestRender();
    markDirty();
    if (!live) { renderProps(); updateCounts(); editor.updateWalkOverlay(); }
  },
  selectionChanged() { renderProps(); },
  onCursor(c) {
    $('#stCursor').textContent = c
      ? `x ${c.wx.toFixed(1)}  y ${c.wy.toFixed(1)}  ·  height ${c.y.toFixed(1)}${c.water ? ' (under water)' : ''}  ·  ${c.biome}`
      : '—';
    $('#stZoom').textContent = `zoom ${Math.round(editor.view.scale * 100)}%`;
  },
  draftChanged() {
    const d = editor.draft;
    $('#draftBar').classList.toggle('hidden', !d);
    if (d) $('#draftInfo').textContent = `${d.kind === 'region' ? regionType(d.type).name : pathType(d.type).name}: ${d.points.length} pts`;
    editor.requestRender();
  },
  toast,
  stylusDetected() {
    toast('Stylus detected: pen draws, fingers pan & zoom (change in Layers & display)');
    renderLayers();
  },
  onHistoryChange() {
    $('#btnUndo').disabled = !history.undoStack.length;
    $('#btnRedo').disabled = !history.redoStack.length;
    $('#btnUndo').title = history.undoStack.length ? `Undo ${history.undoStack.at(-1).label} (Ctrl+Z)` : 'Undo';
    $('#btnRedo').title = history.redoStack.length ? `Redo ${history.redoStack.at(-1).label} (Ctrl+Y)` : 'Redo';
  },
  walkChanged(on) {
    document.body.classList.toggle('walking', on);
    if (!on) toast('Left walk mode');
  },
  afterHistoryApply(rect, entry) {
    if (entry.settings) { editor.updateBase(); view3d.rebuild(); updateTitle(); }
    else if (rect) { editor.updateBase(rect); view3d.terrainChanged(); }
    editor.selection = editor.selection.filter((s) => app.map[s.coll].some((e) => e.id === s.id));
    app.entitiesChanged();
  },
};

const editor = new Editor2D($('#canvas2d'), app);
const view3d = new View3D($('#view3d'), app);
const history = new History(app);
app.history = history;
app.editor = editor;
Object.assign(editor.brush, loadPref('brush', {}));
Object.assign(editor.scatter, loadPref('scatter', {}));

// ------------------------------------------------------------ helpers

function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}

function busy(text) {
  $('#busyText').textContent = text;
  $('#busy').classList.remove('hidden');
  return new Promise((r) => setTimeout(r, 40)); // let the overlay paint
}
const unbusy = () => $('#busy').classList.add('hidden');

function markDirty() {
  if (!app.dirty) { app.dirty = true; document.body.classList.add('dirty'); updateSaveStatus(); }
  app.draftDirty = true;
}

function markClean() {
  app.dirty = false;
  app.draftDirty = false;
  document.body.classList.remove('dirty');
  updateSaveStatus();
}

function updateSaveStatus() {
  const s = $('#stSave');
  if (app.dirty) s.textContent = app.serverId ? 'Unsaved changes' : 'Not saved to PC yet';
  else if (app.lastSaved) s.textContent = 'Saved ' + new Date(app.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  else s.textContent = app.serverId ? 'Saved' : '';
}

function updateTitle() {
  $('#mapTitle').textContent = app.map.meta.name || 'Untitled';
  document.title = `${app.map.meta.name} — Map Creator`;
}

function updateCounts() {
  const m = app.map;
  $('#stCounts').textContent = `${m.width}×${m.height} · ${m.worldWidth}×${m.worldHeight} units · ${m.objects.length} objects · ${m.paths.length} paths · ${m.regions.length} regions`;
}

function slider(label, obj, key, min, max, step, fmt = (v) => v, onInput) {
  const out = h('output', {}, fmt(obj[key]));
  const inp = h('input', {
    type: 'range', min, max, step, value: obj[key],
    oninput: () => { obj[key] = parseFloat(inp.value); out.textContent = fmt(obj[key]); onInput?.(obj[key]); },
  });
  return h('div', { class: 'row' }, h('label', {}, label), inp, out);
}

function check(label, obj, key, onChange) {
  const inp = h('input', { type: 'checkbox', checked: !!obj[key], onchange: () => { obj[key] = inp.checked; onChange?.(inp.checked); } });
  return h('label', { class: 'check' }, inp, label);
}

function field(label, input) { return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'grow' }, input)); }

function parseValue(s) {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) { try { return JSON.parse(t); } catch { /* keep string */ } }
  return s;
}
const showValue = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));

// key/value editor for custom properties; onCommit(newProps)
function propsEditor(props, onCommit, datalists = {}) {
  const wrap = h('div');
  const rows = h('div');
  const collect = () => {
    const out = {};
    for (const r of rows.children) {
      const k = r.children[0].value.trim();
      if (k) out[k] = parseValue(r.children[1].value);
    }
    return out;
  };
  const addRow = (k = '', v = '') => {
    const list = datalists[k];
    const vi = h('input', { type: 'text', value: showValue(v), placeholder: 'value', list: list || null, onchange: () => onCommit(collect()) });
    const row = h('div', { class: 'kv' },
      h('input', { type: 'text', value: k, placeholder: 'key', onchange: () => onCommit(collect()) }),
      vi,
      h('button', { title: 'Remove', onclick: () => { row.remove(); onCommit(collect()); } }, '✕'));
    rows.append(row);
    return row;
  };
  for (const [k, v] of Object.entries(props || {})) addRow(k, v);
  wrap.append(rows, h('button', { onclick: () => addRow().children[0].focus(), style: 'margin-top:4px' }, '+ Add property'));
  return wrap;
}

// ------------------------------------------------------------ tool pane

const SCULPT_MODES = [['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten'], ['set', 'Set height'], ['noise', 'Roughen'], ['terrace', 'Terrace']];
const COAST_MODES = [['land', '🏝️ Land'], ['water', '🌊 Water'], ['beach', '🏖️ Beach']];
const STAMP_MODES = [['island', '🏝️ Island'], ['mountain', '🏔️ Mountain'], ['hill', '⛰️ Hill'], ['plateau', '🪨 Plateau'], ['crater', '🕳️ Crater'],
  ['volcano', '🌋 Volcano'], ['desert', '🏜️ Desert'], ['dunes', '〰️ Sand dunes'], ['beach_stamp', '🏖️ Beach']];
const COAST_HINTS = {
  land: 'Paint land out of the sea. Coastlines come out naturally ragged; the shore turns to beach and the inside to grass. Use a big brush (40–120) for continents.',
  water: 'Sink ground below the sea: bays, lakes, channels and inland seas. Shallow and deep water are coloured automatically.',
  beach: 'Drag along a coastline to make a sandy beach just above the water line.',
};
const STAMP_HINTS = {
  island: 'Tap in the sea to raise a whole island with beaches, hills and forest patches. Size 60–200 for big islands.',
  desert: 'Tap to make a flat sandy desert with gentle ripples. Works on land or in the sea.',
  dunes: 'Tap to make tall wind-blown sand dunes. Each tap picks a new wind direction.',
  beach_stamp: 'Tap on a shoreline to make a wide sandy beach sloping into shallow water.',
};
const TOOL_HINTS = {
  select: 'Tap an item to select it, drag to move. Drag on empty ground to box-select objects. Drag the white handles to reshape paths & regions, drag the small dots to add points, double-tap a point to remove it.',
  pan: 'Drag to move around. Pinch or mouse-wheel to zoom. Two fingers always pan & zoom in every tool.',
  sculpt: 'Drag to sculpt. Hold still to keep raising / lowering. Pen pressure controls strength.',
  paint: 'Drag to paint the biome (ground type). Soft edges dither into neighbouring biomes.',
  place: 'Tap the map to place the chosen object. Switch to Select to move or edit it.',
  scatter: 'Drag to scatter many objects at once (forests, rocks…). Hold still to fill in. Turn on Erase to remove.',
  path: 'Tap to add points, or drag to draw freehand. Tap the last point (or Finish) to end; tap the first point to close a loop. Draw a Mountain Range or Rift line, then press its Apply button to shape the terrain.',
  region: 'Tap to add corners or drag to draw an outline. Tap the first point (or Finish) to close the region.',
};

function setTool(t) {
  if (editor.draft && t !== editor.tool) editor.cancelDraft();
  editor.tool = t;
  $$('#toolbar button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  editor.canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  renderToolPane();
  editor.requestRender();
}

function terrainOp(label, fn) {
  const m = app.map;
  const snapshot = { heights: m.heights.slice(), biomes: m.biomes.slice() };
  fn(m);
  const rect = { x0: 0, y0: 0, x1: m.width - 1, y1: m.height - 1 };
  history.push({ label, terrain: extractPatch(m, snapshot, rect) });
  editor.updateBase();
  app.terrainChanged(rect, true);
}

async function runTerrainOp(label, fn) {
  await busy(label + '…');
  try { terrainOp(label, fn); } finally { unbusy(); }
}

async function decorateOp(opts) {
  await busy('Placing trees & rocks…');
  try {
    history.entities('Auto-decorate', (track) => {
      for (const o of app.map.objects) track('objects', o.id);
      const n = autoDecorate(app.map, opts);
      toast(`Placed ${n} objects`);
    });
    editor.setSelection([]);
    app.entitiesChanged();
  } finally { unbusy(); }
}

function renderToolPane() {
  const pane = $('#toolPane');
  pane.replaceChildren();
  const t = editor.tool, B = editor.brush, S = editor.scatter;
  const title = { select: 'Select', pan: 'Pan & zoom', sculpt: 'Sculpt terrain', paint: 'Paint biomes', place: 'Place objects', scatter: 'Scatter objects', path: 'Roads, rivers & walls', region: 'Regions & zones' }[t];
  pane.append(h('h3', {}, title), h('p', { class: 'hint' }, TOOL_HINTS[t]));
  const saveBrush = () => savePref('brush', B);

  if (t === 'sculpt' || t === 'paint') {
    if (t === 'sculpt') {
      const modeBtn = ([k, n]) => h('button', { class: B.mode === k ? 'on' : '', onclick: () => { B.mode = k; saveBrush(); renderToolPane(); } }, n);
      pane.append(h('h4', { style: 'margin-top:0' }, 'Land & water (drag)'), h('div', { class: 'chips' }, COAST_MODES.map(modeBtn)),
        h('h4', {}, 'Brushes (drag)'), h('div', { class: 'chips' }, SCULPT_MODES.map(modeBtn)),
        h('h4', {}, 'Landforms (tap to stamp)'), h('div', { class: 'chips' }, STAMP_MODES.map(modeBtn)));
      if (COAST_HINTS[B.mode]) pane.append(h('p', { class: 'hint' }, COAST_HINTS[B.mode]));
      else if (STAMP_MODES.some(([k]) => k === B.mode)) pane.append(h('p', { class: 'hint' }, STAMP_HINTS[B.mode] || 'Tap the map to drop the landform. Brush size = its width, strength = its height. Big sizes (80–200) make proper mountains.'));
    } else {
      pane.append(h('div', { class: 'swatches' }, app.map.palette.map((p) =>
        h('button', { class: B.biome === p.id ? 'on' : '', onclick: () => { B.biome = p.id; saveBrush(); renderToolPane(); } },
          h('span', { class: 'swatch', style: `background:${p.color}` }), p.name))));
    }
    pane.append(
      slider('Brush size', B, 'size', 1, 200, 1, (v) => v, saveBrush),
      slider(t === 'paint' ? 'Density' : 'Strength', B, 'strength', 0.02, 1, 0.01, (v) => v.toFixed(2), saveBrush),
      slider('Soft edge', B, 'falloff', 0, 1, 0.01, (v) => v.toFixed(2), saveBrush),
    );
    if (t === 'sculpt' && B.mode === 'terrace') pane.append(slider('Step height', B, 'terraceStep', 1, 30, 0.5, (v) => v + ' u', saveBrush));
    if (t === 'sculpt' && B.mode === 'land') pane.append(slider('Land height', B, 'landHeight', 1, 40, 0.5, (v) => v + ' u', saveBrush));
    if (t === 'sculpt' && B.mode === 'water') pane.append(slider('Water depth', B, 'waterDepth', 1, 40, 0.5, (v) => v + ' u', saveBrush));
    if (t === 'sculpt' && B.mode === 'set') {
      const m = app.map;
      pane.append(slider('Target height', B, 'targetHeight', 0, 1, 0.001, (v) => (v * m.heightScale).toFixed(1)),
        h('div', { class: 'btnrow' },
          h('button', { onclick: () => { B.targetHeight = m.seaLevel; renderToolPane(); } }, 'Sea level'),
          h('button', { onclick: () => { B.targetHeight = Math.min(1, m.seaLevel + 2 / m.heightScale); renderToolPane(); } }, 'Shore +2')));
    }
    pane.append(h('h4', {}, 'Whole map'));
    if (t === 'sculpt') {
      pane.append(h('div', { class: 'btnrow' },
        h('button', { onclick: () => runTerrainOp('Smooth map', (m) => smoothAll(m, 2)) }, 'Smooth all'),
        h('button', { onclick: () => runTerrainOp('Hydraulic erosion', (m) => hydraulicErosion(m, Math.round(m.width * m.height * 0.4), (Math.random() * 1e6) | 0)) }, 'Rain erosion'),
        h('button', { onclick: () => runTerrainOp('Thermal erosion', (m) => thermalErosion(m, 8, 0.6)) }, 'Thermal erosion'),
      ));
    }
    pane.append(h('div', { class: 'btnrow' },
      h('button', { onclick: () => runTerrainOp('Auto-paint biomes', (m) => autoBiomes(m, { seed: m.meta.seed || 1 })) }, 'Auto-paint biomes from terrain'),
      h('button', { onclick: () => decorateOp({ density: 0.5, seed: (Math.random() * 1e6) | 0 }) }, 'Auto-place trees & rocks'),
    ));
  }

  if (t === 'place') {
    const P = editor.place;
    let cat = '';
    for (const def of OBJECT_TYPES) {
      if (def.cat !== cat) { cat = def.cat; pane.append(h('h4', {}, cat), h('div', { class: 'catalog', 'data-cat': cat })); }
      pane.lastChild.append(h('button', { class: P.type === def.type ? 'on' : '', title: def.name, onclick: () => { P.type = def.type; renderToolPane(); } },
        h('span', { class: 'emo' }, def.icon), h('span', {}, def.name)));
    }
    pane.append(h('h4', {}, 'Options'), check('Random rotation', P, 'randomRotation'), slider('Size variation', P, 'scaleJitter', 0, 0.6, 0.01, (v) => '±' + Math.round(v * 100) + '%'));
  }

  if (t === 'scatter') {
    const saveS = () => savePref('scatter', S);
    pane.append(
      h('div', { class: 'btnrow' },
        h('button', { class: !S.erase ? 'on' : '', onclick: () => { S.erase = false; saveS(); renderToolPane(); } }, 'Scatter'),
        h('button', { class: S.erase ? 'on' : '', onclick: () => { S.erase = true; saveS(); renderToolPane(); } }, 'Erase')),
      slider('Brush size', S, 'size', 2, 200, 1, (v) => v, saveS),
    );
    if (!S.erase) {
      pane.append(
        slider('Density', S, 'density', 0.02, 1, 0.01, (v) => v.toFixed(2), saveS),
        slider('Min spacing', S, 'minSpacing', 0.5, 40, 0.5, (v) => v + ' u', saveS),
        slider('Max slope', S, 'maxSlope', 0.1, 5, 0.1, (v) => v >= 5 ? 'any' : v.toFixed(1), saveS),
        check('Avoid water', S, 'avoidWater', saveS),
        check('Random rotation', S, 'randomRotation', saveS),
        slider('Size variation', S, 'scaleJitter', 0, 0.6, 0.01, (v) => '±' + Math.round(v * 100) + '%', saveS),
      );
    } else {
      pane.append(check('Erase every type (ignore selection below)', S, 'eraseAll', saveS));
    }
    pane.append(h('h4', {}, S.erase ? 'Types to erase' : 'Objects to scatter (pick several)'));
    const grid = h('div', { class: 'catalog' });
    for (const def of OBJECT_TYPES.filter((d) => d.cat === 'Nature' || d.cat === 'Structures')) {
      const on = S.types.includes(def.type);
      grid.append(h('button', {
        class: on ? 'on' : '', title: def.name,
        onclick: () => { S.types = on ? S.types.filter((x) => x !== def.type) : [...S.types, def.type]; saveS(); renderToolPane(); },
      }, h('span', { class: 'emo' }, def.icon), h('span', {}, def.name)));
    }
    pane.append(grid);
  }

  if (t === 'path' || t === 'region') {
    const types = t === 'path' ? PATH_TYPES : REGION_TYPES;
    const cur = t === 'path' ? editor.pathType : editor.regionType;
    pane.append(h('div', { class: 'swatches' }, types.map((d) => h('button', {
      class: cur === d.type ? 'on' : '',
      onclick: () => {
        if (t === 'path') editor.pathType = d.type; else editor.regionType = d.type;
        if (editor.draft) { editor.draft.type = d.type; app.draftChanged(); }
        renderToolPane();
      },
    }, h('span', { class: 'swatch', style: `background:${d.color}` }), d.name))));
    if (t === 'path') pane.append(h('p', { class: 'hint' }, 'Tip: select a road or river and use ', h('b', {}, 'Carve into terrain'), ' to flatten the road bed or dig the river channel.'));
  }

  if (t === 'select') {
    pane.append(h('div', { class: 'btnrow' },
      h('button', { onclick: () => editor.duplicateSelection() }, 'Duplicate (Ctrl+D)'),
      h('button', { class: 'danger', onclick: () => editor.deleteSelection() }, 'Delete (Del)')));
  }
}

// ------------------------------------------------------------ properties pane

function commitEntity(sel, label, mutate) {
  history.entities(label, (track) => { track(sel.coll, sel.id); mutate(sel.item); });
  app.entitiesChanged();
}

// a range slider that previews live and records one undo step on release
function liveSlider(label, sel, key, min, max, step, fmt) {
  let before = null;
  const out = h('output', {}, fmt(sel.item[key] ?? 0));
  const inp = h('input', {
    type: 'range', min, max, step, value: sel.item[key] ?? 0,
    oninput: () => {
      if (!before) before = clone(sel.item);
      sel.item[key] = parseFloat(inp.value);
      out.textContent = fmt(sel.item[key]);
      app.entitiesChanged(true);
    },
    onchange: () => {
      if (!before) return;
      const idx = app.map[sel.coll].indexOf(sel.item);
      history.push({ label: 'Change ' + key, changes: [{ coll: sel.coll, id: sel.id, index: idx, before, after: clone(sel.item) }] });
      before = null;
      app.entitiesChanged();
    },
  });
  return h('div', { class: 'row' }, h('label', {}, label), inp, out);
}

function numberField(label, sel, key, step = 0.1) {
  const inp = h('input', { type: 'number', step, value: Math.round((sel.item[key] ?? 0) * 100) / 100, onchange: () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) commitEntity(sel, 'Change ' + key, (it) => { it[key] = v; });
  } });
  return field(label, inp);
}

function textField(label, sel, key, placeholder = '') {
  const inp = h('input', { type: 'text', value: sel.item[key] ?? '', placeholder, onchange: () => commitEntity(sel, 'Rename', (it) => { it[key] = inp.value; }) });
  return field(label, inp);
}

function mapIdDatalist() {
  let dl = $('#dlMaps');
  if (!dl) { dl = h('datalist', { id: 'dlMaps' }); document.body.append(dl); }
  dl.replaceChildren(...app.mapList.filter((m) => m.id !== app.map.meta.id).map((m) => h('option', { value: m.id }, m.name)));
  return 'dlMaps';
}

function renderProps() {
  const pane = $('#propsPane');
  pane.replaceChildren();
  const m = app.map;
  const sel = editor.selectedItems();
  if (!sel.length) {
    pane.append(h('h3', {}, 'Map'),
      h('dl', { class: 'stat' },
        h('dt', {}, 'Name'), h('dd', {}, m.meta.name),
        h('dt', {}, 'Type'), h('dd', {}, (MAP_KINDS.find((k) => k[0] === m.meta.kind) || ['', m.meta.kind])[1]),
        h('dt', {}, 'Terrain'), h('dd', {}, `${m.width} × ${m.height} samples`),
        h('dt', {}, 'World size'), h('dd', {}, `${m.worldWidth} × ${m.worldHeight} units`),
        h('dt', {}, 'Objects'), h('dd', {}, m.objects.length),
        h('dt', {}, 'Paths / regions'), h('dd', {}, `${m.paths.length} / ${m.regions.length}`)),
      h('div', { class: 'btnrow' }, h('button', { onclick: settingsDialog }, 'Map settings…')));
    return;
  }
  if (sel.length > 1) {
    const objs = sel.filter((s) => s.coll === 'objects');
    pane.append(h('h3', {}, `${sel.length} items selected`));
    if (objs.length === sel.length) {
      const typeSel = h('select', { onchange: () => {
        history.entities('Change type', (track) => { for (const s of objs) { track('objects', s.id); s.item.type = typeSel.value; } });
        app.entitiesChanged();
      } }, h('option', { value: '' }, 'Change type of all…'), OBJECT_TYPES.map((d) => h('option', { value: d.type }, `${d.icon} ${d.name}`)));
      pane.append(field('Type', typeSel));
    }
    pane.append(h('div', { class: 'btnrow' },
      h('button', { onclick: () => editor.duplicateSelection() }, 'Duplicate'),
      h('button', { class: 'danger', onclick: () => editor.deleteSelection() }, 'Delete all'),
      h('button', { onclick: () => editor.setSelection([]) }, 'Deselect')));
    return;
  }
  const s = sel[0], it = s.item;
  const focusBtn = h('button', { onclick: () => focus3D(s) }, 'Show in 3D');
  const actions = h('div', { class: 'btnrow' }, focusBtn,
    h('button', { onclick: () => editor.duplicateSelection() }, 'Duplicate'),
    h('button', { class: 'danger', onclick: () => editor.deleteSelection() }, 'Delete'));

  if (s.coll === 'objects') {
    const def = objectType(it.type);
    const typeSel = h('select', { onchange: () => commitEntity(s, 'Change type', (o) => {
      o.type = typeSel.value;
      // bring in the default gameplay fields of the new type without losing existing ones
      o.props = { ...(objectType(o.type).props || {}), ...(o.props || {}) };
    }) }, OBJECT_TYPES.map((d) => h('option', { value: d.type, selected: d.type === it.type }, `${d.icon} ${d.name}`)));
    pane.append(h('h3', {}, h('span', { style: 'font-size:20px' }, def.icon), def.name),
      field('Type', typeSel),
      textField('Name', s, 'name', 'optional label'),
      h('div', { class: 'grid2', style: 'gap:0 8px' }, numberField('X', s, 'x', 0.5), numberField('Y', s, 'y', 0.5)),
      liveSlider('Rotation', s, 'rotation', 0, 359, 1, (v) => Math.round(v) + '°'),
      liveSlider('Scale', s, 'scale', 0.2, 4, 0.05, (v) => (+v).toFixed(2)),
      numberField('Elevation', s, 'elevation', 0.5),
      h('p', { class: 'hint' }, `Ground height here: ${m.groundY(it.x, it.y).toFixed(2)} units. ID: ${it.id}`),
      ...(def.deck?.some((d) => d.level) ? [h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => editor.levelUnderSelected() }, 'Level the ground here')),
        h('p', { class: 'hint' }, 'Flattens and paves the ground under the ' + (it.type === 'airport' ? 'runway and apron' : it.type === 'port' ? 'quay (the pier reaches out over the water to the north; rotate to face the sea)' : 'platform and building') + '. Use Rotation to line it up first.')] : []),
      h('h4', {}, 'Game properties'),
      propsEditor(it.props, (p) => commitEntity(s, 'Edit properties', (o) => { o.props = p; }), { targetMap: mapIdDatalist() }),
      actions);
    return;
  }

  if (s.coll === 'paths') {
    const def = pathType(it.type);
    const typeSel = h('select', { onchange: () => commitEntity(s, 'Change type', (p) => { p.type = typeSel.value; p.width = pathType(p.type).width; }) },
      PATH_TYPES.map((d) => h('option', { value: d.type, selected: d.type === it.type }, d.name)));
    const len = it.points.reduce((acc, p, i) => i ? acc + Math.hypot(p[0] - it.points[i - 1][0], p[1] - it.points[i - 1][1]) : 0, 0);
    pane.append(h('h3', {}, h('span', { class: 'swatch', style: `background:${def.color}` }), def.name),
      field('Type', typeSel),
      textField('Name', s, 'name', 'e.g. King\'s Road'),
      liveSlider('Width', s, 'width', 0.2, 40, 0.1, (v) => (+v).toFixed(1)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!it.closed, onchange: (e) => commitEntity(s, 'Toggle loop', (p) => { p.closed = e.target.checked; }) }), 'Closed loop'),
      h('p', { class: 'hint' }, `${it.points.length} points · length ${len.toFixed(1)} units`),
      h('div', { class: 'btnrow' },
        !def.virtual && h('button', { class: def.guide ? 'primary' : '', onclick: () => editor.carveSelectedPath() },
          { ridge: 'Apply: raise mountain range', rift: 'Apply: carve rift', river: 'Carve river bed', stream: 'Carve river bed', railway: 'Level the track bed' }[it.type] || 'Carve into terrain'),
        h('button', { onclick: () => commitEntity(s, 'Reverse path', (p) => p.points.reverse()) }, 'Reverse')),
      h('h4', {}, 'Game properties'),
      propsEditor(it.props, (p) => commitEntity(s, 'Edit properties', (o) => { o.props = p; })),
      actions);
    return;
  }

  // region
  const typeSel = h('select', { onchange: () => commitEntity(s, 'Change type', (r) => {
    const d = regionType(typeSel.value);
    r.type = d.type;
    r.color = d.color;
    r.props = { ...(d.props || {}), ...(r.props || {}) };
  }) }, REGION_TYPES.map((d) => h('option', { value: d.type, selected: d.type === it.type }, d.name)));
  const color = h('input', { type: 'color', value: it.color || regionType(it.type).color, onchange: () => commitEntity(s, 'Region colour', (r) => { r.color = color.value; }) });
  let area = 0;
  for (let i = 0, j = it.points.length - 1; i < it.points.length; j = i++) area += (it.points[j][0] + it.points[i][0]) * (it.points[j][1] - it.points[i][1]);
  pane.append(h('h3', {}, h('span', { class: 'swatch', style: `background:${it.color}` }), regionType(it.type).name),
    field('Type', typeSel),
    textField('Name', s, 'name'),
    field('Colour', color),
    h('p', { class: 'hint' }, `${it.points.length} corners · area ${Math.abs(area / 2).toFixed(0)} sq units`),
    h('h4', {}, 'Game properties'),
    propsEditor(it.props, (p) => commitEntity(s, 'Edit properties', (o) => { o.props = p; })),
    actions);
}

function focus3D(s) {
  const it = s.item;
  const [x, y] = s.coll === 'objects' ? [it.x, it.y] : it.points.reduce((a, p) => [a[0] + p[0] / it.points.length, a[1] + p[1] / it.points.length], [0, 0]);
  if (app.prefs.viewMode === '2d') setViewMode('split');
  setTimeout(() => view3d.focusOn(x, y), 60);
}

// ------------------------------------------------------------ layers pane

function renderLayers() {
  const body = $('#layersBody');
  body.replaceChildren();
  const L = editor.layers;
  const redrawBase = () => editor.updateBase();
  body.append(
    h('h4', { style: 'margin-top:0' }, '2D map'),
    check('Hill shading', L, 'hillshade', redrawBase),
    check('Water tint', L, 'water', redrawBase),
    check('Height view (grayscale)', L, 'heightTint', redrawBase),
    check('Contour lines', L, 'contours', redrawBase),
    slider('Contour step', editor, 'contourInterval', 1, 100, 1, (v) => v + ' u', () => L.contours && redrawBase()),
    check('Walkable areas', L, 'walk', (on) => { if (on) editor.updateWalkOverlay(true); renderLayers(); editor.requestRender(); }),
    ...(L.walk ? [walkLegend()] : []),
    check('Grid', L, 'grid', () => editor.requestRender()),
    check('Objects', L, 'objects', () => editor.requestRender()),
    check('Paths', L, 'paths', () => editor.requestRender()),
    check('Regions', L, 'regions', () => editor.requestRender()),
    check('Labels', L, 'labels', () => editor.requestRender()),
    check('Pixelated terrain', L, 'pixelated', () => editor.requestRender()),
    h('h4', {}, 'Input'),
    check('Stylus mode (pen draws, fingers pan)', editor, 'stylusMode'),
    check('Auto-save to PC every 2 minutes', app.prefs, 'autoSaveServer', () => savePref('prefs', app.prefs)),
    h('h4', {}, '3D view'),
    check('Objects', view3d.layers, 'objects', (v) => view3d.setLayer('objects', v)),
    check('Paths', view3d.layers, 'paths', (v) => view3d.setLayer('paths', v)),
    check('Regions', view3d.layers, 'regions', (v) => view3d.setLayer('regions', v)),
    check('Water', view3d.layers, 'water', (v) => view3d.setLayer('water', v)),
    check('Base (diorama sides)', view3d.layers, 'skirt', (v) => view3d.setLayer('skirt', v)),
    check('Shadows (slower)', view3d.layers, 'shadows', (v) => view3d.setLayer('shadows', v)),
    check('Textured ground', view3d.layers, 'textures', (v) => view3d.setLayer('textures', v)),
    check('Rocky cliffs on steep slopes', view3d.layers, 'cliffs', (v) => view3d.setLayer('cliffs', v)),
    check('Grass near the camera', view3d.layers, 'grass', (v) => view3d.setLayer('grass', v)),
    check('Animate water & wind', view3d, 'animateWater'),
    slider('Snow line', { v: view3d.snowLine }, 'v', 0.3, 1.01, 0.01, (v) => v > 1 ? 'off' : Math.round(v * 100) + '%', (v) => view3d.setSnowLine(v)),
    slider('Height exaggeration', { v: view3d.verticalScale }, 'v', 0.25, 4, 0.05, (v) => v.toFixed(2) + '×', (v) => view3d.setVerticalScale(v)),
    field('Mesh detail', h('select', { onchange: (e) => view3d.setMaxRes(+e.target.value) },
      [[256, 'Low (tablet friendly)'], [512, 'Medium'], [1024, 'High'], [2048, 'Full']].map(([v, n]) => h('option', { value: v, selected: view3d.maxRes === v }, n)))),
  );
  if (app.info?.lanUrls?.length) {
    body.append(h('h4', {}, 'Open on your tablet'), h('div', { class: 'filelist' }, app.info.lanUrls.join('\n')),
      h('p', { class: 'hint' }, 'Tablet and PC must be on the same Wi-Fi. Maps are saved to: ' + app.info.mapsDir));
  }
}

function walkLegend() {
  const counts = editor.walkGrid ? walkStats(editor.walkGrid) : null;
  const total = editor.walkGrid ? editor.walkGrid.length : 1;
  return h('div', { class: 'legend' }, NAV_LEGEND.map(([v, name, c]) => h('div', {},
    h('span', { class: 'swatch', style: `background:rgb(${c.join(',')})` }), name,
    counts ? h('b', {}, ` ${Math.round(counts[v] / total * 100)}%`) : null)),
  h('p', { class: 'hint' }, 'Rules (max slope, wading depth) are in Map settings and are saved with the map.'));
}

// ------------------------------------------------------------ view mode

function setViewMode(mode) {
  app.prefs.viewMode = mode;
  savePref('prefs', app.prefs);
  $('#viewports').className = 'mode-' + mode;
  $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  if (mode === '2d') view3d.hide(); else view3d.show();
  requestAnimationFrame(() => { editor.resize(); view3d.resize(); });
}

// ------------------------------------------------------------ map lifecycle

function loadMapIntoEditor(map, serverId, dirty = false) {
  app.map = map;
  app.serverId = serverId;
  history.clear();
  editor.setMap(map);
  view3d.setMap(map);
  if (app.prefs.viewMode !== '2d') view3d.show();
  updateTitle();
  updateCounts();
  renderToolPane();
  renderProps();
  if (dirty) markDirty(); else markClean();
  app.lastSaved = 0;
  updateSaveStatus();
}

async function refreshMapList() {
  try { app.mapList = await api.list(); } catch { app.mapList = []; }
  return app.mapList;
}

function confirmDiscard() {
  return !app.dirty || confirm('You have unsaved changes. Discard them?');
}

async function save({ silent = false } = {}) {
  const m = app.map;
  if (!ID_RE.test(m.meta.id)) m.meta.id = slugify(m.meta.name);
  if (app.serverId !== m.meta.id) {
    await refreshMapList();
    if (app.mapList.some((x) => x.id === m.meta.id)) {
      if (silent) return false;
      if (!confirm(`A map with the file name "${m.meta.id}" already exists on the PC. Overwrite it?\n(Cancel and change the file name in Map settings to keep both.)`)) return false;
    }
  }
  try {
    const res = await api.save(m.toJSON());
    app.serverId = m.meta.id;
    app.lastSaved = Date.now();
    markClean();
    clearDraft();
    refreshMapList();
    if (!silent) toast(`Saved to ${res.path}`, 'ok');
    return true;
  } catch (e) {
    toast('Save failed: ' + e.message + (silent ? '' : ' — your work is kept in this browser.'), 'err');
    saveDraft(m.toJSON(), app.serverId);
    return false;
  }
}

// ------------------------------------------------------------ modals

function openModal(title, ...content) {
  $('#modalTitle').textContent = title;
  $('#modalBody').replaceChildren(...content);
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBody').replaceChildren();
  app.onModalClose?.();
  app.onModalClose = null;
}

function newMapDialog() {
  const o = loadPref('newmap2', { name: 'New World', kind: 'world', size: '512', width: 512, height: 512, cellSize: 4, heightScale: 180, seaLevel: 0.3, start: 'generate' });
  const sizeSel = h('select', { onchange: () => { o.size = sizeSel.value; custom.classList.toggle('hidden', o.size !== 'custom'); } },
    [['128', '128 × 128 (small arena / dungeon)'], ['256', '256 × 256 (quest world)'], ['512', '512 × 512 (large world)'], ['1024', '1024 × 1024 (huge world)'],
      ['257', '257 × 257 (Unity terrain)'], ['513', '513 × 513 (Unity terrain)'], ['1025', '1025 × 1025 (Unity terrain)'], ['custom', 'Custom…']]
      .map(([v, n]) => h('option', { value: v, selected: o.size === v }, n)));
  const num = (key, step) => h('input', { type: 'number', value: o[key], step, oninput: (e) => { o[key] = parseFloat(e.target.value); updateInfo(); } });
  const custom = h('div', { class: o.size === 'custom' ? 'grid2' : 'grid2 hidden' }, field('Width', num('width', 1)), field('Height', num('height', 1)));
  const info = h('p', { class: 'hint' });
  const updateInfo = () => {
    const w = o.size === 'custom' ? o.width : +o.size, hh = o.size === 'custom' ? o.height : +o.size;
    info.textContent = `World will be ${((w - 1) * o.cellSize).toFixed(0)} × ${((hh - 1) * o.cellSize).toFixed(0)} units (1 unit = 1 metre in most engines), max height ${o.heightScale} units. ${o.heightScale > 0.15 * (Math.min(w, hh) - 1) * o.cellSize ? "Tall for this size: expect many cliffs. For mostly walkable open worlds keep max height under ~12% of the width." : "Good proportions for a walkable open world."}`;
  };
  sizeSel.addEventListener('change', updateInfo);
  updateInfo();
  const nameIn = h('input', { type: 'text', value: o.name, oninput: (e) => { o.name = e.target.value; } });
  const kindSel = h('select', { onchange: (e) => { o.kind = e.target.value; } }, MAP_KINDS.map(([k, n]) => h('option', { value: k, selected: o.kind === k }, n)));
  const startSel = h('select', { onchange: (e) => { o.start = e.target.value; } },
    [['generate', 'Generate terrain (opens generator)'], ['land', 'Flat grassland'], ['ocean', 'Empty ocean (paint islands)'], ['island', 'Quick random island']]
      .map(([v, n]) => h('option', { value: v, selected: o.start === v }, n)));
  openModal('New map',
    field('Name', nameIn), field('Map type', kindSel), field('Terrain size', sizeSel), custom,
    h('div', { class: 'grid2' }, field('Cell size (units)', num('cellSize', 0.25)), field('Max height (units)', num('heightScale', 5))),
    info,
    field('Start with', startSel),
    h('div', { class: 'modal-actions' },
      h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        if (!confirmDiscard()) return;
        const w = Math.round(o.size === 'custom' ? o.width : +o.size), hh = Math.round(o.size === 'custom' ? o.height : +o.size);
        if (!(w >= 16 && hh >= 16 && w <= 4097 && hh <= 4097)) { toast('Size must be between 16 and 4097', 'err'); return; }
        if (!(o.cellSize > 0 && o.heightScale > 0)) { toast('Cell size and height must be positive', 'err'); return; }
        savePref('newmap2', o);
        const map = new WorldMap({ width: w, height: hh, cellSize: o.cellSize, heightScale: o.heightScale, seaLevel: o.seaLevel, name: o.name || 'New World', kind: o.kind });
        if (o.start === 'ocean') { map.heights.fill(o.seaLevel * 0.6); map.biomes.fill(0); }
        closeModal();
        if (o.start === 'island') {
          await busy('Generating island…');
          const seed = (Math.random() * 1e6) | 0;
          map.meta.seed = seed;
          generateHeights(map, { ...GEN_DEFAULTS, seed, seaLevel: o.seaLevel });
          autoBiomes(map, { seed });
          autoDecorate(map, { density: 0.4, seed });
          unbusy();
        }
        loadMapIntoEditor(map, null, true);
        if (o.start === 'generate') generateDialog();
        if (o.start === 'ocean') {
          Object.assign(editor.brush, { mode: 'land', size: Math.max(editor.brush.size, 50) });
          setTool('sculpt');
          if (document.body.classList.contains('panel-hidden')) $('#btnPanel').click();
          toast('Empty ocean: drag with the Land brush to paint land, or pick 🏝️ Island and tap the sea');
        }
      } }, 'Create')),
  );
}

function generateDialog() {
  const m = app.map;
  const o = loadPref('gen', { ...GEN_DEFAULTS, decorate: true, decorDensity: 0.5 });
  o.seaLevel = m.seaLevel;
  const prev = h('canvas', { width: 200, height: 200, style: 'width:100%;max-width:280px;aspect-ratio:1;border-radius:10px;border:1px solid var(--line);background:#000;display:block;margin:0 auto' });
  let timer = 0;
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const n = 200;
      const tmp = new WorldMap({ width: n, height: n, cellSize: m.cellSize * (m.width - 1) / (n - 1), heightScale: m.heightScale, seaLevel: o.seaLevel });
      generateHeights(tmp, { ...o, erosion: o.erosion * 0.5 });
      if (o.autoBiomes) autoBiomes(tmp, { seed: o.seed, moistureBias: o.moistureBias, temperatureBias: o.temperatureBias });
      else tmp.biomes.set(new Uint8Array(n * n).fill(3));
      const ctx = prev.getContext('2d');
      const img = ctx.createImageData(n, n);
      shadeRegion(tmp, img.data, { x0: 0, y0: 0, x1: n - 1, y1: n - 1 }, { hillshade: true, water: true });
      ctx.putImageData(img, 0, 0);
    }, 120);
  };
  const S = (label, key, min, max, step, fmt) => slider(label, o, key, min, max, step, fmt, preview);
  const seedIn = h('input', { type: 'number', value: o.seed, oninput: (e) => { o.seed = parseInt(e.target.value, 10) || 0; preview(); } });
  const shapeSel = h('select', { onchange: (e) => { o.shape = e.target.value; preview(); } },
    [['island', 'Island'], ['continent', 'Continent'], ['archipelago', 'Archipelago'], ['inland', 'Inland (no coast)'], ['valley', 'Valley between mountains']]
      .map(([v, n]) => h('option', { value: v, selected: o.shape === v }, n)));
  const pct = (v) => Math.round(v * 100) + '%';
  openModal('Generate terrain',
    h('div', { class: 'grid2' },
      h('div', {}, prev,
        h('div', { class: 'btnrow', style: 'margin-top:10px' },
          h('button', { onclick: () => { o.seed = (Math.random() * 1e6) | 0; seedIn.value = o.seed; preview(); } }, '🎲 New random world')),
        field('Seed', seedIn), field('Shape', shapeSel)),
      h('div', {},
        S('Land amount', 'landCoverage', 0.05, 0.95, 0.01, pct),
        S('Plains (walkable)', 'plains', 0, 1, 0.01, pct),
        S('Feature size', 'featureSize', 0, 1, 0.01, pct),
        S('Mountains', 'mountains', 0, 1, 0.01, pct),
        S('Roughness', 'roughness', 0, 1, 0.01, pct),
        S('Detail', 'octaves', 2, 9, 1, (v) => v),
        S('Twistiness', 'warp', 0, 1, 0.01, pct),
        S('Erosion', 'erosion', 0, 1, 0.01, pct),
        S('Sea level', 'seaLevel', 0, 0.9, 0.01, pct),
        check('Paint biomes automatically', o, 'autoBiomes', preview),
        S('Moisture', 'moistureBias', -0.4, 0.4, 0.01, (v) => (v > 0 ? '+' : '') + v.toFixed(2)),
        S('Temperature', 'temperatureBias', -0.4, 0.4, 0.01, (v) => (v > 0 ? '+' : '') + v.toFixed(2)),
        check('Place trees & rocks', o, 'decorate'),
        slider('Vegetation', o, 'decorDensity', 0.05, 1, 0.01, pct))),
    h('p', { class: 'hint' }, 'This replaces the terrain (objects, paths and regions you placed are kept). You can undo it.'),
    h('div', { class: 'modal-actions' },
      h('button', { onclick: closeModal }, 'Close'),
      h('button', { class: 'primary', onclick: async () => {
        savePref('gen', o);
        closeModal();
        await busy('Generating terrain…');
        try {
          const snapshot = { heights: m.heights.slice(), biomes: m.biomes.slice() };
          const settingsBefore = { seaLevel: m.seaLevel };
          const objsBefore = new Map(m.objects.map((x, i) => [x.id, { x, i }]));
          generateHeights(m, o);
          if (o.autoBiomes) autoBiomes(m, { seed: o.seed, moistureBias: o.moistureBias, temperatureBias: o.temperatureBias });
          m.meta.seed = o.seed;
          if (o.decorate) autoDecorate(m, { density: o.decorDensity, seed: o.seed });
          const changes = [];
          const after = new Set(m.objects.map((x) => x.id));
          for (const [id, { x, i }] of objsBefore) if (!after.has(id)) changes.push({ coll: 'objects', id, index: i, before: clone(x), after: null });
          for (const x of m.objects) if (!objsBefore.has(x.id)) changes.push({ coll: 'objects', id: x.id, index: -1, before: null, after: clone(x) });
          history.push({
            label: 'Generate terrain',
            settings: { before: settingsBefore, after: { seaLevel: m.seaLevel } },
            terrain: extractPatch(m, snapshot, { x0: 0, y0: 0, x1: m.width - 1, y1: m.height - 1 }),
            changes,
          });
          editor.updateBase();
          view3d.rebuild();
          app.entitiesChanged();
        } finally { unbusy(); }
      } }, 'Generate')),
  );
  preview();
}

function settingsDialog() {
  const m = app.map;
  const before = { meta: clone(m.meta), cellSize: m.cellSize, heightScale: m.heightScale, seaLevel: m.seaLevel, properties: clone(m.properties), navigation: clone(m.navigation || NAV_DEFAULTS) };
  const o = clone(before);
  let props = clone(m.properties);
  const liveSea = (v) => { m.seaLevel = v; editor.updateBase(); view3d.terrainChanged(); };
  app.onModalClose = () => { // cancel: undo the live sea-level preview
    if (m.seaLevel !== before.seaLevel && !o.applied) { m.seaLevel = before.seaLevel; editor.updateBase(); view3d.terrainChanged(); }
  };
  const idIn = h('input', { type: 'text', value: o.meta.id, oninput: (e) => { o.meta.id = e.target.value.trim(); } });
  const nameIn = h('input', { type: 'text', value: o.meta.name, oninput: (e) => {
    const old = slugify(o.meta.name);
    o.meta.name = e.target.value;
    if (!app.serverId && (o.meta.id === old || !o.meta.id)) { o.meta.id = slugify(o.meta.name); idIn.value = o.meta.id; }
  } });
  openModal('Map settings',
    h('div', { class: 'grid2' },
      h('div', {},
        field('Name', nameIn),
        field('File name / ID', idIn),
        field('Map type', h('select', { onchange: (e) => { o.meta.kind = e.target.value; } }, MAP_KINDS.map(([k, n]) => h('option', { value: k, selected: o.meta.kind === k }, n)))),
        field('Author', h('input', { type: 'text', value: o.meta.author || '', oninput: (e) => { o.meta.author = e.target.value; } })),
        field('Tags', h('input', { type: 'text', value: (o.meta.tags || []).join(', '), placeholder: 'comma separated', oninput: (e) => { o.meta.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); } })),
        field('Description', h('textarea', { oninput: (e) => { o.meta.description = e.target.value; } }, o.meta.description || ''))),
      h('div', {},
        field('Cell size (units)', h('input', { type: 'number', step: 0.25, value: o.cellSize, oninput: (e) => { o.cellSize = parseFloat(e.target.value); } })),
        field('Max height (units)', h('input', { type: 'number', step: 1, value: o.heightScale, oninput: (e) => { o.heightScale = parseFloat(e.target.value); } })),
        slider('Sea level', o, 'seaLevel', 0, 1, 0.001, (v) => (v * o.heightScale).toFixed(1), liveSea),
        h('p', { class: 'hint' }, `Terrain: ${m.width} × ${m.height} samples. Changing the cell size stretches the world; objects move with it.`),
        h('h4', {}, 'Walkability (player & AI movement rules)'),
        slider('Max walk slope', o.navigation, 'maxSlopeDeg', 10, 70, 1, (v) => v + '°'),
        slider('Max wading depth', o.navigation, 'maxWadeDepth', 0, 3, 0.1, (v) => v.toFixed(1) + ' u'),
        slider('Eye height', o.navigation, 'eyeHeight', 0.5, 4, 0.1, (v) => v.toFixed(1) + ' u'),
        h('h4', {}, 'Custom map properties (music, weather, level range…)'),
        propsEditor(props, (p) => { props = p; }))),
    h('div', { class: 'modal-actions' },
      h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: 'primary', onclick: () => {
        if (!ID_RE.test(o.meta.id)) { toast('File name must be lowercase letters, numbers, - or _', 'err'); return; }
        if (!(o.cellSize > 0 && o.heightScale > 0)) { toast('Cell size and height must be positive', 'err'); return; }
        o.properties = props;
        const after = { meta: o.meta, cellSize: o.cellSize, heightScale: o.heightScale, seaLevel: o.seaLevel, properties: props, navigation: o.navigation };
        const changes = [];
        if (o.cellSize !== before.cellSize) {
          const k = o.cellSize / before.cellSize;
          for (const coll of ['objects', 'paths', 'regions']) {
            m[coll].forEach((e, index) => {
              const b = clone(e);
              if (coll === 'objects') { e.x *= k; e.y *= k; } else e.points = e.points.map(([x, y]) => [x * k, y * k]);
              changes.push({ coll, id: e.id, index, before: b, after: clone(e) });
            });
          }
        }
        Object.assign(m, clone(after));
        history.push({ label: 'Map settings', settings: { before, after: clone(after) }, changes });
        o.applied = true;
        closeModal();
        updateTitle();
        editor.updateBase();
        view3d.rebuild();
        app.entitiesChanged();
      } }, 'Apply')),
  );
}

async function openDialog() {
  const grid = h('div', { class: 'mapgrid' }, h('p', { class: 'hint' }, 'Loading…'));
  const fileIn = h('input', { type: 'file', accept: '.json,.wmap,application/json', class: 'hidden', onchange: async () => {
    const f = fileIn.files[0];
    if (!f || !confirmDiscard()) return;
    try {
      const map = WorldMap.fromJSON(JSON.parse(await f.text()));
      closeModal();
      loadMapIntoEditor(map, null, true);
      toast('Imported ' + f.name + ' — save it to store it on the PC');
    } catch (e) { toast('Could not open file: ' + e.message, 'err'); }
  } });
  const draft = await loadDraft();
  openModal('Open map',
    grid,
    h('div', { class: 'modal-actions' },
      draft && h('button', { onclick: () => restoreDraft(draft) }, `Restore unsaved work (${new Date(draft.savedAt).toLocaleString()})`),
      fileIn,
      h('button', { onclick: () => fileIn.click() }, 'Import file from this device…'),
      h('button', { class: 'primary', onclick: () => { closeModal(); newMapDialog(); } }, 'New map')),
  );
  const list = await refreshMapList();
  grid.replaceChildren();
  if (!list.length) grid.append(h('p', { class: 'hint' }, 'No maps saved on the PC yet.'));
  for (const it of list) {
    const open = async () => {
      if (!confirmDiscard()) return;
      await busy('Loading ' + it.name + '…');
      try {
        loadMapIntoEditor(WorldMap.fromJSON(await api.load(it.id)), it.id);
        closeModal();
      } catch (e) { toast('Could not load: ' + e.message, 'err'); } finally { unbusy(); }
    };
    grid.append(h('div', { class: 'mapcard' },
      h('div', { class: 'thumb', style: it.hasThumb ? `background-image:url(${api.thumbUrl(it.id)})` : '', onclick: open }),
      h('div', { class: 'info' }, h('b', {}, it.name || it.id),
        `${(MAP_KINDS.find((k) => k[0] === it.kind) || ['', it.kind])[1]} · ${it.width}×${it.height}`, h('br'),
        new Date(it.modified).toLocaleString(), h('br'), `${it.id}.wmap.json · ${(it.sizeBytes / 1048576).toFixed(1)} MB`),
      h('div', { class: 'acts' },
        h('button', { class: 'primary', onclick: open }, 'Open'),
        h('button', { onclick: () => versionsDialog(it) }, 'Versions'),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`Move "${it.name}" to the trash folder?`)) return;
          try { await api.remove(it.id); toast('Moved to maps/.trash'); openDialog(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Delete'))));
  }
}

async function versionsDialog(it) {
  const list = await api.backups(it.id).catch(() => []);
  openModal(`Earlier versions of ${it.name}`,
    list.length ? h('div', {}, list.map((name) => {
      const ts = name.replace('.wmap.json', '');
      const pretty = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
      return h('div', { class: 'row' }, h('span', { class: 'grow' }, pretty), h('button', { onclick: async () => {
        if (!confirmDiscard()) return;
        try {
          loadMapIntoEditor(WorldMap.fromJSON(await api.loadBackup(it.id, name)), it.id, true);
          closeModal();
          toast('Loaded version from ' + pretty + '. Save to make it current.');
        } catch (e) { toast(e.message, 'err'); }
      } }, 'Load'));
    })) : h('p', { class: 'hint' }, 'No earlier versions yet. Each save keeps the previous file (last 15).'),
    h('div', { class: 'modal-actions' }, h('button', { onclick: openDialog }, 'Back')));
}

function restoreDraft(draft) {
  try {
    const map = WorldMap.fromJSON(draft.doc);
    closeModal();
    loadMapIntoEditor(map, draft.serverId ?? null, true);
    toast('Restored unsaved work');
  } catch (e) { toast('Draft is damaged: ' + e.message, 'err'); }
}

function exportDialog() {
  const m = app.map;
  const o = { step: m.width > 1100 ? 2 : 1 };
  const result = h('div');
  const exportNow = async () => {
    if (app.dirty || !app.serverId) {
      if (!(await save())) return;
    }
    await busy('Building export package…');
    try {
      const r = await api.export(app.serverId, o.step, computeWalkGrid(m));
      result.replaceChildren(
        h('h4', {}, 'Exported to your PC'),
        h('div', { class: 'filelist' }, r.folder + '\n\n' + r.files.join('\n')),
        h('div', { class: 'btnrow' }, h('a', { href: r.download, download: `${app.serverId}.zip` }, h('button', { class: 'primary' }, 'Download .zip to this device'))),
      );
      toast('Export complete', 'ok');
    } catch (e) { toast('Export failed: ' + e.message, 'err'); } finally { unbusy(); }
  };
  openModal('Export for your game',
    h('p', { class: 'hint' }, 'Creates a folder on the PC (and a .zip) with everything a game engine needs:'),
    h('div', { class: 'filelist' }, [
      `${m.meta.id}.wmap.json   full map data (load this in your game)`,
      'entities.json        objects / roads / regions with 3D positions',
      'terrain.glb          3D terrain mesh (Blender, Godot, Unity, Unreal)',
      'heightmap_16bit.png  16-bit heightmap',
      'heightmap.r16        raw heightmap (Unity terrain)',
      'walkmap.png          walkability per cell (see README in export)',
      'splat_*.png          biome texture weights',
      'biome_index.png      biome id per pixel',
      'preview.png          shaded map image',
    ].join('\n')),
    field('3D mesh detail', h('select', { onchange: (e) => { o.step = +e.target.value; } },
      [[1, 'Full resolution'], [2, 'Half'], [4, 'Quarter']].map(([v, n]) => h('option', { value: v, selected: o.step === v }, n)))),
    h('div', { class: 'modal-actions', style: 'justify-content:flex-start' },
      h('button', { class: 'primary', onclick: exportNow }, 'Export to PC'),
      h('button', { onclick: () => downloadBlob(new Blob([JSON.stringify(m.toJSON())], { type: 'application/json' }), `${m.meta.id}.wmap.json`) }, 'Download map file'),
      h('button', { onclick: () => editor.renderImage(4096).toBlob((b) => downloadBlob(b, `${m.meta.id}_map.png`)) }, 'Download 2D map image'),
      h('button', { onclick: () => download3DShot() }, '3D screenshot')),
    result,
  );
}

function download3DShot() {
  if (app.prefs.viewMode === '2d') { setViewMode('split'); setTimeout(download3DShot, 400); return; }
  const url = view3d.screenshot();
  if (!url) return;
  fetch(url).then((r) => r.blob()).then((b) => downloadBlob(b, `${app.map.meta.id}_3d.png`));
}

// ------------------------------------------------------------ wiring

const actions = {
  new: newMapDialog,
  open: openDialog,
  save: () => save(),
  export: exportDialog,
  undo: () => { const l = history.undo(); if (l) toast('Undo: ' + l); },
  redo: () => { const l = history.redo(); if (l) toast('Redo: ' + l); },
  generate: generateDialog,
  settings: settingsDialog,
};
$$('[data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action]()));
$('#btnMapTitle').addEventListener('click', settingsDialog);
$$('#toolbar button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$$('#viewSeg button').forEach((b) => b.addEventListener('click', () => setViewMode(b.dataset.view)));
$('#btnPanel').addEventListener('click', () => {
  document.body.classList.toggle('panel-hidden');
  requestAnimationFrame(() => { editor.resize(); view3d.resize(); });
});
$$('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
  const z = b.dataset.zoom;
  if (z === 'fit') editor.fit(); else editor.zoomBy(z === 'in' ? 1.4 : 1 / 1.4);
}));
$('#btn3dFrame').addEventListener('click', () => view3d.frame());
$('#btn3dFocus').addEventListener('click', () => { const s = editor.selectedItems()[0]; if (s) focus3D(s); else toast('Select something first'); });
$('#btn3dShot').addEventListener('click', download3DShot);
$('#btn3dWalk').addEventListener('click', () => startWalk());
function startWalk() {
  if (app.prefs.viewMode === '2d') setViewMode('3d');
  const s = editor.selectedItems()[0];
  const at = s?.coll === 'objects' ? [s.item.x, s.item.y] : null;
  setTimeout(() => { view3d.startWalk(at); toast(matchMedia('(pointer: coarse)').matches ? 'Walk mode: left stick moves, drag to look' : 'Walk mode: click to look, WASD to move, Esc to exit'); }, 80);
}
$('#draftFinish').addEventListener('click', () => editor.finishDraft());
$('#draftUndo').addEventListener('click', () => editor.undoDraftPoint());
$('#draftCancel').addEventListener('click', () => editor.cancelDraft());
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (view3d.walk?.active) return; // walk mode owns the keyboard
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); actions.redo(); return; }
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (mod && k === 'd') { e.preventDefault(); editor.duplicateSelection(); return; }
  if (mod && k === 'o') { e.preventDefault(); openDialog(); return; }
  if (mod) return;
  if (!$('#modal').classList.contains('hidden')) { if (k === 'escape') closeModal(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); editor.deleteSelection(); }
  else if (k === 'escape') { if (editor.draft) editor.cancelDraft(); else editor.setSelection([]); }
  else if (k === 'enter') editor.finishDraft();
  else if (k === 'f') editor.fit();
  else if (k === 'tab') { e.preventDefault(); setViewMode({ '2d': 'split', split: '3d', '3d': '2d' }[app.prefs.viewMode]); }
  else if (k === '[' || k === ']') {
    const target = editor.tool === 'scatter' ? editor.scatter : editor.brush;
    target.size = Math.max(1, Math.min(200, Math.round(target.size * (k === ']' ? 1.2 : 1 / 1.2))));
    renderToolPane();
    editor.requestRender();
  } else {
    const tools = ['select', 'pan', 'sculpt', 'paint', 'place', 'scatter', 'path', 'region'];
    const n = parseInt(k, 10);
    if (n >= 1 && n <= tools.length) setTool(tools[n - 1]);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (app.dirty) {
    saveDraft(app.map.toJSON(), app.serverId);
    e.preventDefault();
    e.returnValue = '';
  }
});

// crash-recovery draft in the browser + periodic save to the PC
setInterval(() => {
  if (!app.map || !app.draftDirty) return;
  app.draftDirty = false;
  const doc = app.map.toJSON();
  saveDraft(doc, app.serverId);
}, 20000);
setInterval(() => {
  if (app.map && app.dirty && app.serverId && app.prefs.autoSaveServer && Date.now() - app.lastSaved > 110000 && !editor.gesture) save({ silent: true });
}, 30000);

// ------------------------------------------------------------ startup

async function start() {
  if (window.innerWidth < 900) document.body.classList.add('panel-hidden');
  setTool('select');
  try { app.info = await api.info(); } catch { toast('Cannot reach the PC server — saving to PC will not work until it is running', 'err'); }
  const list = await refreshMapList();
  const draft = await loadDraft();

  if (list.length) {
    try {
      loadMapIntoEditor(WorldMap.fromJSON(await api.load(list[0].id)), list[0].id);
    } catch { /* fall through to a fresh map */ }
  }
  if (!app.map) {
    const map = new WorldMap({ width: 256, height: 256, cellSize: 4, heightScale: 100, name: 'My First World' });
    const seed = 20261021;
    map.meta.seed = seed;
    generateHeights(map, { ...GEN_DEFAULTS, seed });
    autoBiomes(map, { seed });
    autoDecorate(map, { density: 0.4, seed });
    loadMapIntoEditor(map, null, true);
  }
  renderLayers();
  setViewMode(app.prefs.viewMode || '2d');
  if (draft && (Date.now() - draft.savedAt) < 14 * 864e5) {
    openModal('Unsaved work found',
      h('p', {}, `There is unsaved work from ${new Date(draft.savedAt).toLocaleString()} ("${draft.doc?.meta?.name}").`),
      h('div', { class: 'modal-actions' },
        h('button', { onclick: () => { clearDraft(); closeModal(); } }, 'Discard it'),
        h('button', { class: 'primary', onclick: () => restoreDraft(draft) }, 'Restore')));
  }
}

window.mapCreator = { app, editor, view3d, history }; // handy for the browser console
start();
