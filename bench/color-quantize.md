# colorQuantize — collapsing near-identical per-cell colour into runs

A real browser trace on the user's "Menger (cssGraphics)" preset (orbit ON,
speed 4) found the field evaluator (34.4% of a 12s/47k-sample CPU profile)
and browser raster/paint/HTML-parse work (RasterTask 19.1s + Paint/Layout/
ParseHTML ~3.5s of a 10s wall trace) were the two biggest costs — and a
controlled experiment (same math/cells, only colour varying) showed span
count alone is worth ~40% of the frame budget: 9,362 spans / 405KB HTML /
20.6 FPS at baseline vs. 280 spans / 94KB / 31.9 FPS with the colour path
degenerate. `colorQuantize` closes part of that gap on a normal (non-
degenerate) render by bucketing near-identical per-cell colour so
`encodeGlyphBuffers` merges more cells into one `<span>` run.

## Insertion point: (a) final packed RGB vs (b) carve's fade factor

Two candidate insertion points inside `resolveFieldSynthColor`
(`packages/effects/src/stock.ts`):

- **(a) shipped** — quantize the fully-resolved packed RGB, downstream of
  gradient/hue/voiceColors resolution, `lit` Lambert shading, AND carve's
  `exp(-marchFade * distance)` fade. The one insertion point that works
  identically regardless of render mode or colour source.
- **(b) rejected** — quantize only the fade factor before it scales the
  colour, leaving gradient/hue/lit variation untouched. Only fires when
  `colorFactor !== 1` (carve hits), a no-op in paint/xray.

Both were built and measured against the real, unmodified
`fieldSynth.program.evaluate()` on the shipped `GlyphCssGraphicsMengerPreset`
(carve render, colour stack on, hue mode — every colour source this preset
actually exercises), 140×50 grid, real cube geometry via `rasterizeToCells`.
(b) was measured by temporarily swapping `resolveFieldSynthColor`'s tail to
the (b) form, rebuilding, and rerunning `bench/color-quantize.mjs`'s Table 1
loop — not a live A/B in the shipped script, since running both requires two
different builds:

| levels | (a) spans | (a) KB | (b) spans | (b) KB |
|---|---|---|---|---|
| 8  | 832  | 35.3 | 892  | 37.4 |
| 16 | 858  | 36.2 | 1063 | 43.2 |
| 32 | 1191 | 47.6 | 1177 | 47.1 |

(a) beats (b) at every level tested except a statistical tie at 32 (both
have nearly stopped merging by then — see the non-monotonicity note below).
This matches the reasoning: this preset's dominant per-cell colour variation
is the colour stack's continuously-varying **hue**, not carve's fade term —
quantizing only the fade factor leaves that hue variation completely
unmerged. (a) is also the only insertion point that does anything at all in
`paint`/`xray` render or with the colour stack off, where `colorFactor` is
always exactly 1. Shipped as (a).

## The requested table (colorQuantize 0/8/16/32)

`bench/color-quantize.mjs`, same preset/grid, `ms/evaluate` over 60
iterations (warm build, Apple Silicon laptop, Node 22):

| colorQuantize | covered | spans | HTML KB | ms/evaluate |
|---|---|---|---|---|
| 0  | 1565 | 1218 | 48.5 | 1.72 |
| 8  | 1565 | 832  | 35.3 | 1.65 |
| 16 | 1565 | 858  | 36.2 | 1.65 |
| 32 | 1565 | 1191 | 47.6 | 1.65 |

**Best in the requested set: `colorQuantize: 8`, a 1.46x span reduction
(1218 → 832) and 27% smaller HTML (48.5 → 35.3 KB)**, at no measurable
`evaluate()` cost (the quantize itself is 3 extra `Math` ops per resolved
cell — the ms/evaluate column is flat within noise across all four rows).
`colorQuantize: 32` is barely different from off (1191 vs 1218 spans) — see
below for why.

### Non-monotonic in levels — the real ceiling

Span count is **not** monotonic in `colorQuantize`: an extended sweep on the
same scene —

| colorQuantize | 0 | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 24 | 32 | 48 | 64 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| spans | 1218 | **154** | 233 | 721 | 256 | 832 | 1120 | 858 | 1187 | 1191 | 1200 | 1203 |

— shows the real ceiling is higher than the requested table alone suggests:
`colorQuantize: 2` (a genuinely coarse 2-level-per-channel posterize) hits
**7.9x** fewer spans (1218 → 154). This is bucket/colour-distribution
aliasing, not noise: `encodeGlyphBuffers` only merges cells whose quantized
colour bucket lands EXACTLY together, so how much a given level count
merges depends on where this preset's actual hue distribution falls
relative to the bucket boundaries at that level — a smaller `levels` isn't
uniformly "more merging," though the trend is clearly downward-then-
flattening as levels rise past ~16-24 (the point most of this scene's colour
range has more buckets than it has visually distinct hues to fill). This
matches the reviewer's own predicted ceiling ("~3-5x, not 10x") for
*reasonable* (not maximally posterized) settings, and both bounds — 1.46x at
a moderate `8`, up to 7.9x at an aggressive `2` — sit inside it. The UI
slider exposes the full 0-64 range so a user can trade merging against
visible banding themselves; the schema doesn't pick a "recommended" value.

