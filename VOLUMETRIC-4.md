# Volumetric field synth, slice 4 — design

Status: **proposed** (revised once after the two-reviewer adversarial pass —
Opus on math/semantics with executed probes, Codex on implementer
completeness; all P0/P1 findings folded in); see "Reconciliation" at the end
of this file for what shipped differently. `VOLUMETRIC.md`, `-2`, `-3`
(all implemented) stay authoritative for what they cover. Two additions:

1. **Colour voice stack** — a second, independent voice program that drives
   COLOUR, decoupled from the geometry stack that drives occupancy; plus
   normal-derived field sources, which make iridescence / fresnel / rim
   lighting ordinary patches instead of bespoke effects.
2. **Adaptive sampling** — march a coarse subset of cells and interpolate
   the agreeing interiors, refining only where neighbours disagree. Attacks
   the dominant cost (one full ray search per cell) rather than the
   incidental one.

## 1. Colour voice stack

### The split

Today one voice stack answers both questions at once: its scalar picks the
glyph AND (via `color`/`colorB` gradient or `voiceColors`) the colour. You
cannot vary one without the other — a Menger sponge cannot be marbled by an
unrelated field.

```
GEOMETRY STACK   voices → scalar → occupancy (carve/xray) + glyph ramp
COLOUR STACK     voices → scalar → palette → colour only
                 (contributes NOTHING to occupancy or glyph choice)

both evaluated at the SAME point: the hit the geometry stack found
```

Decoupled in definition, coupled in sampling location — the texturing
model.

### Precedence (user-specified)

Three states, with `voiceColors`' own toggle pattern as precedent so both
configurations survive an A/B:

| `colorStack` | Behaviour |
|---|---|
| absent | today exactly — `color`/`colorB` gradient, or `voiceColors` blending. **Byte-identical** (acceptance 1). |
| present, `colorStackOn: false` | same as absent; the stack's params are retained but inert (so you can toggle without losing work) |
| present, `colorStackOn: true` | colour comes from the colour stack. **`voiceColors` is ignored** and its toggle hides. `color`/`colorB` are NOT hidden — they are **repurposed** as the `"gradient"` colorMode's endpoints and stay visible under that mode (hidden only under `"hue"`). The stack's scalar replaces `point.value` in the existing `clamp01(v * gradient)` mapping, so `params.gradient` is honoured exactly as today (its schema default is 0 — a stack that ignored it would render differently from the equivalent flat patch at defaults). |

`lit` still applies on top in all three states (surface shading modulates
whatever colour was resolved) — it is a lighting term, not a colour source.

### Schema surface (flat frontend)

- `colorStackOn` (boolean, default false) — the enable toggle.
- **3 colour voices** (not 9 — colour fields need far less structure than
  fractal geometry, and the schema is already ~163 keys): `cfield1..3`,
  `cwave1..3`, `cfreq1..3`, `cspeed1..3`, `camp1..3`, `cphase1..3`,
  `cangle1..3`, `coriginU/V/W1..3`, `cduty1..3`, `citer1..3`, plus
  `colorCombine`. Single layer in v1 — no colour-layer shaping (recorded
  extension point).

  **Frozen tail order** (the schema IS the URL wire format — the slab
  removal is the precedent for what inserting anywhere else costs). The
  current tail is `…layer7-9, color7-9` with `color9` last at index 164
  (165 keys). Append, in exactly this order, all **45** new keys:
  `colorStackOn`, `colorCombine`, `colorMode`, `hueOffset`, `hueRange`,
  `hueSat`, `hueLight`, then the 12 colour-voice families × 3 voices
  (`cfield1..3`, `cwave1..3`, `cfreq1..3`, `cspeed1..3`, `camp1..3`,
  `cphase1..3`, `cangle1..3`, `coriginU1..3`, `coriginV1..3`,
  `coriginW1..3`, `cduty1..3`, `citer1..3`), then `adaptive`,
  `adaptiveTolerance`. New `SYNTH_FIELDS` values append strictly after
  `sierpinski`, in the order `normalX`, `normalY`, `normalZ`, `incidence`.
  The codec's two-char escape addresses 3844 indices, so no version bump.

  **Colour-voice completeness guard**: slice 3 widened the module-load
  guard to 14 geometry families *because a partial block had shipped
  silently*. Add the sibling — `SYNTH_COLOR_VOICES = 3`, a
  `FIELD_SYNTH_COLOR_VOICE_KEY_FAMILIES` list, a second
  `assertFieldSynthVoiceSchemaComplete` call, and the same mutation test.
