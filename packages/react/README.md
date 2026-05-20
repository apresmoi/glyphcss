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
  GlyphScene,
  GlyphCamera,
  GlyphMesh,
  GlyphOrbitControls,
} from "@glyphcss/react";

export function App() {
  return (
    <GlyphScene cols={80} rows={40}>
      <GlyphCamera rotX={65} rotY={45}>
        <GlyphOrbitControls />
        <GlyphMesh src="/cottage.glb" />
      </GlyphCamera>
    </GlyphScene>
  );
}
```

## Component reference

### `<GlyphScene>`

Root of every React glyphcss render tree. Owns the `<pre>` output element and rasterizes all meshes on camera or state change.

| Prop | Type | Default | Description |
|---|---|---|---|
| `cols` | `number` | `80` | Grid width in character cells |
| `rows` | `number` | `40` | Grid height in character cells |
| `mode` | `"wireframe" \| "solid" \| "voxel"` | `"solid"` | Render mode |
| `className` | `string` | — | CSS class on the `<pre>` container |

### `<GlyphCamera>` / `<GlyphOrthographicCamera>`

Orthographic camera. `GlyphCamera` is the ergonomic default alias.

| Prop | Type | Default | Description |
|---|---|---|---|
| `rotX` | `number` | `0` | Tilt in radians |
| `rotY` | `number` | `0` | Azimuth in radians |
| `zoom` | `number` | `0.4` | Mesh fraction of min(cols, rows) |

### `<GlyphPerspectiveCamera>`

Perspective (foreshortened) camera. Required for `<GlyphFirstPersonControls>`.

| Prop | Type | Default | Description |
|---|---|---|---|
| `rotX` | `number` | `0` | Tilt in radians |
| `rotY` | `number` | `0` | Azimuth in radians |
| `distance` | `number` | `3` | Perspective distance in world units |
| `zoom` | `number` | `0.4` | Mesh fraction of min(cols, rows) |

### `<GlyphMesh>`

Loads and displays a 3D mesh. Supports `.obj`, `.glb`, `.gltf`, `.vox`.

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | URL of the mesh file |
| `color` | `string` | Override mesh color |

### `<GlyphOrbitControls>` / `<GlyphMapControls>`

Mouse/touch/keyboard camera controls.

### Hooks

- `useGlyphCamera()` — access the camera context
- `useGlyphSceneContext()` — access scene state
- `useGlyphMesh(handle)` — mesh state and imperative API
- `useGlyphAnimation(clips, controller)` — three.js-style animation mixer

## License

MIT
