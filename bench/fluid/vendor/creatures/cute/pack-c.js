// Cute pack C — OWNED BY the phase-2 agent "pack-c". Only that agent edits this file.
// Fantasy & odd: Baby dragon, Ghost, Mushroom sprite, Cloud, Robot, Star.
//
// Effect meshes (smoke puffs, rain, rainbow, spores, sparkles) are made with fx()
// instead of spec parts, so they stay out of the kit's height normalisation and
// only cost tris while they are visible.

import { defineCreature, partGeometry } from './kit.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (q) => q * q * (3 - 2 * q);

/** Effect mesh on a socket, outside spec parts (no bbox / height effect). */
function fx(ctx, sock, p) {
  const m = new ctx.THREE.Mesh(partGeometry(p), ctx.mat(p.color));
  m.position.set(...(p.pos || [0, 0, 0]));
  if (p.rot) m.rotation.set(...p.rot);
  m.visible = false;
  ctx.socket(sock)[0].add(m);
  m.userData.basePos = m.position.clone();
  return m;
}
const st = (ctx) => (ctx.s ||= {});

/** Rounded box (superellipsoid) from a sphere: e < 1 squares it off. */
function roundBox(T, rx, ry, rz, w, h, e = 0.4) {
  const g = new T.SphereGeometry(1, w, h); const a = g.attributes.position;
  const f = (c) => Math.sign(c) * Math.pow(Math.abs(c), e);
  for (let i = 0; i < a.count; i++) a.setXYZ(i, f(a.getX(i)) * rx, f(a.getY(i)) * ry, f(a.getZ(i)) * rz);
  g.computeVertexNormals(); return g;
}

