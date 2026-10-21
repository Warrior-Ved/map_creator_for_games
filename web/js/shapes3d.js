// Low-poly 3D models for the preview. Each shape is a list of parts inside a
// unit box (height ~1, scaled by the type's size). `color: null` uses the
// object type's colour. Parts are drawn as InstancedMeshes.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const m4 = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const cyl = (rt, rb, h, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0);
const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const blob = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);

// merge several geometries (with transforms) into one non-indexed geometry
function merge(list) {
  const pos = [], nrm = [];
  for (const [g, m] of list) {
    const gg = (g.index ? g.toNonIndexed() : g.clone());
    if (m) gg.applyMatrix4(m);
    gg.computeVertexNormals();
    pos.push(...gg.attributes.position.array);
    nrm.push(...gg.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

// a palm frond: long flattened, drooping leaf
function frond(len) {
  const g = new THREE.ConeGeometry(0.06, len, 4, 3).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0).scale(1, 0.25, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) - 0.35 * (x / len) * (x / len) * len); }
  g.computeVertexNormals();
  return g;
}

export function buildShapes() {
  const S = {};
  const trunk = '#6b4a2f', roof = '#8e3b2e', stone = '#8d8a85', wood = '#7a5a3a';

  S.tree_round = [
    { geo: cyl(0.045, 0.08, 0.5), color: trunk },
    { geo: merge([[blob(0.26), m4(0, 0.62, 0)], [blob(0.2), m4(0.17, 0.52, 0.06)], [blob(0.19), m4(-0.15, 0.55, -0.08)], [blob(0.18), m4(0.02, 0.8, 0.02)]]), color: null },
  ];
  S.tree_birch = [
    { geo: cyl(0.03, 0.045, 0.75), color: '#e9e6dc' },
    { geo: merge([[blob(0.2), m4(0, 0.72, 0, 1, 1.3, 1)], [blob(0.15), m4(0.1, 0.58, 0.05)], [blob(0.14), m4(-0.09, 0.85, -0.04)]]), color: null },
  ];
  S.tree_cone = [
    { geo: cyl(0.035, 0.06, 0.3), color: trunk },
    { geo: merge([[cone(0.3, 0.42, 8), m4(0, 0.16, 0)], [cone(0.24, 0.38, 8), m4(0, 0.4, 0)], [cone(0.16, 0.34, 8), m4(0, 0.64, 0)]]), color: null },
  ];
  S.tree_snowpine = [
    ...S.tree_cone,
    { geo: merge([[cone(0.2, 0.16, 8), m4(0, 0.47, 0)], [cone(0.15, 0.15, 8), m4(0, 0.7, 0)], [cone(0.09, 0.14, 8), m4(0, 0.86, 0)]]), color: '#f4f7fb' },
  ];
  S.tree_jungle = [
    { geo: cyl(0.04, 0.08, 0.8, 8), color: '#5c4630' },
    { geo: merge([[blob(0.28), m4(0, 0.85, 0, 1.25, 0.55, 1.25)], [blob(0.22), m4(0.2, 0.74, 0.1, 1.2, 0.5, 1.2)], [blob(0.2), m4(-0.2, 0.76, -0.1, 1.2, 0.5, 1.2)], [blob(0.2), m4(0, 0.6, 0.18, 1.2, 0.5, 1.2)]]), color: null },
  ];
  {
    // curved palm trunk + fronds
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 0.45, 0), new THREE.Vector3(0.16, 0.85, 0));
    const fr = [];
    for (let k = 0; k < 7; k++) fr.push([frond(0.42), m4(0.16, 0.86, 0, 1, 1, 1, (k / 7) * Math.PI * 2, 0, 0.25)]);
    S.tree_palm = [
      { geo: new THREE.TubeGeometry(curve, 8, 0.035, 6, false), color: '#9a7b52' },
      { geo: merge(fr), color: null, side: THREE.DoubleSide },
    ];
  }
  S.tree_dead = [
    { geo: merge([[cyl(0.03, 0.07, 0.9, 5), null], [cyl(0.012, 0.025, 0.35, 4), m4(0.03, 0.5, 0, 1, 1, 1, 0, 0, -0.8)], [cyl(0.01, 0.02, 0.3, 4), m4(-0.02, 0.62, 0, 1, 1, 1, 0.4, 0, 0.9)]]), color: null },
  ];
  S.cactus = [{
    geo: merge([[new THREE.CapsuleGeometry(0.09, 0.75, 4, 8), m4(0, 0.47, 0)],
      [new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), m4(0.16, 0.55, 0)], [cyl(0.06, 0.06, 0.12, 8), m4(0.08, 0.4, 0, 1, 1, 1, 0, 0, Math.PI / 2)],
      [new THREE.CapsuleGeometry(0.055, 0.18, 4, 8), m4(-0.15, 0.68, 0)], [cyl(0.055, 0.055, 0.1, 8), m4(-0.07, 0.55, 0, 1, 1, 1, 0, 0, -Math.PI / 2)]]),
    color: null,
  }];
  S.bush = [{ geo: merge([[blob(0.38), m4(0, 0.3, 0, 1, 0.75, 1)], [blob(0.28), m4(0.25, 0.22, 0.1, 1, 0.75, 1)], [blob(0.26), m4(-0.22, 0.24, -0.1, 1, 0.75, 1)]]), color: null }];
  {
    const leaves = [];
    for (let k = 0; k < 7; k++) leaves.push([frond(0.55), m4(0, 0.08, 0, 1, 1, 1, (k / 7) * Math.PI * 2, 0, 0.55)]);
    S.fern = [{ geo: merge(leaves), color: null, side: THREE.DoubleSide }];
  }
  {
    const stems = [];
    for (let k = 0; k < 9; k++) stems.push([cyl(0.008, 0.015, 0.8 + 0.2 * Math.sin(k * 3.1), 4), m4(Math.cos(k * 2.4) * 0.12, 0, Math.sin(k * 2.4) * 0.12, 1, 1, 1, 0, Math.sin(k) * 0.12, Math.cos(k) * 0.12)]);
    S.reeds = [{ geo: merge(stems), color: null }, { geo: merge([0, 1, 2, 3].map((k) => [new THREE.CapsuleGeometry(0.02, 0.1, 2, 5), m4(Math.cos(k * 2.4) * 0.12, 0.82, Math.sin(k * 2.4) * 0.12)])), color: '#6b4a2f' }];
  }
  {
    const heads = [], stems = [];
    for (let k = 0; k < 6; k++) {
      const x = Math.cos(k * 2.3) * 0.25, z = Math.sin(k * 2.3) * 0.25, h = 0.5 + 0.3 * Math.sin(k * 1.7);
      stems.push([cyl(0.012, 0.012, h, 4), m4(x, 0, z)]);
      heads.push([blob(0.08, 0), m4(x, h, z)]);
    }
    S.flowers = [{ geo: merge(stems), color: '#3d7d32' }, { geo: merge(heads), color: null }];
  }
  S.rock = [{ geo: new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.62, 0.82).translate(0, 0.2, 0), color: null }];
  S.crystal = [{ geo: merge([[new THREE.OctahedronGeometry(0.2).scale(1, 2.4, 1), m4(0, 0.48, 0)], [new THREE.OctahedronGeometry(0.13).scale(1, 2.2, 1), m4(0.2, 0.25, 0.08, 1, 1, 1, 0, 0, -0.45)], [new THREE.OctahedronGeometry(0.11).scale(1, 2, 1), m4(-0.17, 0.2, -0.05, 1, 1, 1, 0, 0, 0.5)]]), color: null, glow: 0.5 }];
  S.mushroom = [
    { geo: cyl(0.08, 0.11, 0.6), color: '#efe6d4' },
    { geo: new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.55, 0), color: null },
  ];
  S.house = [
    { geo: box(0.9, 0.55, 0.7), color: '#d9c7a5' },
    { geo: merge([[box(0.92, 0.04, 0.72), m4(0, 0.0, 0)], [box(0.12, 0.3, 0.02), m4(0, 0, 0.355)]]), color: wood },
    { geo: new THREE.CylinderGeometry(0, 0.62, 0.42, 4, 1).rotateY(Math.PI / 4).scale(1.1, 1, 0.85).translate(0, 0.76, 0), color: null },
  ];
  S.tower = [
    { geo: cyl(0.16, 0.2, 0.8, 10), color: null },
    { geo: cyl(0.21, 0.21, 0.06, 10), matrix: m4(0, 0.78, 0), color: stone },
    { geo: cone(0.25, 0.24, 10), matrix: m4(0, 0.84, 0), color: roof },
  ];
  S.castle = [
    { geo: box(0.8, 0.38, 0.8), color: null },
    { geo: box(0.35, 0.68, 0.35), color: null },
    ...[[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].map(([x, z]) => ({ geo: cyl(0.1, 0.11, 0.55, 8), matrix: m4(x, 0, z), color: null })),
    ...[[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4], [0, 0]].map(([x, z], i) => ({ geo: cone(i === 4 ? 0.24 : 0.13, 0.22, 8), matrix: m4(x, i === 4 ? 0.68 : 0.55, z), color: roof })),
  ];
  S.temple = [
    { geo: box(1, 0.12, 0.8), color: stone },
    ...[-0.38, -0.13, 0.13, 0.38].map((x) => ({ geo: cyl(0.05, 0.05, 0.5, 6), matrix: m4(x, 0.12, 0.3), color: null })),
    { geo: box(0.85, 0.5, 0.45), matrix: m4(0, 0.12, -0.12), color: null },
    { geo: new THREE.CylinderGeometry(0, 0.7, 0.25, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.75).translate(0, 0.74, 0), color: roof },
  ];
  S.ruins = [
    { geo: merge([[box(0.15, 0.7, 0.15), m4(-0.35, 0, -0.3)], [box(0.15, 0.45, 0.15), m4(0.35, 0, -0.3)], [box(0.15, 0.25, 0.15), m4(0.3, 0, 0.35)], [box(0.8, 0.12, 0.15), m4(0, 0.58, -0.3, 0.6, 1, 1)], [box(0.3, 0.1, 0.2), m4(-0.1, 0, 0.2, 1, 1, 1, 0.5)]]), color: null },
  ];
  S.well = [{ geo: cyl(0.4, 0.4, 0.5, 10), color: null }, { geo: merge([[box(0.05, 0.9, 0.05), m4(-0.35, 0, 0)], [box(0.05, 0.9, 0.05), m4(0.35, 0, 0)]]), color: wood }, { geo: cone(0.55, 0.35, 4), matrix: m4(0, 0.9, 0), color: roof }];
  S.tent = [{ geo: cone(0.55, 0.8, 5), color: null }];
  S.cave = [
    { geo: new THREE.SphereGeometry(0.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 0.7), color: '#5b5650' },
    { geo: new THREE.CircleGeometry(0.28, 12, 0, Math.PI).translate(0, 0.01, 0.43), color: '#0d0b0a' },
  ];
  S.bridge = [{ geo: merge([[box(3, 0.15, 1), null], [box(3, 0.25, 0.06), m4(0, 0.15, 0.47)], [box(3, 0.25, 0.06), m4(0, 0.15, -0.47)]]), color: null }];
  // settlements are map markers: a banner pole on a small plinth, so real buildings placed around it stay visible
  S.settlement = [
    { geo: cyl(0.035, 0.045, 0.03, 10), color: '#9a9488' },
    { geo: cyl(0.005, 0.006, 0.36, 6), color: '#e8e2d6' },
    { geo: box(0.004, 0.07, 0.11), matrix: m4(0, 0.27, 0.058), color: null, glow: 0.25, side: THREE.DoubleSide },
  ];
  S.marker = [
    { geo: cyl(0.04, 0.04, 1, 6), color: '#dddddd' },
    { geo: new THREE.OctahedronGeometry(0.22).translate(0, 1.2, 0), color: null, glow: 0.6 },
  ];
  S.chest = [{ geo: box(1, 0.6, 0.7), color: null }, { geo: box(1.02, 0.12, 0.72), matrix: m4(0, 0.6, 0), color: '#4a3424' }];
  S.portal = [
    { geo: new THREE.TorusGeometry(0.4, 0.07, 8, 24).translate(0, 0.5, 0), color: null, glow: 0.4 },
    { geo: new THREE.CircleGeometry(0.36, 24).translate(0, 0.5, 0), color: null, opacity: 0.45, glow: 0.8 },
  ];
  S.sign = [{ geo: cyl(0.04, 0.04, 0.8, 5), color: wood }, { geo: box(0.5, 0.25, 0.05), matrix: m4(0, 0.6, 0), color: '#a07a4a' }];

  // ---- transport hubs (proportions match the `deck` entries in model.js)
  {
    // port, size ~40: quay along x at z 0.12, pier reaching north (-z) into the water
    const posts = [];
    for (let k = 0; k <= 8; k++) posts.push([cyl(0.009, 0.009, 0.45, 6), m4(0.04 * (k % 2 ? 1 : -1), -0.4, -0.1 * k - 0.05)]);
    S.port = [
      { geo: box(1, 0.05, 0.35), matrix: m4(0, 0, 0.12), color: '#9a9488' },
      { geo: merge([[box(0.1, 0.05, 0.95), m4(0, 0, -0.475)], [box(0.12, 0.012, 0.012), m4(0, 0.05, -0.95)]]), color: null },
      { geo: merge(posts), color: '#4a3424' },
      { geo: box(0.3, 0.2, 0.18), matrix: m4(-0.27, 0.05, 0.17), color: '#a0522d' },
      { geo: new THREE.CylinderGeometry(0, 0.24, 0.07, 4, 1).rotateY(Math.PI / 4).scale(0.9, 1, 0.55).translate(-0.27, 0.285, 0.17), color: '#5b4c3e' },
      { geo: merge([[box(0.025, 0.36, 0.025), m4(0.27, 0.05, 0.05)], [box(0.025, 0.025, 0.32), m4(0.27, 0.4, -0.06)], [box(0.008, 0.12, 0.008), m4(0.27, 0.29, -0.2)]]), color: '#e0b04f' },
      { geo: merge([[box(0.07, 0.04, 0.2), m4(0.12, -0.03, -0.6)], [box(0.05, 0.04, 0.07), m4(0.12, 0.01, -0.56)], [cyl(0.003, 0.003, 0.14, 4), m4(0.12, 0.01, -0.64)]]), color: '#f2efe8' },
    ];
  }
  {
    // airport, size ~160: runway along x at z 0.25, apron + terminal to the north
    const stripes = [];
    for (let k = 0; k < 12; k++) stripes.push([box(0.04, 0.0006, 0.0025), m4(-0.44 + k * 0.08, 0.004, 0.25)]);
    S.airport = [
      { geo: merge([[box(1, 0.004, 0.06), m4(0, 0, 0.25)], [box(0.4, 0.004, 0.14), m4(0, 0, 0.05)], [box(0.03, 0.004, 0.15), m4(0, 0, 0.175)]]), color: '#4a4d52' },
      { geo: merge(stripes), color: '#f4f4f4' },
      { geo: box(0.3, 0.05, 0.1), matrix: m4(0, 0.004, -0.07), color: null },
      { geo: box(0.31, 0.012, 0.11), matrix: m4(0, 0.054, -0.07), color: '#6fb7d9' },
      { geo: cyl(0.008, 0.011, 0.12, 8), matrix: m4(0.22, 0.004, -0.06), color: '#e9e4dc' },
      { geo: cyl(0.02, 0.016, 0.022, 8), matrix: m4(0.22, 0.124, -0.06), color: '#6fb7d9' },
      { geo: merge([[box(0.12, 0.03, 0.1), m4(-0.3, 0.004, -0.04)], [new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.6, 1).translate(-0.3, 0.034, -0.04), null]]), color: '#9aa3ad' },
      {
        geo: merge([[new THREE.CapsuleGeometry(0.004, 0.05, 3, 8).rotateZ(Math.PI / 2), m4(0.06, 0.012, 0.06)], [box(0.014, 0.002, 0.065), m4(0.062, 0.011, 0.06)],
          [box(0.008, 0.012, 0.002), m4(0.035, 0.012, 0.06)], [box(0.006, 0.002, 0.022), m4(0.035, 0.022, 0.06)]]),
        color: '#f7f7f7',
      },
    ];
  }
  {
    // train station, size ~24: platform along x at z 0.15, building behind it
    const canopyPosts = [-0.4, -0.13, 0.13, 0.4].map((x) => [cyl(0.006, 0.006, 0.17, 6), m4(x, 0.05, 0.15)]);
    S.train_station = [
      { geo: box(1, 0.05, 0.16), matrix: m4(0, 0, 0.15), color: '#a8a39a' },
      { geo: box(1, 0.002, 0.008), matrix: m4(0, 0.05, 0.225), color: '#f2c94c' },
      { geo: box(0.45, 0.26, 0.25), matrix: m4(0, 0, -0.1), color: null },
      { geo: new THREE.CylinderGeometry(0, 0.36, 0.13, 4, 1).rotateY(Math.PI / 4).scale(1.4, 1, 0.82).translate(0, 0.325, -0.1), color: roof },
      { geo: merge([...canopyPosts, [box(0.9, 0.012, 0.15), m4(0, 0.22, 0.15)]]), color: '#5b6470' },
      { geo: box(0.07, 0.46, 0.07), matrix: m4(0.2, 0, -0.1), color: '#d9c7a5' },
      { geo: cone(0.06, 0.08, 4), matrix: m4(0.2, 0.46, -0.1, 1, 1, 1, Math.PI / 4), color: roof },
    ];
  }
  return S;
}

// stable pseudo random in 0..1 from a string id
export function idHash(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export { UP };
