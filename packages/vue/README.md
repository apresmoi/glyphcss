> **Status: pre-1.0. APIs may still change before a stable 1.0 release.**

# @layoutit/polycss-vue

Native Vue 3 components for CSS-based polygon mesh rendering. Loads OBJ, glTF, GLB, and MagicaVoxel `.vox` files; renders each polygon as a real DOM element (atlas-backed `<i>` for both textured and flat-color faces) positioned with `transform: matrix3d(...)`. No WebGL, no canvas-as-scene.

## Install

```bash
npm install @layoutit/polycss-vue
```

Requires Vue 3 as a peer dependency.

## Quickstart

```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45" :perspective="1000">
    <PolyScene>
      <PolyMesh src="/cottage.glb" />
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-vue";
</script>
```

## Component reference

### `<PolyScene>`

Root of every Vue polycss render tree. Renders polygons and meshes inside a `<PolyCamera>` context, and owns scene-level lighting and atlas options.

| Prop | Type | Default | Description |
|---|---|---|---|
| `directional-light` | `PolyDirectionalLight` | None | Directional light config |
| `ambient-light` | `PolyAmbientLight` | None | Ambient light config |
| `texture-lighting` | `"baked" \| "dynamic"` | `"baked"` | Texture lighting mode |
| `atlas-scale` | `number \| "auto"` | `"auto"` | Raster scale for generated atlas pages |
| `experimental-texture-edge-repair` | `boolean` | `true` | Textured atlas edge repair |
| `polygons` | `Polygon[]` | None | Static polygon array (composes with slot) |

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
| `atlas-scale` | `number \| "auto"` | Raster scale for generated atlas pages |
| `experimental-texture-edge-repair` | `boolean` | Textured atlas edge repair; defaults to the scene, then `true` |
| `auto-center` | `boolean` | Shift mesh so its bbox center is at origin |
| `mtl` | `string` | Companion `.mtl` URL for OBJ models |

Named slot: `#polygon="{ polygon, index }"`: per-polygon scoped slot for rendering overrides. The default slot is for static children inside the mesh wrapper.

### `<Poly>`

Single polygon. Renders one atlas-backed `<i>` for UV-textured and flat-color faces. Accepts standard Vue event bindings and class/style.

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
| `atlas-scale` | `number \| "auto"` | Raster scale for generated atlas pages |

### `<PolyCamera>`

Camera wrapper for perspective, rotation, zoom, target, and dolly distance. Vue scenes must render inside `<PolyCamera>` (or `<PolyPerspectiveCamera>` / `<PolyOrthographicCamera>`) so controls and scenes share camera state.

### Composables

| Composable | Description |
|---|---|
| `usePolyCamera(options)` | Internal camera integration composable |
| `usePolySceneContext(polygons, options)` | Lower-level hook for custom scene wrappers |
| `usePolyMesh(srcRef, options?)` | Reactive mesh loader. Returns reactive `{ polygons, loading, error, warnings, dispose }`. |

### Utility

| Export | Description |
|---|---|
| `injectPolyBaseStyles(doc?)` | Inject polycss base CSS into the document. Idempotent. |

## Re-exports from `@layoutit/polycss-core`

All types and core functions are re-exported:

```ts
import type { Polygon, Vec2, Vec3, PolyDirectionalLight, PolyAmbientLight, ParseResult } from "@layoutit/polycss-vue";
import { parseObj, parseGltf, parseVox, loadMesh, normalizePolygons, mergePolygons } from "@layoutit/polycss-vue";
```

## Examples

### With lighting and multiple meshes

```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene :directional-light="light">
      <PolyMesh src="/cottage.glb" />
      <PolyMesh src="/tree.glb" :position="[8, 0, 0]" :scale="0.5" />
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { PolyCamera, PolyScene, PolyMesh } from "@layoutit/polycss-vue";
const light = { direction: [0.5, -0.7, 0.6] as [number, number, number], color: "#ffe4a8" };
</script>
```

### Per-polygon interactive

```vue
<template>
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
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
  </PolyCamera>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PolyCamera, PolyScene, Poly } from "@layoutit/polycss-vue";
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
  <PolyCamera :rot-x="65" :rot-y="45">
    <PolyScene>
      <PolyMesh src="/character.glb" :position="[5, 0, 0]" :scale="2">
        <template #polygon="{ polygon, index }">
          <Poly
            v-bind="polygon"
            @click="selected = index"
            :class="{ outlined: selected === index }"
          />
        </template>
      </PolyMesh>
    </PolyScene>
  </PolyCamera>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { PolyCamera, PolyScene, PolyMesh, Poly } from "@layoutit/polycss-vue";
const selected = ref<number | null>(null);
</script>
```

## Docs

Full documentation at [polycss.com](https://polycss.com).