// ============================================================ Baby dragon
defineCreature({
  id: 'cute-dragon', name: 'Baby Dragon', archetype: 'Fantasy',
  roster: 'Mint hatchling — stubby horns, flappy wings, puffs smoke when startled',
  palette: { body: '#9edcb6', accent: '#ff9b7d', belly: '#fff6dc', wing: '#ffb89c', horn: '#fff3d6', toe: '#86c9a0', nostril: '#4e8a66', smoke: '#f6f3f8', eye: '#22202b', cheek: '#ff93a8', mouth: '#6b2a33' },
  body: { size: [0.26, 0.24, 0.25], at: [0, 0.25, -0.02], seg: [9, 6] },
  head: { size: [0.31, 0.28, 0.28], at: [0, 0.62, 0.05] },
  eyes: { x: 0.42, y: -0.02, r: 0.08 },
  mouth: { type: 'smile', y: -0.4, w: 0.042 },
  cheeks: { x: 0.64, y: -0.27, r: 0.045 },
  motion: { type: 'waddle', amp: 0.9 },
  sockets: { side: { pos: [0.17, 0.4, -0.15] } },
  parts: [
    { name: 'belly', type: 'ellipsoid', at: 'body', size: [0.165, 0.15, 0.03], pos: [0, 0.23, 0.222], color: 'belly', seg: [10, 5] },
    { name: 'horn', type: 'cone', at: 'horn', r: 0.045, h: 0.1, pos: [0, 0.035, 0], rot: [-0.15, 0, -0.32], color: 'horn', seg: 6 },
    { name: 'nostril', type: 'sphere', at: 'head', size: 0.012, pos: [0.022, -0.062, 0.27], color: 'nostril', seg: [4, 3], mirror: true },
    { name: 'fang', type: 'cone', at: 'head', r: 0.011, h: 0.026, pos: [0.022, -0.128, 0.25], rot: [Math.PI, 0, 0], color: 'white', seg: 4 },
    // bat wings: big lobe + small lobe, flat, pointing out and up
    { name: 'wing', type: 'teardrop', at: 'wing', size: [0.06, 0.15, 0.014], pos: [0.12, 0.075, 0], rot: [0, 0, -1.0], color: 'wing', seg: [6, 3] },
    { name: 'wing2', type: 'teardrop', at: 'wing', size: [0.045, 0.1, 0.014], pos: [0.1, -0.015, 0], rot: [0, 0, -1.7], color: 'wing', seg: [6, 3] },
    // curly tail with a spade tip
    { name: 'tail', type: 'teardrop', at: 'tail', size: [0.06, 0.13, 0.06], pinch: 0.7, pos: [0, 0.058, -0.1], rot: [-1.1, 0, 0], color: 'body', seg: [6, 4] },
    { name: 'spade', type: 'teardrop', at: 'tail', size: [0.055, 0.05, 0.018], pos: [0, 0.13, -0.235], rot: [-1.1, 0, 0], color: 'accent', seg: [5, 3] },
    // spine spikes (body + head crest)
    { name: 'spike', type: 'cone', at: 'body', r: 0.03, h: 0.06, pos: [0, 0.4, -0.215], rot: [-0.9, 0, 0], color: 'accent', seg: 4 },
    { name: 'spike', type: 'cone', at: 'body', r: 0.026, h: 0.05, pos: [0, 0.29, -0.265], rot: [-1.4, 0, 0], color: 'accent', seg: 4 },
    { name: 'spike', type: 'cone', at: 'head', r: 0.034, h: 0.065, pos: [0, 0.215, -0.18], rot: [-0.7, 0, 0], color: 'accent', seg: 4 },
    { name: 'spike', type: 'cone', at: 'head', r: 0.028, h: 0.05, pos: [0, 0.09, -0.265], rot: [-1.25, 0, 0], color: 'accent', seg: 4 },
    { name: 'foot', type: 'ellipsoid', at: 'foot', size: [0.07, 0.04, 0.08], pos: [0, 0.035, 0.02], color: 'toe', seg: [6, 3] },
  ],
  build(ctx) {
    const s = st(ctx);
    s.puffs = [1, -1, 1, -1].map((sx) => fx(ctx, 'head', { type: 'sphere', size: 1, color: 'smoke', seg: [5, 3], pos: [0.022 * sx, -0.06, 0.29] }));
    s.puffT = -1; s.wasSur = false;
  },
  update(ctx) {
    const s = st(ctx), { t, w } = ctx;
    // smoke puff: on surprise onset, and again every 2.6 s while surprised
    const sur = w.surprised > 0.5;
    if (sur && (!s.wasSur || t - s.puffT > 2.6)) s.puffT = t;
    s.wasSur = sur;
    const q = s.puffT < 0 ? 2 : (t - s.puffT) / 1.3;
    s.puffs.forEach((m, i) => {
      const qi = q - (i >> 1) * 0.25;
      m.visible = qi > 0 && qi < 1;
      if (!m.visible) return;
      const sx = i & 1 ? -1 : 1;
      // out to the sides and forward, below the eyes, then curl up
      const r = Math.sqrt(qi);
      m.position.set(sx * (0.03 + 0.27 * r), -0.075 + 0.2 * qi * qi, 0.3 + 0.1 * r);
      m.scale.setScalar(0.012 + 0.2 * qi * (1 - qi) * (1 - 0.3 * qi));
    });
    // happy: tail spade wiggles extra
    for (const m of ctx.part('spade')) m.rotation.z = 0.35 * w.happy * Math.sin(TAU * 5 * t);
  },
});

