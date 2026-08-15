# Volumetric field synth, slice 2 — design

Status: **implemented** (commits 2ba9b96..0fbe36c; revised once during
implementation after a two-reviewer adversarial pass — Opus on math/design,
Codex on implementer completeness; both sets of findings folded in, plus a
handful of user-directed additions during the /synth restructure recorded in
§4). Addendum to `VOLUMETRIC.md` (implemented, fe05add..6817e58), whose
contracts stayed authoritative throughout: the field program IR, the carve
march (`objectPosition → objectExit`, raw-sample emission, `sampleDistance`
falloff), append-only schema/enum ordering, the versioned /synth URL codec,
and the acceptance discipline. See "Reconciliation" at the end of this file
for the handful of places shipped behavior sharpened or corrected the design
text below; the design sections themselves are left as the record of intent
and rationale, not rewritten to match after the fact.

Four additions, all through slice-1's reserved seams:

1. **March view modes** — `xray` (transmittance) and an object-anchored
   `slab` clip: the *meat* of a volume becomes visible, not just its
   first solid hit.
2. **SDF voice family** — `gyroid`, `menger`, `sierpinski` field
   primitives plus a non-periodic `step` wave.
3. **Stage + presets** — a `pyramid` (uncentered corner-tetra) stage, a
   recipe-based Sierpinski preset, per-preset stage hints (fixes the
   "menger invisible at the oblique camera" backlog item).
4. **/synth restructure** — Photoshop-style layer groups in the voice
   sidebar, the 2D/3D ModeToggle **removed** (Mapping is the single
   control; user decision), and the URL hydration validity gate.

Recorded correction to the *slice-1 discussion* (not to VOLUMETRIC.md,
which never claimed it): the working assumption during design talk was
that a Sierpinski tetra needs an SDF primitive. False for the
**corner-tetra** variant: its rule — "solid ⇔ at every binary scale, at
most one axis is in its upper half" — is per scale three duty-½ squares
phase-shifted to upper halves, `add` fold, threshold 0 (sum ∈
{−3,−1,+1,+3}; ≥2 upper ⇔ > 0), invert, `min` blend: the menger recipe's
base-2 sibling. Reviewer-verified numerically: exact membership at depths
1–3, all constants binary-exact (no off-boundary sampling caveat needed),
IFS = the four maps `p ↦ p/2 + v/2`, `v ∈ {0, e₁, e₂, e₃}`, attractor
dimension log4/log2 = 2. The recipe's phases assume the domain window
`[0,1]³` — alignment is a *stage authoring* contract, see §3. The SDF
family is for deep recursion and non-affine fields, not a gatekeeper.

## 1. March view modes

### The integrator (new public function)

`marchField` returns a first hit and cannot express an integral; xray
gets a sibling, exported as **`integrateGlyphField(entry, exit, sampler,
opts) → { sum, steps, chordLength }`** — sampler-agnostic exactly like
the marcher. Both consume a shared, exported step helper
**`glyphFieldStepCount(chordLength, opts)`** (the existing private
floor: `max(minSteps, min(cap, ceil(2·chordLength·finestFreq)))`) so
carve and xray can never disagree about resolution. Quadrature is
**midpoint**: `steps` samples at `t_i = (i + ½)/steps · chordLength`,
`Δt = chordLength / steps`, `sum = Σ sampler(p(t_i))·Δt` — no endpoint
double-counting. Non-finite samples contribute 0.

**Uniform step count per evaluate:** carve tolerates per-cell `ceil`
flips (the error is a sub-step hit-position shift), but an integral does
not — a ±2-step difference between neighboring cells measured ±20%
relative brightness speckle. xray therefore computes ONE step count per
evaluate pass from the **maximum chord** over covered cells and uses it
for every cell. Carve keeps its per-cell count (unchanged,
byte-identity).

### `render: "xray"` (appended to the `render` enum)

Per covered cell with a finite chord: density per sample
`d = clamp01(bias + gain·v·0.5)` (paint's own mapping, already
continuous), transmittance `T = exp(−xrayGain · ∫ d dt)` with the
integral in absolute domain units, brightness `B = 1 − T`.

- **`xrayGain`** is its OWN param (appended; default 4, min 0, max 16) —
  NOT `marchFade`. Two confirmed reasons: at `marchFade`'s default 1 a
  fully solid unit chord only reaches B ≈ 0.63 and typical preset
  domains (span ~1) never saturate — the whole image dithers; and the
  same knob would mean opposite things (`0` = no fade in carve, invisible
  in xray).
