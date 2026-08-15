/**
 * The field program IR — the "steering seam" described in VOLUMETRIC.md's
 * "The field program IR" section. Plain data: an array of layers, each an
 * array of voices, with no fixed length anywhere. Field-synth's flat
 * `field1..6`/`layer1..6` schema (packages/effects/src/stock.ts) is a
 * FRONTEND that compiles down to this IR every `evaluate()` call —
 * `SYNTH_VOICES` and the six-voice schema cap that frontend, never this
 * evaluator or the sampler-agnostic marcher below, both of which are
 * unbounded and exported for reuse (a future SDF-sourced program, the
 * spectral track's analysis-mode output, or carve's per-cell march all plug
 * into the same two functions).
 *
 * Kept dependency-free of `GlyphEffectEvaluateContext` on purpose: this
 * module is pure spatial math, reusable outside a mounted glyphcss effect
 * (e.g. a future field-authoritative primitive). Context-shaped glue
 * (`fieldSynthCoordinate`, the schema, presets) stays in `stock.ts`.
 */

// ---- basis-kind enums (append-only; the /synth URL codec encodes these by
// index, so a new value is always appended, never inserted) ----------------

export const SYNTH_FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise", "linearZ", "gyroid", "menger", "sierpinski"] as const;
export const SYNTH_WAVES = ["sin", "triangle", "saw", "square", "step"] as const;
export const SYNTH_COMBINES = ["add", "multiply", "max", "min", "difference", "argmax"] as const;

// ---- waveform + noise primitives -------------------------------------

// Exported so consumers (e.g. the website's `/synth` waveform trendlines) can
// plot the exact same shape+phase math the engine evaluates, instead of a
// second copy that could drift. `duty` only shapes the square wave (the high
// fraction of its cycle, `p < duty ? 1 : -1`); every other kind ignores it.
// Default 0.5 reproduces the pre-duty `p < 0.5` split exactly.
export function synthWave(kind: string, t: number, duty = 0.5): number {
  // Non-periodic: `+1` when `t >= 0`, else `-1` — duty ignored (there is no
  // cycle to shape). Checked before the `p = t - floor(t)` periodic
  // reduction every other wave shares, since folding `t` into 0..1 would
  // destroy the very discontinuity this wave exists to expose. Legal on
  // every field — e.g. a `linearX` step is a half-space — but every SDF
  // preset depends on this exact line: inside the solid `sdf < 0` ->
  // `raw > 0` -> `t > 0` -> `step = +1` -> `d > 0.5` at default bias -> solid.
  if (kind === "step") return t >= 0 ? 1 : -1;
  const p = t - Math.floor(t); // 0..1
  switch (kind) {
    case "triangle": return 4 * Math.abs(p - 0.5) - 1;
    case "saw": return 2 * p - 1;
    case "square": return p < duty ? 1 : -1;
    default: return Math.sin(t * Math.PI * 2); // sin
  }
}

function synthHash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// Time is a third lattice axis (not an x-translation), so the pattern morphs
// in place — trilinear interpolation between the z and z+1 lattice frames —
// instead of sliding sideways as `time` advances.
function synthNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a000 = synthHash3(xi, yi, zi), a100 = synthHash3(xi + 1, yi, zi);
  const a010 = synthHash3(xi, yi + 1, zi), a110 = synthHash3(xi + 1, yi + 1, zi);
  const a001 = synthHash3(xi, yi, zi + 1), a101 = synthHash3(xi + 1, yi, zi + 1);
  const a011 = synthHash3(xi, yi + 1, zi + 1), a111 = synthHash3(xi + 1, yi + 1, zi + 1);
  const frame0 = (a000 * (1 - u) + a100 * u) * (1 - v) + (a010 * (1 - u) + a110 * u) * v;
  const frame1 = (a001 * (1 - u) + a101 * u) * (1 - v) + (a011 * (1 - u) + a111 * u) * v;
  return frame0 * (1 - w) + frame1 * w; // 0..1
}

function synthHash4(x: number, y: number, z: number, w: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + w * 269.5) * 43758.5453;
  return h - Math.floor(h);
}

// The volumetric noise voice's 4th axis: the 2D path's `synthNoise3` already
// spends its third lattice axis on `time` (see above), so a genuinely
// volumetric noise field — spatial x/y/z plus a still-independent time axis —
// needs a fourth. Quadrilinear interpolation over the hypercube's 16 corners,
// same corner-hash-then-smoothstep-blend construction as `synthNoise3`, one
// dimension up.
function synthNoise4(x: number, y: number, z: number, t: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), ti = Math.floor(t);
  const xf = x - xi, yf = y - yi, zf = z - zi, tf = t - ti;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf), r = tf * tf * (3 - 2 * tf);
  const c0000 = synthHash4(xi, yi, zi, ti), c1000 = synthHash4(xi + 1, yi, zi, ti);
  const c0100 = synthHash4(xi, yi + 1, zi, ti), c1100 = synthHash4(xi + 1, yi + 1, zi, ti);
  const c0010 = synthHash4(xi, yi, zi + 1, ti), c1010 = synthHash4(xi + 1, yi, zi + 1, ti);
  const c0110 = synthHash4(xi, yi + 1, zi + 1, ti), c1110 = synthHash4(xi + 1, yi + 1, zi + 1, ti);
  const c0001 = synthHash4(xi, yi, zi, ti + 1), c1001 = synthHash4(xi + 1, yi, zi, ti + 1);
  const c0101 = synthHash4(xi, yi + 1, zi, ti + 1), c1101 = synthHash4(xi + 1, yi + 1, zi, ti + 1);
  const c0011 = synthHash4(xi, yi, zi + 1, ti + 1), c1011 = synthHash4(xi + 1, yi, zi + 1, ti + 1);
  const c0111 = synthHash4(xi, yi + 1, zi + 1, ti + 1), c1111 = synthHash4(xi + 1, yi + 1, zi + 1, ti + 1);

  const y0t0 = (c0000 * (1 - u) + c1000 * u) * (1 - v) + (c0100 * (1 - u) + c1100 * u) * v;
  const y1t0 = (c0010 * (1 - u) + c1010 * u) * (1 - v) + (c0110 * (1 - u) + c1110 * u) * v;
  const frame0 = y0t0 * (1 - w) + y1t0 * w;

  const y0t1 = (c0001 * (1 - u) + c1001 * u) * (1 - v) + (c0101 * (1 - u) + c1101 * u) * v;
  const y1t1 = (c0011 * (1 - u) + c1011 * u) * (1 - v) + (c0111 * (1 - u) + c1111 * u) * v;
  const frame1 = y0t1 * (1 - w) + y1t1 * w;

  return frame0 * (1 - r) + frame1 * r; // 0..1
}

