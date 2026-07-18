# Glyphcss — agent guide

This file is the single source of truth for AI coding agents (Claude Code, Cursor, etc.). `CLAUDE.md` is a symlink to this file — **always edit `AGENTS.md`, never `CLAUDE.md`**. The constraints below describe the current design and the rules we work under; if a request conflicts with one of them, push back before doing it.

## What this repo is

`glyphcss` is an ASCII polygon-mesh renderer for the DOM. It projects 3D meshes to 2D and rasterises them as monospace text inside a single `<pre>` element. No WebGL, no canvas-per-frame, no per-polygon DOM nodes.

Originally forked from polycss (a CSS-based polygon paint engine). The mesh math, OBJ/glTF/GLB parsers, scene composition tree, camera math, and input controls carried over intact. The paint backend is entirely new: instead of emitting one CSS-transformed DOM leaf per polygon, the rasteriser walks all polygons, fills a `cols × rows` character grid, and writes one text string to `<pre>.textContent`.

Monorepo layout (pnpm workspaces):

| Package | npm name | Role |
|---|---|---|
| `packages/core` | `@glyphcss/core` | Pure math: Vec3, Polygon, scene, camera, mesh ops, parsers. Zero browser globals. |
| `packages/glyphcss` | `glyphcss` | Vanilla renderer + custom elements (`<glyph-scene>`, etc.). Owns the ASCII rasteriser, custom element definitions, and imperative API. |
| `packages/react` | `@glyphcss/react` | React components + hooks. Thin wrapper over core + glyphcss. |
| `packages/vue` | `@glyphcss/vue` | Vue 3 mirror of the React package. |
| `packages/compile` | `@glyphcss/compile` | Build-time static compiler: 3D mesh → static `<pre>` ASCII. Vite plugin, CLI, Node API. Node-only (fs); reuses `compileScene` (pure) from glyphcss. |
| `packages/effects` | `@glyphcss/effects` | Framework-agnostic spatial effect definitions and stock surface/scene effects. Depends on glyphcss's generic effect protocol; never owns the renderer or animation clock. |
| `packages/fonts` | `@glyphcss/fonts` | Framework-agnostic font/text → extruded polygon-mesh generation. |
| `website` | `@glyphcss/website` | Astro + Starlight docs site. Not published. |

Public API is **mirrored** across React and Vue. Adding a hook on one side without adding the matching composable on the other is not acceptable (see "Cross-package discipline" below).

### Three-like parity surface

The native glyphcss API keeps glyphcss/voxcss conventions. For agent-friendly Three.js ports, the monorepo also exposes explicit `*/three` subpaths:

- `@glyphcss/core/three` — pure Three-like math wrappers and transforms.
- `glyphcss/three` — the core Three-like surface plus `compileScene` and geometry helpers for vanilla/static usage.
- `@glyphcss/react/three` and `@glyphcss/vue/three` — mirrored framework components: `GlyphThreePerspectiveCamera`, `GlyphThreeOrthographicCamera`, and `GlyphThreeMesh`.

These subpaths intentionally use Three-compatible public names and units: `Vector3`, `Euler`, `Object3D`, `PerspectiveCamera`, `OrthographicCamera`, `DirectionalLight`, `AmbientLight`, radians for object rotations, Y-up authoring coordinates, and Three camera frustum semantics. They are adapters over glyphcss, not a Three.js runtime dependency. Geometry authored in that surface is converted to native glyphcss coordinates with `transformPolygonsToGlyph`; the Y-up → Z-up axis map is `[x, -z, y]` so winding and Lambert lighting stay right-handed. Three-like lights preserve color and intensity; `DirectionalLight.toGlyphDirectionalLight()` converts Three's `target → position` source vector into glyphcss's native directional-light convention.

## Rendering model

**One render pass → one `<pre>.textContent` assignment.** On every camera or scene state change, the rasteriser:

1. Walks all mounted meshes in scene order.
2. Transforms polygon vertices through the camera matrix to get 2D projected positions.
3. Fills a `cols × rows` character grid: depth-tests overlapping polygons, picks a glyph per cell based on the render mode.
4. Joins all cells into a single string and writes it to `<pre>.textContent` exactly once.

