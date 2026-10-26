// Route 3 — the CUTE KIT. A part-based procedural creature builder.
//
// A creature is DATA (a spec passed to defineCreature) plus optional small hooks.
// The kit turns it into rigid low-poly parts (one flat colour each, flat Lambert)
// hung on a tiny rig, animated by a handful of matrices per frame — the same
// device-native "rigid parts + a few matrices" runtime as proc.js, ~600 tris.
//
//   root (pose.pos/rot + locomotion)
//    └ norm (scale → height 1)
//       ├ lean (pose.spine)
//       │  ├ body      (squash & stretch about the ground)  sockets: side L/R, tail, neck, back
//       │  └ headPivot (at the neck; pose.head + tilts)
//       │     └ head   (origin = head centre)               sockets: ear L/R, antenna L/R, horn L/R, top, jaw
//       │        └ face: eyes, mouth, cheeks (generated from the spec, driven by the mood)
//       └ foot L/R    (stay planted; locomotion lifts them)
//
// Cuteness rules baked in: head ≥ body, big glossy eyes low and wide with white
// highlight dots, blush cheeks, rounded parts, bouncy squash/stretch, extra
// blinks, curious head tilts, per-species idle locomotion. See README.md.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bump = (q, a, b) => (q < a || q > b ? 0 : Math.sin(Math.PI * (q - a) / (b - a)));
const rand = (a, b) => a + Math.random() * (b - a);
const size3 = (s) => (Array.isArray(s) ? [s[0], s[1] ?? s[0], s[2] ?? s[0]] : [s, s, s]);
const Z = new THREE.Vector3(0, 0, 1);

export const BUDGET_TRIS = 600, HARD_TRIS = 1000;
const BULK_REF = 0.9; // bulk (cube root of h·w·d) a height-1 creature may have before it is scaled down (duck ≈ 0.83, crab ≈ 1.3)
export const PART_TYPES = ['ellipsoid', 'sphere', 'teardrop', 'capsule', 'cone', 'cylinder', 'torus', 'box', 'disc', 'custom'];
export const SOCKETS = ['root', 'body', 'head', 'top', 'neck', 'back', 'tail', 'jaw', 'ear', 'side', 'foot', 'antenna', 'horn'];
const PAIRED = new Set(['ear', 'side', 'foot', 'antenna', 'horn']);
const ALIAS = { wing: 'side', arm: 'side', fin: 'side', leg: 'foot' };
export const MOUTHS = ['smile', 'cat', 'jaw', 'none'];

export const DEFAULT_PALETTE = {
  body: '#f6b8c8', accent: '#e98aa6', belly: '#fff3ec', eye: '#1d1b26', shine: '#ffffff',
  cheek: '#ff8fab', mouth: '#5a1f2a', tongue: '#ff7b93', white: '#ffffff', dark: '#2a2633',
};

// ---------------------------------------------------------------- registry
export const REGISTRY = [];
const ids = new Set();

/** Register a creature. Returns the spec. Throws on missing id/name/head or duplicate id. */
export function defineCreature(spec) {
  if (!spec || !spec.id || !spec.name) throw new Error('defineCreature: `id` and `name` are required');
  if (ids.has(spec.id)) throw new Error(`defineCreature: duplicate id "${spec.id}"`);
  if (!spec.head || !spec.head.size) throw new Error(`defineCreature(${spec.id}): \`head.size\` is required`);
  const m = motionOf(spec);
  if (!MOTIONS[m.type]) throw new Error(`defineCreature(${spec.id}): unknown motion "${m.type}" (use ${Object.keys(MOTIONS).join(' | ')})`);
  for (const p of spec.parts || []) {
    if (p.type && !PART_TYPES.includes(p.type)) throw new Error(`defineCreature(${spec.id}): unknown part type "${p.type}"`);
    const at = ALIAS[p.at] || p.at || 'body';
    if (!SOCKETS.includes(at)) throw new Error(`defineCreature(${spec.id}): unknown socket "${p.at}"`);
  }
  ids.add(spec.id); REGISTRY.push(spec);
  return spec;
}

/** Catalog rows for every registered creature (catalog.js prepends these). */
export function cuteEntries() {
  return REGISTRY.map((s) => ({
    id: s.id, name: s.name, archetype: s.archetype || 'Cute', route: 'Route 3', kind: 'cute', spec: s,
    source: s.source || 'cute kit (this viewer)', license: 'project', tris: null, roster: s.roster,
  }));
}

function motionOf(spec) {
  const m = spec.motion || 'none';
  return typeof m === 'string' ? { type: m, amp: 1, rate: 1 } : { amp: 1, rate: 1, ...m };
}

// ---------------------------------------------------------------- geometry
function autoSeg(r) { const w = clamp(Math.round(4 + r * 18), 5, 10); return [w, clamp(Math.round(w * 0.7), 3, 7)]; }

