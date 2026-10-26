// Pack D: bugs, birds and small garden friends. All special rigs stay local.
import { defineCreature } from './kit.js';

const ball = (name, at, size, pos, color, seg = [6, 4], extra = {}) =>
  ({ name, type: 'ellipsoid', at, size, pos, color, seg, ...extra });
const tuft = (name, at, size, pos, color, extra = {}) =>
  ({ ...ball(name, at, size, pos, color, [5, 3]), type: 'teardrop', ...extra });
const stem = (name, at, h, pos, color, extra = {}) =>
  ({ name, type: 'cylinder', at, h, r: 0.013, seg: 5, pos, color, ...extra });

// Honey stripes wrap the abdomen; fuzzy crown and milky wings soften the outline.
defineCreature({
  id: 'cute-bee', name: 'Bee', archetype: 'Fuzzy pollinator',
  roster: 'A honey puff with milky wings and an excited little buzz.',
  palette: { body: '#ffd65c', accent: '#5e4033', stripe: '#5e4033', wing: '#f4fbff', cheek: '#ff9fae', eye: '#2b1d1a' },
  body: { size: [0.27, 0.25, 0.27], at: [0, 0.29, -0.05], seg: [8, 5] },
  head: { size: [0.31, 0.29, 0.28], at: [0, 0.64, 0.06], seg: [10, 6] },
  eyes: { x: 0.43, y: -0.06, r: 0.078, shape: 'tall' },
  mouth: { type: 'smile', y: -0.36, w: 0.036 },
  motion: { type: 'flutter', height: 0.07, amp: 0.65 },
  sockets: { side: [0.2, 0.47, -0.16] },
  parts: [
    ...[[0.19, 0.235], [0.35, 0.248]].map(([y, R]) => ({ name: 'stripe', type: 'torus', at: 'body', R, tube: 0.045, radial: 3, tubular: 8, pos: [0, y, -0.05], rot: [Math.PI / 2, 0, 0], color: 'stripe' })),
    ball('stinger', 'tail', [0.03, 0.03, 0.05], [0, -0.04, -0.02], 'stripe', [5, 3]),
    tuft('wing', 'side', [0.12, 0.2, 0.035], [0.1, 0.13, 0], 'wing', { rot: [0.25, 0, -0.85], seg: [6, 4], pinch: 0.45 }),
    stem('feelers', 'antenna', 0.13, [0, 0.055, 0], 'accent', { rot: [0, 0, -0.3] }),
    ball('pollen', 'antenna', 0.034, [0.02, 0.12, 0], 'accent', [5, 3]),
    ...[-1, 1].map((x) => tuft('fuzz', 'top', [0.04, 0.055, 0.04], [x * 0.052, 0.015, 0], 'body', { rot: [0, 0, x * -0.4] })),
    ball('feet', 'foot', [0.05, 0.025, 0.06], [0, 0.04, 0], 'accent', [5, 3]),
  ],
  update({ socket, t, w }) {
    socket('side').forEach((g, i) => { g.rotation.z = (i ? -1 : 1) * (0.25 + (0.35 + 0.2 * w.happy) * Math.sin(t * 48)) * (1 - 0.93 * w.sleepy); });
  },
});

