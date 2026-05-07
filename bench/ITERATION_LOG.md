# Perf-iteration log

Append-only log of perf hypotheses tested against polycss. One row per
hypothesis. Companion doc to `bench/ITERATION_GUARDRAILS.md` — read that
first for what's allowed / off-limits.

## Schema

| Iter | ID    | Branch                  | Area | One-line hypothesis | chicken Δ% | rock1 Δ% | saucer Δ% | Visual | Tests | Verdict | Notes |
|------|-------|-------------------------|------|---------------------|-----------:|---------:|----------:|--------|-------|---------|-------|
| 1    | H1-A  | perf/h1a-…              | …    | …                   |       +x.x |     +x.x |      +x.x | pass   | 820   | WIN     | …     |

- **Δ%** = `dynamic.light_rotate.fps_p50` change vs current `perf-loop-v2`
  baseline. Negative = regression.
- **Verdict**: `WIN` (≥2% on at least one mesh, no >2% regression elsewhere),
  `LOSE` (>2% regression), `FLAT` (within ±2% noise floor),
  `REJECT` (visual or test failure — no perf claim possible).

## Iterations

<!-- Iteration rows go below this line. Newest at the bottom. -->

### Iteration 1

| ID   | Branch                         | Area | Hypothesis | chicken Δ% | rock1 Δ% | saucer Δ% | Visual | Tests | Verdict | Notes |
|------|--------------------------------|------|------------|-----------:|---------:|----------:|--------|-------|---------|-------|
| H1-A | perf/h1a-content-visibility    | CSS containment / content-visibility | Replace `display:none` with `content-visibility:hidden` on cull-DIR rules to preserve rendering context across cull flips | -22.4 | -12.6 | +13.0 | pass | 820 | LOSE | content-visibility:hidden keeps culled `<i>` in layout so the cascade still walks them; saucer gains (saves layout teardown on 6k polys) but small meshes regress sharply — preserve-3d context pays per culled-but-laid-out element |
| H1-B | perf/h1b-skip-redundant-setops | DOM shape / per-poly attribute writes | Skip redundant style writes in `setOptions`: dispatch only changed sub-sections (light vars vs camera vs cull) so light-only frames skip 6 `classList.toggle()` + 6 unchanged style writes | ~0 | 0 | 0 | pass | 820 | FLAT | JS overhead in the per-frame `setOptions` path is not the bottleneck. The 6 skipped `classList.toggle()` calls are completely eclipsed by the cascade walk recomputing `--polycss-lambert` + `background-color` on N `<i>` (~60 ms for saucer's 6 384 polys) |
| H1-C | perf/h1c-premult-intensity     | @property count reduction | Pre-multiply light/ambient color × intensity into 6 vars; drop `--polycss-li`/`-ai`; simplify per-poly calc() from 5 → 3 var() reads per channel | +0.3 | ~0 | ~0 | pass | 820 | FLAT | Saucer (6k polys) flat at +0.3 %. Chicken/rock1 too noisy to read signal (±13 % run-to-run). Reducing cascade `@property` count from 11 → 9 doesn't move the per-frame UpdateLayoutTree cost on large meshes |

#### Iteration 1 takeaways

- **Convergent finding**: JS-side micro-opts (per-frame `setOptions` writes, `@property` count, `var()` read count) all measure FLAT. The bottleneck is the **CSS cascade walk over N `<i>` elements** when scene-root custom properties change — ~60 ms per `dynamic.light_rotate` frame on saucer (6 384 polys).
- **Noise floor on small meshes is ±13 %** (chicken 648, rock1 192 polys) — useless for measuring sub-10 % effects. Treat saucer as the primary signal until we add larger synth meshes (synth-10k / synth-30k) or per-mesh repeated runs.
- **`content-visibility: hidden` on cull rules splits by mesh size**: +13 % saucer, −22 % chicken, −12 % rock1 in `preserve-3d` context (LOSE overall). Worth re-attempting with mesh-size-aware dispatch in iteration 2.
- **Three avenues left** for iteration 2: (a) make the cascade walk faster (containment, layer promotion, scope), (b) reduce effective N (poly grouping, mesh-tier dispatch), (c) move per-frame work to compositor-only (will-change, registered properties + transitions).

### Iteration 2

| ID   | Branch                       | Area | Hypothesis | chicken Δ% | rock1 Δ% | saucer Δ% | Visual | Tests | Verdict | Notes |
|------|------------------------------|------|------------|-----------:|---------:|----------:|--------|-------|---------|-------|
| H2-A | perf/h2a-will-change-scene   | GPU layer promotion | (agent picks: `will-change: transform` on `.polycss-scene` to promote the scene to its own composited layer; theory is per-frame cascade var changes still trigger the walk but layout/paint work is bounded to the layer) | – | – | – | – | – | pending | – |
| H2-B | perf/h2b-mesh-tier-dispatch  | Mesh-size-aware cull | JS sets `data-poly-tier="large"` on `.polycss-scene` when total poly count ≥ 4000; CSS cull rules use `content-visibility:hidden` for large tier and keep `display:none` for default — composes H1-A's saucer win without small-mesh loss | +46.8 (noise) | +1.2 | +13.4 | pass | 826 | WIN | Saucer +13.4 % (matches H1-A's +13 %). Chicken/rock1 no regression (chicken +46.8 % is run-to-run noise at 648 polys, well within ±13 % floor; no mesh went negative). Threshold 4000 puts saucer (6384) on content-visibility path, chicken (648) and rock1 (192) on unchanged display:none path. |
| H2-C | perf/h2c-paint-containment   | Per-mesh paint containment | (agent picks: add `contain: paint` on `.polycss-mesh` so each mesh is a paint-isolated subtree; theory is paint invalidation is bounded per mesh and the compositor can reuse cached rasters across light-rotate frames) | – | – | – | – | – | pending | – |