There are no per-polygon DOM elements. There is no CSS `matrix3d`. The base `<pre>` is the render surface for all shared-resolution meshes.

**Post-rasterize cell effects.** A scene's optional `transformCells` hook runs after rasterization and depth testing but before the final grid is stringified. It receives a `CellGrid` and may change cell characters or colors without adding DOM nodes or extra writes. In solid mode, requirement-gated optional buffers expose the final shaded scalar (`shade`), depth-winning world position (`worldPosition`), geometric face normal (`normal`), and authored perspective-correct UV (`surfaceUv`). Empty or unavailable vector/UV cells contain `NaN`. Under supersampling, world position, normal, and UV come from the same covered subcell nearest the output-cell center; shade is box-filtered with uncovered samples contributing zero. The hook remains inside the render pass: the transformed grid is still joined once and written to the `<pre>` exactly once.

**Retained Glyph Effects.** `scene.addEffectLayer()` mounts ordered, scene-root appearance programs without adding output elements. The first geometry render retains an immutable `CellGrid` for the base `<pre>` and every detail `<pre>`; changing `layer.params`, opacity, blend, order, or enabled state then recomposes and safely encodes those retained grids without transforming or projecting the mesh again. The handle's flat `params` object has stable identity, validates known string keys, accepts Anime.js/private symbol metadata, and automatically schedules a coalesced effect transaction. Generic effects run before the legacy `transformCells` escape hatch. An effect-only transaction stages every affected string before assigning each `<pre>` at most once. With no mounted effect and no hook, the original direct renderer remains byte-identical and does not allocate retained effect frames.

The current generic compositor supports `over`/`replace`, `"surfaces"`/`"viewport"` targets, canonical base-grid affines across detail densities, and the `baseColor`, `baseShade`, `depth`, `normal`, `worldPosition`, and `uv0` requested inputs. Hard surface requirements are solid-mode-only; `optionalRequirements` retain those inputs in solid mode but allow a program-defined fallback in wireframe/voxel modes. Mesh-handle targets, scene-image sampling, program scratch buffers, surface-key/UV-footprint inputs, and static compile/export evaluation are not implemented yet and reject explicitly. `@glyphcss/effects` supplies Matrix rain, flow text, scan, wipe, scramble, glitch, noise dissolve, ripple, and **field synth** as reusable definitions. `field-synth` is a small composable synth — up to six oscillators (`fieldN` × `waveN`: radial/linearX/linearY/diagonal/angular/spiral/noise × sin/triangle/saw/square, each with `freqN`/`speedN`/`ampN`), combined (`add`/`multiply`/`max`/`min`/`difference`) into one scalar field mapped to a glyph ramp + color, over `space` — for emergent moiré/interference patterns. `ampN` is a MIX WEIGHT (blends the result toward `combine(result, voiceN)` per voice, not a signal gain), so low amp gently mixes instead of `multiply` collapsing to flat; `amp 0` skips the voice. `lit` (0..1) modulates output color by the surface Lambert shade so lighting reads through the texture. `voiceColors` blends each active voice's `colorN` by its contribution (per-voice color composition); off keeps the `color`/`colorB`/`gradient` value-gradient. `@glyphcss/effects` also exports `GlyphRamps` (named character-sets: Fade/Blocks/Shades/Dots/Binary/ASCII/Hatch/Stars/Digital). The **`/synth` website page** is the front-end: dual-sidebar modular synth (add/remove voice cards with live per-voice previews + a color swatch, icon multi-toggles, per-voice mix; Stage/Mix/Output/Lighting Dock; live preset gallery), full patch persisted to the URL. For surfaces it gives each face a local 0..1 UV so patterns map per-face. For Matrix/flow/scan, `space: "auto"` resolves authored UVs first and then generated world-surface coordinates; `space: "surface"` forces the generated orientation-aware mapping, while `space: "scene"` uses projected scene coordinates. On generated surface coordinates, `down` is world `-Z` projected into each geometric face's tangent plane; coplanar polygons agree, differently oriented polygons derive different downhill directions, and a plane perpendicular to that vector gets a deterministic pseudo-random in-plane fallback. Generated Matrix rain fits each quantized coplanar surface basis to projected glyph-cell space, orthogonalizes its visible flow and lane vectors, and evaluates both sparse trail membership and glyph phase in that same face-local field. The word therefore shares the strand's direction and projected-cell velocity on sheared or foreshortened faces, remains ordered when a periodic strand wraps, and does not mutate in place while its mask moves separately. Active rain cells have full logical coverage; sparsity comes from lane selection and trail length, not fractional tail coverage that the compositor would dither into broken strands. Matrix also supports original surface colors or a configurable shaded monochrome color. The package owns no clock. Applications animate explicit parameters such as `time` directly or through Anime.js. React and Vue mirror the scene-root `<GlyphEffectLayer>` wrapper, and custom HTML configures `<glyph-effect-layer>` through JavaScript properties/`configure()` because executable definitions are values, not JSON attributes. `ANIMATIONS.md` records both this implemented slice and the richer approved graph/sampling architecture that remains.

