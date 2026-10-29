# @glyphcss/fluid — agent guide

molty.uno's braille fluid as a standalone glyphcss surface. Repo-wide rules live in the root `AGENTS.md`. Docs: `README.md`. Bench and real-browser checks: `bench/fluid/`.

## Model

Four layers, each usable alone; only the last touches the DOM.

1. **Sim** (`src/sim/`): `GlyphFluidSim` is a transliteration of molty's `sim.js` (vendored under `reference/molty-fluid/`, tests only). `configureGlyphFluidRect` turns the device disc into the page rectangle. Host writes go through `GlyphFluidOp`s (`impulse`/`push`/`kick`/`scroll`), applied in call order before the step.
2. **Cells** (`src/cells/cells.ts`): molty's `GlyphRenderer.draw` per-cell decision (braille "all", pastel, edges 1) as data: Unicode braille mask + 5-bit-quantised colour.
3. **Encode** (`src/cells/encode.ts`): core's `encodeGlyphAtlas` against a palette from core's pooled `createGlyphAtlasPaletteQuantizer`. The quantizer's clock is SIM time (`t × 1000`), never wall time. The atlas is the `face`: core's `GLYPH_FONT_ATLAS_BRAILLE_DOTS` (`"dots"`, default) or `GLYPH_FONT_ATLAS` (`"universal"`); same 30 slots and palettes, only code points differ.
4. **Runtime** (`src/runtime/`): `createGlyphFluid` composes DOM targets into a packed `GlyphFluidTargetFrame`, hands it with the queued ops to a pipeline, and writes the returned frame. `GlyphFluidCore` (ops → adopt targets → step → cells → encode) is what both pipelines run; `handleGlyphFluidWorkerMessage` IS the worker (`worker.ts` only binds it).
5. **Reader** (`src/reader/`, the `./reader` subpath): `rules/` is molty's speed-reader rules (vendored `reference/molty-fluid/reader.js`) plus `createGlyphReaderClock` (play/pause/seek/wpm, injectable scheduler). `createGlyphFluidReader` drives one word target (`target.ts`, molty's TextTarget, both looks) on its own small fluid; `letters.ts` is the plain look's DOM overlay.

**Reader rules have no fluid dependency** (no imports outside `rules/`, no DOM). If a second consumer appears (charts, scenes, terminal), `rules/` moves to its own package unchanged. Open question: which package and name; decide then, not before.

## Invariants

