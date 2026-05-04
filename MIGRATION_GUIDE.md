# Migration Guide: voxcss → polycss

polycss is a fork of voxcss focused exclusively on polygon mesh rendering. If you were using `@layoutit/voxcss` or its companion packages for cube-block scenes, this guide covers what changed, what was removed, and how to update if you want the polygon-mesh path that polycss exposes.

**Note:** Voxcss remains available for cube-block use cases. Polycss is for users who specifically want to render OBJ / glTF / GLB mesh files as DOM elements. If your project uses cubes, ramps, wedges, or the voxel grid, there is no migration path — continue using voxcss.

---

## Package rename

| Voxcss package | Polycss package | Install |
|---|---|---|
| `@layoutit/voxcss-core` | `@polycss/core` | `npm install @polycss/core` |
| `@layoutit/voxcss-react` | `@polycss/react` | `npm install @polycss/react` |
| `@layoutit/voxcss-vue` | `@polycss/vue` | `npm install @polycss/vue` |
| `@layoutit/voxcss-html` | `polycss` | `npm install polycss` |
| `@layoutit/voxcss` (umbrella) | _(no equivalent)_ | Install the framework-specific package instead |

Update your `package.json` and all import paths:

```diff
- import { VoxScene, VoxCamera } from "@layoutit/voxcss-react";
+ import { PolyScene, PolyCamera } from "@polycss/react";
```

---

## Component renames

| Voxcss | Polycss | Notes |
|---|---|---|
| `VoxScene` | `PolyScene` | Props restructured — see below |
| `VoxCamera` | `PolyCamera` | Same purpose, cleaner prop surface |
| `VoxShape` | _(removed)_ | No shape dispatcher needed; use `<Poly>` directly |
| `VoxLayer` | _(removed)_ | No Z-layer concept in polycss |
| `VoxSliceRenderer` | _(removed)_ | Slice rendering was cube-only |
| `VoxCube` | _(removed)_ | Use `<Poly vertices={...}>` with explicit coords |
| `Ramp`, `Wedge`, `Spike` | _(removed)_ | Encode these shapes as polygon vertex arrays |
| `Floor`, `Ceiling`, `Walls` | _(removed)_ | Render floor/ceiling as `<Poly>` elements if needed |

---

## CSS class and variable renames

All emitted CSS class names and custom properties changed prefix:

| Voxcss | Polycss |
|---|---|
| `voxcss-scene` | `polycss-scene` |
| `voxcss-triangle` | `polycss-poly` |
| `voxcss-mesh` | `polycss-mesh` |
| `--voxcss-perspective` | `--polycss-perspective` |
| `--voxcss-*` | `--polycss-*` |

If you have CSS selectors or styles targeting voxcss class names, update them.

---

## Type renames

| Voxcss type | Polycss type | Notes |
|---|---|---|
| `Voxel` | `Polygon` | Completely restructured — see below |
| `VoxelGrid` | `Polygon[]` | Plain array, no wrapper type |
| `InputVoxel` | _(removed)_ | No two-type distinction |
| `InputVoxelGrid` | _(removed)_ | |
| `normalizeVoxels` | `normalizePolygons` | Different signature |
| `getVoxelBounds` | _(removed)_ | Compute from vertices directly |
| `mergeVoxels` | _(removed)_ | Use `mergePolygons` for polygon merge |

---

## The `Polygon` type (replaces `Voxel`)

The biggest structural change. Voxcss's `Voxel` had many fields:

```ts
// voxcss — Voxel
interface Voxel {
  x: number; y: number; z: number;    // bbox origin
  x2: number; y2: number; z2: number; // bbox end
  shape: "cube" | "ramp" | "wedge" | "spike" | "triangle";
  color?: string;
  texture?: string;
  uvs?: Vec2[];
  // ...more cube-specific fields
}
```

Polycss's `Polygon` has just the polygon-relevant fields:

```ts
// polycss — Polygon
interface Polygon {
  vertices: Vec3[];           // Required — 3+ [x, y, z] points in world space
  color?: string;             // CSS color
  texture?: string;           // Image URL
  uvs?: Vec2[];              // UV coordinates (one per vertex)
  data?: Record<string, string | number | boolean>;  // Reflected as data-* attributes
}
```

Key differences:
- **No bbox fields** (`x/y/z/x2/y2/z2`). Polycss derives all positioning from `vertices` directly via `transform: matrix3d(...)`.
- **No `shape` field**. All polygons go through the same renderer.
- **`data` replaces arbitrary metadata**. Reflected to the DOM as `data-*` attributes.

---

## Removed features

### Cube primitives

Voxcss's cube grid system (VoxCube, Ramp, Wedge, Spike, CSS Grid positioning, VoxLayer, slice rendering) has no equivalent in polycss. Polycss renders arbitrary polygon meshes — not axis-aligned cubes.

If you need cube shapes, you can represent them as six `<Poly>` elements with explicit vertex coordinates:

```tsx
// A unit cube face (top face)
const topFace: Vec3[] = [[0,1,0], [1,1,0], [1,1,1], [0,1,1]];

<PolyScene>
  <Poly vertices={topFace} color="#4a90e2" />
</PolyScene>
```

### Wall masks

