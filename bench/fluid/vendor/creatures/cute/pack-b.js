// Cute pack B — OWNED BY the phase-2 agent "pack-b". Only that agent edits this file.
// Water & cold: Axolotl, Penguin, Octopus, Baby whale, Jellyfish, Crab.
// See README.md in this folder for the spec format.

import { defineCreature, partGeometry } from './kit.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const gate = (t, period, duty = 0.45) => clamp((Math.sin(TAU * t / period) + 1 - 2 * duty) * 3, 0, 1);

// A part whose -y end sits at its origin, so rotations swing it from the root
// (tentacles, fronds, legs, tails). `half` is half the part's length along y.
const hinged = (spec, half) => ({
  ...spec, type: 'custom',
  geometry: () => { const g = partGeometry(spec); g.translate(0, half, 0); return g; },
});
// Reset a mesh to its rest pose (update hooks write absolute poses on top).
const rest = (m) => { m.position.copy(m.userData.basePos); m.rotation.copy(m.userData.baseRot); m.scale.copy(m.userData.baseScale); };

// ------------------------------------------------------------------ Axolotl
// Wide smiley head, three frilly gill fronds per side that ripple (faster when
// happy, perk when listening, droop when sleepy), long finned tail, floats.
defineCreature({
  id: 'cute-axolotl', name: 'Axolotl', archetype: 'Amphibian',
  roster: 'Smiley pink axolotl — gill fronds ripple when it\'s happy',
  palette: { body: '#ffc2d4', accent: '#ff7fa8', gill: '#ff6f9c', belly: '#ffe4ec', fin: '#ffd3e0', eye: '#2b1a25', cheek: '#ff8fb0', mouth: '#7a2b45' },
  body: { size: [0.22, 0.17, 0.3], at: [0, 0.27, -0.13], seg: [8, 5] },
  head: { size: [0.38, 0.27, 0.3], at: [0, 0.5, 0.08], seg: [12, 7], pitch: 0.5 },
  eyes: { x: 0.5, y: 0.08, r: 0.066 },
  mouth: { type: 'smile', y: -0.3, w: 0.085 },
  cheeks: { x: 0.68, y: -0.22, r: 0.04 },
  motion: { type: 'float', height: 0.06, amp: 1.1 },
  sockets: { ear: { on: 'head', pos: [0.32, 0.55, 0.0] }, tail: { on: 'body', pos: [0, 0.29, -0.4] } },
  limbs: { ear: 0.7 },
  parts: [
    // gill fronds: 3 per side (ear sockets are paired → mirrored), pointing up-out, out, down-out
    hinged({ name: 'frond', at: 'ear', type: 'teardrop', size: [0.03, 0.085, 0.024], pinch: 0.7, pos: [0, 0.03, 0], rot: [0, 0, -0.35], color: 'gill', seg: [5, 3] }, 0.07),
    hinged({ name: 'frond', at: 'ear', type: 'teardrop', size: [0.032, 0.095, 0.024], pinch: 0.7, pos: [0.01, 0, -0.02], rot: [0, 0, -1.05], color: 'gill', seg: [5, 3] }, 0.08),
    hinged({ name: 'frond', at: 'ear', type: 'teardrop', size: [0.028, 0.08, 0.022], pinch: 0.7, pos: [0, -0.04, -0.03], rot: [0, 0, -1.75], color: 'gill', seg: [5, 3] }, 0.065),
    // belly
    { name: 'belly', type: 'ellipsoid', at: 'body', size: [0.17, 0.12, 0.25], pos: [0, 0.22, -0.09], color: 'belly', seg: [7, 4] },
    // front legs (side sockets) and hind legs
    hinged({ name: 'leg', at: 'side', type: 'teardrop', size: [0.035, 0.06, 0.035], pinch: 0.4, pos: [0, 0, 0.12], rot: [0.3, 0, -2.5], color: 'body', seg: [5, 3] }, 0.05),
    { name: 'hind', at: 'body', type: 'ellipsoid', size: [0.04, 0.05, 0.04], pos: [0.17, 0.13, -0.26], rot: [0, 0, 0.5], color: 'body', seg: [5, 3], mirror: true },
    // finned tail: stalk + a tall soft fin along it
    hinged({ name: 'tailStalk', at: 'tail', type: 'teardrop', size: [0.07, 0.15, 0.07], pinch: 0.85, rot: [-1.45, 0, 0], color: 'body', seg: [6, 3] }, 0.11),
    hinged({ name: 'tailFin', at: 'tail', type: 'teardrop', size: [0.012, 0.17, 0.08], pinch: 0.75, pos: [0, 0.02, 0], rot: [-1.5, 0, 0], color: 'fin', seg: [6, 3] }, 0.12),
    // dorsal frill
    { name: 'dorsal', at: 'body', type: 'teardrop', size: [0.012, 0.06, 0.12], pinch: 0.5, pos: [0, 0.43, -0.16], rot: [0, 0, 0], color: 'fin', seg: [5, 3] },
  ],
  update(ctx) {
    const { t, w } = ctx;
    const rate = 1.4 + 3.2 * w.happy + 0.8 * w.speaking - 1.1 * w.sleepy;
    const amp = 0.14 + 0.22 * w.happy + 0.08 * w.speaking + 0.06 * w.surprised - 0.1 * w.sleepy;
    const c = ctx.creature; c._ph = (c._ph || 0) + TAU * rate * ctx.dt;
    ctx.part('frond').forEach((m, i) => {
      rest(m); const k = i >> 1, side = m.userData.side;
      m.rotation.z += side * amp * Math.sin(c._ph + k * 1.1) - side * 0.25 * w.surprised;
      m.scale.y = m.userData.baseScale.y * (1 + 0.18 * w.happy + 0.12 * w.surprised);
    });
    for (const m of ctx.part('tailFin').concat(ctx.part('tailStalk'))) { rest(m); m.rotation.y += 0.12 * Math.sin(c._ph * 0.5); }
  },
});