// ============================================================ Ghost
defineCreature({
  id: 'cute-ghost', name: 'Ghost', archetype: 'Spooky',
  roster: 'Floaty lavender boo — wavy hem, fades when drowsy, shivers when spooked',
  palette: { body: '#eee6ff', accent: '#c7b6ff', eye: '#2b2240', cheek: '#ffa0c4', mouth: '#3b2a55', tongue: '#ff8fb0' },
  head: { size: [0.36, 0.36, 0.33], at: [0, 0.56, 0], seg: [12, 8], pitch: 0.5 },
  eyes: { x: 0.36, y: -0.02, r: 0.08, shape: 'tall' },
  mouth: { type: 'smile', y: -0.3, w: 0.04 },
  cheeks: { x: 0.6, y: -0.24, r: 0.045 },
  motion: { type: 'float', height: 0.1, amp: 1.2 },
  parts: [
    { name: 'skirt', type: 'custom', at: 'head', pos: [0, -0.2, 0], color: 'body', geometry: (T) => new T.CylinderGeometry(0.33, 0.38, 0.24, 12, 1, true) },
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i + 0.5) * TAU / 6;
      return { name: 'hem', type: 'ellipsoid', at: 'head', size: [0.1, 0.08, 0.1], pos: [0.355 * Math.sin(a), -0.32, 0.355 * Math.cos(a)], color: 'body', seg: [7, 4] };
    }),
    { name: 'arm', type: 'ellipsoid', at: 'arm', size: [0.07, 0.042, 0.05], pos: [0.03, 0, 0.03], rot: [0, 0, -0.35], color: 'body', seg: [6, 3] },
  ],
  build(ctx) {
    const m = ctx.mat('body'); m.transparent = true; m.emissive = new ctx.THREE.Color('#2c2452'); // soft ghostly glow
  },
  update(ctx) {
    const { t, w } = ctx;
    const hem = ctx.part('hem');
    hem.forEach((m, i) => {
      const b = m.userData.basePos;
      m.position.y = b.y + 0.022 * Math.sin(TAU * (1.1 + 0.6 * w.happy) * t - i * 1.05) * (1 - 0.7 * w.sleepy);
      m.scale.y = 1 + 0.15 * Math.sin(TAU * 1.1 * t - i * 1.05 + 0.8);
    });
    // fade: gentle shimmer, half-transparent when sleepy
    ctx.mat('body').opacity = clamp(0.93 + 0.05 * Math.sin(TAU * 0.45 * t) - 0.4 * w.sleepy, 0.45, 1);
    // spooked: shiver
    const c = ctx.creature;
    c.root.position.x += 0.012 * w.surprised * Math.sin(TAU * 13 * t);
  },
});

// ============================================================ Mushroom sprite
const CAP = [0.44, 0.3, 0.42];
defineCreature({
  id: 'cute-shroom', name: 'Mushroom', archetype: 'Forest sprite',
  roster: 'Tiny spotted toadstool — boingy cap, puffs spores when happy',
  palette: { body: '#f2706e', accent: '#fff8ee', skin: '#fff0dc', gill: '#f3d6bd', nub: '#f6dcc0', spore: '#fff4a8', eye: '#2c1d1d', cheek: '#ff9aa6', mouth: '#6b2a2a' },
  body: { size: [0.15, 0.15, 0.14], at: [0, 0.15, 0], color: 'skin', seg: [7, 5] },
  head: { size: [0.28, 0.24, 0.26], at: [0, 0.43, 0.02], color: 'skin', seg: [10, 7] },
  eyes: { x: 0.4, y: -0.2, r: 0.07 },
  mouth: { type: 'smile', y: -0.52, w: 0.034 },
  cheeks: { x: 0.62, y: -0.42, r: 0.04 },
  motion: { type: 'wiggle', amp: 1.3, rate: 1.2 },
  parts: [
    { name: 'cap', type: 'custom', at: 'top', pos: [0, -0.08, -0.01], color: 'body',
      geometry: (T) => { const g = new T.SphereGeometry(1, 12, 4, 0, TAU, 0, Math.PI * 0.5); g.scale(...CAP); return g; } },
    { name: 'arm', type: 'ellipsoid', at: 'arm', size: [0.045, 0.035, 0.04], pos: [0.02, -0.01, 0.02], color: 'nub', seg: [5, 3] },
    { name: 'foot', type: 'ellipsoid', at: 'foot', size: [0.06, 0.035, 0.065], pos: [0, 0.03, 0.01], color: 'nub', seg: [6, 3] },
  ],
  build(ctx) {
    const T = ctx.THREE, cap = ctx.part('cap')[0], s = st(ctx);
    // gills under the brim + white spots on the dome, children of the cap so they boing with it
    const gill = new T.Mesh(new T.CircleGeometry(1, 12).rotateX(Math.PI / 2).scale(CAP[0] * 0.98, 1, CAP[2] * 0.98), ctx.mat('gill'));
    gill.position.y = 0.002; cap.add(gill);
    const spots = [[0, 0, 0.07], [0.95, 0, 0.065], [0.8, 1.2, 0.055], [0.8, -1.2, 0.055], [1.1, 2.2, 0.06], [1.1, -2.2, 0.06], [0.85, Math.PI, 0.06], [1.25, 0.75, 0.04], [1.25, -0.75, 0.04]];
    const disc = new T.CircleGeometry(1, 7), q = new T.Quaternion(), Z = new T.Vector3(0, 0, 1);
    for (const [p, a, r] of spots) {
      const v = new T.Vector3(CAP[0] * Math.sin(p) * Math.sin(a), CAP[1] * Math.cos(p), CAP[2] * Math.sin(p) * Math.cos(a));
      const n = new T.Vector3(v.x / CAP[0] ** 2, v.y / CAP[1] ** 2, v.z / CAP[2] ** 2).normalize();
      const m = new T.Mesh(disc, ctx.mat('accent'));
      m.position.copy(v).addScaledVector(n, 0.004); m.quaternion.copy(q.setFromUnitVectors(Z, n)); m.scale.setScalar(r);
      cap.add(m);
    }
    s.spores = [0, 1, 2, 3].map(() => fx(ctx, 'top', { type: 'custom', color: 'spore', geometry: (TT) => new TT.OctahedronGeometry(0.018, 0) }));
    s.jig = 0; s.jv = 0; s.lastY = 0;
  },
  update(ctx) {
    const { t, dt, w } = ctx, s = st(ctx), c = ctx.creature, cap = ctx.part('cap')[0];
    // cap jiggle spring, kicked by vertical motion + head tilt
    const y = c.root.position.y + c.bodyG.scale.y * 0.3;
    if (dt > 0) { s.jv += (-160 * s.jig - 6 * s.jv + (y - s.lastY) / dt * 4) * dt; s.jig = clamp(s.jig + s.jv * dt, -0.25, 0.25); }
    s.lastY = y;
    const k = s.jig + 0.06 * w.happy * Math.sin(TAU * 3.2 * t);
    cap.scale.set(1 + k * 0.5, 1 - k, 1 + k * 0.5);
    // surprised: cap pops up; sleepy: cap droops forward like a nightcap
    cap.position.y = cap.userData.basePos.y + 0.06 * w.surprised;
    cap.rotation.set(0.14 * w.sleepy + ctx.lag.x * 0.5, 0, ctx.lag.z * 0.6 + 0.1 * w.sleepy);
    // happy: spores drift up from the cap
    s.spores.forEach((m, i) => {
      const q = ((t * 0.55 + i / 4) % 1);
      const on = w.happy > 0.3 || w.surprised > 0.6;
      m.visible = on;
      if (!on) return;
      const a = i * 1.7 + 0.6;
      m.position.set(Math.sin(a) * (0.12 + 0.1 * q) + 0.03 * Math.sin(TAU * 2 * q + i), 0.1 + 0.32 * q, Math.cos(a) * 0.12 * (1 - q));
      m.scale.setScalar(Math.sin(Math.PI * q) * 1.2);
      m.rotation.y = t * 3 + i;
    });
  },
});

