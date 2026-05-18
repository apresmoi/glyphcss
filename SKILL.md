---
name: glyphcss
description: ASCII polygon mesh renderer for the DOM. Use this skill to render 3D meshes as monospace text inside a single `<pre>` element, with React/Vue/vanilla bindings.
---

## What it is

glyphcss renders 3D polygon meshes as ASCII/glyph art inside a single `<pre>` element.
It bakes N rotation frames into a text strip at scene-init time, then uses CSS
`steps(N)` to animate it — zero JavaScript runs per frame. Hotspots (clickable 3D
anchors) get their own `@keyframes` that stay in lockstep with the strip. The result is
terminal-aesthetic 3D with normal DOM events, `pointer-events`, `:hover`, and DevTools
inspection on every interactive element.

## Install

```bash
# React
npm install @glyphcss/react

# Vue 3
npm install @glyphcss/vue

# Vanilla JS
npm install glyphcss

# Core math only (Node / worker safe)
npm install @glyphcss/core
```

## Render a mesh

```tsx
// React
import { GlyphcssScene, GlyphcssMesh, GlyphcssOrbitControls } from "@glyphcss/react";
import { icosahedronPolygons } from "@glyphcss/core";
const icosa = icosahedronPolygons({ center: [0,0,0], size: 1, color: "#44ffcc" });
export function App() {
  return (
    <GlyphcssScene mode="solid" cols={100} rows={30}>
      <GlyphcssOrbitControls />
      <GlyphcssMesh triangles={icosa} />
    </GlyphcssScene>
  );
}
```

```vue
<!-- Vue 3 -->
<template>
  <GlyphcssScene mode="solid" :cols="100" :rows="30">
    <GlyphcssOrbitControls />
    <GlyphcssMesh :triangles="icosa" />
  </GlyphcssScene>
</template>
<script setup lang="ts">
import { GlyphcssScene, GlyphcssMesh, GlyphcssOrbitControls } from "@glyphcss/vue";
import { icosahedronPolygons } from "@glyphcss/core";
const icosa = icosahedronPolygons({ center: [0,0,0], size: 1, color: "#44ffcc" });
</script>
```

```ts
// Vanilla JS
import { createGlyphcssScene, createGlyphcssOrbitControls } from "glyphcss";
import { icosahedronPolygons } from "@glyphcss/core";
const scene = createGlyphcssScene(document.querySelector("#scene")!, { mode: "solid" });
scene.add(icosahedronPolygons({ center: [0,0,0], size: 1, color: "#44ffcc" }));
createGlyphcssOrbitControls(scene, { drag: true, wheel: true });
```

## Built-in shapes

All generators live in `@glyphcss/core` and return `Polygon[]`. Pass them directly
to `GlyphcssMesh` via the `triangles` prop.

| Helper | Shape | Key options |
|---|---|---|
| `tetrahedronPolygons` | 4 triangular faces | `center`, `size` (circumradius) |
| `cubePolygons` | 6 square faces | `center`, `size` (edge length) |
| `octahedronPolygons` | 8 triangular faces | `center`, `size` (half-extent) |
| `dodecahedronPolygons` | 12 pentagonal faces | `center`, `size` (circumradius) |
| `icosahedronPolygons` | 20 triangular faces | `center`, `size` (circumradius) |
| `planePolygons` | 1 axis-aligned quad | `axis` (0/1/2), `size` |
| `ringPolygons` | Flat annulus | `axis`, `radius`, `segments` |
| `axesHelperPolygons` | RGB axis gizmo | `size`, `thickness`, `negative` |

```ts
import { cubePolygons, axesHelperPolygons } from "@glyphcss/core";

const cube = cubePolygons({ center: [0, 0, 0], size: 1, color: "#4488ff" });
const axes = axesHelperPolygons({ size: 2 });
```

## Load a file

