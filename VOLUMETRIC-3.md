# Volumetric field synth, slice 3 — design

Status: **implemented** (commits `eaf37d2..c12c645`; revised once before
implementation after the two-reviewer adversarial pass — Opus on
math/semantics with executed probes, Codex on implementer completeness; all
P0/P1 findings folded in; see "Reconciliation" below for what shipped
behavior sharpened or corrected during implementation itself). `VOLUMETRIC.md`
and `VOLUMETRIC-2.md` (implemented) stay authoritative for what they cover.
`packages/core`'s dead `project()` (item 5) was deleted in a follow-up commit
outside this range, with a release note in `AGENTS.md`'s `packages/core` row
(no BC shim, per the no-BC-shims rule).

Four additions, ordered by user priority, plus one debt retirement:

1. **Per-object effect targeting** — a layer applies to specific meshes:
   a normal scene plus one weird effect object. The headline.
2. **Volumetric subcell modes** — ink-over-carve (outline sponges) and
   braille-over-carve (8-sub-ray silhouettes).
3. **Sphere tracing for carve** — distance-stepped marching for programs
   that provably ARE distance fields.
4. **Authoring tier** — 9 schema voices; a program builder and
   program-as-data input for unbounded API authoring.
5. Debt: delete `packages/core`'s dead `project()` (`math/projection.ts`)
   — a public export with a DIFFERENT axis convention than the real
   (voxcss-vendored) camera; it misled two reviewers in the pyramid
   incident. Deletion = implementation + public re-export + its dedicated
   tests, in one commit, with a release note (a real published-API break,
   sanctioned by the no-BC-shims rule). `parseGltf`'s local `project` and
   the three-surface cameras' `project()` methods are unrelated.

## 1. Per-object effect targeting

### API

```ts
scene.addEffectLayer({ effect, params,
  target: mesh,          // GlyphMeshHandle
  // or [meshA, meshB]   // several
  // or "surfaces"       // default — scene-wide (today)
  // or "viewport"       // today
});
```

Mesh-handle targets currently reject; this implements them.

- **Normalization at mount**: handle/array targets normalize to a
  canonical immutable mesh-id SET (mesh ids are a module-level monotonic
  counter — no aliasing across scenes, reviewer-verified). `setOptions`
  with an equivalent set is a no-op; with a DIFFERENT mesh set it throws
  (live retargeting out of scope; remove + re-add). The React/Vue
  wrappers already forward `target` and diff by `Object.is` — they must
  diff by canonical set instead, or a fresh `[a, b]` array each render
  triggers a spurious setOptions (reviewer-confirmed). Wrapper changes
  land in the same phase (AGENTS.md same-PR rule), as does updating
  AGENTS.md's "mesh-handle targets … reject explicitly" sentence.

### Semantics — the mechanism is `targetCoverage`, normatively