const INV_SQRT3 = 1 / Math.sqrt(3);

// ---- SDF voice family (VOLUMETRIC-2.md §2) ------------------------------

// Exact box SDF: `length(max(q,0)) + min(max(q.x,max(q.y,q.z)),0)`, `q =
// abs(p) - b`. Negative inside, positive outside — the sign convention every
// SDF primitive below shares. Exact (not a bound) for a single box, and a
// UNION of boxes' SDF is exactly `min` of their individual SDFs (unlike CSG
// subtraction/intersection, union-via-min is a textbook-exact identity —
// this is what `fractalUnionSdf` below leans on).
function sdfBox(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
  const dx = Math.abs(px) - bx, dy = Math.abs(py) - by, dz = Math.abs(pz) - bz;
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0), az = Math.max(dz, 0);
  return Math.hypot(ax, ay, az) + Math.min(Math.max(dx, Math.max(dy, dz)), 0);
}

// A prior implementation used Inigo Quilez's iterative cross-subtraction
// Menger construction and its base-2 "corner octant" adaptation for
// Sierpinski. Both are cheap, sign-exact CSG-max approximations, but the
// review that motivated this rewrite found neither is a genuine Euclidean
// SDF to the finite depth-iter box/tetra union the spec requires (menger
// iter-1 at the domain center: 0.166667 vs the true 0.235702) — the max-of-
// folds construction does not preserve distance, and Sierpinski's own
// periodic `mod` reduction leaks outside the unit cell, reporting a
// near-zero false surface just past the domain corner instead of growing
// distance with separation (sierpinski iter-1 near (1.00375,1.00375,1.00375):
// 0.006495 vs the true 0.712420).
//
// Replacement: `fractalUnionSdf` recursively descends the SAME kept-child
// tree the digit-rule membership test walks (menger: 20-of-27 axis-aligned
// subcubes per level, keeping any subcube with at most one coordinate index
// in the middle third; sierpinski: 4-of-8 octants per level, keeping the
// all-lower octant plus the three single-upper-axis octants — VOLUMETRIC-2.
// md's addendum), but instead of an analytic max-fold it computes the EXACT
// distance to the union of the leaf boxes at depth `iter`: `sdf_union(p) =
// min_i sdf_box_i(p)` is an exact identity for a union of boxes (not a
// Lipschitz bound), so as long as every LEAF box's own SDF is exact — which
// `sdfBox` is — the recursive min is exact too, at every depth, inside and
// outside the unit cell alike (there is no periodic reduction anywhere in
// this construction, so nothing can leak past the domain boundary).
//
// Cost is bounded by branch-and-bound pruning: `sdfBox` to a PARENT box is a
// valid, cheap lower bound for the SDF of any of its descendants (subset
// containment implies `sdf_parent(p) <= sdf_descendant(p)` for every p, both
// inside and outside), so a child whose own bounding-box distance already
// exceeds the best union distance found so far cannot improve it and is
// skipped without descending. Children are visited nearest-bound-first (a
// small insertion sort — at most 20 entries) so the running best tightens
// early and a single `break` (not just `continue`) prunes every remaining,
// farther-sorted sibling at once. `iter <= 4` (the schema cap) keeps the
// worst case small; near a genuine surface, only a handful of nodes per
// level survive pruning (bench/sdf-carve-march.mjs).
interface FractalChildOffset { readonly ox: number; readonly oy: number; readonly oz: number }

// 20 of 27: every (ox,oy,oz) in {-1,0,1}^3 with at most one coordinate 0 (the
// "middle third" digit) — excludes the 1 center cube (all three 0) and the 6
// face-center cubes (exactly two 0), matching `mengerSolidRef`'s "midCount
// >= 2 -> hole" digit rule (fieldProgram.test.ts).
const MENGER_CHILD_OFFSETS: readonly FractalChildOffset[] = (() => {
  const out: FractalChildOffset[] = [];
  for (let oz = -1; oz <= 1; oz++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const zeros = (ox === 0 ? 1 : 0) + (oy === 0 ? 1 : 0) + (oz === 0 ? 1 : 0);
        if (zeros <= 1) out.push({ ox, oy, oz });
      }
    }
  }
  return out;
})();