// ============================================================ Cloud
const PUFFS = [
  [[0.21, 0.2, 0.2], [-0.07, 0.2, -0.04]], [[0.17, 0.16, 0.16], [0.17, 0.15, -0.03]],
  [[0.15, 0.14, 0.15], [-0.3, 0.08, -0.04]], [[0.14, 0.13, 0.14], [0.36, -0.01, -0.02]],
  [[0.13, 0.12, 0.13], [-0.38, -0.07, -0.02]], [[0.13, 0.1, 0.13], [-0.17, -0.2, 0]], [[0.15, 0.1, 0.13], [0.13, -0.21, 0]],
];
defineCreature({
  id: 'cute-cloud', name: 'Cloud', archetype: 'Sky',
  roster: 'Fluffy drifting puff — rainbow when happy, drizzles when drowsy',
  palette: { body: '#fbfdff', accent: '#a9d4ff', rain: '#78c2ff', r1: '#ff9fa8', r2: '#ffe08a', r3: '#9fdcff', eye: '#283048', cheek: '#ffa3bd', mouth: '#4a3048' },
  head: { size: [0.4, 0.26, 0.28], at: [0, 0.5, 0], seg: [12, 7], pitch: 0.4 },
  eyes: { x: 0.36, y: -0.08, r: 0.072 },
  mouth: { type: 'cat', y: -0.4, w: 0.034 },
  cheeks: { x: 0.62, y: -0.3, r: 0.042 },
  motion: { type: 'float', height: 0.12, rate: 0.7, amp: 1.3 },
  limbs: { ear: 0 },
  parts: PUFFS.map(([size, pos]) => ({ name: 'puff', type: 'ellipsoid', at: 'head', size, pos, color: 'body', seg: [7, 4] })),
  build(ctx) {
    const s = st(ctx);
    s.drops = [0, 1].map(() => fx(ctx, 'root', { type: 'teardrop', size: [0.035, 0.055, 0.035], pinch: 0.8, color: 'rain', seg: [6, 4] }));
    s.bow = ['r1', 'r2', 'r3'].map((k, i) => fx(ctx, 'head', { type: 'torus', R: 0.6 - i * 0.055, tube: 0.026, tubular: 9, arc: Math.PI, color: k, pos: [0, -0.12, -0.22] }));
    s.base = new ctx.THREE.Color(); s.grey = new ctx.THREE.Color('#c3cbdc');
  },
  update(ctx) {
    const { t, w } = ctx, s = st(ctx), c = ctx.creature;
    // fluffy breathing puffs; surprised: they poof out
    ctx.part('puff').forEach((m, i) => m.scale.setScalar(1 + (0.035 + 0.04 * w.happy) * Math.sin(TAU * 0.5 * t + i * 1.3) + 0.12 * w.surprised));
    // drowsy: greyer
    ctx.mat('body').color.set(c.palette.body).lerp(s.grey, 0.7 * w.sleepy);
    // happy: rainbow rises behind
    s.bow.forEach((m, i) => { const k = clamp(w.happy * 1.2 - i * 0.08, 0, 1); m.visible = k > 0.05; m.scale.setScalar(Math.max(0.01, ease(k))); });
    // sleepy: raindrops fall to the floor
    const floor = -c.root.position.y / c.norm.scale.y;
    s.drops.forEach((m, i) => {
      const q = (t / 1.4 + i * 0.5) % 1, on = w.sleepy > 0.4;
      m.visible = on; if (!on) return;
      const x = i ? 0.14 : -0.12, y0 = 0.22;
      const fall = Math.min(1, q / 0.75), y = y0 + (floor + 0.03 - y0) * fall * fall;
      m.position.set(x, y, 0.04);
      if (q < 0.75) m.scale.set(1, 1 + 0.4 * fall, 1); else { const k = (q - 0.75) / 0.25; m.scale.set(1 + 1.5 * k, 0.3 * (1 - k) + 0.01, 1 + 1.5 * k); }
    });
  },
});

