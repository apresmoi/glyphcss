# Polycss — agent guide

This file is the single source of truth for AI coding agents (Claude Code, Cursor, etc.). `CLAUDE.md` is a symlink to this file — **always edit `AGENTS.md`, never `CLAUDE.md`**. The constraints below describe the current design and the rules we work under; if a request conflicts with one of them, push back before doing it.

## What this repo is

`polycss` is a CSS-based polygon mesh rendering engine. It paints 3D meshes by emitting one DOM element per polygon, transforming it with `matrix3d`, and letting the browser composite the result. No WebGL, no canvas-per-frame. Rasterisation only happens once, into a texture atlas; everything after that is pure DOM + CSS.

Monorepo layout (pnpm workspaces):

| Package | npm name | Role |
|---|---|---|
| `packages/core` | `@layoutit/polycss-core` | Pure math: Vec3, Polygon, scene, camera, mesh ops, atlas planning. Zero browser globals. |
| `packages/polycss` | `@layoutit/polycss` | Vanilla renderer + custom elements (`<poly-scene>`, etc.). Owns DOM emission, CSS injection, atlas rasterisation. |
| `packages/react` | `@layoutit/polycss-react` | React components + hooks. Thin wrapper over core + polycss. |
| `packages/vue` | `@layoutit/polycss-vue` | Vue 3 mirror of the React package. |
| `website` | `@layoutit/polycss-website` | Astro + Starlight docs site. Not published. |

Public API is **mirrored** across React and Vue. Adding a hook on one side without adding the matching composable on the other is not acceptable (see "Cross-package discipline" below).

## Rendering model — the mental model

**One `Polygon` → one leaf DOM element.** Leaves use canonical CSS primitives where possible and move scale into `matrix3d`; `border-shape` uses a larger fixed primitive because its paint geometry becomes unstable when collapsed to 1px. Textured polygons still pack their local-2D bounding rect (`canvasW × canvasH`) into the atlas. The HTML tag *is* the render strategy — the renderer picks one tag per polygon based on its shape and material.

### Tag-as-strategy table

| Tag | Strategy | When chosen | Paint mechanism | Atlas memory |
|---|---|---|---|---|
| `<b>` | **Quads** | Axis-aligned rectangle, or untextured convex quad when the homography passes stability guards | `background: currentColor` on a fixed 64px rectangle; affine and projective quads normalize their `matrix3d` to that primitive, with tiny solid bleed on projective quads to overlap antialias seams | None |
| `<i>` | **Border-shape clipped solid** | Untextured non-rect on browsers with CSS `border-shape` (Chromium + `pointer:fine` + `hover:hover`) | `border-color: currentColor` on a fixed 64px border-shape primitive, clipped by `border-shape: polygon(...)`; polygon bbox scale and tiny solid bleed are folded into `matrix3d` | None |
| `<s>` | **Atlas slice** | Textured polygons, or untextured non-rect on browsers without `border-shape` | `background-image` slice of packed bitmap on a fixed 128px primitive; atlas position/size and `matrix3d` scale are normalized to the slice, shared textured edges get low-alpha atlas pixels repaired during atlas generation, and solid fallbacks get same-color edge bleed to avoid dark alpha fringes | Bounding-rect area |
| `<u>` | **Stable solid triangle** | Opt-in for triangles via `renderPolygonsWithStableTriangles` | CSS border-color triangle trick with a fixed canonical 64px border triangle; tiny solid bleed is folded into `matrix3d` | None |
| `<q>` | **Cast shadow leaf** | Per casting polygon when `castShadow: true` and dynamic lighting mode. Applies regardless of caster strategy — `<b>`/`<i>`/`<s>`/`<u>` all produce a `<q>` shadow because only the polygon's outline matters, not its surface. | Same `border-color: currentColor` + `border-shape: polygon(...)` as `<i>`, but transform composes `var(--shadow-proj)` to project the polygon onto the ground plane along the CSS-space light direction | None |

Strategies are ordered cheapest → most expensive. The mesher's job is to maximise `<b>` / `<i>` and minimise `<s>` (see "Meshing implications" below).

Callers can opt out of specific strategies via `strategies: { disable: ["b" | "i" | "u"] }` on `RenderTextureAtlasOptions`. Disabled strategies fall through the chain (`b → i → s`, `u → i → s`, `i → s`). `<s>` is the universal fallback and cannot be disabled.

