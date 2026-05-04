> **Status: pre-1.0; API surface frozen per [POLYCSS_MIGRATION.md](../../POLYCSS_MIGRATION.md). Breaking changes possible until 0.1.0 release.**

# @polycss/react

Declarative React components for CSS-based polygon mesh rendering. Loads OBJ, glTF, and GLB files; renders each polygon as a real DOM element (`<img>` or `<svg>`) positioned with `transform: matrix3d(...)`. No WebGL, no canvas-as-scene.

## Install

```bash
npm install @polycss/react
```

Requires React 18 or 19 as a peer dependency.

## Quickstart

```tsx
import { PolyScene, PolyMesh } from "@polycss/react";

export function App() {
  return (
    <PolyScene rotX={65} rotY={45} perspective={1000}>
      <PolyMesh src="/cottage.glb" />
    </PolyScene>
  );
}
```

Every polygon in the mesh is a real DOM element — inspect it in DevTools, style it with CSS, attach event handlers.

## Component reference

### `<PolyScene>`

Root of every polycss render tree. Sets up CSS 3D perspective, camera rotation, and directional lighting.

| Prop | Type | Default | Description |
|---|---|---|---|
| `perspective` | `number` | `1000` | CSS perspective distance in pixels |
| `rotX` | `number` | `65` | Camera X-axis rotation in degrees |
| `rotY` | `number` | `45` | Camera Y-axis rotation in degrees |
| `directionalLight` | `DirectionalLight` | — | Directional + ambient light |
| `merge` | `"off" \| "auto"` | `"off"` | Coplanar polygon merge strategy |
| `polygons` | `Polygon[]` | — | Static polygon array (composes with `children`) |
| `interactive` | `boolean` | `false` | Enable pointer-drag camera rotation |
| `autoRotate` | `AutoRotateOption` | — | Auto-rotate camera (see type) |
| `children` | `ReactNode` | — | `<PolyMesh>` and/or `<Poly>` elements |

### `<PolyMesh>`

Loads a mesh from a URL and renders its polygons. Manages blob-URL lifecycle automatically.

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | URL to `.obj`, `.glb`, `.gltf`, or `.vox` |
| `polygons` | `Polygon[]` | Pre-parsed polygons (alternative to `src`) |
| `position` | `Vec3` | `[x, y, z]` offset in scene space |
| `scale` | `number \| Vec3` | Uniform or per-axis scale |
| `rotation` | `Vec3` | Euler angles in degrees `[x, y, z]` |
| `autoCenter` | `boolean` | Shift mesh so its bbox center is at origin |
| `parseOptions` | `ObjParseOptions \| GltfParseOptions` | Forwarded to the parser |
| `fallback` | `ReactNode` | Rendered while loading |
| `errorFallback` | `(error: Error) => ReactNode` | Rendered on parse failure |
| `children` | `(polygon, index) => ReactNode` | Per-polygon render prop override |

### `<Poly>`

Single polygon. The atomic primitive — renders one `<img>` (UV-textured) or `<svg>` (flat-color). Forwards all standard DOM props.

| Prop | Type | Description |
|---|---|---|
| `vertices` | `Vec3[]` | Required — 3+ `[x, y, z]` points |
| `color` | `string` | CSS color; fallback if texture fails |
| `texture` | `string` | Image URL for UV-mapped rendering |
| `uvs` | `Vec2[]` | UV coordinates, one per vertex |
| `data` | `Record<string, string \| number \| boolean>` | Reflected as `data-*` DOM attributes |
| `position` | `Vec3` | Local offset |
| `scale` | `number \| Vec3` | Scale |
| `rotation` | `Vec3` | Euler rotation in degrees |
| `onClick` | `MouseEventHandler` | Standard DOM event handler |
| `onMouseEnter` | `MouseEventHandler` | |
| `className` | `string` | CSS class |
| `style` | `CSSProperties` | Inline style |
| `aria-label` | `string` | ARIA label |

### `<PolyCamera>`

Camera controls wrapper — perspective, rotation, zoom, interaction, and auto-rotate. Most use cases can pass camera props directly to `<PolyScene>` instead; use `<PolyCamera>` when you need to separate camera logic from scene layout.

### Hooks

| Hook | Description |
|---|---|
| `useCamera(options)` | Internal camera integration hook (used by `<PolyCamera>`) |
| `useSceneContext(polygons, options)` | Lower-level hook for building custom scene wrappers |
| `useMesh(src, options?)` | Fetch + parse a mesh. Returns `{ polygons, loading, error, warnings, dispose }`. Manages blob-URL lifecycle — safe across rapid src changes and unmounts. |

### Utility

| Export | Description |
|---|---|
| `injectBaseStyles(doc?)` | Inject polycss base CSS into the document. Idempotent. Called automatically by `<PolyScene>`; manual call only needed when mounting a polycss element outside a scene. |

## Re-exports from `@polycss/core`

All types and core functions are re-exported for convenience, so you never need to add `@polycss/core` to your dependencies:

```ts
import type { Polygon, Vec2, Vec3, DirectionalLight, ParseResult } from "@polycss/react";
import { parseObj, parseGltf, parseVox, loadMesh, normalizePolygons, mergePolygons } from "@polycss/react";
```

## Per-polygon interactivity example

```tsx
import { useState } from "react";
import { PolyScene, Poly } from "@polycss/react";
import type { Polygon } from "@polycss/react";

export function InteractiveMesh({ polygons }: { polygons: Polygon[] }) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <PolyScene rotX={65} rotY={45}>
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
  );
}
```

```css
.highlight { filter: brightness(1.5); }
```

## `useMesh` — imperative loading

```tsx
import { PolyScene, Poly, useMesh } from "@polycss/react";

function Viewer() {
  const { polygons, loading, error } = useMesh("/cottage.glb");

  if (loading) return <div>Loading…</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <PolyScene>
      {polygons.map((p, i) => <Poly key={i} {...p} />)}
    </PolyScene>
  );
}
```

## Docs

Full documentation at [polycss.com](https://polycss.com).
