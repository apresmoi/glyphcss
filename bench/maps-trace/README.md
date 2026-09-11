# `/maps` Chrome-trace harness

Answers the one question `bench/maps-render` structurally cannot: **where does
the frame actually go** — Scripting, Style, Layout, PrePaint, Paint, raster,
the compositor, the GPU — and therefore whether the `<pre>`'s DOM cost is ever
the limit.

`bench/maps-render` measures cost and fidelity, and every number it reports is
taken from inside the page's own script. `base-raster` is glyphcss's own probe;
`commit-write` is the gap between two of its own markers. Neither can see one
millisecond of Style, Layout, Paint, raster, compositing or GPU work, so a
frame that spent 9 ms in script and 20 ms in Paint would report there as "9 ms
of base-raster, 99% of the frame" — and be wrong by a factor of three. This
harness exists to check that claim from the outside.

Method, trace categories and event groups come from the `chrome-trace` skill
(`polycss/.agents/skills/chrome-trace`), which was built for exactly this
question: CDP `Tracing`, a `requestAnimationFrame` sampler, `performance.mark()`
windows, real page input, per-frame attribution. Its runners drive polycss's own
bench pages, so the driving half here is `bench/maps-render`'s instead — the
same `?bench=1` seam, the same grid gate, the same vsync-on discipline.

**Do not draw conclusions from FPS.** FPS is the symptom. The groups are the
explanation, and this harness exists because the two disagree.

## Run

```bash
pnpm build:website && (cd website && pnpm exec astro preview --port 4399) &
node bench/maps-trace/mapsTrace.mjs --url http://localhost:4399 --headed --scene walk-city
node bench/maps-trace/mapsTrace.mjs --url http://localhost:4399 --headed --scene all \
  --frame-details --trace-out bench/maps-trace/results/traces \
  --json bench/maps-trace/results/all.json --markdown-out bench/maps-trace/results/all.md
```

