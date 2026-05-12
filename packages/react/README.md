> **Status: pre-1.0; API surface frozen per [POLYCSS_MIGRATION.md](../../POLYCSS_MIGRATION.md). Breaking changes possible until 0.1.0 release.**

# @layoutit/polycss-react

Declarative React components for CSS-based polygon mesh rendering. Loads OBJ, glTF, GLB, and MagicaVoxel `.vox` files; renders each polygon as a real DOM element (atlas-backed `<i>` for both textured and flat-color faces) positioned with `transform: matrix3d(...)`. No WebGL, no canvas-as-scene.

## Install

```bash
npm install @layoutit/polycss-react
```

Requires React 18 or 19 as a peer dependency.

## Quickstart

```tsx
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-react";

export function App() {
  return (
    <PolyCamera rotX={65} rotY={45} perspective={1000}>
      <PolyScene>
        <PolyMesh src="/cottage.glb" />
      </PolyScene>
    </PolyCamera>
  );
}
```

Every polygon in the mesh is a real DOM element: inspect it in DevTools, style it with CSS, attach event handlers.

## Component reference

### `<PolyScene>`

Root of every React polycss render tree. Renders polygons and meshes inside a `<PolyCamera>` context, and owns scene-level lighting and atlas options.

| Prop | Type | Default | Description |
|---|---|---|---|
| `directionalLight` | `PolyDirectionalLight` | None | Directional light config |
| `ambientLight` | `PolyAmbientLight` | None | Ambient light config |
| `textureLighting` | `"baked" \| "dynamic"` | `"baked"` | Texture lighting mode |
| `atlasScale` | `number \| "auto"` | `"auto"` | Raster scale for generated atlas pages |
| `polygons` | `Polygon[]` | None | Static polygon array (composes with `children`) |
| `children` | `ReactNode` | None | `<PolyMesh>`, `<Poly>`, and/or `<PolyOrbitControls>` |

For pointer drag, wheel zoom, and autorotate, mount `<PolyOrbitControls>` (or `<PolyMapControls>` for pan-first map-style input) inside `<PolyCamera>`: it receives the camera context. Mirrors Three.js's split between camera state and input.

### `<PolyMesh>`

Loads a mesh from a URL and renders its polygons. Manages blob-URL lifecycle automatically.

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | URL to `.obj`, `.glb`, `.gltf`, or `.vox` |
| `polygons` | `Polygon[]` | Pre-parsed polygons (alternative to `src`) |
| `position` | `Vec3` | `[x, y, z]` offset in scene space |
| `scale` | `number \| Vec3` | Uniform or per-axis scale |
| `rotation` | `Vec3` | Euler angles in degrees `[x, y, z]` |
| `atlasScale` | `number \| "auto"` | Raster scale for generated atlas pages |
| `autoCenter` | `boolean` | Shift mesh so its bbox center is at origin |
| `mtl` | `string` | Companion `.mtl` URL for OBJ models |
| `parseOptions` | `UseMeshOptions` | Forwarded to `loadMesh` |
| `fallback` | `ReactNode` | Rendered while loading |
| `errorFallback` | `(error: Error) => ReactNode` | Rendered on parse failure |
| `children` | `(polygon, index) => ReactNode` | Per-polygon render prop override |

### `<Poly>`

Single polygon. The atomic primitive: renders one atlas-backed `<i>` for UV-textured and flat-color faces. Forwards all standard DOM props.

| Prop | Type | Description |
|---|---|---|
| `vertices` | `Vec3[]` | Required: 3+ `[x, y, z]` points |
| `color` | `string` | CSS color; used when no texture is set |
| `texture` | `string` | Image URL for UV-mapped rendering |
| `uvs` | `Vec2[]` | UV coordinates, one per vertex |
| `data` | `Record<string, string \| number \| boolean>` | Reflected as `data-*` DOM attributes |
| `position` | `Vec3` | Local offset |
| `scale` | `number \| Vec3` | Scale |
| `rotation` | `Vec3` | Euler rotation in degrees |
| `atlasScale` | `number \| "auto"` | Raster scale for generated atlas pages |
| `onClick` | `MouseEventHandler` | Standard DOM event handler |
| `onMouseEnter` | `MouseEventHandler` | |
| `className` | `string` | CSS class |
| `style` | `CSSProperties` | Inline style |
| `aria-label` | `string` | ARIA label |

### `<PolyCamera>`

Camera wrapper for perspective, rotation, zoom, target, and dolly distance. React scenes must render inside `<PolyCamera>` (or `<PolyPerspectiveCamera>` / `<PolyOrthographicCamera>`) so controls and scenes share camera state.

### Hooks

| Hook | Description |
|---|---|
| `usePolyCamera(options)` | Internal camera integration hook (used by `<PolyCamera>`) |
| `usePolySceneContext(polygons, options)` | Lower-level hook for building custom scene wrappers |
| `usePolyMesh(src, options?)` | Fetch + parse a mesh. Returns `{ polygons, loading, error, warnings, dispose }`. Manages blob-URL lifecycle: safe across rapid src changes and unmounts. |

### Utility

| Export | Description |
|---|---|
| `injectPolyBaseStyles(doc?)` | Inject polycss base CSS into the document. Idempotent. Called automatically by `<PolyScene>`; manual call only needed for custom scene hosts. Polygon defaults are scoped to `.polycss-scene`. |

## Re-exports from `@layoutit/polycss-core`

All types and core functions are re-exported for convenience, so you never need to add `@layoutit/polycss-core` to your dependencies:

```ts
import type { Polygon, Vec2, Vec3, PolyDirectionalLight, PolyAmbientLight, ParseResult } from "@layoutit/polycss-react";
import { parseObj, parseGltf, parseVox, loadMesh, normalizePolygons, mergePolygons } from "@layoutit/polycss-react";
```

## Per-polygon interactivity example

```tsx
import { useState } from "react";
import { PolyCamera, PolyScene, Poly } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";

export function InteractiveMesh({ polygons }: { polygons: Polygon[] }) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        {polygons.map((p, i) => (
          <Poly
            key={i}
            {...p}
            onClick={() => alert(`clicked polygon ${i}`)}
            onMouseEnter={() => setHoveredId(i)}
            onMouseLeave={() => setHoveredId(null)}
            className={hoveredId === i ? "highlight" : ""}
            style={{ transition: "filter 0.2s" }}
          />
        ))}
      </PolyScene>
    </PolyCamera>
  );
}
```

```css
.highlight { filter: brightness(1.5); }
```

## `usePolyMesh`: imperative loading

```tsx
import { PolyCamera, PolyScene, Poly, usePolyMesh } from "@layoutit/polycss-react";

function Viewer() {
  const { polygons, loading, error } = usePolyMesh("/cottage.glb");

  if (loading) return <div>Loading…</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <PolyCamera>
      <PolyScene>
        {polygons.map((p, i) => <Poly key={i} {...p} />)}
      </PolyScene>
    </PolyCamera>
  );
}
```

## Docs

Full documentation at [polycss.com](https://polycss.com).