// 4 of 8: every (ox,oy,oz) in {-1,1}^3 with at most one coordinate +1 (the
// "upper half" digit) — the all-lower octant plus the three single-upper-
// axis octants, matching `sierpinskiSolidRef`'s "upperCount >= 2 -> hole"
// digit rule (VOLUMETRIC-2.md's addendum, fieldProgram.test.ts).
const SIERPINSKI_CHILD_OFFSETS: readonly FractalChildOffset[] = (() => {
  const out: FractalChildOffset[] = [];
  for (let oz = -1; oz <= 1; oz += 2) {
    for (let oy = -1; oy <= 1; oy += 2) {
      for (let ox = -1; ox <= 1; ox += 2) {
        const uppers = (ox === 1 ? 1 : 0) + (oy === 1 ? 1 : 0) + (oz === 1 ? 1 : 0);
        if (uppers <= 1) out.push({ ox, oy, oz });
      }
    }
  }
  return out;
})();

// Recursively descend `depthRemaining` more levels below a node centered at
// (cx, cy, cz) with half-extent `half`, splitting into `offsets.length`
// equal children per level (menger: 3-way per axis via `MENGER_CHILD_
// OFFSETS`; sierpinski: 2-way via `SIERPINSKI_CHILD_OFFSETS`) — a child's
// center sits `offset * childHalf * (divisor - 1)` from its parent's, the
// closed form for splitting an interval of half-extent `half` into `divisor`
// equal parts. `best` is the running minimum SDF found so far (branch-and-
// bound state, not a public parameter — always called with `Infinity` from
// the two entry points below).
function fractalUnionSdf(
  px: number, py: number, pz: number,
  cx: number, cy: number, cz: number,
  half: number,
  depthRemaining: number,
  divisor: number,
  offsets: readonly FractalChildOffset[],
  best: number,
): number {
  if (depthRemaining === 0) {
    const d = sdfBox(px - cx, py - cy, pz - cz, half, half, half);
    return d < best ? d : best;
  }
  const childHalf = half / divisor;
  const centerScale = childHalf * (divisor - 1);
  const n = offsets.length;
  const bounds = new Array<number>(n);
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const o = offsets[i]!;
    const ccx = cx + o.ox * centerScale, ccy = cy + o.oy * centerScale, ccz = cz + o.oz * centerScale;
    // A parent-box distance is a valid lower bound for every descendant's
    // SDF (see the doc above), so this is cheap, safe pruning bait.
    bounds[i] = sdfBox(px - ccx, py - ccy, pz - ccz, childHalf, childHalf, childHalf);
    order[i] = i;
  }
  // Insertion sort by ascending bound (n <= 20) — nearest child first, so
  // `best` tightens as early as possible and the loop below can `break` the
  // instant a bound can no longer help, pruning every remaining (farther)
  // sibling in one step instead of testing each individually.
  for (let i = 1; i < n; i++) {
    const oi = order[i]!, bi = bounds[oi]!;
    let j = i - 1;
    while (j >= 0 && bounds[order[j]!]! > bi) { order[j + 1] = order[j]!; j--; }
    order[j + 1] = oi;
  }
  let curBest = best;
  for (let idx = 0; idx < n; idx++) {
    const i = order[idx]!;
    const bound = bounds[i]!;
    if (bound >= curBest) break; // sorted ascending: every remaining sibling is >= too
    const o = offsets[i]!;
    const ccx = cx + o.ox * centerScale, ccy = cy + o.oy * centerScale, ccz = cz + o.oz * centerScale;
    const d = fractalUnionSdf(px, py, pz, ccx, ccy, ccz, childHalf, depthRemaining - 1, divisor, offsets, curBest);
    if (d < curBest) curBest = d;
  }
  return curBest;
}

// Signed distance to the depth-`iter` Menger sponge approximation on the
// unit cell [0,1]^3 (matching the recipe / pyramid stage) — the union of
// solid boxes left after `iter` rounds of removing each cube's center + 6
// face-center sub-cubes (the 20-of-27 division), NOT a limit-set distance
// estimator: the true limit set has measure zero, so its exact SDF is
// positive almost everywhere and carves to nothing. See `fractalUnionSdf`'s
// doc for the construction and its exactness argument. Sign-verified against
// the base-3 "middle-third" digit-rule reference (`fieldProgram.test.ts`'s
// Menger membership test) at depths 1-3 with zero mismatches on a sampled
// grid away from band boundaries; distance-verified against an independent
// brute-force leaf-box enumeration (same test file) at depths 1-2, inside,
// outside, and near-surface.
// Exported (alongside `sierpinskiFractalSdf` below), like `synthWave`/
// `combineSynth`/`effectiveVoiceFinestFreq` above, for direct testing —
// `sampleFieldVoice`'s public surface only exposes the raw value through a
// nonlinear `synthWave`, which can't recover the exact signed-distance
// magnitude the P1-A distance-fidelity tests need to pin against a
// brute-force reference.
export function mengerFractalSdf(x: number, y: number, z: number, iter: number): number {
  const px = x - 0.5, py = y - 0.5, pz = z - 0.5;
  return fractalUnionSdf(px, py, pz, 0, 0, 0, 0.5, iter, 3, MENGER_CHILD_OFFSETS, Infinity);
}

// Signed distance to the depth-`iter` corner-tetra Sierpinski approximation
// on the unit cell [0,1]^3 (VOLUMETRIC-2.md's addendum) — `mengerFractalSdf`'s
// base-2 sibling, same construction and exactness argument, over the 4-of-8
// kept-octant tree instead of the 20-of-27 kept-subcube tree. Sign-verified
// against the binary "at most one axis upper half" digit-rule reference at
// depths 1-3 with zero mismatches on a sampled grid away from band
// boundaries; distance-verified (including the reviewer's outside-domain-
// corner counterexample) against an independent brute-force leaf-box
// enumeration.
export function sierpinskiFractalSdf(x: number, y: number, z: number, iter: number): number {
  const px = x - 0.5, py = y - 0.5, pz = z - 0.5;
  return fractalUnionSdf(px, py, pz, 0, 0, 0, 0.5, iter, 2, SIERPINSKI_CHILD_OFFSETS, Infinity);
}