/** Unit-ish geometry for one part spec (already sized). */
export function partGeometry(p) {
  const t = p.type || 'ellipsoid';
  switch (t) {
    case 'sphere': case 'ellipsoid': {
      const s = size3(p.size ?? 0.1); const [w, h] = p.seg || autoSeg(Math.max(...s));
      const g = new THREE.SphereGeometry(1, w, h); g.scale(...s); return g;
    }
    case 'teardrop': { // sphere pinched toward +y: drops, tufts, ears, leaves, flames
      const s = size3(p.size ?? 0.1); const [w, h] = p.seg || autoSeg(Math.max(...s));
      const g = new THREE.SphereGeometry(1, w, h); const a = g.attributes.position; const pinch = p.pinch ?? 0.85;
      for (let i = 0; i < a.count; i++) { const y = a.getY(i); const k = 1 - pinch * Math.pow((y + 1) / 2, 1.6); a.setXYZ(i, a.getX(i) * k, y, a.getZ(i) * k); }
      g.scale(...s); g.computeVertexNormals(); return g;
    }
    case 'capsule': return new THREE.CapsuleGeometry(p.r ?? 0.05, p.len ?? 0.1, p.capSeg ?? 2, p.seg ?? 7);
    case 'cone': return new THREE.ConeGeometry(p.r ?? 0.05, p.h ?? 0.12, p.seg ?? 7);
    case 'cylinder': return new THREE.CylinderGeometry(p.rTop ?? p.r ?? 0.05, p.rBottom ?? p.r ?? 0.05, p.h ?? 0.1, p.seg ?? 8);
    case 'torus': return new THREE.TorusGeometry(p.R ?? 0.1, p.tube ?? 0.02, p.radial ?? 3, p.tubular ?? 10, p.arc ?? TAU);
    case 'box': return new THREE.BoxGeometry(...size3(p.size ?? 0.1));
    case 'disc': return new THREE.CircleGeometry(p.r ?? 0.05, p.seg ?? 10);
    case 'custom': return p.geometry(THREE);
  }
  throw new Error(`unknown part type ${t}`);
}

const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// ---------------------------------------------------------------- motions
// Each motion adds an in-place locomotion idle to the layer L. `a` is the activity
// (0 asleep … ~1.3 happy), `w` the smoothed mood weights, `t` time, `m` the spec.
const gate = (t, period, duty = 0.45) => clamp((Math.sin(TAU * t / period) + 1 - 2 * duty) * 3, 0, 1); // bursts
export const MOTIONS = {
  none() {},
  waddle(L, t, a, w, m) {
    const g = Math.max(gate(t, 7.3 / m.rate), w.happy, 0.35 * w.speaking);
    const k = a * g * m.amp, ph = TAU * 1.9 * m.rate * (1 + 0.5 * w.happy) * t, s = Math.sin(ph);
    L.rot.z += 0.09 * k * s; L.rot.y += 0.06 * k * Math.sin(ph + 0.6);
    L.pos.y += 0.012 * k * Math.abs(s);
    L.foot[0].lift += 0.045 * k * Math.max(0, s); L.foot[1].lift += 0.045 * k * Math.max(0, -s);
    L.tail.y += 0.25 * k * Math.sin(ph + 1.2);
  },
  hop(L, t, a, w, m) {
    const P = 2.4 / m.rate, q = (t % P) / P, k = a * m.amp * (1 - w.happy) * (1 - w.sleepy);
    L.squash += k * (-0.12 * bump(q, 0, 0.07) + 0.06 * bump(q, 0.07, 0.2) - 0.1 * bump(q, 0.2, 0.27));
    L.pos.y += k * 0.07 * bump(q, 0.07, 0.2);
    L.foot[0].lift += k * 0.02 * bump(q, 0.07, 0.2); L.foot[1].lift = L.foot[0].lift;
    L.ear += 0.25 * k * bump(q, 0.15, 0.35);
  },
  slither(L, t, a, w, m) {
    const ph = TAU * 0.55 * m.rate * (1 + w.happy) * t, k = a * m.amp;
    L.pos.x += 0.03 * k * Math.sin(ph); L.rot.z += 0.07 * k * Math.sin(ph + 1); L.rot.y += 0.14 * k * Math.sin(ph);
    L.tail.y += 0.55 * k * Math.sin(ph - 1.2); L.tail.x += 0.12 * k * Math.sin(ph * 2);
  },
  float(L, t, a, w, m) {
    const k = m.amp;
    L.lift += (m.height ?? 0.08) * (1 - 0.6 * w.sleepy);
    L.pos.y += 0.03 * k * Math.sin(TAU * t / (2.6 / m.rate));
    L.rot.z += 0.045 * k * Math.sin(TAU * t / (3.4 / m.rate)); L.rot.x += 0.03 * k * Math.sin(TAU * t / (4.1 / m.rate));
    L.tail.y += 0.3 * k * Math.sin(TAU * t / 2.2); L.tail.x += 0.2 * k * Math.sin(TAU * t / 1.6);
  },
  flutter(L, t, a, w, m) {
    MOTIONS.float(L, t, a, w, { ...m, amp: m.amp * 0.7 });
    L.pos.y += 0.012 * Math.sin(TAU * 4.5 * m.rate * t);
    L.side += (0.3 + 0.35 * Math.sin(TAU * 9 * m.rate * (1 + 0.3 * w.happy) * t)) * (0.4 + 0.6 * a) * m.amp;
  },
  wiggle(L, t, a, w, m) {
    const g = Math.max(gate(t, 6.1 / m.rate, 0.4), 0.5 * w.happy), k = a * g * m.amp;
    L.squash += 0.045 * k * Math.sin(TAU * 2.7 * m.rate * t);
    L.rot.z += 0.06 * k * Math.sin(TAU * 1.35 * m.rate * t);
    L.head.z += 0.05 * k * Math.sin(TAU * 1.35 * m.rate * t + 1.4);
  },
};

// ---------------------------------------------------------------- items (customise slots)
export const HEAD_ITEMS = ['none', 'party hat', 'top hat', 'leaf sprout', 'bow', 'headphones'];
export const NECK_ITEMS = ['none', 'scarf', 'bow tie', 'bell collar'];

