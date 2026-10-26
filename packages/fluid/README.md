# @glyphcss/fluid

A living braille fluid as DOM text. Headings, images and meshes are shapes the fluid flows toward and condenses into, then melts back out of; pointer moves ripple and stir it. It is molty.uno's landing-page fluid as a glyphcss surface: one `<pre>`, one `textContent` write per frame, per-cell colour through glyphcss's colour-font atlas, and the simulation in a Web Worker.

A blob target, 150 steps after start, one ripple · 48 × 12 cells (plain braille, no colour)

```text
  ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁ ⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⣴⣤⣤⣤⣦⣄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠄⠁⠄⠁
  ⠁ ⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁⠄⣰⣴⣴⣶⢕⢕⢕⢕⢕⣦⣦⣦⣆⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁⣴⢕⢕⢝⢵⢝⢵⢝⢵⢝⢵⢝⢕⢕⣦⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⢰⢕⢝⢵⢝⢽⢽⢽⢿⣽⢽⢽⢝⢵⢕⢕⣆⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⢕⢕⢝⢽⢝⢽⢽⢽⢿⣽⢿⢽⢝⢵⢝⢕⠕⠅⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
 ⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠸⢕⢝⢵⢝⢽⢽⢽⢿⢽⢿⢽⢝⢵⢝⢕⠇⠄⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
 ⠄⠁⠄⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁⠹⢝⢕⢝⢵⢝⢽⢝⢽⢝⢽⢝⢕⠕⠟⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠄⠁⠅⠹⠻⠻⠻⠝⢕⢝⢕⠝⠟⠟⠟⠟⠅⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
  ⠁⠄⠁⠄⠁ ⠁ ⠁ ⠁ ⠁⠄⠁⠄⠁⠅⠁⠁⠻⠻⠻⠟⠟⠋⠁⠁⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁ ⠁
```

## Install

```sh
npm install @glyphcss/fluid glyphcss
```

## Use

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

### Targets

| Factory | Ink comes from |
|---|---|
| `GlyphFluidTargets.text(el, { color })` | the element's own text in its computed font |
| `GlyphFluidTargets.image(src, rect, { ink })` | an image or `ImageData` over an element's box or a content rect; bright, opaque pixels pull the most ink |
| `GlyphFluidTargets.mesh(el, { polygons, camera, extent })` | glyphcss polygons rasterised by glyphcss itself every frame; dark covered cells become solid feature blocks (eyes, mouths) |

Every target takes `delay` (seconds before it first condenses) and `visibility: "always" | "viewport"`.

### Options

| Option | Default | |
|---|---|---|
| `glue` | `"host"` | `"host"` fills the host box; `"document"` glues to the page |
| `encoding` | `"atlas"` | per-cell colour; `"mono"` is one colour |
| `fps` | `60` | drops to 30 for the session when frames keep missing (`fpsFallback: false` to keep 60) |
| `worker` | `"auto"` | `false` for the main thread, or a function returning your own Worker running `@glyphcss/fluid/worker` |
| `clock` | `"auto"` | `"manual"` draws only on `fluid.step(dt)` |
| `reducedMotion` | `"settle"` | under `prefers-reduced-motion`, draw still, settled frames and redraw only when targets or layout change |
| `field` | `{ color: "#6f8f82", level: 0.18 }` | the dim background fluid |
| `grid` | `{ cellAspect: 1.6, targetCols: 144, minCellPx: 5.4, maxCellPx: 10, maxCols: 176 }` | cell lattice |
| `tuning` | molty's | sim tunables (`GLYPH_FLUID_SIM_TUNING`) |

### Worker

The default worker is resolved with `new URL("./worker.js", import.meta.url)` next to the package's `dist/index.js`, a pattern Vite and webpack 5 bundle. When yours does not (or under CommonJS), pass a factory, for example in Vite:

```ts
import FluidWorker from "@glyphcss/fluid/worker?worker";
createGlyphFluid(host, { worker: () => new FluidWorker() });
```

If the worker cannot start or errors, the fluid continues on the main thread. The worker path draws one frame late (one frame of input latency) and never queues more than one frame.

### Layers

Each layer works alone, and none of the first three touches the DOM:

```
GlyphFluidSim  →  computeGlyphFluidCells  →  GlyphFluidEncoder  →  createGlyphFluid
(molty's sim,     (braille mask + colour     (glyphcss atlas text   (targets, worker,
 bit-identical)    per cell)                  + pooled palette)      one <pre>)
```

## Browser support

Per-cell colour needs `font-palette` with `@font-palette-values` (Chrome 101+, Safari 15.4+, Firefox 107+). Without it the fluid draws plain braille in one colour.

## License

MIT. The simulation is molty.uno's fluid engine, ported to TypeScript.