// `iter1..6`'s schema range is integer 1..4 (capped there because
// carve/xray's march resolution caps at 256 steps — menger iter 4 needs
// ~162 steps on a unit chord and fits, iter 5 needs ~486 and would render
// guaranteed false holes). Defensive here too, since `FieldVoice` is a hand-
// buildable IR (tests, a future SDF-sourced program) with no schema between
// it and this sampler.
function clampSdfIter(iter: number | undefined): number {
  const n = Math.round(iter ?? 3);
  return Math.max(1, Math.min(4, Number.isFinite(n) ? n : 3));
}

// ---- IR types ----------------------------------------------------------

export interface FieldVoice {
  readonly field: string;
  readonly wave: string;
  readonly freq: number;
  readonly speed: number;
  readonly amp: number;
  /** Cycles, added to the wave argument for every field/wave kind. */
  readonly phase: number;
  /** Square wave's high fraction (`p < duty ? 1 : -1`); other waves ignore it. */
  readonly duty: number;
  /** Degrees; rotates this voice's sampling frame about its own origin (XY plane only). */
  readonly angle: number;
  /**
   * This voice's origin, RELATIVE to whatever call-level origin
   * `evaluateFieldProgram` is invoked with (see that function's doc) — not
   * an absolute domain coordinate. Only radial/angular/spiral, the `angle`
   * rotation pivot, and the SDF family (`gyroid`/`menger`/`sierpinski`,
   * VOLUMETRIC-2.md §2 — as a full pre-evaluation TRANSLATION of the sample,
   * the opposite of every linear field's convention) read it; linear fields
   * ignore origin entirely, matching field-synth's documented axis-
   * projection behavior.
   */
  readonly origin: { readonly u: number; readonly v: number; readonly w: number };
  readonly color: string;
  /**
   * Menger/Sierpinski recursion depth (integer, schema range 1..4, default
   * 3 when omitted — see `clampSdfIter`). Every other field ignores it.
   */
  readonly iter?: number;
  /**
   * This voice's position in its FLAT original source order (e.g.
   * field-synth's voice1..6), independent of which layer it was grouped
   * into. `foldVoices` reports THIS as the argmax winner identity (falling
   * back to the voice's position within its own layer's array when omitted)
   * so a caller indexing a flat per-voice table (e.g. `voiceColors`) by the
   * reported winner always lands on the voice that actually won, even when
   * layers reorder/filter voices out of flat order. Optional: a hand-built
   * IR program (tests, a future SDF-sourced program) with no meaningful flat
   * source order can omit it, and for a single-layer program the fallback
   * (layer-local position) already equals flat position, so pre-layers
   * behavior is unaffected.
   */
  readonly sourceIndex?: number;
}

export interface FieldLayer {
  readonly voices: readonly FieldVoice[];
  /** Intra-layer voice fold op (mix-weight fold, `voice.amp` as the weight). */
  readonly combine: string;
  readonly thresholdOn: boolean;
  /** Range roughly -3..3 for an add-fold of up to 3 unit-amplitude voices. */
  readonly threshold: number;
  readonly invert: boolean;
  /** How this layer's shaped output enters the layer stack. No "argmax" — layers are value-folded, not selected by identity. */
  readonly blend: string;
  /** Mix weight for this layer entering the stack, mirroring `voice.amp` one level up. */
  readonly amp: number;
}

/**
 * `domain` is a program-level property (not a per-call argument): every layer
 * of a compiled program shares one evaluation domain, and baking it into the
 * program keeps `evaluateFieldProgram`'s call site from having to thread a
 * `volumetric` boolean everywhere the program itself is already threaded
 * (VOLUMETRIC.md's Phase 3 seam fix — "promote `volumetric` from call
 * argument to program state"). Call-level origin stays a runtime argument to
 * `evaluateFieldProgram` because it genuinely varies per call (per coplanar
 * surface group under `space: "surface"`), unlike domain.
 *
 * `layers` is length-free; a layer with no active (amp > 0) voices is skipped
 * in the fold.
 */
export interface FieldProgram {
  readonly domain: "2d" | "3d";
  readonly layers: readonly FieldLayer[];
}

export interface FieldEvalResult {
  readonly combined: number;
  /**
   * The winning voice's FLAT source index (see `FieldVoice.sourceIndex`),
   * meaningful only when exactly one layer is populated AND that layer's
   * combine is "argmax" (argmax is categorical and — per VOLUMETRIC.md's
   * Step 3 — deliberately stays single-layer). -1 otherwise.
   */
  readonly winner: number;
  /** Total active voices across every layer. */
  readonly active: number;
}