// ---------------------------------------------------------------- the creature
export class CuteCreature {
  constructor(entry) {
    this.entry = entry; this.spec = entry.spec;
    this.clips = []; this.height = 1; this.patterns = [];
    this.headItems = HEAD_ITEMS; this.neckItems = NECK_ITEMS;
    const S = this.spec;
    this.palette = { ...DEFAULT_PALETTE, ...(S.palette || {}) };
    this.skin = { body: this.palette.body, accent: this.palette.accent, blush: S.cheeks !== false };
    this.items = { head: 'none', neck: 'none', ...(S.items || {}) };
    this.mats = new Map();
    this.motion = motionOf(S);
    this.limbAmp = { side: 1, ear: 1, tail: 1, foot: 1, antenna: 1, ...(S.limbs || {}) };
    this.t = 0;
    this.w = { idle: 1, listening: 0, thinking: 0, speaking: 0, happy: 0, sleepy: 0, surprised: 0 };
    this.blink = { next: rand(1.5, 3.5), t: -1 };
    this.tilt = { next: rand(3, 6), t: -1, dir: 1 };
    this.flick = { next: rand(2, 5), t: -1 };
    this.spring = { x: 0, vx: 0, z: 0, vz: 0, lastY: 0 };
    this._build();
  }
  async load() { return this; }
  defaultClip() { return null; }
  play() {} setSpeed() {} setPaused() {}
  setDevice() { return this.tris(); } // already device-native: flat Lambert, one colour per face, < 1000 tris
  topY() { return 1.08 + this._lift; }

