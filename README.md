# VoxCSS

A DOM based voxel engine. Renders HTML cuboids by stacking CSS grid layers and applying 3D transforms. Supports colors and textures, interactions and culling, plus shapes and dimetric projections. Ships the core runtime with thin Vue, React, and Svelte wrappers. 

For live docs, API reference, and model examples visit [voxcss.com](https://voxcss.com)

<img width="1915" height="900" alt="Screenshot 2025-11-17 at 08 00 28" src="https://github.com/user-attachments/assets/2d925a72-5518-4a82-a8b2-39ff5648fea7" />


## Installation

```bash
npm install @layoutit/voxcss
# or
yarn add @layoutit/voxcss
# or
pnpm add @layoutit/voxcss
```

You can also load VoxCSS directly from unpkg:

```html
  <div id="camera">
    <div id="scene"></div>
  </div>
  <script type="module">
    import { createCamera, createScene, renderScene } from "https://unpkg.com/@layoutit/voxcss@0.0.1/dist/index.js";

    const voxels = [{ x: 3, y: 3, z: 0, color: "#F97316" }];

    const cameraElement = document.getElementById("camera");
    const sceneElement = document.getElementById("scene");

    if (cameraElement && sceneElement) {
      const camera = createCamera({ element: cameraElement, interactive: true, zoom: 1.5 });
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
  </script>
```

## Framework Components

VoxCamera exposes zoom, pan, tilt, rotation, perspective, and pointer inversion flags. VoxScene controls the 3D grid dimensions and decorations. 

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

Svelte
```svelte
<script lang="ts">
  import { VoxCamera, VoxScene } from "@layoutit/voxcss/svelte";

  const voxels = [{ x: 2, y: 2, z: 0, color: "#0EA5E9" }];
</script>

<VoxCamera interactive>
  <VoxScene {voxels} />
</VoxCamera>
```

## API reference

### VoxCamera props

- `interactive` – enable pointer drag controls.
- `zoom`, `pan`, `tilt` – translate the camera in/out, vertically, and horizontally.
- `rotX`, `rotY` – rotate around the X/Y axis.
- `perspective` – control CSS perspective depth (or disable it).
- `invert` – flip pointer drag direction.

### VoxScene props

- `voxels` – required grid data (see model below); accepts any iterable of voxel objects.
- `rows`, `cols`, `depth` – override inferred bounds when you have sparse data or want to reserve empty margins.
- `show-walls`, `show-floor` – toggle structural planes to provide context or make floating builds feel grounded.

Leave `rows`, `cols`, and `depth` undefined unless you need to clamp empty space, the renderer infers them from the voxel set.

### Voxel data model

The voxel object accepts shape, dimensions, rotation, color and textures.
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
};
type VoxelGrid = Voxel[];
```



## License

MIT.