A targeted layer's per-cell `targetCoverage` is **0 on cells whose
depth-winning mesh is not in the target set**, and the base coverage
otherwise. This single choice makes everything else fall out — and the
obvious alternative (zeroing the program's emission) is WRONG: under
`blend: "replace"` at opacity 1 the compositor computes
`inputWeight = inputCoverage · (1 − opacity·targetCoverage)` from
`targetCoverage`, so emission-zeroing ERASES the base on non-targeted
cells (reviewer-confirmed arithmetic). With `targetCoverage = 0`:
passthrough is exact for every blend/opacity, every stock program already
self-skips (`target.coverage[i] <= 0` guards), and xray's max-chord
uniform-step reduction never sees other meshes' chords.

### Winner-mesh plumbing (the real work — spelled out)

Today `winnerMeshBuf` exists only under `retainObjectExit`, at supersample
resolution, is never downsampled, and never reaches `CellGrid` or retained
frames. Phase 1 adds, mirroring slice 1's own checklist:

- A **`retainWinnerMesh`** raster gate, ORed with `retainObjectExit`'s
  need; `polygonMeshIds` supplied under either gate (base and detail
  paths).
- Downsample: a winner-mesh slot carried through `downsampleSolid` using
  the SAME representative subcell as objectPosition/exit.
- `CellGrid.winnerMesh` + `buildCellGrid`/`cloneCellGrid`/
  `rasterizeToCells` capture + retained-frame pass-through. It is
  compositor-internal — NOT a new `GlyphEffectRequirement`, not exposed
  to programs. **Amended in Phase 2** (the P1 fix below): still never a
  `GlyphEffectRequirement`, but it IS surfaced read-only on
  `GlyphEffectFrameView.winnerMesh` — a volumetric subcell program needs
  exact mesh-boundary equality between neighboring cells (§2's ink/braille
  contour and neighbor-eligibility rules), which `objectPosition`/`normal`
  alone can't express for two coplanar, same-normal meshes.
- `needsInputRaster` treats a newly-mounted mesh-targeted layer as
  needing a full render when the retained frames lack winner data
  (otherwise the layer silently no-ops until the next geometry render —
  slice 1's mount-gap bug, same class).
- Occlusion-blanked cells are already `-1` → non-target → passthrough
  (verified correct as-is). Detail grids already carry a real per-mesh
  id; targeting applies per output grid.
- Non-solid modes: no winner buffer — a mesh-targeted layer is inactive
  (documented degradation, never a throw). Removed mesh → empty set →
  inactive, no error.
- Retention scope: whole-grid buffers in v1 (recorded optimization:
  restrict to targeted meshes later).
- Documented ordering note: a LATER scene-wide layer composites over a
  targeted layer's output — including painting into carve holes. That is
  the global-ordering semantics working as designed; one sentence in the
  docs so it isn't reported as a bug.

### /synth

No page UI this slice (single-mesh stage). API-first; the docs gain a
two-mesh example (cube with a targeted carve layer + plain ground).
Documented: the /synth page rebuilds its scene on shape change, so stage
handles do not survive rebuilds — removed-handle semantics apply.

## 2. Volumetric subcell modes (carve only)

Validation: carve+`ink` and carve+`2x4` become legal; xray keeps rejecting
both. The shared rule id `carve-subcell-unsupported` SPLITS: a new rule id
covers the remaining xray rejection, with matching website repair-table
row and the rule-registry completeness test updated in the same PR
(otherwise a valid carve+ink URL gets "repaired" back to `1x1` —
reviewer-caught).

### Ink-over-carve — contour the march output

Execution model (explicit): the carve evaluate pass allocates
**per-evaluate local buffers** — `hitState` (u8: hit / hole / uncovered /
non-target), `hitDistance` (f32), and the hit's resolved color — fills
them in the existing per-cell march loop, then runs the ink resolve as a
second loop over the same buffers. Plain per-`evaluate()` allocations in
v1 (compositor `scratch` is rejected by design; pooling is a recorded
optimization).

- **Depth definition**: `hitDistance` = the hit's `sampleDistance`
  (absolute domain units along the ray from the TRUE entry). This is
  penetration-depth topography — chosen and documented; its known
  consequence is a contour break across entry-surface creases (a cube
  edge), accepted for v1.
- **Contour spacing is ABSOLUTE**: new param `inkSpacing` (domain units,
  default 0.25, appended) — NOT a fraction of the observed depth range.
  An observed-range normalization would make contours crawl frame-to-
  frame as the range changes under orbit, differ across output grids,
  and degenerate on flat walls (spacing→0 → float noise inks
  everything) — the exact chord-relative mistake slice 1 already ruled
  out one level down. With absolute spacing a flat facing wall is
  unambiguously "rim only". `inkLevels` is a documented no-op under
  carve-ink (2D ink keeps it).
- **Inking rules**: (a) `hitState` flips hit↔(hole|uncovered|non-target|
  different-winner-mesh) between 4-neighbors → rim, always inked;
  (b) a multiple of `inkSpacing` lies between two HIT neighbors' depths
  (same winner mesh, both in-target) → contour; (c) |Δdepth| between two
  such neighbors exceeds `inkSpacing` → interior edge. Contours NEVER
  cross winner-mesh or target boundaries — those are rims.
- **Stroke orientation, two sources**: rim cells (rule a) orient by the
  screen-space gradient of the hit/no-hit COVERAGE mask (a depth
  gradient is undefined against a sentinel neighbor — and the naive
  fallback renders every rim cell as `-`, reviewer-traced); contour/edge
  cells (b, c) orient by the depth gradient. Both quantize to the
  existing exported 4-bucket `inkGlyphForField` set — plain `- \ | /`
  only (the sub-cell row/column variants belong to the geometry ink
  mode, not this path).
- Non-inked cells emit nothing (outline-only). Inked cells: full
  coverage; color = that cell's hit color (rim cells with no hit of
  their own use their nearest inked-hit neighbor's color, else the
  layer's base color).
- Degenerate-chord cells: carve's fallback emits only when the entry is
  solid; silhouette closure comes from rule (a), not the fallback
  (stated correctly this time).

### Braille-over-carve — 8 sub-rays

`subcellRes: "2x4"` under carve marches 8 sub-rays per covered cell.
Sub-ray endpoints interpolate the cell's and neighbors' entry/exit
buffers with STRICT neighbor eligibility (reviewer-caught: a finite
neighbor on a different cube FACE or different MESH interpolates
endpoints off the surface — every visible edge column breaks without
this): a neighbor participates only if entry AND exit are finite, winner
mesh matches, AND the geometric normals agree (dot > 0.9; `normal` is
already an optional requirement). Otherwise: cell-center sub-rays
(fallback). The shared per-cell step count is sized from the MAX sub-ray
chord (xray's own rationale). Dot = sub-ray hit. One color per cell: the
center sub-ray's hit color if it hit, else the first hitting sub-ray's
(scan order), else no emission.

## 3. Sphere tracing for carve

### The oracle (all four reviewer-confirmed corrections baked in)

For qualifying programs, each voice contributes a signed domain-unit
distance with the iso offset folded in:

```
D_i(p) = ( sdf_i( freq_i · R_i(p − o_i) ) − c_i ) / freq_i
         where c_i = phase_i − speed_i · time      (per-frame constant)
program oracle:  D(p) = max_i D_i(p)
```

- **÷ freq_i is load-bearing**: the raw SDF is evaluated on
  freq-scaled coordinates, so its value is in LATTICE units — stepping
  by it overshoots by `freq` (measured 2.9× at freq 3) and tunnels the
  exact thin walls the Nyquist floor exists to protect.
- **max, not min**: the shipped field value is `−sdf` (positive inside),
  so the qualifying `min`-fold on VALUES is an INTERSECTION of solids —
  distance to an intersection is the max of member distances. (Executed
  check: min-of-distances terminates inside the union, hitting where the
  solid test says empty.)
- `invert` on the single layer flips `D`'s sign symmetrically — the
  boundary is unchanged; still distance-true. Allowed.

### Qualifying predicate (conservative, all conditions normative)

Single layer; every ACTIVE voice is `menger` or `sierpinski` (`gyroid`
excluded — implicit, not a distance) with `wave: "step"`, `amp: 1`; fold
= `min`; layer threshold OFF; invert allowed; AND the bias/gain pair is
in the step-selective regime: `bias + gain/2 > 0 && bias − gain/2 ≤ 0`
(outside it the ±1 step field is all-solid or all-empty and the surface
the tracer targets is not the iso the solid test uses — measured regime
table in the review record). Anything else → the fixed-step path,
byte-identical.

### API + termination contract

- `buildGlyphFieldDistanceOracle(program, params, time)` → oracle or
  `null` (not qualifying); public, effects package.
- `marchGlyphFieldSphere(entry, exit, oracle, sampler, opts)` — public
  sibling of the fixed marcher. Contract: entry-inside (`D(entry) ≤ 0`) →
  hit at t = 0; steps by `safety · D` (safety 0.9); on sign change,
  overshoots ε INTO the solid and confirms with the REAL sampler (`> 0`)
  at that sample — emission stays a raw confirmed sample, preserving
  slice-1's plateau discipline. **Stall fallback (amended after Phase 3
  measurement):** naive sphere tracing stalls approaching *off-ray*
  features on dense recursive fractals — measured 17% of fixed-step's
  hits lost to cap exhaustion at iter 3, i.e. visibly worse output. The
  marcher therefore detects a stall (step advance below
  `SPHERE_MARCH_STALL_ADVANCE` for `SPHERE_MARCH_STALL_STEPS` consecutive
  steps, named constants) or step-cap pressure and **falls back to the
  fixed-step march over the REMAINING segment** (same per-cell step
  density the fixed path would use, via the shared step helper) — a
  stalled ray finishes exactly as fixed-step would, so hit-set ⊇ is
  restored by construction, never a miss-by-exhaustion. Pure-miss only
  when the fallback segment also finds nothing.

### Equivalence bar (achievable form — the old "glyph-identical" is not)

Fixed-step hits at raw samples; the tracer converges near the surface —
their `sampleDistance`s legitimately differ by up to one fixed step,
which visibly changes the `marchFade` color (worked example: one step =
7% color scale on the Menger preset). The bar: (a) sphere hit set ⊇
fixed-step hit set — STRICT, restored by the stall fallback (the tracer
may legitimately FIND thin walls fixed steps miss, never lose cells);
(b) identical RAMP GLYPH on shared hit cells; (c) per-cell hit distance
≤ the fixed-step distance and within one fixed step of it; (d) stall/cap
pressure = fixed-step fallback, counted in the test (pure misses only
where the fallback also misses).

### Fixtures + bench

No SDF carve preset exists today (the shipped Menger/Sierpinski presets
are recipe-based and can never qualify) — phase 3 AUTHORS two new
presets, "Menger SDF" and "Sierpinski SDF" (one SDF voice each, carve,
iter 3), which are also the user-facing deep-recursion patches. Bench:
pinned scene (120×48, half covered, Menger SDF iter 3, default params),
5 runs after warmup, median ms/evaluate; acceptance is **≥1.5×** vs
fixed-step with the real number reported (amended: naive tracing
measured 1.2×; the ≥2× floor assumed no stalls — the hybrid's stalled
rays cost sphere-steps-until-stall + fixed-steps-remaining, so the
honest floor is lower; if the hybrid still misses 1.5×, surface it as
an impasse rather than shipping a knob that barely pays).

## 4. Authoring tier

### 9 voices

- `SYNTH_VOICES` 6 → 9; the appended key families, ALL at the schema
  tail: `field/wave/freq/speed/amp/angle/originU/originV/originW/duty/
  phase/iter/layer/color` × {7, 8, 9}. Tail appends are legacy-decoder-
  safe (v1/v2 splice by key NAME — reviewer-verified non-hazard).
- The module-load schema guard currently checks only 7 of the 14
  per-voice families — extend it to EVERY per-voice key family so a
  future voice bump can't ship a partial block.
- The website imports `SYNTH_VOICES` (deleting its independent
  `MAX_VOICES = 6` duplicate); voice Add caps at 9; layers stay 1..3.
- Static-export note: `voiceColorsAll` bakes `SYNTH_VOICES` entries, so
  baked snapshots of `voiceColors` patches change size — re-pin those
  export tests deliberately; RENDER byte-identity holds (amp-0 voices
  skipped in every fold; exporter filters them).

### Finest-frequency fix + depth-3 Menger (reviewer analysis adopted)

`effectiveVoiceFinestFreq` for `square` voices becomes
`freq / min(duty, 1 − duty)` (two samples per narrowest band; identity
convention change at duty ½ from 2·freq·chord's one-sample-per-band —
measured: NO shipped preset's floor binds, so existing renders are
byte-identical; only patches with `chord · f_eff > marchSteps/2` change,
which is the under-sampled class the fix exists for). `step` is
non-periodic (unaffected); sin/triangle/saw keep `freq`.

This makes the depth-3 recipe safe: finest band 1/27 → 94 steps, well
inside the 256 cap. (Slice-1's "depth-3 = 1/81 features ≥ 281 steps"
rationale was wrong by 3× — corrected in place in VOLUMETRIC.md as part
of this slice's docs phase, not in VOLUMETRIC-2's reconciliation, which
never carried this claim.) With 9 voices the **depth-3 Menger
recipe preset ships** — gated on an EMPIRICAL acceptance check (hit-set
equality vs a 256-step ground-truth march on the acceptance scene), not
formula trust: no frequency bound can guarantee thresholded folds don't
produce thinner walls.

### Program builder + program-as-data

- `buildGlyphFieldProgram({ domain, layers: [{ combine?, threshold?,
  invert?, blend?, mix?, voices: [{ field, wave, freq, … }] }] })` —
  public, fills IR defaults (including `sourceIndex`), the pleasant
  `voices: [...]` authoring surface.
- `validateGlyphFieldProgram(program)` — public shape validator (layers/
  voices/origin fields/enum membership); called at mount; the evaluator
  currently dereferences unguarded.
- **Transport is a layer OPTION, not a param** (params are scalar-typed
  and definition layers reject unknown keys — a program cannot ride
  through them): `program?: GlyphFieldProgram` on the definition-layer
  options in **packages/glyphcss**, plumbed onto the evaluate context,
  immutable at mount (`setOptions` rejects changes). This is glyphcss +
  React/Vue/custom-element mirror work — phase 4's scope says so
  explicitly (AGENTS.md same-PR rule).
- When `program` is present: voice/layer params are ignored as field
  definition; `params` still governs space/render/march/output mapping.
  Three reviewer-caught correctness rules: `voiceColors` colors come
  from the PROGRAM's `FieldVoice.color` (not `color1..N`); the
  carve/xray finest-frequency comes from the PROGRAM's voices (not the
  ignored params); the argmax winner color lookup is bounds-checked
  regardless (a `sourceIndex ≥` palette length currently TypeErrors
  inside the render pass).
- Static exporter: rejects `program` at the option level BEFORE the
  flat-param merge/bake, through the existing centralized gate.
- Not URL-persistable; /synth ignores it (API tier), documented.

## Phases

1. **Targeting** (packages/glyphcss + React/Vue wrappers + AGENTS.md
   sentence): retainWinnerMesh plumbing end-to-end, targetCoverage
   filter, mount/normalization/setOptions rules, docs example.
   Acceptance 2.
2. **Volumetric subcell** (effects + website rule-id/repair updates):
   ink post-pass + braille sub-rays, `inkSpacing`, validation split.
   Acceptance 3–4.
3. **Sphere tracing** (effects): oracle builder, sphere marcher,
   predicate, the two SDF presets, equivalence + bench. Acceptance 5.
4. **Authoring** (effects + packages/glyphcss program option + mirrors +
   website): 9 voices, finest-freq fix, depth-3 preset + empirical gate,
   builder/validator/program-as-data, exporter reject. Acceptance 6.
5. **Docs finale + `project()` deletion + final gate.** AGENTS.md,
   effects.mdx, VOLUMETRIC.md depth-3 correction, this file →
   implemented.

## Acceptance criteria

1. Byte-identity: no targeted layer / no volumetric subcell / non-
   qualifying programs / ≤6 voices → all existing hash suites pass
   untouched; the finest-freq change alters no shipped preset's floor
   (assert the floors directly).
2. Targeting (homes: createGlyphScene.effects/objectExit tests + new
   compositor tests): two-mesh scene, carve targeted at the cube — every
   floor-region cell byte-equal to the untargeted render; replace-blend
   at opacity 1 does NOT blank non-targeted cells (the erasure
   counter-case, pinned); first-mount-after-render triggers the full
   raster; wireframe inactivity; removed mesh; detail-grid split;
   React wrapper: same-set re-render is a no-op, different-set throws.
3. Ink-over-carve (stock.test.ts; fixture = the depth-2 Menger cube
   scene already used by the carve acceptance suite, oracle = its
   first-principles membership reference): every rim cell (reference
   hit/no-hit boundary) is inked; interior hit cells away from contour
   multiples are NOT inked; a tilted-plane fixture yields parallel
   contour lines with correct bucket glyphs; rim orientation follows the
   coverage-mask gradient (a vertical silhouette edge yields `|`, the
   all-dashes failure is the pinned counter-case); no contour crosses a
   winner-mesh boundary in a two-mesh fixture.
4. Braille-over-carve: a hole aligned with a sub-ray position registers
   in the dot mask while absent at `1x1` (the resolution win, stated as
   the aligned case); aggregate dot-mask variance vs the 1x1 render on
   the Menger fixture; crease-edge columns (two visible cube faces) show
   no off-surface artifacts (neighbor-eligibility counter-case: with the
   normal-agreement gate disabled the test must FAIL); one color per
   cell.
5. Sphere tracing (fieldProgram.test.ts): predicate accept/reject table
   (incl. the bias/gain regime rows and gyroid exclusion); oracle
   unit-correctness (freq division: distance-per-domain-unit ≈ 1 at
   freqs 1/2/3; intersection semantics: the two-offset-voices
   counter-case from the review); the four-part equivalence bar on both
   new SDF presets; cap-exhaustion; bench ≥2× pinned scene;
   non-qualifying byte-identity.
6. Authoring: 9-voice schema guard covers all 14 families (mutation
   test); URL round-trip incl. voice-9 keys; depth-3 preset passes the
   empirical ground-truth gate; builder-built depth-3 program ==
   hand-built IR acceptance output; program-as-data renders identically
   to the equivalent flat-params patch AND correctly with >6 voices
   (voiceColors + finestFreq from the program — both pinned);
   validator rejects malformed programs; setOptions program change
   throws; exporter rejects with a clear error.
7. `pnpm test && pnpm build` green; `project()` gone (grep-clean) with
   its tests removed and a release note.

## Out of scope

- Live retargeting; per-mesh layer ordering; targeting in the static
  compiler; per-target buffer-retention narrowing.
- Subcell modes under xray; braille multi-color.
- Sphere tracing for xray, gyroid, or non-distance-true programs;
  scratch/pooled buffers for the ink post-pass.
- /synth UI for program-as-data or >9 voices.
- Everything in VOLUMETRIC.md's spectral-track table.

## Reconciliation

The handful of places shipped behavior sharpened or corrected the design
text above (design sections are left as the record of intent, not rewritten
to match after the fact):

- **Winner-mesh frame-view amendment (§1).** The original plumbing plan kept
  `winnerMesh` compositor-internal only — never surfaced to a program. §2's
  ink/braille-over-carve neighbor-eligibility rules needed exact mesh-identity
  equality between two coplanar, same-normal cells, which `objectPosition`/
  `normal` alone can't express; the design was amended in place (§1, "Amended
  in Phase 2") to also surface it read-only on
  `GlyphEffectFrameView.winnerMesh`, populated whenever `objectExit`
  retention is active or a layer is mesh-targeted, still never a
  `GlyphEffectRequirement`. Implementation landed exactly as the amended text
  describes (commit `342f5b1`).
- **Sphere stall-fallback amendment (§3).** The original contract required
  the sphere hit set to be a strict superset of fixed-step's without
  specifying how; naive distance-stepping alone measured only 182/218 (Menger
  SDF) and 127/153 (Sierpinski SDF) of fixed-step's real-rendered hits —
  17% lost to stalling near an off-ray feature and exhausting the step cap.
  §3 was amended to add a stall/step-cap-pressure detector
  (`SPHERE_MARCH_STALL_STEPS` consecutive advances below
  `SPHERE_MARCH_STALL_ADVANCE`, or the last step of the budget) that falls
  back to a fixed-step scan of the remaining segment, restoring the strict
  superset BY CONSTRUCTION (218/218, 153/153 — commit `83c41bc`, following
  the naive version in `fa34e42`).
- **The fallback grid-alignment find (§3).** A subtler bug surfaced while
  building the stall fallback: re-deriving a fresh step count for just the
  REMAINING segment (rather than reusing the full original chord's grid)
  quantizes onto a differently-phased Nyquist grid that can legitimately step
  clean over a thin feature the full-chord grid's own sample offsets would
  have caught — silently reproducing the original miss one layer down. The
  fix samples the fallback on the SAME absolute grid a plain fixed-step call
  over the full original chord would use (`fieldStepCount` applied to the
  full chord length), just skipping the analytically-proven-empty prefix.
  This is why bar (c) of the equivalence bar only holds in its literal form
  for PURE distance-stepping hits — a fallback hit's own independently
  quantized sub-segment has no such guarantee relative to a full-chord
  fixed-step call (measured up to ~0.13 domain units apart on the Menger SDF
  preset), which bar (b) — identical ramp glyph on every shared hit,
  fallback included — covers instead.
- **The two-commit phase-4 split.** §4 listed one phase (9 voices,
  finest-freq fix, depth-3 preset + empirical gate, builder/validator/
  program-as-data, exporter reject); it shipped as two commits in the
  opposite order the spec lists its own sub-items: `4e171ef` first plumbed
  the generic, opaque `program` option through `packages/glyphcss` and the
  React/Vue/custom-element mirrors (independent of field-synth's own voice
  count or Nyquist formula), then `5294655` landed the 9-voice bump,
  duty-aware finest-freq fix, depth-3 preset, and the program builder/
  validator together — so the later commit's builder/validator tests could
  exercise the full mount-time `program` path immediately instead of only
  field-synth-internal evaluation.
- **The `SynthScope` latent-bug find.** The website's `/synth` oscilloscope
  (`SynthScope` in `synthKit.tsx`) had its own SECOND hardcoded voice-count
  duplicate beyond the already-known `MAX_VOICES = 6` — a literal
  `[null, null, null, null, null, null]` ref array and a literal
  `[0, 1, 2, 3, 4, 5].map(...)` render loop for the per-voice trace paths.
  Bumping `SYNTH_VOICES`/`MAX_VOICES` alone would NOT have caught this: the
  scope would have silently kept plotting only the first 6 of 9 voices,
  passing every test that doesn't render the live SVG. Found and fixed in
  the same commit (`5294655`) that removed the `MAX_VOICES` duplicate,
  deriving both the ref array and the map from `MAX_VOICES` instead of a
  second independent literal.
- **The depth-3 94-step diagonal pin.** §4's empirical ground-truth gate
  test (landed in `5294655`) originally only fired axial rays through the
  depth-3 preset's cube stage — a short (1-domain-unit) chord whose own
  Nyquist floor is 54 steps, well under the 94 the preset's own doc comment
  claims for the cube's body diagonal (the actual longest, steepest-angle
  chord through the finest 1/27 feature). The axial probe could pass even if
  the 94-step claim were wrong, since it never exercises that chord length.
  `c12c645` added a dedicated body-diagonal probe: it confirms the resolved
  step count is exactly 94 at the true diagonal chord length
  (`sqrt(3) * 3 * scale`), then empirically checks a fan of diagonal rays
  against a forced 256-step ground truth, matching exactly across all 72
  probed cells — the claim the preset's doc comment makes is now the claim a
  test actually pins.
- **The rim-orientation real-scene amendment (§2).** §2's rim rule (a) and
  its coverage-mask orientation shipped 4-neighbor (N/E/S/W) only, and the
  pinned "all-dashes counter-case" test only exercised a HIT/HOLE boundary
  with no OUT cell anywhere — not a real projected silhouette. A live
  Menger-sponge render (`subcellRes: "ink"`, default `/synth` camera)
  surfaced two bugs neither the design text nor its test caught: (1) a
  diagonal-only hit/no-hit transition never fired rule (a) at all (most of
  the outer silhouette's "not inked" gaps), and (2) a HOLE-self rim cell
  with no orthogonal HIT neighbor got a degenerate `(0, 0)` coverage-mask
  gradient — `maskOf` correctly treats HOLE and OUT alike for a HIT cell's
  own rim, but that same collapse leaves nothing to orient against when
  `self` itself is HOLE and every 4-neighbor is HOLE/OUT too — defaulting to
  "-" regardless of true edge direction (the very failure the design text
  already named, on cells its own fix didn't reach). `runCarveInkResolve`
  was amended to detect rule (a) and orient rule (a)'s gradient over the
  full 8-neighbor (Sobel) neighborhood instead of 4, with a two-tier mask
  (HIT-only, falling back to coverage-only when the HIT-only Sobel comes
  back exactly `(0, 0)`) — a strict widening that reduces to the prior
  2-tap result on every fixture that was already pinned (reverified, not
  assumed). A new real-scene test (a full-solid carved cube at the /synth
  page's own Menger-sponge camera hint, ground truth from the convex hull of
  its projected corners under the SAME camera) pins both: zero gaps along
  any traced silhouette edge, and zero "-" on a non-horizontal edge.