- **Output mapping**: B drives the ramp glyph and the value-gradient
  color; **coverage is 1** for any cell with `B ≥ 1/255`, else the cell
  emits nothing (the `subcellRes: "ink"` full-coverage precedent —
  fractional-coverage dither would drown the transmittance look).
  `lit` modulates via the cell's surface shade as in paint. `voiceColors`
  is inert under xray and its toggle is **hidden** in the UI (the
  duty-only-for-square precedent), documented no-op in the schema.
- **Degenerate chord** (no finite exit / zero length): xray emits
  nothing — B of a zero-length chord is 0. This deliberately differs
  from carve's paint-at-entry fallback: a full-strength rim ring around
  a transmittance volume would contradict the mode; stated here so the
  divergence is a decision, not an accident.
- Validation mirrors carve: requires `space: "object"`, rejects
  `subcellRes: "2x4"/"ink"`, degrades to paint in wireframe/voxel.
  `dynamicRequirements` returns `objectExit` when render is carve OR
  xray. Cost note in docs: xray always runs its full uniform step count.
- **Absorption xray reads near-binary fields.** A zero-mean oscillating
  field integrates to ~`bias` per unit length — structure averages away
  into fog (reviewer-measured on the gyroid: within 0.01–0.1 of a pure
  fog reference). Ship guidance + presets accordingly (§3); a MIP
  (max-density) accumulation mode is a recorded future option, out of
  scope here.

### Slab clip (orthogonal; carve and xray)

Appended params: `slabAxis` (`"none" | "x" | "y" | "z"`, default
`"none"`), `slabStart` (default −1), `slabEnd` (default 1), range −8..8,
in **domain units** (the post-`scale` space the field lives in — the
natural per-cell object extents visible to the effect are view-dependent,
so anchoring to them would make the slab drift under orbit; domain units
are stable and match `freq`). Slab axes are domain axes, i.e.
pre-voice-`angle` — stated so a rotated voice's pattern doesn't move the
slab. Docs note: the slab plane moves if `scale` changes, like
everything else in domain units.

Semantics — **clip the segment, then march**: the entry→exit segment is
clipped to the axis interval analytically (axis-aligned, exact) before
step-count computation and marching, so a narrow slab gets the full step
budget inside the slab (sample-rejection would skip thin walls exactly
where the user is looking). When the chord is entirely inside the slab
the clip is skipped — full-open remains byte-identical to
`slabAxis: "none"`. Carve's fade distance stays measured from the TRUE
(pre-clip) entry, so a cut face renders with its real depth fade. The
interval is `slabStart < slabEnd`; **`slabStart ≥ slabEnd` is empty**
(the only full-open representation is `"none"`; UI enforces
start < end, decode does not reject — an inverted interval just renders
empty). The **degenerate-chord fallbacks apply the slab test too**: carve's
paint-at-entry only fires if the entry point lies inside the slab; xray's
degenerate case is already empty.

Slab under `render: "paint"` is a documented no-op and the slab controls
are hidden unless `render ∈ {carve, xray}`. A view-space depth-slab and
multiple simultaneous slabs are out of scope.

## 2. SDF voice family

### Contract (the two P0s, resolved)

SDF fields take a dedicated branch in `sampleFieldVoice`, like `noise`:

- Translation: SDF fields **read the voice origin** (`originU/V/W`) as a
  pre-evaluation translation — explicitly the OPPOSITE of linear fields
  (which ignore origins); without it an SDF voice cannot be aligned to
  its host mesh, and `phase` is not a substitute (see below).
- Evaluation: `raw = −sdf(q · freq)` where `q` = the (angle-rotated,
  origin-translated) domain point — **positive inside the solid**; `freq`
  is the lattice scale, applied ONCE here.
- Wave: `t = raw − time·speed + phase` — **no second `·freq`**. The
  shipped projection contract is `t = raw·freq − …`; SDF fields must NOT
  reuse that line (freq would apply twice, shells at freq² density). The
  implementation and the static-export port both branch.
- `phase` for an SDF is therefore an **iso-level offset** — it erodes or
  dilates the solid (`step` solid ⇔ `sdf < phase` after signs), never a
  translation. Documented on the knob.

### `step` wave (appended to `SYNTH_WAVES`)

