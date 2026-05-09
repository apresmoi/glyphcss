# polycss perf bench

A self-contained perf harness that measures polycss across its four
rendering paths — declarative HTML custom elements, the vanilla
imperative API, React, and Vue. Runs headless via Playwright for
automated A/B/C/D comparisons; serves the same pages via a static
server for human inspection in any browser.

This directory is **not a published surface**. It exists for monorepo
contributors to verify perf claims and catch render regressions.

---

## Quick start

```sh
pnpm bench:serve            # static server on :4400 with an index page
pnpm bench:perf             # build bundles + run all 4 renderers × 5 scenarios
pnpm bench:visual           # screenshot diff against bench/baselines/*.png
pnpm bench:visual --record  # capture new baselines (after intentional renderer changes)
pnpm bench:build            # just rebuild the bench bundles (rarely needed alone)
```

All scripts also work directly:

```sh
node bench/perf-bench.mjs --mesh saucer --label run1
node bench/perf-bench.mjs --mesh chicken --renderer react,vue
node bench/perf-visual.mjs --mesh chicken --tolerance 0.005
```

---

## What it measures

Five scenarios per renderer, on whichever mesh you pass via `--mesh`:

| Scenario              | What it isolates                                              |
| --------------------- | ------------------------------------------------------------- |
| `dynamic.static`      | Idle-frame floor under dynamic CSS lighting (no animation).   |
| `dynamic.light_rotate`| Cost of light-direction changes per frame (cascade re-resolution). |
| `dynamic.camera_rotate`| Cost of camera transform changes per frame (compositor cost). |
| `baked.static`        | Idle-frame floor under baked lighting.                        |
| `baked.camera_rotate` | Cost of camera transform on baked, no light-side recompute.   |

`baked + light` is intentionally excluded — the atlas re-rasterizes every
frame, which is a known disaster, not a meaningful measurement.

For each scenario, the FPS sampler captures per-frame `dt` for 5 seconds
after a 2-second warmup, then computes p50, p95, p99 frame times.
Sampling lives in `perf-shared.mjs` so every page records identically.

---

## The four pages

Every page mounts the same scene with the same mesh and the same
animation, but goes through a **different render path**. Per-frame state
changes use each path's natural mechanism so we measure what real users
would actually pay.

| Page                  | Render path                            | Per-frame state update            |
| --------------------- | -------------------------------------- | --------------------------------- |
| `perf-html.html`      | Declarative `<poly-scene>` + `<poly-mesh>` + `<poly-controls>` custom elements | `sceneEl.setAttribute(...)` — exercises the custom-element attribute observer + reflection pipeline |
| `perf-vanilla.html`   | Imperative `createPolyScene` + `createPolyControls` + `loadMesh` | `scene.setOptions({...})` — exercises just the imperative API + the renderer's internal cascade |
| `perf-react.html`     | `<PolyCamera><PolyScene><PolyControls>` JSX (React 19) | `useState` setter — full React reconciliation each frame |
| `perf-vue.html`       | `<PolyCamera><PolyScene><PolyControls>` Vue 3 (`defineComponent` + render funcs) | `ref().value = ...` — Vue's reactivity flush each frame |

What this matrix tells us, in practice:

- **html vs vanilla** — overhead of the custom-element wrapper (attribute
  parsing, MutationObserver, upgrade lifecycle).
- **vanilla vs react** — React reconciliation cost on top of polycss.
- **vanilla vs vue** — Vue reactivity cost on top of polycss.
- **react vs vue** — head-to-head framework comparison on identical work.

Each page is a self-contained HTML file; framework-specific entry code
lives in `bench/entries/react.tsx` and `bench/entries/vue.ts` (compiled
into the bundles by `build.mjs`).

---

## URL params

The pages share a URL contract via `parseUrlParams()` in `perf-shared.mjs`:

```
/perf-{html|vanilla|react|vue}.html
  ?mesh=<id>      saucer|chicken|coliseum|castle|teapot|rock1|synth-Nk
  &mode=<m>       dynamic|baked    (textureLighting)
  &motion=<m>     light|rot|none   (light direction | camera rotY | idle)
  &az=<deg>       initial light azimuth (default 50)
  &el=<deg>       initial light elevation (default 45)
```

Mesh presets live in `perf-shared.mjs`'s `PRESETS` table. To add a
preset, follow the existing shape — `url`, `mtlUrl?`, `options`,
`zoom`, `rotX`, `rotY`. Synthetic meshes (`synth-10k`, `synth-30k`,
`synth-50k`) are generated in-browser by `synth-mesh.mjs` for stress
tests above what the gallery's OBJs cover.

---

## Files

