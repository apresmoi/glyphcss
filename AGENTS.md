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
| `website` | `@glyphcss/website` | Astro + Starlight docs site. Not published. |

Public API is **mirrored** across React and Vue. Adding a hook on one side without adding the matching composable on the other is not acceptable (see "Cross-package discipline" below).

## Rendering model

**One render pass → one `<pre>.textContent` assignment.** On every camera or scene state change, the rasteriser:

1. Walks all mounted meshes in scene order.
2. Transforms polygon vertices through the camera matrix to get 2D projected positions.
3. Fills a `cols × rows` character grid: depth-tests overlapping polygons, picks a glyph per cell based on the render mode.
4. Joins all cells into a single string and writes it to `<pre>.textContent` exactly once.

There are no per-polygon DOM elements. There is no CSS `matrix3d`. The `<pre>` is the entire render surface.

### Render modes

| Mode | How cells are filled |
|---|---|
| `wireframe` | Polygon edges rasterised as ASCII rules; glyph weight scales with edge prominence |
| `solid` | Filled cells; glyph picked from a `CharRamp` by Lambert-shaded intensity |
| `voxel` | Cube-aligned geometry; face normals drive glyph selection |

### Hotspots

Hotspots are 3D anchors that produce positioned 2D hitboxes in the consumer's DOM. The rasteriser projects each `Hotspot.at` point through the camera and returns a `HotspotCell` (col, row, depth, visible). Consumers absolute-position a `<div>` at the cell — the rasteriser only computes the position; it does not emit the DOM node.

## No per-frame DOM mutation

The invariant we hold: **each render cycle sets `<pre>.textContent` exactly once.** Multiple writes per cycle (e.g. cell-by-cell DOM patching) are not acceptable.

Hotspot positions update via a single inline-style assignment per hotspot element, not via DOM rebuild.

Controls (orbit, map, first-person) mutate a single camera state object; the rasteriser reads that object when it renders. The JS ↔ DOM boundary is: camera event → update camera state object → rasterise → write one string.

## Naming

Every public export gets a `Glyph` prefix. Exceptions are generic math/geometry types: `Vec2`, `Vec3`, `Polygon`, `TextureTriangle`.

- **Hooks/composables:** `useGlyphCamera`, `useGlyphMesh`, `useGlyphSceneContext`, `useGlyphAnimation`.
- **Components:** `GlyphPerspectiveCamera`, `GlyphOrthographicCamera`, `GlyphOrbitControls`, `GlyphMapControls`, `GlyphFirstPersonControls`, `GlyphAxesHelper`, `GlyphDirectionalLightHelper`.
- **Types:** `GlyphDirectionalLight`, `GlyphAmbientLight`, `GlyphAnimationMixer`, `GlyphAnimationAction`, `GlyphAnimationClip`, `GlyphAnimationTarget`.
- **Functions:** `createGlyphAnimationMixer`, `injectGlyphBaseStyles`.
- **Vanilla factories:** `createGlyphScene`, `createGlyphCamera`, `createGlyphOrbitControls`, `createGlyphMapControls`, `createGlyphFirstPersonControls`.
- **HTML custom elements:** `glyph-` prefix + kebab-case. Existing tags: `<glyph-scene>`, `<glyph-mesh>`, `<glyph-hotspot>`, `<glyph-perspective-camera>`, `<glyph-orthographic-camera>`, `<glyph-orbit-controls>`, `<glyph-map-controls>`. Any new element follows the same shape.
- `GlyphCamera` is a kept alias for `GlyphPerspectiveCamera` — the ergonomic default. **Not deprecated.**

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
- No comments explaining *what* code does — the code already says that. Comments are for *why*: a non-obvious constraint, a workaround for a specific browser quirk, an invariant that isn't visible locally.