// A red dome shell (two hinged halves, spots ride on them) behind a cream face in a
// dark cap; when happy the halves lift like elytra and little wings flick out.
const LB = { c: [0, 0.44, -0.1], r: [0.34, 0.32, 0.34] };
const lbSpots = [[0.6, 2.0], [0.2, 1.35], [1.0, 0.7], [0.3, 2.65]]; // [elevation, azimuth from +z toward +x]
defineCreature({
  id: 'cute-ladybug', name: 'Ladybug', archetype: 'Spotted beetle',
  roster: 'A strawberry dome that lifts its polka-dot shell when delighted.',
  palette: { body: '#ffe6d8', accent: '#f2545b', cap: '#3d3346', spot: '#2f2834', fly: '#f0e6ff', cheek: '#ff9aa8', eye: '#241c2a' },
  body: { size: [0.3, 0.2, 0.3], at: [0, 0.2, -0.1], seg: [6, 3], color: 'cap' },
  head: { size: [0.27, 0.25, 0.24], at: [0, 0.42, 0.2], seg: [10, 6], pitch: 0.4 },
  eyes: { x: 0.41, y: -0.12, r: 0.072, shape: 'wide' },
  mouth: { type: 'smile', y: -0.47, w: 0.032 },
  cheeks: { x: 0.64, y: -0.36, r: 0.042 },
  motion: { type: 'waddle', amp: 0.6 },
  parts: [
    ball('cap', 'head', [0.285, 0.19, 0.25], [0, 0.15, -0.035], 'cap', [8, 4]),
    ...[1, -1].flatMap((s) => [
      { name: `shell${s}`, type: 'custom', at: 'body', color: 'accent', pos: [0, LB.c[1] + LB.r[1], LB.c[2]],
        geometry(T) { const g = new T.SphereGeometry(1, 8, 5, s === 1 ? Math.PI / 2 : -Math.PI / 2, Math.PI); g.scale(...LB.r); g.translate(0, -LB.r[1], 0); return g; } },
      ...lbSpots.map(([e, a]) => ball(`spot${s}`, 'body', 0.058, [s * Math.cos(e) * Math.sin(a) * LB.r[0] * 0.96, LB.c[1] + Math.sin(e) * LB.r[1] * 0.96, LB.c[2] + Math.cos(e) * Math.cos(a) * LB.r[2] * 0.96], 'spot', [5, 2])),
      tuft(`fly${s}`, 'body', [0.11, 0.2, 0.025], [s * 0.12, LB.c[1] + 0.1, LB.c[2] - 0.12], 'fly', { rot: [-0.5, 0, s * -0.9], seg: [6, 3], pinch: 0.5 }),
    ]),
    // long feelers: they make the squat beetle taller, so height-normalisation does not over-zoom it
    stem('feelers', 'antenna', 0.24, [0.04, 0.11, 0], 'cap', { rot: [0, 0, -0.35] }),
    ball('tips', 'antenna', 0.036, [0.085, 0.225, 0], 'accent', [5, 3]),
    ball('feet', 'foot', [0.05, 0.025, 0.05], [0, 0.025, 0.04], 'cap', [4, 2]),
  ],
  build({ part }) {
    for (const s of [1, -1]) {
      const shell = part(`shell${s}`)[0];
      for (const spot of part(`spot${s}`)) { spot.position.sub(shell.position); shell.add(spot); }
      for (const f of part(`fly${s}`)) f.scale.setScalar(0.001);
    }
  },
  update({ creature, part, w, t }) {
    // A hard-shelled beetle squashes less: the tall dome otherwise stretches out of frame on happy hops.
    for (const g of [creature.bodyG, creature.headPivot]) { const k = 0.4; g.scale.set(1 + (g.scale.x - 1) * k, 1 + (g.scale.y - 1) * k, 1 + (g.scale.z - 1) * k); }
    const open = w.happy * (0.42 + 0.06 * Math.sin(t * 10)) + 0.15 * w.surprised;
    for (const s of [1, -1]) {
      const shell = part(`shell${s}`)[0]; shell.rotation.z = s * open; shell.rotation.x = -0.1 * open;
      for (const f of part(`fly${s}`)) { f.visible = w.happy > 0.05; f.scale.setScalar(0.001 + w.happy); f.rotation.z = f.userData.baseRot.z - s * 0.35 * w.happy * Math.sin(t * 40); }
    }
  },
});