// ------------------------------------------------------------------ Penguin
// Slate-blue egg with a white heart face and belly, a little orange beak that
// opens to talk, flippers that flap when happy, waddling orange feet.
defineCreature({
  id: 'cute-penguin', name: 'Penguin', archetype: 'Bird',
  roster: 'Waddly chick penguin — flaps its flippers when happy',
  palette: { body: '#5d6f9f', accent: '#ffa24a', belly: '#fffaf0', face: '#fffaf0', beak: '#ffa24a', beakLow: '#f08a30', eye: '#1f1a2a', cheek: '#ff9fb4', mouth: '#7a2e1f' },
  body: { size: [0.3, 0.29, 0.27], at: [0, 0.29, -0.02], seg: [9, 6] },
  head: { size: [0.31, 0.28, 0.28], at: [0, 0.69, 0.02], seg: [10, 7] },
  face: { r: [0.255, 0.215, 0.24], offset: [0, -0.04, 0.065] },
  eyes: { x: 0.42, y: 0.08, r: 0.07 },
  mouth: { type: 'jaw', y: -0.32, open: 0.55 },
  cheeks: { x: 0.66, y: -0.3, r: 0.04 },
  motion: { type: 'waddle', amp: 1.15 },
  parts: [
    { name: 'face', at: 'head', type: 'ellipsoid', size: [0.255, 0.215, 0.24], pos: [0, -0.04, 0.065], color: 'face', seg: [10, 6] },
    { name: 'belly', at: 'body', type: 'ellipsoid', size: [0.23, 0.24, 0.2], pos: [0, 0.27, 0.07], color: 'belly', seg: [10, 6] },
    { name: 'beak', at: 'head', type: 'cone', r: 0.042, h: 0.07, seg: 5, pos: [0, -0.095, 0.325], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.6], color: 'beak' },
    { name: 'beakLow', at: 'jaw', type: 'cone', r: 0.03, h: 0.05, seg: 5, pos: [0, -0.012, 0.02], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.5], color: 'beakLow' },
    // flippers hang from the shoulders (tip down), mirrored
    hinged({ name: 'flipper', at: 'wing', type: 'teardrop', size: [0.03, 0.12, 0.075], pinch: 0.7, rot: [0.1, 0, Math.PI - 0.32], color: 'body', seg: [6, 3] }, 0.1),
    { name: 'foot', at: 'foot', type: 'ellipsoid', size: [0.07, 0.025, 0.09], pos: [0, 0.022, 0.05], rot: [0, 0.35, 0], color: 'accent', seg: [6, 3] },
    { name: 'tail', at: 'tail', type: 'teardrop', size: [0.05, 0.07, 0.03], rot: [-2.1, 0, 0], color: 'body', seg: [5, 3] },
    { name: 'tuft', at: 'top', type: 'teardrop', size: [0.025, 0.055, 0.025], pos: [0.01, 0.03, 0], rot: [0, 0, -0.45], color: 'body', seg: [5, 3] },
  ],
  update(ctx) {
    // extra flipper flap when happy (on top of the kit's spread), little shiver when surprised
    const { t, w } = ctx;
    for (const m of ctx.part('flipper')) {
      rest(m);
      m.rotation.z += m.userData.side * (0.35 * w.happy * Math.max(0, Math.sin(TAU * 8 * t)) + 0.05 * w.surprised * Math.sin(TAU * 20 * t));
    }
  },
});

