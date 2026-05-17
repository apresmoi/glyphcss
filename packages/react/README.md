> **Status: pre-1.0. APIs may still change before a stable 1.0 release.**

# @glyphcss/react

React components for glyphcss — an ASCII polygon mesh renderer that projects 3D scenes into a single `<pre>` element. Loads OBJ, glTF, GLB, and MagicaVoxel `.vox` files; renders the result as monospace text in the browser.

## Install

```bash
npm install @glyphcss/react
```

Requires React 18 or 19 as a peer dependency.

## Quickstart

```tsx
import {
  GlyphcssScene,
  GlyphcssCamera,
  GlyphcssMesh,
  GlyphcssOrbitControls,
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

## Component reference

### `<GlyphcssScene>`

Root of every React glyphcss render tree. Owns the `<pre>` output element and rasterizes all meshes on camera or state change.

| Prop | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Grid width in character cells |
| `rows` | `number` | `40` | Grid height in character cells |
| `mode` | `"wireframe" \| "solid" \| "voxel"` | `"solid"` | Render mode |
| `className` | `string` | — | CSS class on the `<pre>` container |

### `<GlyphcssCamera>` / `<GlyphcssPerspectiveCamera>`

Perspective camera. `GlyphcssCamera` is the ergonomic alias.

| Prop | Type | Default | Description |
|---|---|---|---|
| `fov` | `number` | `60` | Vertical field of view in degrees |
| `rotX` | `number` | `35` | Tilt in degrees |
| `rotY` | `number` | `45` | Azimuth in degrees |
| `zoom` | `number` | `1` | Zoom multiplier |

### `<GlyphcssMesh>`

Loads and displays a 3D mesh. Supports `.obj`, `.glb`, `.gltf`, `.vox`.

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | URL of the mesh file |
| `color` | `string` | Override mesh color |

### `<GlyphcssOrbitControls>` / `<GlyphcssMapControls>`

Mouse/touch/keyboard camera controls.

### Hooks

- `useGlyphcssCamera()` — access the camera context
- `useGlyphcssSceneContext()` — access scene state
- `useGlyphcssMesh(handle)` — mesh state and imperative API
- `useGlyphcssAnimation(clips, controller)` — three.js-style animation mixer

## License

MIT
