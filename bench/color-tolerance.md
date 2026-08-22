# colorTolerance — run-aware colour merging

`colorTolerance` (COLOR-TOLERANCE.md) replaces the removed `colorQuantize`.
Where `colorQuantize` rounded each channel to N levels — blind to which
colours a scene actually uses — `colorTolerance` walks each row holding an
**anchor** colour and extends the current run while the next cell stays
within tolerance of it (redmean distance), emitting a new `<span>` only when
a cell actually breaks that band. This file is the reproducible bench for
COLOR-TOLERANCE.md's acceptance items 5 and 6: the six-preset span table and
the live FPS delta.

**Headline: a 1.2x–9.2x lever depending on scene content, not a flat
multiplier.** That range is unquantized→best across the six presets below,
excluding Cube tiles (already flat, 1.0x, no win by design — see below): Aurora
1.2x, Lava 1.3x, Nebula 1.5x, Menger 2.9x, Gyroid xray 9.2x. Flat and
hard-edged scenes (per-face colour, shade ramps, carved solids) win
enormously; smooth noisy fields win modestly because their spans are
dominated by genuine per-cell variation no merge policy can invent coherence
around; already-flat scenes gain nothing and — this is the important half —
do not regress either.

An earlier hand measurement on a different, non-reproducible rig claimed
1.6x–31x. Re-running this committed script reproduces the table below
exactly, and the real derived ratios are 1.2x–9.2x, not 1.6x–31x — that
earlier figure is superseded and should not be cited. This file is the
reproducible source of truth going forward.

**Monotonicity is measured on real content, not guaranteed.** Raising
tolerance lowers span count on every shipped preset measured, but greedy
re-anchoring admits local non-monotonicity: a larger tolerance can let an
early run swallow one more cell, moving the next anchor to a strictly worse
centre for what follows. COLOR-TOLERANCE.md's own verified counterexample
against the real encoder (`#409640 #407840 #406440 #408c40 #406440 #406440
#406440 #406440` — a pure green ramp, so redmean reduces to `2·|Δg|`, i.e.
the sequence `[5,2,0,4,0,0,0,0]`): tolerance 40 gives 2 spans, tolerance 60
gives 4. Worst magnitude observed at grid scale is **+5.4%** (112 → 118
spans on a quantized/banded 60×20 grid). The slider does not visibly invert
in practice, but the property is fixture-specific, not universal.

## Six-preset table

Real, unmodified `fieldSynth.program.evaluate()` + `rasterizeToCells()` +
`encodeGlyphBuffers()`/`colorRunExtends`, one representative frame
(`time: 3`) per preset, 140×50 grid — `bench/color-tolerance.mjs`. Three
merge policies swept to the coarsest knob setting whose mean redmean error
stays at or below a shared target (~8, matching COLOR-TOLERANCE.md's own
target), so the comparison is like-for-like:

- **uniform** — per-channel N-level bucketing (the removed `colorQuantize`'s
  own mechanism, reimplemented in this script ONLY for comparison; it ships
  nowhere in the library).
- **greedy RGB** — the same run-extension algorithm the shipped
  `colorTolerance` uses, with plain unweighted Euclidean RGB distance
  instead of redmean.
- **greedy perceptual** — the SHIPPED mechanism: `colorRunExtends`
  (redmean), called through the real production `encodeGlyphBuffers`.

Volumetric presets (Menger, Gyroid xray) render on a 3-unit cube with
`retainObjectPosition`/`retainObjectExit`/`retainObjectNormal`, the same rig
`bench/color-quantize.mjs` (now deleted, see below) used. The four 2D
presets render on a single flat quad with `retainWorldPosition`/
`retainNormal`, exercising the `space: "auto"` generated-surface fallback —
none of the four author UVs, so `findUvBounds` returns false and every cell
resolves through `generatedSurfaceField`, exactly as the `/synth` page's
default flat stage does.

| preset | unquantized | uniform | greedy RGB | greedy perceptual |
|---|---|---|---|---|
| Menger (cssGraphics) | 1218 | 851 (N=26, err 7.7) | 422 (tol=19, err 7.9) | **428** (tol=33, err 7.8) |
| Gyroid xray | 1341 | 395 (N=24, err 6.7) | **145** (tol=13, err 7.6) | 145 (tol=24, err 7.6) |
| Lava | 391 | 373 (N=21, err 7.9) | **301** (tol=32, err 7.9) | 301 (tol=62, err 7.9) |
| Aurora | 365 | 361 (N=37, err 5.4) | **303** (tol=47, err 7.8) | 303 (tol=89, err 7.8) |
| Nebula | 419 | 399 (N=27, err 7.8) | 289 (tol=30, err 7.6) | **287** (tol=49, err 7.8) |
| Cube tiles | 273 | 273 (N=0, err 0.0) | 273 (tol=0, err 0.0) | 273 (tol=0, err 0.0) |

(Bold = fewest spans at matched error; ties broken by whichever the sweep
found first.) **Cube tiles wins nothing, on purpose — it stays in this
table.** It is already a hard-edged `argmax` tiling with almost no
near-duplicate adjacent colour to merge, so every policy lands on the exact
same span count at zero tolerance; this is the "already-flat scenes don't
regress" half of the headline, not a bug in the sweep.