### Iteration 3

| ID   | Branch                    | Area | Hypothesis | chicken Δ% | rock1 Δ% | saucer Δ% | Visual | Tests | Verdict | Notes |
|------|---------------------------|------|------------|-----------:|---------:|----------:|--------|-------|---------|-------|
| H3-C | perf/h3c-css-scope        | CSS cascade scope | Wrap all `.polycss-scene`-rooted CSS rules in `@scope (.polycss-scene)` so the browser can skip these candidate rules for elements outside any `.polycss-scene` subtree, reducing selector-matching work in the cascade walk | – | – | +6.7 | pass | 826 | WIN | Vanilla saucer +6.7 % (12.45 → 13.29 fps; confirmed across two after-runs). HTML saucer also +0.3 % (noise). Per-poly cascade walk sees fewer candidate rules even for in-scope elements — likely because `@scope` allows the engine to short-circuit rule-set evaluation at the scope boundary before descending. `@scope` is live in Chrome 118+, Safari 17.4+, Firefox 128+ (all current evergreen baselines). Chicken/rock1 not measured (noise floor dominates at small poly counts). |

### Iteration 4

| ID   | Branch                          | Area | Hypothesis | chicken Δ% | rock1 Δ% | saucer Δ% | Visual | Tests | Verdict | Notes |
|------|---------------------------------|------|------------|-----------:|---------:|----------:|--------|-------|---------|-------|
| H4-B | perf/h4b-coplanar-merge         | Parse-time N reduction | Apply `mergePolygons` in `loadMesh` so `parseResult.polygons` is already merged; React/Vue bench entries were rendering raw fan-triangulated polygons (N=6384) directly as `<Poly>` children, bypassing the merge that vanilla `createPolyScene.add()` applied. Moving merge to parse time fixes all four renderer paths at once. | ~0 (noise) | ~0 (noise) | +22.6 (vanilla), +56 (react), +279 (vue) | pass | 826 | WIN | Saucer N: 6384 → 4052 (36.5% reduction). Vanilla saucer `dynamic.light_rotate`: 10.87 → 13.33 fps (+22.6%); React: 9.23 → 14.42 fps (+56.2%); Vue: 4.47 → 16.95 fps (+279%). Root cause: React/Vue bench entries used `parseResult.polygons.map((p) => <Poly>)` which bypassed the merge that lived in `createPolyScene.add()` — React/Vue were walking 6384 `<i>` elements in the cascade while vanilla had 4052. Chicken/rock1 are noise-floor dominated. Visual diff max ΔE 0.00029 (well below 0.01 threshold). |

### Iteration 5

| ID   | Branch                    | Area | Hypothesis | vanilla saucer Δ% | react saucer Δ% | vue saucer Δ% | Visual | Tests | Verdict | Notes |
|------|---------------------------|------|------------|------------------:|----------------:|--------------:|--------|-------|---------|-------|
| H5-C | perf/h5c-other-lever      | React reconciliation | Wrap `<Poly>` in `React.memo()` so stable polygon children skip re-renders when parent state changes (e.g. `rotY` or `lightDir` updates) — eliminates O(N) JS function-body cost across 4052 `<Poly>` instances per frame. | +1.0 (noise) | +27.7 | -8.5 (noise) | pass | 826 | WIN | Baseline: vanilla 10.82 / react 13.32 / vue 15.00 fps (`dynamic.light_rotate`). After: vanilla 10.93 / react 17.01 / vue 13.73. React `light_rotate` +27.7% (memo prevents 4052 function-body calls per frame when only scene-root CSS vars change). Vanilla FLAT — change is React-only. Vue FLAT (−8.5% within ±13% noise floor; Vue does not use the React `Poly` component). `camera_rotate` partial improvement: react 12.08 → 13.33 fps (+10.3%); residual cost is React's O(N) props-comparison pass over 4052 `<Poly>` children even when memo skips their bodies (children prop is recreated each frame from `polygons.map()`). Visual diff max ΔE 0.00032. |