| flag | meaning |
|---|---|
| `--url <origin>` | required |
| `--scene <id\|all>` | default `walk-city`; the table lives in `scenes.mjs` |
| `--encoding spans\|atlas` | default `spans` (the page's own default is `atlas`) |
| `--headed` | **required for any paint/GPU claim.** Headless software-renders and inflates raster/paint |
| `--frame-details` | keep the ten slowest frames with their own self-time attribution |
| `--gpu-details [light\|full]` | extra viz categories; `full` is forensic and perturbs timing |
| `--trace-out <dir>` | keep the raw Chrome traces, openable in DevTools → Performance |
| `--json <file>` / `--markdown-out <file>` | full result / the decomposition tables |
| `--profile` | also take a CDP CPU profile over the same motion (see below) |
| `--no-census` | skip the geometry census |
| `--settle <ms>` | per-step tile settle, default 6000 |

## SELF TIME, NOT GROUP TOTALS

Chrome trace durations are **inclusive and deeply nested** — a `RunTask` holds
a `FunctionCall` holds a `v8.run` holds a `RunMicrotasks` — so adding up every
event whose name matches a group double-counts, badly. On the reported
street-level scene the naive group total reports **script 66 ms/frame on a
33 ms frame**; that is the double-count, not a finding.

Every number in `exclusive` is a **self** time: the event's own duration minus
its children's, charged to the nearest enclosing group. The nesting is rebuilt
per `(process, thread)` — a renderer-main `Paint` and a compositor-impl
`PrepareToDraw` overlap in wall time and neither contains the other — and
threads are classed from the trace's own `thread_name` metadata, never guessed
from event names. Those numbers DO sum, per thread, to that thread's busy time,
and `threadBusy_ms_per_frame.rendererMain` is the number an "is the main thread
the limit" question is actually about.

The naive inclusive view is still reported as `inclusive`, so a result here
stays comparable with a `chrome-trace` skill report.

## The geometry census

`scene.add` is wrapped as soon as the widget exists, so every mounted mesh is
held with its polygon count and its transform. `census()` then re-runs, in page
and against the LIVE camera, the **exact** tests the solid rasterizer's own
triangle loop runs (`render/rasterize.ts`): fan triangulation, the near-plane
NaN count, the off-grid screen-box test, and `area2 > 0`.

Two halves of that are exact without knowing the projection metrics: `area2`'s
**sign** is invariant under the positive per-axis scale and the translation
that `cellWidth`, `cellHeight`, `centerCol` and `centerRow` apply, and the
near-plane NaN does not involve them at all. The off-grid half does, so the
metrics are reconstructed the way `createGlyphScene`'s own
`baseProjectionGrid()` builds them (a measured cell plus the autoSize centring
term) and the reconstruction is **checked** — the camera target must project to
the middle of the grid — before any number counts (`census.metricsOk`).

It also simulates the **pre-projection cull runs**: contiguous runs of
`GLYPH_CULL_CHUNK_POLYGONS = 48` polygons, their world AABB, and the same
accept/reject rules `rasterizeSolid` applies. That is what makes the
perspective camera's cost measurable rather than argued, because the rule that
bites at street level is the cull's own first one — *a box that is not wholly
in front of the near plane is always accepted*, signalled by a NaN corner. A
run entirely **behind** the eye has eight NaN corners and is therefore
**accepted**, and every polygon in it is projected vertex by vertex before
being thrown away one triangle at a time.

Mesh classes come from `castShadow`/`receiveShadow`, which `@glyphcss/maps`
sets **unconditionally** at mount and which therefore identify the layer type
even while shadows are off:

| class | layers |
|---|---|
| `cast/recv` | `fill-extrusion`, `model` — the things that stand up |
| `-/recv` | `raster`, `fill`, `heatmap` — the ground |
| `-/-` | the walk-mode sky dome, and meshes for layers that stamp rather than mount |

## The CPU profile pass

`--profile` takes a CDP sampling profile over a second run of the same motion
and reports self time per function. That is what decomposes `base-raster` from
the outside: `docs/design/performance.md` did it by short-circuiting the solid
rasterizer at three points and rebuilding, which cannot be done without editing
shipped render code.

Run it against a **dev** server (`pnpm dev:website`), where Vite serves
unminified sources and the frames carry real function names. Against `astro
preview` the names are mangled; the pass detects that and says so
(`profile.names_usable`) instead of guessing. React's dev build costs ~2 ms of
extra script per frame, so use the dev profile for the SHAPE inside the
rasterizer and the preview trace for the absolute milliseconds.

## Gates

Inherited from `bench/maps-render`, for the same reasons:

- **Grid shape is a gate.** Every scene asserts the rendered base grid equals
  its `expectGrid` and the run fails otherwise, before AND after the motion.
  Cost may only fall by doing less per cell, never by producing fewer cells.
- **Non-blank guard**, skipped for walk scenes only: a street-level frame
  legitimately has sky in it, and sky is blank cells.
- **Vsync stays on**, so 16.7 ms is the floor and every multiple is a dropped
  frame.
- The shadow and key-light writes are **asserted** after they are made
  (`getShadow()` / `getKeyLight()`), because a silent no-op would make every
  shadow row in the report a lie.

## Scenes

`scenes.mjs` is the table. A scene is a page state plus a motion, and every
part of the page state is reached through the page's own `__glyphMapsBench`
seam — except `map.setShadow()` and `map.setKeyLight()`, which are exactly the
two calls the page's own `[shadows]` effect makes (the Dock's shadow row is an
`IconToggle` inside a collapsible folder, and clicking it through the DOM is a
fixture, not a measurement).

The key light is named on **every** scene on purpose:
`mapKeyLightForSunMode("off", "globe", false)` is `"headlight"`, so the page's
own default aims the key light down the camera's view axis and rewrites it
whenever the camera moves — which invalidates glyphcss's per-triangle shade
cache every frame. In a scenario whose whole point is a moving camera that is a
first-order cost, so no scene is allowed to leave it implicit.

`results/` is gitignored (`bench/.gitignore`), so raw traces and summaries stay
local.
