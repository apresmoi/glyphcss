# VoxCSS

A CSS voxel engine. Renders HTML cuboids by stacking grid layers and applying 3D transforms. Supports colors and textures, interactions and culling, plus shapes and dimetric projections. Works with Vue, React, Svelte, or plain JavaScript.

Visit [voxcss.com](https://voxcss.com) for live docs, API reference, and model examples.

<img width="1725" height="865" alt="voxscene" src="https://github.com/user-attachments/assets/e3707a01-f257-4f62-9577-a9e08b3652e3" />

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

`<VoxCamera>` sets the viewpoint and exposes zoom, pan, tilt, rotation, perspective, and interaction props. `<VoxScene>` receives the voxel array and controls the 3D grid and its decorations. Vue, React, and Svelte wrappers all expose these two components with identical props:

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

Visit [voxcss.com/usage](https://voxcss.com/usage) for more framework-specific examples.

![apple](https://github.com/user-attachments/assets/f6764fe9-3a8f-45d0-8976-4b1b4d6ff760)

## API reference

### VoxCamera props

- `interactive` – enable pointer drag controls.
- `zoom`, `pan`, `tilt` – translate the camera in/out, vertically, and horizontally.
- `rotX`, `rotY` – rotate around the X/Y axis.
- `perspective` – control CSS perspective depth (or disable it).
- `invert` – flip pointer drag direction.
- `animate` – auto-rotate the camera; accepts `true`, a speed number, or `{ axis, speed, pauseOnInteraction }`.

### VoxScene props

- `voxels` – array of voxel objects; optional (defaults to empty) to render a blank scene.
- `rows`, `cols`, `depth` – override inferred bounds when you have sparse data or want to reserve empty margins.
- `show-walls`, `show-floor` – toggle structural planes to provide context or make floating builds feel grounded.
- `projection` – pick `"cubic"` or `"dimetric"` presets to change the layer spacing.
- `mergeVoxels` – opt into voxel merging to collapse contiguous cubes into larger areas (`x2/y2`). Accepts `true`, `false`, or a number threshold (merge when the voxel count exceeds the value). Defaults to auto-merging large inputs.

Leave `rows`, `cols`, and `depth` undefined unless you need to clamp empty space, the renderer infers them from the voxel set.

### Voxel data model

Each voxel describes a single cell in the grid:
- `x`, `y`, `z` – required integer coordinates; `x2`/`y2` optional for area footprints.
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

## Performance

VoxCSS renders everything in the DOM, so performance is determined by how many elements the browser has to manage. The engine reduces work through culling based on neighbors and camera rotation, only drawing the outer shell of the model with the faces that are actually visible. 

The `mergeVoxels` prop can be essential: instead of rendering each cube as its own node, the engine scans each layer and groups adjacent voxels into larger rectangles in the x/y dimensions. Merging is auto-enabled for bigger scenes (over 2000 voxels) and can cut DOM size dramatically.

## Loading MagicaVoxel (.vox) files

Use the built-in parser to turn a MagicaVoxel `.vox` binary into a voxel object and feed it to `renderScene`:
```ts
import { parseMagicaVoxel, renderScene } from "@layoutit/voxcss";

const rootEl = document.getElementById("voxcss")!;

fetch("/models/example.vox")
  .then((r) => r.arrayBuffer())
  .then((buffer) => parseMagicaVoxel(buffer))
  .then(({ voxels, rows, cols, depth }) => {
    renderScene({
      element: rootEl,
      camera: { interactive: true },
      scene: {
        voxels,
        rows,
        cols,
        depth,
        showWalls: true,
        showFloor: true
      }
    });
  });
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