Voxcss's wall mask system (`wallMask`, `showWalls`, directional bin classes like `voxcss-cull-dir-N`) is removed. Polycss has no built-in wall/floor concept.

### `mergeVoxels`

Removed. For polygon-mesh scenes, use `mergePolygons` from `@polycss/core` to merge coplanar same-material adjacent polygons.

### Floor and ceiling as primitives

`<Floor>` and `<Ceiling>` are removed. Render these as `<Poly>` elements if your scene needs them.

### MagicaVoxel parser

`parseMagicaVoxel` is not included in polycss. It was cube-specific.

### `useSliceBrushes` hook

Removed (was cube-grid editing).

---

## New in polycss

### `<PolyMesh>` — declarative mesh loader

Replaces the ad-hoc `useObjModel` / `useGltfModel` pattern from voxcss debug pages:

```tsx
// Before (voxcss debug pattern)
const { voxels } = useObjModel("/cottage.obj");
<VoxScene>{voxels.map(v => <VoxShape key={v.id} voxel={v} />)}</VoxScene>

// After
<PolyScene><PolyMesh src="/cottage.obj" /></PolyScene>
```

### `autoCenter` prop

`<PolyMesh autoCenter>` shifts the loaded mesh so its bounding-box center sits at the local origin before any `position` offset is applied. Useful when OBJ/GLB assets aren't centered in their file coordinates.

### `<Poly>` — per-polygon DOM access

Every polygon is a real DOM element. Standard event handlers, CSS classes, and ARIA attributes work:

```tsx
<Poly
  vertices={triangle}
  color="#ff0000"
  onClick={() => console.log("clicked")}
  onMouseEnter={() => setHighlighted(true)}
  className="my-poly"
  aria-label="Building roof"
/>
```

### Unified `ParseResult`

All parsers (`parseObj`, `parseGltf`, `loadMesh`) now return the same shape:

```ts
interface ParseResult {
  polygons: Polygon[];
  objectUrls: string[];    // blob: URLs to revoke on cleanup
  dispose: () => void;     // revoke all objectUrls (idempotent)
  warnings: string[];      // non-fatal parse warnings
  metadata?: {
    triangleCount?: number;
    meshes?: string[];
    materials?: string[];
  };
}
```

### Vue 3 package (`@polycss/vue`)

Polycss ships Vue 3 bindings from the start. Same component surface as React, using composition API and scoped slots.

### Vanilla custom elements (`polycss` package)

`<poly-scene>`, `<poly-mesh>`, `<poly-polygon>` work as standard HTML custom elements — no framework required. Also includes an imperative `createPolyScene` API.

---

## Before / after migration examples

### Render a mesh from a file

```tsx
// voxcss (from debug pages)
import { useObjModel } from "../hooks/useObjModel";
import { VoxScene, VoxShape } from "@layoutit/voxcss-react";

function Viewer() {
  const { voxels, loading } = useObjModel("/cottage.obj");
  if (loading) return <div>Loading…</div>;
  return (
    <VoxScene showFloor={false} wallMask={0}>
      {voxels.map((v, i) => <VoxShape key={i} voxel={v} />)}
    </VoxScene>
  );
}

// polycss
import { PolyScene, PolyMesh } from "@polycss/react";

function Viewer() {
  return (
    <PolyScene>
      <PolyMesh src="/cottage.obj" />
    </PolyScene>
  );
}
```

### Interactive per-polygon

```tsx
// voxcss — limited: Triangle.tsx had pointerEvents: "none"
<VoxShape voxel={v} onClick={...} />  // often didn't work

// polycss — first-class
<Poly vertices={v.vertices} color={v.color} onClick={() => alert("clicked")} />
```

### Camera with auto-rotate

```tsx
// voxcss
<VoxCamera interactive autoRotate>
  <VoxScene>...</VoxScene>
</VoxCamera>

// polycss
<PolyScene
  interactive
  autoRotate={{ axis: "y", speed: 0.3, pauseOnInteraction: true }}
>
  <PolyMesh src="/model.glb" />
</PolyScene>
```

### Parse OBJ manually

```ts
// voxcss
import { parseObj } from "@layoutit/voxcss-core";
const { voxels, triangleCount, materials } = parseObj(text);

// polycss — unified ParseResult shape
import { parseObj } from "@polycss/core";
const { polygons, warnings, dispose, metadata } = parseObj(text);
```

---

## Checklist

- [ ] Replace all `@layoutit/voxcss*` install + import paths with `@polycss/*` / `polycss`
- [ ] Rename `VoxScene` → `PolyScene`, `VoxCamera` → `PolyCamera` in all components
- [ ] Remove `showFloor`, `showWalls`, `wallMask`, and any cube-era props from scene components
- [ ] Remove `VoxCube`, `Ramp`, `Wedge`, `Spike` usage — represent these shapes as `<Poly vertices={...}>` if still needed
- [ ] Update parser call sites: `{ voxels }` return → `{ polygons }` return
- [ ] Update CSS selectors: `voxcss-*` → `polycss-*`, `--voxcss-*` → `--polycss-*`
- [ ] Remove `mergeVoxels` calls; use `mergePolygons` for polygon merge
- [ ] Call `dispose()` on `ParseResult` (or use `<PolyMesh>` / `useMesh` which handle it automatically)
