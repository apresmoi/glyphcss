# Atlas palette quantization — quality gate

`colorEncoding: "atlas"` addresses colour by SLOT: a PUA code point names a
position in a ≤31-entry palette, never an RGB value. Any render with more
distinct colours than that has to be reduced to fit, and the question this
measures is the only one that decides whether the reduction is shippable:

> **Does encoding a render through a quantized 31-slot palette carry more
> visual error than the span render it replaces?**

The span render at `colorTolerance: 0` — glyphcss's default — is exact, so
"more error than zero" is trivially true and useless as a bar. The honest
comparison is against **`colorTolerance: 32`**, the merge policy `/synth`
already ships, which substitutes colours too and reports in the same redmean
units.

## Method

Real per-cell `(glyph, colour)` buffers, captured from the live site's spans
render on three scenes picked for three different colour mechanisms:

| scene | mechanism |
|---|---|
| `/examples/parthenon` | continuous Lambert shading over flat-ish stone colours |
| `/examples/image` | a photo sampled onto a textured quad (`layoutit-terra.png`) |
| `/synth` | field-synth's default patch, effect clock running |

20 frames each, 150 ms apart. Everything measured runs the **shipped** code:
`createGlyphAtlasPaletteQuantizer` fed frame by frame exactly as a live scene
feeds it, and `nearestPaletteIndex` for slot assignment. Only
`colorTolerance`'s row-wise anchor merge is reimplemented in the harness,
because the shipped encoder returns a string rather than the per-cell colours
it emitted; the rule is a direct transcription of `encodeGlyphBuffers`'s.

```
pnpm --filter @glyphcss/website dev                       # :4323
node bench/color-font-atlas-capture.mjs frames.json       # real Chrome, headed
node bench/color-font-atlas-quantize.mjs frames.json
```

## Result

Error unit: redmean, 0..765 — the same scale the `colorTolerance` slider uses.

| scene | grid | distinct colours | spans (tol 0 / 32) | slots | repools | `colorTolerance: 32` mean / p95 / %>32 | **pooled quantized** mean / p95 / %>32 | single-frame palette (mean) |
|---|---|---|---|---|---|---|---|---|
| parthenon | 224×76 | 291 | 3090 / 2422 | 31 | 1 | 1.4 / 10.3 / 0.0% | **1.2 / 8.3 / 0.0%** | 1.2 |
| image | 248×86 | 2495 | 5917 / 2195 | 31 | 1 | 8.2 / 28.0 / 0.0% | **9.2 / 25.4 / 2.9%** | 9.2 |
| synth | 140×52 | 358 | 2982 / 2982 | 31 | 1 | 0.0 / 0.0 / 0.0% | **3.4 / 7.5 / 0.0%** | 3.4 |

**All three were disabled before this landed** — 291, 2495 and 358 distinct
colours against a 31-slot budget, and the old predicate refused on count.

- **Parthenon: quantized is better than the shipped merge.** Mean 1.2 vs 1.4,
  p95 8.3 vs 10.3, nothing over the tolerance-32 bar. A Lambert ramp is close
  to 1-D in colour space, which is the case 31 slots cover comfortably.
- **Image: quantized is marginally worse on mean, better on p95.** 9.2 vs 8.2
  mean, 25.4 vs 28.0 p95, with 2.9% of cells past redmean 32. A photo is the
  genuinely hard case — 2495 distinct colours is 80× the slot budget — and 2.9%
  of cells landing further than `/synth`'s own tolerance is a real, if small,
  quality cost. It is still under a third of the tolerance value the user
  already accepts on every cell of a merged run.
- **Synth: quantized adds error where the span render adds none.** Reported
  plainly rather than hidden: `colorTolerance: 32` merged *nothing* on this
  patch (2982 spans at both settings — its neighbouring cells are all further
  apart than 32), so the span render emitted exact colours and the honest
  comparison is against 0, not against 8. Quantization costs mean 3.4 / p95
  7.5 here. That is ~0.4% of the redmean range and an eighth of the tolerance
  `/synth` ships, with no cell over the bar, but it is not free.

**Verdict: ship.** Two of the three scenes cost less than or about the same as
a setting already in the product, the third costs a small, bounded amount, and
all three go from "feature unavailable" to "feature works". The alternative on
offer is not a lossless atlas render — it is no atlas render at all.

## Notes

- **`repools: 1` on every scene is the point of the drift gate**, not an
  accident. An earlier gate compared drift against zero and repooled
  `/examples/image` ten times over three motionless seconds, because 31 slots
  can never cover 2495 colours and the residual error read as staleness. The
  shipped gate compares against the palette's own baseline on its training
  window, so irreducible error is not mistaken for drift. Repool cost is
  therefore ~0 for a static scene, and bounded to one per 250 ms otherwise.
- The **single-frame-derived palette** column matches the pooled one here
  because none of these three scenes rotates its hue away over the 3 s
  captured. `bench/color-font-atlas.md` §6 measures the case that does (a
  `colorStackOn` hue rotation: 32.0 single-frame vs 5.1 pooled), which is why
  pooling and periodic refresh exist regardless of what these three show.
- Flat-shaded renders (`/wordart` Ink, `/examples/city-lab`) do not appear
  here because they have fewer distinct colours than the atlas has slots:
  quantization is skipped entirely and the encoding is exact.