```
bench/
  README.md              ← you are here
  perf-shared.mjs        PRESETS, dirFromAzEl, parseUrlParams,
                         createPerfRecorder() (FPS counter + window.__perf__)
  perf-html.html         declarative <poly-scene> + <poly-controls>
  perf-vanilla.html      imperative createPolyScene + createPolyControls
  perf-react.html        loads polycss-react.js (JSX entry)
  perf-vue.html          loads polycss-vue.js (Vue entry)
  entries/
    react.tsx            React 19 entry: useState-driven per-frame updates
    vue.ts               Vue 3 entry: ref() + render funcs (no SFC compiler)
  synth-mesh.mjs         UV-sphere generator (synth-10k/30k/50k presets)

  build.mjs              esbuild driver: emits 4 bundles (vanilla,
                         elements, react, vue). React/ReactDOM aliased
                         to workspace-root copies so esbuild de-dupes
                         a single instance.
  perf-bench.mjs         Playwright runner. Fresh chromium per scenario,
                         ephemeral port, structured JSON output.
  perf-serve.mjs         Static :4400 server with an index page that
                         links the four perf-*.html with example params.
  perf-visual.mjs        Screenshot diff guardrail (chicken + rock1 ×
                         3 light azimuths, vanilla path only).

  baselines/             chicken-* / rock1-* PNGs the visual diff compares against.
  results/               (gitignored) per-run JSON output from perf-bench.mjs.

  polycss.js             (gitignored) vanilla + elements bundle, output of build.mjs.
  polycss-elements.js    (gitignored) custom-element side-effect register bundle.
  polycss-react.js       (gitignored) React entry bundle.
  polycss-vue.js         (gitignored) Vue entry bundle.
```

---

## How a bench run works (`perf-bench.mjs`)

1. **Build bundles** (`bench:build`). esbuild emits four files in
   `bench/`. Each consumes the polycss workspace packages aliased to
   their **source** (`packages/*/src/index.ts`), so editing source
   lands in the next `pnpm bench:build` without a tsup pass.

2. **Spin up a static server** on an ephemeral OS-assigned port. Serves
   `bench/*` and `/gallery/*` (mesh assets from `website/public/gallery/`).

3. **For each (renderer, mode, motion) cell**:
   - Launch a **fresh chromium instance**. (Reusing one browser across
     scenarios accumulates GPU/render-pipeline state and can produce
     false-zero sample counts on later scenarios — chase that down to
     iter-11 H32 in the polycss optimization-loop history.)
   - Open the renderer's perf-*.html with the right URL params.
   - Wait for `window.__perf__.ready === true`.
   - Sleep `WARMUP_MS` (default 2000), then sample
     `window.__perf__.samples` for `SAMPLE_MS` (default 5000).
   - Filter sample frame-times to drop only ≥2000 ms outliers (real
     tab pauses), keeping all slow-but-valid frames.
   - Compute p50, p95, p99 frame times → fps inverted from p50 / p95.
   - Close the browser.

4. **Output JSON** nested as `results[renderer][groupKey][leaf]`. Per-
   scenario stdout shows the running tally with a `⚠ BIMODAL` note
   when p99 ≥ 5× p50 (catches "fast median, periodic stall" patterns
   that hide regressions behind a healthy-looking p50).

### Output JSON shape

```json
{
  "mesh": "chicken",
  "polyCount": 648,
  "domNodes": 459,
  "warmup_ms": 2000,
  "sample_ms": 5000,
  "html": {
    "dynamic": {
      "static":         { "fps_p50": 120.5, "fps_p95": 30.0, ..., "is_bimodal": true },
      "light_rotate":   { ... },
      "camera_rotate":  { ... }
    },
    "baked": { ... }
  },
  "vanilla": { ... },
  "react":   { ... },
  "vue":     { ... }
}
```

### Useful flags

```sh
node bench/perf-bench.mjs \
  --mesh chicken              # PRESETS key, default: saucer
  --renderer vanilla,react    # comma-separated subset, default: all 4
  --warmup 3000               # ms before sampling, default: 2000
  --sample 8000               # ms of sampling, default: 5000
  --label run-after-fix       # JSON written to bench/results/<label>.json
  --headed                    # show the browser (debugging)
```

---

## How the visual guardrail works (`perf-visual.mjs`)

Pixel-level regression detection. Renders **chicken** (flat-color MTL)
and **rock1** (UV-textured MTL) at three fixed light azimuths
(0°, 120°, 240°), screenshots each, and compares against
`bench/baselines/<mesh>-dynamic-<frame>.png` using mean per-channel RGB
delta normalized to [0, 1].

```sh
pnpm bench:visual              # diff against baselines, exit 1 on fail
pnpm bench:visual --record     # capture new baselines instead
pnpm bench:visual --tolerance 0.005   # tighter cutoff (default 0.01)
pnpm bench:visual --mesh chicken      # check just one mesh
```

