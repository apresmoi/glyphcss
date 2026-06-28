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
| `website` | `@glyphcss/website` | Astro + Starlight docs site. Not published. |

Public API is **mirrored** across React and Vue. Adding a hook on one side without adding the matching composable on the other is not acceptable (see "Cross-package discipline" below).

## Rendering model

**One render pass → one `<pre>.textContent` assignment.** On every camera or scene state change, the rasteriser:

1. Walks all mounted meshes in scene order.
2. Transforms polygon vertices through the camera matrix to get 2D projected positions.
3. Fills a `cols × rows` character grid: depth-tests overlapping polygons, picks a glyph per cell based on the render mode.
4. Joins all cells into a single string and writes it to `<pre>.textContent` exactly once.

There are no per-polygon DOM elements. There is no CSS `matrix3d`. The base `<pre>` is the render surface for all shared-resolution meshes.

### Per-mesh detail layers

By default every mesh renders into that one shared base `<pre>`. A mesh can opt into **its own resolution** — set `density` (a multiplier: `density: 3` → 3× the scene's glyph resolution, cell = base ÷ density, isotropic, same on-screen size) or the low-level `fontSize` / `lineHeight` (which override `density`). Such a mesh "pops out" into its **own silhouette-fitted, CSS-translated `<pre>`** rendered at that cell size — so a hero mesh carries far more detail while the rest of the scene stays cheap in the shared grid. Browser-only (needs layout to measure cells); exact for orthographic cameras. This is **not** a group/tree concept — it's a per-mesh property on the flat mesh list.

`transparent: true` (default `false` = opaque) makes a mesh see-through (x-ray): it neither occludes nor is occluded. Because a mesh in the shared `<pre>` always occludes (one depth buffer), declaring `transparent` also pops the mesh into its own `<pre>` — separation happens for custom cell metrics **or** transparency.

**Cross-layer occlusion.** Opaque meshes occlude each other across `<pre>` layers via a shared camera-depth pass: `computeOcclusionIds` rasterises all opaque geometry into one id-map (nearest layer per cell), and each layer's `rasterize` blanks cells a *different* layer owns (a layer never occludes itself). Integrated into `rasterize` (an `occlusion` `OcclusionMap` input) so it works for plain text **and** colored spans, and self-disables (zero cost) when no opaque detail mesh exists. Within the shared `<pre>`, meshes occlude each other for free via the normal per-cell depth buffer.

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
- **Interactive export** — `buildGlyphInteractiveExport(polygons, { interactions })` (pure, browser-safe, in `glyphcss`): the declared interactions (`orbit`/`zoom`/`pan`/`fpv`) drive **both** the wired control (only that one is imported → the snippet tree-shakes) **and** the decimation budget (`decimatePolygons` — coarser for orbit, finer when `zoom`/`fpv` let the camera approach). Output is a self-contained CDN+inlined-mesh snippet; `glyphCodepenPrefill` turns it into a CodePen POST (the gallery's "CodePen" button). Less declared interactivity = less mesh + less runtime shipped.

## No per-frame DOM mutation

The invariant we hold: **each render cycle writes each `<pre>` exactly once** — the base `<pre>` plus one write per per-mesh detail layer (and one `transform` per detail layer for positioning). Cell-by-cell DOM patching, or multiple writes to the same `<pre>` per cycle, are not acceptable.

Hotspot positions update via a single inline-style assignment per hotspot element, not via DOM rebuild.

Controls (orbit, map, first-person) mutate a single camera state object; the rasteriser reads that object when it renders. The JS ↔ DOM boundary is: camera event → update camera state object → rasterise → write one string.

## Naming

Every public export gets a `Glyph` prefix. Exceptions are generic math/geometry types: `Vec2`, `Vec3`, `Polygon`, `TextureTriangle`.

- **Hooks/composables:** `useGlyphCamera`, `useGlyphMesh`, `useGlyphSceneContext`, `useGlyphAnimation`.
- **Components:** `GlyphScene`, `GlyphSceneStatic` (SSR/build-time `<pre>`, no runtime), `GlyphPerspectiveCamera`, `GlyphOrthographicCamera`, `GlyphOrbitControls`, `GlyphMapControls`, `GlyphFirstPersonControls`, `GlyphAxesHelper`, `GlyphDirectionalLightHelper`.
- **Types:** `GlyphDirectionalLight`, `GlyphAmbientLight`, `GlyphAnimationMixer`, `GlyphAnimationAction`, `GlyphAnimationClip`, `GlyphAnimationTarget`.
- **Functions:** `createGlyphAnimationMixer`, `injectGlyphBaseStyles`, `compileScene` (pure, DOM-less render → `<pre>` string), `buildGlyphInteractiveExport` / `glyphCodepenPrefill` (polygons + declared interactions → portable self-contained snippet), `decimatePolygons` (core — resolution-target mesh simplification).
- **Vanilla factories:** `createGlyphScene`, `createGlyphCamera` (ortho alias), `createGlyphPerspectiveCamera`, `createGlyphOrthographicCamera`, `createGlyphOrbitControls`, `createGlyphMapControls`, `createGlyphFirstPersonControls`.
- **HTML custom elements:** `glyph-` prefix + kebab-case. Existing tags: `<glyph-scene>`, `<glyph-mesh>`, `<glyph-hotspot>`, `<glyph-perspective-camera>`, `<glyph-orthographic-camera>`, `<glyph-camera>` (ortho alias), `<glyph-orbit-controls>`, `<glyph-map-controls>`, `<glyph-first-person-controls>`. Any new element follows the same shape.
- `GlyphCamera` is the ergonomic default alias — it resolves to `GlyphOrthographicCamera`. The voxel render mode and iso/diagrammatic scenes are glyphcss's differentiator; ortho is the more representative default.

## Numeric conventions

These conventions match voxcss and three.js exactly — same units, same frames.

- **Rotation units: degrees.** `rotX`, `rotY` on cameras and the `rotation` prop on meshes are all in degrees (XYZ Euler). `rotX=65, rotY=45` is the classic isometric-ish viewpoint. Do not use radians — the asciss-lineage radian convention has been replaced.
- **Camera `zoom`: absolute, pixels per world unit.** `zoom=50` means one world unit maps to 50 px at `BASE_TILE`. This is three.js-style orthographic zoom, not a fraction of the viewport.
- **Directional light `direction`: toward convention.** `GlyphDirectionalLight.direction` is the direction the light shines *toward*, matching three.js. A vector pointing down-right-forward lights the top-left-back faces.

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
- This applies even to the multi-package monorepo — all four packages move together.

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
- `pnpm test` runs the full suite across all four packages.
- **`pnpm build` is mandatory before opening a PR.** Vitest doesn't catch DTS / declaration build failures (tsup runs strict type-checking that vitest's transient TS pass doesn't enforce). A green test run with a red build is a real failure mode. Run `pnpm test && pnpm build` as a unit; treat either failing as "not ready."
- **CI enforces both gates.** `.github/workflows/ci.yml` runs `pnpm test` + `pnpm build:packages` + `pnpm build:website` on every PR against `main` and on every push to `main`. Don't merge with red CI.

## Style / process

- No time estimates in planning docs ("2 days", "1 hour" etc.). This is agentic engineering, not human team scheduling.
- Prune superseded content from long planning docs as you go — don't just append.
- No half-finished features, no speculative abstractions, no defensive code for cases that can't happen.
- No comments explaining *what* code does — the code already says that. Comments are for *why*: a non-obvious constraint, a workaround for a specific browser quirk, an invariant that isn't visible locally.
