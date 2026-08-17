# Why is the Menger SDF preset slow?

User report: the shipped "Menger SDF" preset (`GlyphMengerSdfPreset`,
`stock.ts`) renders at ~7-15 FPS on `/synth` while wave-based (non-SDF)
patches run 60+. This doc is the profile that answered the question, the
fixes it justified, and the guidance for users tuning a volumetric SDF patch.

## Method

`bench/menger-sdf-profile.mjs` — 135×52 grid (half covered, ~3380 covered
cells with a real box-intersected object-space chord), the same camera angle
`GlyphMengerSdfPreset`'s own `STAGE_HINTS` entry ships (`rotX: 15, rotY: 40`).
Every timing number below calls the real, unmodified exported production
functions (`fieldSynth.program.evaluate()`, `buildGlyphFieldDistanceOracle`,
`marchGlyphFieldSphere`) — nothing is a hand-rewritten stand-in. Item (d) uses
a real `createGlyphScene` in `happy-dom` (fixed `cols`/`rows`, since
`happy-dom` has no real layout to auto-size against).

The one exception: item (b)'s "SDF node visits per oracle call" needed
visibility inside the recursive box-union descent (`fractalUnionSdf`), which
has no public surface. That number came from a temporary, single-line
counter probe added to `fractalUnionSdf` for this investigation and reverted
immediately after — it is not part of the shipped code, and
`bench/menger-sdf-profile.mjs` prints a note instead of a number when it
finds the probe absent (the normal, shipped state).

Run: `pnpm --filter @glyphcss/effects build && pnpm --filter glyphcss build && node bench/menger-sdf-profile.mjs`.

## Before (Node 22, Apple Silicon laptop; this machine showed substantial
run-to-run noise on this bench — individual runs ranged as wide as ~80-195
ms/evaluate for the identical build; the ranges below are the band repeated
runs clustered in, not a tight ±%)

| Metric | Value |
|---|---|
| Menger SDF, sphere-trace (shipped), ms/evaluate | ~140-165 ms (6-7 fps ceiling, layer alone) |
| Menger SDF, fixed-step forced, ms/evaluate | ~350-400 ms (2.5-2.9 fps) |
| Menger sponge (wave recipe, control), ms/evaluate | ~15-19 ms (55-65 fps) |
| Sphere-trace speedup over fixed-step | ~2.5-3.1x |
| SDF cost over the wave-recipe control | ~8-9x |
| March steps/cell (oracle calls), mean / max | 12.9 / 53 |
| SDF node visits / oracle call, mean / max | 4.0 / 5 |
| Total oracle calls across the grid | 43,579 |
| Total node visits across the grid | 192,575 |
| Fallback-to-fixed-step rate | 53.4% of covered cells |
| March time as a share of `evaluate()` | ~85-95% |
| "Everything else" (paint/shading/glyph pick/color) | ~5-15% |
| Effect's share of a full `scene.rerender()` | ~99% (rasterize+compositor+DOM write: ~0.5-2 ms) |