// One voice → value in ~[-1, 1] (voice.amp is applied by the caller's
// mix-weight fold, not here — matching field-synth's existing convention of
// always sampling voices at unit weight and letting the fold apply amp).
//
// `volumetric` selects a genuinely separate 3D branch rather than z=0 through
// one formula: `diagonal` and `noise` are NOT the same function at z=0 as in
// 2D (see VOLUMETRIC.md's "Primitives in 3D" table) — changing that would
// silently alter every existing 2D diagonal/noise patch.
export function sampleFieldVoice(
  voice: FieldVoice,
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  time: number,
  volumetric: boolean,
): number {
  let sx = x;
  let sy = y;
  if (voice.angle !== 0) {
    // Rotate the SAMPLE about this voice's own centre rather than rotating
    // the field: radial/spiral then stay anchored where they were, and a
    // linear field becomes a plane wave at `angle`. Z is untouched — angle
    // is always a rotation about Z, in both the 2D and volumetric branches.
    const a = (-voice.angle * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    sx = cx + dx * ca - dy * sa;
    sy = cy + dx * sa + dy * ca;
  }

  if (voice.field === "noise") {
    const n = volumetric
      ? synthNoise4(sx * voice.freq, sy * voice.freq, z * voice.freq, time * voice.speed)
      : synthNoise3(sx * voice.freq, sy * voice.freq, time * voice.speed);
    // Noise bypasses synthWave entirely (it has no "wave argument"), so
    // `phase`/`duty` — both defined in terms of that argument — don't apply.
    return 2 * n - 1;
  }

  if (voice.field === "gyroid" || voice.field === "menger" || voice.field === "sierpinski") {
    // SDF voice family (VOLUMETRIC-2.md §2), a dedicated branch like noise's
    // above — and, unlike every 2D/3D-split branch below, the SAME formula
    // in both domains: a 2D call already arrives here with `z = 0, cz = 0`
    // (see `computeFieldSynthPoint`'s non-volumetric branch in stock.ts),
    // which is exactly the documented "2D domain: evaluated at z=0 (a
    // slice)" contract — no
    // separate 2D reading to invent, the way `diagonal`/`noise` need one.
    //
    // Translation: the voice origin is read as a PRE-EVALUATION TRANSLATION
    // of the domain point — deliberately the OPPOSITE of every linear field
    // above, which ignores `cx`/`cy`/`cz` entirely. An SDF has no field-
    // driven anchor the way radial's distance-from-center has, so without
    // translating the sample itself the voice could never be aligned to its
    // host mesh (or to another SDF voice); `phase` below is an ISO-LEVEL
    // offset, not a substitute for this.
    const qx = sx - cx;
    const qy = sy - cy;
    const qz = z - cz;
    // `freq` is the lattice scale, applied ONCE here to the translated
    // sample — NOT a second time on the wave argument below, unlike every
    // other field's `raw * voice.freq` line. Reapplying it there would
    // double the frequency (shells at freq^2 density instead of freq): the
    // shipped projection `t = raw * freq - time*speed + phase` must NOT be
    // reused for this branch, which is why this returns through its own
    // `synthWave` call below instead of falling into the shared one at the
    // bottom of the function.
    const fx = qx * voice.freq, fy = qy * voice.freq, fz = qz * voice.freq;
    let sdfRaw: number;
    if (voice.field === "gyroid") {
      // 2π-normalized so `freq` means cycles-per-domain-unit like every
      // other voice (and so the effective finest frequency `freq*2` is
      // actually true). Used directly as `raw` — no `-sdf` negation — its
      // sign is "positive = one labyrinth half", not an inside/outside
      // solid convention the way menger/sierpinski's is.
      const tp = Math.PI * 2;
      sdfRaw = Math.sin(tp * fx) * Math.cos(tp * fy) + Math.sin(tp * fy) * Math.cos(tp * fz) + Math.sin(tp * fz) * Math.cos(tp * fx);
    } else {
      const iter = clampSdfIter(voice.iter);
      const sdf = voice.field === "menger" ? mengerFractalSdf(fx, fy, fz, iter) : sierpinskiFractalSdf(fx, fy, fz, iter);
      sdfRaw = -sdf; // positive inside the solid
    }
    return synthWave(voice.wave, sdfRaw - time * voice.speed + voice.phase, voice.duty);
  }

  let raw: number;
  if (volumetric) {
    switch (voice.field) {
      case "linearX": raw = sx; break;
      case "linearY": raw = sy; break;
      case "linearZ": raw = z; break;
      case "diagonal": raw = (sx + sy + z) * INV_SQRT3; break;
      // atan2/(2π) jumps by 1 crossing the -x ray — see the 2D branch's
      // identical note. angular/spiral stay XY-plane-only (documented scope).
      case "angular": raw = Math.atan2(sy - cy, sx - cx) / (Math.PI * 2); break;
      case "spiral": raw = Math.hypot(sx - cx, sy - cy) + Math.atan2(sy - cy, sx - cx) / (Math.PI * 2); break;
      default: raw = Math.hypot(sx - cx, sy - cy, z - cz); // radial: spherical distance
    }
  } else {
    switch (voice.field) {
      case "linearX": raw = sx; break;
      case "linearY": raw = sy; break;
      case "diagonal": raw = (sx + sy) * 0.70710678; break;
      case "angular": raw = Math.atan2(sy - cy, sx - cx) / (Math.PI * 2); break;
      case "spiral": raw = Math.hypot(sx - cx, sy - cy) + Math.atan2(sy - cy, sx - cx) / (Math.PI * 2); break;
      // "linearZ" has no 2D meaning (no z axis to project onto) — falls
      // through to the same default (radial) an unrecognized field name
      // already gets, rather than inventing a bespoke 2D reading of it.
      default: raw = Math.hypot(sx - cx, sy - cy); // radial
    }
  }
  return synthWave(voice.wave, raw * voice.freq - time * voice.speed + voice.phase, voice.duty);
}

/**
 * The finest ACTIVE oscillation frequency a single voice contributes, in
 * domain units — the per-voice generalization the shared carve/xray step
 * floor (`fieldStepCount`'s `finestFreq` parameter, below) consumes
 * (VOLUMETRIC-2.md §2). A menger/sierpinski voice's finest FEATURE is `iter`
 * recursion levels deep, each level tripling (menger) or doubling
 * (sierpinski) the box density relative to `freq`'s own lattice scale; a
 * gyroid voice's implicit completes 2 periods per `freq` cycle (its sign
 * pattern repeats twice as fast as a single `sin`/`cos` term would); every
 * other field stays exactly `freq`, unchanged.
 */
export function effectiveVoiceFinestFreq(voice: FieldVoice): number {
  switch (voice.field) {
    case "menger": return voice.freq * 3 ** clampSdfIter(voice.iter);
    case "sierpinski": return voice.freq * 2 ** clampSdfIter(voice.iter);
    case "gyroid": return voice.freq * 2;
    default: return voice.freq;
  }
}

function foldVoices(
  voices: readonly FieldVoice[],
  combine: string,
  x: number, y: number, z: number,
  originX: number, originY: number, originZ: number,
  time: number,
  volumetric: boolean,
): { combined: number; winner: number; active: number } {
  let combined = 0;
  let active = 0;
  let best = -Infinity;
  let winner = -1;
  let winnerOrder = -1;
  const argmax = combine === "argmax";
  for (let k = 0; k < voices.length; k++) {
    const voice = voices[k]!;
    if (!(voice.amp > 0)) continue;
    const cx = originX + voice.origin.u;
    const cy = originY + voice.origin.v;
    const cz = originZ + voice.origin.w;
    const o = sampleFieldVoice(voice, x, y, z, cx, cy, cz, time, volumetric);
    if (argmax) {
      const contribution = voice.amp * o;
      // `winner` is reported in FLAT source order (see `FieldVoice.sourceIndex`'s
      // doc) so a caller indexing a flat per-voice table by it always lands on
      // the voice that actually won, regardless of which layer it folded into.
      // `winnerOrder` stays layer-local — it only spaces the level output evenly
      // across THIS layer's active voices, which has nothing to do with the
      // voice's original identity.
      if (contribution > best) { best = contribution; winner = voice.sourceIndex ?? k; winnerOrder = active; }
    } else if (active === 0) {
      combined = voice.amp * o;
    } else {
      combined += voice.amp * (combineSynth(combine, combined, o) - combined);
    }
    active++;
  }
  if (argmax) {
    // Evenly spaced flat levels across the range, one per ACTIVE voice, so
    // the ramp (or ink) reads each region as a single constant tone.
    combined = active > 1 ? (2 * winnerOrder + 1) / active - 1 : 0;
  }
  return { combined, winner, active };
}

// Exported for the same reason as `synthWave` above — reuse the exact
// per-voice/per-layer mix-weight fold instead of re-deriving it. Also the
// layer-blend fold (Step 3): layers have no "argmax" blend value, so this is
// never asked to resolve one at the layer level.
export function combineSynth(mode: string, a: number, b: number): number {
  switch (mode) {
    // Pairwise, argmax can only report the winning VALUE; the winning
    // identity is resolved by `foldVoices`, which sees the whole voice list
    // at once.
    case "argmax": return Math.max(a, b);
    case "add": return a + b;
    case "max": return Math.max(a, b);
    case "min": return Math.min(a, b);
    case "difference": return Math.abs(a - b);
    default: return a * b; // multiply
  }
}

/**
 * Evaluate a whole field program (every layer, every voice) at one point.
 *
 * `(x, y, z)` is the domain coordinate every voice samples (raw, unshifted —
 * linear fields ignore origin entirely, matching field-synth's documented
 * behavior). `(originX, originY, originZ)` is the call-level pattern centre
 * that combines with each voice's own relative `origin` offset — field-synth
 * resolves this per call (a fixed point for `space: "scene"`/`"auto"`) or per
 * coplanar surface group (`space: "surface"`), which is why it is a runtime
 * argument here rather than baked into the compiled program: the program
 * itself is compiled once from flat params per `evaluate()` call, while the
 * origin can vary across a call when a mesh has multiple visible faces.
 * Defaults to the domain origin (0, 0, 0) for callers with no such concept
 * (a bounding-volume march, a future field-authoritative primitive).
 *
 * `program.domain` selects the 3D branch (see `sampleFieldVoice`) — it is a
 * program-level property, not a per-call argument (see `FieldProgram`'s doc).
 *
 * Layers fold in array order with `layer.amp` as the mix weight, mirroring
 * the voice fold one level up (VOLUMETRIC.md's Step 3): the first populated
 * layer enters at its own weight, each later one blends the stack toward
 * `layer.blend(stack, shapedLayerValue)` by that weight. A layer with no
 * active voices is skipped, exactly like an amp-0 voice. Per-layer
 * threshold/invert apply to that layer's folded value before it enters the
 * stack. A single-layer program (field-synth's Phase 2 compile output, and
 * every pre-layers patch under the structural-compatibility rule) reduces
 * exactly to `foldVoices`'s own result — this is what keeps every existing
 * field-synth preset byte-identical.
 */
export function evaluateFieldProgram(
  program: FieldProgram,
  x: number, y: number, z: number,
  time: number,
  originX = 0, originY = 0, originZ = 0,
): FieldEvalResult {
  const volumetric = program.domain === "3d";
  let stackValue = 0;
  let stackActive = 0;
  let populatedLayers = 0;
  let singleLayerWinner = -1;
  let appliedLayers = 0;

  const layers = program.layers;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]!;
    const result = foldVoices(layer.voices, layer.combine, x, y, z, originX, originY, originZ, time, volumetric);
    if (result.active === 0) continue; // skip empty layers, like an amp-0 voice
    populatedLayers++;
    singleLayerWinner = populatedLayers === 1 ? result.winner : -1;
    stackActive += result.active;

    let v = result.combined;
    if (layer.thresholdOn) v = v > layer.threshold ? 1 : -1;
    if (layer.invert) v = -v;

    if (appliedLayers === 0) {
      stackValue = layer.amp * v;
    } else {
      stackValue += layer.amp * (combineSynth(layer.blend, stackValue, v) - stackValue);
    }
    appliedLayers++;
  }

  return {
    combined: stackValue,
    winner: populatedLayers === 1 ? singleLayerWinner : -1,
    active: stackActive,
  };
}

