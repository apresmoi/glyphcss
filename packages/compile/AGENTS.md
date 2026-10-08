# @glyphcss/compile — agent guide

Node-only (uses fs) build-time adapters over glyphcss's pure `compileScene`: `loadMeshFromFile`, `compileFile`, the Vite plugin (`?glyph`), the `glyphcss` CLI (mesh, `chart`, `diagram`), `compileInteractive` and `writeGlyphControlMaps`. General rules are in the root `AGENTS.md`; `compileScene` itself is covered in `packages/glyphcss/AGENTS.md`.

## Invariants

- Rendering logic stays in `glyphcss`. This package only adapts I/O around `compileScene`, whose output is byte-identical to the runtime render.
- Static compile takes a flat polygon list and cannot represent detail layers.
- `writeGlyphControlMaps` defaults to the frozen `glyph-control-export/v1` contract. Only `appearanceRgb: "albedo-and-target"` writes `v2`, and default exports never change shape.
- `compilePolygons` with `autoFit` crops `grid` to the same bounding box as the cropped `inner`, including every optional buffer and `occluded`. A `null` grid stays `null`.
- CLI subcommands (`chart`, `diagram`) keep the library's tagged rule codes, print each ledger entry as `glyphcss: <code>: <message>` on stderr, and exit 1 on failure. Only `chart` supports `--3d`; its 3D-only flags require it. `diagram` is 2D-only and rejects removed 3D flags as unknown options. Details: `packages/charts/AGENTS.md`, `packages/diagrams/AGENTS.md`.

## Don't

- Don't expect a mounted effect in compiled output: `compileScene` and the frame-roll export ignore effects. Only the interactive export (a stock effect by id from the CDN) and `buildGlyphFieldSynthStaticExport` carry one.
