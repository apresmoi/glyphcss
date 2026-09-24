# Glyphcss — agent guide

The root guide for AI coding agents. `CLAUDE.md` is a symlink to it, so always edit `AGENTS.md`. This file is a **directory plus the rules that apply to every package**. Each package keeps its own contracts in `packages/<pkg>/AGENTS.md`, which loads when you work inside that package. Measurements and defect history live in git history. If a request conflicts with a rule here, push back before doing it.

## What this repo is

`glyphcss` is an ASCII polygon-mesh renderer for the DOM. It projects 3D meshes to 2D and rasterises them as monospace text inside a `<pre>`. It uses no WebGL, no canvas per frame and no DOM nodes per polygon. It was forked from polycss: the mesh math, parsers, scene tree, cameras and controls carried over, and the paint backend is new.

pnpm monorepo:

| Package | npm | Role | Guide |
|---|---|---|---|
| `packages/core` | `@glyphcss/core` | Pure math, types, parsers, geometry helpers. No browser globals. | `packages/core/AGENTS.md` |
| `packages/glyphcss` | `glyphcss` | Vanilla renderer: rasteriser, scene, effects protocol, cell canvas, `compileScene`, custom elements | `packages/glyphcss/AGENTS.md` |
| `packages/react` / `packages/vue` | `@glyphcss/react` / `@glyphcss/vue` | Mirrored bindings | `packages/react/AGENTS.md`, `packages/vue/AGENTS.md` |
| `packages/compile` | `@glyphcss/compile` | Node build-time compiler: Vite plugin, CLI, control-map export | `packages/compile/AGENTS.md` |
| `packages/effects` | `@glyphcss/effects` | Stock effects (field synth and others) | `packages/effects/AGENTS.md` |
| `packages/charts` | `@glyphcss/charts` | Charts over the cell canvas; `./3d` scene-object charts | `packages/charts/AGENTS.md` |
| `packages/diagrams` | `@glyphcss/diagrams` | Graph → cell diagrams; `./3d` scene objects | `packages/diagrams/AGENTS.md` |
| `packages/maps` | `@glyphcss/maps` | Geographic pipeline and the `createGlyphMap` widget | `packages/maps/AGENTS.md` |
| `packages/fonts` | `@glyphcss/fonts` | Text → extruded meshes | `packages/fonts/AGENTS.md` |
| `website` | not published | Astro + Starlight docs and workbenches (`/charts`, `/diagrams`, `/maps`, `/synth`) | `website/AGENTS.md` |

## Rules for every package

**Rendering.** Each render writes each `<pre>` exactly once: the base `<pre>` plus one write and one `transform` per detail layer. There is no per-cell DOM patching, and hotspots update with one inline-style assignment each. Any optimisation must keep the output byte-identical. Changing what JS runs in the render path is an architectural change (see below).

**Naming.** Every public export gets a `Glyph` prefix: `createGlyphScene`, `useGlyphCamera`, `GlyphScene`, `<glyph-scene>` (custom elements are kebab-case). The exceptions:
- generic math/geometry types and helpers (`Vec3`, `Polygon`, `gridSurfacePolygons`)
- the `*/three` subpaths, which use Three.js names (components there still use the `GlyphThree` prefix)

Options shaped like data (ramps, palettes, effect definitions, objects) are JS properties, never attributes. `GlyphCamera` is an alias for the orthographic camera.

**Numeric conventions** (native API; the `*/three` subpaths convert internally):
- Rotations are degrees, XYZ Euler.
- Camera `zoom` is CSS pixels per world unit.
- Perspective `distance` defaults to `0`.
- A light's `direction` points from the surface toward the light.
- Depth: larger = nearer, everywhere.

**React ↔ Vue mirroring.** A public API change on one side lands on the other in the same PR, with the same names, arguments, defaults and return shapes. A public-surface change in `glyphcss` or `core` updates both bindings in that same PR.

**Backward compatibility.** Clean breaks only: no shims, re-export aliases or `@deprecated` wrappers. Packages publish in lockstep.

**Architecture belongs to the user.** Adding or dropping a render mode, renaming a public convention or changing what JS runs in the render path requires a proposal and user approval.

## Where knowledge lives

- `packages/<pkg>/AGENTS.md` holds that package's contracts, invariants and a `## Don't` list of rejected approaches, one line each. **Budget: 8,000 characters per file.**
- Code comments next to the code carry the *why* of local decisions.
- `packages/*/README.md` and `website/src/content/docs/**` are the public docs.
- Git history is the record of how and why things changed; there is no separate design-notes directory.
- This file has a **budget of 12,000 characters**. Package detail never goes here.

A change that alters a contract updates the package's `AGENTS.md` in the same PR. A rejected approach worth warning about goes into its `## Don't` list or a comment. Prune anything superseded; never append history to an `AGENTS.md`.

## Tests & build

- Refactors keep every test passing. Never delete or weaken an assertion to get one through. A renamed export's tests rename their imports.
- A guarantee with no failing test is not a guarantee. Byte-identity, no-op and "degrades, never throws" claims each need a test that goes red when the property is removed.
- Settle on a component's own idle signal (for example `map.idle()`), never on a wall-clock sleep. `setTimeout` in a test is legitimate only when the delay itself is what's under test. Give `vi.waitFor` an explicit timeout sized for slow CI.
- `pnpm test && pnpm build` is required before a PR, because vitest does not catch DTS build failures. CI runs `pnpm test`, `pnpm build:packages` and `pnpm build:website`; don't merge while it's red. CI runs one package's vitest at a time (`NPM_CONFIG_WORKSPACE_CONCURRENCY: 1`) because parallel packages overloaded the runner.

## Commits, PRs, releases

- Conventional commits, single-line subject, a body only when useful.
- **No `Co-Authored-By: Claude` trailer and no "Generated with Claude Code" footer**, anywhere.
- Never amend; add follow-up commits. Don't push subagent branches; the user pushes.
- `main` is not branch-protected, but feature work goes through PRs.
- Releasing is one click: the `Publish packages` workflow (`gh workflow run publish-packages.yml -f bump=patch`) bumps every package, builds, publishes and tags `v<X.Y.Z>`.

## Style

- No time estimates in planning docs.
- No half-finished features, speculative abstractions or defensive code for cases that can't happen.
- Comments explain *why* (a constraint, a quirk, a non-local invariant), never *what*.
