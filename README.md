# VoxCSS

CSS-first voxel renderer that stacks plain HTML layers with 3D transforms—essentially a web-based voxel engine powered by CSS grids. VoxCSS ships the core runtime plus thin Vue, React, and Svelte wrappers.

### Usage


```ts
import { createCamera, createScene, renderScene } from "@layoutit/voxcss";

const cameraElement = document.getElementById("camera");
const sceneElement = document.getElementById("scene");

if (cameraElement && sceneElement) {
  const camera = createCamera({ element: cameraElement, interactive: true, zoom: 1.2 });
  const scene = createScene({
    element: sceneElement,
    voxels,
    rows: 8,
    cols: 8,
    depth: 6,
    showWalls: true,
    showFloor: true
  });
  renderScene({ camera, scene });
}
```


## API reference

### VoxCamera props

- `interactive` – enable pointer drag controls; disable it for deterministic screenshots or SSR.
- `zoom`, `pan`, `tilt` – translate the camera in/out, vertically, and horizontally; passing arrays lets you animate per axis.
- `rotX`, `rotY` – rotate around the X/Y axis; dimetric defaults mimic the landing page hero, but you can dial them toward orthographic looks.
- `perspective` or `false` – control CSS perspective depth or disable it.
- `invert` – flip pointer drag direction to match your app’s UX.

### VoxScene props

- `voxels` – required grid data (see model below); accepts any iterable of voxel objects.
- `rows`, `cols`, `depth` – override inferred bounds when you have sparse data or want to reserve empty margins.
- `show-walls`, `show-floor` – toggle structural planes to provide context or make floating builds feel grounded.
- `shapes` – custom shape renderers keyed by `voxel.shape`, useful for sprites, extrusions, or decals without touching the renderer internals.

### Voxel data model

```ts
type Voxel = {
  x: number;
  y: number;
  z: number;
  x2?: number; // defaults to x + 1
  y2?: number; // defaults to y + 1
  color?: string;
  texture?: string;
  shape?: string;
  data?: Record<string, unknown>;
};
type VoxelGrid = Voxel[];
```

Leave `rows`, `cols`, and `depth` undefined unless you need to clamp empty space—the renderer infers them from the voxel set.

Vue 3
```vue
<template>
  <VoxCamera interactive>
    <VoxScene :voxels="voxels" />
  </VoxCamera>
</template>
<script setup lang="ts">
import { VoxCamera, VoxScene } from "@layoutit/voxcss/vue";
const voxels = [{ x: 1, y: 1, z: 0, color: "#f00" }];
</script>
```

React
```tsx
import { VoxCamera, VoxScene } from "@layoutit/voxcss/react";

export function App({ voxels }) {
  return (
    <VoxCamera interactive>
      <VoxScene voxels={voxels} />
    </VoxCamera>
  );
}
```

## License

MIT.