// A front-facing spiral is readable even at the fixed round device camera angle.
defineCreature({
  id: 'cute-snail', name: 'Snail', archetype: 'Spiral daydreamer',
  roster: 'A pistachio wanderer with a peach swirl and curious eye stalks.',
  palette: { body: '#c8e8b3', accent: '#ffcfb5', spiral: '#c18291', cheek: '#f5a6b1' },
  body: { size: [0.42, 0.10, 0.25], at: [0, 0.11, 0], seg: [8, 3] },
  head: { size: [0.22, 0.20, 0.22], at: [0.25, 0.29, 0.16], seg: [8, 5], pitch: 0.3 },
  eyes: { x: 0.55, y: 0.85, r: 0.058 },
  mouth: { type: 'smile', y: -0.25, w: 0.036 },
  cheeks: { x: 0.68, y: -0.08, r: 0.036 },
  motion: { type: 'slither', amp: 0.5, rate: 0.65 },
  parts: [
    ball('shell', 'body', [0.31, 0.32, 0.20], [-0.15, 0.40, -0.015], 'accent', [10, 6]),
    { name: 'spiral', type: 'custom', at: 'body', color: 'spiral', pos: [-0.15, 0.40, 0.185], geometry(T) { const pts = []; for (let i = 0; i <= 24; i++) { const q = i / 24, a = q * Math.PI * 4.3, r = 0.025 + 0.235 * q; pts.push(new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, -0.065 * q * q)); } return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.013, 3, false); } },
    ...[1, -1].flatMap((s) => [
      stem(`stalk${s}`, 'head', 0.19, [s * 0.12, 0.21, 0.11], 'body', { r: 0.022, rot: [0.18, 0, s * -0.2] }),
      ball(`eyecup${s}`, 'head', [0.079, 0.077, 0.06], [s * 0.14, 0.30, 0.13], 'body', [6, 3]),
    ]),
  ],
  update({ face, part, t, w, pose }) {
    for (const e of face.eyes) {
      const sway = Math.sin(t * 2.2 + e.side) * 0.015 * (1 - w.sleepy);
      e.g.position.set(e.side * 0.14 + sway, 0.30 - 0.07 * w.sleepy, 0.194);
      e.g.rotation.set(0, 0, 0);
      const cup = part(`eyecup${e.side}`)[0]; cup.position.x = e.side * 0.14 + sway; cup.position.y = e.g.position.y;
      // Keep the kit's gaze channel while mounting the eyes on moving stalks.
      e.g.position.x += pose.look.x * 0.018; e.g.position.y += pose.look.y * 0.015;
      const stalk = part(`stalk${e.side}`)[0]; stalk.scale.y = 1 - 0.35 * w.sleepy; stalk.rotation.z = -e.side * 0.2 - sway * 3;
    }
  },
});

defineCreature({
  id: 'cute-owl', name: 'Owl', archetype: 'Moonlit owlet',
  roster: 'A lavender owlet with enormous cream spectacles and a curious swivel.',
  palette: { body: '#c6b9e4', accent: '#9986be', belly: '#fff0d8', beak: '#f8c484', cheek: '#f4afc7' },
  body: { size: [0.26, 0.25, 0.24], at: [0, 0.28, -0.02], seg: [8, 5] },
  head: { size: [0.35, 0.29, 0.27], at: [0, 0.65, 0.03], seg: [10, 6] },
  face: { offset: [0, 0, 0.043] },
  eyes: { x: 0.44, y: -0.05, r: 0.10, shape: 'round' },
  mouth: { type: 'jaw', y: -0.32, open: 0.6 },
  motion: { type: 'hop', amp: 0.35, rate: 0.6 },
  parts: [
    ball('mask', 'head', [0.156, 0.175, 0.055], [0.148, -0.005, 0.218], 'belly', [8, 4], { mirror: true, rot: [0, 0.25, -0.12] }),
    tuft('ears', 'ear', [0.072, 0.13, 0.06], [0.04, 0.055, 0], 'accent', { rot: [0, 0, -0.38] }),
    tuft('beak', 'head', [0.055, 0.08, 0.055], [0, -0.085, 0.28], 'beak', { rot: [Math.PI, 0, 0] }),
    ball('lowerBeak', 'jaw', [0.034, 0.022, 0.035], [0, -0.012, 0.03], 'beak', [5, 3]),
    ball('bib', 'body', [0.18, 0.20, 0.04], [0, 0.28, 0.196], 'belly', [8, 4]),
    tuft('wings', 'side', [0.06, 0.17, 0.11], [0.02, -0.06, 0], 'accent', { rot: [0, 0, 0.15], seg: [6, 4] }),
    ball('feet', 'foot', [0.06, 0.028, 0.075], [0, 0.026, 0.03], 'beak', [5, 3]),
  ],
  update({ creature, t, w }) { creature.headPivot.rotation.y += (0.18 + 0.2 * w.listening + 0.15 * w.thinking) * Math.sin(t * 0.9) * (1 - w.sleepy); },
});