**`+1` when `t ≥ 0`, else `−1`** — non-periodic. Worked composition,
because every SDF preset depends on this one line: inside the solid
`sdf < 0` → `raw > 0` → `t > 0` → `step = +1` → `d > 0.5` at default
bias → solid. Duty ignored (the UI already gates the duty knob on
`wave === "square"`, so `step` needs no new hiding rule). Legal on every
field — a `linearX` step is a half-space. The /synth wave trendline
(`buildWavePathD`) must use a symmetric sweep window for non-periodic
waves, or a step voice previews as a constant line.

### The fields (appended to `SYNTH_FIELDS`, order: `gyroid`, `menger`, `sierpinski`)

- `gyroid`: **2π-normalized** —
  `sin(2πx)cos(2πy) + sin(2πy)cos(2πz) + sin(2πz)cos(2πx)` evaluated on
  `q·freq`, so `freq` means cycles-per-domain-unit like every other
  voice, and the effective finest frequency `freq·2` is actually true.
  (No iterations; it's directly a smooth implicit, used as `raw`
  without the −sdf negation question — its sign convention is
  "positive = one labyrinth half", documented.)
- `menger`, `sierpinski`: **signed distance to the depth-`iter`
  approximation** — the union of solid boxes (menger) / corner tetras
  (sierpinski) at iteration `iter`, NOT a limit-set distance estimator
  (the limit sets have measure zero: a true limit SDF is positive almost
  everywhere and carves to nothing; classic fold estimators are unsigned
  Lipschitz bounds with unevenly spaced `sin` shells). Cell convention:
  the unit cell is `[0,1]³`, matching the recipes and the pyramid stage.
  Exact formulas are pinned by the acceptance sign-agreement tests.
  Shipped as `fractalUnionSdf`: a pruned recursive descent of the same
  kept-child tree the digit-rule membership test walks, computing the
  EXACT distance to the union of depth-`iter` leaf boxes (`min` over
  leaves is an exact identity for a union of boxes, not a bound) rather
  than an analytic max-fold. An earlier implementation (Quilez's
  cross-subtraction Menger construction and its base-2 Sierpinski
  adaptation) was cheap but not a genuine Euclidean SDF to the finite
  union this spec requires — replaced during implementation once that
  gap was measured (see `fieldProgram.ts`'s header comment for the
  numeric counter-examples). A parent box's SDF is a valid lower bound
  for every descendant's, so the descent prunes any child whose bound
  already exceeds the best distance found so far, keeping the `iter ≤ 4`
  cap cheap in practice.
- `iter1..6` (integer 1..**4**, default 3, appended; menger/sierpinski
  only, knob hidden otherwise). Capped at 4 because carve/xray resolution
  caps at 256 steps: menger iter 4 needs ~162 steps on a unit chord and
  fits; iter 5 needs ~486 and would render guaranteed false holes.
- Effective finest frequency per voice (consumed by the shared step
  floor): `freq·3^iter` (menger), `freq·2^iter` (sierpinski), `freq·2`
  (gyroid), `freq` otherwise.
- 2D domain: evaluated at `z = 0` (a slice), documented. The static
  exporter ports all three fields and `step` through its IR runtime (2D
  parity via the existing real-renderer oracle; `affineDecisionsMatch`
  already handles discontinuities behaviorally — no new reject class).
- AGENTS.md's sentence "every voice except `noise` is a 1D wave sampled
  along a scalar projection … terrain is always ruled or revolved" stops
  being true with this family; the docs finale must rewrite that
  invariant (and the stale field list that still omits `linearZ`).

## 3. Stage, presets, presentation hints

- **`pyramid` stage** (appended to both shape enum lists — the website
  duplicates the array; the URL codec encodes shape by index): the
  **uncentered corner tetra**, object-space vertices exactly
  `(0,0,0), (s,0,0), (0,s,0), (0,0,s)` — NOT recentered. This is a
  binding contract, not cosmetics: the Sierpinski recipe's uniform
  `phase −½` selectors are only correct on a `[0,1]`-aligned window
  (reviewer-measured: a centered window puts the solid mass in the wrong
  octants, and linear fields cannot be origin-shifted to compensate).
  Presentation (framing/centering) is the camera's job, via the stage
  hints below. `sphere` and `tetrahedron` already exist in the shape
  list — retained, untouched.
- **Sierpinski pyramid preset** (`fieldSynthPresets`): the binary-ladder
  recipe, two scales (6 voices; IR test proves scale 3), duty ½,
  phase −½, freq 1 and 2, `scale = 1/s` pinned to the pyramid's
  authoring size, `render: "carve"`, pyramid stage.