The qualitative shape matches COLOR-TOLERANCE.md's own hand-measured table:
Menger and Gyroid xray (hard-edged carved/xray geometry) win the most (2.9x
and 9.2x, unquantized→best), the three 2D noise presets win modestly (1.3x,
1.2x, 1.5x), and Cube tiles wins nothing. Absolute span counts differ from
that table's figures — this script's own 140×50 rig (chosen to match
`bench/color-quantize.mjs`'s precedent for the volumetric presets) is not
the same resolution or camera setup the original figures were measured
under, and this file is now the reproducible source of truth going forward:
run `pnpm build && node bench/color-tolerance.mjs` to regenerate it.

`greedy RGB` occasionally edges out `greedy perceptual` by a cell or two
(Menger, Lava, Aurora above) — expected and consistent with
COLOR-TOLERANCE.md's own table, where `greedy RGB` beats `greedy perceptual`
on Gyroid xray (232 vs 236). Redmean is a better objective on average, not a
guaranteed per-scene winner.

## `charMode` two-colour encoders (Phase 2)

Measured independently at 140×50 through the real `rasterize()` +
`charMode` pipeline, tolerance 32/128:

| charMode | icosphere (smooth-shaded) | cube (flat per-face) |
|---|---|---|
| `halfblock` | 1.59x / 1.85x | 1.00x / 1.28x |
| `quadrant` | 1.39x / 1.62x | 1.01x / 1.04x |

Both encoders require *both* foreground and background to match within
tolerance before a run extends, so the win is smaller than the single-colour
path's — and, like that path, genuinely small or zero on already-flat
content. Treat these as a measured range, not a guaranteed floor.

## Extended range (Phase 4)

Same Menger (cssGraphics) 140×50 rig, full redmean range (0..765, not
0..255 — black↔white is 764.83 under this metric):

| colorTolerance | 0 | 32 | 128 | 256 | 320 | 400 | 765 |
|---|---|---|---|---|---|---|---|
| spans | 1218 | 430 | 136 | 60 | 45 | 37 | 37 |
| mean error | 0 | 7.8 | 18.6 | 57.4 | 62.0 | 66.5 | 66.5 |

Spans keep falling past 256 — the `/synth` slider's ceiling — but error
climbs steeply alongside them, saturating at 400 because that is this
preset's widest colour pair (392.7 redmean): beyond it there is nothing left
to merge into. Above 256 tolerance still reduces spans; it is that the
scene's own colour range runs out of headroom to absorb it invisibly, not
that merging stops working.

## Live FPS delta (acceptance item 6)

Headed Chrome (system Chrome via `channel: "chrome"`, Playwright), `/synth`,
"Menger (cssGraphics)" preset, Stage density 3.5, Orbit on, orbit speed 4.
4 trials per setting, 3s `requestAnimationFrame` sample each, spans read from
the largest-area `<pre>` on the page (a `querySelector("pre")` alone returns
a sidebar preview thumbnail, not the stage) immediately before each trial:

| colorTolerance | spans (per trial) | fps (per trial) | mean fps |
|---|---|---|---|
| 0 | 9330, 6903, 11311, 14346 | 15.2, 16.7, 16.0, 17.2 | 16.3 |
| 32 | 2650, 2086, 2468, 2747 | 25.4, 26.1, 23.5, 25.7 | 25.2 |
| 128 | 959, 563, 291, 499 | 26.3, 28.3, 28.3, 26.0 | 27.2 |
| 256 | 266, 323, 296, 172 | 28.6, 26.9, 29.6, 29.8 | 28.8 |

Span count swings widely within one setting because the camera is actively
orbiting a carved solid — every trial sees a different silhouette. FPS is
still cleanly separated and monotonically improving with tolerance: **16.3 →
28.8 mean FPS, a 1.77x uplift going from off to the slider's ceiling**, with
most of the gain already captured by tolerance 32 (16.3 → 25.2). This
session's own earlier reference points, measured under the old
`colorQuantize` control at the same protocol (8,885 spans → 20.8 FPS; 695
spans → 33.9 FPS), are in the same direction and rough band but not directly
comparable trial-for-trial — different span counts, different moment in the
orbit, and (per that session's own note) FPS on this page is noisy enough
that a single reading can land ~15% off its own trend; report the mean
and the spread, not one number.

## Micro-win: `Math.hypot` → `Math.sqrt` in `sdfBox`

Ported from the now-deleted `bench/color-quantize.md`, whose micro-win table
this doc's citations (`packages/effects/src/fieldProgram.ts`,
`bench/sdf-carve-march.md`) point to.

`packages/effects/src/fieldProgram.ts`'s `sdfBox` — every box-union node
visit in the Menger/Sierpinski SDF descent calls this. `bench/sdf-carve-
march.md` REJECTED this exact change previously on a theoretical rounding
risk without running the actual A/B against `fieldProgram.test.ts`'s
`toBeCloseTo(ref, 9)` distance-fidelity assertions. Doing that A/B: all 431
`@glyphcss/effects` tests (including those assertions) pass unchanged on the
swapped build. An independent reviewer's separate measurement: 3.47x on
`mengerFractalSdf` iter 3 (498.0ms → 143.6ms per 300k calls), 3.08x on
sierpinski, max relative error 4.3e-16 (seven orders inside the 9-decimal
tolerance). Shipped; `bench/sdf-carve-march.md`'s own "Rejected" section
records this as superseded.

## Removed: `bench/color-quantize.mjs` / `bench/color-quantize.md`

Both benchmarked the `colorQuantize` field-synth param, removed in
COLOR-TOLERANCE.md's Phase 4 (`495185a`). The script ran without error and
printed a table where every row was identical (1218 spans / 48.5 KB at every
setting) — a benchmark silently measuring nothing beside a doc recommending
a setting for a control that no longer exists. Deleted in this phase; this
file is their replacement.
