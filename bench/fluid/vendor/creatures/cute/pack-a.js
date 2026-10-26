// Cute pack A — OWNED BY the phase-2 agent "pack-a". Only that agent edits this file.
// Pets & farm: Frog, Bunny, Bear cub, Piglet, Kitten, Hamster.
// Each one has a different body plan (squat / tall-eared / sitting / quadruped /
// wide-headed / ball) and a signature behaviour written in its update() hook.

import { defineCreature } from './kit.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bump = (q, a, b) => (q < a || q > b ? 0 : Math.sin(Math.PI * (q - a) / (b - a)));
const ease = (cur, target, dt, rate) => cur + (target - cur) * (dt > 0 ? 1 - Math.exp(-dt * rate) : 1);

// Lift a head-space object onto the front of an ellipsoid (centre c, radii r) that
// covers the head surface there — e.g. a muzzle or a cheek pouch the kit's face
// placement does not know about. Only ever moves it forward.
function pushOnto(obj, c, r, lift = 0.005) {
  const dx = (obj.position.x - c[0]) / r[0], dy = (obj.position.y - c[1]) / r[1];
  const d = 1 - dx * dx - dy * dy;
  if (d <= 0) return;
  const z = c[2] + r[2] * Math.sqrt(d) + lift;
  if (z > obj.position.z) obj.position.z = z;
}

// Recurring timer: returns 0…1 envelope of a `len`-second event every `lo…hi` s.
function pulse(s, key, t, lo, hi, len) {
  const e = (s[key] ||= { next: t + lo + Math.random() * (hi - lo), t0: -1 });
  if (e.t0 < 0 && t > e.next) e.t0 = t;
  if (e.t0 < 0) return 0;
  const q = (t - e.t0) / len;
  if (q >= 1) { e.t0 = -1; e.next = t + lo + Math.random() * (hi - lo); return 0; }
  return q;
}

// ------------------------------------------------------------------ Frog
// Squat and wide: a flat head with two eye domes on top, folded back legs.
// Signature: the throat sac balloons while it talks; happy = tongue flicks.
defineCreature({
  id: 'cute-frog', name: 'Frog', archetype: 'Pond',
  roster: 'Squat pond hopper — throat sac puffs as it talks, tongue flicks when happy',
  palette: { body: '#a8dc86', accent: '#76b85e', belly: '#f3f7d2', spot: '#8cc56f', eye: '#1e2a20', cheek: '#ff9db3', mouth: '#6b2433', tongue: '#ff7d98' },
  body: { size: [0.3, 0.17, 0.28], at: [0, 0.17, -0.02], seg: [8, 5] },
  head: { size: [0.42, 0.25, 0.33], at: [0, 0.41, 0.05], seg: [11, 7], pitch: 0.35 },
  eyes: { x: 0.46, y: 0.3, r: 0.09 },
  mouth: { type: 'smile', y: -0.3, w: 0.1 },
  cheeks: { x: 0.72, y: -0.12, r: 0.048 },
  motion: { type: 'hop', rate: 0.7, amp: 1.35 },
  parts: [
    { name: 'dome', type: 'ellipsoid', at: 'head', size: [0.14, 0.13, 0.13], pos: [0.2, 0.15, 0.07], mirror: true, seg: [6, 5] },
    { name: 'spot', type: 'ellipsoid', at: 'head', size: [0.06, 0.02, 0.05], pos: [0, 0.245, -0.06], color: 'spot', seg: [5, 3] },
    { name: 'belly', type: 'ellipsoid', at: 'body', size: [0.22, 0.13, 0.1], pos: [0, 0.16, 0.18], color: 'belly', seg: [7, 4] },
    { name: 'sac', type: 'ellipsoid', at: 'head', size: [0.11, 0.07, 0.07], pos: [0, -0.19, 0.2], color: 'belly', seg: [7, 4] },
    { name: 'tongue', type: 'capsule', at: 'head', r: 0.022, len: 0.1, capSeg: 1, seg: 5, rot: [Math.PI / 2, 0, 0], color: 'tongue', visible: false },
    { name: 'thigh', type: 'ellipsoid', at: 'body', size: [0.1, 0.09, 0.15], pos: [0.26, 0.08, -0.04], rot: [0, 0.3, 0], mirror: true, seg: [6, 4] },
    { name: 'backFoot', type: 'ellipsoid', at: 'root', size: [0.075, 0.02, 0.09], pos: [0.31, 0.02, 0.08], rot: [0, 0.5, 0], mirror: true, color: 'accent', seg: [6, 3] },
    { name: 'hand', type: 'ellipsoid', at: 'foot', size: [0.055, 0.025, 0.065], pos: [0, 0.025, 0.06], color: 'accent', seg: [5, 3] },
  ],
  build(ctx) { ctx.s = { sac: 0 }; },
  update(ctx) {
    const { w, pose: P, dt, t, s } = ctx;
    // throat sac: slow breathing at rest, balloons with the speech envelope
    s.sac = ease(s.sac, w.speaking * (0.3 + 1.1 * P.mouth) + 0.5 * w.surprised, dt, 14);
    const k = 0.6 + 0.06 * Math.sin(TAU * t / 2.4) * (1 - w.sleepy) + s.sac;
    for (const m of ctx.part('sac')) { m.scale.set(k, k, k); m.position.z = m.userData.basePos.z + 0.03 * s.sac; }
    // happy: tongue flicks out of the open mouth every ~1.3 s
    const q = w.happy > 0.6 ? (t % 1.3) / 1.3 : 1;
    const f = bump(q, 0, 0.22), mg = ctx.face.mouth?.g;
    for (const m of ctx.part('tongue')) {
      m.visible = f > 0.03 && !!mg;
      if (!m.visible) continue;
      m.position.set(mg.position.x, mg.position.y - 0.012, mg.position.z + 0.08 * f);
      m.scale.set(1, 0.4 + 1.6 * f, 1);
    }
  },
});

