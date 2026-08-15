# Volumetric field synth — design

Status: **implemented** (`fe05add..9f1d2f5`: `objectExit` + `dynamicRequirements`
in `glyphcss`; the field-program IR, 3D voices, `duty`/`phase`, voice layers,
carve, and the static-export port in `@glyphcss/effects`; the `/synth` page's
volumetric UI, layer cards, and codec index escape in `website`). This doc now
records the design and the review history that shaped it; the shipped
implementation is the source of truth for exact behavior, and AGENTS.md's
effects section is the maintained reference — this doc is not updated further
as the code evolves. It was the spec for making field-synth
volumetric: 3D voices sampled through a mesh's own volume, opt-in voice
layers with per-layer shaping, and a raymarched "carve" mode that turns the
field into internal structure — holes, interior walls, color transitions in
the meat of the object. The driving example is a Menger sponge rendered as an
effect on a plain cube mesh, with no sponge geometry and no prepared
playback.

Three steps, each independently shippable, each subsuming the previous:

1. **Volumetric effect inputs** — a new requirement-gated per-cell buffer
   (`objectExit`; the ray is implied by entry→exit) so an effect can march
   inside the depth-winning mesh, plus a params-aware requirements hook so
   only patches that need it pay for it.
2. **3D voices** — the existing wave/field primitives lifted to a 3D domain
   under `space: "object"`, plus `duty` and `phase` parameters on voices.
3. **Voice layers** — opt-in grouping of voices into layers with per-layer
   combine, threshold, invert, and blend. This is what makes recursive
   boolean patterns (Sierpinski/Menger membership) expressible.