// Rounded low-sided quills form a soft cloak; the whole cloak curls with the face.
const quills = [];
for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) {
  const a = -Math.PI * 0.12 + i / 4 * Math.PI * 1.24, y = 0.12 + row * 0.13;
  const x = Math.cos(a) * (0.29 - row * 0.035), z = -0.06 - Math.sin(a) * (0.24 - row * 0.035);
  quills.push(tuft('quill', 'head', [0.065, 0.13, 0.065], [x, y, z], row % 2 ? 'tip' : 'accent', { rot: [-0.45 - Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.8], seg: [4, 2], pinch: 0.65 }));
}
defineCreature({
  id: 'cute-hedgehog', name: 'Hedgehog', archetype: 'Pocket pincushion',
  roster: 'A cinnamon pincushion that tucks into a shy little ball.',
  palette: { body: '#f7e2cc', accent: '#9a735f', tip: '#c49a7e', nose: '#3a2b2b', cheek: '#f5a3ae', eye: '#2a1f1f' },
  head: { size: [0.32, 0.29, 0.29], at: [0, 0.34, 0], seg: [10, 6], pivot: [0, 0.32, 0], pitch: 0.4 },
  eyes: { x: 0.43, y: -0.02, r: 0.068, shape: 'wide' },
  mouth: { type: 'smile', y: -0.58, w: 0.03 },
  motion: { type: 'wiggle', amp: 0.6 },
  parts: [
    ball('cloak', 'head', [0.34, 0.31, 0.25], [0, 0.065, -0.13], 'accent', [8, 5]),
    ...quills,
    tuft('muzzle', 'head', [0.1, 0.11, 0.075], [0, -0.075, 0.235], 'body', { rot: [Math.PI / 2 - 0.15, 0, 0], seg: [7, 4], pinch: 0.55 }),
    ball('nose', 'head', [0.038, 0.032, 0.032], [0, -0.06, 0.35], 'nose', [6, 3]),
    ball('ears', 'ear', [0.075, 0.08, 0.04], [0.04, 0.025, 0.11], 'body', [6, 3]),
    ball('feet', 'foot', [0.065, 0.035, 0.07], [0, 0.028, 0.02], 'body', [5, 3]),
  ],
  update({ creature, part, w, t }) {
    const curl = w.surprised;
    creature.headPivot.rotation.x += curl * 1.9;
    creature.headPivot.position.y -= curl * 0.018;
    creature.root.rotation.z += curl * 0.22 * Math.sin(t * 4);
    for (const m of part('feet')) m.scale.setScalar(1 - 0.9 * curl);
  },
});

defineCreature({
  id: 'cute-caterpillar', name: 'Caterpillar', archetype: 'Inchworm parade',
  roster: 'A mint gumdrop train that ripples from tail to antenna tips.',
  palette: { body: '#b8e5d1', accent: '#7fc6b5', segment: '#d3e9a5', tip: '#e9b6d8', cheek: '#f4b0c7' },
  head: { size: [0.26, 0.27, 0.25], at: [0.29, 0.31, 0.10], seg: [10, 6], pitch: 0.35 },
  eyes: { x: 0.42, y: -0.09, r: 0.072, shape: 'tall' },
  mouth: { type: 'cat', y: -0.38, w: 0.03 },
  motion: { type: 'slither', amp: 0.25 },
  parts: [
    ...[0, 1, 2, 3].flatMap((i) => [
      ball(`segment${i}`, 'body', [0.17 - i * 0.015, 0.18 - i * 0.017, 0.20 - i * 0.014], [0.035 - i * 0.19, 0.205 - i * 0.012, -0.015 - i * 0.035], i % 2 ? 'segment' : 'accent', [8, 4]),
      ball(`toes${i}`, 'body', [0.06, 0.035, 0.05], [0.035 - i * 0.19, 0.04, 0.09 - i * 0.035], 'tip', [5, 3]),
    ]),
    stem('antenna', 'head', 0.14, [0.11, 0.28, 0], 'accent', { mirror: true, rot: [0, 0, -0.28] }),
    ball('tips', 'head', 0.038, [0.135, 0.355, 0], 'tip', [5, 3], { mirror: true }),
  ],
  update({ part, t, w }) {
    for (let i = 0; i < 4; i++) {
      const m = part(`segment${i}`)[0], b = m.userData.basePos;
      const a = (1 - w.sleepy) * (0.025 + 0.035 * w.happy), wave = Math.sin(t * (4 + 2 * w.happy) - i * 0.9);
      m.position.y = b.y + a * (1 + wave); m.position.x = b.x + a * Math.cos(t * 4 - i * 0.9);
      m.scale.y = 1 + a * wave * 2;
      part(`toes${i}`)[0].position.y = 0.04 + Math.max(0, wave) * a;
    }
  },
});