  // ---------- materials ----------
  _mat(key) {
    const k = key || 'body';
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshLambertMaterial({ color: this._color(k), flatShading: true }));
    return this.mats.get(k);
  }
  _color(k) { return k.startsWith('#') ? k : (this.palette[k] ?? '#ff00ff'); }

  // ---------- build ----------
  _build() {
    const S = this.spec;
    this.root = new THREE.Group();
    this.norm = new THREE.Group(); this.root.add(this.norm);
    this.lean = new THREE.Group(); this.norm.add(this.lean);
    this.bodyG = new THREE.Group(); this.lean.add(this.bodyG);
    this.headPivot = new THREE.Group(); this.headPivot.rotation.order = 'YXZ'; this.lean.add(this.headPivot);
    this.headG = new THREE.Group(); this.headPivot.add(this.headG);

    const hr = size3(S.head.size), H = new THREE.Vector3(...(S.head.at || [0, 0.62, 0]));
    const br = S.body ? size3(S.body.size) : null;
    const B = S.body ? new THREE.Vector3(...(S.body.at || [0, br[1], 0])) : null;
    const neck = new THREE.Vector3(...(S.head.pivot || (B ? [0, B.y + br[1] * 0.7, (H.z + B.z) / 2] : [0, 0, H.z])));
    Object.assign(this, { hr, H, br, B, neckP: neck });
    this.headPivot.position.copy(neck);
    this.headG.position.copy(H).sub(neck);
    this.faceR = S.face?.r ? size3(S.face.r) : hr;
    this.faceOff = new THREE.Vector3(...(S.face?.offset || [0, 0, 0]));

    // sockets (positions in creature space, rest pose)
    const origin = { root: new THREE.Vector3(), body: new THREE.Vector3(), head: H };
    const parent = { root: this.norm, body: this.bodyG, head: this.headG };
    const onBody = B ? 'body' : 'head';
    const R = (y) => { // horizontal cross-section radii at height y (body ∪ head)
      const cs = (C, r) => { const d = 1 - ((y - C.y) / r[1]) ** 2; return d > 0 ? [r[0] * Math.sqrt(d), r[2] * Math.sqrt(d)] : [0, 0]; };
      const a = B ? cs(B, br) : [0, 0], b = cs(H, hr); return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    this.ringAt = R;
    const def = {
      ear: { on: 'head', pos: [hr[0] * 0.55, H.y + hr[1] * 0.72, H.z - hr[2] * 0.1] },
      antenna: { on: 'head', pos: [hr[0] * 0.3, H.y + hr[1] * 0.92, H.z] },
      horn: { on: 'head', pos: [hr[0] * 0.45, H.y + hr[1] * 0.8, H.z + hr[2] * 0.1] },
      top: { on: 'head', pos: [0, H.y + hr[1], H.z] },
      side: B ? { on: 'body', pos: [br[0] * 0.92, B.y + br[1] * 0.12, B.z] } : { on: 'head', pos: [hr[0] * 0.92, H.y - hr[1] * 0.35, H.z] },
      foot: { on: 'root', pos: [(B ? br[0] : hr[0]) * 0.42, 0, (B ? B.z + br[2] * 0.35 : H.z + hr[2] * 0.3)] },
      tail: B ? { on: 'body', pos: [0, B.y + br[1] * 0.2, B.z - br[2] * 0.92] } : { on: 'head', pos: [0, H.y - hr[1] * 0.4, H.z - hr[2] * 0.95] },
      neck: { on: onBody, pos: [0, B ? neck.y : H.y - hr[1] * 0.5, B ? neck.z : H.z] },
      back: B ? { on: 'body', pos: [0, B.y + br[1] * 0.65, B.z - br[2] * 0.45] } : { on: 'head', pos: [0, H.y + hr[1] * 0.4, H.z - hr[2] * 0.7] },
    };
    const M = { type: 'smile', y: -0.32, w: 0.05, open: 0.5, ...(S.mouth || {}) };
    this.mouthSpec = M;
    { const p = this._surfPoint(0, M.y, 0); def.jaw = { on: 'head', pos: [p.x + H.x, p.y + H.y, p.z + H.z] }; }

    this.sock = { root: [{ g: this.norm, side: 0 }], body: [{ g: this.bodyG, side: 0 }], head: [{ g: this.headG, side: 0 }] };
    for (const [name, d] of Object.entries(def)) {
      const o = S.sockets?.[name];
      const cfg = { ...d, ...(Array.isArray(o) ? { pos: o } : o || {}) };
      const recs = [];
      for (const side of PAIRED.has(name) ? [1, -1] : [0]) {
        const g = new THREE.Group(); g.name = `${name}${side < 0 ? 'L' : side > 0 ? 'R' : ''}`;
        const pos = new THREE.Vector3(cfg.pos[0] * (side || 1), cfg.pos[1], cfg.pos[2]).sub(origin[cfg.on]);
        g.position.copy(pos);
        const r = cfg.rot || [0, 0, 0]; g.rotation.set(r[0], side < 0 ? -r[1] : r[1], side < 0 ? -r[2] : r[2]);
        parent[cfg.on].add(g);
        recs.push({ g, side, base: g.rotation.clone(), basePos: g.position.clone() });
      }
      this.sock[name] = recs;
    }

    // parts: head + body + spec parts
    this.parts = {};
    const all = [];
    if (B) all.push({ name: 'body', type: 'ellipsoid', color: 'body', ...S.body, size: br, at: 'body', pos: [B.x, B.y, B.z] });
    all.push({ name: 'head', type: 'ellipsoid', color: 'body', ...S.head, size: hr, at: 'head', pos: [0, 0, 0] });
    all.push(...(S.parts || []));
    for (const p of all) this._addPart(p);

    this._buildFace();
    this.itemSpring = { x: 0, z: 0, vx: 0, vz: 0 };
    this.setItems(this.items);

    this._lift = 0;
    this.rig = `cute kit: ${this._partCount} rigid parts · ${Object.keys(this.sock).reduce((s, k2) => s + this.sock[k2].length, 0)} sockets · motion ${this.motion.type}`;
    this.ctx = this._ctx();
    S.build?.(this.ctx);
    this.update(0, null);

    // normalise (feet on the floor), measured on the spec parts only, in the REST pose
    // (no locomotion offset / float lift on the root, so floaters measure like walkers).
    // Size measure: height alone over-zooms short wide/deep creatures (crab, whale,
    // ladybug), so the scale uses max(height, bulk / BULK_REF), where bulk is the geometric
    // mean of the box sides. Upright creatures (bulk ≲ BULK_REF) still come out height 1.
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3(), pb = new THREE.Box3();
    for (const list of Object.values(this.parts)) for (const m of list) { m.geometry.computeBoundingBox(); box.union(pb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)); }
    const sz = box.getSize(new THREE.Vector3()), hgt = box.max.y || 1;
    const bulk = Math.cbrt(Math.max(1e-6, hgt * sz.x * sz.z));
    const k = 1 / Math.max(hgt, bulk / BULK_REF);
    this.norm.scale.setScalar(k);
    this.width = sz.x * k;
    this.dims = { h: hgt * k, w: sz.x * k, d: sz.z * k, bulk: bulk * k, k };
    // motion envelope (normalised units, root space, yaw-free): the rest box plus the
    // headroom the moods/motion can add on top — happy hops (engine ≈0.15 × kit 1.35, plus
    // spring overshoot), squash-stretch (~8 % of the height) and the float/flutter lift + bob.
    const mo = this.motion, fl = mo.type === 'float' || mo.type === 'flutter';
    const rise = 0.22 + 0.08 * hgt * k + (fl ? (mo.height ?? 0.08) + 0.04 * mo.amp : mo.type === 'hop' ? 0.02 : 0.015);
    this.envelope = { min: box.min.clone().multiplyScalar(k), max: box.max.clone().multiplyScalar(k), rise };
    this.envelope.max.y += rise;
    this.update(0, null);
    this.root.updateMatrixWorld(true);

    const n = this.tris();
    if (n > HARD_TRIS) console.warn(`[cute] ${S.id}: ${n} tris > hard ceiling ${HARD_TRIS}`);
    else if (n > BUDGET_TRIS) console.info(`[cute] ${S.id}: ${n} tris (target ${BUDGET_TRIS})`);
  }

  _addPart(p) {
    const at = ALIAS[p.at] || p.at || 'body';
    const recs = this.sock[at];
    const geo = partGeometry(p);
    const list = this.parts[p.name || `_${Object.keys(this.parts).length}`] ||= [];
    const place = (rec, mirror) => {
      const m = new THREE.Mesh(geo, this._mat(p.color));
      const pos = p.pos || [0, 0, 0], rot = p.rot || [0, 0, 0];
      m.position.set(mirror ? -pos[0] : pos[0], pos[1], pos[2]);
      m.rotation.set(rot[0], mirror ? -rot[1] : rot[1], mirror ? -rot[2] : rot[2], p.rotOrder || 'XYZ');
      if (p.scale) m.scale.set(...size3(p.scale));
      m.userData.colorKey = p.color || 'body'; m.userData.side = mirror ? -1 : rec.side || 1;
      m.userData.basePos = m.position.clone(); m.userData.baseRot = m.rotation.clone(); m.userData.baseScale = m.scale.clone();
      if (p.visible === false) m.visible = false;
      rec.g.add(m); list.push(m); this._partCount = (this._partCount || 0) + 1;
      return m;
    };
    if (PAIRED.has(at)) for (const r of recs) place(r, r.side < 0);
    else { place(recs[0], false); if (p.mirror) place(recs[0], true); }
  }

  // point on the face ellipsoid (head-local) at normalised (u, v), lifted along the normal
  _surfPoint(u, v, lift, q) {
    const [rx, ry, rz] = this.faceR || this.hr;
    let d = u * u + v * v; if (d > 0.96) { const k = Math.sqrt(0.96 / d); u *= k; v *= k; d = 0.96; }
    const x = u * rx, y = v * ry, z = rz * Math.sqrt(1 - d);
    const n = new THREE.Vector3(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
    if (q) q.setFromUnitVectors(Z, n);
    return new THREE.Vector3(x, y, z).addScaledVector(n, lift).add(this.faceOff || new THREE.Vector3());
  }
  _place(obj, u, v, lift) { const p = this._surfPoint(u, v, lift, obj.quaternion); obj.position.copy(p); }

  _buildFace() {
    const S = this.spec;
    this.eyeSpec = { x: 0.4, y: -0.05, r: 0.075, shape: 'round', shine: true, color: 'eye', ...(S.eyes || {}) };
    const E = this.eyeSpec;
    const disc = new THREE.CircleGeometry(1, 16), half = new THREE.CircleGeometry(1, 10, Math.PI, Math.PI);
    const dot = new THREE.CircleGeometry(1, 7), arc = new THREE.TorusGeometry(0.72, 0.26, 3, 6, Math.PI);
    const eyeM = this._mat(E.color), white = this._mat('shine'), sclM = this._mat('white');
    this.eyes = [1, -1].map((side) => {
      const g = new THREE.Group(); this.headG.add(g);
      const inner = new THREE.Group(); g.add(inner);
      const mk = (geo, mat, z) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; inner.add(m); return m; };
      const e = {
        side, g, inner,
        scl: mk(disc, sclM, 0), ball: mk(disc, eyeM, 0.06), half: mk(half, eyeM, 0.06),
        hl1: mk(dot, white, 0.14), hl2: mk(dot, white, 0.14), arc: mk(arc, eyeM, 0.06),
      };
      e.arc.scale.z = 0.35;
      return e;
    });
    // mouth
    const M = this.mouthSpec;
    this.mouth = null;
    if (M.type === 'smile' || M.type === 'cat') {
      const g = new THREE.Group(); this.headG.add(g);
      const arcGeo = new THREE.TorusGeometry(1, 0.3, 3, 6, Math.PI);
      const mk = (geo, mat, z) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; g.add(m); return m; };
      const mouthM = this._mat('mouth');
      const closed = M.type === 'cat'
        ? [mk(arcGeo, mouthM, 0.004), mk(arcGeo, mouthM, 0.004)]
        : [mk(arcGeo, mouthM, 0.004)];
      for (const c of closed) { c.rotation.z = Math.PI; c.scale.set(M.w * (M.type === 'cat' ? 0.55 : 1), M.w * (M.type === 'cat' ? 0.55 : 0.8), 0.01); }
      if (M.type === 'cat') { closed[0].position.x = -M.w * 0.55; closed[1].position.x = M.w * 0.55; }
      const open = mk(new THREE.CircleGeometry(1, 12), mouthM, 0.003);
      const openD = mk(new THREE.CircleGeometry(1, 10, Math.PI, Math.PI), mouthM, 0.003);
      const tongue = mk(new THREE.CircleGeometry(1, 8), this._mat('tongue'), 0.006);
      this.mouth = { g, closed, open, openD, tongue };
      this._place(g, 0, M.y, 0.006);
    }
    this.jaw = this.sock.jaw[0];
    // cheeks
    const C = S.cheeks === false ? null : { x: 0.62, y: -0.28, r: 0.05, ...(S.cheeks || {}) };
    this.cheeks = C ? [1, -1].map((side) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 9), this._mat('cheek'));
      this.headG.add(m); this._place(m, side * C.x, C.y, 0.004);
      m.userData.r = C.r; m.scale.set(C.r * 1.3, C.r, 1); return m;
    }) : [];
    this.cheekSpec = C;
  }

  // ---------- customisation (same surface as proc.js) ----------
  setSkin(s) {
    Object.assign(this.skin, s);
    if (s.body) this.palette.body = s.body;
    if (s.accent) this.palette.accent = s.accent;
    for (const [k, m] of this.mats) if (!k.startsWith('#')) m.color.set(this._color(k));
    for (const c of this.cheeks) c.visible = !!this.skin.blush;
  }

  setItems(it) {
    Object.assign(this.items, it);
    for (const name of ['top', 'neck']) for (const r of this.sock[name]) for (const c of [...r.g.children]) if (c.userData.item) { r.g.remove(c); c.traverse((o) => o.geometry?.dispose()); }
    const top = this.sock.top[0].g, nk = this.sock.neck[0].g;
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const add = (sock, geo, color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { const m = new THREE.Mesh(geo, lam(color)); m.position.set(...p); m.rotation.set(...r); m.scale.set(...s); m.userData.item = true; sock.add(m); return m; };
    const h = this.items.head, n = this.items.neck, hx = this.hr[0];
    this.sprout = null;
    if (h === 'party hat') {
      add(top, new THREE.ConeGeometry(0.11, 0.26, 6, 1, true), '#5ab0e8', [0, 0.1, 0], [0, 0, -0.15]);
      add(top, new THREE.IcosahedronGeometry(0.04, 0), '#f5df7a', [-0.035, 0.235, 0]);
    } else if (h === 'top hat') {
      add(top, new THREE.CylinderGeometry(0.17, 0.17, 0.02, 8), '#26222e', [0, 0, 0]);
      add(top, new THREE.CylinderGeometry(0.1, 0.11, 0.18, 8), '#26222e', [0, 0.1, 0]);
    } else if (h === 'leaf sprout') {
      this.sprout = add(top, new THREE.CylinderGeometry(0.012, 0.018, 0.12, 3), '#4f7a3a', [0, 0.05, 0]);
      const leaf = new THREE.OctahedronGeometry(0.065, 0);
      add(this.sprout, leaf, '#7cc25a', [0.055, 0.07, 0], [0, 0, -0.6], [1, 0.35, 0.6]).userData.item = false;
      add(this.sprout, leaf, '#7cc25a', [-0.045, 0.05, 0], [0, 0, 0.7], [0.8, 0.3, 0.5]).userData.item = false;
    } else if (h === 'bow') {
      const c = new THREE.ConeGeometry(0.055, 0.09, 4);
      const b = add(top, new THREE.IcosahedronGeometry(0.028, 0), '#f06292', [hx * 0.35, -0.02, 0.03]);
      add(b, c, '#f06292', [-0.05, 0, 0], [0, 0, -Math.PI / 2]).userData.item = false;
      add(b, c, '#f06292', [0.05, 0, 0], [0, 0, Math.PI / 2]).userData.item = false;
    } else if (h === 'headphones') {
      const Rr = hx * 1.06, dy = -this.hr[1];
      add(top, new THREE.TorusGeometry(1, 0.022, 3, 7, Math.PI), '#26222e', [0, dy, 0], [0, 0, 0], [Rr, this.hr[1] * 1.04, 1]);
      for (const sx of [-1, 1]) add(top, new THREE.CylinderGeometry(0.075, 0.075, 0.05, 6), '#f39a6b', [sx * Rr, dy, 0], [0, 0, Math.PI / 2]);
    }
    const ny = this.sock.neck[0].basePos.y + (this.spec.sockets?.neck?.on === 'head' || !this.B ? this.H.y : 0);
    const [ex0, ez0] = this.ringAt(ny); const ex = Math.max(0.05, ex0) * 1.04, ez = Math.max(0.05, ez0) * 1.04;
    if (n === 'scarf') {
      add(nk, new THREE.TorusGeometry(1, 0.045, 3, 9), '#e2574c', [0, 0, 0], [Math.PI / 2, 0, 0], [ex, ez, 1]);
      add(nk, new THREE.BoxGeometry(0.08, 0.17, 0.03), '#e2574c', [0.3 * ex, -0.08, ez * 0.93], [0.1, 0.3, 0.12]);
    } else if (n === 'bow tie') {
      const g = new THREE.ConeGeometry(0.06, 0.09, 3, 1);
      add(nk, g, '#5ab0e8', [-0.05, 0, ez], [0, 0, Math.PI / 2]);
      add(nk, g, '#5ab0e8', [0.05, 0, ez], [0, 0, -Math.PI / 2]);
      add(nk, new THREE.IcosahedronGeometry(0.022, 0), '#3e86bd', [0, 0, ez * 1.02]);
    } else if (n === 'bell collar') {
      add(nk, new THREE.TorusGeometry(1, 0.022, 3, 9), '#e2574c', [0, 0, 0], [Math.PI / 2, 0, 0], [ex, ez, 1]);
      add(nk, new THREE.IcosahedronGeometry(0.035, 0), '#f5df7a', [0, -0.04, ez * 1.02]);
    }
  }

  tris() {
    let n = 0;
    const walk = (o) => { if (!o.visible) return; if (o.isMesh) n += triCount(o.geometry); for (const c of o.children) walk(c); };
    walk(this.root);
    return Math.round(n);
  }

  // ---------- hooks ----------
  _ctx() {
    const self = this;
    return {
      THREE, spec: this.spec, extras: this.spec.extras || {}, creature: this,
      part: (name) => self.parts[name] || [],
      socket: (name) => (self.sock[ALIAS[name] || name] || []).map((r) => r.g),
      addPart: (p) => self._addPart(p),
      mat: (key) => self._mat(key),
      t: 0, dt: 0, pose: null, w: this.w, L: null,
      face: { eyes: this.eyes, mouth: this.mouth, cheeks: this.cheeks },
    };
  }

  // ---------- per frame ----------
  update(dt, pose) {
    const S = this.spec;
    const P = pose || { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 }, spine: { x: 0, y: 0, z: 0 }, squash: 0, lid: 0, look: { x: 0, y: 0 }, mouth: 0, eye: 'normal', emote: '', mood: 'idle' };
    this.t += dt; const t = this.t;
    const mood = P.mood || (P.eye === 'happy' ? 'happy' : P.eye === 'sleepy' ? 'sleepy' : P.emote === '!' ? 'surprised' : P.eye === 'wide' ? 'listening' : 'idle');
    const kw = dt > 0 ? 1 - Math.exp(-dt * 6) : 1;
    for (const m in this.w) this.w[m] += ((m === mood ? 1 : 0) - this.w[m]) * kw;
    const w = this.w;
    const act = clamp(1 + 0.35 * w.happy - 0.95 * w.sleepy - 0.5 * w.listening, 0, 1.5);

    // locomotion + cute layer
    const L = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 }, squash: 0, lift: 0,
      foot: [{ lift: 0 }, { lift: 0 }], side: 0, ear: 0, tail: { x: 0, y: 0, z: 0 } };
    MOTIONS[this.motion.type](L, t, act, w, this.motion);
    // curious head tilt every few seconds (idle / listening)
    const tl = this.tilt;
    if (tl.t < 0 && t > tl.next) { tl.t = 0; tl.dir = Math.random() < 0.5 ? -1 : 1; }
    if (tl.t >= 0) { tl.t += dt; const q = tl.t / 1.5; L.head.z += 0.2 * tl.dir * Math.sin(Math.PI * Math.min(1, q)) * (w.idle + 0.6 * w.listening); if (q >= 1) { tl.t = -1; tl.next = t + rand(3.5, 7); } }
    // happy: higher, springier hops
    L.pos.y += 0.35 * w.happy * P.pos.y;
    this._lift += ((L.lift) - this._lift) * kw;

    // body
    this.root.position.set(P.pos.x + L.pos.x, P.pos.y + L.pos.y + this._lift, P.pos.z + L.pos.z);
    this.root.rotation.set(P.rot.x + L.rot.x, P.rot.y + L.rot.y, P.rot.z + L.rot.z);
    this.lean.rotation.set(P.spine.x * 0.5, P.spine.y * 0.5, P.spine.z * 0.5);
    const sq = (P.squash + L.squash) * 1.25, sy = 1 + sq, sx = 1 / Math.sqrt(Math.max(0.3, sy));
    this.bodyG.scale.set(sx, sy, sx);
    const hs = S.head.squash ?? (this.B ? 0.5 : 1), hsy = 1 + sq * hs, hsx = 1 / Math.sqrt(Math.max(0.3, hsy));
    this.headPivot.position.set(this.neckP.x, this.neckP.y * (this.B ? sy : 1), this.neckP.z);
    this.headPivot.scale.set(hsx, hsy, hsx);
    const pk = S.head.pitch ?? 0.65; // big heads read better with less nod (keeps the face on screen when sleepy)
    this.headPivot.rotation.set(P.head.x * pk + L.head.x, P.head.y + L.head.y, P.head.z + L.head.z);

    // follow-through spring (ears, antennae, sprout): lags head roll/pitch + vertical motion
    const sp = this.spring, roll = P.head.z + L.head.z + P.rot.z + L.rot.z, pitch = P.head.x + L.head.x;
    const vy = dt > 0 ? (this.root.position.y - sp.lastY) / dt : 0; sp.lastY = this.root.position.y;
    if (dt > 0) {
      sp.vz += (140 * (roll - sp.z) - 7 * sp.vz) * dt; sp.z += sp.vz * dt;
      sp.vx += (140 * (pitch - sp.x) - 7 * sp.vx) * dt - vy * 0.9 * dt * 60 * 0.02; sp.x += sp.vx * dt;
    }
    const lagZ = clamp(sp.z - roll, -0.6, 0.6), lagX = clamp(sp.x - pitch, -0.6, 0.6);

    this._face(P, w, t, dt, mood);
    this._limbs(P, L, w, t, dt, lagX, lagZ, act);
    if (this.sprout) this.sprout.rotation.set(lagX * 2.5, 0, lagZ * 2.5);

    if (S.update) { const c = this.ctx; c.t = t; c.dt = dt; c.pose = P; c.w = w; c.L = L; c.lag = { x: lagX, z: lagZ }; S.update(c); }
  }

  _face(P, w, t, dt, mood) {
    const E = this.eyeSpec;
    // extra blinks (rule 1 is in the engine; cute critters blink more)
    const b = this.blink; let kb = 0;
    if (b.t < 0 && t > b.next) b.t = 0;
    if (b.t >= 0) { b.t += dt; kb = bump(b.t, 0, 0.17); if (b.t > 0.17) { b.t = -1; b.next = t + rand(1.8, 4); } }
    // Eye state has ONE source: the target mood. The engine's P.eye flips only halfway
    // through its 0.5–1 s crossfade and P.lid crossfades the old mood's 70–90 % lid into the
    // new one, so keying the shape off P.eye / P.lid (and `surprised` off a smoothed weight)
    // showed sleepy half-lids for ~0.3 s into "surprised" and squashed the O O for the
    // rest of the fade. The kit owns the sleepy lid instead: it tracks P.lid while sleepy and
    // decays on exit (snaps open for a surprise). The engine's blinks (inside P.lid) are
    // trusted again once the crossfade out of sleepy is surely over (> 1.1 s).
    const surprised = mood === 'surprised', happy = mood === 'happy', sleepy = mood === 'sleepy', wide = mood === 'listening';
    const ls = this.lidState ||= { sleep: 0, since: 9 };
    let lidBase;
    if (sleepy) { ls.sleep = P.lid; ls.since = 0; lidBase = P.lid; }
    else { ls.since += dt; ls.sleep *= Math.exp(-dt * (surprised ? 40 : 8)); lidBase = Math.max(ls.sleep, ls.since > 1.1 ? P.lid : 0); }
    const lid = clamp(Math.max(lidBase, kb), 0, 1);
    const shapeY = E.shape === 'tall' ? 1.2 : E.shape === 'wide' ? 0.85 : 1;
    const shapeX = E.shape === 'wide' ? 1.15 : 1;
    for (const e of this.eyes) {
      const u = e.side * E.x + P.look.x * 0.15, v = E.y + P.look.y * 0.13 + (surprised ? 0.03 : 0);
      this._place(e.g, u, v, 0.006);
      const r = E.r * (surprised ? 1.28 : wide ? 1.1 : 1);
      e.inner.scale.set(r * shapeX, r * shapeY, r);
      e.inner.rotation.z = (E.tilt || 0) * e.side;
      const show = (k) => { for (const n of ['scl', 'ball', 'half', 'hl1', 'hl2', 'arc']) e[n].visible = k.includes(n); };
      if (happy && lid < 0.9) { // ^ ^
        show(['arc']); e.arc.rotation.z = 0; e.arc.position.y = -0.3; e.arc.scale.set(1, 1.05, 0.35);
      } else if (lid > 0.8) { // closed: ‿ ‿
        show(['arc']); e.arc.rotation.z = Math.PI; e.arc.position.y = 0.05; e.arc.scale.set(0.95, sleepy ? 0.6 : 0.42, 0.35);
      } else if (sleepy && lid > 0.45) { // heavy half-lids: flat top edge (round lids close top-down until then)
        show(['half', 'hl2']);
        const o = clamp((1 - lid) * 3.2, 0.35, 1);
        e.half.scale.set(1, o, 1); e.half.position.y = -0.05;
        e.hl2.position.set(0.25, -0.05 - o * 0.45, 0.14); e.hl2.scale.setScalar(0.14);
      } else if (surprised) { // O O: white sclera ring around a smaller pupil
        show(['scl', 'ball', 'hl1', 'hl2']);
        const open = 1 - lid;
        e.scl.scale.set(1, open, 1); e.scl.position.y = -(1 - open);
        e.ball.scale.set(0.58, 0.58 * open, 1); e.ball.position.set(P.look.x * 0.12, -(1 - open) * 0.6 + P.look.y * 0.1, 0.06);
        e.hl1.position.set(e.ball.position.x + 0.2, e.ball.position.y + 0.2, 0.14); e.hl1.scale.setScalar(0.2);
        e.hl2.position.set(e.ball.position.x - 0.2, e.ball.position.y - 0.2, 0.14); e.hl2.scale.setScalar(0.09);
      } else { // big glossy eye, lids close top-down
        const open = 1 - lid; const hl = E.shine !== false && open > 0.45;
        show(hl ? ['ball', 'hl1', 'hl2'] : ['ball']);
        e.ball.scale.set(1, open, 1); e.ball.position.set(0, -(1 - open), 0.06);
        e.hl1.position.set(0.32, 0.34 - (1 - open), 0.14); e.hl1.scale.setScalar(0.34);
        e.hl2.position.set(-0.3, -0.38, 0.14); e.hl2.scale.setScalar(0.15);
      }
    }
    // mouth
    const M = this.mouthSpec, m = this.mouth;
    if (m) {
      const think = w.thinking > 0.5;
      this._place(m.g, think ? 0.12 * (P.look.x > 0 ? 1 : -1) : 0, M.y + (surprised ? -0.02 : 0), 0.006);
      const open = P.mouth;
      for (const c of m.closed) c.visible = open < 0.07;
      m.open.visible = m.openD.visible = m.tongue.visible = false;
      if (open < 0.07) {
        const k = think ? 0.6 : 1;
        for (const c of m.closed) c.scale.x = M.w * (M.type === 'cat' ? 0.55 : 1) * k;
      } else if (happy) {
        m.openD.visible = m.tongue.visible = true;
        m.openD.scale.set(M.w * 1.15, M.w * 1.15, 1); m.openD.position.y = M.w * 0.35;
        m.tongue.scale.set(M.w * 0.6, M.w * 0.4, 1); m.tongue.position.y = -M.w * 0.45;
      } else {
        m.open.visible = true; m.tongue.visible = open > 0.3;
        const ox = surprised ? 0.65 : 0.8 + 0.3 * open, oy = surprised ? 0.85 : 0.2 + 0.85 * open;
        m.open.scale.set(M.w * ox, M.w * oy, 1);
        m.tongue.scale.set(M.w * ox * 0.6, M.w * oy * 0.35, 1); m.tongue.position.y = -M.w * oy * 0.5;
      }
    }
    if (this.jaw && M.type === 'jaw') {
      const r = this.jaw;
      r.g.rotation.set(r.base.x + P.mouth * M.open, r.base.y, r.base.z);
    }
    for (const c of this.cheeks) { const k = 1 + 0.3 * w.happy + 0.15 * w.surprised; c.scale.set(c.userData.r * 1.3 * k, c.userData.r * k, 1); }
  }

  _limbs(P, L, w, t, dt, lagX, lagZ, act) {
    const A = this.limbAmp;
    // sides (wings / arms / fins): spread = outward-up angle
    const flap = 0.55 + 0.5 * Math.sin(TAU * 7 * t);
    const spread = (w.happy * flap + w.surprised * 0.95 + w.speaking * (0.18 + 0.16 * Math.sin(TAU * 1.4 * t)) + w.listening * 0.12 - w.sleepy * 0.12 + L.side) * A.side;
    for (const r of this.sock.side) r.g.rotation.set(r.base.x - 0.15 * w.happy * A.side * Math.sin(TAU * 7 * t + 1), r.base.y, r.base.z + r.side * spread);
    // ears: droop = outward fall; listening perks them, sleepy droops
    const droop = (w.sleepy * 0.6 - w.listening * 0.18 - w.surprised * 0.2 + w.happy * 0.14 * Math.sin(TAU * 4 * t) + L.ear) * A.ear;
    for (const r of this.sock.ear) r.g.rotation.set(r.base.x + (w.listening * -0.25 + lagX * 0.8) * A.ear, r.base.y, r.base.z - r.side * droop + lagZ * 1.3 * A.ear);
    for (const r of this.sock.antenna) r.g.rotation.set(r.base.x + lagX * 1.6 * A.antenna, r.base.y, r.base.z + lagZ * 1.8 * A.antenna - r.side * 0.25 * w.sleepy);
    // tail: wag + an occasional flick
    const f = this.flick; let fk = 0;
    if (f.t < 0 && t > f.next) f.t = 0;
    if (f.t >= 0) { f.t += dt; fk = bump(f.t, 0, 0.28); if (f.t > 0.28) { f.t = -1; f.next = t + rand(2.5, 6); } }
    const wf = 1.1 + 3 * w.happy + 1 * w.speaking - 0.7 * w.sleepy, wa = 0.18 + 0.3 * w.happy - 0.14 * w.sleepy;
    this._wagPh = (this._wagPh || 0) + TAU * wf * dt;
    for (const r of this.sock.tail) r.g.rotation.set(r.base.x + (L.tail.x - 0.55 * fk * (1 - w.sleepy) + 0.25 * w.sleepy) * A.tail, r.base.y + (wa * Math.sin(this._wagPh) + L.tail.y) * A.tail, r.base.z + L.tail.z * A.tail);
    // feet: locomotion lifts (toe up); tucked during happy hops
    this.sock.foot.forEach((r, i) => {
      const lift = (L.foot[i].lift + Math.max(0, (this.root.position.y - this._lift) * 0.15)) * A.foot;
      r.g.position.set(r.basePos.x, r.basePos.y + lift, r.basePos.z);
      r.g.rotation.set(r.base.x - lift * 6, r.base.y, r.base.z);
    });
  }

  dispose() { this.root.removeFromParent(); this.root.traverse((o) => o.geometry?.dispose()); for (const m of this.mats.values()) m.dispose(); }
}
