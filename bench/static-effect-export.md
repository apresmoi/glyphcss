# Static effect-export benchmark — prebaked frames (A) vs inlined vanilla-JS (B)

Deciding how to export an **effect-only, static-camera** glyphcss animation as a
self-contained pen (one HTML + CSS + JS, no build step for the consumer).

**Scenario.** One mesh (icosphere, `subdivisions:3`), a **fixed** orthographic
camera (no rotation), and the stock **field-synth** effect animating its texture
over `time` (surface-mapped moiré, `space:"surface"`, `blend:"replace"`). Grid
**100×40** cells (≈2453 covered by the silhouette), **4 s** loop, 12 px cell.

Two strategies:

- **A — prebaked frames (zero JS).** Bake N grids at `time = i/N · loop`, stack
  them into one `<pre>`, cycle with a pure-CSS `steps(N)` animation. Same idea as
  the existing `buildGlyphFramesExport`, but varying the effect `time` instead of
  `rotY` (camera fixed). Rendered here by the **real, pure** glyphcss rasterizer +
  effect compositor run in Node — byte-faithful to the runtime render.
- **B — minimal inlined vanilla JS (no libraries).** Bake, once, the per-cell
  resolved effect-domain coordinate `(x, y, cx, cy)` + Lambert `shade` + cell
  position, then ship a tiny hand-written field-synth evaluator that recomputes
  every covered cell per `requestAnimationFrame` and rewrites the `<pre>`.
  **Zero external dependencies** (no `import`, no `http(s)://`, no CDN, no
  glyphcss/@glyphcss/effects — verified by grep and by an offline browser run).

## Payload (gzip is the honest metric — CodePen/HTTP serve gzipped)

| Strategy        | Raw     | **Gzip**   | Gzip vs B |
|-----------------|---------|------------|-----------|
| A — N = 12      | 464 KB  | **51.0 KB**| 2.7×      |
| A — N = 24      | 918 KB  | **97.4 KB**| 5.1×      |
| A — N = 36      | 1365 KB | **141.7 KB**| 7.2×     |
| **B — inlined JS** | 86 KB | **19.2 KB** | 1.0×    |

**Crossover: A's payload exceeds B at N ≈ 3.6 frames.** A grows linearly
(≈ 5.8 KB + 3.9 KB·N gzipped — one frame's dithered colored ASCII costs ~3.9 KB
gz even after cross-frame color-class dedupe). B is **fixed** at 19.2 KB gz
regardless of loop length or smoothness. So for anything past ~4 discrete frames,
B is smaller — and the gap widens fast (7× at a still-choppy 36 frames).

### Where B's bytes go (it scales with the grid, not with N)

| Part                         | Raw    | Gzip     |
|------------------------------|--------|----------|
| Baked per-cell `(x,y,cx,cy,shade,col,row)` (2453 cells) | 84.1 KB | **16.9 KB** |
| Runtime evaluator + markup   | 4.3 KB | ~1.5 KB  |
| Baked params (`CFG`)         | 291 B  | —        |

The field-synth evaluator itself is **~4 KB raw** (~1.5 KB gz); **86 %** of B is
the baked per-cell coordinate table. B therefore scales with **covered cell
count** (grid resolution × silhouette), not with frame count or loop duration.

## Quality