### Lighting modes (`PolyTextureLightingMode = "baked" | "dynamic"`)

- **Baked.** Lambert is computed once on the CPU per polygon, multiplied into the inline `color` (for `<b>`/`<i>`/`<u>`) or into the rasterised atlas pixels (for `<s>`). Moving a light requires re-rasterising affected polys.
- **Dynamic.** Scene root carries the light setup as custom properties (`--plx/y/z`, `--plr/g/b`, `--pli`, `--par/g/b`, `--pai`). Each leaf embeds its surface normal (`--pnx/y/z`) and base color (`--psr/g/b`) inline. CSS `calc()` resolves the Lambert dot product and per-channel tint at paint time. Moving a light mutates one var on the scene root — zero JS, no atlas redraw.

All solid/atlas tags work in both modes. The full coverage matrix is in `packages/polycss/src/styles/styles.ts`.

### Meshing implications (what generators must respect)

- **Polygon count is the dominant cost.** Each polygon is one DOM node, one `matrix3d`, one paint. Halving the polygon count is almost always worth a more complex mesher.
- **Fill ratio matters.** A textured polygon's atlas slice equals its local-2D bounding rect. Empty space inside that slice is wasted bitmap pixels. Prefer shapes with high `area / boundingRect.area`:
  - axis-aligned rectangle = 1.0 (and hits the fastest path)
  - right-isosceles triangle = 0.5
  - skinny/long triangle ≪ 0.5 (worst case — many such triangles balloon atlas memory)
- **Regular grids are not a constraint.** Vertices may sit anywhere on the surface. Any planar tiling whose edges match across neighbours (no T-junctions, no cracks) is valid. Break the grid where it lets you fit larger axis-aligned rects to flat regions.
- **Coplanarity is a hard requirement at render time, but the mesher can engineer it.** A non-triangular polygon must have all vertices on a common plane within a small epsilon, or the renderer snaps the offending vertex in isolation and opens a visible seam with adjacent polygons. The mesher avoids this either by (a) only merging when natural coplanarity holds, or (b) deliberately snapping shared vertices to a common plane and propagating the new position to *every* polygon that references them. Snap-and-propagate is preferred when it widens the merge opportunity, subject to the budget below.
- **Vertex displacement budget.** Every snap consumes budget on the moved vertex and on all polygons that reference it. Track cumulative displacement from the original DEM-sampled position per vertex; reject any merge that would push a vertex past the user's height tolerance. Errors compound across merges, so the bound is per-vertex cumulative drift, not per-merge.

## The "no JS in the render loop" principle

This is the load-bearing constraint behind the whole engine. **JavaScript never runs per-frame to paint polygons.** Once the scene is built and the atlas is rasterised, the browser drives the render entirely through CSS — `matrix3d` transforms, `calc()`-driven custom properties, `background-blend-mode`, `border-shape`, etc.

| Where JS runs | Where JS does NOT run |
|---|---|
| Scene construction (`createPolyScene`, mesh ops, vertex snapping) | Per-frame polygon paint |
| OBJ/glTF/GLB import, mesh optimisation, coplanar merging | Per-frame Lambert evaluation (dynamic mode is pure CSS) |
| Atlas planning + rasterisation (one-shot to `<canvas>`, then `toBlob`) | Per-frame atlas redraw (only on baked-mode light changes) |
| Control input handling (`PolyOrbitControls`, `PolyMapControls`, `PolyTransformControls`) | Per-frame transform recomputation of every polygon — only the scene-root or mesh-root transform changes |
| Camera math (matrix4 product → scene-root `transform` CSS var) | Per-polygon JS in any hot path |
| Hover/selection raycasting (only on pointer events, not per frame) | Continuous re-rendering "ticks" |

If you find yourself wanting a `requestAnimationFrame` loop to update many DOM nodes, stop. Find the CSS variable that should be carrying the change, and update that single variable on a single ancestor. Cascading + `@property`-registered custom properties do the rest.

## Naming (three.js parity)

