# Carve mode frame budget — justifying the default `marchSteps`

VOLUMETRIC.md's Carve section requires this measurement: "Effects recompose
every animated frame over all covered cells: a half-covered 120×48 grid at 48
steps × 6 voices is ~1.7M `synthOsc` calls per frame per layer. Carve is the
most expensive thing field-synth will do... the implementation PR must
include a measurement justifying the default `marchSteps` and documenting a
recommended grid budget."

## Scenario

`bench/carve-march.mjs` — a **120×48** grid (5760 cells), **half covered**
(2880 cells), each covered cell a genuine `objectPosition -> objectExit`
chord through the field program's own unit domain. The mounted program is the
**depth-2 Menger recipe** (verbatim voice/layer shape from
`packages/effects/src/stock.test.ts`'s `mengerParams(2)` — two layers of
three axis voices each, `wave: square`, `duty: 1/3`, `phase: -1/3`,
`min`-blended layers), `render: "carve"`. It calls the real
`fieldSynth.program.evaluate()` path (imported from the built package, no
mocks) 30 times per `marchSteps` setting after a 5-call JIT warmup and reports
mean wall time per call.

Run: `pnpm --filter @glyphcss/effects build && node bench/carve-march.mjs`.

## Results (Node 22, Apple Silicon laptop)

| `marchSteps` | mean ms / `evaluate()` call | fps ceiling (this layer alone) |
|---|---|---|
| 32 | 2.45 ms | 408 |
| 48 | 3.26 ms | 307 |
| 96 | 5.31 ms | 188 |

Cost scales roughly linearly with `marchSteps` (each step is one more
`evaluateFieldProgram` call per covered cell), consistent with the doc's own
"~1.7M `synthOsc` calls per frame per layer" estimate at 48 steps × 6 voices ×
2880 covered cells ≈ 830K program evaluations (each evaluating up to 6
voices) — actual counts are lower here because the Nyquist floor only raises
resolution where the recipe's finest active voice (`freq: 3`) demands it, and
because a march stops at its first solid sample rather than always walking
the full step count.

## Why 48 is the shipped default

- **Headroom.** 3.26 ms/frame for carve alone leaves most of a 16.6 ms
  (60 fps) frame budget for the rest of the render pass (rasterization,
  other effect layers, DOM write) — comfortable for an interactive scene.
- **Resolution.** The recipe's finest feature is 1/9 of the domain (depth-2,
  `freq: 3`); 48 steps against a chord on the order of 1 domain unit already
  sits well above the two-samples-per-feature Nyquist minimum, and the
  implementation's own Nyquist floor (`ceil(2 * chordLength * finestFreq)`)
  raises the per-cell count further whenever a mounted patch's active voices
  need it — 48 is a floor, not a ceiling.
- **96 nearly doubles cost for marginal gain** on content this coarse — the
  Nyquist floor already raises resolution past 96 automatically for finer
  content, up to the 256 cap. (This bench predates the depth-3 duty-aware
  Nyquist fix, VOLUMETRIC-3.md §4: depth-3 Menger's finest band needs 94
  steps, not the ~281 this doc originally assumed — depth-3 now ships as a
  preset, gated on an empirical hit-set check rather than a hand-derived step
  count.)
- **`interactiveDownscale`** (existing scene option) already covers the
  interactive-drag case: carve, like every effect, renders at `1/n`
  resolution while a control is actively dragging and restores full detail
  on release, so the steady-state 48-step cost above is the one that matters
  for a settled frame.

## Recommended grid budget

For a carve-mode field-synth layer at the default `marchSteps: 48`, a
half-covered grid up to roughly **120×48** (the measured scenario) stays
comfortably inside a 60fps frame budget for that layer alone on typical
hardware. Larger grids or `marchFade`-heavy multi-layer patches should budget
linearly with covered-cell count and `marchSteps`; `interactiveDownscale`
remains the mitigation for mid-drag frames regardless of grid size.