// ------------------------------------------------------------------ Octopus
// Tall lavender mantle, eight curly tentacles that bob in a wave, freckles,
// and an ink puff when surprised.
const OCTO_N = 8;
const octoTentacles = Array.from({ length: OCTO_N }, (_, i) => {
  const a = (i + 0.5) / OCTO_N * TAU, out = 0.75;
  return hinged({ name: 'tentacle', at: 'head', type: 'teardrop', size: [0.07, 0.12, 0.07], pinch: 0.45,
    pos: [0.19 * Math.sin(a), -0.25, 0.18 * Math.cos(a)], rot: [Math.PI - out, a, 0], rotOrder: 'YXZ', color: 'body', seg: [5, 3] }, 0.1);
});
const octoInk = [[0.0, 0.0, 0.0, 0.11], [0.12, 0.06, -0.02, 0.08], [-0.11, 0.08, 0.02, 0.085], [0.04, 0.17, -0.03, 0.07], [-0.05, -0.06, 0.03, 0.07]].map(([x, y, z, r]) =>
  ({ name: 'ink', at: 'root', type: 'sphere', size: r, pos: [0.42 + x, 0.42 + y, -0.1 + z], color: 'ink', seg: [6, 4], visible: false }));
defineCreature({
  id: 'cute-octopus', name: 'Octopus', archetype: 'Cephalopod',
  roster: 'Bobbly lavender octopus — puffs ink when startled',
  palette: { body: '#c6a8f2', accent: '#9b77e0', spot: '#e3d3ff', ink: '#5d4d80', eye: '#24183a', cheek: '#ff9cc4', mouth: '#4c2a5e' },
  head: { size: [0.34, 0.35, 0.32], at: [0, 0.55, 0], seg: [12, 8], pitch: 0.45 },
  eyes: { x: 0.37, y: -0.12, r: 0.083, shape: 'tall' },
  mouth: { type: 'cat', y: -0.42, w: 0.05 },
  cheeks: { x: 0.6, y: -0.38, r: 0.042 },
  motion: { type: 'float', height: 0.03, amp: 1.2, rate: 0.9 },
  parts: [
    ...octoTentacles,
    { name: 'spot', at: 'head', type: 'sphere', size: [0.05, 0.045, 0.03], pos: [0.15, 0.25, 0.14], rot: [-0.7, 0.5, 0], color: 'spot', seg: [6, 3] },
    { name: 'spot', at: 'head', type: 'sphere', size: [0.035, 0.032, 0.022], pos: [-0.2, 0.2, 0.15], rot: [-0.6, -0.6, 0], color: 'spot', seg: [6, 3] },
    { name: 'spot', at: 'head', type: 'sphere', size: [0.03, 0.028, 0.02], pos: [-0.06, 0.32, 0.08], rot: [-1.0, 0, 0], color: 'spot', seg: [6, 3] },
    ...octoInk,
  ],
  build(ctx) { const m = ctx.mat('ink'); m.transparent = true; m.opacity = 0.7; },
  update(ctx) {
    const { t, w, dt } = ctx, c = ctx.creature;
    const rate = 0.9 + 1.8 * w.happy + 0.6 * w.speaking - 0.6 * w.sleepy;
    const amp = 0.16 + 0.18 * w.happy + 0.06 * w.speaking - 0.1 * w.sleepy;
    c._ph = (c._ph || 0) + TAU * rate * dt;
    ctx.part('tentacle').forEach((m, i) => {
      rest(m);
      m.rotation.x -= amp * Math.sin(c._ph - i * (TAU / OCTO_N) * 2) + 0.35 * w.surprised - 0.15 * w.sleepy; // curl out when startled
    });
    // ink puff: starts when surprise rises, billows out and shrinks over ~1.4 s
    const ink = c._ink ||= { t: -1, armed: true };
    if (ink.armed && w.surprised > 0.3) { ink.t = 0; ink.armed = false; }
    if (w.surprised < 0.1) ink.armed = true;
    const puffs = ctx.part('ink');
    if (ink.t >= 0) {
      ink.t += dt; const q = ink.t / 1.4;
      puffs.forEach((m, i) => {
        rest(m); const qi = clamp(q * 1.2 - i * 0.06, 0, 1);
        m.visible = qi > 0 && qi < 1;
        m.scale.setScalar(Math.sin(Math.PI * Math.min(1, qi * 1.3)) * (0.6 + qi));
        m.position.x += 0.12 * qi; m.position.y += 0.1 * qi;
      });
      if (q >= 1.1) { ink.t = -1; for (const m of puffs) m.visible = false; }
    }
  },
});