### Per-mesh detail layers

By default every mesh renders into that one shared base `<pre>`. A mesh can opt into **its own resolution** — set `density` (a multiplier: `density: 3` → 3× the scene's glyph resolution, cell = base ÷ density, isotropic, same on-screen size) or the low-level `fontSize` / `lineHeight` (which override `density`). Such a mesh "pops out" into its **own silhouette-fitted, CSS-translated `<pre>`** rendered at that cell size — so a hero mesh carries far more detail while the rest of the scene stays cheap in the shared grid. Browser-only (needs layout to measure cells); works with any camera (ortho / perspective / FPV) — detail meshes render **in place** (real world positions, scaled zoom, offset projection center), and the detail grid is clamped to the viewport so a camera near/inside a mesh can't blow up the render. This is **not** a group/tree concept — it's a per-mesh property on the flat mesh list.

`transparent: true` (default `false` = opaque) makes a mesh see-through (x-ray): it neither occludes nor is occluded. Because a mesh in the shared `<pre>` always occludes (one depth buffer), declaring `transparent` also pops the mesh into its own `<pre>` — separation happens for custom cell metrics **or** transparency.

**Cross-layer occlusion.** Opaque meshes occlude each other across `<pre>` layers via a shared camera-depth pass: `computeOcclusionIds` rasterises all opaque geometry into one id-map (nearest layer per cell), and each layer's `rasterize` blanks cells a *different* layer owns (a layer never occludes itself). Integrated into `rasterize` (an `occlusion` `OcclusionMap` input) so it works for plain text **and** colored spans, and self-disables (zero cost) when no opaque detail mesh exists. Within the shared `<pre>`, meshes occlude each other for free via the normal per-cell depth buffer. The occlusion id-map is built at the **scene's supersample** resolution (same offset-scaling wrapper `rasterizeSolid` uses), so the world's supersampled silhouette and its id-map hole coincide subcell-for-subcell — no 1-cell seam at the world/entity boundary. **Detail layers still render at `supersample: 1`** (already high-res; coverage AA buys little and costs a full extra pass) and sample the supersampled id-map via an `×ss` cell affine. Both world-hole and detail-fill clip to the same id-map footprint, so they coincide (no black-hole, no seam). No-op when `supersample: 1` (id-map = output resolution, byte-identical to the non-supersampled path).

These options mirror across React/Vue `<GlyphMesh>` and the `<glyph-mesh>` custom element (`density`, `font-size`, `line-height`, `transparent`). **Static compile (`compileScene`, `GlyphSceneStatic`, the CLI/Vite plugin) and the interactive/CodePen export take a flat polygon list — they cannot represent per-mesh detail layers**, so per-mesh density/transparent is a runtime-only feature there (the gallery's scene-wide "Density" slider drives the render font-size instead, which *does* export).

### Render modes

| Mode | How cells are filled |
|---|---|
| `wireframe` | Polygon edges rasterised as ASCII rules; glyph weight scales with edge prominence |
| `solid` | Filled cells; glyph picked from a `CharRamp` by Lambert-shaded intensity |
| `voxel` | Cube-aligned geometry; face normals drive glyph selection |

### Shadows

Shadows are opt-in per mesh. To enable them, set `shadow: GlyphShadowOptions` on the scene (undefined by default = no shadows). Then flag individual meshes with `castShadow` (default false) and/or `receiveShadow` (default false). A mesh that is both cast and receive self-shadows — this is free because glyphcss uses a **shadow-map** technique (render depth from the light, compare per cell) rather than polycss's analytic SVG projection. `GlyphGround` defaults `receiveShadow=true`, `castShadow=false`.

| Option | Type | Default | Description |
|---|---|---|---|
| `shadow.color` | `string` | `"#000000"` | Shadow tint hex color |
| `shadow.opacity` | `number` | `0.25` | Darkness 0..1 toward `color` |
| `shadow.lift` | `number` | `0.05` | Depth bias — prevents self-shadow acne on flat lit surfaces |
| `shadow.maxExtend` | `number` | `2000` | Half-extent of the light-space projection volume |

### Hotspots

Hotspots are 3D anchors that produce positioned 2D hitboxes in the consumer's DOM. The rasteriser projects each `Hotspot.at` point through the camera and returns a `HotspotCell` (col, row, depth, visible). Consumers absolute-position a `<div>` at the cell — the rasteriser only computes the position; it does not emit the DOM node.

## Compilation (static & interactive)

Because `rasterize` is pure (geometry + camera → string), a scene can be rendered **at build time / on the server**, not just in the browser. This is glyphcss's static story — the render *is text*, so it inlines into HTML with no runtime.

- **`compileScene(opts)`** (in `glyphcss`, pure) — polygons + camera + options → the `<pre>` string. **Byte-identical to the runtime render** for the same inputs; same defaults as `createGlyphScene`. The foundation for every adapter.
- **`@glyphcss/compile`** — Node adapters around `compileScene`: `loadMeshFromFile`, `compileFile`, a **Vite plugin** (`import x from "./m.glb?glyph&…"` → baked `<pre>`), a **CLI** (`glyphcss-compile`), and `compileInteractive`.
- **`GlyphSceneStatic`** (React + Vue) — SSR/SSG component that renders the compiled `<pre>` with no client runtime (mirror of each other; static counterpart to `GlyphScene`).
- **Frame-roll export** — `buildGlyphFramesExport(polygons, { frameCount, durationSec, rotX, rotY, zoom, … })` (pure, browser-safe, in `glyphcss`): bakes a turntable of `frameCount` full `compileScene` renders, stacks them in one `<pre>`, and cycles them with a pure-CSS `steps()` animation — **zero runtime JS**, faithful per-face color, instant paint. Trade-offs: discrete angles (smoothness ∝ `frameCount`), fixed resolution, and payload grows **linearly** with `frameCount` (a colored frame costs several KB gzipped even after cross-frame color-class dedupe) — good for a handful of frames, not for a long or continuous loop.
- **Interactive export** — `buildGlyphInteractiveExport(polygons, { interactions })` (pure, browser-safe, in `glyphcss`): the declared interactions (`orbit`/`zoom`/`pan`/`fpv`) drive **both** the wired control (only that one is imported → the snippet tree-shakes) **and** the decimation budget (`decimatePolygons` — coarser for orbit, finer when `zoom`/`fpv` let the camera approach). Output is a self-contained CDN+inlined-mesh snippet; `glyphCodepenPrefill` turns it into a CodePen POST (the gallery's "CodePen" button). Less declared interactivity = less mesh + less runtime shipped. An optional `effect: { id, params, blend?, timeScale? }` mounts a live **stock** `@glyphcss/effects` layer: the snippet adds a second `import { getGlyphEffect } from "https://esm.sh/@glyphcss/effects@<ver>?deps=glyphcss@<ver>"` (same `<ver>` as the glyphcss import; `?deps` dedupes the shared glyphcss module instance), resolves the effect by id at runtime (`glyphcss` itself never imports `@glyphcss/effects` — that dependency only points one way), calls `scene.addEffectLayer(...)` after the scene/controls are wired, and — when `timeScale > 0` — appends a small `requestAnimationFrame` loop driving `params.time`. This is the export for a **moving-camera or multi-effect** scene (the gallery's "CodePen" button); it ships the glyphcss + effects runtime from the CDN.
- **Static effect export (field-synth)** — `buildGlyphFieldSynthStaticExport(polygons, { params, blend, loopSeconds, cols, rows, … })` (pure, browser-safe, in `@glyphcss/effects` — not `glyphcss`, since it needs a stock effect's own math): for an **effect-only, static-camera** scene (fixed mesh + camera, only the field-synth texture animating over `time`), bakes the static base grid plus each covered cell's resolved field-synth domain coordinate **once**, reusing glyphcss's real rasterizer + effect-input machinery, then ships a tiny hand-written vanilla-JS field-synth evaluator that recomputes the pattern every `requestAnimationFrame` — **zero imports, zero CDN, zero `glyphcss`/`@glyphcss/*` at runtime**. Fixed payload regardless of loop length and continuously smooth, unlike a frame-roll export whose payload grows with frame count; see `bench/static-effect-export.md` for the size/quality trade-off that motivated shipping this over more prebaked frames. Always reads the layer's **real** `blend` (`over` vs `replace`), never the effect definition's `defaultBlend` UI metadata. Field-synth only today — the `/synth` page's export button is the reference caller; a future effect id needs its own exported coordinate resolver (mirroring `fieldSynthCoordinate`) plus a hand-written inlined-JS port of its per-cell math, since there's no way to ship an arbitrary `GlyphEffectProgram.evaluate()` without shipping glyphcss's effect runtime alongside it.

Dynamic Glyph Effect layers are otherwise runtime-only: `compileScene`/`GlyphSceneStatic` and the frame-roll export do not serialize or evaluate a mounted effect. Two paths do carry a live effect: the **interactive/CodePen exporter** mounts a **stock** effect by id from the `@glyphcss/effects` CDN (a custom `defineGlyphEffect` can't cross the CDN boundary), and **`buildGlyphFieldSynthStaticExport`** bakes an effect-only, static-camera field-synth scene into a self-contained inlined-JS pen. Neither generalizes to a moving camera plus effect, arbitrary effects in a static bake, or geometry animation.

## No per-frame DOM mutation

The invariant we hold: **each render cycle writes each `<pre>` exactly once** — the base `<pre>` plus one write per per-mesh detail layer (and one `transform` per detail layer for positioning). Cell-by-cell DOM patching, or multiple writes to the same `<pre>` per cycle, are not acceptable.

Hotspot positions update via a single inline-style assignment per hotspot element, not via DOM rebuild.

Controls (orbit, map, first-person) mutate a single camera state object; the rasteriser reads that object when it renders. The JS ↔ DOM boundary is: camera event → update camera state object → rasterise → write one string.

**Interactive LOD.** Cost scales ~quadratically with scene-wide density (font ÷ d → cells × d²), so a tiny cell (high density / small font) can blow the frame budget while dragging (Script + browser Layout/Paint of a huge `<pre>`; colored output's `innerHTML` spans add ParseHTML/Style/Paint on top). The `interactiveDownscale` scene option (default `1` = off) renders at `1/n` resolution *while a control is actively dragging* and restores full detail on release — same on-screen size (camera `zoom` unchanged; bigger cell → fewer cells), just coarser mid-gesture. All three controls signal this automatically via the shared listener registry (`emitInteraction` → `scene.setInteracting`); consumers can call `scene.setInteracting(active)` for custom interaction sources. Mirrored across React/Vue `<GlyphScene interactiveDownscale>` and `<glyph-scene interactive-downscale>`.

## Naming

Every public export gets a `Glyph` prefix. Exceptions are generic math/geometry types (`Vec2`, `Vec3`, `Polygon`, `TextureTriangle`) and the explicit `*/three` compatibility subpaths, where Three-compatible names are the point of the API. React/Vue components in those subpaths still use the `GlyphThree` prefix.

- **Hooks/composables:** `useGlyphCamera`, `useGlyphMesh`, `useGlyphSceneContext`, `useGlyphAnimation`.
- **Components:** `GlyphScene`, `GlyphSceneStatic` (SSR/build-time `<pre>`, no runtime), `GlyphEffectLayer`, `GlyphPerspectiveCamera`, `GlyphOrthographicCamera`, `GlyphOrbitControls`, `GlyphMapControls`, `GlyphFirstPersonControls`, `GlyphAxesHelper`, `GlyphDirectionalLightHelper`, `GlyphThreePerspectiveCamera`, `GlyphThreeOrthographicCamera`, `GlyphThreeMesh`.
- **Types:** `GlyphDirectionalLight`, `GlyphAmbientLight`, `GlyphEffectDefinition`, `GlyphEffectProgram`, `GlyphEffectLayerHandle`, `GlyphAnimationMixer`, `GlyphAnimationAction`, `GlyphAnimationClip`, `GlyphAnimationTarget`.
- **Functions:** `defineGlyphEffect`, `parseGlyphEffectColor`, `createGlyphAnimationMixer`, `injectGlyphBaseStyles`, `compileScene` (pure, DOM-less render → `<pre>` string), `buildGlyphFramesExport` (turntable → prebaked-frame `steps()` export), `buildGlyphInteractiveExport` / `glyphCodepenPrefill` (polygons + declared interactions → portable self-contained snippet), `buildGlyphFieldSynthStaticExport` (`@glyphcss/effects` — effect-only static-camera scene → self-contained inlined-JS pen), `decimatePolygons` (core — resolution-target mesh simplification).
- **Vanilla factories:** `createGlyphScene`, `createGlyphCamera` (ortho alias), `createGlyphPerspectiveCamera`, `createGlyphOrthographicCamera`, `createGlyphOrbitControls`, `createGlyphMapControls`, `createGlyphFirstPersonControls`.
- **HTML custom elements:** `glyph-` prefix + kebab-case. Existing tags: `<glyph-scene>`, `<glyph-mesh>`, `<glyph-effect-layer>`, `<glyph-hotspot>`, `<glyph-perspective-camera>`, `<glyph-orthographic-camera>`, `<glyph-camera>` (ortho alias), `<glyph-orbit-controls>`, `<glyph-map-controls>`, `<glyph-first-person-controls>`. Any new element follows the same shape.
- `GlyphCamera` is the ergonomic default alias — it resolves to `GlyphOrthographicCamera`. The voxel render mode and iso/diagrammatic scenes are glyphcss's differentiator; ortho is the more representative default.

## Numeric conventions

These conventions are the native glyphcss/voxcss surface. The `*/three` subpaths are the exception: they use Three.js units and frames, then convert internally.

- **Rotation units: degrees.** `rotX`, `rotY` on cameras and the `rotation` prop on meshes are all in degrees (XYZ Euler). `rotX=65, rotY=45` is the classic isometric-ish viewpoint. Do not use radians — the asciss-lineage radian convention has been replaced.
- **Camera `zoom`: absolute, CSS pixels per world unit.** `zoom=50` means one world unit maps to 50 CSS px. This matches voxcss/polycss's public camera API; internally those engines author geometry at `BASE_TILE=50` and apply `scale(zoom / BASE_TILE)`. This is not a fraction of the viewport.
- **Perspective `distance`: default `0`.** With the default CSS-perspective projection, `distance` is a CSS-pixel pull-back matching voxcss/polycss. In legacy `perspective: 0` mode only, it keeps the old world-unit pinhole semantics.
- **Directional light `direction`: source-vector convention.** `GlyphDirectionalLight.direction` is the unit vector from the shaded surface toward the distant light source, matching polycss/voxcss. A vector pointing up-right-forward lights faces whose outward normals point up-right-forward.

## Cross-package discipline

The React and Vue packages are mirror images. **Any public API change in one must land in the other in the same PR.** Same names, same arguments, same defaults, same return shapes (allowing for idiomatic differences — refs vs reactives, `useEffect` vs `watchEffect`).

When you change `packages/glyphcss` or `packages/core` in a way that affects the public surface (new option, renamed export, changed default), the React and Vue bindings update in the same PR. Don't ship a glyphcss change that leaves the bindings stale.

Before opening a PR:

- [ ] If I touched a React component/hook, the Vue composable/component matches.
- [ ] If I touched a Vue component/composable, the React component/hook matches.
- [ ] If I added an option to a `glyphcss` factory, both bindings expose it.
- [ ] If I renamed a `core` export, every package that imports it is updated.
- [ ] Website docs (`website/src/content/docs/**`) and READMEs reflect any user-visible change.
- [ ] If I changed a render mode, naming convention, or the DOM-mutation rules, `AGENTS.md` reflects the new state in this same PR.

## Iterating on the system

The rendering model, naming conventions, and cross-package contracts described in this document are the *current* design — not frozen. Render modes can be added or removed, the public API will keep evolving. The rules for evolving them:

- **AGENTS.md is the canonical reference.** Edit it directly; `CLAUDE.md` is just a symlink that exists so Claude Code finds the same content.
- **Architectural changes require user approval.** Dropping a render mode, adding a new one, renaming a public-facing convention, changing what JS is allowed in the render path — propose, don't decide. The user (human) is the architect.
- **Same-PR sync.** Any PR that adds, removes, or materially changes a render mode, naming rule, or cross-package contract must update `AGENTS.md` in the same PR. An API change that lands without an AGENTS.md update is an incomplete change.
- **Don't append-only.** Prune content that no longer reflects the codebase. If a mode is dropped, remove its row from the table. If a hook is renamed, update the naming section in place — don't list the old name "for reference".

## Backward compatibility

- **No BC shims.** Clean breaks only. No re-export aliases for renamed symbols. No `@deprecated` wrappers. If the API changes, callers update.
- This applies across the multi-package monorepo — published packages move together.

## Commits & PRs

- Conventional commits format. Single-line subject. No body unless genuinely useful.
- **NO `Co-Authored-By: Claude` trailer.**
- **NO "🤖 Generated with Claude Code" footer in PR bodies, commit messages, issue comments, or anywhere else.**
- Never amend commits. New follow-up commits only. (Pre-commit hook failures: fix and create a new commit, don't `--amend`.)
- Don't auto-push subagent exploration branches — local commits only. The user pushes when ready.
- `main` is **not** branch-protected (so the `Publish packages` workflow can push the release commit + tag directly, like voxcss). Still use PRs for feature work by convention — but it's not enforced, and direct pushes to `main` are allowed.
- **Release = one click.** Run the `Publish packages` workflow (Actions tab → "Run workflow", choose `patch`/`minor`/`major`, or `gh workflow run publish-packages.yml -f bump=patch`). It bumps every package in lockstep, builds, publishes to npm, and commits + tags `v<X.Y.Z>` back to `main`.

## Tests & build

- Refactors must keep all tests passing. Don't delete or weaken assertions to make a refactor go through.
- If a renamed export still has tests for the old name, rename the test imports — don't keep the old export as an alias just to satisfy them.
- `pnpm test` runs the full suite across every test-bearing package.
- **`pnpm build` is mandatory before opening a PR.** Vitest doesn't catch DTS / declaration build failures (tsup runs strict type-checking that vitest's transient TS pass doesn't enforce). A green test run with a red build is a real failure mode. Run `pnpm test && pnpm build` as a unit; treat either failing as "not ready."
- **CI enforces both gates.** `.github/workflows/ci.yml` runs `pnpm test` + `pnpm build:packages` + `pnpm build:website` on every PR against `main` and on every push to `main`. Don't merge with red CI.

## Style / process

- No time estimates in planning docs ("2 days", "1 hour" etc.). This is agentic engineering, not human team scheduling.
- Prune superseded content from long planning docs as you go — don't just append.
- No half-finished features, no speculative abstractions, no defensive code for cases that can't happen.
- No comments explaining *what* code does — the code already says that. Comments are for *why*: a non-obvious constraint, a workaround for a specific browser quirk, an invariant that isn't visible locally.