// ------------------------------------------------------------------ Bunny
// Upright, tall two-segment ears — the left one is a lop that folds over at the tip.
// Signature: ear tips flop on every hop; the nose twitches in little bursts; buck teeth.
defineCreature({
  id: 'cute-bunny', name: 'Bunny', archetype: 'Pet',
  roster: 'Lop-eared hopper — ear tips flop on every hop, nose never stops twitching',
  palette: { body: '#f7d9bd', accent: '#ffadc2', belly: '#fffaf4', nose: '#ff8fab', tooth: '#ffffff', eye: '#2b2230', cheek: '#ff9fb6', mouth: '#6a2c3a', paw: '#fff1e4' },
  body: { size: [0.22, 0.2, 0.21], at: [0, 0.2, -0.03], seg: [7, 5] },
  head: { size: [0.34, 0.3, 0.3], at: [0, 0.54, 0.04], seg: [10, 7], pitch: 0.45 },
  eyes: { x: 0.4, y: -0.04, r: 0.08 },
  mouth: { type: 'smile', y: -0.36, w: 0.032 },
  cheeks: { x: 0.6, y: -0.3, r: 0.045 },
  motion: { type: 'hop', rate: 1.5, amp: 0.85 },
  sockets: { ear: { rot: [0, 0, -0.12] } },
  parts: [
    { name: 'ear', type: 'ellipsoid', at: 'ear', size: [0.07, 0.1, 0.04], pos: [0.0, 0.08, 0], seg: [6, 4] },
    { name: 'earIn', type: 'ellipsoid', at: 'ear', size: [0.042, 0.085, 0.02], pos: [0.0, 0.085, 0.028], color: 'accent', seg: [5, 3] },
    { name: 'earTip', type: 'ellipsoid', at: 'ear', size: [0.066, 0.095, 0.038], pos: [0.0, 0.24, 0], seg: [6, 4] },
    { name: 'earTip', type: 'ellipsoid', at: 'ear', size: [0.04, 0.07, 0.02], pos: [0.0, 0.235, 0.026], color: 'accent', seg: [5, 3] },
    { name: 'nose', type: 'ellipsoid', at: 'head', size: [0.03, 0.021, 0.02], pos: [0, -0.04, 0.292], color: 'nose', seg: [6, 3] },
    { name: 'tooth', type: 'box', at: 'head', size: [0.017, 0.026, 0.006], pos: [0.0095, -0.13, 0.27], mirror: true, color: 'tooth' },
    { name: 'belly', type: 'ellipsoid', at: 'body', size: [0.14, 0.14, 0.08], pos: [0, 0.18, 0.13], color: 'belly', seg: [6, 4] },
    { name: 'tail', type: 'sphere', at: 'tail', size: 0.07, pos: [0, 0, -0.02], color: 'belly', seg: [5, 3] },
    { name: 'arm', type: 'ellipsoid', at: 'arm', size: [0.04, 0.06, 0.045], pos: [-0.02, -0.05, 0.07], color: 'paw', seg: [5, 3] },
    { name: 'foot', type: 'ellipsoid', at: 'foot', size: [0.055, 0.035, 0.1], pos: [0, 0.035, 0.05], color: 'paw', seg: [6, 3] },
  ],
  build(ctx) {
    const T = ctx.THREE, PIV = new T.Vector3(0, 0.16, 0);
    ctx.s = { tips: [], twitch: {} };
    for (const m of ctx.part('earTip')) {
      const sock = m.parent;
      let piv = sock.userData.tipPiv;
      if (!piv) {
        piv = new T.Group(); piv.position.copy(PIV); sock.add(piv); sock.userData.tipPiv = piv;
        ctx.s.tips.push({ piv, side: m.userData.side, fl: 0 });
      }
      piv.add(m); m.position.sub(PIV); m.userData.basePos.copy(m.position);
    }
  },
  update(ctx) {
    const { w, pose: P, dt, t, s, L, lag } = ctx;
    // ear tips: rest fold (left one is a lop), straighten when alert, flop with hops
    for (const e of s.tips) {
      const rest = e.side < 0 ? 1.25 : 0.12;
      const alert = clamp(w.surprised + 0.55 * w.listening, 0, 1);
      const target = rest * (1 - 0.75 * alert) + 0.5 * w.sleepy + 2.2 * L.ear + 1.6 * Math.abs(lag.x);
      e.fl = ease(e.fl, target, dt, 18);
      e.piv.rotation.set(0.25 * e.fl, 0, -e.side * e.fl);
    }
    // nose twitch: bursts at rest, constant sniffing while listening / thinking
    const burst = pulse(s.twitch, 'n', t, 1.5, 3.5, 0.7) > 0 ? 1 : 0;
    const sniff = (1 - w.sleepy) * Math.max(burst, w.listening, w.thinking);
    const nz = Math.sin(TAU * 9 * t) * sniff;
    for (const m of ctx.part('nose')) {
      m.position.y = m.userData.basePos.y + 0.006 * nz;
      m.scale.set(1 + 0.12 * nz, 1 - 0.1 * nz, 1);
    }
    // buck teeth hang from the top of the mouth, whatever shape it is
    const mo = ctx.face.mouth;
    if (mo) {
      const Mw = 0.032, open = P.mouth;
      const happy = P.eye === 'happy' && open >= 0.07;
      const surprised = w.surprised > 0.5;
      const oy = surprised ? 0.85 : 0.2 + 0.85 * open;
      const top = open < 0.07 ? -Mw * 0.8 : happy ? Mw * 0.35 : Mw * oy;
      for (const m of ctx.part('tooth')) {
        m.position.set(mo.g.position.x + m.userData.basePos.x, mo.g.position.y + top - 0.013, mo.g.position.z + 0.006);
        m.quaternion.copy(mo.g.quaternion);
        m.visible = !surprised;
      }
    }
  },
});