// ---- sampler-agnostic marcher -------------------------------------------

export type FieldSampler = (x: number, y: number, z: number, time: number) => number;

export interface FieldMarchOptions {
  /** Minimum step count (default 48, per VOLUMETRIC.md's Carve section). */
  readonly steps?: number;
  /** Hard cap on step count regardless of the Nyquist floor (default 256). */
  readonly maxSteps?: number;
  /**
   * The highest active oscillator frequency along the marched field, in
   * domain units. When set, raises the step count to
   * `ceil(2 * chordLength * finestFreq)` — the sampling floor below which a
   * thin solid wall is skipped and renders as a false hole. `steps` is a
   * MINIMUM; this can only raise the count, never lower it below `steps`.
   */
  readonly finestFreq?: number;
  readonly time?: number;
}

/**
 * The step-count floor shared by `marchField` and `integrateField`
 * (VOLUMETRIC-2.md §1 "The integrator"): `max(minSteps, min(cap,
 * ceil(2*chordLength*finestFreq)))`. Carve and xray march/integrate the same
 * field over the same chord at the same resolution — if each derived its own
 * step count they could silently disagree about how finely a thin feature is
 * resolved.
 */
export function fieldStepCount(chordLength: number, opts: FieldMarchOptions = {}): number {
  const maxStepsCap = Math.max(1, Math.round(opts.maxSteps ?? 256));
  const minSteps = Math.max(1, Math.min(maxStepsCap, Math.round(opts.steps ?? 48)));
  const finestFreq = opts.finestFreq ?? 0;
  const nyquistSteps = finestFreq > 0 ? Math.ceil(2 * chordLength * finestFreq) : 0;
  return Math.max(minSteps, Math.min(maxStepsCap, nyquistSteps));
}