// ============================================================ Robot
const helix = (T, r, h, turns, tube) => {
  class Helix extends T.Curve { getPoint(u, o = new T.Vector3()) { const a = TAU * turns * u; return o.set(r * Math.cos(a), h * u, r * Math.sin(a)); } }
  return new T.TubeGeometry(new Helix(), Math.round(turns * 6), tube, 3, false);
};
const SPRING_H = 0.14;
defineCreature({
  id: 'cute-robot', name: 'Robot', archetype: 'Machine',
  roster: 'Boxy screen-face bot on a pogo spring — mood light antenna',
  palette: { body: '#c5d2ee', accent: '#ffab6e', screen: '#27304a', metal: '#9aa6c4', light: '#ffd166', eye: '#7ff3ff', white: '#dffcff', cheek: '#ff86b0', mouth: '#7ff3ff', tongue: '#ff86b0' },
  body: { type: 'custom', size: [0.17, 0.12, 0.14], at: [0, 0.3, 0], geometry: (T) => roundBox(T, 0.17, 0.12, 0.14, 8, 6, 0.45) },
  head: { type: 'custom', size: [0.34, 0.27, 0.28], at: [0, 0.66, 0], geometry: (T) => roundBox(T, 0.34, 0.27, 0.28, 12, 8, 0.38), pitch: 0.5 },
  face: { r: [0.25, 0.19, 0.02], offset: [0, 0.01, 0.288] },
  eyes: { x: 0.48, y: 0.05, r: 0.068, shape: 'wide' },
  mouth: { type: 'smile', y: -0.5, w: 0.036 },
  cheeks: { x: 0.76, y: -0.38, r: 0.03 },
  motion: { type: 'hop', rate: 1.35, amp: 1.1 },
  limbs: { ear: 0.2 },
  sockets: { ear: { pos: [0.34, 0.66, 0] }, side: { pos: [0.165, 0.33, 0] } },
  parts: [
    { name: 'screen', type: 'custom', at: 'head', pos: [0, 0.01, 0.272], color: 'screen', geometry: (T) => roundBox(T, 0.255, 0.195, 0.016, 8, 4, 0.3) },
    { name: 'dial', type: 'cylinder', at: 'ear', r: 0.065, h: 0.05, pos: [0.012, 0, 0], rot: [0, 0, Math.PI / 2], color: 'accent', seg: 6 },
    { name: 'stalk', type: 'custom', at: 'top', pos: [0, -0.01, 0], color: 'metal', geometry: (T) => new T.CylinderGeometry(0.012, 0.014, 0.13, 4).translate(0, 0.065, 0) },
    { name: 'light', type: 'sphere', at: 'top', size: 0.042, pos: [0, 0.155, 0], color: 'light', seg: [6, 4] },
    { name: 'arm', type: 'cylinder', at: 'arm', r: 0.022, h: 0.11, pos: [0.025, -0.05, 0], rot: [0, 0, 0.35], color: 'metal', seg: 5 },
    { name: 'hand', type: 'sphere', at: 'arm', size: 0.04, pos: [0.05, -0.11, 0], color: 'accent', seg: [5, 3] },
    { name: 'spring', type: 'custom', at: 'body', pos: [0, 0.04, 0], color: 'metal', geometry: (T) => helix(T, 0.06, SPRING_H, 3.5, 0.013) },
    { name: 'pad', type: 'cylinder', at: 'root', r: 0.1, h: 0.04, pos: [0, 0.02, 0], color: 'accent', seg: 8 },
  ],
  build(ctx) {
    const s = st(ctx), T = ctx.THREE;
    // ball rides on the stalk so the antenna sways as one piece
    const stalk = ctx.part('stalk')[0], ball = ctx.part('light')[0];
    stalk.add(ball); ball.position.set(0, 0.145, 0); ball.userData.basePos = ball.position.clone();
    const lm = ctx.mat('light'); lm.emissive = new T.Color('#000000');
    s.cols = { idle: '#ffd166', listening: '#7ff3ff', thinking: '#b892ff', speaking: '#7ff3ff', happy: '#7cf29a', sleepy: '#57506e', surprised: '#ff5d73' };
    for (const k in s.cols) s.cols[k] = new T.Color(s.cols[k]);
    s.c = new T.Color(); s.spin = 0;
  },
  update(ctx) {
    const { t, dt, w, pose } = ctx, s = st(ctx), c = ctx.creature;
    // antenna: springy sway + mood light
    for (const m of ctx.part('stalk')) m.rotation.set(ctx.lag.x * 1.8, 0, ctx.lag.z * 2 + 0.06 * Math.sin(TAU * 0.8 * t));
    s.c.setRGB(0, 0, 0);
    for (const k in s.cols) s.c.r += s.cols[k].r * w[k], s.c.g += s.cols[k].g * w[k], s.c.b += s.cols[k].b * w[k];
    const blink = w.thinking * (Math.sin(TAU * 3 * t) > 0 ? 1 : 0.35) + w.idle * (0.75 + 0.25 * Math.sin(TAU * 0.8 * t)) + w.speaking * (0.5 + 0.8 * (pose?.mouth || 0))
      + w.listening + w.happy + w.surprised * (Math.sin(TAU * 6 * t) > 0 ? 1 : 0.4) + w.sleepy * 0.6;
    const lm = ctx.mat('light'); lm.color.copy(s.c); lm.emissive.copy(s.c).multiplyScalar(0.55 * clamp(blink, 0, 1.2));
    // ear dials whirr while thinking / happy
    s.spin += dt * (1.2 + 9 * w.thinking + 6 * w.happy) * (1 - 0.9 * w.sleepy);
    for (const m of ctx.part('dial')) m.rotation.set(s.spin * m.userData.side, 0, Math.PI / 2);
    // pogo spring: pad stays on the floor, spring stretches between pad and body
    const jump = Math.max(0, c.root.position.y - c._lift) / c.norm.scale.y;
    const sy = c.bodyG.scale.y, pad = ctx.part('pad')[0], spring = ctx.part('spring')[0];
    pad.position.y = 0.02 - jump;
    const bottom = 0.04 - jump, top = 0.18; // body-local (the body group squashes about the floor)
    spring.position.y = bottom / sy;
    spring.scale.set(1, clamp((top - bottom / sy) / SPRING_H, 0.4, 3), 1);
  },
});