// ------------------------------------------------------------------ Bear cub
// Sitting pear body, round ears, a light muzzle, arms forward holding its paws.
// Signature: sits holding its paws together; claps when happy, throws them up when surprised.
const BEAR_MUZZLE = { c: [0, -0.11, 0.235], r: [0.13, 0.09, 0.07] };
defineCreature({
  id: 'cute-bear', name: 'Bear cub', archetype: 'Woodland',
  roster: 'Honey cub — sits holding its paws, claps them when happy',
  palette: { body: '#c99a6e', accent: '#a87650', belly: '#f2dcc0', muzzle: '#f3dec3', nose: '#3a2620', earIn: '#f0b39c', eye: '#24180f', cheek: '#ff9f9a', mouth: '#4a2118', tongue: '#ff8a8a' },
  body: { size: [0.28, 0.26, 0.26], at: [0, 0.26, -0.02], seg: [8, 5] },
  head: { size: [0.33, 0.3, 0.29], at: [0, 0.66, 0.03], seg: [10, 7], pitch: 0.55 },
  eyes: { x: 0.42, y: 0.06, r: 0.072 },
  mouth: { type: 'smile', y: -0.5, w: 0.03 },
  cheeks: { x: 0.64, y: -0.22, r: 0.045 },
  motion: { type: 'waddle', rate: 0.7, amp: 0.6 },
  parts: [
    { name: 'ear', type: 'ellipsoid', at: 'ear', size: [0.085, 0.085, 0.05], pos: [0.03, 0.02, -0.01], seg: [6, 4] },
    { name: 'earIn', type: 'disc', at: 'ear', r: 0.048, pos: [0.03, 0.015, 0.042], color: 'earIn', seg: 8 },
    { name: 'muzzle', type: 'ellipsoid', at: 'head', size: BEAR_MUZZLE.r, pos: BEAR_MUZZLE.c, color: 'muzzle', seg: [8, 4] },
    { name: 'nose', type: 'ellipsoid', at: 'head', size: [0.045, 0.03, 0.025], pos: [0, -0.07, 0.3], color: 'nose', seg: [6, 3] },
    { name: 'belly', type: 'ellipsoid', at: 'body', size: [0.19, 0.18, 0.1], pos: [0, 0.24, 0.165], color: 'belly', seg: [6, 4] },
    // arms run from the shoulder forward/in to paws meeting in front of the belly
    { name: 'arm', type: 'ellipsoid', at: 'arm', size: [0.06, 0.06, 0.15], pos: [-0.084, -0.045, 0.12], rot: [0.3, -0.61, 0], rotOrder: 'YXZ', seg: [6, 4] },
    { name: 'paw', type: 'sphere', at: 'arm', size: 0.058, pos: [-0.16, -0.09, 0.235], color: 'muzzle', seg: [5, 3] },
    { name: 'leg', type: 'ellipsoid', at: 'foot', size: [0.075, 0.06, 0.09], pos: [0.03, 0.05, 0.08], seg: [5, 4] },
    { name: 'pad', type: 'disc', at: 'foot', r: 0.04, pos: [0.03, 0.055, 0.17], color: 'muzzle', seg: 7 },
  ],
  update(ctx) {
    const { w, t, creature } = ctx;
    const clap = w.happy * 0.32 * (0.5 + 0.5 * Math.sin(TAU * 2.6 * t));
    const talk = w.speaking * 0.12 * Math.sin(TAU * 1.3 * t);
    const raise = -1.0 * w.surprised - 0.35 * w.happy + 0.18 * w.sleepy - 0.12 * w.listening;
    for (const r of creature.sock.side) {
      r.g.rotation.set(r.base.x + raise + talk * r.side, r.base.y + r.side * (clap + 0.25 * w.surprised), r.base.z + r.side * 0.1 * w.surprised);
    }
    const mo = ctx.face.mouth;
    if (mo) pushOnto(mo.g, BEAR_MUZZLE.c, BEAR_MUZZLE.r, 0.006);
  },
});

