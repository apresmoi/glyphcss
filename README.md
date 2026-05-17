# glyphcss

An ASCII polygon mesh renderer for the DOM. Glyphcss projects 3D scenes to 2D, rasterises them as monospace text, and writes the result into a single `<pre>` element — no WebGL, no canvas-per-frame, no per-polygon DOM nodes.

Loads OBJ, glTF, GLB, and MagicaVoxel `.vox` files. Supports wireframe, solid, and voxel render modes.

> **Forked from [LayoutitStudio/polycss](https://github.com/LayoutitStudio/polycss).** The mesh math, parsers (OBJ / glTF / GLB / VOX), scene composition, camera math, and input controls are inherited. The paint backend is rewritten: instead of one CSS-transformed DOM leaf per polygon, glyphcss walks all polygons, fills a character grid, and writes a single text string to `<pre>.textContent` per frame.

## Installation

```bash
# Vanilla / custom elements
npm install glyphcss

# React
npm install @glyphcss/react

# Vue 3
npm install @glyphcss/vue
```

## Quick start: React

```tsx
import {
  GlyphcssScene,
  GlyphcssCamera,
  GlyphcssOrbitControls,
  GlyphcssMesh,
} from "@glyphcss/react";

export function App() {
  return (
    <GlyphcssScene cols={80} rows={40}>
      <GlyphcssCamera rotX={65} rotY={45}>
        <GlyphcssOrbitControls />
        <GlyphcssMesh src="/cottage.glb" />
      </GlyphcssCamera>
    </GlyphcssScene>
  );
}
```

## Quick start: Vue

```vue
<template>
  <GlyphcssScene :cols="80" :rows="40">
    <GlyphcssCamera :rot-x="65" :rot-y="45">
      <GlyphcssOrbitControls />
      <GlyphcssMesh src="/cottage.glb" />
    </GlyphcssCamera>
  </GlyphcssScene>
</template>

<script setup lang="ts">
import {
  GlyphcssScene,
  GlyphcssCamera,
  GlyphcssOrbitControls,
  GlyphcssMesh,
} from "@glyphcss/vue";
</script>
```

## Quick start: Vanilla HTML

```html
<script type="module" src="https://esm.sh/glyphcss/elements"></script>

<glyphcss-scene cols="80" rows="40">
  <glyphcss-mesh src="/cottage.glb"></glyphcss-mesh>
</glyphcss-scene>
```

## Packages

| Package | Description |
|---|---|
| `@glyphcss/core` | Parsers, geometry, lighting, and camera helpers. Zero browser globals. |
| `glyphcss` | ASCII rasteriser + vanilla custom elements + imperative `createGlyphcssScene` API. |
| `@glyphcss/react` | React components (`GlyphcssScene`, `GlyphcssCamera`, `GlyphcssMesh`, controls). |
| `@glyphcss/vue` | Vue 3 mirror of the React package. |

## Supported formats

- OBJ + MTL, including `map_Kd` textures and UV coordinates
- GLB and self-contained glTF, including embedded images and `TEXCOORD_0`
- MagicaVoxel `.vox`, with face-culling and custom/default palettes

## License

MIT