- **Gyroid xray preset**: gyroid voice shaped **near-binary** (threshold
  layer or high `gain`) so absorption reads structure instead of fog
  (§1), `render: "xray"`, cube stage.
- **Per-preset stage hints** (website): ONE consolidated table replacing
  the existing name-keyed `PRESET_DENSITY` map — entries keyed by the
  **imported preset object identity** (Map built from
  `[presetObject, hint]` pairs; a display-name rename can't silently
  drop a hint). Hint shape: `{ shape?, rotX?, rotY?, paused?,
  density? }`; `hint.shape` **overrides** `applyPreset`'s
  space-derived default (otherwise the Sierpinski preset lands on the
  cube). Ships hints for Menger sponge (face-on-ish angle; its baked
  `marchFade` is also raised so the sponge reads unaided), Sierpinski
  pyramid, and Gyroid xray.
- Volumetric solo/preset previews use the CURRENT stage shape (today
  they hardcode a cube — a pyramid-stage voice preview would lie).

## 4. /synth restructure

### Mapping is the single control (ModeToggle removed)

User decision: the 2D/3D toggle duplicates the Mapping dropdown —
`space` IS the semantic switch and both paths already funnel through
`resolveSpaceChange`. Remove the toggle component; keep the shared
guard: entering `object` from the flat plane syncs the stage to a
volumetric shape, leaving `object` restores `render: "paint"` (and now
also `render: "xray"` → paint). The Volume folder keys off
`space === "object"` as today; march/slab controls hide unless
`render ∈ {carve, xray}`.

User-directed additions during this phase, beyond the toggle removal
itself: a camera **auto-orbit** toggle in the Stage folder (independent of
the existing mesh-spin `paused`/`speed` controls — orbit drifts the
camera's `rotX`/`rotY`, hidden on the flat plane, which has no drag-orbit
either), and making voice-card previews **static until hovered**
(`hoverToAnimate`) rather than always animating, so a dense sidebar of
preset/voice previews doesn't burn a `requestAnimationFrame` per card.
Neither was in the original phase plan above; both are recorded here as
shipped scope.

### Layer groups (a rewrite, not a relocation — stated honestly)

The current layer controls are lil-gui folders in the right dock
(`LayerSection`); the voice sidebar is React. This work REPLACES the
dock folders with a new React **`LayerGroup`** component in the voice
sidebar: collapsible group per populated layer, header = intra-layer
combine dropdown (`layerCombineL`), blend-mode dropdown (`layerBlendL`),
**mix** slider (`layerAmpL` — same label as voice mix on purpose: group
opacity vs element opacity), threshold toggle + value, invert; voice
cards nest inside their group. (Corrected during implementation: an
earlier draft of this header list omitted `layerCombineL` — without it a
layer's own fold override has no control surface at all. It ships in the
header alongside `layerBlendL`.) The per-voice 1/2/3 buttons remain the
move mechanism (no drag-reorder). An **Add** affordance inside a group
creates a voice assigned to THAT layer (the current global Add creates
layer-1 voices and remains for layer 1 / empty state). The dock's Layers
folder and its hooks are **removed** — one source of truth. Engine and
URL codec untouched; an old URL with layer params must produce the
identical patch and rendered output, with the controls now living in
groups.

### URL hydration validity gate (precise rule)

`validateParams` throws opaque errors; "reset the offending key" is not
derivable from the exception. The gate is a **two-tier repair**, applied
after decode (v1-legacy and v2 paths both) and after the existing
carve/space coercion (which extends to xray: `render ∈ {carve, xray}`
with `space !== "object"` coerces to paint):

1. An ordered repair table of `[predicate → keys reset to schema
   default]`: empty `glyphs` → `glyphs`; `scale ≤ 0` → `scale`;
   multi-layer effective argmax → `combine`; carve/xray +
   `"2x4"`/`"ink"` → `subcellRes`. Apply matching rows, re-validate.
2. If validation STILL throws (a future rule with no table row), reset
   the entire effect-param object to the schema defaults while
   preserving valid non-effect URL state (shape, density, lighting,
   camera). Never a blank island.