// ------------------------------------------------------------------ Piglet
// A quadruped: horizontal body, big head in front, flat disc snout with nostrils,
// floppy forward ears, four stubby legs and a corkscrew tail.
// Signature: the snout bounces as it oinks; the curly tail spins when happy.
defineCreature({
  id: 'cute-piglet', name: 'Piglet', archetype: 'Farm',
  roster: 'Trotting piglet — snout bounces when it oinks, curly tail spins when happy',
  palette: { body: '#ffb0bf', accent: '#ff8aa1', snout: '#ff9db0', nostril: '#b84a63', belly: '#ffd0d9', eye: '#2a1b22', cheek: '#ff7898', mouth: '#7a2c3c', tongue: '#ff6f8c' },
  body: { size: [0.27, 0.21, 0.33], at: [0, 0.25, -0.1], seg: [9, 6] },
  head: { size: [0.31, 0.28, 0.28], at: [0, 0.55, 0.12], seg: [11, 7], pitch: 0.4 },
  eyes: { x: 0.49, y: 0.22, r: 0.07 },
  mouth: { type: 'smile', y: -0.66, w: 0.034 },
  cheeks: { x: 0.7, y: -0.22, r: 0.045 },
  motion: { type: 'waddle', rate: 1.7, amp: 0.55 },
  sockets: { foot: [0.13, 0, 0.07] },
  parts: [
    { name: 'snout', type: 'cylinder', at: 'head', r: 0.095, h: 0.07, pos: [0, -0.07, 0.28], rot: [Math.PI / 2, 0, 0], color: 'snout', seg: 10 },
    { name: 'nostril', type: 'disc', at: 'head', r: 0.018, pos: [0.035, -0.07, 0.3165], scale: [0.75, 1.15, 1], mirror: true, color: 'nostril', seg: 6 },
    { name: 'ear', type: 'teardrop', at: 'ear', size: [0.07, 0.11, 0.03], pos: [0.064, 0.048, 0.06], rot: [0.9, 0, -0.7], seg: [6, 4] },
    { name: 'leg', type: 'cylinder', at: 'foot', rTop: 0.045, rBottom: 0.05, h: 0.13, pos: [0, 0.065, 0], seg: 6 },
    { name: 'rearLeg', type: 'cylinder', at: 'root', rTop: 0.045, rBottom: 0.05, h: 0.13, pos: [0.13, 0.065, -0.25], mirror: true, seg: 6 },
    { name: 'tail', type: 'torus', at: 'tail', R: 0.035, tube: 0.012, radial: 3, tubular: 10, arc: 1.6 * Math.PI, pos: [0, 0.035, -0.02], rot: [0, Math.PI / 2, 0], color: 'accent' },
  ],
  build(ctx) { ctx.s = { spin: 0, oink: 0 }; },
  update(ctx) {
    const { w, pose: P, dt, L, s, creature } = ctx;
    // diagonal trot: each rear leg lifts with the opposite front foot
    const tuck = Math.max(0, (creature.root.position.y - creature._lift) * 0.15);
    for (const m of ctx.part('rearLeg')) {
      const lift = (m.userData.side > 0 ? L.foot[1].lift : L.foot[0].lift) + tuck;
      m.position.y = m.userData.basePos.y + lift; m.rotation.x = -lift * 5;
    }
    // curly tail: lazy twirl, fast spin when happy, limp when asleep
    s.spin += dt * (1.5 + 14 * w.happy + 3 * w.speaking) * (1 - 0.9 * w.sleepy);
    for (const m of ctx.part('tail')) m.rotation.set(s.spin, Math.PI / 2, 0, 'YXZ');
    // snout bounces with every "oink" of the speech envelope; sniffs while thinking
    s.oink = ease(s.oink, P.mouth * (w.speaking + 0.5 * w.happy), dt, 20);
    const sniff = 0.008 * w.thinking * Math.sin(TAU * 7 * ctx.t);
    for (const m of [...ctx.part('snout'), ...ctx.part('nostril')]) {
      const b = m.userData.baseScale;
      m.scale.set(b.x * (1 + 0.18 * s.oink), b.y * (1 + 0.18 * s.oink), b.z * (1 + 0.1 * s.oink));
      m.position.y = m.userData.basePos.y + 0.02 * s.oink + sniff;
      m.position.z = m.userData.basePos.z + 0.01 * s.oink * (m.geometry.type === 'CircleGeometry' ? 1.8 : 1);
    }
  },
});

