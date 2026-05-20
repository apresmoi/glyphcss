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
  <GlyphCamera :rot-x="0.4" :zoom="0.32">
    <GlyphScene :cols="80" :rows="40">
      <GlyphOrbitControls />
      <GlyphMesh src="/cottage.glb" />
    </GlyphScene>
  </GlyphCamera>
</template>

<script setup lang="ts">
import {
  GlyphCamera,
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
} from "@glyphcss/vue";
</script>
```

## Component reference

### `<GlyphCamera>` / `<GlyphOrthographicCamera>`

Orthographic camera. `GlyphCamera` is the ergonomic default alias. Wraps
`<GlyphScene>` — the camera is always the outermost element.

| Prop | Type | Default | Description |
|---|---|---|---|
| `rot-x` | `number` | `0` | Tilt in radians |
| `rot-y` | `number` | `0` | Azimuth in radians |
| `zoom` | `number` | `0.4` | Mesh fraction of min(cols, rows) |

### `<GlyphPerspectiveCamera>`

Perspective (foreshortened) camera. Required for `<GlyphFirstPersonControls>`.

| Prop | Type | Default | Description |
|---|---|---|---|
| `rot-x` | `number` | `0` | Tilt in radians |
| `rot-y` | `number` | `0` | Azimuth in radians |
| `distance` | `number` | `3` | Perspective distance in world units |
| `zoom` | `number` | `0.4` | Mesh fraction of min(cols, rows) |

### `<GlyphScene>`

Root of every Vue glyphcss render tree. Owns the `<pre>` output element and rasterizes all meshes on camera or state change. Must be a child of a camera component.

| Prop | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Grid width in character cells |
| `rows` | `number` | `40` | Grid height in character cells |
| `mode` | `"wireframe" \| "solid" \| "voxel"` | `"solid"` | Render mode |

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
