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
 *
 * This purity is why `normalX`/`normalY`/`normalZ`/`incidence`
 * (VOLUMETRIC-4.md §1's "Normal-derived field sources") are NOT switched on
 * anywhere in this file: a face normal is one value per CELL, supplied by
 * glyphcss's rasterizer, not something this module's `(x, y, z)` domain
 * point could ever derive. `stock.ts` resolves them per cell and substitutes
 * the result through `sampleFieldVoice`'s/`evaluateFieldProgram`'s optional
 * `rawOverride` parameter below — a generic per-voice raw-value seam this
 * module exposes without knowing (or caring) why a caller might use it.
 * Reaching this module's own field dispatch with one of those four names
 * uncovered by an override — e.g. a hand-built geometry `FieldProgram` that
 * bypasses `stock.ts`'s flat-params `validateParams` reject — silently falls
 * through to the same "unrecognized field" default (radial) any other
 * unknown name gets; a documented, narrow gap (VOLUMETRIC-4.md §1: "geometry-
 * stack normal fields are a recorded extension point").
 */

// ---- basis-kind enums (append-only; the /synth URL codec encodes these by
// index, so a new value is always appended, never inserted) ----------------

export const SYNTH_FIELDS = [
  "radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise", "linearZ", "gyroid", "menger", "sierpinski",
  // VOLUMETRIC-4.md §1: normal-derived field sources — legal ONLY in a colour
  // voice stack (`stock.ts`'s `validateFieldSynthGeometryNormalFields`
  // rejects them on any active GEOMETRY voice). Appended strictly after
  // `sierpinski` — the /synth URL codec addresses `SYNTH_FIELDS` by index.
  "normalX", "normalY", "normalZ", "incidence",
] as const;
export const SYNTH_WAVES = ["sin", "triangle", "saw", "square", "step"] as const;
export const SYNTH_COMBINES = ["add", "multiply", "max", "min", "difference", "argmax"] as const;

// The normal-derived subset of `SYNTH_FIELDS` (VOLUMETRIC-4.md §1) — the
// single source of truth both `effectiveVoiceFinestFreq` below (they carry no
// spatial frequency) and `stock.ts` (the geometry-stack reject, and the
// per-cell substitution wrapper's own "is this one of the four" test) key
// off, so the four names are never independently re-listed and can't drift.
export const NORMAL_DERIVED_FIELDS: ReadonlySet<string> = new Set(["normalX", "normalY", "normalZ", "incidence"]);

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
// `Math.sqrt(ax*ax + ay*ay + az*az)` instead of `Math.hypot(ax, ay, az)` —
// measured 3.47x on `mengerFractalSdf` iter 3 (498.0ms -> 143.6ms per 300k
// calls) and 3.08x on sierpinski (bench/color-tolerance.md's micro-win table),
// max relative error 4.3e-16, seven orders inside this file's 9-decimal
// distance-fidelity tests. `ax`/`ay`/`az` are already `Math.max(_, 0)`'d
// above, so they're always finite and non-negative in this call's actual
// domain (bounded fractal-cell coordinates) — `Math.hypot`'s extra
// overflow/underflow-safe scaling buys nothing here that it doesn't already
// cost in the per-call function-dispatch overhead.
function sdfBox(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
  const dx = Math.abs(px) - bx, dy = Math.abs(py) - by, dz = Math.abs(pz) - bz;
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0), az = Math.max(dz, 0);
  return Math.sqrt(ax * ax + ay * ay + az * az) + Math.min(Math.max(dx, Math.max(dy, dz)), 0);
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

// Reused per-recursion-depth scratch buffers for `fractalUnionSdf`'s per-node
// bound/insertion-sort arrays. Profiled directly (perf packet: "why is the
// Menger SDF preset slow"): a single sphere-traced carve cell calls
// `fractalUnionSdf` a handful of times per march step (mean ~4 node visits
// per oracle call, iter 3), and a preset's `evaluate()` can run tens of
// thousands of oracle calls across a covered grid — every non-leaf visit was
// allocating two fresh `Array`s (`bounds`/`order`, up to 20 entries each) that
// live for a few dozen lines and are then discarded, pure GC pressure with no
// correctness purpose. Recursion here is synchronous and single-threaded, and
// `depthRemaining` strictly decreases on every non-leaf call, so ONE buffer
// PER DEPTH LEVEL is safe to reuse across every call at that depth: a call
// never re-enters its own depth while a deeper call is in flight, and a
// shallower call's buffer is untouched by anything happening below it.
// `FRACTAL_SCRATCH_CHILDREN` covers the larger of the two shipped offset sets
// (menger: 20; sierpinski: 8) — both are fixed-length module-private consts
// with no public way to substitute a longer one. The depth pool itself grows
// lazily rather than being hard-capped at the schema's 1..4 `iter` range:
// `mengerFractalSdf`/`sierpinskiFractalSdf` take a raw, unclamped `iter` (only
// field-synth's own call sites clamp via `clampSdfIter`), so a hand-built
// caller passing a deeper value still gets a correct (if slower) answer
// instead of a bound overrun.
const FRACTAL_SCRATCH_CHILDREN = 20;
const fractalScratchBoundsPool: Float64Array[] = [];
const fractalScratchOrderPool: Int32Array[] = [];
function fractalScratchAt(depth: number): { bounds: Float64Array; order: Int32Array } {
  while (fractalScratchBoundsPool.length <= depth) {
    fractalScratchBoundsPool.push(new Float64Array(FRACTAL_SCRATCH_CHILDREN));
    fractalScratchOrderPool.push(new Int32Array(FRACTAL_SCRATCH_CHILDREN));
  }
  return { bounds: fractalScratchBoundsPool[depth]!, order: fractalScratchOrderPool[depth]! };
}

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
  const { bounds, order } = fractalScratchAt(depthRemaining);
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
// Rotate the SAMPLE about this voice's own centre rather than rotating the
// field: radial/spiral then stay anchored where they were, and a linear
// field becomes a plane wave at `angle`. Z is untouched — angle is always a
// rotation about Z, in both the 2D and volumetric branches. Factored out of
// `sampleFieldVoice`'s own top-of-function block (below) so
// `sdfVoiceLatticeCoords` — the sphere-tracing oracle's raw-SDF coordinate
// derivation (VOLUMETRIC-3.md §3) — shares the EXACT same rotation
// arithmetic instead of a second, driftable copy of it.
function rotateVoiceSample(x: number, y: number, cx: number, cy: number, angleDeg: number): readonly [number, number] {
  if (angleDeg === 0) return [x, y];
  const a = (-angleDeg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
}

/**
 * A generic per-voice raw-value substitution seam (VOLUMETRIC-4.md §1's "thin
 * substitution wrapper"). Given a voice, return the RAW value (the same
 * quantity `sampleFieldVoice`'s own field-kind switch would otherwise
 * compute, pre-`synthWave` shaping) to use instead of sampling it spatially,
 * or `undefined` to let this module sample the voice itself, unchanged. This
 * module never calls it to decide anything about what a voice's field NAME
 * means — that stays entirely the caller's business (`stock.ts` uses it to
 * splice glyphcss's per-cell object-space normal/incidence buffers into the
 * colour voice stack's evaluation without teaching this module anything about
 * normals) — which is what keeps this file "pure spatial math" per its own
 * header.
 */
export type FieldVoiceRawOverride = (voice: FieldVoice) => number | undefined;

export function sampleFieldVoice(
  voice: FieldVoice,
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  time: number,
  volumetric: boolean,
  rawOverride?: FieldVoiceRawOverride,
): number {
  if (rawOverride) {
    const overridden = rawOverride(voice);
    if (overridden !== undefined) {
      // Same tail every linear/radial-family field falls through to at the
      // bottom of this function — an override supplies only the RAW value,
      // never a bespoke shaping path, so it stays subject to the same
      // freq/speed/phase/duty knobs (and the same `synthWave` wave shapes)
      // every other field kind is.
      return synthWave(voice.wave, overridden * voice.freq - time * voice.speed + voice.phase, voice.duty);
    }
  }

  const [sx, sy] = rotateVoiceSample(x, y, cx, cy, voice.angle);

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
    //
    // FOOTGUN (found while diagnosing an off-center Menger SDF preset):
    // `cx`/`cy` are `originX + voice.origin.u`/`originY + voice.origin.v`
    // (`foldVoices` below), where `originX`/`originY` is the PATCH-LEVEL
    // `originU`/`originV` param (a normalized-UV translation for every
    // OTHER field family, repurposed here as a second raw-unit offset
    // stacked onto the voice's own `originU1`/`originV1`/`originW1`). `cz`
    // has no such patch-level counterpart — the schema has no `originW` — so
    // `cz` is ALWAYS exactly `voice.origin.w` (the per-voice `originW1`
    // alone). A patch that leaves `originU`/`originV` at their nonzero
    // schema default (0.5) while relying on `originU1`/`originV1`/`originW1`
    // for SDF alignment gets a DIFFERENT total X/Y offset than Z — X/Y
    // recentre, Z stays anchored to the per-voice value alone. No SDF preset
    // currently ships (see AGENTS.md's "Sphere tracing for carve"), but any
    // SDF patch should pin `originU: 0, originV: 0` explicitly so all three
    // axes read only their own per-voice origin, symmetrically — a patch
    // that skips that pin will NOT get symmetric translation across axes.
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

// The SDF voice family's own coordinate derivation (rotate -> translate by
// origin -> scale by freq), exposed standalone so `buildGlyphFieldDistanceOracle`
// (VOLUMETRIC-3.md §3) can hand the SAME lattice-space point to
// `mengerFractalSdf`/`sierpinskiFractalSdf` that `sampleFieldVoice`'s own SDF
// branch above evaluates — sharing `rotateVoiceSample` is what keeps the two
// derivations from drifting apart; this only adds the translate+scale on top,
// the same two lines `sampleFieldVoice`'s SDF branch already does inline.
// gyroid is deliberately not special-cased here (it has no genuine distance
// reading — see `buildGlyphFieldDistanceOracle`'s gyroid exclusion), so this
// helper's contract is scoped to the menger/sierpinski callers that actually
// use it.
function sdfVoiceLatticeCoords(
  voice: FieldVoice,
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
): readonly [number, number, number] {
  const [sx, sy] = rotateVoiceSample(x, y, cx, cy, voice.angle);
  const qx = sx - cx, qy = sy - cy, qz = z - cz;
  return [qx * voice.freq, qy * voice.freq, qz * voice.freq];
}

/**
 * The finest ACTIVE oscillation frequency a single voice contributes, in
 * domain units — the per-voice generalization the shared carve/xray step
 * floor (`fieldStepCount`'s `finestFreq` parameter, below) consumes
 * (VOLUMETRIC-2.md §2). A menger/sierpinski voice's finest FEATURE is `iter`
 * recursion levels deep, each level tripling (menger) or doubling
 * (sierpinski) the box density relative to `freq`'s own lattice scale; a
 * gyroid voice's implicit completes 2 periods per `freq` cycle (its sign
 * pattern repeats twice as fast as a single `sin`/`cos` term would).
 *
 * Every other field routes through `synthWave`'s periodic reduction
 * (VOLUMETRIC-3.md §4): a `square` wave's narrowest band is its LOW half
 * when `duty < 0.5` (or its high half when `duty > 0.5`), which is
 * `min(duty, 1-duty)` of a full `1/freq` cycle — resolving it needs two
 * samples per that narrower band, i.e. `freq / min(duty, 1-duty)`, not the
 * bare `freq` a duty-agnostic reading would assume. This is NOT an identity
 * at duty 1/2: even there, where the two halves are equal, it still reads
 * `freq / 0.5 = 2*freq` — DOUBLE the old duty-agnostic `freq` reading, which
 * in turn doubles `fieldStepCount`'s `2*freq*chord` Nyquist term to
 * `4*freq*chord` — a genuine one-to-two-samples-per-band convention change,
 * not a no-op (AGENTS.md's "Authoring tier" section states this correctly;
 * this comment previously claimed a false identity here). `step` is
 * non-periodic — there is no "band" to resolve, `synthWave` never even reads
 * `duty` for it (see its own doc) — so it stays exactly `freq`, unaffected.
 * `sin`/`triangle`/`saw` stay `freq` too: none of the three has a
 * `duty`-shaped narrow feature the way a square wave's asymmetric split
 * does.
 */
export function effectiveVoiceFinestFreq(voice: FieldVoice): number {
  switch (voice.field) {
    case "menger": return voice.freq * 3 ** clampSdfIter(voice.iter);
    case "sierpinski": return voice.freq * 2 ** clampSdfIter(voice.iter);
    case "gyroid": return voice.freq * 2;
    // Normal-derived field sources (VOLUMETRIC-4.md §1): one value per CELL,
    // not a function of the domain point — there is no spatial frequency to
    // resolve. Reporting anything nonzero here would inflate carve/xray's
    // Nyquist step count (up to the 256-step cap) for a voice that never
    // varies spatially at all.
    case "normalX":
    case "normalY":
    case "normalZ":
    case "incidence":
      return 0;
    default:
      if (voice.wave === "square") {
        const duty = Math.min(Math.max(voice.duty, 0), 1);
        const narrowBand = Math.min(duty, 1 - duty);
        return narrowBand > 0 ? voice.freq / narrowBand : Infinity;
      }
      return voice.freq;
  }
}

function foldVoices(
  voices: readonly FieldVoice[],
  combine: string,
  x: number, y: number, z: number,
  originX: number, originY: number, originZ: number,
  time: number,
  volumetric: boolean,
  rawOverride?: FieldVoiceRawOverride,
): { combined: number; winner: number; active: number } {
  let combined = 0;
  let active = 0;
  let best = -Infinity;
  let winner = -1;
  let winnerOrder = -1;
  const argmax = combine === "argmax";
  // `min`/`max` short-circuit (measured perf.md finding): every voice sample
  // is proven within ~[-1, 1] regardless of field/wave/override kind (see
  // `sampleFieldVoice`'s own doc, "One voice -> value in ~[-1, 1]") — the
  // `noise` early return (`2*n-1`, n in [0,1)) and the SDF branch (routes
  // through `synthWave` just like every linear/radial field) both hold the
  // bound too. So for a `min` fold, once `combined <= -1` (the bound `o` can
  // never go BELOW), `combineSynth("min", combined, o) === combined` exactly
  // for every remaining voice — `Math.min` returns the smaller operand
  // UNCHANGED, not a recomputed value — so the mix-weight delta
  // `amp * (combine(combined, o) - combined)` is exactly `amp * 0 = 0` for
  // ANY amp (even amp > 1 from a hand-built program `validateGlyphFieldProgram`
  // doesn't range-check, even amp = 0 is unreachable here since inactive
  // voices already `continue` above). Symmetric for `max` at `combined >= 1`.
  // `<=`/`>=` (not `=== -1`/`=== 1`) is deliberate: it also covers the
  // unclamped-amp edge case where the FIRST voice's own `amp * o` (no prior
  // `combined` to min/max against) overshoots past the bound. Never engages
  // under argmax — categorical, not value-folding (never value-bounded the
  // same way, and `winner` identity has no such fixed point).
  const shortCircuitable = combine === "min" || combine === "max";
  let shortCircuited = false;
  for (let k = 0; k < voices.length; k++) {
    const voice = voices[k]!;
    if (!(voice.amp > 0)) continue;
    if (shortCircuited) { active++; continue; }
    const cx = originX + voice.origin.u;
    const cy = originY + voice.origin.v;
    const cz = originZ + voice.origin.w;
    const o = sampleFieldVoice(voice, x, y, z, cx, cy, cz, time, volumetric, rawOverride);
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
    if (shortCircuitable) {
      shortCircuited = combine === "min" ? combined <= -1 : combined >= 1;
    }
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
 * This is the REFERENCE (interpreted) evaluator: it re-dispatches on every
 * voice's `field`/`wave` and every layer's `combine`/`blend` string on every
 * call. `evaluateFieldProgram` below is the public entry point and prefers a
 * per-program COMPILED closure (see "compiled evaluation form" further down)
 * whenever `rawOverride` is absent; this function remains exported (not via
 * the package's public `index.ts` barrel — same "internal, direct-import"
 * precedent as `sampleFieldVoice` above) so the compiled/interpreted parity
 * test and perf bench can call the untouched reference path directly.
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
 *
 * `rawOverride` (VOLUMETRIC-4.md §1) is threaded straight to `sampleFieldVoice`
 * unchanged — see `FieldVoiceRawOverride`'s own doc. Omitting it (every
 * existing call site) is byte-identical to before this parameter existed.
 */
export function evaluateFieldProgramInterpreted(
  program: FieldProgram,
  x: number, y: number, z: number,
  time: number,
  originX = 0, originY = 0, originZ = 0,
  rawOverride?: FieldVoiceRawOverride,
): FieldEvalResult {
  const volumetric = program.domain === "3d";
  let stackValue = 0;
  let stackActive = 0;
  let populatedLayers = 0;
  let singleLayerWinner = -1;
  let appliedLayers = 0;
  // Cross-layer sibling of `foldVoices`'s own min/max short-circuit (see its
  // doc) — the fold this module's own perf note measured savings on: the
  // shipped multi-layer recipes (e.g. the Menger/Sierpinski membership
  // recipes) fold their PER-VOICE layers with `combine: "add"` (unbounded,
  // no fixed point) but always set `thresholdOn: true`, and it's THAT layer
  // output — always exactly +-1, unconditionally, regardless of the
  // underlying combine/amp/voice count — that the CROSS-layer `blend: "min"`
  // fold across layers exploits. `-1`/`0`/`1` = locked-low / not locked /
  // locked-high, recomputed from the real `stackValue` after every APPLIED
  // layer (never assumed).
  let stackLocked = 0;

  const layers = program.layers;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]!;

    // Skip this layer's entire per-voice fold (the expensive part — every
    // voice's `sampleFieldVoice`) when the stack is already locked at the
    // exact bound THIS layer's blend can only move it toward, never past:
    // `layer.thresholdOn` guarantees its shaped output would be exactly +-1
    // NO MATTER what `foldVoices` would have returned (any combine, any amp,
    // even an unclamped hand-built-program amp > 1) — see `thresholdOn`'s
    // own unconditional `v > threshold ? 1 : -1` clamp below. A layer
    // without `thresholdOn` has no such unconditional bound (a plain `add`
    // fold, or an amp > 1 voice, can exceed +-1) and is therefore NEVER
    // skipped here, even if its own `combine` happens to be `min`/`max` —
    // deliberately conservative, needs no amp-range assumption to be exact.
    if (
      stackLocked !== 0 && layer.thresholdOn
      && ((stackLocked === -1 && layer.blend === "min") || (stackLocked === 1 && layer.blend === "max"))
    ) {
      let active = 0;
      for (const v of layer.voices) if (v.amp > 0) active++;
      if (active > 0) {
        populatedLayers++;
        stackActive += active;
        appliedLayers++;
        // stackValue is provably unchanged — `singleLayerWinner`/`stackLocked`
        // stay exactly as they are (this layer's own winner is moot: reaching
        // this branch requires a PRIOR applied layer, so `populatedLayers` is
        // already > 1 and the final `winner` below is forced to -1 regardless).
      }
      continue;
    }

    const result = foldVoices(layer.voices, layer.combine, x, y, z, originX, originY, originZ, time, volumetric, rawOverride);
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
    stackLocked = stackValue <= -1 ? -1 : stackValue >= 1 ? 1 : 0;
  }

  return {
    combined: stackValue,
    winner: populatedLayers === 1 ? singleLayerWinner : -1,
    active: stackActive,
  };
}

// ---- compiled evaluation form (perf) ------------------------------------
//
// A `FieldProgram` is FIXED between params changes: stock.ts's own per-cell
// paint loop, staticExport.ts's per-cell bake loop, and field-synth's
// subcell/ink probes all call `evaluateFieldProgram` thousands of times
// against the SAME program object within one `evaluate()` call (that object
// is rebuilt once per params transaction — or once per `evaluate()` call on
// the flat-params path, see stock.ts's own "compile once per evaluate()
// call" comment — never once per cell). `evaluateFieldProgramInterpreted`
// above nonetheless re-dispatches on every voice's `field`/`wave` string and
// every layer's `combine`/`blend` string, and re-reads every voice/layer
// property off its object, on EVERY sample — pure redundant interpretation
// of data that cannot change until a different program object arrives.
//
// `compileFieldProgram` resolves all of that dispatch ONCE per distinct
// program object into a tree of specialized closures, leaving only the
// genuinely per-sample arithmetic (plus the runtime-only min/max
// short-circuit and cross-layer lock state, both unavoidably
// data-dependent) in the hot loop. Every expression below is a verbatim
// transcription of the matching expression in `sampleFieldVoice`/
// `foldVoices`/`evaluateFieldProgramInterpreted` — same operand order, same
// operator associativity — precisely so the two paths are required to agree
// bit-for-bit (`===`), not just approximately; `fieldProgram.compiled-
// parity.test.ts` checks this over a randomized sweep across every
// field/wave/combine/blend kind, `thresholdOn`/`invert` on and off, both
// domains, and nonzero angle/origin/speed/phase/duty.
//
// `rawOverride` (VOLUMETRIC-4.md §1) is a genuinely PER-SAMPLE callback — it
// can substitute a different raw value for any voice on any call, so
// nothing about a voice's contribution is fixed at compile time when one is
// supplied. `evaluateFieldProgram` below detects it and calls the
// interpreted evaluator directly rather than trying to compile a variant
// that still calls out per sample — correctness over speed on that path,
// which is stock.ts's colour voice stack (the only current caller), not the
// geometry stack's hot loop this optimization targets.
//
// Cached by program OBJECT IDENTITY in a `WeakMap`: every real caller
// creates a fresh `FieldProgram` object per params transaction (or per
// `evaluate()` call) and never mutates one in place afterward (field-synth's
// own compile always returns a new object; program-as-data is documented
// immutable after mount — see AGENTS.md's "Program-as-data" section), so
// identity is a safe and exact invalidation key — no structural-signature
// fallback needed. A `WeakMap` also makes the cache self-bounding: an entry
// can only ever be reachable while its program object still is, so it can
// never outlive the scene/preview that created it (relevant with e.g. the
// `/synth` page's ~30 concurrent preview scenes) — nothing here is a
// module-global cache that grows without bound.

/** `(x, y, z, cx, cy, cz, time) => value in ~[-1, 1]` — a single voice's
 *  field/wave dispatch fully resolved at compile time; `cx`/`cy`/`cz` stay
 *  parameters because they depend on the call-level origin, which varies
 *  per `evaluateFieldProgram` call (see that function's own doc). */
type CompiledVoiceSampler = (
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  time: number,
) => number;

/** Mirrors `synthWave` exactly (same branches, same operand order) but
 *  resolved to one fixed closure per (wave kind, duty) pair at compile
 *  time instead of re-switching on `kind` every sample. Kept as a direct
 *  transcription rather than a call to the public `synthWave` so this
 *  compiles the wave dispatch away too, not just the field dispatch — the
 *  A/B parity test is what keeps the two from silently drifting apart. */
function compileWave(kind: string, duty: number): (t: number) => number {
  if (kind === "step") return (t) => (t >= 0 ? 1 : -1);
  switch (kind) {
    case "triangle": return (t) => { const p = t - Math.floor(t); return 4 * Math.abs(p - 0.5) - 1; };
    case "saw": return (t) => { const p = t - Math.floor(t); return 2 * p - 1; };
    case "square": return (t) => { const p = t - Math.floor(t); return p < duty ? 1 : -1; };
    default: return (t) => Math.sin(t * Math.PI * 2); // sin
  }
}

/** Mirrors `rotateVoiceSample` exactly, but `ca`/`sa` are computed ONCE at
 *  compile time (the rotation angle is fixed per voice) instead of every
 *  sample — a pure function of a compile-time constant, so precomputing
 *  changes nothing about the result, only when it's computed. `angle === 0`
 *  keeps the exact same zero-cost identity path the interpreted version
 *  takes (no trig at all, not even a multiply). */
// Perf: `compileRotate` used to return a fresh `[sx, sy]` array literal on
// EVERY sample — same tuple-allocation cost `rotateVoiceSample` already
// pays, so it cost nothing extra over the interpreted path, but it also
// wasn't buying anything: a compiled closure can do better. Every voice
// sampler below calls its voice's `rotate` and immediately reads these two
// scratch slots before doing anything else (no other compiled closure runs
// in between — evaluation is synchronous, single-threaded, and each read
// follows its own write on the very next line), so writing into shared
// module-level scratch instead of allocating a tuple is safe and removes a
// GC allocation from the hottest line in the whole evaluator — the same
// "reused scratch, synchronous single-threaded discipline" `fractalScratchAt`
// above already relies on.
let compiledRotateSx = 0;
let compiledRotateSy = 0;

function compileRotate(angleDeg: number): (x: number, y: number, cx: number, cy: number) => void {
  if (angleDeg === 0) {
    return (x, y) => { compiledRotateSx = x; compiledRotateSy = y; };
  }
  const a = (-angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return (x, y, cx, cy) => {
    const dx = x - cx;
    const dy = y - cy;
    compiledRotateSx = cx + dx * ca - dy * sa;
    compiledRotateSy = cy + dx * sa + dy * ca;
  };
}

/** Compiles one voice's `sampleFieldVoice` branch (minus the `rawOverride`
 *  seam, which the caller has already ruled out — see `evaluateFieldProgram`
 *  below) to a fixed closure. Every branch here is a verbatim transcription
 *  of `sampleFieldVoice`'s own — same operations, same order — so the
 *  result is bit-identical for the same inputs, never just numerically
 *  close. */
function compileVoiceSampler(voice: FieldVoice, volumetric: boolean): CompiledVoiceSampler {
  const { field, wave, freq, speed, phase, duty } = voice;
  const waveFn = compileWave(wave, duty);
  const rotate = compileRotate(voice.angle);

  if (field === "noise") {
    if (volumetric) {
      return (x, y, z, cx, cy, cz, time) => {
        rotate(x, y, cx, cy);
        const sx = compiledRotateSx, sy = compiledRotateSy;
        const n = synthNoise4(sx * freq, sy * freq, z * freq, time * speed);
        return 2 * n - 1;
      };
    }
    return (x, y, z, cx, cy, cz, time) => {
      rotate(x, y, cx, cy);
      const sx = compiledRotateSx, sy = compiledRotateSy;
      const n = synthNoise3(sx * freq, sy * freq, time * speed);
      return 2 * n - 1;
    };
  }

  if (field === "gyroid" || field === "menger" || field === "sierpinski") {
    if (field === "gyroid") {
      return (x, y, z, cx, cy, cz, time) => {
        rotate(x, y, cx, cy);
        const sx = compiledRotateSx, sy = compiledRotateSy;
        const qx = sx - cx, qy = sy - cy, qz = z - cz;
        const fx = qx * freq, fy = qy * freq, fz = qz * freq;
        const tp = Math.PI * 2;
        const sdfRaw = Math.sin(tp * fx) * Math.cos(tp * fy) + Math.sin(tp * fy) * Math.cos(tp * fz) + Math.sin(tp * fz) * Math.cos(tp * fx);
        return waveFn(sdfRaw - time * speed + phase);
      };
    }
    const iter = clampSdfIter(voice.iter);
    const sdfFn = field === "menger" ? mengerFractalSdf : sierpinskiFractalSdf;
    return (x, y, z, cx, cy, cz, time) => {
      rotate(x, y, cx, cy);
      const sx = compiledRotateSx, sy = compiledRotateSy;
      const qx = sx - cx, qy = sy - cy, qz = z - cz;
      const fx = qx * freq, fy = qy * freq, fz = qz * freq;
      const sdfRaw = -sdfFn(fx, fy, fz, iter);
      return waveFn(sdfRaw - time * speed + phase);
    };
  }

  if (volumetric) {
    switch (field) {
      case "linearX":
        return (x, y, z, cx, cy, cz, time) => { rotate(x, y, cx, cy); return waveFn(compiledRotateSx * freq - time * speed + phase); };
      case "linearY":
        return (x, y, z, cx, cy, cz, time) => { rotate(x, y, cx, cy); return waveFn(compiledRotateSy * freq - time * speed + phase); };
      case "linearZ":
        return (x, y, z, cx, cy, cz, time) => waveFn(z * freq - time * speed + phase);
      case "diagonal":
        return (x, y, z, cx, cy, cz, time) => {
          rotate(x, y, cx, cy);
          const raw = (compiledRotateSx + compiledRotateSy + z) * INV_SQRT3;
          return waveFn(raw * freq - time * speed + phase);
        };
      case "angular":
        return (x, y, z, cx, cy, cz, time) => {
          rotate(x, y, cx, cy);
          const raw = Math.atan2(compiledRotateSy - cy, compiledRotateSx - cx) / (Math.PI * 2);
          return waveFn(raw * freq - time * speed + phase);
        };
      case "spiral":
        return (x, y, z, cx, cy, cz, time) => {
          rotate(x, y, cx, cy);
          const sx = compiledRotateSx, sy = compiledRotateSy;
          const raw = Math.hypot(sx - cx, sy - cy) + Math.atan2(sy - cy, sx - cx) / (Math.PI * 2);
          return waveFn(raw * freq - time * speed + phase);
        };
      default:
        return (x, y, z, cx, cy, cz, time) => {
          rotate(x, y, cx, cy);
          const raw = Math.hypot(compiledRotateSx - cx, compiledRotateSy - cy, z - cz); // radial: spherical distance
          return waveFn(raw * freq - time * speed + phase);
        };
    }
  }

  switch (field) {
    case "linearX":
      return (x, y, z, cx, cy, cz, time) => { rotate(x, y, cx, cy); return waveFn(compiledRotateSx * freq - time * speed + phase); };
    case "linearY":
      return (x, y, z, cx, cy, cz, time) => { rotate(x, y, cx, cy); return waveFn(compiledRotateSy * freq - time * speed + phase); };
    case "diagonal":
      return (x, y, z, cx, cy, cz, time) => {
        rotate(x, y, cx, cy);
        const raw = (compiledRotateSx + compiledRotateSy) * 0.70710678;
        return waveFn(raw * freq - time * speed + phase);
      };
    case "angular":
      return (x, y, z, cx, cy, cz, time) => {
        rotate(x, y, cx, cy);
        const raw = Math.atan2(compiledRotateSy - cy, compiledRotateSx - cx) / (Math.PI * 2);
        return waveFn(raw * freq - time * speed + phase);
      };
    case "spiral":
      return (x, y, z, cx, cy, cz, time) => {
        rotate(x, y, cx, cy);
        const sx = compiledRotateSx, sy = compiledRotateSy;
        const raw = Math.hypot(sx - cx, sy - cy) + Math.atan2(sy - cy, sx - cx) / (Math.PI * 2);
        return waveFn(raw * freq - time * speed + phase);
      };
    default:
      // Unmatched 2D field name (includes "linearZ" — no 2D meaning — and
      // the four normal-derived kinds, which only ever reach this compiled
      // path when NOT covered by a `rawOverride`, matching `sampleFieldVoice`'s
      // own documented fallback) — same "radial" default the interpreted
      // switch falls through to.
      return (x, y, z, cx, cy, cz, time) => {
        rotate(x, y, cx, cy);
        const raw = Math.hypot(compiledRotateSx - cx, compiledRotateSy - cy); // radial
        return waveFn(raw * freq - time * speed + phase);
      };
  }
}

/** Mirrors `combineSynth` exactly (including its `"argmax"` -> `Math.max`
 *  and default -> multiply fallbacks, for a hand-built program that sets an
 *  unusual `combine`/`blend` string) as one fixed closure per mode, chosen
 *  once at compile time instead of re-switching on `mode` every sample. */
function compilePairOp(mode: string): (a: number, b: number) => number {
  switch (mode) {
    case "argmax": return (a, b) => Math.max(a, b);
    case "add": return (a, b) => a + b;
    case "max": return (a, b) => Math.max(a, b);
    case "min": return (a, b) => Math.min(a, b);
    case "difference": return (a, b) => Math.abs(a - b);
    default: return (a, b) => a * b; // multiply
  }
}

interface CompiledVoiceEntry {
  readonly sample: CompiledVoiceSampler;
  readonly amp: number;
  readonly originU: number;
  readonly originV: number;
  readonly originW: number;
  /** `voice.sourceIndex ?? k`, where `k` is this voice's position in the
   *  ORIGINAL (unfiltered) `layer.voices` array — resolved once at compile
   *  time, exactly mirroring `foldVoices`'s own `voice.sourceIndex ?? k`
   *  fallback (`k` there is the same unfiltered index, not a position
   *  within the active-only subset this entry lives in). */
  readonly sourceIndex: number;
}

// Same "synchronous, single-threaded, read-immediately-after-write" scratch
// discipline as `compiledRotateSx`/`Sy` above — a `CompiledFold` used to
// return a fresh `{ combined, winner }` object on every call (once per
// LAYER per evaluate, not per voice, but still real allocation pressure on
// the cheapest presets, where a layer's total voice-sampling cost is only a
// few ns and an allocation is no longer negligible next to it).
let compiledFoldCombined = 0;
let compiledFoldWinner = -1;

type CompiledFold = (
  x: number, y: number, z: number,
  originX: number, originY: number, originZ: number,
  time: number,
) => void;

// Perf: measured directly (a standalone dispatch probe, not this preset
// bench) — iterating `voices[k].sample(...)` in a loop is a SINGLE call
// site that gets invoked with several DIFFERENT closures over a layer's
// voices (one per voice, each its own `compileVoiceSampler` output). V8
// can't build a good inline cache for a call site that cycles between
// more than a couple of distinct callees ("polymorphic dispatch"), so that
// loop measured SLOWER than even the plain interpreted string-switch
// dispatch it was meant to replace — the opposite of this optimization's
// goal. The fix is the standard one for this exact class of problem:
// UNROLL small, fixed voice counts into that many syntactically distinct
// call expressions (`v0.sample(...)`, `v1.sample(...)`, ...) — each is then
// its own call site, bound to the SAME single closure for that fold's
// entire lifetime (monomorphic), which V8 inlines and optimizes well.
// `UNROLL_MAX` covers every shipped preset's per-layer voice count (the
// field-synth schema's `layer1..9` groups voices into layers, and every
// shipped patch keeps 1-3 voices per layer); a layer with more active
// voices than this falls back to the loop below — correct, and still
// benefits from the per-voice field/wave dispatch this file already
// compiles away, just without the call-site monomorphism win on top.
const UNROLL_MAX = 4;

/** Compiles one layer's `foldVoices` (minus the always-active-count-0 case,
 *  which the caller skips before ever building a fold — see `CompiledLayer`
 *  below). `voices` is the layer's amp>0 subset only; `active` in the
 *  original result is therefore always exactly `voices.length`, a compile-
 *  time constant, whether or not a min/max short-circuit engages (it only
 *  ever skips SAMPLING remaining voices, never their contribution to the
 *  active count — see `foldVoices`'s own comment) — so the compiled fold
 *  never needs to track it at runtime at all. */
function compileFold(voices: readonly CompiledVoiceEntry[], combine: string): CompiledFold {
  const n = voices.length;

  if (combine === "argmax") {
    if (n >= 1 && n <= UNROLL_MAX) return compileArgmaxFoldUnrolled(voices);
    return (x, y, z, originX, originY, originZ, time) => {
      let best = -Infinity;
      let winner = -1;
      let winnerOrder = -1;
      for (let k = 0; k < n; k++) {
        const ve = voices[k]!;
        const cx = originX + ve.originU, cy = originY + ve.originV, cz = originZ + ve.originW;
        const o = ve.sample(x, y, z, cx, cy, cz, time);
        const contribution = ve.amp * o;
        if (contribution > best) { best = contribution; winner = ve.sourceIndex; winnerOrder = k; }
      }
      compiledFoldCombined = n > 1 ? (2 * winnerOrder + 1) / n - 1 : 0;
      compiledFoldWinner = winner;
    };
  }

  const shortCircuitable = combine === "min" || combine === "max";
  const isMin = combine === "min";
  const pairOp = compilePairOp(combine);
  if (n >= 1 && n <= UNROLL_MAX) return compilePairwiseFoldUnrolled(voices, pairOp, shortCircuitable, isMin);
  return (x, y, z, originX, originY, originZ, time) => {
    let combined = 0;
    for (let k = 0; k < n; k++) {
      const ve = voices[k]!;
      const cx = originX + ve.originU, cy = originY + ve.originV, cz = originZ + ve.originW;
      const o = ve.sample(x, y, z, cx, cy, cz, time);
      if (k === 0) {
        combined = ve.amp * o;
      } else {
        combined += ve.amp * (pairOp(combined, o) - combined);
      }
      if (shortCircuitable && (isMin ? combined <= -1 : combined >= 1)) break;
    }
    compiledFoldCombined = combined;
    compiledFoldWinner = -1;
  };
}

/**
 * Unrolled (`n` in `1..UNROLL_MAX`) mirror of the pairwise-fold loop above —
 * same operations, same order, but `v0.sample(...)`, `v1.sample(...)`, ...
 * are distinct source-level call expressions instead of one loop indexing
 * into `voices[k]`, so each stays monomorphic for this fold's lifetime (see
 * `UNROLL_MAX`'s doc). The short-circuit check is still present per step
 * (an ordinary data-dependent branch, not a dispatch site — cheap and
 * correctly predicted), so `min`/`max` short-circuiting behaves identically
 * to the loop path, just without the call-site cost that motivated this.
 */
function compilePairwiseFoldUnrolled(
  voices: readonly CompiledVoiceEntry[],
  pairOp: (a: number, b: number) => number,
  shortCircuitable: boolean,
  isMin: boolean,
): CompiledFold {
  const locked = (combined: number): boolean => shortCircuitable && (isMin ? combined <= -1 : combined >= 1);
  const v0 = voices[0]!;
  if (voices.length === 1) {
    return (x, y, z, originX, originY, originZ, time) => {
      const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
      const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
      compiledFoldCombined = v0.amp * o0;
      compiledFoldWinner = -1;
    };
  }
  const v1 = voices[1]!;
  if (voices.length === 2) {
    return (x, y, z, originX, originY, originZ, time) => {
      const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
      const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
      let combined = v0.amp * o0;
      if (!locked(combined)) {
        const cx1 = originX + v1.originU, cy1 = originY + v1.originV, cz1 = originZ + v1.originW;
        const o1 = v1.sample(x, y, z, cx1, cy1, cz1, time);
        combined += v1.amp * (pairOp(combined, o1) - combined);
      }
      compiledFoldCombined = combined;
      compiledFoldWinner = -1;
    };
  }
  const v2 = voices[2]!;
  if (voices.length === 3) {
    return (x, y, z, originX, originY, originZ, time) => {
      const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
      const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
      let combined = v0.amp * o0;
      if (!locked(combined)) {
        const cx1 = originX + v1.originU, cy1 = originY + v1.originV, cz1 = originZ + v1.originW;
        const o1 = v1.sample(x, y, z, cx1, cy1, cz1, time);
        combined += v1.amp * (pairOp(combined, o1) - combined);
        if (!locked(combined)) {
          const cx2 = originX + v2.originU, cy2 = originY + v2.originV, cz2 = originZ + v2.originW;
          const o2 = v2.sample(x, y, z, cx2, cy2, cz2, time);
          combined += v2.amp * (pairOp(combined, o2) - combined);
        }
      }
      compiledFoldCombined = combined;
      compiledFoldWinner = -1;
    };
  }
  const v3 = voices[3]!;
  // voices.length === 4 (UNROLL_MAX) — `compileFold` never calls this
  // helper outside `1..UNROLL_MAX`.
  return (x, y, z, originX, originY, originZ, time) => {
    const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
    const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
    let combined = v0.amp * o0;
    if (!locked(combined)) {
      const cx1 = originX + v1.originU, cy1 = originY + v1.originV, cz1 = originZ + v1.originW;
      const o1 = v1.sample(x, y, z, cx1, cy1, cz1, time);
      combined += v1.amp * (pairOp(combined, o1) - combined);
      if (!locked(combined)) {
        const cx2 = originX + v2.originU, cy2 = originY + v2.originV, cz2 = originZ + v2.originW;
        const o2 = v2.sample(x, y, z, cx2, cy2, cz2, time);
        combined += v2.amp * (pairOp(combined, o2) - combined);
        if (!locked(combined)) {
          const cx3 = originX + v3.originU, cy3 = originY + v3.originV, cz3 = originZ + v3.originW;
          const o3 = v3.sample(x, y, z, cx3, cy3, cz3, time);
          combined += v3.amp * (pairOp(combined, o3) - combined);
        }
      }
    }
    compiledFoldCombined = combined;
    compiledFoldWinner = -1;
  };
}

/**
 * Unrolled (`n` in `1..UNROLL_MAX`) mirror of the argmax-fold loop above —
 * see `compilePairwiseFoldUnrolled`'s doc for why. Argmax never short-
 * circuits (see `foldVoices`'s own doc), so every voice is always sampled;
 * the only per-step state is `best`/`winner`/`winnerOrder`.
 */
// `best` MUST seed at `-Infinity` (matching `foldVoices`'s own seed) rather
// than at the first voice's own contribution: a voice sample can be `NaN`
// (a degenerate `angular`/`spiral` at its own origin, an unresolved
// `rawOverride`-adjacent field, etc.), and `NaN > anything` — including
// `NaN > -Infinity` — is always `false`. Seeding `best` at `c0` directly
// would make voice 0 "win" any all-NaN or NaN-first tie by construction
// instead of correctly reporting no winner (`-1`), same as the loop path.
function compileArgmaxFoldUnrolled(voices: readonly CompiledVoiceEntry[]): CompiledFold {
  const n = voices.length;
  const v0 = voices[0]!;
  if (n === 1) {
    return (x, y, z, originX, originY, originZ, time) => {
      const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
      const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
      const c0 = v0.amp * o0;
      let winner = -1;
      if (c0 > -Infinity) winner = v0.sourceIndex;
      // n === 1 -> `combined = (2*0+1)/1 - 1 = 0` whenever there IS a
      // winner; `foldVoices`'s own `active > 1 ? ... : 0` never even reaches
      // the winnerOrder-dependent branch at n=1, so `combined` is always 0
      // here regardless — matches exactly either way.
      compiledFoldCombined = 0;
      compiledFoldWinner = winner;
    };
  }
  const v1 = voices[1]!;
  if (n === 2) {
    return (x, y, z, originX, originY, originZ, time) => {
      const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
      const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
      const cx1 = originX + v1.originU, cy1 = originY + v1.originV, cz1 = originZ + v1.originW;
      const o1 = v1.sample(x, y, z, cx1, cy1, cz1, time);
      const c0 = v0.amp * o0, c1 = v1.amp * o1;
      let best = -Infinity, winner = -1, winnerOrder = -1;
      if (c0 > best) { best = c0; winner = v0.sourceIndex; winnerOrder = 0; }
      if (c1 > best) { best = c1; winner = v1.sourceIndex; winnerOrder = 1; }
      compiledFoldCombined = n > 1 ? (2 * winnerOrder + 1) / n - 1 : 0;
      compiledFoldWinner = winner;
    };
  }
  const v2 = voices[2]!;
  if (n === 3) {
    return (x, y, z, originX, originY, originZ, time) => {
      const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
      const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
      const cx1 = originX + v1.originU, cy1 = originY + v1.originV, cz1 = originZ + v1.originW;
      const o1 = v1.sample(x, y, z, cx1, cy1, cz1, time);
      const cx2 = originX + v2.originU, cy2 = originY + v2.originV, cz2 = originZ + v2.originW;
      const o2 = v2.sample(x, y, z, cx2, cy2, cz2, time);
      const c0 = v0.amp * o0, c1 = v1.amp * o1, c2 = v2.amp * o2;
      let best = -Infinity, winner = -1, winnerOrder = -1;
      if (c0 > best) { best = c0; winner = v0.sourceIndex; winnerOrder = 0; }
      if (c1 > best) { best = c1; winner = v1.sourceIndex; winnerOrder = 1; }
      if (c2 > best) { best = c2; winner = v2.sourceIndex; winnerOrder = 2; }
      compiledFoldCombined = n > 1 ? (2 * winnerOrder + 1) / n - 1 : 0;
      compiledFoldWinner = winner;
    };
  }
  const v3 = voices[3]!;
  // n === 4 (UNROLL_MAX) — `compileFold` never calls this helper outside
  // `1..UNROLL_MAX`.
  return (x, y, z, originX, originY, originZ, time) => {
    const cx0 = originX + v0.originU, cy0 = originY + v0.originV, cz0 = originZ + v0.originW;
    const o0 = v0.sample(x, y, z, cx0, cy0, cz0, time);
    const cx1 = originX + v1.originU, cy1 = originY + v1.originV, cz1 = originZ + v1.originW;
    const o1 = v1.sample(x, y, z, cx1, cy1, cz1, time);
    const cx2 = originX + v2.originU, cy2 = originY + v2.originV, cz2 = originZ + v2.originW;
    const o2 = v2.sample(x, y, z, cx2, cy2, cz2, time);
    const cx3 = originX + v3.originU, cy3 = originY + v3.originV, cz3 = originZ + v3.originW;
    const o3 = v3.sample(x, y, z, cx3, cy3, cz3, time);
    const c0 = v0.amp * o0, c1 = v1.amp * o1, c2 = v2.amp * o2, c3 = v3.amp * o3;
    let best = -Infinity, winner = -1, winnerOrder = -1;
    if (c0 > best) { best = c0; winner = v0.sourceIndex; winnerOrder = 0; }
    if (c1 > best) { best = c1; winner = v1.sourceIndex; winnerOrder = 1; }
    if (c2 > best) { best = c2; winner = v2.sourceIndex; winnerOrder = 2; }
    if (c3 > best) { best = c3; winner = v3.sourceIndex; winnerOrder = 3; }
    compiledFoldCombined = n > 1 ? (2 * winnerOrder + 1) / n - 1 : 0;
    compiledFoldWinner = winner;
  };
}

interface CompiledLayer {
  /** Count of amp>0 voices — always equals `foldVoices`'s own `result.active`
   *  for this layer (see `compileFold`'s doc), so the compiled program never
   *  needs to call the fold just to learn a layer is empty. */
  readonly activeCount: number;
  /** `null` when `activeCount === 0` — an empty layer's fold is never built,
   *  matching the interpreted path's "skip like an amp-0 voice". */
  readonly fold: CompiledFold | null;
  readonly thresholdOn: boolean;
  readonly threshold: number;
  readonly invert: boolean;
  readonly blendOp: (a: number, b: number) => number;
  readonly amp: number;
  /** `thresholdOn && blend === "min"` / `"max"` — precomputed so the
   *  cross-layer skip check (`evaluateFieldProgram`'s own runtime-only
   *  short-circuit) never re-compares `blend` strings per layer per call. */
  readonly skipsWhenLockedLow: boolean;
  readonly skipsWhenLockedHigh: boolean;
}

interface CompiledProgram {
  readonly layers: readonly CompiledLayer[];
}

function compileFieldProgram(program: FieldProgram): CompiledProgram {
  const volumetric = program.domain === "3d";
  const layers: CompiledLayer[] = program.layers.map((layer) => {
    const activeEntries: CompiledVoiceEntry[] = [];
    layer.voices.forEach((voice, k) => {
      if (!(voice.amp > 0)) return;
      activeEntries.push({
        sample: compileVoiceSampler(voice, volumetric),
        amp: voice.amp,
        originU: voice.origin.u,
        originV: voice.origin.v,
        originW: voice.origin.w,
        sourceIndex: voice.sourceIndex ?? k,
      });
    });
    return {
      activeCount: activeEntries.length,
      fold: activeEntries.length > 0 ? compileFold(activeEntries, layer.combine) : null,
      thresholdOn: layer.thresholdOn,
      threshold: layer.threshold,
      invert: layer.invert,
      blendOp: compilePairOp(layer.blend),
      amp: layer.amp,
      skipsWhenLockedLow: layer.thresholdOn && layer.blend === "min",
      skipsWhenLockedHigh: layer.thresholdOn && layer.blend === "max",
    };
  });
  return { layers };
}

// Bounded by construction (see the "compiled evaluation form" doc above): an
// entry lives exactly as long as its `FieldProgram` object does.
const compiledProgramCache = new WeakMap<FieldProgram, CompiledProgram>();

function getCompiledProgram(program: FieldProgram): CompiledProgram {
  let compiled = compiledProgramCache.get(program);
  if (!compiled) {
    compiled = compileFieldProgram(program);
    compiledProgramCache.set(program, compiled);
  }
  return compiled;
}

/**
 * Evaluate a compiled program — the cross-layer fold, transcribed verbatim
 * from `evaluateFieldProgramInterpreted` above (same skip/lock logic, same
 * operand order), but every per-layer/per-voice dispatch already resolved
 * to a fixed closure by `compileFieldProgram`.
 */
function evaluateCompiledProgram(
  compiled: CompiledProgram,
  x: number, y: number, z: number,
  time: number,
  originX: number, originY: number, originZ: number,
): FieldEvalResult {
  let stackValue = 0;
  let stackActive = 0;
  let populatedLayers = 0;
  let singleLayerWinner = -1;
  let appliedLayers = 0;
  let stackLocked = 0;

  const layers = compiled.layers;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]!;

    if (
      stackLocked !== 0
      && ((stackLocked === -1 && layer.skipsWhenLockedLow) || (stackLocked === 1 && layer.skipsWhenLockedHigh))
    ) {
      if (layer.activeCount > 0) {
        populatedLayers++;
        stackActive += layer.activeCount;
        appliedLayers++;
      }
      continue;
    }

    if (layer.activeCount === 0) continue;
    layer.fold!(x, y, z, originX, originY, originZ, time);
    const resultCombined = compiledFoldCombined, resultWinner = compiledFoldWinner;
    populatedLayers++;
    singleLayerWinner = populatedLayers === 1 ? resultWinner : -1;
    stackActive += layer.activeCount;

    let v = resultCombined;
    if (layer.thresholdOn) v = v > layer.threshold ? 1 : -1;
    if (layer.invert) v = -v;

    if (appliedLayers === 0) {
      stackValue = layer.amp * v;
    } else {
      stackValue += layer.amp * (layer.blendOp(stackValue, v) - stackValue);
    }
    appliedLayers++;
    stackLocked = stackValue <= -1 ? -1 : stackValue >= 1 ? 1 : 0;
  }

  return {
    combined: stackValue,
    winner: populatedLayers === 1 ? singleLayerWinner : -1,
    active: stackActive,
  };
}

/**
 * Public entry point (VOLUMETRIC.md's "The field program IR", exported as
 * `evaluateGlyphFieldProgram`) — see `evaluateFieldProgramInterpreted` above
 * for the full parameter/behavior doc, which this preserves exactly. Prefers
 * a per-program compiled closure (cached by object identity — see "compiled
 * evaluation form" above) whenever `rawOverride` is absent; falls back to
 * the interpreted evaluator, unchanged, whenever one is supplied (a
 * genuinely per-sample callback that cannot be compiled away — see that
 * section's doc). Byte-identical output to the pre-compile implementation
 * either way; `fieldProgram.compiled-parity.test.ts` is the test that holds
 * this to `===`, not just approximate equality.
 */
export function evaluateFieldProgram(
  program: FieldProgram,
  x: number, y: number, z: number,
  time: number,
  originX = 0, originY = 0, originZ = 0,
  rawOverride?: FieldVoiceRawOverride,
): FieldEvalResult {
  if (rawOverride) {
    return evaluateFieldProgramInterpreted(program, x, y, z, time, originX, originY, originZ, rawOverride);
  }
  return evaluateCompiledProgram(getCompiledProgram(program), x, y, z, time, originX, originY, originZ);
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

// ---- signed-distance oracle + sphere tracer (VOLUMETRIC-3.md §3) --------

/**
 * A genuine signed distance to a compiled program's solid boundary, in
 * DOMAIN units (negative inside, matching every SDF primitive's convention —
 * see `sdfBox`'s doc). `(originX, originY, originZ)` is the same call-level
 * pattern origin `evaluateFieldProgram` takes, defaulting to (0, 0, 0).
 * Returned by `buildGlyphFieldDistanceOracle` for a program it has confirmed
 * IS distance-true; never constructed by hand.
 */
export type FieldDistanceSampler = (
  x: number, y: number, z: number,
  originX?: number, originY?: number, originZ?: number,
) => number;

/**
 * The two scalar params `buildGlyphFieldDistanceOracle`'s bias/gain regime
 * check needs. Kept narrow (not field-synth's full schema-derived params
 * type) so this module stays dependency-free of any particular effect's
 * param shape, per this file's header doc — a caller's wider params object
 * satisfies this structurally.
 */
export interface FieldDistanceOracleParams {
  readonly bias: number;
  readonly gain: number;
}

/**
 * Build a signed-distance oracle for a compiled `FieldProgram`, or return
 * `null` when the program is not — provably, by construction — a genuine
 * distance field (VOLUMETRIC-3.md §3's qualifying predicate, every condition
 * normative):
 *
 * - Exactly one POPULATED layer (a layer with at least one `amp > 0` voice);
 *   every other layer must be empty. Multiple populated layers fold through
 *   `combineSynth`, which is a VALUE op with no distance-preserving meaning.
 * - That layer's own `amp` (the layer MIX weight, `layerAmpL`/`mix` in the
 *   authoring surface) is `1` exactly — like the per-voice `amp` below, a
 *   mix weight scales the folded ±1 VALUE toward `bias`, not a distance, and
 *   any weight other than 1 can flip which side of the density mapping's
 *   solid/empty split a point falls on without moving the ±1 field at all.
 * - Every ACTIVE voice in that layer is `field: "menger"` or `"sierpinski"`
 *   — `"gyroid"`'s implicit has no genuine distance reading (it is a
 *   continuous sinusoidal field, not a distance to a boundary), so it is
 *   EXCLUDED even though it shares the SDF voice family's coordinate
 *   derivation.
 * - Every active voice has `wave: "step"` (any other wave warps the raw SDF
 *   through a NON-distance-preserving nonlinearity — `sin`/`triangle`/etc.
 *   destroy the metric) and `amp === 1` exactly (amp is a MIX WEIGHT — see
 *   `foldVoices`'s doc — and any weight other than 1 scales the folded VALUE,
 *   not the distance, breaking the `sdf - c` reading below).
 * - The layer's `combine` is `"min"` — the qualifying fold: the shipped
 *   field is `-sdf` (positive inside), so voice outputs are ±1 with +1 =
 *   solid; `min` over ±1 values is +1 (solid) iff EVERY voice says solid —
 *   an INTERSECTION of solids. Distance to an intersection is the MAX of
 *   the members' distances (not `min` — an executed counter-case: min-of-
 *   distances terminates inside the union, hitting where the solid test
 *   says empty; see `program` below for why this oracle folds with `max`
 *   instead of mirroring `combine` literally).
 * - The layer's `thresholdOn` is `false` (a threshold is itself a second,
 *   separate non-distance-preserving step function).
 * - `invert` may be `true` or `false` — negating a genuine signed distance
 *   is still a genuine signed distance to the SAME boundary (just the
 *   complement's), so it's allowed and applied to the final `max` fold, not
 *   per-voice.
 * - `params.bias`/`params.gain` are in the step-selective regime:
 *   `bias + gain/2 > 0 && bias - gain/2 <= 0` — the ±1 step field's two
 *   levels must straddle the density mapping's own solid/empty split
 *   (`clamp01(bias + gain*v*0.5) > 0`). Outside this regime the density
 *   mapping is all-solid or all-empty regardless of the ±1 value, so the
 *   surface the tracer would target isn't the iso level the solid test
 *   actually reads (measured regime table, VOLUMETRIC-3.md §3).
 *
 * Per voice, `D_i(p) = (sdf_i(freq_i * R_i(p - o_i)) - c_i) / freq_i`, where
 * `R_i` is the voice's own `angle` rotation, `o_i` its origin, and
 * `c_i = phase_i - speed_i * time` (folded in once, at BUILD time — the
 * returned oracle takes no `time` argument). Dividing by `freq_i` is load-
 * bearing: the raw SDF is evaluated on freq-SCALED coordinates, so its value
 * is in LATTICE units; stepping by it un-divided overshoots by `freq`
 * (measured 2.9x at freq 3) and tunnels exactly the thin walls the Nyquist
 * floor exists to protect. The program oracle is `D(p) = max_i D_i(p)`
 * (negated as a whole when `invert` is set) — the intersection reading
 * above, applied to genuine per-voice distances rather than to the ±1
 * VALUES `combine: "min"` folds at evaluation time (those are two different
 * operations that happen to share a name in the qualifying case: value-`min`
 * over ±1 outputs, distance-`max` over the SAME voices' distances).
 */
export function buildGlyphFieldDistanceOracle(
  program: FieldProgram,
  params: FieldDistanceOracleParams,
  time: number,
): FieldDistanceSampler | null {
  if (!(params.bias + params.gain / 2 > 0 && params.bias - params.gain / 2 <= 0)) return null;

  const populatedLayers = program.layers.filter((layer) => layer.voices.some((voice) => voice.amp > 0));
  if (populatedLayers.length !== 1) return null;
  const layer = populatedLayers[0]!;
  if (layer.combine !== "min" || layer.thresholdOn) return null;
  // `layer.amp` is the layer MIX weight (`stackValue = layer.amp * v` in
  // `foldVoices`) — it scales the folded ±1 VALUE toward `bias`, not a
  // distance. A mix below 1 can make the density mapping read solid (or
  // empty) somewhere the ±1 field itself disagrees, exactly like a per-voice
  // `amp !== 1` below breaks the `sdf - c` reading; the same exact-1
  // requirement applies at the layer level.
  if (layer.amp !== 1) return null;

  const activeVoices = layer.voices.filter((voice) => voice.amp > 0);
  if (activeVoices.length === 0) return null;
  for (const voice of activeVoices) {
    // This ALSO rejects the four normal-derived kinds (VOLUMETRIC-4.md §1) —
    // deliberately, not as an accident of them merely not being "menger"/
    // "sierpinski": a per-cell-constant field has no genuine distance reading
    // for a sphere tracer to step by (the same reasoning that excludes
    // "gyroid" above), and they are colour-stack-only in the first place —
    // this carve-only oracle never legitimately sees one.
    if (voice.field !== "menger" && voice.field !== "sierpinski") return null;
    if (voice.wave !== "step") return null;
    if (voice.amp !== 1) return null;
    if (!(voice.freq > 0) || !Number.isFinite(voice.freq)) return null;
  }

  const invert = layer.invert;
  const perVoice = activeVoices.map((voice) => ({
    voice,
    iter: clampSdfIter(voice.iter),
    c: voice.phase - voice.speed * time,
  }));

  return (x, y, z, originX = 0, originY = 0, originZ = 0) => {
    let maxD = -Infinity;
    for (const { voice, iter, c } of perVoice) {
      const cx = originX + voice.origin.u;
      const cy = originY + voice.origin.v;
      const cz = originZ + voice.origin.w;
      const [fx, fy, fz] = sdfVoiceLatticeCoords(voice, x, y, z, cx, cy, cz);
      const raw = voice.field === "menger" ? mengerFractalSdf(fx, fy, fz, iter) : sierpinskiFractalSdf(fx, fy, fz, iter);
      const d = (raw - c) / voice.freq;
      if (d > maxD) maxD = d;
    }
    return invert ? -maxD : maxD;
  };
}

/** Sphere-march safety factor — steps by `SPHERE_MARCH_SAFETY * D` rather
 *  than the full reported distance, the standard conservative-step
 *  convention that absorbs a not-quite-Lipschitz-1 SDF near a sharp feature
 *  without overshooting past it. */
export const SPHERE_MARCH_SAFETY = 0.9;
/** Hard cap on sphere-march steps; exhausting it without a confirmed hit is
 *  a miss (VOLUMETRIC-3.md §3). */
export const SPHERE_MARCH_MAX_STEPS = 64;
/** Domain-unit overshoot PAST a detected sign change, further INTO the
 *  solid, before the confirming real-sampler resample (VOLUMETRIC-3.md
 *  §3) — small relative to the thinnest qualifying feature at the schema's
 *  max iter/freq, large enough to clear float noise at the crossing
 *  itself. */
export const SPHERE_MARCH_OVERSHOOT_EPSILON = 1e-4;
/**
 * Stall detector (VOLUMETRIC-3.md §3, amended after Phase 3 measurement): a
 * step whose advance (`SPHERE_MARCH_SAFETY * D`) falls below this many
 * domain units is treated as evidence of the classic sphere-tracing "stuck
 * near an OFF-ray feature" pathology — `D` keeps reporting the distance to
 * some nearby surface that is NOT the one the ray actually crosses, so the
 * step shrinks geometrically toward zero without ever going negative.
 * Fixed ten times above `SPHERE_MARCH_OVERSHOOT_EPSILON` so the legitimate
 * final approach to a genuine crossing — which the overshoot+confirm step
 * already resolves in a single step once `D` first goes negative — is never
 * itself mistaken for a stall; still far below the thinnest feature the
 * schema's max iter/freq can produce (menger iter 4 at freq 1 carves
 * ~1/81-domain-unit boxes, over 10x this threshold), so a step legitimately
 * converging on real fine detail doesn't false-trigger either.
 */
export const SPHERE_MARCH_STALL_ADVANCE = 1e-3;
/**
 * Consecutive stall-sized steps required before `marchGlyphFieldSphere`
 * gives up on distance-stepping and falls back to the fixed-step march
 * (VOLUMETRIC-3.md §3). Measured directly against the shipped "Menger
 * SDF"/"Sierpinski SDF" presets (real rendered rays, iter 3): ordinary,
 * healthy convergence onto a genuine crossing routinely spends 2-5 steps
 * below `SPHERE_MARCH_STALL_ADVANCE` on its FINAL approach (`D` naturally
 * shrinks geometrically as a ray nears any surface, stall or not) before
 * crossing — a threshold of 3 (the first value tried) false-triggered on
 * these ordinary approaches often enough that ZERO of 218 Menger SDF hits
 * resolved via pure distance-stepping; 8 is the point past which the split
 * between pure and fallback-resolved hits stops changing at all (12 and 20
 * produce identical or worse pure-hit counts on the same fixture), meaning
 * everything past 8 steps really is the asymptotic "shrinks forever, never
 * crosses" pathology, not a slow-but-healthy approach — still small
 * relative to the 64-step budget.
 */
export const SPHERE_MARCH_STALL_STEPS = 8;

export interface FieldSphereMarchOptions {
  readonly time?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly originZ?: number;
  /**
   * The SAME step-density inputs the carve caller already computes for its
   * own fixed-step call (`params.marchSteps`, the 256 cap, and the
   * program's finest active frequency) — threaded through unchanged so the
   * stall/cap-pressure fixed-step FALLBACK below samples the remaining
   * segment at the identical per-cell density the fixed path would have
   * used for it, via the shared `fieldStepCount` helper `marchField` itself
   * calls. VOLUMETRIC-3.md §3's amendment: "same per-cell step density the
   * fixed path would use, via the shared step helper."
   */
  readonly steps?: number;
  readonly maxSteps?: number;
  readonly finestFreq?: number;
}

/**
 * Sphere-trace the segment `entry -> exit` against a signed-distance
 * `oracle` (VOLUMETRIC-3.md §3) — `marchField`'s sibling for programs
 * `buildGlyphFieldDistanceOracle` has confirmed ARE genuine distance fields.
 * Steps by `oracle(p) * SPHERE_MARCH_SAFETY` instead of a fixed grid,
 * converging on thin or deep features a fixed step count would either
 * overshoot or need many more steps to resolve. `sampler` is the REAL
 * (non-distance) field — same contract as `marchField`'s own `sampler` —
 * used both to CONFIRM a sign-change step before it emits, and (amended,
 * see below) to drive the fixed-step fallback.
 *
 * Contract:
 * - `oracle(entry) <= 0` (already inside) hits immediately at `t = 0`,
 *   mirroring `marchField`'s own entry-already-solid short circuit —
 *   `distance`/`sampleDistance` 0, emission position = entry.
 * - Otherwise steps forward by `SPHERE_MARCH_SAFETY * D` each iteration. A
 *   step whose new position reads `<= 0` is a sign change. The reported hit
 *   is never that raw crossing itself: it overshoots
 *   `SPHERE_MARCH_OVERSHOOT_EPSILON` further INTO the solid along the ray
 *   and re-samples with the REAL field `sampler` there, confirming `> 0`
 *   before emitting — the same plateau discipline `marchField`'s own doc
 *   describes (a hard-thresholded field can sit exactly on its own
 *   boundary, so the emitted point must be a raw sample the real sampler
 *   actually measured solid, never an oracle-only position).
 * - An unconfirmed sign change (the real sampler disagrees with the oracle
 *   at the overshoot sample) reports a miss — there is no confirmed
 *   evidence of solid material along this ray, the same rule `marchField`
 *   applies to a non-finite sample.
 * - **Stall / step-cap-pressure fallback (VOLUMETRIC-3.md §3, amended after
 *   Phase 3 measurement):** naive distance-stepping alone stalls
 *   approaching an OFF-ray feature on dense recursive fractals — measured
 *   17% of fixed-step's hits lost to bare cap exhaustion at iter 3. Before
 *   taking a step, if the last `SPHERE_MARCH_STALL_STEPS` advances were all
 *   below `SPHERE_MARCH_STALL_ADVANCE`, OR this is the last step the
 *   `SPHERE_MARCH_MAX_STEPS` budget allows, the marcher stops
 *   distance-stepping and falls back to a fixed-step scan of [current
 *   position, `exit`] — but on the SAME ABSOLUTE GRID a plain fixed-step
 *   call over the FULL original chord would sample (`fieldStepCount`
 *   applied to the FULL chord length, at the SAME `opts.steps`/`maxSteps`/
 *   `finestFreq` the carve caller's own fixed-step call uses), just
 *   skipping the analytically-proven-empty prefix before the current
 *   position. This is deliberately NOT the same as re-deriving a fresh step
 *   count for the shorter remaining segment alone: `fieldStepCount` scales
 *   its Nyquist term by chord length, so a shorter segment quantizes onto a
 *   DIFFERENTLY-PHASED grid that can legitimately skip a thin feature the
 *   full-chord grid's own specific sample offsets would have caught — same
 *   per-cell step DENSITY has to mean the same grid phase, not just the
 *   same step count, for the fallback to be a genuine superset of the plain
 *   fixed-step result rather than usually one. A stalled ray therefore
 *   finishes exactly as a plain fixed-step call would have from that point
 *   on — hit-set superset is restored by construction, never a miss purely
 *   from exhausting the sphere budget or from grid re-phasing. The
 *   fallback's own `t`/`distance`/`sampleDistance` are already expressed
 *   relative to the ORIGINAL `entry` (same grid, same origin); pure-miss
 *   only when this fallback scan also finds nothing.
 * - Stepping past `exit` without a sign change or a stall (i.e. `D` stayed
 *   large enough to legitimately confirm no solid material exists anywhere
 *   along the ray) is a genuine miss — not stall/cap-pressure, so no
 *   fallback: the tracer already did its job and found nothing.
 * - A degenerate segment (`entry === exit`, zero-length or non-finite
 *   chord) always misses, same as `marchField`.
 *
 * A confirmed hit's `t`/`distance`/`x`/`y`/`z` equal its own `sampleT`/
 * `sampleDistance`/`sampleX`/`sampleY`/`sampleZ` when the hit came from
 * distance-stepping — unlike `marchField`'s secant refinement, there is no
 * separate interpolated position there: the emitted point IS the confirmed
 * raw sample (slice-1's plateau discipline). A hit that came from the
 * fixed-step fallback instead carries THAT march's own secant-refined
 * `t`/`distance`/`x`/`y`/`z` vs. raw `sampleT`/`sampleDistance`/
 * `sampleX`/`Y`/`Z` split, exactly as `marchField` itself produces it.
 */
export function marchGlyphFieldSphere(
  entry: readonly [number, number, number],
  exit: readonly [number, number, number],
  oracle: FieldDistanceSampler,
  sampler: FieldSampler,
  opts: FieldSphereMarchOptions = {},
): FieldMarchResult {
  const [ex, ey, ez] = entry;
  const [xx, xy, xz] = exit;
  const dx = xx - ex, dy = xy - ey, dz = xz - ez;
  const chordLength = Math.hypot(dx, dy, dz);
  if (!(chordLength > 0) || !Number.isFinite(chordLength)) return { hit: false };

  const originX = opts.originX ?? 0, originY = opts.originY ?? 0, originZ = opts.originZ ?? 0;
  const time = opts.time ?? 0;
  const ux = dx / chordLength, uy = dy / chordLength, uz = dz / chordLength;
  const sampleD = (px: number, py: number, pz: number): number => oracle(px, py, pz, originX, originY, originZ);

  // Falls back to a fixed-step scan of [current position, exit] — but
  // critically, on the SAME ABSOLUTE GRID a plain `marchField(entry, exit,
  // ...)` call over the FULL original chord would sample (same
  // `fieldStepCount(chordLength, opts)` step count applied to the FULL
  // chord length, not a fresh one re-derived for the shorter remaining
  // segment), just skipping the analytically-proven-empty prefix before
  // `distSoFar` (sphere-stepping's own conservative-radius guarantee: a
  // step of size <= D can never cross into solid material, so nothing
  // solid exists before wherever it currently stands). This is NOT the
  // same as calling `marchField` over the remaining sub-segment with the
  // SAME `steps`/`maxSteps`/`finestFreq` OPTIONS: `fieldStepCount` scales
  // its Nyquist term by chord length, so a shorter remaining segment
  // quantizes onto a DIFFERENTLY-PHASED grid — measured directly to
  // legitimately skip a thin feature the full-chord grid's own specific
  // sample offsets happened to land inside (2 lost cells on the Sierpinski
  // SDF preset before this alignment fix). Reproducing the FULL grid's own
  // phase, not just its step COUNT, is what "same per-cell step density"
  // (VOLUMETRIC-3.md §3) has to mean for the fallback to be a genuine
  // superset of the plain fixed-step result, not just usually one.
  //
  // This duplicates `marchField`'s own secant/raw-sample/non-finite-sample
  // discipline rather than calling it, specifically because `marchField`
  // has no "start at a known-empty prefix on this exact grid" entry point
  // — deliberately scoped local to this closure rather than widening
  // `marchField`'s own public contract for every other caller.
  function fallbackToFixed(distSoFar: number): FieldMarchResult {
    const steps = fieldStepCount(chordLength, { steps: opts.steps, maxSteps: opts.maxSteps, finestFreq: opts.finestFreq });

    let prevT = distSoFar / chordLength;
    let prevX = ex + ux * distSoFar, prevY = ey + uy * distSoFar, prevZ = ez + uz * distSoFar;
    let prevValue = sampler(prevX, prevY, prevZ, time);
    let prevFinite = Number.isFinite(prevValue);
    if (prevFinite && prevValue > 0) {
      return { hit: true, t: prevT, distance: distSoFar, x: prevX, y: prevY, z: prevZ, sampleT: prevT, sampleX: prevX, sampleY: prevY, sampleZ: prevZ, sampleDistance: distSoFar };
    }

    const startI = Math.max(1, Math.ceil(prevT * steps));
    for (let i = startI; i <= steps; i++) {
      const t = i / steps;
      const x = ex + dx * t, y = ey + dy * t, z = ez + dz * t;
      const value = sampler(x, y, z, time);
      const finite = Number.isFinite(value);
      if (finite && value > 0) {
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
          x: ex + dx * hitT, y: ey + dy * hitT, z: ez + dz * hitT,
          sampleT: t,
          sampleX: x, sampleY: y, sampleZ: z,
          sampleDistance: t * chordLength,
        };
      }
      prevFinite = finite;
      prevT = t;
      prevValue = value;
    }
    return { hit: false };
  }

  let d = sampleD(ex, ey, ez);
  if (!Number.isFinite(d)) return { hit: false };
  if (d <= 0) {
    return { hit: true, t: 0, distance: 0, x: ex, y: ey, z: ez, sampleT: 0, sampleX: ex, sampleY: ey, sampleZ: ez, sampleDistance: 0 };
  }

  let dist = 0;
  let stallStreak = 0;
  for (let i = 0; i < SPHERE_MARCH_MAX_STEPS; i++) {
    const advance = SPHERE_MARCH_SAFETY * d;
    stallStreak = advance < SPHERE_MARCH_STALL_ADVANCE ? stallStreak + 1 : 0;
    const stalled = stallStreak >= SPHERE_MARCH_STALL_STEPS;
    const stepCapPressure = i === SPHERE_MARCH_MAX_STEPS - 1;
    if (stalled || stepCapPressure) return fallbackToFixed(dist);

    dist += advance;
    if (dist >= chordLength) return { hit: false };
    const px = ex + ux * dist, py = ey + uy * dist, pz = ez + uz * dist;
    d = sampleD(px, py, pz);
    if (!Number.isFinite(d)) return { hit: false };
    if (d <= 0) {
      const confirmDist = Math.min(dist + SPHERE_MARCH_OVERSHOOT_EPSILON, chordLength);
      const cx = ex + ux * confirmDist, cy = ey + uy * confirmDist, cz = ez + uz * confirmDist;
      const real = sampler(cx, cy, cz, time);
      if (!(Number.isFinite(real) && real > 0)) return { hit: false };
      return {
        hit: true,
        t: confirmDist / chordLength,
        distance: confirmDist,
        x: cx, y: cy, z: cz,
        sampleT: confirmDist / chordLength,
        sampleX: cx, sampleY: cy, sampleZ: cz,
        sampleDistance: confirmDist,
      };
    }
  }
  // Unreachable: `stepCapPressure` fires (and returns) on the last
  // iteration above, so the loop never falls through.
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

// ---- program builder + validator (VOLUMETRIC-3.md §4, "program-as-data") -

/** Authoring-friendly input to `buildGlyphFieldProgram` — every field the raw
 *  `FieldVoice` IR needs, minus the ones with an obvious, documented default
 *  (mirroring field-synth's own schema defaults, so a hand-authored voice
 *  that omits a field behaves like a schema voice at its default). Only
 *  `field`/`wave`/`freq` are required — every other knob is a no-op at its
 *  default (0 speed, full amp, 0 phase, an even duty split, no rotation, no
 *  origin offset, `iter` at `clampSdfIter`'s own fallback). */
export interface FieldVoiceInput {
  readonly field: string;
  readonly wave: string;
  readonly freq: number;
  readonly speed?: number;
  readonly amp?: number;
  readonly phase?: number;
  readonly duty?: number;
  readonly angle?: number;
  readonly originU?: number;
  readonly originV?: number;
  readonly originW?: number;
  readonly color?: string;
  readonly iter?: number;
}

/** Authoring-friendly input to `buildGlyphFieldProgram` for one layer — a
 *  `voices` list plus the layer's own shaping knobs, each defaulting to the
 *  no-op value field-synth's schema uses for an untouched layer (`multiply`
 *  combine/blend, threshold off, no invert, full mix weight) — see
 *  `buildGlyphFieldProgram`'s doc for why `combine` can't default to
 *  `"inherit"` the way the flat schema's `layerCombineL` does. */
export interface FieldLayerInput {
  readonly voices: readonly FieldVoiceInput[];
  readonly combine?: string;
  readonly thresholdOn?: boolean;
  readonly threshold?: number;
  readonly invert?: boolean;
  readonly blend?: string;
  /** Mix weight for this layer entering the stack — `FieldLayer.amp`'s
   *  authoring name (`amp` already means "voice amplitude" one level down;
   *  spelling the layer's own weight differently avoids reusing that word
   *  for two different things in the same authoring call). */
  readonly mix?: number;
}

export interface FieldProgramInput {
  /** Defaults to `"2d"` — the more common case (most authored programs are
   *  not volumetric); a caller building a volumetric program must say so. */
  readonly domain?: "2d" | "3d";
  readonly layers: readonly FieldLayerInput[];
}

/**
 * Build a `FieldProgram` from a pleasant authoring surface — layers of
 * voices with every IR default filled in (VOLUMETRIC-3.md §4's "program
 * builder"), including `sourceIndex`: voices are numbered in FLAT authoring
 * order (the order `layers` and each layer's `voices` are written in, not
 * grouped by layer), exactly mirroring field-synth's own flat-schema -> IR
 * compile (`compileFieldVoices`, which numbers voice1..N the same way before
 * `compileFieldSynthProgram` groups them by layer) — so a program built here
 * reports argmax winners, and feeds a `voiceColors`-style flat per-voice
 * palette, the same way a flat-params patch does.
 *
 * There is no `"inherit"` combine value here the way field-synth's schema
 * `layerCombineL` has: `"inherit"` only means something relative to a
 * patch-level `combine` the flat schema also carries, which a hand-built
 * program has no equivalent of — so `combine` defaults to `"multiply"`
 * (field-synth's own patch-level default) instead.
 */
export function buildGlyphFieldProgram(input: FieldProgramInput): FieldProgram {
  let sourceIndex = 0;
  const layers: FieldLayer[] = input.layers.map((layerInput) => {
    const voices: FieldVoice[] = layerInput.voices.map((voiceInput) => ({
      field: voiceInput.field,
      wave: voiceInput.wave,
      freq: voiceInput.freq,
      speed: voiceInput.speed ?? 0,
      amp: voiceInput.amp ?? 1,
      phase: voiceInput.phase ?? 0,
      duty: voiceInput.duty ?? 0.5,
      angle: voiceInput.angle ?? 0,
      origin: {
        u: voiceInput.originU ?? 0,
        v: voiceInput.originV ?? 0,
        w: voiceInput.originW ?? 0,
      },
      color: voiceInput.color ?? "#ffffff",
      iter: voiceInput.iter ?? 3,
      sourceIndex: sourceIndex++,
    }));
    return {
      voices,
      combine: layerInput.combine ?? "multiply",
      thresholdOn: layerInput.thresholdOn ?? false,
      threshold: layerInput.threshold ?? 0,
      invert: layerInput.invert ?? false,
      blend: layerInput.blend ?? "multiply",
      amp: layerInput.mix ?? 1,
    };
  });
  return { domain: input.domain ?? "2d", layers };
}

// Layers are value-folded, not selected by identity (see `FieldLayer.blend`'s
// doc) — every `SYNTH_COMBINES` entry except `"argmax"`.
const FIELD_PROGRAM_LAYER_BLEND_VALUES: readonly string[] = SYNTH_COMBINES.filter((op) => op !== "argmax");

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Shape-validate an arbitrary value as a `FieldProgram` (VOLUMETRIC-3.md
 * §4's "program-as-data" — an unbounded authoring surface with no schema
 * standing between it and `evaluateFieldProgram`'s per-voice/per-layer
 * dereferences, unlike field-synth's own flat-params path, which
 * `assertParamValue`/`validateSchema` already gate in `packages/glyphcss`).
 * Throws a descriptive `TypeError` on the first structural problem found —
 * a wrong-shaped `layers`/`voices` array, an unrecognized enum value
 * (`field`/`wave`/layer `combine`/layer `blend`), a non-finite numeric
 * field, or a malformed `origin` — and does not repair or coerce. Public so
 * a caller (or `packages/glyphcss`'s program-as-data mount-time hook) can
 * validate a hand-built or externally-sourced program before evaluating it.
 */
export function validateGlyphFieldProgram(program: unknown): void {
  if (!program || typeof program !== "object") {
    throw new TypeError("glyphcss field program: program must be an object.");
  }
  const p = program as { domain?: unknown; layers?: unknown };
  if (p.domain !== "2d" && p.domain !== "3d") {
    throw new TypeError('glyphcss field program: domain must be "2d" or "3d".');
  }
  if (!Array.isArray(p.layers) || p.layers.length === 0) {
    throw new TypeError("glyphcss field program: layers must be a non-empty array.");
  }
  p.layers.forEach((layer: unknown, li: number) => {
    if (!layer || typeof layer !== "object") {
      throw new TypeError(`glyphcss field program: layer ${li} must be an object.`);
    }
    const l = layer as Record<string, unknown>;
    if (!Array.isArray(l.voices)) {
      throw new TypeError(`glyphcss field program: layer ${li}.voices must be an array.`);
    }
    if (!(SYNTH_COMBINES as readonly string[]).includes(l.combine as string)) {
      throw new TypeError(`glyphcss field program: layer ${li}.combine "${String(l.combine)}" is not a recognized combine op.`);
    }
    if (typeof l.thresholdOn !== "boolean") {
      throw new TypeError(`glyphcss field program: layer ${li}.thresholdOn must be a boolean.`);
    }
    if (!isFiniteNumber(l.threshold)) {
      throw new TypeError(`glyphcss field program: layer ${li}.threshold must be a finite number.`);
    }
    if (typeof l.invert !== "boolean") {
      throw new TypeError(`glyphcss field program: layer ${li}.invert must be a boolean.`);
    }
    if (!FIELD_PROGRAM_LAYER_BLEND_VALUES.includes(l.blend as string)) {
      throw new TypeError(
        `glyphcss field program: layer ${li}.blend "${String(l.blend)}" must be a non-argmax value op `
        + "(layers are value-folded, not selected by identity).",
      );
    }
    if (!isFiniteNumber(l.amp)) {
      throw new TypeError(`glyphcss field program: layer ${li}.amp must be a finite number.`);
    }
    (l.voices as unknown[]).forEach((voice: unknown, vi: number) => {
      if (!voice || typeof voice !== "object") {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi} must be an object.`);
      }
      const v = voice as Record<string, unknown>;
      if (!(SYNTH_FIELDS as readonly string[]).includes(v.field as string)) {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.field "${String(v.field)}" is not a recognized field.`);
      }
      if (!(SYNTH_WAVES as readonly string[]).includes(v.wave as string)) {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.wave "${String(v.wave)}" is not a recognized wave.`);
      }
      for (const key of ["freq", "speed", "amp", "phase", "duty", "angle"] as const) {
        if (!isFiniteNumber(v[key])) {
          throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.${key} must be a finite number.`);
        }
      }
      const origin = v.origin as Record<string, unknown> | undefined;
      if (!origin || typeof origin !== "object" || !isFiniteNumber(origin.u) || !isFiniteNumber(origin.v) || !isFiniteNumber(origin.w)) {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.origin must be a { u, v, w } object of finite numbers.`);
      }
      if (typeof v.color !== "string" || v.color.length === 0) {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.color must be a non-empty string.`);
      }
      if (v.iter !== undefined && !isFiniteNumber(v.iter)) {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.iter must be a finite number when present.`);
      }
      if (v.sourceIndex !== undefined && (!isFiniteNumber(v.sourceIndex) || v.sourceIndex < 0 || !Number.isInteger(v.sourceIndex))) {
        throw new TypeError(`glyphcss field program: layer ${li} voice ${vi}.sourceIndex must be a non-negative integer when present.`);
      }
    });
  });
}