- **A:** discrete — temporal smoothness ∝ N; at N=12 the loop visibly steps.
  Instant paint, **zero JS/CPU** after load. Fixed resolution. A non-periodic
  effect (e.g. a `noise` voice, whose time axis isn't periodic) shows a
  **loop seam** at the wrap; here we chose periodic voices (radial sins, integer
  cycles over 4 s) so A loops cleanly.
- **B:** **continuous** — perfectly smooth, any loop length, no seam constraint
  (it just evaluates `time = now/1000 % loop`; a truly aperiodic effect can even
  be shown non-looping). Instant first paint of the baked static grid, then the
  JS "hydrates" and animates. Tiny JS.

**Equivalence.** A and B render the **same** effect: cell-for-cell the two agree
**95–97 %** across sampled times, with `visible` counts matching within <2 %
(the small residual is 3-decimal coordinate quantization flipping cells that sit
right on a ramp-index or dither-threshold boundary — visually indistinguishable).
Screenshots confirm identical pattern, ramp, and blue→pink gradient.

## CPU note for B (rough)

Per frame B recomputes every covered cell: 2 active oscillators (here) → a couple
of `sin`/`hypot` + a combine + ramp/color/lit + Bayer dither, then builds the
colored `<pre>` innerHTML from color runs. For 2453 cells that is a few hundred
µs of math plus the innerHTML parse/paint of the `<pre>` — comfortably 60 fps on
a 100×40 grid. Cost is **O(covered cells) per frame** and independent of voice
count beyond the active ones; it grows with grid resolution (a 200×80 grid is 4×
the cells) and with `useColors` (colored spans cost ParseHTML/Style/Paint on top
of the recompute). This is the same per-frame budget the live glyphcss runtime
pays; B just inlines the field-synth slice of it with no library around it.

## Recommendation

**Ship Strategy B (inlined vanilla-JS) as the default for effect-only /
static-camera exports.** For any loop worth shipping (≳4 frames) B is smaller
gzipped, and it is *continuously* smooth with no frame-count/loop-length/seam
trade-off — a 4 s loop and a 40 s loop are the same 19 KB. A only wins in the
degenerate low-N corner (≤3 frames) or when a **zero-JS** artifact is a hard
requirement (CSP forbids inline script, or a truly no-runtime SSG fragment). Keep
A as a secondary "zero-JS, few-frames" option, but B is the right primary.

Caveats to carry into a productionized B:
- Payload is dominated by the baked per-cell coordinate table (scales with grid
  size, not N). `cx,cy` are per-surface-group constants baked per-cell today —
  de-duplicating them per group, and packing `x,y` as quantized deltas or a typed
  binary blob, would shrink B further.
- This slice bakes **one** static camera + **one** mesh + a **fixed param set**
  (only `time` animates). Animating other params, moving the camera, or per-mesh
  detail layers are out of scope — those defeat "bake the resolved coordinate".
- Matches the runtime only for the layer's **actual** blend. Note field-synth's
  `defaultBlend` is UI metadata and is **not** auto-applied to a layer — a layer
  with no explicit `blend` uses `over` (coverage saturates to 1, no dither),
  which looks denser than the `replace` texture used here. An exporter must read
  the layer's real blend/opacity/order, not the definition default.

## Reproduce

```
node bench/static-effect-export/build.mjs       # bakes both pens → out/, prints the size table
node bench/static-effect-export/verify.mjs      # Playwright render+animate+offline check → shots/
```

- Prototype export code: `bench/static-effect-export/harness.ts`
  (`buildStrategyA`, `buildStrategyB`, the Node bake path, and the build-time
  surface-basis copy used only to resolve B's per-cell coordinates).
- Generated pens + `sizes.json`: `bench/static-effect-export/out/`.

### How B's inlined JS was generated

**Hand-written** faithful vanilla-JS port of the field-synth per-cell math
(`synthWave`/`synthNoise3`/`synthOsc`/`combineSynth`/`lerpPacked`/`scalePackedColor`
+ the compositor's Bayer coverage dither), chosen over an esbuild bundle because
the per-cell slice is small and hand-writing gives the most honest, minimal size
with no bundler runtime/wrapper noise. Its output is validated against the real
compositor in Node (95–97 % cell match) and visually via screenshots.

**Self-containment proof:** `grep -iE 'import |https?://|require\(|@glyphcss'
strategyB.html` → 0 hits; and it renders + animates in headless Chromium with
`context.setOffline(true)` + all non-`file://` requests aborted (0 external
requests observed).