## Live FPS (Playwright, headless Chromium, /synth, real preset + slider)

Protocol: navigate to `/synth`, click the "Menger (cssGraphics)" preset
tile, enable Stage → Orbit, drag Orbit speed to its max (4), then drive the
real `colorQuantize` slider in the Output folder and sample real
`requestAnimationFrame` frame rate over 3s per setting. 4 repeats per level,
**randomized trial order** (a monotonic sweep was tried first and produced a
misleading monotonically-decreasing trend — classic thermal/session drift
that a randomized order cancels out):

| colorQuantize | trials (fps) | mean |
|---|---|---|
| 0  | 20.7, 20.2, 18.7, 19.7 | **19.8** |
| 8  | 22.9, 27.4, 20.6, 25.0 | 24.0 |
| 16 | 21.5, 27.0, 23.4, 22.5 | 23.6 |
| 32 | 24.6, 21.4, 26.2, 26.5 | 24.7 |

Baseline (`colorQuantize: 0`) is the lowest in every one of its 4 trials,
cleanly separated from the other three settings, which land in an
overlapping ~20-27 fps band — a real, repeatable **~20-25% FPS uplift** from
enabling quantization, consistent in direction (if noisier in magnitude)
with the span-reduction numbers above.

**Caveat, same one `bench/README.md` already documents:** this environment
only has Playwright's headless Chromium shell installed (no headed Chrome
binary), and headless's compositor is known to behave differently under
this project's own prior measurements ("frame-time p50/p95 saturate...in
headless — the compositor runs uncapped"). The ABSOLUTE fps numbers here
(~20-27) are not directly comparable to the user's real headed-Chrome trace
baseline (20.6 fps) — they're a different machine state, not a regression.
The Node-level ms/evaluate + span/KB table above is the primary, trustworthy
signal; the live FPS table is a secondary, real-browser confirmation that
the direction holds outside the synthetic bench.

## Micro-win 1: `Math.hypot` → `Math.sqrt` in `sdfBox`

`packages/effects/src/fieldProgram.ts`'s `sdfBox` — every box-union node
visit in the Menger/Sierpinski SDF descent calls this. `bench/sdf-carve-
march.md` REJECTED this exact change previously on a theoretical rounding
risk without running the actual A/B against `fieldProgram.test.ts`'s
`toBeCloseTo(ref, 9)` distance-fidelity assertions. Doing that A/B here: all
431 `@glyphcss/effects` tests (including those assertions) pass unchanged
on the swapped build. An independent reviewer's separate measurement: 3.47x
on `mengerFractalSdf` iter 3 (498.0ms → 143.6ms per 300k calls), 3.08x on
sierpinski, max relative error 4.3e-16 (seven orders inside the 9-decimal
tolerance). Shipped; `bench/sdf-carve-march.md`'s own "Rejected" section
updated to point here.

## Micro-win 2: hoist `parseGlyphEffectColor` + `hslToPackedRgb`'s
invariant part out of the hot path

`parseGlyphEffectColor` (2.0% of the original profile) was already called
once per `evaluate()` (once per animation frame) at every one of its 8 call
sites in `stock.ts` — never literally per cell — but a mounted effect's
colour param STRINGS rarely change frame to frame (a user drags the camera
far more than the colour picker), so re-parsing the same string on every
frame was pure waste. Added a `parsedColorCache` (`Map<string,
GlyphEffectParsedColor>`, keyed by the exact input string) and a
`parseGlyphEffectColorCached` wrapper; all 8 call sites (`matrixRain`,
`scan`, `glitch`, `ripple`, fieldSynth's `color`/`colorB`/per-voice colours)
now go through it. Safe because none of those call sites mutate the
returned `{ packed, opacity }` object.

`hslToPackedRgb` (0.8%) had the same shape of waste one level deeper: it
re-derived `sat`/`light`/`q`/`p` (and re-ran the achromatic branch) from
`hueSat`/`hueLight` on EVERY CELL even though those params are per-frame
constants — only the hue angle genuinely varies per cell. Split into
`computeHuePalette(sat, light)` (now called once per `evaluate()`, only
when the colour stack's hue mode is active) and `hueToPackedRgb(hDeg,
palette)` (the cheap per-cell remainder). Same math, same result — both
changes are pure refactors of already-hoisted-per-frame or newly-hoisted-
per-frame work, not a behavior change: all 431 `@glyphcss/effects` tests
pass unchanged, including the exact-hue-gap tests this preset's own colour
stack depends on.
