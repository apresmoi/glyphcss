> **Status: pre-1.0. APIs may still change before a stable 1.0 release.**

# @layoutit/polycss-core

Framework-agnostic math, parsers, and helpers for CSS polygon-mesh rendering. Zero browser globals: runs in Node, workers, or any JS environment.

This package contains the entire non-rendering side of polycss: OBJ / glTF / GLB / MagicaVoxel parsers, polygon normalization, coplanar merge, Lambert lighting, isometric camera state, and all shared TypeScript types.

## When to use directly

Most users install `@layoutit/polycss-react`, `@layoutit/polycss-vue`, or `@layoutit/polycss` (vanilla). Those packages include `@layoutit/polycss-core` as a transitive runtime dependency and re-export its public types and functions, so you never need to write `import ... from "@layoutit/polycss-core"` in application code.

Install `@layoutit/polycss-core` directly when you:

- Build custom rendering outside React / Vue / vanilla (e.g., a Svelte wrapper, a server-side OBJ validator, a CLI mesh processor).
- Want only the parsers / math without any rendering layer.
- Are writing a polycss plugin or tooling that must remain framework-neutral.

```bash
npm install @layoutit/polycss-core
```

## Public surface

### Types

| Type | Description |
|---|---|
| `Vec2` | `[number, number]`: 2D point or UV coordinate |
| `Vec3` | `[number, number, number]`: 3D point or direction |
| `Polygon` | Single renderable polygon: `vertices`, optional `color`, `texture`, `uvs`, `data` |
| `PolyDirectionalLight` | Directional light: `direction`, optional `color`, optional `intensity` |
| `PolyAmbientLight` | Ambient fill light: optional `color`, optional `intensity` |
| `ParseResult` | Unified parser return: `polygons`, `objectUrls`, `dispose()`, `warnings` |
| `ObjParseOptions` | Options for `parseObj` |
| `GltfParseOptions` | Options for `parseGltf` |
| `VoxParseOptions` | Options for `parseVox` |
| `MtlParseResult` | `{ colors, textures }` from `parseMtl` |
| `NormalizeResult` | `{ polygons, warnings }` from `normalizePolygons` |
| `CameraState` | Camera target, angles, zoom, and dolly distance |
| `CameraHandle` | Mutable camera object from `createIsometricCamera` |
| `AutoRotateOption` | `boolean | number | { axis, speed, pauseOnInteraction }` |

### Functions

| Function | Description |
|---|---|
| `normalizePolygons(input)` | Validates polygons. Drops degenerate ones, auto-triangulates non-coplanar N-gons, strips mismatched UVs. Returns `{ polygons, warnings }`. |
| `mergePolygons(polygons)` | Coplanar same-material adjacent merge. Reduces DOM element count on flat surfaces. |
| `computeSceneBbox(polygons)` | Computes min/max bounds across all polygon vertices. |
| `createIsometricCamera(initial?)` | Creates a mutable camera handle with `state`, `update(partial)`, and `getStyle()`. |
| `parseObj(text, options?)` | Parses OBJ text into `ParseResult`. Supports UV (`vt`), materials, `map_Kd` textures. |
| `parseMtl(text)` | Parses MTL text into `{ colors, textures }`. |
| `parseGltf(buffer, options?)` | Parses GLB or glTF `ArrayBuffer` into `ParseResult`. Extracts embedded textures as blob URLs. |
| `parseVox(buffer, options?)` | Parses MagicaVoxel `.vox` `ArrayBuffer` into `ParseResult`. Face-culls interior voxel faces and fan-triangulates exposed quads. |
| `loadMesh(url, options?)` | Fetches a URL, dispatches to the right parser by extension (`.obj`, `.glb`, `.gltf`, `.vox`). Returns `Promise<ParseResult>`. |
| `parseColor(input)` | Parse any CSS color string to `{ r, g, b, a }`. |
| `shadeColor(input, lambert, ...)` | Apply Lambert shading factor to a color. |
| `computeShapeLighting(normal, baseColor, light?)` | Compute shaded color for a polygon face given a directional light and surface normal. |

## Examples

### Parse an OBJ file

```ts
import { parseObj } from "@layoutit/polycss-core";

const text = await fetch("/cottage.obj").then(r => r.text());
const { polygons, warnings, dispose } = parseObj(text, {
  targetSize: 40,
  defaultColor: "#cccccc",
});

console.log(polygons.length, "polygons");
warnings.forEach(w => console.warn(w));

// Revoke any blob URLs created during parse (OBJ rarely creates them,
// but always call dispose() for correctness):
dispose();
```

### Normalize a polygon list

```ts
import { normalizePolygons } from "@layoutit/polycss-core";
import type { Polygon } from "@layoutit/polycss-core";

const raw: Polygon[] = [
  { vertices: [[0,0,0], [1,0,0], [0,1,0]], color: "#f00" },
  { vertices: [[0,0,0], [0,0,0], [0,0,0]] }, // degenerate: will be dropped
  { vertices: [[0,0,0], [1,0,0], [0.5,1,0], [0.5,1,0.1]] }, // non-coplanar quad → triangulated
];

const { polygons, warnings } = normalizePolygons(raw);
console.log(polygons.length); // 2 (degenerate dropped; quad fan-triangulated into 2)
warnings.forEach(w => console.warn(w));
```

### Merge coplanar polygons

```ts
import { parseGltf, mergePolygons } from "@layoutit/polycss-core";

const buf = await fetch("/cottage.glb").then(r => r.arrayBuffer());
const { polygons, dispose } = parseGltf(buf, { targetSize: 60 });

// Merge coplanar same-material triangles to reduce DOM element count
const merged = mergePolygons(polygons);
console.log(`${polygons.length} triangles → ${merged.length} merged polygons`);

dispose(); // always revoke GLB blob URLs when done
```
