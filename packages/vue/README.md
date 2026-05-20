> **Status: pre-1.0. APIs may still change before a stable 1.0 release.**

# @glyphcss/vue

Native Vue 3 components for glyphcss — an ASCII polygon mesh renderer that projects 3D scenes into a single `<pre>` element. Loads OBJ, glTF, GLB, and MagicaVoxel `.vox` files; renders the result as monospace text in the browser.

## Install

```bash
npm install @glyphcss/vue
```

Requires Vue 3 as a peer dependency.

## Quickstart

```vue
<template>
  <GlyphScene :cols="80" :rows="40">
    <GlyphCamera :rot-x="65" :rot-y="45">
      <GlyphOrbitControls />
      <GlyphMesh src="/cottage.glb" />
    </GlyphCamera>
  </GlyphScene>
</template>

<script setup lang="ts">
import {
  GlyphScene,
  GlyphCamera,
  GlyphMesh,
  GlyphOrbitControls,
} from "@glyphcss/vue";
</script>
```

## Component reference

### `<GlyphScene>`

Root of every Vue glyphcss render tree. Owns the `<pre>` output element and rasterizes all meshes on camera or state change.

| Prop | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Grid width in character cells |
| `rows` | `number` | `40` | Grid height in character cells |
| `mode` | `"wireframe" \| "solid" \| "voxel"` | `"solid"` | Render mode |

### `<GlyphCamera>` / `<GlyphPerspectiveCamera>`

Perspective camera. `GlyphCamera` is the ergonomic alias.

| Prop | Type | Default | Description |
|---|---|---|---|
| `fov` | `number` | `60` | Vertical field of view in degrees |
| `rot-x` | `number` | `35` | Tilt in degrees |
| `rot-y` | `number` | `45` | Azimuth in degrees |
| `zoom` | `number` | `1` | Zoom multiplier |

### `<GlyphMesh>`

Loads and displays a 3D mesh. Supports `.obj`, `.glb`, `.gltf`, `.vox`.

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | URL of the mesh file |
| `color` | `string` | Override mesh color |

### `<GlyphOrbitControls>` / `<GlyphMapControls>`

Mouse/touch/keyboard camera controls.

### Composables

- `useGlyphCamera()` — access the camera context
- `useGlyphSceneContext()` — access scene state
- `useGlyphAnimation(clips, controller)` — three.js-style animation mixer

## License

MIT