- The sim port steps bit-identically to `reference/molty-fluid/sim.js` (every Float32 field, `t`, `err`, `energy`, `swirlKick`). Same fields, loop order, arithmetic order. Molty's firmware runs the same step as C. Change both or neither.
- The cell decision lights the same dots in the same colours as molty's `render.js`, whose real `draw` is run on a recording context in the test.
- The `"dots"` face puts each dot where `render.js` fills it (`cells/dots.geometry` against the atlas's `dotGeometry`; core's `test-atlas.py` checks the outlines). Exact at `cellAspect` 1.6 and cells ≥ 6.25 px wide: below that `render.js` clamps dots to 1.5 px, a font scales.
- One `<pre>`, one `textContent` write per drawn frame. The palette `<style>` is rewritten only when `paletteGeneration` changes (a repool), never per frame.
- Reader plain letters are DOM spans over the `<pre>` (like hotspots): ≤ one `cssText` per letter per frame, only on change; `textContent` only when the shown character changes. Their show/ink/wave/accent come from the frame's own step (`cells/probes.ts`, which blanks cells under shown letters as render.js does), paired by `probeTag`.
- Worker and main thread draw identical frames from identical inputs: text, palette, generation and probe results. The worker path draws one frame late (document glue places it at that frame's echoed `rowOrigin`) and never has more than one step in flight; a busy vsync is skipped, not queued.
- `unpackGlyphFluidTargets` adopts TR/TG/TB only where T > 0. Those fields persist in the sim (`applyBackground` blends them), so cells no target wrote keep their blended colour; garbage there must not change output.
- Text targets draw word by word at their Range rects (wrapping, `<br>`, alignment, nested fonts); never the element's `textContent` as one line.
- A merge winner owns the cell's feature flag and accent (TA); a winner without them clears them. TA is a packed target field; the cell layer mixes accented cells toward molty's accent orange.
- Reader rules match `reference/molty-fluid/reader.js` exactly (UTF-16 indices, rounding, the 40 ms floor); molty's firmware applies the same rules. Change both or neither.
- Reader: ORP letter on the host's centre column; glyph words sized each, plain letters per sentence; the first word gathers in the lead-in; `setWpm` applies from the next word. A word change is `changed()`: reduced motion draws one settled still per word.
- `shape: "circle"` keeps the sim constructor's disc (stage-space circle inscribed in the grid); `"rect"` reshapes it.
- Targets read the DOM in `measure()` only (layout, resize, font load, add). Per frame they only compose; the runtime reads the host rect once at the start of a frame, before its write.
- Target merge is max-ink per cell; frame border cells are never written.
- The mesh target rasterises with `compileScene` (two passes: unlit albedo, white Lambert) on a 2W × 2H grid. No WebGL, no three.js in the package. With `extent` set it owns `camera.zoom`.
- `fps: 60` drops to 30 for the session after a 60-frame window with > 20 % missed vsyncs. One-way. Gaps over 250 ms are idle, not misses.
- Reduced motion (`settle`): main-thread pipeline, no impulses or kicks, one settled still per change (targets, zones, layout, row scroll). Settled = every cell within 0.02 of its target (capped), never the grid-mean `sim.err`.
- Font unavailable (load failure or no `font-palette`): `"plain"` encoding, real braille code points in one colour, U+2800 for blanks (a space would come from another face and shear the grid).
- `destroy()` cancels the frame, removes every listener and observer, terminates the worker and restores any host style it set.
- Public exports carry the `Glyph` prefix. No React/Vue bindings (same as `@glyphcss/maps`).

## Don't

- Don't rewrite the sim "more idiomatically" (reordered sums, hoisted products, fused loops): Float32 parity breaks, and with it the firmware's shared behaviour.
- Don't feed the quantizer `Date.now`: a repool would land on different frames in the worker and on the main thread.
- Don't re-run median cut per frame: each palette rewrite restyles the PUA text (+0.3 ms/frame ×1, +1.3 ms ×4).
- Don't make the worker pipeline lockstep or deeper than one frame: the main thread cannot block, and two in flight only skips results.
- Don't render the fluid as a glyph-scene effect layer here: that changes what runs in the render path and needs the user's approval.
- Don't ship a dot font in this package: the face is core's braille-dots atlas. Geometry changes go through core's `build-atlas.py braille-dots` and both geometry tests.
- Don't decide plain-letter visibility on the main thread: letters and blank cells would disagree on the worker.
- Don't draw plain letters on a canvas or style them per property: one span, one `cssText`.
- Don't import fluid, DOM or runtime code into `reader/rules/`.

## Key gates (`src/`)

- Parity: `sim/sim.parity`, `cells/cells.parity`, `runtime/pipeline.parity`, `reader/rules/rules.parity` (each with a planted-bug case that must go red).
- Reader: `reader/rules/clock`, `reader/reader` (both looks: pivot, sizes, melt, reduced motion, blank band), `reader/letters` (decode, writes). Probe pairing: `runtime/createGlyphFluid`.
- Encode: `cells/encode`, `cells/dots.geometry`. Targets/zones: `targets/targets`. Runtime: `runtime/createGlyphFluid`, `.atlas`, `.plain`, `runtime/pipeline.settle`, `runtime/fps`.
- Real browser (`bench/fluid/`): `parity.mjs` (real Worker, `drop-push` mutation), `text.mjs` (wrapped/`<br>`/centred text lands on its words), `bench.mjs` (60 fps, ×1/×4), `dots.mjs` (canvas vs both faces as DOM: dot pitch/gap in-cell vs across, pixel IoU), `reader.mjs` (both looks at 250/400/600 wpm on the worker: plain shows the word decoded, ORP orange on centre).