export interface FieldMarchHit {
  readonly hit: true;
  /** Parameter along entry->exit, 0 at entry, 1 at exit. */
  readonly t: number;
  /** Distance from entry, in the same units as entry/exit. */
  readonly distance: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * The raw, un-interpolated grid sample CONFIRMED solid (`sampler(...) > 0`)
   * — the point that actually triggered this hit, before the secant
   * refinement above. `t`/`x`/`y`/`z` are exact for an affine field but can
   * land on a sampler's plateau boundary for a hard-thresholded one (see the
   * comment on the secant root above); `sampleT`/`sampleX`/`sampleY`/
   * `sampleZ` are always guaranteed to resample `> 0`, for a caller (e.g.
   * carve) that needs solid ground to re-evaluate at rather than maximum
   * positional precision. Equal to `t`/`x`/`y`/`z` for the entry-already-
   * solid short-circuit (distance 0, no stepping occurred).
   */
  readonly sampleT: number;
  readonly sampleX: number;
  readonly sampleY: number;
  readonly sampleZ: number;
  /**
   * `sampleT * chordLength` — the raw confirmed-solid sample's own absolute
   * distance from entry, in the same units as `distance`. Generally
   * DIFFERENT from `distance`: the secant refinement can place the
   * interpolated hit (`t`/`distance`) short of the raw sample it was
   * bracketed by (e.g. a hard threshold sampled exactly `0` one step before
   * a `1`, which collapses the secant root to the earlier, non-solid
   * sample's position). Exposed directly so a caller that emits at
   * `sampleX/Y/Z` (e.g. carve, to sidestep a hard-thresholded sampler's
   * plateau — see the comment above) has a matching distance to drive
   * positional falloff from; pairing that emission point with `distance`
   * instead fades the point as if it sat somewhere else along the chord
   * than where it was actually emitted.
   */
  readonly sampleDistance: number;
}

export interface FieldMarchMiss {
  readonly hit: false;
}

export type FieldMarchResult = FieldMarchHit | FieldMarchMiss;

/**
 * March a scalar field along the segment `entry -> exit`, sampling `sampler`
 * at up to `steps` points and reporting the first point where the sampled
 * value crosses from <=0 to >0 ("solid"). `sampler` is any
 * `(x, y, z, t) => number` — this function knows nothing about voices,
 * layers, or field-synth; the carve path (VOLUMETRIC.md's Carve mode) calls
 * it with `evaluateFieldProgram`'s compiled-program result run through the
 * ramp's `clamp01(bias + gain*v*0.5)` mapping, but any field-valued function
 * plugs in — including a future bounding-volume segment against a
 * field-authoritative primitive (see VOLUMETRIC.md's Spectral track table).
 *
 * A degenerate segment (`entry === exit`, e.g. a grazing silhouette where a
 * volumetric ray's endpoints coincide) always misses — there is no chord to
 * march. The hit position is refined by linearly interpolating between the
 * last non-solid sample and the first solid one (exact when the field is
 * affine in `t` along the ray, e.g. a planar boundary), rather than snapping
 * to the step grid.
 *
 * **Non-finite (`NaN`/`Infinity`) samples never contribute positional
 * evidence.** A hit requires the CURRENT sample to be finite and solid; a
 * non-finite sample is never treated as "not solid at this grid position"
 * for interpolation purposes — it invalidates the crossing bracket instead.
 * Concretely: a sample immediately preceded by a non-finite sample is
 * reported unbracketed — hit at that raw, confirmed-solid sample position
 * (`t === sampleT`, no interpolation) rather than secant-interpolated
 * against the non-finite neighbor. The sample itself being finite and solid
 * is real evidence of matter; what would be wrong is deriving a POSITION
 * from a non-finite bracket. If no finite solid sample exists anywhere
 * along the chord, the march misses, same as an ordinary never-crosses
 * field.
 */
