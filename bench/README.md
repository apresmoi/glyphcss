# glyphcss render bench

Isolated harness for measuring glyphcss's render path under interaction — no
website / React / gallery overhead. Renders one heavy mesh (default `army.vox`,
the model that lagged on drag) through the **local library source**
(`../packages/*`, esbuild-bundled so edits reflect on rebuild) and drives real
pointer drags through the [`chrome-capture-trace`](../.claude/skills/chrome-capture-trace)
skill, which aligns Chrome trace groups (Script / Style / Layout / Paint).

## Run

```bash
node bench/build.mjs                 # bundle main.ts -> bench.bundle.js
node bench/serve.mjs &               # static server (repo root) on :5180
node bench/profile.mjs               # per-render phase breakdown (loop / string / dom)
node bench/run.mjs                   # Chrome trace: frame time + Style/Layout/Paint
```

`build.mjs --watch` rebuilds on source edits. Open
`http://localhost:5180/bench/index.html?lineHeight=0.5&fill=0.95` to poke it by
hand. Knobs (query params): `lineHeight` `cols` `rows` `rotX` `rotY` `fill`
`zoom` `mesh` `colors`.

The rasterizer records timings into two optional globals (zero cost when unset):
`__glyphPerf` (`raster` / `dom`-write ms) and `__glyphPerfDetail`
(`loop` = shade+scan-fill, `string` = `solidBufToString`).

## Pages

`build.mjs` bundles one entry per page (each imports library source):

| Page | What |
|---|---|
| `index.html` | render-perf harness — one heavy mesh under pointer-drag (this README's findings). |
| `lod.html` | per-mesh **density** perf: full-screen layers vs fitted+translated vs occlusion, scaling object count. Knobs in the top bar. |
| `lod-lib.html` | per-mesh detail + occlusion demo (library API). `?cam=ortho\|persp`; drag to orbit. |
| `lod-fpv.html` | walkable **FPV** (eyeMode) detail + occlusion — click to mouse-look, WASD to move. |

## Findings — making the drag loop faster, losslessly

Profiling `army.vox` (7k polys, line-height 0.5) showed the per-render loop is
dominated by **per-triangle setup**, not the per-cell fill. Three lossless wins
(same pixels — verified bit-identical at multiple camera angles, 1321 tests):

| change | what | win |
|---|---|---|
| **hoist backface cull** | `scanFillTriangle` already drops back faces (`area2 > 0`), but only after paying for normal + Lambert + lit-color. Hoisting the same test ahead of that work skips shading on the ~half of faces that get culled anyway. | ~17% of loop |
| **project once per vertex** | a quad fan re-projected v0/v2 per triangle; project each unique vertex once instead. | ~0.5ms |
| **cross-frame shading cache** | Lambert intensities + lit color depend only on world normal + light, never the camera — so during an orbit/zoom drag they're identical frame to frame. Cache per-triangle, reuse while only the camera moves; the scene clears it when geometry/light/shading options change. | ~14% of loop |

**Stacked: ~40% off the per-render loop, ~35% off total render — fully lossless.**

Rejected along the way: `dragmono` (mono `textContent` during drag — big win but
drops color) and rAF-coalesced scheduling (no measurable benefit; the
microtask-vs-rAF over-render only bites on >60Hz input, which headless can't
reproduce).

> Note: frame-time p50/p95 saturate (~8ms) in headless — the compositor runs
> uncapped and Playwright's input is slower than the frame rate, so frames can't
> bunch. The phase/group **totals** are the trustworthy signal; on real hardware
> under fast input they're exactly the work that overruns the frame budget.
