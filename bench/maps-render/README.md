# `/maps` render bench

Drives the real `/maps` page through four deterministic **continuous-motion**
replays and reports cost *and* fidelity. Modeled on asciiQuake's committed
`test/perf/glyphBench.mjs` — that project renders the same glyphcss package at
2560x1440 / 20,916 cells and is fast, so the two harnesses have to be comparable.

## Run

```bash
pnpm build:website && (cd website && pnpm exec astro preview --port 4399) &
node bench/maps-render/mapsBench.mjs --url http://localhost:4399 --headed --encoding atlas
```

A dev server works too (`pnpm dev:website`), but React's dev build costs ~2 ms of
extra script per frame — measure claims about the shipped page against `astro
preview`.

| flag | meaning |
|---|---|
| `--url <origin>` | required |
| `--viewport WxH` | default `1440x900` |
| `--expect-grid CxR` | required grid shape, default `140x63` — a **gate**, see below |
| `--encoding spans\|atlas` | default `spans`; the page's own default is `atlas` |
| `--scenario orbit\|drag\|wheel\|flyto\|walk\|all` | default `all` |
| `--headed` | real GPU. Headless software-renders and inflates raster/paint |
| `--fidelity-only` | digest only |
| `--query <qs>` | extra query appended to `/maps/?bench=1` (e.g. `m=p1m2`, the page's own URL-state param) — drives page state no scenario covers, such as a layer's own render mode |
| `--layer <json>` | a JSON `GlyphMapLayer` added through the page's harness seam after load — for a layer shape no URL state reaches. Only a fully-JSON layer works (`model` carries inline polygons; a `raster`/`fill` source is a live provider object) |
| `--demo-layer <ids>` | comma-separated ids of the page's own demo layer cards (`fill`, `symbol`, `circle`, `heatmap`, `fill-extrusion`, `model`) to switch on before measuring — the only honest way to price a layer whose `source` is a live provider object |
| `--demo-dataset <pairs>` | `id=dataset` pairs (e.g. `symbol=places`) selecting which baked point dataset a demo layer reads, through the same seam |
| `--json <file>` | full result, including per-waypoint digests |
| `--osm <ids>` | comma-separated OpenStreetMap ROW ids to switch on (`""` switches the card off). The link carries a bitfield, not a list, so `--query` cannot reach one row |
| `--osm-density <n>` | the card's master slider — one density written across every row |
| `--osm-density-row <id=n,…>` | ONE row's density. The only way to tell a stroke overlay grid's cost from a separated detail pass's, since the master writes all ten |
| `--at lon,lat,span` | re-base the timed scenarios here instead of the globe overview — how to price `drag`/`wheel` at a CITY view, where the layers a street-level reader has mounted actually exist |
| `--walk-frames <n>` | displayed frames of held-W walking (default 400) |
| `--walk-far <m>` | the walker's local horizon, applied through the widget's own `setWalk` RECONFIGURE path once walk mode is live. The way to measure a view-distance ladder without rebuilding the package per rung — it re-pins `view.span`, re-poses the lens and re-sweeps the tiles, which is exactly what shipping a different `GLYPH_MAP_WALK_FAR_M` does |
| `--walk-look <deg>` | heading applied per walking frame. **Use `0`.** Any other value drives the look through `map.setBearing`, which renders SYNCHRONOUSLY and adds a render per frame — the real mouselook path (`applyWalkLook`) only marks the frame dirty, so a non-zero value measures the harness, not the page |
| `--no-fidelity` | skip the eight-waypoint digest. Cost-only runs while hunting a stall; never for a change that could move a pixel |

## `walk`: the fifth scenario

Street-level walk mode is the page's own keyboard mode, so it does not go
through `__benchDriveEvents` — a held key is one event, not a burst, and the
widget's motion loop integrates `dt` per rAF for as long as it is down. The
scenario puts the view where the walk gate admits it (Zürich, `span 0.02`),
enters through the page's OWN pegman toggle rather than `map.setWalk`, holds
`w`, and keeps measuring for 1.2 s after the release so the post-motion tile
settle lands inside the window. The blank guard is skipped there and only there:
a street-level frame legitimately has sky in it, and sky is blank cells.

Every run also reports the **tile budget it actually spent**, split at the
moment the walk scenario began: `before` (page load and the pre-walk view),
`footprint` (what entering walk — and any `--walk-far` reconfigure — asked
for), and `walked` (what the held-W traverse streamed on top). Counted off
real network requests by zoom, distinct addresses only, so a cached tile is
not double-counted: `osm` is an OpenFreeMap `{z}/{x}/{y}.pbf`, `geo`/`cur` a
baked relief `{z}/{x}_{y}.bin`. It is the only honest answer to "how many
tiles does this footprint cost" — the analytic formula in
`website/.../mapsWalk.ts` is a bound, not a measurement, and the widget's own
per-tile visibility test is what decides.

## A HANG IS A DISTRIBUTION, NOT A MEAN

Every scenario now reports **p50 / p95 / p99 / max** for three sample series
alongside the averages, because a 16 ms mean frame with a 400 ms p99 is exactly
the "it goes slow and then stalls" report and no average can show it:

- `frame gap ms` — the interval between consecutive displayed frames. Vsync is
  on, so 16.7 ms is the floor and every multiple of it is a dropped frame.
- `render burst ms` — one full render pass, from `base-validate` to the
  microtask that closes it.
- `base raster ms` — glyphcss's own per-render probe.

Plus the browser's own `longtask` entries (count, total, worst, top six) —
the only signal that separates "the render is slow" from "something else ran"
— and a JS heap timeline sampled from Node on a wall clock, so the samples keep
landing across a main-thread stall. Chromium is launched with
`--enable-precise-memory-info`; without it `performance.memory` is bucketed and
a growth question cannot be answered.


## What it measures, and why each choice matters

**Renders per displayed frame** is the headline. Anything above ~1.05 is
discarded work: glyphcss coalesces renders on a microtask, which drains at the
end of *every* task, so each task that touches the scene can buy a full render.

**Input is synthesized in-page, not through CDP.** Two separate
`setTimeout(…, 0)` tasks per displayed frame reproduce a trackpad's burst
exactly. Playwright's `mouse.move` + await delivers roughly one event every two
or three frames and measured renders/frame at 0.34, which says nothing about the
real behaviour.

**Vsync stays on.** asciiQuake ran uncapped because its replay drove one camera
move per rAF at any rate; two scenarios here are input-driven, and an uncapped
rAF turns their think-time into thousands of phantom "displayed frames"
(measured: 990 fps, renders/frame 0.03, meaningless).

**Grid shape is a gate, not a note.** Every scenario asserts the rendered grid
equals `--expect-grid` and fails otherwise. Lowering cols/rows, raising the cell
size, or engaging `interactiveDownscale` would all "hit 60 fps" while delivering
a visibly coarser map.

**Fidelity digest.** Eight fixed waypoints, hashed over the base `<pre>`'s
`innerHTML` **plus every detail/overlay `<pre>` the scene produced** (each with
its own CSS `transform`). Base-only was blind to any layer mounted at
`density > 1`, which moves its geometry entirely out of the base grid — such a
run also failed the non-blank guard, since the base grid it measured was
empty. The grid-shape gate still reads the base `<pre>` alone.

**The digest compares runs of ONE build, not two builds.** Measured: three
runs of the same `astro preview` build reported `1ee14d5eba7e4fc35080d4b3`
every time, and a plain `pnpm build:website` of byte-identical sources
followed by a fourth run reported `83cc93ebd4e9399571447c3d`. So a digest
difference across a rebuild is not evidence of a rendering change; establish
byte-identity by A/B-ing the source instead (e.g. a vitest over the real baked
data through the same `createGlyphMap` call the page makes, toggling the change
under test), and use the digest for what it is reliable at — catching a
within-build regression between two scenarios or two flag sets.
 It waits for **quiescence** (the `<pre>`
unchanged across two consecutive samples), not a fixed delay: a fixed delay made
two of the eight waypoints report different digests run to run on changes that
provably could not alter a pixel. **Compare builds in `spans` mode.** Under
`atlas` a cell is a PUA code point encoding *(glyph, palette-slot)* and the
palette is median-cut over whatever grids the quantizer trained on, so changing
how many renders happen per frame permutes slot indices and two builds painting
identical colours get different digests — asciiQuake measured 85% of atlas cells
"differing" on a byte-identical render.

The page installs its harness seam (`window.__glyphMapsBench`) only under
`?bench=1`.

## Measured, 1440x900, `astro preview`, `atlas`, grid 140x63 (unchanged)

| scenario | fps before | fps after | task ms/frame | renders/frame |
|---|---|---|---|---|
| orbit (globe rotation) | 58.9 | **59.2** | 14.75 → 14.02 | 1.00 → 1.00 |
| drag (+ release) | 39.0 | **59.7** | 25.62 → 13.75 | **1.98 → 1.00** |
| wheel sweep | — | **60.2** | — → 6.87 | 0.97 |
| flyTo arc | 59.9 | **59.7** | 12.98 → 10.20 | 1.01 |

Fidelity digest identical before and after (`95a74630b1697c3a0b6a5d44` atlas,
`4bb8943252596a033b011b80` spans).

The "before" row is the landed code with its two mechanisms switched off in
place (the pre-projection cull, and the motion loop reverted to rendering
synchronously per input event). It faithfully reproduces the original drag,
orbit and flyTo paths; it does **not** reproduce the original *wheel* path,
which had its own rAF coalescer that the motion loop replaced — so the wheel
row has no honest before number here and is omitted.

## What a per-layer render mode costs

`GlyphMapLayer.renderMode` mounts a layer's mesh with glyphcss's per-mesh
`GlyphMeshTransform.mode`. A mode that DIFFERS from the scene's splits that
mesh into its own rasterizer pass; a mode equal to the scene's does not. Four
runs, all `1440x900`, `spans`, `--scenario orbit`, same page, same probe
geometry (one quad, added through `--layer`), fidelity digest
`4bb8943252596a033b011b80` on every one — identical to the baseline above, so
nothing here changed a rendered pixel:

| configuration | fps | task ms/frame | script ms | base-raster |
|---|---|---|---|---|
| no probe layer (baseline) | 55.1 | 18.11 | 12.57 | 8.48 |
| probe `renderMode: "solid"` — the scene's own mode, joins the base pass | 52.7 | 18.94 | 13.29 | 9.11 |
| probe `renderMode: "ink"` — separated, mounted transparent | 53.2 | 18.75 | 12.90 | 8.55 |
| probe `renderMode: "voxel"` — separated AND opaque | **35.9** | **27.79** | **22.25** | 8.25 |

Two things fall out.

**A separated OUTLINE layer is free.** `wireframe`/`ink` are mounted
`transparent` by `@glyphcss/maps` (`GLYPH_MAP_EDGE_RENDER_MODES`) because they
paint edges only and an opaque claim would blank the terrain beneath — and a
transparent detail mesh does not participate in cross-layer occlusion at all,
so `createGlyphScene` never builds the shared id-map. The extra pass itself is
proportional to the separated mesh's own geometry, which for an overlay is
small. Measured at or below run-to-run noise (±2 fps on this scene).

**A separated OPAQUE layer is not.** The moment ONE opaque detail mesh exists,
`computeOcclusionIds` rasterizes the WHOLE scene's geometry — all 65,312
polygons here — into the shared id-map, once per render. `base-raster` is
unchanged (8.25 ms), so the cost is entirely outside it: **+8.8 ms of script
per frame, 52.7 -> 35.9 fps**, for a one-quad overlay. This is pre-existing
cross-layer-occlusion machinery, not new to per-layer modes; per-layer modes
are simply a new way to reach it.

The consequence for `/maps`: every mode its UI offers is either the scene's own
(`solid`, no separation) or an outline mode (`wireframe`/`ink`, transparent, no
id-map), so the feature is free as shipped. A future opaque separated layer
would need the id-map cost budgeted for.

## What a per-layer glyph palette costs

`GlyphMapLayer.glyphPalette` mounts a layer's mesh with glyphcss's per-mesh
`GlyphMeshTransform.glyphPalette`. glyphcss separates on ANY non-null value
there (an unrecognized name resolves to the default ramp, so it will not
compare two names), so `@glyphcss/maps` applies the equality escape itself and
simply does not set the option when the layer names the ramp the scene is
already on. Three configurations, all `1440x900`, `spans`, `--scenario orbit`,
same one-quad `model` probe added through `--layer`, grid gate `140x63` held on
every row (two runs each where shown):

| configuration | fps | task ms/frame | script ms | base-raster | base pass polys |
|---|---|---|---|---|---|
| no probe layer (baseline) | 41.7 / 41.9 | 23.93 / 23.82 | 19.81 / 19.72 | 16.73 / 16.68 | 65,312 |
| probe `glyphPalette: "default"` — the scene's own ramp | 41.3 | 24.16 | 20.12 | 17.05 | **65,313** |
| probe `glyphPalette: "blocks"` — separated, opaque | **29.4 / 28.5** | **34.04 / 35.00** | **29.83 / 30.70** | 15.89 / 16.35 | 65,312 |

`65,313` is the escape observable in-page rather than argued: the probe's quad
is counted in the BASE pass, so no separate output exists and the run sits
inside baseline noise. The diverging row reproduces the separated-opaque shape
the `voxel` row above measures — `base-raster` is flat or lower, so the whole
**+10.4 ms of script per frame, 41.7 -> 29.0 fps** is outside it, in
`computeOcclusionIds` rastering all 65,312 polygons into the shared id-map once
per render because one opaque detail layer now exists.

Absolute fps here is lower than the render-mode table above (different machine
and load); the comparison that matters is within this block, where all three
rows were measured back to back against one build.

## Full screen (2560x1440, 283x105 = 29,715 cells) — where the time goes

Run it at the size the complaint is about:

```bash
node bench/maps-render/mapsBench.mjs --url http://localhost:4399 --headed \
  --encoding atlas --viewport 2560x1440 --expect-grid 283x105
```

| scenario | fps before | fps after | base-raster ms before | after |
|---|---|---|---|---|
| orbit (globe rotation) | 28.0 | **32.0** | 30.00 | **25.5-26.2** |
| drag (+ release) | 27.1 | **29.0** | 31.55 | **29.0** |
| wheel sweep | 56.0 | 56.6 | 9.00 | 9.5 |
| flyTo arc | 43.0 | 43.8 | 15.48 | 15.3 |

Grid `283x105` on every row of both columns (the gate), fidelity digest
`40cc92bf3accd3f1f7160c74` in spans mode identical before and after.

`base-raster` is 99% of the frame; `renders/frame` is already 1.00 and
`commit-write` is 0.16 ms, so neither microtask coalescing nor the `<pre>`
write is in play. Decomposed by short-circuiting the solid rasterizer at three
points and re-measuring (median of 20 renders at one settled pose):

```
loop + vertex projection + chunk cull   15.7 ms   52%
per-tri nan/off-grid/backface tests      2.0 ms    7%
shading + shadow ctx                     1.5 ms    5%
scan-fill                               10.9 ms   36%
                                        ------
base-raster                             30.1 ms
```

Half the frame is `camera.project` on submitted vertices (~633,000 calls). An
attempt to make that cheaper by removing its per-call temporaries — a `shifted`
Vec3, the rotated Vec3, the result tuple — measured **slower** (22.0 vs 17.1 ms
for the projection phase, reproducible across three runs): V8 already
escape-analyses those away, and module-level scalars to hold them defeat it.
Reverted; do not retry it.

## Where the 7.3 polygons per cell come from

215,664 quads for 29,715 cells. Attributed by instrumenting the widget's three
mesh tiers and the rasterizer's own per-triangle cull decisions over 12 poses:

| source | share | verdict |
|---|---|---|
| fine (target-LOD) tier — 32-34 z3 tiles at relief fraction 0.625 | **99.75%** | the whole story |
| permanent floor tier (1 tile, backstop-capped to 32 cols) | 0.24% | not material |
| fallback tier | 0% in a settled view | not material |
| `padCells` + tile granularity | 32-34 tiles mounted against a 32-tile minimum hemisphere cover | 0-6%, not material |

So neither the pad ring, nor the three-tier never-black system, nor tile
granularity explains it. The fine tier alone does, and the reason is
structural to a uniform lat/lon relief sphere:

`reliefFractionForLevel` sizes the mesh at **one quad per glyph cell measured
in degrees at the view centre**. On a sphere of radius `R` cells, that puts
`2 pi^2 R^2` quads on the whole sphere, `pi^2 R^2` on the near hemisphere,
projected onto a disc of `pi R^2` cells — **pi ~= 3.14 drawn quads per painted
cell before any inefficiency**, purely from `cos(lat)` and limb foreshortening.
Measured: **4.5 drawn quads per painted cell** (106,186 drawn quads over 23,401
non-blank cells), i.e. pi x 1.13 for the eighths quantization of the fraction
ladder (0.625 where 0.589 was wanted) x the rest.

The per-triangle consequence: **68.7% of the triangles that survive every cull
paint nothing** — their screen box clamps to an empty cell range — and the mean
cells scanned per surviving call is 0.61.

Triangle census at 2560x1440 (12 poses, after the AABB chunk cull that was
already landed, before the back-face one):

```
chunk-skipped (world AABB, pre-projection)   26.6%
wholly behind camera                          0.0%   (orthographic: no near plane)
projected then off-grid                       6.4%
back-facing                                  15.4%
actually drawn                               51.6%
```

## Is 60 fps reachable losslessly at this density?

**No.** Everything a lossless renderer change can remove is the 21.8% that is
off-grid or back-facing, worth ~4.5 ms of a 30.1 ms raster. Both levers are now
landed (pre-projection back-face run rejection, and hoisting `scanFillTriangle`'s
own empty-coverage test to the call site) and together they buy 30.0 -> ~25.8 ms,
28 -> 32 fps. The remaining 51.6% is geometry that genuinely passes every test
the renderer applies; no cull can touch it.

60 fps needs `base-raster` near 12 ms, i.e. roughly half the submitted geometry.
That is a **mesh/product decision, not a renderer one**: dropping the relief
fraction one rung on the ladder (0.625 -> 0.375, 0.36x the quads) would land it
while still leaving ~1.3 quads per painted cell, and the principled version is
to make `reliefFractionForLevel` projection-aware so it stops paying the `pi`
factor a globe imposes and a flat sheet does not. Either changes the rendered
picture, so neither is a lossless optimization and neither is taken here.

## Where the /maps frame goes at street level (and the double render that was in it)

Measured 1440x900, `astro preview`, `spans`, grid `140x63`, Zürich at
`span 0.02`, OpenStreetMap `water`/`roads`/`boundaries`/`buildings`.

A scene write placed AFTER a frame's own `scene.rerender()` arms a second, full,
never-superseded render — `rerender()` supersedes only what was armed ahead of
it. The widget's `syncNearSide()` was on the wrong side in all nine of its
render paths, and a `fill-extrusion`'s wall cull writes polygons; the same sweep
also ran per `pointermove`, so a trackpad bought a render per EVENT.

| scenario | before | after |
|---|---|---|
| `walk` | 38.5 fps, **1.72** renders/frame | **58.7 fps**, 0.87 |
| `drag --at 8.5417,47.3769,0.02` | 11.8 fps, **2.98** renders/frame | **28.8 fps**, 1.00 |

Frame gap p50/p95/p99: walk 32.9/33.9/49.8 -> **16.7/17.4/33.4** ms; drag
83.3/100/100.6 -> **33.3/50/50.4** ms. Output unchanged — the superseded render
was the one being thrown away.

What is left is geometry, not waste: **6.9 polygons per glyph cell**
(61,063 in the base pass over 8,820 cells; terrain alone is 16,840 and
buildings add 43,607), `base-raster` 9.3 ms of an 11.0 ms render.

**What a density above 1 costs, in a real browser.** Each DISTINCT stroke
density is a full-viewport overlay grid with its own depth pass: **+9 ms per
render**, linear in the grid COUNT (one 58.4 -> 40.6 fps, three 58.4 -> 21.4).
One opaque separated detail mesh is worse — **+24 ms per render**,
`detail-project` alone 20.7 ms, 58.4 -> 21.7 fps — because `computeOcclusionIds`
rasterizes the whole scene into the shared id-map once per render. The card's
one master slider at 2x reaches 18.3 fps and 251 long tasks worst 454 ms.

**The single stall**, at the defaults: 117 ms of blocked main thread exactly
302 ms after the movement key is released — the 180 ms `scheduleTileUpdate`
debounce plus the frame it lands in. Nothing over 40 ms happens while the key
is down. **No memory growth**: three minutes of walking sawtooths 79-422 MB and
ends where it started, renders/frame 0.97.