```ts
import { loadMesh } from "glyphcss";

// Detects format from URL extension: .obj / .gltf / .glb / .vox
const { polygons, dispose } = await loadMesh("/model.glb");
scene.add(polygons);

// Call dispose() when done to revoke any blob URLs:
dispose();
```

## Render modes

| Mode | Output style | When to use |
|---|---|---|
| `"wireframe"` | Edge lines at three weight tiers | Geometric meshes, lattices |
| `"solid"` | Lambert-shaded glyph fill | Smooth surfaces from mesh files |
| `"voxel"` | One glyph per face, depth-sorted | MagicaVoxel `.vox` files |

```ts
// Change mode on a running scene:
scene.setOptions({ mode: "solid" });
```

## Controls

| Control | Interaction | Import |
|---|---|---|
| `GlyphcssOrbitControls` | Drag orbits, wheel zooms | `@glyphcss/react` / `@glyphcss/vue` / `createGlyphcssOrbitControls` |
| `GlyphcssMapControls` | Left-drag pans, right-drag orbits | Same |
| `GlyphcssFirstPersonControls` | Drag looks, WASD moves | Same |

All controls accept `animate: { axis: "y", speed: 0.5 }` for auto-rotation that
pauses on interaction.

## Hotspots

Hotspots are absolutely-positioned `<div>`s that track a 3D anchor through every
baked frame. They fire normal DOM events.

```tsx
// React
import { GlyphcssHotspot } from "@glyphcss/react";

<GlyphcssMesh triangles={cube}>
  <GlyphcssHotspot
    id="top"
    at={[0, 0.5, 0]}
    size={[4, 2]}
    onClick={() => alert("top face")}
  >
    <span className="badge">Top</span>
  </GlyphcssHotspot>
</GlyphcssMesh>
```

```ts
// Vanilla JS
const h = scene.addHotspot(
  { id: "top", at: [0, 0.5, 0], size: [4, 2] },
  () => alert("top face"),
);
// h.remove() when done.
```

## Customizing rendering

| Option | Default | Effect |
|---|---|---|
| `cols` | `80` | Grid width in character columns |
| `rows` | `24` | Grid height in character rows |
| `cellAspect` | `2.0` | Cell height ÷ width; adjust for non-standard fonts |
| `glyphPalette` | `"default"` | Named glyph set for the solid/voxel ramp |
| `useColors` | `true` | Emit `<span>` color tags; `false` for plain text output |

```ts
scene.setOptions({
  cols: 140,
  rows: 40,
  cellAspect: 1.8,
  useColors: false,  // strip output — no HTML spans, safe for copy-paste
});
```

## Common pitfalls

- **Triangles must form valid closed-ish surfaces.** Each `GlyphcssTriangle` is
  rasterized independently; gaps between triangles show as black holes in solid mode.
- **VOX files render best in `voxel` mode.** Using `solid` on `.vox` output works
  but loses the palette-aligned density mapping and looks muddier.
- **`cols`/`rows` do not auto-size.** The grid is fixed at creation time. If the
  host element resizes, call `scene.setOptions({ cols, rows })` with the new cell
  count.
- **Cell aspect drift.** If `cellAspect` mismatches your actual font (typically
  `2.0` for monospace), the mesh will appear squished or stretched. Measure with a
  hidden `<span>` probe on the same font.
- **Never `requestAnimationFrame` to update many triangles per frame.** The strip
  is pre-baked — rebuild and re-add meshes only on user interaction or data changes,
  not on every tick.
- **`ParseResult.dispose()` must be called on unmount.** `parseGltf` and
  `loadMesh` mint object URLs for embedded textures. Not calling `dispose()` leaks
  them for the lifetime of the page.
- **Hotspot `id` must be stable.** Changing a hotspot's `id` while it is mounted
  creates a duplicate in the scene. Remove the old one first, then add the new one.
- **Camera `rotX: 0` looks straight down Z.** Use `~0.38` for the typical
  "three-quarter" downward tilt that gives mesh shapes visual weight.