// ------------------------------------------------------------------ Baby whale
// Round sky-blue whale, flukes peeking up behind its back,
// little fins, and a water spout when happy.
const SPOUT_DROPS = [[0.0, 1], [0.8, -1], [1.7, 1], [2.5, -1]];
defineCreature({
  id: 'cute-whale', name: 'Baby whale', archetype: 'Cetacean',
  roster: 'Chubby baby whale — blows a happy water spout',
  palette: { body: '#8fc4f2', accent: '#5f9fe0', water: '#9fe3ff', eye: '#1d2438', cheek: '#ff9fbf', mouth: '#2f3f6a' },
  head: { size: [0.42, 0.33, 0.4], at: [0, 0.36, 0.02], seg: [12, 8], pitch: 0.4 },
  eyes: { x: 0.44, y: -0.06, r: 0.072 },
  mouth: { type: 'smile', y: -0.3, w: 0.06 },
  cheeks: { x: 0.64, y: -0.26, r: 0.044 },
  motion: { type: 'float', height: 0.05, amp: 1.1, rate: 0.8 },
  sockets: { tail: { on: 'head', pos: [0, 0.44, -0.3] }, side: { on: 'head', pos: [0.37, 0.24, 0.08] } },
  limbs: { tail: 1.3 },
  parts: [
    // tail stalk curving up-back, flukes at its tip (flat, mirrored)
    hinged({ name: 'tail', at: 'tail', type: 'teardrop', size: [0.085, 0.15, 0.07], pinch: 0.6, rot: [-0.62, 0, 0], color: 'body', seg: [6, 3] }, 0.12),
    { name: 'fluke', at: 'tail', type: 'teardrop', size: [0.03, 0.12, 0.07], pinch: 0.8, pos: [0.08, 0.24, -0.17], rot: [0.5, 0, -1.25], color: 'body', seg: [6, 3], mirror: true },
    // fins
    hinged({ name: 'fin', at: 'fin', type: 'teardrop', size: [0.025, 0.08, 0.06], pinch: 0.75, rot: [0.2, 0, -2.3], color: 'accent', seg: [5, 3] }, 0.07),
    // spout: a column and drops, shown when happy
    { name: 'spout', at: 'top', type: 'cylinder', rTop: 0.05, rBottom: 0.016, h: 0.16, seg: 6, pos: [0, 0.08, -0.02], color: 'water', visible: false },
    ...SPOUT_DROPS.map(([ph, s]) => ({ name: 'drop', at: 'top', type: 'teardrop', size: [0.03, 0.045, 0.03], pinch: 0.6, pos: [0, 0.16, -0.02], color: 'water', seg: [5, 3], visible: false, extras: { ph, s } })),
  ],
  update(ctx) {
    const { t, w } = ctx;
    const on = w.happy > 0.35;
    const k = clamp((w.happy - 0.35) / 0.4, 0, 1);
    for (const m of ctx.part('spout')) {
      rest(m); m.visible = on;
      const pulse = 0.85 + 0.15 * Math.sin(TAU * 3 * t);
      m.scale.set(1, k * pulse, 1); m.position.y = m.userData.basePos.y * k * pulse;
    }
    ctx.part('drop').forEach((m, i) => {
      rest(m); m.visible = on;
      const [ph, s] = SPOUT_DROPS[i], q = ((t * 1.6 + ph / 3.4) % 1);
      m.position.x += s * 0.11 * q; m.position.y = (0.15 + 0.12 * Math.sin(Math.PI * q) - 0.08 * q) * k + 0.01;
      m.rotation.z = -s * (0.5 + 1.8 * q) + Math.PI; m.scale.setScalar(k * (1 - 0.4 * q));
    });
  },
});

