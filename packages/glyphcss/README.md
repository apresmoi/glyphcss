> **Status: pre-1.0. APIs may still change before a stable 1.0 release.**

# glyphcss

An **ASCII polygon-mesh renderer for the DOM**. glyphcss projects 3D meshes to 2D and rasterizes them as monospace text inside a single `<pre>` element — no WebGL, no canvas, no per-polygon DOM nodes. Loads OBJ, glTF, GLB, MagicaVoxel `.vox`, and STL files.

This is the vanilla package: a set of `<glyph-*>` custom elements plus an imperative API. For framework bindings see [`@glyphcss/react`](https://www.npmjs.com/package/@glyphcss/react) and [`@glyphcss/vue`](https://www.npmjs.com/package/@glyphcss/vue); for build-time/static rendering see [`@glyphcss/compile`](https://www.npmjs.com/package/@glyphcss/compile).

## Install

```bash
npm install glyphcss
```

## Quickstart — custom elements

Import `glyphcss/elements` once to register the `<glyph-*>` tags, then compose a scene in HTML. The camera is the outermost element and wraps the scene.

```html
<script type="module">
  import "glyphcss/elements"; // registers <glyph-scene>, <glyph-mesh>, …
</script>

<glyph-camera rot-x="65" rot-y="45" zoom="50">
  <glyph-scene cols="80" rows="40" mode="solid">
    <glyph-orbit-controls></glyph-orbit-controls>
    <glyph-mesh src="/cottage.glb"></glyph-mesh>
  </glyph-scene>
</glyph-camera>
```

Tags: `<glyph-scene>`, `<glyph-mesh>`, `<glyph-effect-layer>`, `<glyph-hotspot>`, `<glyph-camera>` (orthographic alias), `<glyph-orthographic-camera>`, `<glyph-perspective-camera>`, `<glyph-orbit-controls>`, `<glyph-map-controls>`, `<glyph-first-person-controls>`.

## Quickstart — imperative API

```js
import {
  createGlyphScene,
  createGlyphPerspectiveCamera,
  createGlyphOrbitControls,
} from "glyphcss";

const scene = createGlyphScene(document.querySelector("#app"), {
  cols: 80,
  rows: 40,
  mode: "solid",
  camera: createGlyphPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 50 }),
});

createGlyphOrbitControls(scene);
```

## Browser temporal presentation

`createGlyphSurfaceAtlasWebGpuSession({ device, canvas })` is the browser-only
GPU presentation companion for image-generation pipelines. It keeps the
surface-addressed RGB atlas private on WebGPU, reprojects stable surfaces across
control frames, and writes the immediate RGB result to one persistent canvas.
It does not change or replace glyphcss's ASCII `<pre>` renderer.

The normal `submit()` path performs no CPU atlas readback or fallback.
`readback()`, `checkpoint()`, and diagnostic presentation capture are explicit
untimed integrity tools. A lost device or destroyed session invalidates all
later operations. The same factory and types are re-exported by
`@glyphcss/react` and `@glyphcss/vue`; it remains an imperative low-level
session rather than a framework component.

The additive `submitProfiled()` diagnostic follows the same internal submit
path while reporting CPU routing, upload enqueue, compute dispatch encoding,
render encoding, canvas submission, and GPU-completion durations. When
available, WebGPU `timestamp-query` also reports compute and render GPU
durations. Normal `submit()` never creates timestamp resources.

## Numeric conventions

Units match three.js / voxcss:

- **Rotation is in degrees.** `rot-x` / `rot-y` (and `rotX` / `rotY`) are XYZ Euler degrees — `rot-x="65" rot-y="45"` is the classic isometric-ish viewpoint.
- **`zoom` is absolute pixels per world unit.** `zoom="50"` maps one world unit to 50px (three.js-style orthographic zoom), not a fraction of the viewport.

## Render modes

| Mode | Cells filled by |
|---|---|
| `solid` *(default)* | Lambert-shaded intensity picked from a glyph ramp |
| `wireframe` | polygon edges rasterized as ASCII rules |
| `voxel` | cube-aligned geometry; face normals drive glyph selection |
| `ink` | silhouette + crease outlines only; oriented glyph (`_ - ‾ ▔ / \| \ ▏ ▕ ·`) traces the smoothed contour tangent, interior stays empty |

`charMode: "ascii" | "braille" | "halfblock" | "quadrant"` (default `"ascii"`)
selects the character encoding used for rasterized output. `"braille"` packs
a 2×4 subcell dot grid into Unicode Braille Patterns (`U+2800`..`U+28FF`) per
cell for smoother diagonal/curved edges than the default rule-glyph encoding
— it only applies to `wireframe` output. `"halfblock"` is solid mode's
mirror: instead of one shade-ramp glyph per cell, it packs two independently
colored subcells (top/bottom) into `▀`/`▄`/`█` for 2× vertical color
resolution at coarser (block) shape. `"quadrant"` generalizes `"halfblock"`
to a full 2×2 subcell split (16 possible glyphs — space, `▘▝▖▗▀▄▌▐▚▞█`, and
the three-quadrant glyphs `▛▜▙▟`), buying both shape AND color resolution at
the same two-colors-per-cell markup cost. Each mode is a documented no-op
outside the mode it applies to — braille dot coverage is binary and cannot
carry a shade ramp or voxel face glyph; halfblock/quadrant need supersampled
subcell color data solid mode alone produces, and are also a no-op alongside
a `transformCells` hook or active `temporalBlend` reprojection (both already
expect the existing one-color-per-cell grid). Mirrored as `char-mode` on
`<glyph-scene>` and `charMode` on `@glyphcss/react`/`@glyphcss/vue`'s
`<GlyphScene>`.

`wireframeJunctions: boolean` (default `false`, `charMode: "ascii"` only)
resolves corners, T-junctions, and crossings in `wireframe` output. By
default, each edge picks its cell glyphs independently, so two edges meeting
in one cell render whichever rasterized last — corners and joints visibly
break. With `wireframeJunctions: true`, a second pass accumulates which sides
(N/E/S/W) of each cell carry a near-axis-aligned line and resolves the glyph
from the fixed `┌┐└┘├┤┬┴┼─│` box-drawing set, so joints render as ONE glyph
consistent with every edge touching them. Diagonal-dominant edges are
unaffected and keep the default slope-glyph behavior. Mirrored as
`wireframe-junctions` on `<glyph-scene>` and `wireframeJunctions` on
`@glyphcss/react`/`@glyphcss/vue`'s `<GlyphScene>`.

`hiddenLines: "show" | "hide"` (default `"show"`) is hidden-line removal for
the `wireframe` and `ink` paths (including `charMode: "braille"`). The
wireframe path has no depth reference by default — edges draw in mesh order,
and a contested cell resolves by edge WEIGHT, not by which edge is nearer the
camera, so a farther edge (another mesh's far side, an extruded side wall
behind a front face) can paint over a nearer one. `"hide"` depth-tests every
stroke sample against a solid surface prepass with a slope-scaled depth bias
(the standard shadow-map technique — a grazing silhouette earns a larger
allowance than a head-on crease). In `ink`, the test additionally exempts each
edge's own local surface so a mesh's silhouette can't occlude itself.
Documented no-op in `solid` (already depth-buffered per cell). Mirrored as
`hidden-lines` on `<glyph-scene>` and `hiddenLines` on
`@glyphcss/react`/`@glyphcss/vue`'s `<GlyphScene>`. Also accepted by
`compileScene`/`GlyphSceneStatic`, unlike `wireframeJunctions`.

`colorTolerance: number` (default `0`, off, byte-identical) merges adjacent
cells into one `<span>` while their colors stay within this redmean colour
distance — fewer spans, faster paint, at the cost of color fidelity. Range is
`0`–`765`, not `0`–`255` (black↔white is 764.83 under redmean); `NaN`/negative
values degrade to `0`, `+Infinity` merges every same-glyph run in a row. It is
a **lever, not a flat multiplier**: measured 1.2x–9.2x fewer spans
(unquantized→best) depending on scene content — flat, hard-edged output
(per-face color, carved solids) wins enormously, smooth noisy fields win
modestly, and an already-flat scene gains nothing without regressing either. One shared comparison policy
(`colorRunExtends`) backs all four coalescers glyphcss can emit color from, so
`charMode: "halfblock"`/`"quadrant"` and the unsafe default render path get it
too, not just the primary encoder. No-op under `glyphOutput: "semantic"` —
semantic colors are exact class identifiers, not shaded appearance. Mirrored
as `color-tolerance` on `<glyph-scene>` and `colorTolerance` on
`@glyphcss/react`/`@glyphcss/vue`'s `<GlyphScene>`, and accepted by
`compileScene`/`GlyphSceneStatic` — a pure function of the final cell grid,
like `charMode`. See `bench/color-tolerance.md` for measured span/FPS numbers.

## Static & build-time rendering

`rasterize` is pure (geometry + camera → string), so a scene can be rendered ahead of time and inlined as text with **zero runtime**:

- `compileScene(opts)` — pure: polygons + camera → the `<pre>` string, byte-identical to the runtime render.
- `buildGlyphInteractiveExport` / `glyphCodepenPrefill` — polygons + declared interactions → a portable, self-contained snippet.
- [`@glyphcss/compile`](https://www.npmjs.com/package/@glyphcss/compile) — Node adapters, a Vite plugin, and a CLI (`glyphcss cube --auto-center`).

## Documentation

Full docs, guides, and a live gallery: **https://glyphcss.com**

## License

MIT
