# @glyphcss/fluid

[Workbench](https://glyphcss.com/fluid/) · [Docs](https://glyphcss.com/fluid/overview/)

A living braille fluid as DOM text: headings, images and meshes condense out of it and melt back, pointer moves stir it, and a speed reader shows one word at a time out of it. It is a glyphcss surface: one `<pre>`, one `textContent` write per frame, per-cell colour through glyphcss's colour-font atlas, the simulation in a Web Worker.

## Real output

A text target (`fluid`, Arial Black 88 px) after 150 steps · 48 × 12 cells, blank border rows omitted (plain braille, no colour)

```text
  ⠁ ⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁ ⠁⠄⠁⠄⣀⣠⣄⣀⣀⣀⠁ ⠁ ⠁ ⠁ ⠁⣀⣀⠄⠁ ⠁ ⣀⣀⣀⠄⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁ ⠁⠄⠁⣠⣴⣶⣦⢵⣴⣆⡇⣀⣀⣀⠁⣀⣀⠄⢸⣴⣦⡇⠁⣀⣀⣠⣴⣶⡆⠅⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁ ⠁ ⢸⢸⢿⣿⠟⢕⢸⡇⠅⣰⣶⣆⠅⣰⣶⡆⢸⢸⡇⡇⣠⣴⣶⢶⢿⣿⡇⠅⠁ ⠁ ⠁⠄⠁⠄⠁
  ⠁ ⠁ ⠁ ⠁ ⠁⢸⢿⡇⠋⢸⢸⡇⠕⢸⢿⡇⠕⢸⢿⡇⠕⢸⡇⢅⣴⣿⡇⠉⢸⣿⡇⠅⠁ ⠁⠄⠁⠄⠁⠄⠁
  ⠁⠄⠁⠄⠁ ⠁ ⠁⢸⢸⡇⡇⢸⢸⡇⠕⢸⢿⣇⣤⢸⢿⡇⠕⢸⡇⠅⠻⣿⣇⣀⢸⣿⡇⠅⠁ ⠁⠄⠁⠄⠁⠄⠁
 ⠄⠁⠄⠁⠄⠁⠄⠁ ⠁⢸⠻⠟⡇⢸⠻⠟⡇⠹⠻⠿⠿⠿⠿⠇⠹⠻⠟⡇⠙⠻⠿⠿⠿⠟⠇⠅⠁ ⠁⠄⠁⠄⠁⠄⠁
 ⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠅⠉⠉⠁⠄⠉⠉⠁ ⠉⠉⠉⠉⠉⠁⠁⠉⠉⠁⠁⠉⠉⠉⠉⠉⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁
  ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁
```

The reader's `glyph` look on the round 52 × 32 disc, `reading` after 90 steps · rows 11–21 (the ORP letter `a` sits on the centre column, drawn in the accent colour)

```text
      ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⣀⣀⠁⣀⣀⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁
      ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁ ⣰⣦⠕⢶⡆⠅⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁
      ⠁ ⠁ ⠁⠄⠁⠄⣀⣀⣀⣀⠁⣀⣀⣀⠁⠅⣀⣀⣀⣀⠅⠅⣀⣠⣸⡇⠕⢕⡁⠅⣀⣀⣀⣀⠁⠄⣀⣀⣀⣀⠁⠄⠁
      ⠁ ⠁ ⠁⠄⠁⠄⢰⣶⡶⡦⣠⣴⠶⣦⡄⠅⢰⠶⣶⣆⣆⢰⣴⣶⢿⡇⠕⣴⡆⢕⣴⣶⣶⣦⣆⣰⣴⣶⣶⣦⡇⠄⠁
      ⠁ ⠁ ⠁ ⠁⠄⢸⣽⡏⢻⢰⡇⣉⢽⣆⠅⢘⢕⢹⡇⣦⣼⢿⠛⢿⡇⠕⢽⡇⢕⢿⠿⠻⡇⠕⣸⢿⠛⢿⡇⠅ ⠁
      ⠁ ⠁ ⠁⠄⠁⠄⢸⣿⡇⢸⢸⣿⠶⠿⠇⢅⣸⠶⠾⣿⢕⢽⡇⢕⢸⣽⠕⢽⡇⢕⢿⡏⢹⢽⠕⢽⡇⢅⢸⡇⠅⠄⠁
      ⠁ ⠁ ⠁ ⠁ ⢸⣽⡇⢸⢸⡇⣉⣉⠉⢰⣶⣏⣹⣽⠕⢸⣇⣀⢸⡇⠕⢽⡇⢕⢿⢅⢝⢽⠕⠹⢿⣤⢿⡇⡇⠄⠁
    ⠁ ⠁ ⠁ ⠁ ⠁ ⠸⠟⡇⠄⠹⠿⠶⠶⠇⠸⠻⠷⠾⠟⠟⠹⠻⠶⠿⠟⠕⠻⠇⠻⠿⠇⠸⠿⠇⢸⠻⠿⢿⡇⡇⠅⠅
    ⠁ ⠁ ⠁ ⠁ ⠁ ⠉⠉⠁ ⠉⠉⠉⠉⠉⠅⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁⠉⠉⠅⠉⠅⠁⠉⠁⢸⣉⣉⢽⡇⡇ ⠁
    ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁⠄⠁⠅⠁⠄⠁⠅⠁⠅⠁⠄⠁⠅⠁⠅⠁⠅⠁⠅⠁⠅⠁⠅⠁⠸⠾⠶⠟⠇⠁⠄⠁
      ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁⠉⠉⠋⠉⠁⠁
```

Both come from `bench/fluid/src/reader.ts` (`captureText`, `capture`) run in Chrome: the package's own targets and `GlyphFluidCore`, plain-encoded.

## Install

```sh
npm install @glyphcss/fluid glyphcss
```

## Quick start

```ts
import { createGlyphFluid, GlyphFluidTargets } from "@glyphcss/fluid";

const fluid = createGlyphFluid(document.getElementById("fluid")!, {
  glue: "document",   // fixed, viewport-sized host; the fluid scrolls with the page by whole rows
  pointer: "window",
});

const title = fluid.addTarget(GlyphFluidTargets.text(h1, { color: "#3ccf96", delay: 0.5, visibility: "viewport" }));
fluid.addZone({ el: proseEl, kind: "quiet" });   // dim the field under prose
fluid.addZone({ el: poolEl, kind: "pool" });     // a deeper well

title.melt();      // flow out; title.condense() flows back in
fluid.impulse(clientX, clientY, { strength: 1.5 });
fluid.destroy();
```

Keep the target element in the page with `color: transparent`: its box drives layout, selection and accessibility while the fluid draws it.

## What it does

| Layer | Use alone |
|---|---|
| `GlyphFluidSim` | The fluid step, a bit-identical transliteration of the reference implementation's `sim.js`. No DOM. |
| `computeGlyphFluidCells` | the per-cell braille decision of the reference renderer: 8-dot mask + 5-bit colour. |
| `GlyphFluidEncoder` | cells → glyphcss atlas text and a pooled palette. |
| `createGlyphFluid` | targets, zones, pointer, worker, fps governor, one `<pre>`. |
| `@glyphcss/fluid/reader` | speed-reader rules and word clock (no fluid dependency) and `createGlyphFluidReader`. |

```
GlyphFluidSim  →  computeGlyphFluidCells  →  GlyphFluidEncoder  →  createGlyphFluid
(the fluid sim,   (braille mask + colour     (glyphcss atlas text   (targets, worker,
 bit-identical)    per cell)                  + pooled palette)      one <pre>)
```

## Targets and options

| Factory | Ink comes from |
|---|---|
| `GlyphFluidTargets.text(el, { color })` | the element's own text in its computed fonts, word by word at its laid-out position |
| `GlyphFluidTargets.image(src, rect, { ink })` | an image or `ImageData` over an element's box or a content rect; bright, opaque pixels pull the most ink |
| `GlyphFluidTargets.mesh(el, { polygons, camera, extent })` | glyphcss polygons rasterised by glyphcss every frame; dark covered cells become solid feature blocks (eyes, mouths) |

Every target takes `delay` (seconds before it first condenses) and `visibility: "always" | "viewport"`.

| Option | Default | |
|---|---|---|
| `glue` | `"host"` | `"host"` fills the host box; `"document"` glues to the page |
| `shape` | `"rect"` | `"circle"`: a circular surface, the disc inscribed in the host |
| `encoding` | `"atlas"` | per-cell colour; `"mono"` is one colour |
| `face` | `"dots"` | `"dots"` draws dot rectangles from glyphcss's braille-dots atlas, exactly where a canvas renderer would (at `cellAspect` 1.6); `"universal"` uses glyphcss's universal atlas, whose braille spans a text line, so rows bunch across cell boundaries |
| `fps` | `60` | drops to 30 for the session when frames keep missing (`fpsFallback: false` to keep 60) |
| `worker` | `"auto"` | `false` for the main thread, or a function returning your own Worker running `@glyphcss/fluid/worker` |
| `clock` | `"auto"` | `"manual"` draws only on `fluid.step(dt)` |
| `reducedMotion` | `"settle"` | under `prefers-reduced-motion`, draw still, settled frames and redraw only on change |
| `pointer` | `"host"` | stir from `"host"`, `"window"` or `"none"` |
| `field` | `{ color: "#6f8f82", level: 0.18 }` | the dim background fluid |
| `grid` | `{ cellAspect: 1.6, targetCols: 144, minCellPx: 5.4, maxCellPx: 10, maxCols: 176 }` | cell lattice |
| `tuning` | the defaults | sim tunables (`GLYPH_FLUID_SIM_TUNING`) |

The default worker is resolved with `new URL("./worker.js", import.meta.url)` next to `dist/index.js`, which Vite and webpack 5 bundle. Otherwise pass a factory, for example in Vite:

```ts
import FluidWorker from "@glyphcss/fluid/worker?worker";
createGlyphFluid(host, { worker: () => new FluidWorker() });
```

If the worker cannot start or errors, the fluid continues on the main thread. The worker path draws one frame late and never queues more than one frame.

## Reader

```ts
import { createGlyphFluidReader } from "@glyphcss/fluid/reader";

const reader = createGlyphFluidReader(host, {
  text: "Words appear one at a time, out of the fluid.",
  wpm: 250,
  shape: "circle",   // the device's round screen
  loop: 2600,        // ms of rest, then read again
});
reader.clock.setWpm(400);   // from the next word
reader.clock.pause();
reader.clock.seek(3);
reader.clock.setText("Something new.");
reader.destroy();
```

Each word's optimal recognition point (ORP) letter is pivoted on the centre column and drawn in the accent colour, in one of two looks:

- `look: "plain"` (default): the fluid pools into a band and real letters condense out of it, scrambling through ramp glyphs (`.:-=+*#%@`) into the letter as ink arrives under each one, riding the wave, and melting back after the last word. They are DOM text: one `<span>` per letter over the `<pre>`, at most one inline-style write per letter per frame, text written only when the shown character changes. Bold monospace, `font` to change it.
- `look: "glyph"`: the fluid itself takes the letter shapes in a heavy, condensed face, each word sized to fill the host on its own.

The showing word is kept as text in a visually hidden element (`ariaLive`, default `"off"`); under reduced motion plain letters show settled. The rules: ORP by core length (≤1 → 0, 2–5 → 1, 6–9 → 2, 10–13 → 3, ≥14 → 4), and `delay = max(40, 60000/wpm × long × punctuation)`. They and the clock are plain functions with no fluid dependency:

```ts
import { tokenizeGlyphReaderText, glyphReaderWordDelay, createGlyphReaderClock } from "@glyphcss/fluid/reader";

const clock = createGlyphReaderClock({ text, wpm: 300 });
clock.subscribe((e) => e.type === "word" && show(e.token.word, e.token.orp, e.ms));
```

The fluid's `<pre>` is `aria-hidden`: keep the sentence in the page for assistive technology.

## API at a glance

| Entry point | Use |
|---|---|
| `createGlyphFluid(host, options?)` | Mount; `addTarget`, `addZone`, `impulse`, `push`, `step`, `relayout`, `stats`, `destroy`. |
| `GlyphFluidTargets.text / image / mesh` | Target specs for `addTarget`; the live target can `condense`, `melt`, `remove`. |
| `createGlyphFluidReader(host, options?)` | `./reader`: the speed reader; `clock`, `fluid`, `ready`, `destroy`. |
| `createGlyphReaderClock` | `./reader`: `play`, `pause`, `seek`, `setWpm`, `setText`, `subscribe`. |
| `tokenizeGlyphReaderText` / `glyphReaderOrp` / `glyphReaderWordDelay` | `./reader`: the reader rules. |
| `GlyphFluidSim`, `configureGlyphFluidRect` / `Disc`, `stepGlyphFluidSim` | The simulation without a DOM. |
| `GlyphFluidCore`, `handleGlyphFluidWorkerMessage` | One pipeline step (ops → targets → step → cells → encode); the worker protocol. |
| `@glyphcss/fluid/worker` | The worker entry for your bundler. |

Full exports: [root](src/index.ts), [reader](src/reader/index.ts). Full options: [runtime](src/runtime/createGlyphFluid.ts), [reader](src/reader/createGlyphFluidReader.ts).

## Browser support

Per-cell colour needs `font-palette` with `@font-palette-values` (Chrome 101+, Safari 15.4+, Firefox 107+). Without it the fluid draws plain braille in one colour. Module workers are needed for the worker path; without them it runs on the main thread.

## Documentation

- [Overview](https://glyphcss.com/fluid/overview) · [interactive /fluid workbench](https://glyphcss.com/fluid).
- [Targets & zones](https://glyphcss.com/fluid/targets): text, image and mesh targets, zones, condense and melt.
- [Runtime & performance](https://glyphcss.com/fluid/runtime): worker, 60 → 30 fps, reduced motion, measured costs.
- [Reader](https://glyphcss.com/fluid/reader): rules, word clock and the fluid-drawn reader.
- [Troubleshooting](https://glyphcss.com/fluid/troubleshooting).
- [Contributor contracts](AGENTS.md): invariants and rejected approaches.

## License

MIT.