// ------------------------------------------------------------------ Jellyfish
// Pale glassy mint dome bell with a lilac scalloped skirt, drifting tentacles and
// two frilly oral arms; the bell pulses and the whole jelly rises with each beat.
const JELLY_N = 6, JELLY_SCALLOPS = 9, JELLY_OPEN = Math.PI * 0.64;
const jellyRimY = 0.3 * Math.cos(JELLY_OPEN), jellyRimK = Math.sin(JELLY_OPEN);
const jellyScallops = Array.from({ length: JELLY_SCALLOPS }, (_, i) => {
  const a = i / JELLY_SCALLOPS * TAU;
  return { name: 'scallop', at: 'head', type: 'sphere', size: [0.066, 0.048, 0.034], pos: [0.355 * jellyRimK * Math.sin(a), jellyRimY - 0.012, 0.335 * jellyRimK * Math.cos(a)], rot: [0, a, 0], color: 'rim', seg: [6, 3] };
});
const jellyTentacles = Array.from({ length: JELLY_N }, (_, i) => {
  const a = (i + 0.5) / JELLY_N * TAU;
  return hinged({ name: 'tentacle', at: 'head', type: 'teardrop', size: [0.026, 0.17, 0.026], pinch: 0.35,
    pos: [0.2 * Math.sin(a), jellyRimY + 0.02, 0.18 * Math.cos(a)], rot: [Math.PI - 0.12, a, 0], rotOrder: 'YXZ', color: 'tentacle', seg: [4, 3] }, 0.15);
});
defineCreature({
  id: 'cute-jellyfish', name: 'Jellyfish', archetype: 'Drifter',
  roster: 'Dreamy mint jellyfish — pulses and drifts, tentacles trailing',
  palette: { body: '#c4f5ea', accent: '#d9b8ff', rim: '#d9b8ff', tentacle: '#e7c6ff', arm: '#ffc1dc', glow: '#ffffff', eye: '#233040', cheek: '#ffa6c9', mouth: '#3b4a66' },
  head: { size: [0.36, 0.3, 0.34], at: [0, 0.69, 0], pitch: 0.4, type: 'custom',
    geometry: (T) => { const g = new T.SphereGeometry(1, 12, 6, 0, TAU, 0, JELLY_OPEN); g.scale(0.36, 0.3, 0.34); return g; } },
  eyes: { x: 0.37, y: 0.06, r: 0.072, shape: 'wide' },
  mouth: { type: 'cat', y: -0.2, w: 0.036 },
  cheeks: { x: 0.6, y: -0.12, r: 0.04 },
  motion: { type: 'float', height: 0.03, amp: 0.9, rate: 0.7 },
  parts: [
    ...jellyScallops,
    { name: 'shine', at: 'head', type: 'ellipsoid', size: [0.07, 0.035, 0.025], pos: [0.14, 0.235, 0.12], rot: [-0.8, 0.5, -0.4], color: 'glow', seg: [6, 3] },
    { name: 'shine', at: 'head', type: 'sphere', size: 0.022, pos: [0.22, 0.17, 0.17], color: 'glow', seg: [5, 3] },
    ...jellyTentacles,
    hinged({ name: 'arm', at: 'head', type: 'teardrop', size: [0.045, 0.17, 0.035], pinch: 0.6, pos: [0.05, jellyRimY + 0.02, 0.03], rot: [Math.PI - 0.05, 0, 0.12], color: 'arm', seg: [5, 3], mirror: true }, 0.15),
  ],
  build(ctx) { ctx.mat('body').side = ctx.THREE.DoubleSide; }, // open dome: show its inside from below
  update(ctx) {
    const { t, w, dt } = ctx, c = ctx.creature;
    const rate = 0.75 + 0.8 * w.happy + 0.3 * w.speaking - 0.45 * w.sleepy + 0.4 * w.surprised;
    c._ph = (c._ph || 0) + TAU * rate * dt;
    // bell pulse: quick squeeze, slow refill; the jelly rises on each squeeze
    const s = Math.sin(c._ph), squeeze = Math.max(0, s) ** 2 * (1 - 0.6 * w.sleepy);
    c.headG.scale.set(1 + 0.07 * squeeze, 1 - 0.09 * squeeze, 1 + 0.07 * squeeze);
    c.root.position.y += 0.035 * Math.sin(c._ph - 1.2) * (1 - 0.6 * w.sleepy);
    ctx.part('tentacle').forEach((m, i) => {
      rest(m);
      m.rotation.x += 0.12 * Math.sin(c._ph - 1.5 + i * 1.1) - 0.18 * squeeze + 0.3 * w.surprised;
      m.rotation.z += 0.08 * Math.sin(t * 1.3 + i);
    });
    for (const m of ctx.part('arm')) { rest(m); m.rotation.z += m.userData.side * 0.1 * Math.sin(c._ph * 0.5 + 1); m.rotation.x += 0.08 * Math.sin(c._ph - 2); }
  },
});