- **Palette mapping** — the stack's scalar `v ∈ [-1,1]` maps to colour by
  `colorMode`:
  - `"gradient"` (default): reuses `color` → `colorB` exactly as the
    existing value-gradient does, so a colour stack with one linear voice
    reproduces today's look through the new path (a useful equivalence
    test).
  - `"hue"`: cyclic — `hue = (v·0.5 + 0.5 + hueOffset) · hueRange`
    degrees at fixed saturation/lightness params (`hueSat`, `hueLight`).
    This is the iridescence mode: a cyclic palette is what makes a
    normal-driven field read as shifting spectra rather than a two-colour
    ramp.
- Program-as-data (slice 3) gains a NAMED sibling — slice 3's transport is
  a single opaque `program?: unknown` with ONE `validateProgram` hook, so a
  second payload has nowhere to go and no way to identify itself. Add
  explicitly: `colorProgram?: unknown` on the definition-layer options,
  `validateColorProgram?(program)` on the program definition, and
  `context.colorProgram` on the evaluate context — mount-time validation,
  `setOptions` throws on change (mirroring `program`), React/Vue/custom-
  element mirrors in the same phase. Ignored unless `colorStackOn`.
  Footgun to document (inherited from slice 3's `program`): a hand-built
  colour program's origins are NOT `scale`-pre-scaled the way
  `compileFieldVoices(voices, scale)` does it — callers pre-scale.

### Normal-derived field sources (the part that subsumes iridescence)

New field kinds appended to `SYNTH_FIELDS`, **legal in the COLOUR STACK
ONLY** (reviewer-forced: a normal is one value per CELL, not a function of
the domain point, so in the geometry stack it would be constant along the
whole march ray — it could only flip an entire chord solid/empty, never
produce structure, and it would silently corrupt the subcell probes, the
`effectiveVoiceFinestFreq` Nyquist floor, and the IR's documented purity.
`validateParams` rejects them in the geometry stack; geometry-stack normal
fields are a recorded extension point). They are resolved **per cell in
`stock.ts`**, substituted into the colour program's evaluation — never
inside `fieldProgram.ts`, which stays pure spatial math:

- `normalX`, `normalY`, `normalZ` — components of the **object-space** face
  normal. NOTE: the existing `normal` buffer is WORLD space (it is built
  from baked world vertices) while `objectPosition`/`objectExit` are
  pre-transform object space — mixing them makes `n · viewDir` meaningless
  for any rotated mesh, the exact failure `space: "object"` exists to
  prevent. Slice 4 therefore adds an **object-space normal buffer** in the
  rasterizer (one more cross product at the same call site that already
  builds `objectPosition` from `ov0/ov1/ov2`, downsampled from the same
  representative subcell). Under non-uniform scale it is the object-frame
  geometric normal (no inverse-transpose) — the self-consistent pair with
  the object-space ray. The world `normal` buffer is untouched (the
  generated-surface basis needs it).
- `incidence` — `1 − |objectNormal · viewDir|`, 0 face-on, 1 grazing, with
  `viewDir = normalize(objectExit − objectPosition)` **in every render
  mode including paint** (there is no camera position or view ray in the
  effect context, and it cannot be recovered from a single frame's
  buffers). `dynamicRequirements` therefore requests `"objectExit"`
  whenever an `incidence` voice is active, paint included; `incidence`
  degrades to 0 outside `space: "object"` / solid mode.

Semantics and limits, stated because they are the honest weak points:

- **Retention**: `normal` is ALREADY an unconditional `optionalRequirements`
  entry, so it is retained for every solid-mode field-synth layer — no
  gating needed (a reviewer-verified no-op). The real gate is `objectExit`
  for `incidence` (above) and the new object-normal buffer, both requested
  when `colorStackOn` is true (params-only, so the existing
  `dynamicRequirements(params)` hook suffices and never needs to inspect a
  `colorProgram`).
- **Under carve the normal is the ENTRY surface's**, not the hit's:
  interior walls seen through a hole tint like the front face. Documented
  v1 approximation; interior normals from the field gradient (central
  differences near the hit, ~6 extra probes) are the named v2 path, OUT OF
  SCOPE here.
- **In wireframe/voxel** no normal exists → normal fields evaluate to 0
  (documented degradation, never a throw).
- **Silhouette/crease popping**: which subcell wins the representative
  sample can flip frame-to-frame at silhouette and crease cells, so a
  hue-mapped `incidence` can pop there — the same pathology matrix rain's
  `OBJECT_LANE_EDGE_MARGIN` exists for. Documented; a v2 edge fade is the
  recorded mitigation.

### Shipped patch

Two presets, because the honest behaviour differs by stage geometry
(reviewer-computed at the real `/synth` ortho camera: under orthographic
projection every view ray is parallel, so on an axis-aligned mesh like the
sponge `1 − |n·v|` takes exactly THREE values — 0.719 / 0.551 / 0.152 —
i.e. three flat face tones, not a continuous sweep):

- **"Iridescent sponge"** — Menger recipe geometry + one `incidence`
  colour voice, `sin`, `colorMode: "hue"`, slow `cspeed`. On the sponge
  this yields three face tones that CYCLE through the hue wheel over time.
  That is precisely the cssGraphics menger look (its palette was
  face-indexed and advanced with the rotation cycle) — the claim is "we
  reproduce it", NOT "we make it continuous".
- **"Iridescent shell"** — the same colour stack on a SPHERE stage, where
  the normal varies continuously and the mode delivers true continuous
  iridescence. This is the patch that shows what the feature adds beyond
  cssGraphics.

## 2. Adaptive sampling (CARVE ONLY)

### The waste

At density 2.3 the sponge covers ~15,000 cells; each fires an independent
ray and searches (~13 probes) for the surface. Neighbouring cells crossing
the same flat wall find it at nearly identical depths — thousands of full
searches rediscovering one fact. The *resolution* is justified (at depth 3
the finest features span ~7 cells); the *computation* is redundant.

### Design

**Carve only.** Xray has no first hit — it integrates density over the whole
chord and deliberately uses ONE uniform step count across all covered cells
precisely to avoid neighbour-to-neighbour brightness disagreement (~20%
speckle). Hit/no-hit classification, corner depths and depth interpolation
are all undefined there, and an interpolate-vs-march split reintroduces the
speckle class the uniform count exists to kill. `adaptive` is a documented
no-op under `render: "xray"` and `"paint"`; an xray formulation (interpolating
the integral with a *relative* tolerance) is a recorded extension point.

New param `adaptive` (integer stride, default **1 = off**, max 4; appended)
plus `adaptiveTolerance` (domain units, default 0.25; appended).

**Stride clamp (reviewer-forced).** The classifier samples only lattice
corners, so it is a screen-space Nyquist test with no Nyquist bound: any
feature narrower than the lattice spacing can hide entirely between agreeing
corners. Worked numbers: depth-3 features ≈7 cells at density 2.3, but ≈3
cells at density 1 (stride 4 hides them), and `iter: 4` content is 3× finer
still (≈1 cell — stride 2 fails). The effective stride is therefore clamped
from the same quantity the march already computes:

```
effectiveStride = max(1, min(adaptive,
                    floor(1 / (2 · finestFreq · domainUnitsPerCell))))
```

where `domainUnitsPerCell` comes from adjacent lattice samples' own
`objectPosition` difference. This is the literal screen-space twin of
`fieldStepCount`'s Nyquist floor, and it makes the silhouette guarantee true
by construction rather than by fixture.

When the clamped stride `N > 1`, per output grid:

1. **Coarse pass** — fully march the lattice samples: cell CENTRES at
   stride `N`, plus mandatory samples on the last row/column so partial
   edge blocks are always bounded on all four corners. Each retains a
   three-state `state` (`OUT` = uncovered/non-target, `HOLE` = marched and
   missed, `HIT`), its `sampleDistance`, its `winnerMesh`, and its normal —
   the same triple slice 3's carve-ink and braille rules already use.
2. **Classify** — a block is **smooth** iff all four corners are `HIT`
   (three-state: `OUT` ≠ `HOLE`, so an out-of-target corner can never pass
   as "no material"), share the same `winnerMesh`, have normals agreeing
   `dot > 0.9`, AND their depths differ by less than `adaptiveTolerance`.
   The mesh + normal conditions are slice 3's own eligibility rule, adopted
   verbatim: without them two corners on different meshes or different cube
   faces can hit at similar penetration depth and pass, and `sampleDistance`
   is measured from each cell's OWN entry so it is not comparable across a
   crease (slice-3 documented).
3. **Fill** — cells inside a smooth block get **only their hit DEPTH** by
   bilinear interpolation of the corner depths. Everything else — the hit
   point along the cell's own ray, the colour stack, `lit`, and the
   `exp(−marchFade · d)` falloff — is **re-evaluated at that reconstructed
   point**. Corner COLOURS are never interpolated: the falloff is convex,
   so lerping corner colours diverges from applying it at the lerped depth
   (~5% at tolerance 0.25, ~88% at 1.0), and a view/normal-dependent colour
   field cannot be lerped at all. Cost stays a win: one program evaluation
   versus ~13 march probes.
4. **Refine** — cells inside a non-smooth block are **fully marched**,
   exactly as today. Silhouettes, hole rims, and depth jumps
   therefore keep bit-exact treatment; the approximation is confined to
   provably-flat interiors.

Guarantees, and what is deliberately NOT guaranteed:

- Any cell whose lattice neighbourhood contains a hit/no-hit disagreement
  is marched — so **silhouette and hole-rim geometry is never
  interpolated** (the visual property that matters, and the acceptance
  bar).
- Interior depths are approximate within `adaptiveTolerance`, and because
  everything downstream is re-evaluated at the reconstructed point, that
  tolerance is a real bound on the visible result. Output is **not**
  byte-identical to `adaptive: 1` — hence opt-in, off by default
  (acceptance 1 protects every existing patch).
- **Test observability**: the classifier is an exported pure function
  returning the per-block classification, so acceptance can assert the
  dispatch directly instead of inferring it from an image.
- Ink mode's rim/contour rules consume the resulting depth field
  unchanged; because rims are always refined, rim strokes are unaffected.
- Interaction with sphere tracing: orthogonal — coarse cells use whichever
  marcher qualifies today.

### Expected payoff

At stride 2, ~¼ of cells are marched plus refinement. But a Menger sponge is
mostly boundary, so the refine set is large and the coarse+classify passes
are pure overhead — slice 3's sphere-tracing bench promised ≥2×, measured
1.2× naive, and settled at ≥1.5× for exactly this reason. Floor here:
**report the real number; ≥1.5× ships, below that is an impasse** to
surface rather than tune toward. Measured on the Menger SDF preset at
density 2.3, pinned scene, warmup + 5 runs, median.

### Static export (required decision — "ported or explicitly rejected")

The exporter's inlined `sampleVoice` ends `default: raw = hypot(...)` —
**radial**. An unknown field kind is silently rendered as radial, which is
exactly why `linearZ` is already rejected there. Slice 4 must therefore, in
the same PR, reject in BOTH `assertStaticExportSupported` and the mirrored
`glyphFieldSynthStaticExportSupported` predicate (the `/synth` CodePen gate):
the four new field kinds on any active voice, `colorStackOn: true`, and
`colorProgram` at the option boundary beside `program`. `adaptive` needs no
new reject (carve/xray are already rejected) but the doc says so explicitly.
Portable later, not now: a flat 2D paint colour stack using existing
non-normal fields — it needs a second serialized program plus palette
mapping in the inlined runtime.

## Phases

0. **Object-space normal buffer** (packages/glyphcss): the new per-cell
   buffer beside `objectPosition` (same call site, same representative
   subcell), requirement-gated, `CellGrid`/frame-view/clone/capture
   plumbing per slice 1's own checklist. Tests: analytic per-face normals
   on a rotated cube (the frame-mismatch counter-case: a WORLD normal must
   FAIL it).
1. **Normal fields** (effects): `normalX/Y/Z`, `incidence` (colour-stack
   only, geometry-stack rejected), per-cell substitution wrapper leaving
   `fieldProgram.ts` pure, `objectExit` gating, exclusion from
   `effectiveVoiceFinestFreq` (return 0) and from the sphere-trace
   predicate (make the existing accidental rejection deliberate).
   Tests: acceptance 3.
2. **Colour stack** (effects + glyphcss layer option for `colorProgram` +
   mirrors): schema, second program compile, precedence, palette modes,
   `dynamicRequirements`. Tests: acceptance 1, 2.
3. **Adaptive sampling** (effects): coarse/classify/fill/refine, params,
   bench. Tests: acceptance 4.
4. **/synth + presets**: colour-stack UI section with the enable toggle and
   the `voiceColors`-hides rule (`color`/`colorB` stay under `"gradient"`);
   `adaptive` + tolerance controls; both iridescent presets + hints; URL
   codec round-trip for all 45 new keys. **The website hand-mirrors the
   field list in SIX places** — `FIELDS_3D`, `FIELD_ICONS`,
   `FIELD_DESCRIPTIONS`, `FIELD_TOGGLE`/`FIELD_TOGGLE_3D`, `angleApplies`,
   and the per-field oscilloscope trace math — all six need the four new
   kinds, plus an explicit "no preview" state for normal fields (a 2D voice
   preview has no normal to sample). This is the same class as slice 3's
   hardcoded-6 `SynthScope` latent bug.
5. Docs finale (**AGENTS.md same-PR sync**: the `voiceColors` sentence, the
   field-synth/`subcellRes` paragraph, and the `@glyphcss/effects`
   description all change) + final gate.

## Acceptance criteria

1. **Byte-identity**: `colorStackOn: false` (or absent) and `adaptive: 1` →
   every existing hash/preset/acceptance suite passes untouched.
2. **Colour stack**: a one-linear-voice stack in `"gradient"` mode
   reproduces the equivalent non-stack gradient patch's colours exactly
   (with `params.gradient` honoured at its default 0). Decoupling pinned in
   BOTH directions with non-tautological assertions — changing a geometry
   voice's `freq`/`field`/`phase` alters the glyph field but leaves every
   cell's COLOUR byte-identical, and changing a colour voice alters colour
   but leaves every cell's GLYPH byte-identical. (The originally-drafted
   "changing a geometry voice's `color` has no effect" is a tautology:
   `colorN` is only read through `voiceColors`, which the stack forces off,
   so it is dead code by construction.) `voiceColors` inert when the stack
   is on; `colorStackOn` a no-op under xray (in acceptance 1's
   byte-identity set); `colorProgram` renders identically to equivalent
   flat colour params; the colour-voice schema guard's mutation test.
