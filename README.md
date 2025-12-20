# VoxCSS

A CSS voxel engine. A 3D grid for the DOM. Renders HTML cuboids by stacking grid layers and applying transforms. Supports colors and textures, interactions and culling, plus shapes, areas and projections. Works with Vue, React, Svelte, or plain JavaScript.

Visit [voxcss.com](https://voxcss.com) for docs and model examples.

<img width="1725" height="865" alt="voxscene" src="https://github.com/user-attachments/assets/e3707a01-f257-4f62-9577-a9e08b3652e3" />

## Installation

```bash
npm install @layoutit/voxcss
```

You can also load VoxCSS directly from unpkg. Here is a minimal example:

```html
<div id="voxcss"></div>

<script type="module">
  import { renderScene } from "https://unpkg.com/@layoutit/voxcss@latest/dist/index.js";

  renderScene({
    element: document.getElementById("voxcss"),
    camera: { interactive: true },
    scene: {
      voxels: [
        { x: 3, y: 3, z: 0 },
        { x: 3, y: 3, z: 1 }
      ],
      showFloor: true
    }
  });
</script>

```

## Framework Components

Vue, React, and Svelte wrappers all expose the same components with identical props: `<VoxCamera>` controls the viewpoint (zoom, pan, tilt, rotation, perspective), while `<VoxScene>` receives the voxel array and manages the 3D grid and its decorations.

```tsx
import { VoxCamera, VoxScene } from "@layoutit/voxcss/react";

export default function App() {
  const voxels = [{ x: 1, y: 1, z: 0, color: "#f00" }];

  return (
    <VoxCamera interactive>
      <VoxScene voxels={voxels} />
    </VoxCamera>
  );
}
```

![apple](https://github.com/user-attachments/assets/f6764fe9-3a8f-45d0-8976-4b1b4d6ff760)

## API reference

### VoxCamera props

- `zoom`, `pan`, `tilt` – translate the camera in/out, vertically, and horizontally.
- `rotX`, `rotY` – rotate around the X/Y axis.
- `perspective` – control CSS perspective depth (or disable it).
- `interactive` – enable pointer drag controls.
- `invert` – flip pointer drag direction.
- `animate` – auto-rotate the camera; accepts `true`, a speed number, or `{ axis, speed, pauseOnInteraction }`.

### VoxScene props

- `voxels` – array of voxel objects; optional (defaults to empty) to render a blank scene.
- `rows`, `cols`, `depth` – override the inferred bounds and explicitly set the 3D grid size.
- `show-walls`, `show-floor` – toggle structural planes.
- `projection` – pick `"cubic"` or `"dimetric"` presets to change the layer spacing (50/25px).
- `mergeVoxels` – merge strategy for performance: `false` (default), `"2d"` (merge across `x`/`y` within each `z` layer), or `"3d"` (merge across `x`/`y`/`z`). If any voxel uses `z2`, the engine takes the `"3d"` render path.

### Voxel data model

Each voxel describes a single cell in the grid: 
- `x`, `y`, `z` –  required integer coordinates.
- `x2`, `y2`, `z2` – optional for area footprints.
- `shape` – `cube` (default), `ramp`, `wedge`, or `spike`.
- `color` / `texture` – apply solid fills or image URLs per voxel.
- `rot` – rotation in degrees; ramps/wedges/spikes snap to 90° increments.

Example:
```ts
const voxels = [
  { x: 2, y: 2, z: 0, color: "#f97316" },
  { x: 3, y: 2, z: 0, shape: "ramp", rot: 90, color: "#94a3b8" },
  { x: 3, y: 3, z: 0, texture: "/example.png" }
];
```

## Performance

VoxCSS renders everything in the DOM, so performance is mostly determined by how many elements the browser has to manage. To reduce work, the engine does culling based on voxel neighbors and camera rotation, rendering only the outer surface of the model and skipping faces that are not visible.

The `mergeVoxels` prop can be essential for performance. It controls the stacked grid geometry and allows the engine to group voxels into larger merged elements, significantly reducing DOM node count.

<img width="1600" height="750" alt="Voxel model showing merged grid geometries and face culling" src="https://github.com/user-attachments/assets/123f4a06-a1ac-4ec1-a58e-cade601da979" />

- `mergeVoxels="2d"` merges adjacent voxels across **x / y** within each **z layer**
- `mergeVoxels="3d"` merges across **x / y / z**

The `3d` mode switches the engine from voxel to volumetric rendering, and can unlock much better performance for large scenes.

## Loading MagicaVoxel (.vox) files

Use the built-in parser to turn a MagicaVoxel `.vox` binary into a voxel object and feed it to `renderScene`:
```html
<div id="voxcss"></div>

<script type="module">
  import { parseMagicaVoxel, renderScene } from "@layoutit/voxcss";

  const model = await fetch("/models/example.vox")
    .then(r => r.arrayBuffer())
    .then(parseMagicaVoxel);

  renderScene({
    element: document.getElementById("voxcss"),
    camera: { interactive: true },
    scene: {
      voxels: model.voxels,
      showFloor: true
    }
  });
</script>
```

## Made with VoxCSS

[Layoutit Voxels](https://voxels.layoutit.com)
→ A CSS Voxel editor

<img width="1000" height="600" alt="layoutit-voxels" src="https://github.com/user-attachments/assets/a0c83010-3852-4180-95d8-a5d69b1b2ae5" />

[Layoutit Terra](https://terra.layoutit.com)
→ A CSS Terrain Generator

<img width="1000" height="601" alt="layoutit-terra" src="https://github.com/user-attachments/assets/98ce47cb-831d-4680-b7fa-c105df202c1c" />

## License

MIT.