export function marchField(
  entry: readonly [number, number, number],
  exit: readonly [number, number, number],
  sampler: FieldSampler,
  opts: FieldMarchOptions = {},
): FieldMarchResult {
  const [ex, ey, ez] = entry;
  const [xx, xy, xz] = exit;
  const dx = xx - ex, dy = xy - ey, dz = xz - ez;
  const chordLength = Math.hypot(dx, dy, dz);
  if (!(chordLength > 0) || !Number.isFinite(chordLength)) return { hit: false };

  const time = opts.time ?? 0;
  const steps = fieldStepCount(chordLength, opts);

  let prevT = 0;
  let prevValue = sampler(ex, ey, ez, time);
  let prevFinite = Number.isFinite(prevValue);
  if (prevFinite && prevValue > 0) {
    return { hit: true, t: 0, distance: 0, x: ex, y: ey, z: ez, sampleT: 0, sampleX: ex, sampleY: ey, sampleZ: ez, sampleDistance: 0 };
  }

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ex + dx * t;
    const y = ey + dy * t;
    const z = ez + dz * t;
    const value = sampler(x, y, z, time);
    const finite = Number.isFinite(value);
    if (finite && value > 0) {
      // Bracketed secant interpolation only fires when the IMMEDIATELY
      // preceding sample was itself finite — a non-finite neighbor carries
      // no evidence about where the field actually crossed zero, so `denom`
      // can never be non-finite here (both operands are finite by
      // construction) and the old `Number.isFinite(denom)` guard is no
      // longer needed. When the previous sample was non-finite, the bracket
      // is invalid outright: report the hit at the raw sample position
      // (`t`, unbracketed, no interpolation) instead of silently snapping
      // to `prevT` (the position of a sample that was never confirmed
      // non-solid — it was simply unmeasurable).
      let hitT: number;
      if (prevFinite) {
        const denom = value - prevValue;
        const localT = denom !== 0 ? -prevValue / denom : 0;
        hitT = prevT + localT * (t - prevT);
      } else {
        hitT = t;
      }
      return {
        hit: true,
        t: hitT,
        distance: hitT * chordLength,
        x: ex + dx * hitT,
        y: ey + dy * hitT,
        z: ez + dz * hitT,
        sampleT: t,
        sampleX: x,
        sampleY: y,
        sampleZ: z,
        sampleDistance: t * chordLength,
      };
    }
    prevFinite = finite;
    prevT = t;
    prevValue = value;
  }
  return { hit: false };
}

export interface FieldIntegrateResult {
  /** `Σ sampler(p(t_i)) * Δt`, in the same units as `entry`/`exit`. */
  readonly sum: number;
  /** The step count `glyphFieldStepCount` resolved for this chord (or an explicit `opts.steps`/`opts.maxSteps` override, see that helper). */
  readonly steps: number;
  readonly chordLength: number;
}

/**
 * Integrate a scalar field along the segment `entry -> exit` (VOLUMETRIC-2.md
 * §1 "The integrator") — `marchField`'s sibling: it returns a first hit and
 * cannot express an accumulated quantity like xray's transmittance integral.
 * Sampler-agnostic, exactly like `marchField`.
 *
 * Quadrature is midpoint, not endpoint: `steps` samples are taken at
 * `t_i = (i + 1/2)/steps * chordLength` for `i` in `[0, steps)`, each
 * weighted by `Δt = chordLength / steps`. This never double-counts a shared
 * endpoint between adjacent segments the way a naive trapezoidal/endpoint
 * rule would. A non-finite sample contributes 0 to the sum, same rule
 * `marchField` uses for a non-finite grid sample — it is a measurement
 * failure at that point, not evidence of an empty (zero-valued) field there.
 *
 * A degenerate segment (`entry === exit`, non-finite, or otherwise
 * zero-length) has no chord to integrate over: returns `{ sum: 0, steps: 0,
 * chordLength }` rather than throwing or fabricating a nonzero sum.
 */
export function integrateField(
  entry: readonly [number, number, number],
  exit: readonly [number, number, number],
  sampler: FieldSampler,
  opts: FieldMarchOptions = {},
): FieldIntegrateResult {
  const [ex, ey, ez] = entry;
  const [xx, xy, xz] = exit;
  const dx = xx - ex, dy = xy - ey, dz = xz - ez;
  const chordLength = Math.hypot(dx, dy, dz);
  if (!(chordLength > 0) || !Number.isFinite(chordLength)) {
    return { sum: 0, steps: 0, chordLength: Number.isFinite(chordLength) ? chordLength : 0 };
  }

  const time = opts.time ?? 0;
  const steps = fieldStepCount(chordLength, opts);
  const dt = chordLength / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const value = sampler(ex + dx * t, ey + dy * t, ez + dz * t, time);
    if (Number.isFinite(value)) sum += value * dt;
  }
  return { sum, steps, chordLength };
}
