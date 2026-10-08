# @glyphcss/core — agent guide

Pure math, shared types, parsers (OBJ/MTL/glTF/GLB/STL/VOX), mesh ops, cameras and generic geometry helpers. General rules are in the root `AGENTS.md`.

## Invariants

- No browser globals, ever. Core must run in Node, workers and SSR.
- Generic geometry helpers carry no `Glyph` prefix (`gridSurfacePolygons`, `parametricSurfacePolygons`, `orientedRibbonPolygons`, `surfaceMedianOfBlock`). They take already-scaled numbers and know nothing about charts or maps.
- `surfaceMedianOfBlock` (`math/surfaceMedian.ts`) is the one area-median implementation, shared by `@glyphcss/maps` relief colour and `@glyphcss/charts/3d` surface colour. Don't fork it.
- `project()` / `math/projection.ts` was removed; use each camera's own `.project()`.
- Renaming a core export updates every importing package in the same PR, with no alias.

## `./three` subpath

- Three-compatible adapter names and units (`Vector3`, `Euler`, `Object3D`, `PerspectiveCamera`, `OrthographicCamera`, `DirectionalLight`, `AmbientLight`), in radians, Y-up, with Three frustum semantics. It has no Three.js dependency.
- Geometry converts to native coordinates through `transformPolygonsToGlyph` with the axis map `[x, -z, y]` (Y-up → Z-up), so winding and Lambert lighting stay right-handed.
- `DirectionalLight.toGlyphDirectionalLight()` converts Three's target → position vector to the native source-vector convention.
- The same surface is re-exported by `glyphcss/three`, `@glyphcss/react/three` and `@glyphcss/vue/three`. User docs: `website/src/content/docs/api/three-parity.mdx`.