3. **Normal fields**: `normalX/Y/Z` reproduce the analytic normal of a
   known face (cube, all six faces); `incidence` is 0 face-on and →1 at
   grazing (pinned against analytic values on a sphere); degrade to 0 in
   wireframe/voxel without throwing; `dynamicRequirements` requests
   `normal` only when a normal field is active.
4. **Adaptive**: the exported classifier is asserted directly (three-state,
   mesh + normal eligibility, tolerance) AND against a full `adaptive: 1`
   ground-truth march — the classifier agreeing with itself proves nothing
   about whether its corners saw every feature. The silhouette must be
   cell-exact vs `adaptive: 1` in the regimes where the premise BREAKS, not
   just the friendly fixture: depth-3 at density 1, and `iter: 4` — i.e.
   the stride clamp is what is being tested. Interior depth error ≤
   `adaptiveTolerance`. Bench: report the real number; ≥1.5× ships.
5. `pnpm test && pnpm build` green.

## Out of scope

- Colour-stack layers/threshold shaping (single layer in v1).
- Interior normals from the field gradient under carve (the v2 path).
- Adaptive sampling for the subcell modes (ink/braille keep full marching).
- Torus/concave interval marching (still deferred from slice 3).
- Everything in VOLUMETRIC.md's spectral-track table.