// ============================================================ Star
const STAR_R = 0.46, STAR_IN = 0.58, STAR_Z = 0.17;
function starGeo(T) {
  const g = new T.SphereGeometry(1, 30, 7, -Math.PI / 2); g.rotateX(Math.PI / 2);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i), rho = Math.hypot(x, y);
    const th = Math.atan2(x, y);
    const tip = Math.pow(0.5 + 0.5 * Math.cos(5 * th), 1.3), s = STAR_IN + (1 - STAR_IN) * tip;
    a.setXYZ(i, x * s * STAR_R, y * s * STAR_R, z * STAR_Z * (1 - 0.45 * tip * rho));
  }
  g.computeVertexNormals(); return g;
}
defineCreature({
  id: 'cute-star', name: 'Star', archetype: 'Celestial',
  roster: 'Plush five-point star — twinkle-spins and sparkles, dims to dusk when sleepy',
  palette: { body: '#ffe08a', accent: '#ffb23f', sparkle: '#fffbe0', eye: '#3a2a1c', cheek: '#ff8f8f', mouth: '#7a3a22' },
  head: { type: 'custom', size: [STAR_R, STAR_R, STAR_Z], at: [0, 0.5, 0], geometry: starGeo, pitch: 0.4 },
  face: { r: [STAR_R * STAR_IN, STAR_R * STAR_IN, STAR_Z] },
  eyes: { x: 0.46, y: 0.0, r: 0.072 },
  mouth: { type: 'smile', y: -0.4, w: 0.03 },
  cheeks: { x: 0.74, y: -0.26, r: 0.034 },
  motion: { type: 'float', height: 0.07, rate: 1.2 },
  parts: [],
  build(ctx) {
    const s = st(ctx);
    const sp = [[0.42, 1.0], [-0.5, 0.82], [0.56, 0.4], [-0.55, 0.22], [0.1, 1.12]];
    s.sparks = sp.map(([x, y]) => {
      const m = fx(ctx, 'root', { type: 'custom', color: 'sparkle', pos: [x, y, 0.05],
        geometry: (T) => { const a = new T.OctahedronGeometry(1, 0).scale(0.022, 0.07, 0.02); return a; } });
      const m2 = new ctx.THREE.Mesh(new ctx.THREE.OctahedronGeometry(1, 0).scale(0.07, 0.022, 0.02), ctx.mat('sparkle'));
      m.add(m2); return m;
    });
    s.spinT = -1; s.next = 3; s.dusk = new ctx.THREE.Color('#c4b3ea');
  },
  update(ctx) {
    const { t, w, pose } = ctx, s = st(ctx), c = ctx.creature;
    // twinkle spin: a full turn every few seconds (more often when happy)
    if (s.spinT < 0 && t > s.next && w.idle + w.happy > 0.6) s.spinT = t;
    let ang = 0;
    if (s.spinT >= 0) {
      const q = (t - s.spinT) / 0.9;
      if (q >= 1) { s.spinT = -1; s.next = t + (w.happy > 0.5 ? 1.6 : 5 + Math.random() * 3); } else ang = TAU * ease(q);
    }
    c.root.rotation.y += ang;
    // sparkles: twinkle around the star
    s.sparks.forEach((m, i) => {
      const tw = Math.max(0, Math.sin(TAU * (0.6 + 0.13 * i) * t + i * 2.1));
      const k = (0.45 * w.idle + 0.3 * w.listening + 0.4 * w.thinking + (0.4 + 1.2 * (pose?.mouth || 0)) * w.speaking + 1.1 * w.happy + 1.3 * w.surprised) * tw;
      m.visible = k > 0.08;
      m.scale.setScalar(k); m.rotation.z = t * 0.8 + i;
    });
    // sleepy: dims to dusk lavender
    ctx.mat('body').color.set(c.palette.body).lerp(s.dusk, 0.75 * w.sleepy);
  },
});
