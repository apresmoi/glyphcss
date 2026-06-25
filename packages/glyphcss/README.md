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

Tags: `<glyph-scene>`, `<glyph-mesh>`, `<glyph-hotspot>`, `<glyph-camera>` (orthographic alias), `<glyph-orthographic-camera>`, `<glyph-perspective-camera>`, `<glyph-orbit-controls>`, `<glyph-map-controls>`, `<glyph-first-person-controls>`.

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

## Static & build-time rendering

`rasterize` is pure (geometry + camera → string), so a scene can be rendered ahead of time and inlined as text with **zero runtime**:

- `compileScene(opts)` — pure: polygons + camera → the `<pre>` string, byte-identical to the runtime render.
- `buildGlyphInteractiveExport` / `glyphCodepenPrefill` — polygons + declared interactions → a portable, self-contained snippet.
- [`@glyphcss/compile`](https://www.npmjs.com/package/@glyphcss/compile) — Node adapters, a Vite plugin, and a CLI (`glyphcss cube --auto-center`).

## Documentation

Full docs, guides, and a live gallery: **https://glyphcss.com**

## License

MIT
