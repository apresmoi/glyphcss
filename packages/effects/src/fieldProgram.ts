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

export const SYNTH_FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise", "linearZ"] as const;
export const SYNTH_WAVES = ["sin", "triangle", "saw", "square"] as const;
export const SYNTH_COMBINES = ["add", "multiply", "max", "min", "difference", "argmax"] as const;

// ---- waveform + noise primitives -------------------------------------

// Exported so consumers (e.g. the website's `/synth` waveform trendlines) can
// plot the exact same shape+phase math the engine evaluates, instead of a
// second copy that could drift. `duty` only shapes the square wave (the high
// fraction of its cycle, `p < duty ? 1 : -1`); every other kind ignores it.
// Default 0.5 reproduces the pre-duty `p < 0.5` split exactly.
export function synthWave(kind: string, t: number, duty = 0.5): number {
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
   * an absolute domain coordinate. Only radial/angular/spiral and the
   * `angle` rotation pivot read it; linear fields ignore origin entirely,
   * matching field-synth's documented axis-projection behavior.
   */
  readonly origin: { readonly u: number; readonly v: number; readonly w: number };
  readonly color: string;
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
  const maxStepsCap = Math.max(1, Math.round(opts.maxSteps ?? 256));
  const minSteps = Math.max(1, Math.min(maxStepsCap, Math.round(opts.steps ?? 48)));
  const finestFreq = opts.finestFreq ?? 0;
  const nyquistSteps = finestFreq > 0 ? Math.ceil(2 * chordLength * finestFreq) : 0;
  const steps = Math.max(minSteps, Math.min(maxStepsCap, nyquistSteps));

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