// ------------------------------------------------------------------ Crab
// Wide flat coral carapace, big claws that clap when happy and pop up when
// surprised, six spindly legs; idles with little sideways scuttles.
defineCreature({
  id: 'cute-crab', name: 'Crab', archetype: 'Crustacean',
  roster: 'Sideways coral crab — claps its claws when happy',
  palette: { body: '#ff9478', accent: '#ff6f55', claw: '#ff7f62', pincer: '#ff6a50', spot: '#ffc3ad', leg: '#f0705a', eye: '#2a1714', cheek: '#ffb0b8', mouth: '#7a2a20' },
  head: { size: [0.4, 0.22, 0.27], at: [0, 0.3, 0], seg: [12, 7], pitch: 0.5 },
  eyes: { x: 0.34, y: 0.16, r: 0.075 },
  mouth: { type: 'smile', y: -0.3, w: 0.04 },
  cheeks: { x: 0.6, y: -0.12, r: 0.04 },
  motion: 'none',
  sockets: { side: { on: 'head', pos: [0.36, 0.28, 0.08] }, foot: { on: 'root', pos: [0.24, 0.17, -0.02] } },
  limbs: { side: 0.6, foot: 0.4 },
  parts: [
    // carapace freckles
    { name: 'spot', at: 'head', type: 'sphere', size: [0.04, 0.02, 0.035], pos: [0.13, 0.205, -0.03], color: 'spot', seg: [6, 3], mirror: true },
    { name: 'spot', at: 'head', type: 'sphere', size: [0.03, 0.017, 0.028], pos: [0, 0.21, -0.1], color: 'spot', seg: [6, 3] },
    // claws: short arm, round palm, upper and lower pincers that clap
    { name: 'arm', at: 'arm', type: 'ellipsoid', size: [0.05, 0.035, 0.035], pos: [0.04, 0.02, 0.02], rot: [0, 0, 0.6], color: 'claw', seg: [5, 3] },
    { name: 'palm', at: 'arm', type: 'ellipsoid', size: [0.085, 0.075, 0.07], pos: [0.1, 0.09, 0.05], color: 'claw', seg: [7, 4] },
    hinged({ name: 'pinU', at: 'arm', type: 'teardrop', size: [0.04, 0.07, 0.035], pinch: 0.75, pos: [0.11, 0.14, 0.08], rot: [0, 0, -0.25], color: 'claw', seg: [5, 3] }, 0.05),
    hinged({ name: 'pinL', at: 'arm', type: 'teardrop', size: [0.03, 0.055, 0.03], pinch: 0.75, pos: [0.15, 0.1, 0.08], rot: [0, 0, -1.0], color: 'pincer', seg: [5, 3] }, 0.04),
    // legs: three per side, hinged at the shell, reaching down-out to the floor
    ...[-0.55, 0, 0.55].map((yaw, i) => hinged({ name: 'leg', at: 'foot', type: 'cone', r: 0.022, h: 0.2, seg: 4, pos: [0, 0, 0.09 - 0.09 * i], rot: [0, yaw * 0.7, -2.45], rotOrder: 'YXZ', color: 'leg' }, 0.1)),
  ],
  update(ctx) {
    const { t, w, dt } = ctx, c = ctx.creature;
    const act = clamp(1 + 0.6 * w.happy - w.sleepy - 0.6 * w.listening - 0.4 * w.thinking, 0, 1.6);
    // sideways scuttle: bursts of quick side steps, a little shuffle while happy
    const g = Math.max(gate(t, 6.5, 0.4), w.happy * 0.8) * act;
    c._sc = (c._sc || 0) + TAU * (2.2 + 2 * w.happy) * dt;
    c._drift = (c._drift || 0) + dt * 0.9;
    const dx = 0.05 * Math.sin(c._drift) * g + 0.008 * Math.sin(c._sc) * g;
    c.root.position.x += dx;
    c.root.rotation.z += 0.04 * Math.sin(c._sc) * g;
    c.root.position.y += 0.008 * Math.abs(Math.sin(c._sc)) * g;
    ctx.part('leg').forEach((m, i) => {
      rest(m); const k = (i >> 1);
      const ph = c._sc + k * 2.1 + (m.userData.side < 0 ? Math.PI : 0);
      m.rotation.z += m.userData.side * (0.22 * Math.max(0, Math.sin(ph)) * g - 0.35 * w.sleepy);
    });
    // claws: clap open/close when happy, snap while speaking, wide open when surprised
    const clap = w.happy * Math.max(0, Math.sin(TAU * 4 * t)) + w.speaking * 0.5 * Math.max(0, Math.sin(TAU * 2.2 * t)) + w.surprised * 0.9 + 0.12;
    for (const m of ctx.part('pinU')) { rest(m); m.rotation.z += m.userData.side * 0.6 * clap; }
    for (const m of ctx.part('pinL')) { rest(m); m.rotation.z -= m.userData.side * 0.4 * clap; }
  },
});