// ------------------------------------------------------------------ Kitten
// Wide chibi head, pointed ears, whiskers, ω mouth, a tall tail.
// Signature: tail swish, slow "I trust you" blinks, bottlebrush tail when startled,
// kneading paws when happy.
defineCreature({
  id: 'cute-kitten', name: 'Kitten', archetype: 'Pet',
  roster: 'Chibi kitten — tail swish and slow blinks; bottlebrush tail when startled',
  palette: { body: '#c9c3e6', accent: '#9a8fc4', belly: '#ffffff', earIn: '#ffb7c8', nose: '#ff8fab', whisker: '#6e7590', eye: '#222c3a', cheek: '#ffa3bd', mouth: '#4c2a3a' },
  body: { size: [0.2, 0.2, 0.2], at: [0, 0.2, -0.02], seg: [8, 5] },
  head: { size: [0.36, 0.3, 0.3], at: [0, 0.56, 0.04], seg: [10, 7], pitch: 0.45 },
  eyes: { x: 0.4, y: -0.04, r: 0.088 },
  mouth: { type: 'cat', y: -0.38, w: 0.05 },
  cheeks: { x: 0.64, y: -0.3, r: 0.046 },
  motion: 'none',
  sockets: { ear: { rot: [-0.1, 0, -0.22] } },
  parts: [
    { name: 'ear', type: 'cone', at: 'ear', r: 0.09, h: 0.16, pos: [0, 0.06, 0], seg: 6 },
    { name: 'earIn', type: 'cone', at: 'ear', r: 0.055, h: 0.11, pos: [0, 0.05, 0.03], color: 'earIn', seg: 6 },
    { name: 'stripe', type: 'ellipsoid', at: 'head', size: [0.022, 0.012, 0.06], pos: [0, 0.285, 0.07], rot: [0.5, 0, 0], color: 'accent', seg: [4, 3] },
    { name: 'stripe', type: 'ellipsoid', at: 'head', size: [0.018, 0.012, 0.05], pos: [0.065, 0.272, 0.06], rot: [0.5, 0, -0.25], mirror: true, color: 'accent', seg: [4, 3] },
    { name: 'nose', type: 'ellipsoid', at: 'head', size: [0.024, 0.016, 0.014], pos: [0, -0.07, 0.29], color: 'nose', seg: [5, 3] },
    { name: 'whisker', type: 'box', at: 'head', size: [0.13, 0.008, 0.008], pos: [0.36, -0.065, 0.12], rot: [0, -0.35, 0.14], mirror: true, color: 'whisker' },
    { name: 'whisker', type: 'box', at: 'head', size: [0.12, 0.008, 0.008], pos: [0.355, -0.1, 0.12], rot: [0, -0.35, -0.08], mirror: true, color: 'whisker' },
    { name: 'chest', type: 'ellipsoid', at: 'body', size: [0.13, 0.14, 0.08], pos: [0, 0.22, 0.13], color: 'belly', seg: [6, 4] },
    { name: 'paw', type: 'ellipsoid', at: 'foot', size: [0.05, 0.04, 0.06], pos: [0, 0.04, 0.06], color: 'belly', seg: [6, 3] },
    { name: 'tail', type: 'capsule', at: 'tail', r: 0.035, len: 0.24, capSeg: 2, seg: 6, pos: [0, 0.123, -0.067], rot: [-0.5, 0, 0] },
    { name: 'tailTip', type: 'sphere', at: 'tail', size: 0.042, pos: [0, 0.27, -0.15], color: 'accent', seg: [5, 3] },
  ],
  build(ctx) { ctx.s = { puff: 0, blink: {}, sb: 0 }; },
  update(ctx) {
    const { w, t, dt, s, creature } = ctx;
    // gentle seated sway + a little bounce when happy
    creature.root.rotation.z += 0.03 * Math.sin(TAU * 0.45 * t) * (1 - w.sleepy);
    creature.root.position.y += 0.006 * Math.abs(Math.sin(TAU * 1.4 * t)) * w.happy;
    // tail: slow swish, fast quiver when happy, droops asleep, stands when startled
    const tr = creature.sock.tail[0];
    const swish = (0.38 * (1 - w.happy) * (1 - 0.7 * w.sleepy)) * Math.sin(TAU * 0.5 * t) + 0.08 * w.happy * Math.sin(TAU * 6 * t);
    tr.g.rotation.set(tr.base.x - 0.55 * w.sleepy + 0.35 * w.surprised + 0.15 * w.happy, tr.base.y, tr.base.z + swish);
    s.puff = ease(s.puff, w.surprised, dt, 10);
    for (const m of [...ctx.part('tail'), ...ctx.part('tailTip')]) { const k = 1 + 1.1 * s.puff; m.scale.set(k, 1 + 0.15 * s.puff, k); }
    // kneading paws when happy (alternate press)
    creature.sock.foot.forEach((r, i) => {
      const k = w.happy * Math.max(0, Math.sin(TAU * 1.6 * t + i * Math.PI));
      r.g.position.y += 0.03 * k; r.g.rotation.x -= 0.4 * k;
    });
    // whiskers twitch when it speaks
    for (const m of ctx.part('whisker')) m.rotation.z = m.userData.baseRot.z + 0.12 * w.speaking * ctx.pose.mouth * m.userData.side;
    // slow blink: in calm moods, eyes close softly, hold, and reopen
    const calm = w.idle + w.listening;
    const q = calm > 0.7 ? pulse(s.blink, 'b', t, 4, 7, 1.6) : 0;
    const k = q > 0 ? Math.min(1, bump(q, 0, 1) * 1.6) : 0;
    if (k > 0.01) for (const e of ctx.face.eyes) {
      if (!e.ball.visible) continue; // only on the normal glossy eye
      if (k > 0.85) {
        for (const n of ['scl', 'ball', 'half', 'hl1', 'hl2']) e[n].visible = false;
        e.arc.visible = true; e.arc.rotation.z = Math.PI; e.arc.position.y = 0.05; e.arc.scale.set(0.95, 0.5, 0.35);
      } else {
        const open = e.ball.scale.y * (1 - k);
        e.ball.scale.y = open; e.ball.position.y = -(1 - open);
        if (open < 0.45) e.hl1.visible = e.hl2.visible = false; else e.hl1.position.y = 0.34 - (1 - open);
      }
    }
  },
});