- Every public export gets a `Poly` prefix. Exceptions are generic math types: `Vec2`, `Vec3`, `Polygon`, `PolyMaterial` (already prefixed).
- **Hooks/composables:** `usePolyCamera`, `usePolyMesh`, `usePolySceneContext`, `usePolySelect`, `usePolySelectionApi`, `usePolyAnimation`.
- **Components:** `PolyPerspectiveCamera`, `PolyOrthographicCamera`, `PolyOrbitControls`, `PolyMapControls`, `PolyTransformControls`, `PolySelect`, `PolyAxesHelper`, `PolyDirectionalLightHelper`, `PolyControls`.
- **Types:** `PolyDirectionalLight`, `PolyAmbientLight`, `PolyTextureLightingMode`, `PolyAnimationMixer`.
- **Functions:** `findPolyMeshHandle`, `injectPolyBaseStyles`.
- **Vanilla factories:** `create*` names stay as-is (`createPolyScene`, `createPolyControls`, `createTransformControls`, `createSelect`).
- **HTML custom elements:** `poly-` prefix + kebab-case. Existing tags: `<poly-scene>`, `<poly-mesh>`, `<poly-polygon>`, `<poly-controls>`, `<poly-axes-helper>`, `<poly-directional-light-helper>`. Any new element follows the same shape (e.g. `<poly-perspective-camera>`, `<poly-transform-controls>`, `<poly-select>`).
- **Leaf DOM tags (`<b>`, `<i>`, `<s>`, `<u>`):** internal render-strategy tags. Not part of the public API and not user-facing — do not document them as such.
- `PolyCamera` is a kept alias for `PolyPerspectiveCamera` — the ergonomic default. **Not deprecated.**

## Cross-package discipline

The React and Vue packages are mirror images. **Any public API change in one must land in the other in the same PR.** Same names, same arguments, same defaults, same return shapes (allowing for idiomatic differences — refs vs reactives, `useEffect` vs `watchEffect`).

When you change `packages/polycss` or `packages/core` in a way that affects the public surface (new option, renamed export, changed default), the React and Vue bindings update in the same PR. Don't ship a polycss change that leaves the bindings stale.

Before opening a PR:

- [ ] If I touched a React component/hook, the Vue composable/component matches.
- [ ] If I touched a Vue component/composable, the React component/hook matches.
- [ ] If I added an option to a `polycss` factory, both bindings expose it.
- [ ] If I renamed a `core` export, every package that imports it is updated.
- [ ] If I touched the renderer, `packages/polycss/src/styles/styles.ts` is consistent with the new behavior (CSS rules cover every emitted tag for both lighting modes).
- [ ] Website docs (`website/src/content/docs/**`) and READMEs reflect any user-visible change.
- [ ] If I changed a render strategy, lighting mode, naming convention, or the JS-in-render-loop rules, `AGENTS.md` reflects the new state in this same PR.

## Iterating on the system

The rendering model, tag table, lighting modes, and naming conventions described in this document are the *current* design — not frozen. Render strategies can be added or removed, lighting modes can change shape, the public API will keep evolving. The rules for evolving them:

- **AGENTS.md is the canonical reference.** Edit it directly; `CLAUDE.md` is just a symlink that exists so Claude Code finds the same content.
- **Architectural changes require user approval.** Dropping a render strategy, adding a lighting mode, renaming a public-facing convention, changing what JS is allowed in the render path — propose, don't decide. The user (human) is the architect.
- **Same-PR sync.** Any PR that adds, removes, or materially changes a render strategy, lighting mode, naming rule, or cross-package contract must update `AGENTS.md` in the same PR. An API change that lands without an AGENTS.md update is an incomplete change.
- **Don't append-only.** Prune content that no longer reflects the codebase. If a strategy is dropped, remove its row from the tag table — don't leave a "deprecated" note. If a hook is renamed, update the naming section in place — don't list the old name "for reference".

## Backward compatibility

- **No BC shims.** Clean breaks only. No re-export aliases for renamed symbols. No `@deprecated` wrappers. If the API changes, callers update.
- This applies even to the multi-package monorepo — all four packages move together.

## Commits & PRs

- Conventional commits format. Single-line subject. No body unless genuinely useful.
- **NO `Co-Authored-By: Claude` trailer.**
- **NO "🤖 Generated with Claude Code" footer in PR bodies, commit messages, issue comments, or anywhere else.**
- Never amend commits. New follow-up commits only. (Pre-commit hook failures: fix and create a new commit, don't `--amend`.)
- Don't auto-push subagent exploration branches — local commits only. The user pushes when ready.
- `main` is protected. All work lands via PR.

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
- No comments explaining *what* code does — the code already says that. Comments are for *why*: a non-obvious constraint, a workaround for a specific browser bug, an invariant that isn't visible locally.
