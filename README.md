# VoxCSS

A DOM based voxel engine. Renders HTML cuboids by stacking CSS grid layers and applying 3D transforms. Supports colors and textures, interactions and culling, plus shapes and dimetric projections. Works with Vue, React, Svelte, or plain JavaScript.

Visit [voxcss.com](https://voxcss.com) for live docs, API reference, and model examples.

<img width="1915" height="900" alt="Screenshot 2025-11-17 at 08 00 28" src="https://github.com/user-attachments/assets/2d925a72-5518-4a82-a8b2-39ff5648fea7" />


## Installation

```bash
npm install @layoutit/voxcss
# or
yarn add @layoutit/voxcss
# or
pnpm add @layoutit/voxcss
```

You can also load VoxCSS directly from unpkg. Here is a minimal example:

```html
<script type="module">
  import { createCamera, createScene, renderScene } from "https://unpkg.com/@layoutit/voxcss@latest/dist/index.js";

  const camera = createCamera({
        element: document.getElementById("camera"),
        interactive: true,
    });

  const scene = createScene({
        element: document.getElementById("scene"),
        voxels: [{ x: 3, y: 3, z: 0 }, { x: 3, y: 3, z: 1 }],
        rows: 8,
        cols: 8,
        depth: 6,
        showWalls: true,
        showFloor: true
    });

  renderScene({ camera, scene });
</script>

<div id="camera">
  <div id="scene"></div>
</div>
```

## Framework Components

VoxCamera sets the viewpoint and exposes zoom, pan, tilt, rotation, perspective, and interaction flags. VoxScene receives the voxel object and controls the 3D grid dimensions and decorations. 

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
A legacy Vue 2 component is also included.

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
- `projection` – pick `"cubic"` or `"dimetric"` presets to change the layer spacing.

### VoxScene props

- `voxels` – required grid data (see model below); accepts any iterable of voxel objects.
- `rows`, `cols`, `depth` – override inferred bounds when you have sparse data or want to reserve empty margins.
- `show-walls`, `show-floor` – toggle structural planes to provide context or make floating builds feel grounded.

Leave `rows`, `cols`, and `depth` undefined unless you need to clamp empty space, the renderer infers them from the voxel set.

### Voxel data model

Each voxel describes a single cell in the grid:
- `x`, `y`, `z` – required integer coordinates.
- `shape` – `cube` (default), `ramp`, `wedge`, or `spike`.
- `color` / `texture` – apply solid fills or image URLs per voxel.
- `rot` – per-voxel rotation in degrees; ramps/wedges/spikes snap to 90° increments.

Example:
```ts
const voxels = [
  { x: 2, y: 2, z: 0, color: "#f97316" },
  { x: 3, y: 2, z: 0, shape: "ramp", rot: 90, color: "#94a3b8" },
  { x: 3, y: 3, z: 0, texture: "/example.png" }
];
```



## License

MIT.
