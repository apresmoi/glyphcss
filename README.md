<p align="center">
  <img src="website/public/voxisologo.png" alt="polycss" width="300" />
</p>

# polycss

Render textured 3D meshes as inspectable DOM. No WebGL, no scene canvas, no runtime 3D engine: just DOM polygons positioned with CSS `matrix3d(...)`. Style them with CSS, inspect them in DevTools, and make them interactive through framework components, custom elements, or render props.

Visit [polycss.com](https://polycss.com) for docs and model examples.

## Installation

```bash
# React
npm install @layoutit/polycss-react

# Vue
npm install @layoutit/polycss-vue

# Vanilla / custom elements
npm install @layoutit/polycss
```

## Quick start: React

```tsx
import { PolyCamera, PolyScene, PolyOrbitControls, PolyMesh } from "@layoutit/polycss-react";

export function App() {
  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolyOrbitControls drag wheel />
        <PolyMesh src="/cottage.glb" />
      </PolyScene>
    </PolyCamera>
  );
}
```

## Quick start: Vue

```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <PolyOrbitControls drag wheel />
      <PolyMesh src="/cottage.glb" />
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyOrbitControls, PolyMesh } from "@layoutit/polycss-vue";
</script>
```

## Quick start: Vanilla HTML

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-scene rot-x="65" rot-y="45">
  <poly-orbit-controls drag wheel></poly-orbit-controls>
  <poly-mesh src="/cottage.glb"></poly-mesh>
</poly-scene>
```

## Per-polygon interactivity

Render polygons directly when you need per-face DOM events or custom styling:

```tsx
<PolyCamera>
  <PolyScene>
    {polygons.map((p, index) => (
      <Poly
        key={index}
        {...p}
        onClick={() => alert(`clicked polygon ${index}`)}
        className="my-polygon"
      />
    ))}
  </PolyScene>
</PolyCamera>
```

## Packages

| Package | Description |
|---|---|
| `@layoutit/polycss-core` | Parsers, geometry, lighting, and camera helpers. |
| `@layoutit/polycss-react` | React components (`PolyCamera`, `PolyScene`, `PolyOrbitControls`, `PolyMapControls`, `PolyMesh`, `Poly`). |
| `@layoutit/polycss-vue` | Vue 3 components with the same rendering surface. |
| `@layoutit/polycss` | Vanilla custom elements + imperative `createPolyScene` API. |

## Supported formats

- OBJ + MTL, including `map_Kd` textures and UV coordinates
- GLB and self-contained glTF, including embedded images and `TEXCOORD_0`
- MagicaVoxel `.vox`, with face-culling and custom/default palettes

## License

MIT.