A fourth constraint shapes all three: this design is the first slice of a
possible longer arc toward a **spectral geometry runtime** (shapes as
editable oscillator programs — analysis from meshes, LOD as bandwidth,
field-authoritative geometry). That arc is explicitly *not* being built
here, but the seams that make it cheap later are (see "The field program
IR" and "Spectral track" below). The rule of thumb throughout: caps and
flat-params ergonomics live in the *frontend*; the evaluator and marcher
are unbounded, data-driven, and exported.

## The field program IR (the steering seam)

The internal evaluation form is a plain-data **field program**: an array of
layers, each an array of voice records (`field`, `wave`, `freq`, `speed`,
`amp`, `phase`, `duty`, `angle`, `origin`, `color`) plus the layer's
combine/threshold/invert/blend/amp — no fixed length anywhere.
`evaluateVoices` already takes a `readonly SynthVoice[]`; this design keeps
that property and extends it upward:

- **The flat param schema is a frontend that compiles to the IR.**
  `SYNTH_VOICES = 6` and `layer1..6` cap the *schema*, not the evaluator.
  The compile step (params → IR) is one small pure function.
- **The IR evaluator and the marcher are public.** `@glyphcss/effects`
  exports the IR types, `evaluateFieldProgram(program, x, y, z, time)`, and
  a sampler-agnostic marcher
  `marchField(entry, exit, sampler, opts)` where `sampler` is any
  `(x, y, z, t) => number` — the carve path calls it with the field-program
  sampler, but nothing in the marcher knows about voices. A future
  field-authoritative primitive (or an SDF-sourced program) plugs into the
  same two functions with a bounding-volume segment instead of rasterized
  entry/exit.
- **The static exporter ports the IR evaluator, not the schema.** The
  inlined-JS port consumes the compiled program, so the frontend can grow
  without touching the exporter again.
- **Extensibility is append-only by construction.** New basis kinds (e.g. a
  future `planeWave [kx, ky, kz]` term for the spectral track) append to
  `SYNTH_FIELDS`; the URL codec already requires append-only ordering, and
  the IR carries whatever the enum names.

## Why layers are required (recorded rationale)

Every voice is *separable*: a 1D wave along one scalar projection of the
domain. A flat fold of separable voices under any one of the available
combine ops, with the single final nonlinearity the ramp applies, cannot
express Menger membership. Menger's rule is "hole ⇔ some scale where **at
least two axes are in their middle third at that same scale**" — a per-scale
count. Counterexample (verified numerically against the real
`evaluateVoices` fold, which with all amps 1 under `add` is the plain sum):
with six duty-⅓ squares (x, y, z at freqs 3 and 9),

- point A: x mid @ freq 3, y mid @ freq 9 → Menger: **solid** (no single
  scale has two mids), folded sum −2
- point B: x mid @ freq 3, y mid @ freq 3 → Menger: **hole** (freq 3 has
  two), folded sum −2

Same value, opposite membership — no global threshold separates them. The
same check was run for `multiply` (yields mid-count parity), `max` ("any mid
anywhere" = Cantor-dust complement), `min`, and `difference`: none encode
the per-scale count, and the single patch-level `combine` cannot mix ops.
The fix is a threshold *per scale* before scales combine — exactly a layer
with a shaping stage. Conversely, patterns whose rule factorizes per axis
(Cantor dust: "solid ⇔ no axis is ever mid") **are** reachable with the flat
fold once voices are 3D and `duty` exists (a `max` fold of six duty-⅓
squares plus the final threshold).

**Voice-count ceiling (frontend-only, deliberate scope):** the Menger
construction needs three axis voices per scale, so the flat-params frontend
(`SYNTH_VOICES = 6`) caps *schema-authored* Menger at **depth 2** (two
layers × three axes). Depth 3 needs nine voices — inexpressible in the
schema, but **expressible in the IR**, and the acceptance suite proves it
there (see Acceptance 2b): the cap is a frontend limitation, not an
evaluator one. This design does not raise the schema voice count; depth ≥ 3
*rendering* additionally exceeds carve's march-resolution envelope (see
Carve), so the schema cap and the march envelope agree. A future SDF voice
family (menger/gyroid as single primitives) remains the efficient deep-
recursion path — an extension point, out of scope here.

## Step 1 — volumetric effect inputs

### New requirement

`GlyphEffectRequirement` (packages/glyphcss/src/api/effects.ts) gains:

- `"objectExit"` — interleaved x/y/z **object-space exit point** of the view
  ray through the depth-winning mesh: the *farthest* intersection of that
  same mesh along the cell's view ray, in the mesh's pre-transform
  coordinates. Empty/unavailable cells are `NaN`, same contract as
  `worldPosition` / `objectPosition`. The typed field lands on
  `GlyphEffectFrameView` (api/effects.ts, beside `objectPosition`); the
  effects package's `AnyContext` alias inherits it.

The **object-space ray** is not a separate buffer: it is
`normalize(objectExit − objectPosition)` per cell. Deriving it from the two
endpoint buffers keeps the same no-matrix-inverse discipline
`objectPosition` established — both endpoints come from barycentric
interpolation of `Polygon.objectVertices`, so the direction is exact under
non-uniform scale and no per-mesh inverse transform is ever formed. A cell
where entry and exit coincide (grazing silhouette) yields a degenerate ray;
effects must treat a non-finite or zero-length ray as "no volume" and fall
back to surface sampling.

### Producing `objectExit` (second sweep — the only viable design)

A farthest-of-winning-mesh value cannot be produced inside the main solid
pass: the per-cell winner is decided incrementally and is only final after
the last polygon, and back faces never reach scan-fill at all (they are
culled before it). The exit pass is therefore a **second sweep** with these
spec'd dependencies:

- **Winner mesh id in visible mode.** The semantic winner buffer
  (`winnerPolygonBuf`) is polygon-indexed and retained only under
  `glyphOutput: "semantic"`. The exit pass needs a per-cell winning **mesh**
  id retained in normal visible renders — a polygon→mesh map (the
  `globalPolygonOffsets` pattern) wired into the solid pass, allocated only
  when the requirement is active.
- **A farthest-depth rasterizer.** `fillDepthTri` keeps the *nearest* depth
  and skips near-plane-straddling triangles instead of clipping them. The
  exit rasterizer keeps the **farthest** depth plus barycentric weights over
  `objectVertices`, culls nothing (back faces included), and must clip
  near-plane-straddling triangles — a perspective camera near or inside the
  mesh is the marquee volumetric case, and NaN exits there would kill it.
- **Same depth conventions.** Per-mesh `biasScale`, `depthEpsilon`, and the
  perspective z convention replicated so entry and exit depths are
  comparable.
- **Supersample plumbing.** The exit buffer is produced at the pass's
  supersample resolution and downsampled by the same representative-subcell
  selection (`downsampleSolid`'s nearest-covered-subcell-to-center) so entry
  and exit describe the same subcell's ray.
- **Scope: all meshes, per output.** Effects target `"surfaces"`/
  `"viewport"` scene-wide — there is no "mesh hosting an effect" concept
  (mesh-handle targets are explicitly rejected today). Any mesh can win any
  cell, so the sweep covers all solid geometry of each output that retains
  effect inputs: the base `<pre>` and each per-mesh detail `<pre>` (each
  detail layer re-runs the pipeline at `supersample: 1`).

### Params-aware requirement gating (new protocol hook)

Requirements are static per program today, and `optionalRequirements` is
retention-equivalent to hard requirements — so declaring `objectExit` on
field-synth statically would make **every** mounted field-synth patch,
including plain 2D ones, pay the extra sweep. The protocol gains an optional
hook:

```ts
dynamicRequirements?(params): readonly GlyphEffectRequirement[]
```

merged with the static arrays and re-evaluated on the existing coalesced
params transactions (a params change already schedules a recompose;
requirement changes additionally invalidate retained inputs). Field-synth
returns `objectPosition` only when `params.space === "object"` and adds
`objectExit` only when `render: "carve"`. This hook is part of the
`packages/glyphcss` surface and mirrors through React/Vue untouched (params
are data; the hook lives on the program definition).

### Semantics and limits

- **Solid-mode-only**, like every hard surface requirement; in
  wireframe/voxel modes consumers degrade the same way `space: "object"`
  already degrades.
- **Convex-exact.** For a convex mesh, entry→exit is exactly the solid
  chord. For a concave mesh the segment may bridge void gaps (the march can
  tunnel through a concavity); documented approximation. The fix path (per-
  cell hit lists / depth peeling) is future work.
- **Carved holes show the page background, not farther scene geometry.**
  Anything behind the host mesh already lost the per-cell depth test before
  effects run. This includes the cross-`<pre>` case: a carved hole in a
  detail layer does **not** reveal base-grid geometry sitting directly
  behind it — the occlusion id-map blanked those base cells at rasterize
  time. Expect "there's a wall right behind the hole" reports; it is the
  documented v1 limitation, not a bug.
- The effect compositor treats `objectExit` like the other vector buffers:
  base-view spread, working-grid copy, hard-requirement error — and the
  `SUPPORTED_REQUIREMENTS` allowlist in effectCompositor.ts must include it
  or `assertProgram` throws on mount.

## Step 2 — 3D voices

### Domain

Under `space: "object"` with `objectPosition` available, field-synth
resolves a **3D** coordinate: `(x, y, z) = objectPosition · scale` (matrix
rain's volumetric precedent: `scale` is a 3D field frequency there, not a 2D
UV frequency). Field-synth today never takes a volumetric branch —
`"object"` falls through to the generated-surface path and the program does
not even retain `objectPosition` — so this is additive: a distinct
volumetric branch guarded exactly like matrixRain's
(`params.space === "object" && !!context.base.objectPosition`), with the
existing 2D resolution as the wireframe/voxel fallback.

**The 2D path is a separate branch, not "z = 0 through one formula."** Two
primitives make that distinction load-bearing (below); the rest are
genuinely identical at z = 0.

### Primitives in 3D

`synthOsc` / `evaluateVoices` gain the third coordinate in the volumetric
branch only:

| field | 3D meaning |
|---|---|
| `linearX` / `linearY` | axis projections, as today |
| `linearZ` | **new** — third axis projection (appended to `SYNTH_FIELDS`; see URL codec notes) |
| `diagonal` | `(x + y + z) / √3` **in the volumetric branch only** — the 2D branch keeps today's `(x + y) / √2` untouched (changing it would break every existing diagonal patch, e.g. the Zebra and Lattice presets; the static exporter hardcodes the same constant) |
| `radial` | spherical distance from the voice origin |
| `angular`, `spiral` | unchanged: evaluated in the XY plane, `z` ignored (documented; full 3D orientation is out of scope) |
| `noise` | **4D hash**: `synthNoise4(x·freq, y·freq, z·freq, time·speed)`. The existing `synthNoise3`'s third lattice axis is already the *time* axis in the 2D path (`synthNoise3(x·freq, y·freq, time·speed)`), so a volumetric noise voice needs a fourth axis or it freezes. The 2D call is untouched. |

Voice origins gain a third component `originW1..6` (default 0), used only by
the 3D branch. `angleN` keeps its 2D meaning (rotation about Z in the
sampling frame).

### `duty` and `phase` on voices

- `duty1..6` (default 0.5): the square wave's high fraction —
  `p < duty ? 1 : −1` in `synthWave` (other wave kinds ignore it). Default
  0.5 keeps every existing patch identical.
- `phase1..6` (default 0, in cycles): added to the wave argument for every
  field and wave kind (`synthWave(kind, t + phase)`). Default 0 is
  byte-identical. **This parameter exists because voice origins cannot
  phase-shift linear fields**: `synthOsc`'s axis projections ignore the
  voice origin entirely (`raw = x`, no `− cx`; the origin only affects the
  `angle ≠ 0` rotation pivot and the radial/angular/spiral centers), and
  making them origin-relative would phase-shift every existing linear patch
  through the global origin default. A middle-third selector is then
  `wave: square, duty: ⅓, phase: −⅓` — exact to float precision (1/3 is
  ~ulp-inexact; tests must sample off band boundaries, see Acceptance).
  Schema `min`/`max`/`step` are UI hints, not validation, so preset values
  like `−1/3` are carried at full float precision.

### Subcell modes

`subcellRes: "2x4"` and `"ink"` probe neighbors by finite-differencing
resolved coordinates. In the volumetric **paint** branch the neighbor
coordinate is the neighboring cell's `objectPosition` — same local-affine
approximation the 2D generated-surface path documents, now in 3D. Under
**carve** the subcell modes are rejected (see Carve).

## Step 3 — voice layers

### Model

Opt-in grouping, flat params like everything else in the schema:

- `layer1..6`: integer 1..3 (default 1) — which layer a voice belongs to.
- Per layer L ∈ {1, 2, 3}:
  - `layerCombineL`: intra-layer fold op (default = the patch-level
    `combine`), same voice-order fold and amp-as-mix-weight semantics as
    today.
  - `layerThresholdOnL`: boolean, default false (the param schema has no
    nullable numbers, so "off" is its own flag).
  - `layerThresholdL`: number, range −3..3 (an add-fold of three amp-1
    voices spans ±3; −1..1 could not express e.g. "all three axes mid"),
    default 0. When on, the layer's folded value `v` becomes
    **`v > t ? +1 : −1`** — ±1, *not* {0, 1}: the entire downstream
    bias/gain mapping (`clamp01(bias + gain·v·0.5)`, default bias 0.5) is
    calibrated for ±1 signals, and a {0, 1} indicator can never reach the
    empty end of the ramp at default bias.
  - `layerInvertL`: boolean (default false): unconditional negation, `−v` —
    one rule whether the threshold is on (±1 flips) or off (raw signal
    negates).
  - `layerBlendL`: how the layer's shaped output enters the stack —
    `add | multiply | max | min | difference` (default `multiply`), folded
    in layer order with `layerAmpL` (0..1, default 1) as the mix weight,
    mirroring the voice fold one level up.
- **A layer with no active voices is skipped** in the layer fold, exactly
  as an amp-0 voice is skipped in the voice fold (otherwise an empty layer
  folds to 0 and the default multiply-blend annihilates the stack).

**Backward compatibility is structural:** all voices on layer 1 with
threshold off, invert off, amp 1 is a single-layer stack whose output is
exactly today's flat fold. Existing patches, presets, and URLs are
unchanged without migration.

### argmax and voice colors

- `argmax` stays categorical and single-layer: `validateParams` rejects a
  patch where argmax is **effective** in any layer of a multi-layer stack —
  i.e. where a populated layer's resolved combine (its override, else the
  patch-level default) is argmax. A multi-layer patch whose every populated
  layer overrides to a value op is valid regardless of the patch-level
  `combine` (which is then dead metadata, deliberately not validated).
- `voiceColors` keeps its current definition (contribution-weighted blend
  across all active voices, winner-takes-region under argmax). Layers do
  not get their own color model in this design. Mixing a ±1 thresholded
  layer with a raw ±1 layer under `add`/`difference` is defined but
  range-skews the bias/gain mapping — a docs note, not a prohibition.

### The acceptance pattern: Menger membership (depth ≤ 2)

Unit-domain convention, pinned for the acceptance test: with the field
coordinate normalized so the cube spans one domain unit, base-3 digit k of
an axis is selected by `freq 3^(k−1)` (`scale` maps object-space extents —
which are mesh-authored, possibly ±50-unit cubes — onto that unit domain;
the shipped preset's `scale` is load-bearing, not taste).

Per scale k: three axis voices (`linearX/Y/Z`), `wave: square`,
`freq: 3^(k−1)`, `duty: ⅓`, `phase: −⅓`, amp 1. Waves output ±1, so the
`add` fold gives sum ∈ {−3, −1, +1, +3} and "≥ 2 axes mid" ⇔ sum > 0.
`layerThresholdOn`, threshold 0 → hole = +1, invert → **solid = +1, hole =
−1**. Layers blend with **`min`** (the ±1 AND: solid overall iff every
scale says solid) — not multiply, whose ±1 product is a parity, not a
conjunction. At default bias 0.5 / gain 1 the final mapping sends −1 →
`clamp01(0) = 0` (empty) and +1 → 1 (densest ramp step) with no bespoke
tuning. This exact construction is the required correctness test.

## Carve mode (hollowness)

Field-synth gains a `render` param: `"paint"` (default, today's behavior)
or `"carve"`. Carve requires the volumetric branch (`space: "object"`,
`objectPosition` + `objectExit` present) and `subcellRes: "1x1"`;
`validateParams` rejects carve with `"2x4"`/`"ink"` (their neighbor
finite-difference probes have no defined meaning across cells whose hit
points sit at different march depths or in holes). In wireframe/voxel modes
carve degrades to paint (optional-requirement degradation, as everywhere).

Per covered cell, carve calls the exported `marchField` over the segment
`objectPosition → objectExit` with the compiled field program as its
sampler (the marcher itself knows nothing about voices — see "The field
program IR"):

- **Steps and the Nyquist floor.** `marchSteps` (default 48, max 256) is a
  *minimum*; the implementation raises the per-cell count to
  `ceil(2 · chordLength · f_finest)` (chord in domain units, `f_finest` =
  the highest active `freq` — the sampling floor below which thin solid
  walls are skipped and render as false holes that shimmer under orbit).
  The 256 cap plus depth-2 field content (finest features 1/9 of the
  domain) keeps that floor comfortably reachable; depth-3 content (1/81
  features, ≥ ~281 steps on a cube diagonal) is out of carve's v1 envelope
  — consistent with the voice-count ceiling above.
- **Solid test.** The field value at the sample, through the same
  `clamp01(bias + gain·v·0.5)` mapping the ramp already uses, is solid when
  > 0. No new iso parameter — bias is the level knob, and the ±1 layer
  outputs make the default bias work (see above).
- **Hit emission = paint's emission, at the raw solid sample — not the
  interpolated hit point.** This section originally specified emitting at
  the march's interpolated hit position (parameter `t`, found by a secant
  root between the last non-solid and first solid sample). That is not what
  shipped, and for a reason worth recording: a *hard-thresholded* field —
  every voice/layer boundary in the Menger recipe, or any bare square-wave
  voice — has a plateau at exactly `0` under the ramp's own
  `clamp01(bias + gain·v·0.5)` mapping, and the interpolated position can
  land precisely on that plateau's edge and resample non-solid (the
  "saturation bug": a hit that, when re-evaluated at its own reported
  position, reads as no-hit). The shipped `marchField` result instead
  guarantees `sampleT`/`sampleX`/`sampleY`/`sampleZ` — the raw grid sample
  that actually triggered the hit, always `> 0` by construction — alongside
  the interpolated `t`/`x`/`y`/`z` (kept for a genuinely affine field, where
  the two coincide up to the march step size). Carve emits the paint
  pipeline — same value-scaled coverage, same ramp glyph, same `lit`/shade,
  `voiceColors`, gradient handling — at `sampleX/Y/Z`, and fades color by
  **`exp(−marchFade · sampleDistance)`**, where `sampleDistance` is
  `marchField`'s own `sampleT * chordLength` (so the emission point and the
  falloff distance can never drift apart, which pairing the emission point
  with the *interpolated* `distance` instead would risk whenever the
  crossing isn't already bracket-exact). At `sampleDistance = 0` (the
  entry-already-solid short-circuit) the falloff factor is exactly 1, so a
  carve whose field is solid everywhere is still byte-identical to paint on
  the same scene — the no-op equivalence test is *derivable*, not asserted,
  same as originally designed. The falloff is continuous in `sampleDistance`
  (no "t ≈ 0" epsilon, no seam at hole rims), never reaches 0 (a far-wall
  hit stays distinguishable from a hole), and uses absolute units (two
  adjacent cells with different chord lengths shade the same interior wall
  identically — chord-relative normalization would paint a spurious
  silhouette-tracking gradient). Interior hits carry no shadow-map term —
  the v1 shading contract; gradient-normal Lambert is a possible later
  refinement.
- **Holes.** No solid sample along the chord → the cell **emits nothing**.
  What that renders as is ordinary compositor semantics, stated here
  because it surprises: under `blend: "replace"` at opacity 1 the cell
  composes to coverage 0 — space, no color, page background (the intended
  carve look). Under `blend: "over"` (the runtime default when `blend` is
  omitted — the definition's `defaultBlend: "replace"` is UI metadata the
  runtime never reads) the base surface shows through and holes visibly
  don't carve; under replace with opacity < 1 the base Bayer-dithers back
  into the holes. All three are *defined*; docs and the /synth page steer
  carve to `replace` at opacity 1.

**Frame budget.** Effects recompose every animated frame over all covered
cells: a half-covered 120×48 grid at 48 steps × 6 voices is ~1.7M `synthOsc`
calls per frame per layer. Carve is the most expensive thing field-synth
will do; it benefits directly from `interactiveDownscale`, and the
implementation PR must include a measurement justifying the default
`marchSteps` and documenting a recommended grid budget.

## Static export

`buildGlyphFieldSynthStaticExport` (packages/effects/src/staticExport.ts):

- **Layers, duty, phase, per-voice angle/origin (2D)**: supported — the
  inlined hand-written evaluator ports the field-program IR
  (`evalProgram`/`foldVoices`/`sampleVoice`, a faithful hand port of
  `evaluateFieldProgram`/`foldVoices`/`sampleFieldVoice`'s 2D branch).
- **`subcellRes: "2x4"`/`"ink"`**: supported — the braille dot mask and ink
  contour crossing test are ported too (`BRAILLE_DOT_BITS`/`inkGlyphForField`,
  reused verbatim from stock.ts, not re-derived). The per-cell coordinate
  GRADIENT they both need (`fieldSynthSubcellGradient`'s neighbor finite
  difference) is exact when the affine-fit formula is in use (a truly affine
  coordinate's gradient IS the fit's own slope, `(ax, bx)`/`(ay, by)` — no
  separate data), and a full-precision per-cell table otherwise.
- **Volumetric (3D branch) and carve**: **rejected explicitly** with a
  clear error (the compositor's existing explicit-reject precedent). Baking
  a march per cell per frame is a different export design; do not fake it.
- **Affine-fit safety is behavioral, not residual-only.** The fit's own
  least-squares solve leaves small (~1e-8, Cramer's-rule cancellation, not
  real curvature) numerical noise even on an EXACTLY affine surface — too
  small to matter almost everywhere, but `Math.floor` (every duty/threshold
  discontinuity) has no continuity guarantee AT an exact boundary, and a
  symmetric setup naturally puts several cells exactly on one. No
  position-residual bound, however tight, can rule that out without also
  rejecting fits that carry zero actual risk. `affineDecisionsMatch`
  (staticExport.ts) instead substitutes the affine reconstruction for the
  true per-cell coordinate at every baked cell and re-runs the REAL
  `evaluateFieldProgram` (and, for `subcellRes: "2x4"`/`"ink"`, the real
  dot-mask/crossing-test math) through both — rejecting the fit only when a
  cell's actual RAMP INDEX, argmax WINNER, dot MASK, or ink CROSSING+BUCKET
  disagrees. Every value that can feed such a decision (the coordinate
  table, the gradient table, and the `cx`/`cy` field-recentering origins
  radial/angular/spiral fields read) is baked at full float64 precision when
  it isn't hoisted to the exact affine formula — an earlier 3-to-6-decimal
  rounding step reintroduced the same class of divergence via its own
  quantization, independent of the affine fit.

## /synth page and the URL codec

The packed URL codec is the gating constraint, not the UI:

- `encodeEffectParamsPacked` keys params by **positional index encoded as a
  single base62 character**. `fieldSynthSchema` already has 70 keys, so
  indices 62–69 (`lit`, `voiceColors`, `color1..6`) are **silently dropped
  from URLs today** — a pre-existing bug this work must fix or explicitly
  flag, since every new param would land past the cap. The codec needs a
  multi-char index escape behind a `SYNTH_SCHEMA_VERSION` bump with a
  legacy-decode path for existing URLs.
- Decoding is positional: **new schema keys append after all existing
  keys**, and new enum values (`linearZ` in `SYNTH_FIELDS`, `"carve"`, new
  blend values) **append to their `values` arrays** — inserting reorders
  and corrupts every previously shared URL.
- `soloParams` (per-voice preview isolation) must copy the new per-voice
  params (`duty`, `phase`, `originW`, `layer`) or voice previews lie.
- UI scope: layer cards (voice→layer assignment, per-layer
  combine/threshold/invert/blend/amp), duty + phase knobs, W origin, render
  mode + march controls.

## Cross-package checklist (same-PR obligations)

- `packages/glyphcss`: requirement enum + `GlyphEffectFrameView.objectExit`;
  `SUPPORTED_REQUIREMENTS` allowlist and the `effectRequests` union;
  `dynamicRequirements` protocol hook; winner-mesh retention in visible
  mode (polygon→mesh map); the farthest-depth clipping-aware exit
  rasterizer + `downsampleSolid` plumbing; `CellGrid` /
  `buildCellGrid` / `cloneCellGrid`; `rasterizeToCells` capture args;
  compositor pass-through + working-grid copy + hard-requirement error.
- `packages/effects`: the field-program IR types + params→IR compile +
  exported `evaluateFieldProgram` / `marchField`; schema (duty, phase,
  originW, layer params, render/marchSteps/marchFade),
  `synthWave`/`synthOsc` 3D, `synthNoise4`, volumetric branch, carve (as a
  `marchField` caller), static-export port consuming the IR + explicit
  rejects, presets (at least one volumetric preset and one layered preset;
  the depth-2 Menger patch ships as a preset).
- `website` `/synth`: codec versioning + append-only ordering, layer cards,
  new knobs, `soloParams`.
- React/Vue: no component API change — effect params are data through the
  existing `GlyphEffectLayer` mirrors; confirm the new types re-export.
- Docs: website effects page + AGENTS.md effect section updated in the same
  PR (this file prunes to "implemented" status then).
- Renderer-interaction notes to document (verified current behavior, all
  benign but worth stating): mounting any effect layer already forces
  `charMode` halfblock/quadrant off, so no new no-op rule is needed;
  `temporalBlend` runs before effects, so carve composites over TAA-blended
  cells and TAA history records the un-carved base; `solidWeightRamp`'s
  weight buffer flows through the effect grid unchanged.

## Acceptance criteria

1. All existing field-synth tests and presets byte-identical at defaults
   (2D branch untouched; duty 0.5, phase 0, single layer, paint; `diagonal`
   and `noise` keep their exact current 2D formulas).
2. Menger membership, two levels:
   - **2a (schema frontend):** the layered patch above, compiled from flat
     params, reproduces a reference `mengerSolid(x, y, z, depth)` on a
     sampled 3D grid, **depths 1–2**, with samples placed off the
     third-boundaries (1/3 is float-inexact; sample at cell centers offset
     from band edges).
   - **2b (IR, the seam proof):** a hand-built nine-voice / three-layer
     field program passed directly to `evaluateFieldProgram` reproduces
     **depth 3** on the same grid — demonstrating the evaluator is
     uncapped and the schema is only a frontend.
3. `objectExit` correctness on a unit cube, ortho and perspective. The
   camera surface has no unproject, so the perspective expectation is
   invariant-based: entry and exit both lie on the box surface (within
   tolerance), exit is no nearer than entry, both project into the cell;
   ortho can additionally compare analytic ray–box chords. NaN in uncovered
   cells; buffer absent (and exit sweep skipped) when no mounted layer's
   `dynamicRequirements` asks for it.
4. Carve no-op equivalence: carve with an everywhere-solid field is
   byte-identical to paint on the same scene (derivable from the shared
   `sampleDistance = 0` emission path; `marchFade` any value).
5. Carve smoke: cube + depth-2 Menger patch under `blend: "replace"`,
   opacity 1, produces empty cells at hole centers and non-empty
   interior-wall cells inside hole apertures.
6. Static export: layered/duty/phase 2D patches, and `subcellRes:
   "2x4"`/`"ink"` patches, export and match the runtime render exactly (an
   end-to-end oracle via the real `createGlyphScene` renderer, not a second
   compositor implementation); volumetric/carve patches reject with the
   documented error.
7. /synth URL round-trip: a patch touching every new param encodes and
   decodes losslessly; a pre-bump legacy URL still decodes to its original
   params.
8. `pnpm test && pnpm build` green.

## Spectral track (deferred; seams reserved)

The longer arc this design stays compatible with — shapes as first-class
oscillator programs — is deliberately not built here. What it would add,
and the seam each piece lands on:

| Spectral-track piece | Reserved seam in this design |
|---|---|
| Unbounded sparse term programs (thousands of coefficients) | field-program IR is length-free; only the params frontend is capped |
| Analysis mode (mesh → SDF → FFT → ranked terms) | produces an IR directly; consumes `evaluateFieldProgram` unchanged |
| `planeWave [kx, ky, kz]` / wavelet-style localized terms | append-only `SYNTH_FIELDS` basis kinds; IR voice record is extensible |
| Field-authoritative geometry (no host mesh; silhouette from the field) | `marchField(entry, exit, sampler)` accepts a bounding-volume segment as readily as rasterized entry/exit |
| LOD as bandwidth / term-count truncation | operates on the IR (sort/slice terms) before evaluation; no evaluator change |
| Program-as-data authoring (not URL params) | the `sceneManifest`/`solidWeightRamp` "JS property, not attribute" precedent; the IR *is* the data format |

None of these are promised; the table exists so implementation choices made
now don't have to be unwound to reach them.

## Out of scope (explicit)

- Everything in the spectral-track table above.
- SDF voice primitives (menger/gyroid as single voices) — the efficient
  depth ≥ 3 path; extension point.
- Raising `SYNTH_VOICES` above 6 in the flat-params frontend.
- Revealing non-host or cross-`<pre>` geometry through carved holes (needs
  depth peeling / a second non-host pass).
- Full 3D voice orientation (`angleN` beyond rotation about Z), 3D
  `angular`/`spiral`.
- argmax across multiple layers; per-layer color models.
- Gradient-normal Lambert and shadow terms for interior march hits.
- Concave-mesh exact chords (per-cell hit lists).

## Advisory findings recorded, not folded into this design

Pre-existing defect surfaced by the review, filed and fixed as part of this
work rather than separately: the /synth URL codec silently dropped schema
indices ≥ 62 (`lit`, `voiceColors`, `color1..6` never round-tripped) —
`SYNTH_SCHEMA_VERSION` bumped to `"2"` with a multi-char index escape and a
legacy ("1"-tagged) decode path for pre-bump URLs (`synthUrlState.ts`).