Completeness is enforced by a stronger mechanism than a hand-counted
table-row test: every `validateParams` throw site tags its error with a
rule id from an exported array, `GLYPH_FIELD_SYNTH_VALIDATION_RULES`
(`@glyphcss/effects`) — the website test asserts every id in that array
has a repair-table row or explicit coercion entry, so a validator added
in the package without a matching website entry fails a real
cross-package test instead of a table silently rotting out of sync with
hand-mirrored throw sites. Out-of-enum strings don't throw today (they
fall through to defaults downstream) — the gate targets throw sites, not
a general schema audit.

## Phases

1. **Integrator + march modes** (effects): `integrateGlyphField` +
   `glyphFieldStepCount` exports, xray render (+`xrayGain`), slab
   clip-then-march, validation, dynamicRequirements, degenerate-chord
   rules; exporter rejects `render !== "paint"` (naming xray) and an
   active slab, checks ordered before the space reject so errors name
   the feature; UI predicate copy updated. Tests: acceptance 1–3.
2. **SDF family** (effects + exporter): branch contract, fields, `step`
   wave, `iter`, origin translation, finest-frequency wiring, exporter
   port + parity, trendline sweep fix. Tests: acceptance 5–6.
3. **Stage + presets** (effects presets + website): pyramid stage
   (corner form), Sierpinski + Gyroid presets, consolidated
   object-keyed hint table (absorbing PRESET_DENSITY), Menger retrofit,
   preview stage-shape fix. Tests: acceptance 4, 7 (stage/preset).
4. **/synth restructure** (website): ModeToggle removal, LayerGroup
   rewrite + dock removal, URL gate + coercion extension. Tests:
   acceptance 7 (UI/URL).
5. Docs finale (AGENTS.md incl. the broken invariant sentence,
   effects.mdx, this file → implemented) + final gate on the slice
   diff.

## Acceptance criteria

1. Byte-identity: all slice-1 hash suites pass untouched at defaults
   (`render: "paint"`, `slabAxis: "none"`, no SDF fields, no `step`).
   Carve's per-cell step behavior unchanged.
2. xray: a `d ≡ 0` patch (bias/gain chosen so the mapping clamps to 0)
   emits no cells; monotonicity — adding solid material along a chord
   never decreases B; `xrayGain: 0` → fully transparent; hit-set
   equality — given `xrayGain·minChord ≫ 1`, the set of cells with
   xray output equals carve's hit set on the same scene; degenerate
   chords emit nothing; neighboring same-chord cells produce identical
   B (uniform step count pinned).
3. slab: full-open byte-identical to `"none"`; `start ≥ end` → empty;
   cutaway membership — per-cell assertions against the
   first-principles reference for a mid-hole slab of the depth-2 menger
   cube (membership-based, not visual-planarity, so the camera angle
   doesn't matter); carve's cut face uses the true-entry fade;
   degenerate-fallback cells respect the slab.
4. Sierpinski: recipe vs corner-tetra reference at scales 1–2 (flat
   params) and 3 (IR); **stage alignment** — on the pyramid stage,
   solid cells lie inside the tetra's own octant structure (the
   centered-window failure mode is the pinned counter-case); carve
   smoke on the pyramid stage.
5. SDF: `menger`(iter 2) and `sierpinski`(iter 2) sign agreement with
   the depth-2 recipe references on a sampled grid away from band
   boundaries; gyroid 2π-periodicity pinned; `step` unit tests
   (threshold at 0, phase shifts it, duty ignored); SDF origin
   translation moves the fractal, phase erodes/dilates it (both
   asserted); single-freq application (a shells patch at freq f has
   period 1 in raw, not 1/f — the freq² regression is the pinned
   counter-case).
6. Static export: 2D patches with new fields/`step` export with
   real-renderer exact parity; xray and active-slab patches reject with
   errors naming the feature; all shipped presets export or are
   predicate-gated in the UI as today.
7. /synth: old layer-param URLs → identical patch + identical render,
   controls in groups, dock folder gone; Mapping-only control flow
   (toggle absent, `resolveSpaceChange` guards both directions incl.
   xray); pyramid stage renders; presets apply object-keyed hints
   (rename-a-preset test proves the binding survives); the crafted
   `carve+2x4` and multi-layer-argmax URLs hydrate to a working page,
   legit volumetric URLs untouched; the repair-table completeness test.
8. `pnpm test && pnpm build` green.

## Out of scope

- View-space depth-slab; multiple slabs; MIP/max-density xray;
  per-voice color accumulation under xray.
- Drag-to-reorder; >3 schema layers; `iter` > 4.
- Equilateral-tetra shear authoring (affine display is enough).
- Everything in VOLUMETRIC.md's spectral-track table.