## Reconciliation

The handful of places shipped behavior sharpened or corrected the design text
above (design sections are left as the record of intent, not rewritten to
match after the fact):

- **"Iridescent shell" is not actually continuous (§1's "Shipped patch").**
  The design text above claims the sphere stage delivers "true continuous
  iridescence" as opposed to the sponge's three flat face tones. Visual
  review of the shipped patch (real renders, not the design text) found a
  FACETED rainbow instead: glyphcss is a flat-shaded rasterizer —
  `objectNormal` is the constant GEOMETRIC face normal per triangle, not a
  smooth/vertex-interpolated one (AGENTS.md's render-mode table; §1's own
  "Normal-derived field sources" section already documents `objectNormal` as
  a per-cell, not per-domain-point, value) — so `incidence` is genuinely
  piecewise-constant per facet, and the sphere stage's own tessellation
  (`spherePolygons`'s default `subdivisions: 1`, 80 triangles; the `/synth`
  page's `shapePolys` has no knob to raise it — `GlyphGeometryOptions`/
  `resolveGeometry`'s sphere case only forward `center`/`size`/`color`) is
  fully visible as flat rainbow wedges. What "Iridescent shell" actually
  demonstrates over "Iridescent sponge" is a smoother SWEEP across many more,
  smaller facets (80 vs. the cube's 6) — not literal per-pixel continuity.
  The corrected claim: facet count is a direct function of tessellation
  density, and genuine continuity would require smooth (vertex-averaged)
  normals, which the rasterizer does not compute anywhere today. That is the
  recorded extension point, layered on top of the already-out-of-scope
  "Interior normals from the field gradient under carve (the v2 path)" above
  — both are smooth-normal work, neither implemented here.
- **Both iridescent presets' colour params retuned post-ship (§1's "Shipped
  patch").** Visual review also found the two presets reading poorly as
  shipped: the sponge's `hueLight: 55` read as near-black navy/maroon once
  the real per-cell Lambert shade (`lit`, on by default) multiplied it down
  further, and the shell's `hueSat: 90, hueRange: 360` swept the whole hue
  wheel at near-max saturation — a harsh neon rainbow, not believable
  thin-film iridescence. Retuned by measuring the real mounted `/synth`
  stage's rendered output (not by eye): sponge `hueLight: 55 → 75` (average
  rendered lightness 0.325 → 0.443, +36%, three hues still exactly distinct);
  shell `hueSat: 90 → 45, hueRange: 360 → 150` (a muted, under-half-wheel
  shifting band instead of a full-saturation full-spectrum cycle; average
  lightness ~0.48 either way, since HSL lightness doesn't depend on hue or
  saturation). Full reasoning and measurements are recorded beside each
  preset's params in `stock.ts`.