The two test meshes were chosen because each exercises a different
render path:

- **chicken** — flat-color materials (`Kd` only, no `map_Kd`) → CSS
  cascade-driven polygon path.
- **rock1** — UV-mapped texture (`map_Kd rock1-surface.jpg`) → atlas-
  blob-clipped `<i>` background path.

A regression in either path shows up here. Add a new mesh to the
`MESHES` constant (and `--record`) if you need to cover more ground.

### Atlas-ready wait

The harness polls until at least one `.polycss-scene i` has a
non-empty `style.backgroundImage` before screenshotting. This catches
the asynchronous atlas-blob handoff — `scene.add()` returns sync but
the polygons stay invisible (`opacity:0`) until the atlas canvas
finishes building and its blob URL gets assigned. A blind 800 ms wait
used to race this and produce empty baselines.

### Visual diff is vanilla-only

All four renderers ultimately go through the same polycss core, so a
renderer-side bug in the atlas / cascade / mesh pipeline shows up in
the vanilla screenshot too. Per-renderer baselines would 4× the
baseline image count and add little signal. Keep it lean.

---

## How the bundling works (`build.mjs`)

esbuild pulls every workspace polycss package directly from source via
`alias`:

```js
alias: {
  "@layoutit/polycss-core":    "packages/core/src/index.ts",
  "@layoutit/polycss":          "packages/polycss/src/index.ts",
  "@layoutit/polycss/elements": "packages/polycss/src/elements/index.ts",
  "@layoutit/polycss-react":   "packages/react/src/index.ts",
  "@layoutit/polycss-vue":     "packages/vue/src/index.ts",
}
```

That means an edit to `packages/polycss/src/api/createPolyScene.ts`
lands in the next `bench:build` — no tsup pass required, no fragile
re-export of `dist/`.

**React + ReactDOM are also explicitly aliased** to the workspace-root
`node_modules/react/index.js` and friends. Without the alias, esbuild
can resolve `react` twice (once from the entry, once from the
alias-resolved `@layoutit/polycss-react` source's nearest node_modules), which
causes `Cannot read properties of null (reading 'useRef')` because each
copy keeps its own internal hook dispatcher.

Four bundles produced, all gitignored:

| File                   | Size hint   | What's in it                         |
| ---------------------- | ----------- | ------------------------------------ |
| `polycss.js`           | ~30 KB      | Vanilla createPolyScene + controls + loadMesh + parsers |
| `polycss-elements.js`  | ~36 KB      | Custom-element auto-register side effect |
| `polycss-react.js`     | ~290 KB     | + React 19 + ReactDOM + @layoutit/polycss-react + entry |
| `polycss-vue.js`       | ~150 KB     | + Vue 3 runtime + @layoutit/polycss-vue + entry |

---

## Tips & troubleshooting

**TypeScript editor diagnostics in `entries/react.tsx` / `entries/vue.ts`.**
There's no `tsconfig.json` in `bench/` because esbuild handles the
TS/TSX compile directly and the entries reference workspace packages
that resolve via its alias config (which IDEs don't see). The "Cannot
find module" warnings are IDE-only — `pnpm bench:build` succeeds.

**`Cannot read properties of null (reading 'useRef')` after editing the bundling.**
React got de-duplicated wrong. Check that `react`, `react-dom`,
`react-dom/client`, and `react/jsx-runtime` are all aliased to the
workspace-root copies in `build.mjs`'s `ALIASES`.

**The `⚠ BIMODAL` warning fires on something that "passes".**
The scenario produced a fast median (p50 < 25 ms) but a long tail
(p99 ≥ 5× p50). That pattern shows up when there's a periodic stall —
a long task on the main thread, a GC pause that always lands during a
specific paint, etc. It's worth checking the actual frame-time trace
even if p50 looks healthy.

**`sample_count` is suspiciously low (e.g. 1, 2, 3).**
The scenario was running so slow that fewer than expected frames
landed in the sample window, OR most frames were filtered as
`dt > 2000ms` (real tab pauses). Check `sample_count_filtered` —
if non-zero, those were dropped outliers. If zero and count is tiny,
the scenario genuinely runs at < 1 fps.

**Browser hangs or screenshots come up empty.**
The atlas-ready poll has a 5 s timeout. If it expires you'll get a
`TimeoutError`. That usually means a polygon never got
`backgroundImage` set — could be a renderer regression. Open the page
in `--headed` mode and check the console.

**Recording a baseline that ends up empty / wrong.**
The atlas-ready poll requires *at least one* `<i>` with a non-empty
`backgroundImage`. If that loosened condition isn't enough for a
specific mesh (e.g. all polys are culled at the chosen camera angle),
either pick a non-degenerate angle or tighten the wait condition for
that mesh.
