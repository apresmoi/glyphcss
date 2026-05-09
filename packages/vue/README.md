> **Status: pre-1.0; API surface frozen per [POLYCSS_MIGRATION.md](../../POLYCSS_MIGRATION.md). Breaking changes possible until 0.1.0 release.**

# @layoutit/polycss-vue

Native Vue 3 components for CSS-based polygon mesh rendering. Loads OBJ, glTF, and GLB files; renders each polygon as a real DOM element (atlas-backed `<i>` for both textured and flat-color faces) positioned with `transform: matrix3d(...)`. No WebGL, no canvas-as-scene.

## Install

```bash
npm install @layoutit/polycss-vue
```

Requires Vue 3 as a peer dependency.

## Quickstart

```vue
<template>
  <PolyScene :rot-x="65" :rot-y="45" :perspective="1000">
    <PolyMesh src="/cottage.glb" />
  </PolyScene>
</template>

<script setup lang="ts">
import { PolyScene, PolyMesh } from "@layoutit/polycss-vue";
</script>
```

## Component reference

### `<PolyScene>`

Root of every polycss render tree. Sets up CSS 3D perspective, camera rotation, and directional lighting.

| Prop | Type | Default | Description |
|---|---|---|---|
| `perspective` | `number` | `1000` | CSS perspective distance in pixels |
| `rot-x` | `number` | `65` | Camera X-axis rotation in degrees |
| `rot-y` | `number` | `45` | Camera Y-axis rotation in degrees |
| `directional-light` | `DirectionalLight` | — | Directional + ambient light |
| `atlas-scale` | `number` | `1` | Raster scale for generated atlas pages |
| `polygons` | `Polygon[]` | — | Static polygon array (composes with slot) |

For pointer drag, wheel zoom, and autorotate, mount `<PolyControls>` inside `<PolyCamera>` (it receives the camera context). Mirrors Three.js's split between camera state and input.

### `<PolyMesh>`

Loads a mesh from a URL and renders its polygons. Manages blob-URL lifecycle automatically.

| Prop | Type | Description |
|---|---|---|
| `src` | `string` | URL to `.obj`, `.glb`, `.gltf`, or `.vox` |
| `polygons` | `Polygon[]` | Pre-parsed polygons (alternative to `src`) |
| `position` | `Vec3` | `[x, y, z]` offset in scene space |
| `scale` | `number \| Vec3` | Uniform or per-axis scale |
| `rotation` | `Vec3` | Euler angles in degrees `[x, y, z]` |
| `atlas-scale` | `number` | Raster scale for generated atlas pages |
| `auto-center` | `boolean` | Shift mesh so its bbox center is at origin |
| `parse-options` | `ObjParseOptions \| GltfParseOptions` | Forwarded to the parser |

Default slot: `v-slot="{ polygon, index }"` — per-polygon scoped slot for rendering overrides.

### `<Poly>`

Single polygon. Renders one atlas-backed `<i>` for UV-textured and flat-color faces. Accepts standard Vue event bindings and class/style.

| Prop | Type | Description |
|---|---|---|
| `vertices` | `Vec3[]` | Required — 3+ `[x, y, z]` points |
| `color` | `string` | CSS color; used when no texture is set |
| `texture` | `string` | Image URL for UV-mapped rendering |
| `uvs` | `Vec2[]` | UV coordinates, one per vertex |
| `data` | `Record<string, string \| number \| boolean>` | Reflected as `data-*` DOM attributes |
| `position` | `Vec3` | Local offset |
| `scale` | `number \| Vec3` | Scale |
| `rotation` | `Vec3` | Euler rotation in degrees |
| `atlas-scale` | `number` | Raster scale for generated atlas pages |

### `<PolyCamera>`

Camera controls wrapper. Most use cases can pass camera props directly to `<PolyScene>`.

### Composables

| Composable | Description |
|---|---|
| `useCamera(options)` | Internal camera integration composable |
| `useSceneContext(polygons, options)` | Lower-level hook for custom scene wrappers |
| `useMesh(src, options?)` | Reactive mesh loader. Returns reactive `{ polygons, loading, error, warnings, dispose }`. |

### Utility

| Export | Description |
|---|---|
| `injectBaseStyles(doc?)` | Inject polycss base CSS into the document. Idempotent. |

## Re-exports from `@layoutit/polycss-core`

All types and core functions are re-exported:

```ts
import type { Polygon, Vec2, Vec3, DirectionalLight, ParseResult } from "@layoutit/polycss-vue";
import { parseObj, parseGltf, parseVox, loadMesh, normalizePolygons, mergePolygons } from "@layoutit/polycss-vue";
```

## Examples

### With lighting and multiple meshes

```vue
<template>
  <PolyScene :directional-light="light" :rot-x="65" :rot-y="45">
    <PolyMesh src="/cottage.glb" />
    <PolyMesh src="/tree.glb" :position="[8, 0, 0]" :scale="0.5" />
  </PolyScene>
</template>

<script setup lang="ts">
import { PolyScene, PolyMesh } from "@layoutit/polycss-vue";
const light = { direction: [0.5, -0.7, 0.6] as [number, number, number], color: "#ffe4a8", ambient: 0.4 };
</script>
```

### Per-polygon interactive

```vue
<template>
  <PolyScene :rot-x="65" :rot-y="45">
    <Poly
      v-for="(p, i) in polygons"
      :key="i"
      v-bind="p"
      @click="() => alert(`clicked polygon ${i}`)"
      @mouseenter="hoveredId = i"
      @mouseleave="hoveredId = null"
      :class="{ highlight: hoveredId === i }"
    />
  </PolyScene>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PolyScene, Poly } from "@layoutit/polycss-vue";
import type { Polygon } from "@layoutit/polycss-vue";

defineProps<{ polygons: Polygon[] }>();
const hoveredId = ref<number | null>(null);
</script>

<style>
.highlight { filter: brightness(1.5); }
</style>
```

### `PolyMesh` with scoped slot

```vue
<template>
  <PolyScene :rot-x="65" :rot-y="45">
    <PolyMesh src="/character.glb" :position="[5, 0, 0]" :scale="2"
      v-slot="{ polygon, index }">
      <Poly
        v-bind="polygon"
        @click="selected = index"
        :class="{ outlined: selected === index }"
      />
    </PolyMesh>
  </PolyScene>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PolyScene, PolyMesh, Poly } from "@layoutit/polycss-vue";
const selected = ref<number | null>(null);
</script>
```

## Docs

Full documentation at [polycss.com](https://polycss.com).