**Reading this table:** the effect layer alone is the entire cost — a full
render without the effect mounted takes under 2ms on this grid, so 99% of a
frame at this preset is the field-synth `evaluate()` call, and 85-95% of
*that* is spent inside `marchGlyphFieldSphere` (oracle + sampler calls), not
in paint/shading. Sphere tracing already beats a forced fixed-step march by
~2.5-3x (the sphere tracer's whole reason for existing), but the fixed-step
floor it's being compared against is itself extremely expensive at this
preset's frequency (`iter: 3` → finest feature ~27x the base lattice), so a
"win" over it still lands at only 6-7 fps. Over half of covered cells
(53.4%) exhaust the sphere-tracer's stall/step-cap budget and fall back to a
fixed-step scan of the remaining chord — expensive in principle, but
measured cheap in practice (that scan starts from wherever the sphere
tracer stalled, which by construction is usually most of the way through
the chord already, so the average fallback only samples ~1-2 more points).
The real cost driver is call VOLUME: ~43.6K oracle calls across the grid,
each doing a pruned recursive descent (mean 4 node visits, `iter: 3`) whose
non-leaf visits each computed 20 bounding-box distances and sorted them
into two freshly-allocated arrays.

## What changed

1. **`fractalUnionSdf` scratch-buffer reuse** (`packages/effects/src/fieldProgram.ts`).
   Every non-leaf recursive call allocated two fresh `Array`s (`bounds`/
   `order`, up to 20 entries) for its per-child bound + insertion-sort
   scratch space, discarded a few lines later — pure GC pressure, ~170K+
   short-lived array allocations for one `evaluate()` call on this preset.
   Recursion here is synchronous and single-threaded and `depthRemaining`
   strictly decreases on every non-leaf call, so one reusable
   `Float64Array`/`Int32Array` pair PER RECURSION DEPTH (lazily grown, not
   hard-capped at the schema's `iter` range) is safe: a call never
   re-enters its own depth while a deeper call is in flight. Zero output
   change — same values, same order, written into reused storage instead of
   fresh arrays. Effect: ~5-10% faster `evaluate()` in a controlled
   before/after A/B on this bench (noisy environment; measured consistently
   in the right direction, not a dramatic win — see "Rejected" below for
   what a bigger win would have required).

2. **`/synth`'s `interactiveDownscale`** (`website/src/components/SynthWorkbench/SynthWorkbench.tsx`).
   The scene was created with `interactiveDownscale: 1` (explicitly off).
   `createGlyphOrbitControls` already drives `scene.setInteracting()`
   automatically on drag start/end (the shared `emitInteraction` registry in
   `packages/glyphcss/src/api/controls/common.ts`) — so orbiting a heavy
   volumetric patch was re-evaluating the effect at full resolution on every
   drag frame for no reason; the wiring to render coarser mid-drag already
   existed and just wasn't turned on. Changed to `2` (÷4 cells while
   dragging), matching the loaders gallery's own default. Restores full
   detail on release.

3. **Wasted per-frame recompute for time-invariant patches**
   (`website/src/components/SynthWorkbench/SynthWorkbench.tsx`,
   `synthKit.tsx`'s new `isTimeInvariantPatch`). A field-synth patch's
   output depends on `time` only through each active voice's own `speed`
   (`fieldProgram.ts`'s `c = phase - speed*time` derivation — no other
   param reads raw time). The shipped Menger SDF preset ships `speed1: 0`,
   so its output is mathematically identical at every `time` value — but
   the page's render loop advanced `t` and called `layer.setParams({time:
   t})` every frame regardless. `setParams` already no-ops when the
   candidate params are unchanged (`createGlyphScene.ts`'s `paramsEqual`),
   but `t` itself kept changing every frame (unless the global `timeScale`
   slider was 0), so that dedup never actually caught it — every frame
   forced a full, wasted effect recompute. Now the tick loop skips
   advancing `t` and calling `setParams` entirely when the current patch is
   provably time-invariant (or when `timeScale` is 0). This does NOT skip
   camera auto-orbit: orbiting changes the camera, which re-rasterizes the
   geometry and forces a re-evaluation independent of `time`, confirmed by
   reading `SynthWorkbench.tsx`'s tick function (auto-orbit calls
   `scene.rerender()` directly, not gated on the time-invariance check).

## Rejected

- ~~**`Math.hypot` → `Math.sqrt(x*x+y*y+z*z)` in `sdfBox`.** Left alone —
  `Math.hypot` and a naive sqrt aren't guaranteed bit-identical, and this was
  rejected here without running the actual A/B.~~ **Superseded — shipped**,
  see `bench/color-quantize.md`'s micro-win table: an independent reviewer's
  A/B measured 3.47x on `mengerFractalSdf` iter 3 and 3.08x on sierpinski
  (max relative error 4.3e-16, seven orders inside the 9-decimal fidelity
  tolerance this doc worried about above), and the real gating step this doc
  skipped — actually running `fieldProgram.test.ts`'s `toBeCloseTo(ref, 9)`
  assertions against the changed build — passed clean (all 431
  `@glyphcss/effects` tests green). The theoretical risk this bullet raised
  was real in principle but didn't materialize in practice; per this
  project's "measure it or it didn't happen" rule, that's what settles it.
- **Retuning `SPHERE_MARCH_STALL_STEPS`/`SPHERE_MARCH_MAX_STEPS`.** Both are
  shipped, empirically-derived constants (see their own doc comments in
  `fieldProgram.ts` — `SPHERE_MARCH_STALL_STEPS: 8` was swept from a range
  where lower values false-triggered on ordinary convergence, all the way to
  where raising it further stopped changing the pure/fallback hit-count
  split at all). Re-deriving either would need the same measurement
  methodology across the full sphere-tracing equivalence bar the original
  slice used — out of scope for this pass, and not clearly justified by the
  profile (the fallback path's own cost was measured CHEAP per cell, ~1-2
  extra sampler calls on average — the volume of oracle calls, not the
  fallback mechanism, is the cost driver).

## Guidance: which knobs cost what

- **`iter` (Menger/Sierpinski recursion depth, 1-4).** The single biggest
  lever on an SDF voice's own cost. The finest feature scales as
  `freq * 3^iter` (Menger) or `freq * 2^iter` (Sierpinski) — iter 3→4 triples
  Menger's finest frequency, which raises both the Nyquist step floor for
  any fixed-step fallback AND the fractal descent's effective depth. Drop to
  `iter: 2` for a much cheaper (if less recursive-looking) sponge/pyramid
  before touching anything else.
- **`marchSteps`.** Sets the floor for the FIXED-STEP fallback grid (and the
  fixed-step path when a program doesn't qualify for sphere tracing at all —
  see `buildGlyphFieldDistanceOracle`'s qualifying predicate). Sphere
  tracing's own step budget is a separate, fixed constant
  (`SPHERE_MARCH_MAX_STEPS: 64`) that `marchSteps` does not change. Since
  over half of covered cells hit the fallback path in the measured scene,
  lowering `marchSteps` (default 48) trades a small resolution risk for a
  direct, roughly linear cost cut on that fallback share.
- **Density / grid resolution.** Cost scales with covered CELL COUNT, which
  scales with `cols × rows` — roughly quadratic in a linear "density" slider
  (double the density, ~4x the cells, ~4x the oracle-call volume). This is
  the highest-leverage knob for an SDF carve patch: halving density on a
  heavy preset is worth far more than any single per-voice parameter.
- **Render mode.** `carve`/`xray` are what retain the `objectExit` buffer the
  SDF family needs at all — there is no cheaper render mode for an SDF
  voice's carved appearance (wireframe/voxel don't support the volumetric
  carve path). If the recursive-cutout look isn't required, the wave-voice
  Menger/Sierpinski RECIPE presets (`mengerSpongePreset`/
  `sierpinskiPyramidPreset`) render the same silhouette family at ~8-9x less
  cost — they use fixed periodic square waves instead of a genuine SDF, so
  they never qualify for (or need) sphere tracing at all.
- **`interactiveDownscale`.** Already covers the interactive-drag case once
  wired up (see "What changed" above) — the steady-state numbers in this doc
  are what matters for a settled, non-dragging frame.
