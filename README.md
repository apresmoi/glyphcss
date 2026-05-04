<p align="center">
  <img src="website/public/voxisologo.png" alt="polycss" width="300" />
</p>

# polycss

> Currently using the legacy voxcss logo as a placeholder until a polycss-specific identity is designed.

Render textured 3D meshes in the DOM. No WebGL, no 3D library — the rendered scene is a tree of standard DOM elements (`<img>`, `<svg>`) positioned with `transform: matrix3d(...)`. Each polygon is one DOM node you can target with CSS, attach handlers to, and inspect in DevTools.

Visit [polycss.com](https://polycss.com) for docs and model examples.

## Installation

```bash
# React
npm install @polycss/react

# Vue
npm install @polycss/vue

# Vanilla / custom elements
npm install polycss
```

## Quick start — React

```tsx
import { PolyScene, PolyMesh } from "@polycss/react";

export function App() {
  return (
    <PolyScene rotX={65} rotY={45} interactive>
      <PolyMesh src="/cottage.glb" />
    </PolyScene>
  );
}
```

## Quick start — Vue

```vue
<template>
  <PolyScene :rot-x="65" :rot-y="45" interactive>
    <PolyMesh src="/cottage.glb" />
  </PolyScene>
</template>

<script setup lang="ts">
import { PolyScene, PolyMesh } from "@polycss/vue";
</script>
```

## Quick start — Vanilla HTML

```html
<script type="module" src="https://esm.sh/polycss/elements"></script>

<poly-scene rot-x="65" rot-y="45">
  <poly-mesh src="/cottage.glb"></poly-mesh>
</poly-scene>
```

## Per-polygon interactivity

The DOM-native approach means every polygon is a real element:

```tsx
<PolyScene>
  {polygons.map(p => (
    <Poly
      key={p.id}
      vertices={p.vertices}
      color={p.color}
      onClick={() => alert(`clicked ${p.id}`)}
      className="my-polygon"
    />
  ))}
</PolyScene>
```

## Packages

| Package | Description |
|---|---|
| `@polycss/core` | Pure math: parsers, lighting, camera. Zero browser globals. |
| `@polycss/react` | React components (`PolyScene`, `PolyMesh`, `Poly`, `useMesh`). |
| `@polycss/vue` | Vue 3 components (same surface as React, Vue idioms). |
| `polycss` | Vanilla custom elements + imperative `createPolyScene` API. |

## Supported formats

- OBJ + MTL (including `map_Kd` textures, UV coordinates)
- glTF / GLB (including embedded images, TEXCOORD_0 UV decoding)
- MagicaVoxel `.vox` (face-culled voxel grids → triangle meshes; custom and default palette)

## License

MIT.