// ------------------------------------------------------------------ Hamster
// A round golden ball with a white two-pouch muzzle, tiny round ears, holding a seed.
// Signature: the cheek pouches puff up as it talks (and stay stuffed when happy);
// nibbles its seed in quick bursts.
const POUCH = { c: [0.13, -0.13, 0.25], r: [0.13, 0.1, 0.1] };
defineCreature({
  id: 'cute-hamster', name: 'Hamster', archetype: 'Pocket pet',
  roster: 'Pocket hamster — cheek pouches puff up as it talks, nibbles a seed',
  palette: { body: '#f2c27f', accent: '#e0a35c', belly: '#fff6e8', earIn: '#ffb3a7', paw: '#ffc0b6', nose: '#ff8fa0', seed: '#5b4a3c', seedLine: '#d8cbb4', eye: '#24170f', cheek: '#ff9a9a', mouth: '#6b2b26', tongue: '#ff8a8a' },
  head: { size: [0.4, 0.37, 0.36], at: [0, 0.37, 0], seg: [11, 7], pitch: 0.45 },
  eyes: { x: 0.42, y: 0.08, r: 0.074 },
  mouth: { type: 'smile', y: -0.47, w: 0.026 },
  cheeks: { x: 0.48, y: -0.33, r: 0.04 },
  motion: 'none',
  parts: [
    { name: 'pouch', type: 'ellipsoid', at: 'head', size: POUCH.r, pos: POUCH.c, mirror: true, color: 'belly', seg: [9, 6] },
    { name: 'nose', type: 'sphere', at: 'head', size: 0.022, pos: [0, -0.1, 0.345], color: 'nose', seg: [5, 3] },
    { name: 'ear', type: 'ellipsoid', at: 'ear', size: [0.07, 0.07, 0.035], pos: [0.03, 0.0, 0], seg: [6, 4] },
    { name: 'earIn', type: 'disc', at: 'ear', r: 0.042, pos: [0.03, 0.0, 0.03], color: 'earIn', seg: 8 },
    { name: 'paw', type: 'ellipsoid', at: 'head', size: [0.042, 0.036, 0.04], pos: [0.06, -0.25, 0.31], mirror: true, color: 'paw', seg: [5, 3] },
    { name: 'seed', type: 'teardrop', at: 'head', size: [0.03, 0.05, 0.022], pos: [0, -0.24, 0.34], rot: [0.3, 0, 0], color: 'seed', seg: [6, 4], pinch: 0.6 },
    { name: 'foot', type: 'ellipsoid', at: 'foot', size: [0.05, 0.025, 0.06], pos: [0, 0.02, -0.02], color: 'paw', seg: [5, 3] },
  ],
  build(ctx) {
    ctx.s = { puff: 0, nib: {} };
    for (const c of ctx.face.cheeks) c.userData.z0 = c.position.z;
  },
  update(ctx) {
    const { w, pose: P, t, dt, s, creature } = ctx;
    // pouches: puff with the speech envelope, stuffed when happy, flat-ish asleep
    s.puff = ease(s.puff, w.speaking * (0.15 + 0.5 * P.mouth) + 0.35 * w.happy + 0.15 * w.surprised, dt, 12);
    const px = 1 + s.puff, pyz = 1 + 0.75 * s.puff;
    const pr = [POUCH.r[0] * px, POUCH.r[1] * pyz, POUCH.r[2] * pyz];
    for (const m of ctx.part('pouch')) {
      m.scale.set(px, pyz, pyz);
      m.position.x = m.userData.basePos.x + m.userData.side * 0.03 * s.puff;
    }
    const pc = (side) => [side * (POUCH.c[0] + 0.03 * s.puff), POUCH.c[1], POUCH.c[2]];
    // keep blush and mouth on top of the (moving) pouches
    for (const c of ctx.face.cheeks) { c.position.z = c.userData.z0; pushOnto(c, pc(1), pr); pushOnto(c, pc(-1), pr); }
    const mo = ctx.face.mouth;
    if (mo) { pushOnto(mo.g, pc(1), pr, 0.007); pushOnto(mo.g, pc(-1), pr, 0.007); }
    // nibbling: short bursts of quick paw/seed lifts toward the mouth while idle
    const nb = pulse(s.nib, 'n', t, 2, 4.5, 1.4);
    const nib = (nb > 0 ? 1 : 0) * (w.idle + 0.5 * w.thinking) * (1 - w.sleepy);
    const lift = nib * (0.02 + 0.015 * Math.sin(TAU * 7 * t));
    const up = 0.12 * w.surprised + 0.04 * w.happy * (0.5 + 0.5 * Math.sin(TAU * 3 * t));
    for (const m of ctx.part('paw')) {
      const b = m.userData.basePos;
      m.position.set(b.x + m.userData.side * 0.08 * w.surprised, b.y + lift + up, b.z);
    }
    for (const m of ctx.part('seed')) {
      const b = m.userData.basePos;
      m.position.set(b.x, b.y + lift + up, b.z);
      m.rotation.z = 0.25 * nib * Math.sin(TAU * 7 * t);
    }
    // nibble jiggle of the whole ball + nose twitch
    creature.root.position.y += 0.005 * nib * Math.abs(Math.sin(TAU * 7 * t));
    creature.root.rotation.z += 0.025 * Math.sin(TAU * 0.6 * t) * (1 - w.sleepy);
    for (const m of ctx.part('nose')) m.position.y = m.userData.basePos.y + 0.005 * Math.sin(TAU * 10 * t) * (1 - w.sleepy) * Math.max(nib, w.listening);
  },
});
