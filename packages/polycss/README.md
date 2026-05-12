> **Status: pre-1.0; API surface frozen per [POLYCSS_MIGRATION.md](../../POLYCSS_MIGRATION.md). Breaking changes possible until 0.1.0 release.**

# polycss

Vanilla JS / custom elements package for CSS-based polygon mesh rendering. Loads OBJ, glTF, GLB, and MagicaVoxel `.vox` files; renders each polygon as a real DOM element (atlas-backed `<i>` for both textured and flat-color faces) positioned with `transform: matrix3d(...)`. No WebGL, no canvas-as-scene.

Two entry points:

- **`polycss`** — imperative `createPolyScene` API + custom element classes (without auto-registering them).
- **`polycss/elements`** — side-effect import that registers the scene, mesh, polygon, controls, camera, helper, select, and transform-control custom elements.

## Install

```bash
npm install @layoutit/polycss
```

Or via CDN (no build step):

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>
```

## Custom elements (declarative, primary path)

Register elements with the side-effect import:

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-scene perspective="1000" rot-x="65" rot-y="45">
  <poly-mesh src="/cottage.glb"></poly-mesh>
</poly-scene>
```

With per-polygon elements:

```html
<poly-scene perspective="1000" rot-x="65" rot-y="45">
  <poly-polygon
    vertices="[[0,0,0],[1,0,0],[0,1,0]]"
    color="#ff0000"
  ></poly-polygon>
  <poly-polygon
    vertices="[[2,0,0],[3,0,0],[2,1,0]]"
    color="#0000ff"
  ></poly-polygon>
</poly-scene>
```

Custom elements accept standard DOM events — no framework needed:

```html
<poly-scene id="scene" perspective="1000" rot-x="65" rot-y="45"></poly-scene>

<script type="module">
import "https://esm.sh/@layoutit/polycss/elements";

const scene = document.querySelector("#scene");

const polygons = [
  { vertices: [[0,0,0],[1,0,0],[0,1,0]], color: "#f00", id: "a" },
  { vertices: [[2,0,0],[3,0,0],[2,1,0]], color: "#00f", id: "b" },
];

polygons.forEach(p => {
  const el = document.createElement("poly-polygon");
  el.setAttribute("vertices", JSON.stringify(p.vertices));
  el.setAttribute("color", p.color);
  el.addEventListener("click", () => console.log("clicked", p.id));
  el.addEventListener("mouseenter", () => el.classList.add("hover"));
  el.addEventListener("mouseleave", () => el.classList.remove("hover"));
  scene.appendChild(el);
});
</script>

<style>
poly-polygon.hover { filter: brightness(1.5); }
</style>
```

### Custom element attributes

**`<poly-scene>`**

| Attribute | Description |
|---|---|
| `perspective` | CSS perspective distance in pixels |
| `rot-x` | Camera X-axis rotation in degrees |
| `rot-y` | Camera Y-axis rotation in degrees |
| `zoom` | Scale factor |
| `directional-direction` | Comma-separated `x, y, z` e.g. `"0.5, -0.7, 0.6"` |
| `directional-color` | Directional light color hex |
| `directional-intensity` | Directional light intensity |
| `ambient-intensity` | Ambient light intensity |
| `ambient-color` | Ambient light color hex |
| `texture-lighting` | `"baked"` or `"dynamic"` |
| `atlas-scale` | Raster scale for generated atlas pages; lower values reduce memory/detail |

For pointer drag, wheel zoom, and autorotate, drop a `<poly-orbit-controls>` child inside the scene (or wire `createPolyOrbitControls(scene, ...)` against the imperative API). For pan-first map-style input use `<poly-map-controls>` / `createPolyMapControls` instead. Mirrors Three.js's split between camera state (`<poly-scene>`) and camera input.

**`<poly-mesh>`**

| Attribute | Description |
|---|---|
| `src` | URL to `.obj`, `.glb`, `.gltf`, or `.vox` |
| `position` | Comma-separated `x, y, z` |
| `scale` | Uniform scale factor |
| `rotation` | Comma-separated euler degrees `x, y, z` |
| `auto-center` | Boolean — shift mesh bbox center to origin |

**`<poly-polygon>`**

| Attribute | Description |
|---|---|
| `vertices` | JSON array of `[x,y,z]` arrays |
| `color` | CSS color |
| `texture` | Image URL |
| `uvs` | JSON array of `[u,v]` pairs |
| `position` | Comma-separated `x, y, z` |
| `scale` | Uniform scale factor |
| `rotation` | Comma-separated euler degrees `x, y, z` |

## Imperative API (escape hatch)

For programmatic control without custom elements:

```js
import { createPolyScene, loadMesh } from "@layoutit/polycss";

const scene = createPolyScene(document.querySelector("#scene"), {
  perspective: 1000,
  rotX: 65,
  rotY: 45,
  directionalLight: { direction: [0.5, -0.7, 0.6] },
});

const mesh = await loadMesh("/cottage.glb", {
  gltfOptions: { targetSize: 60 },
});
const handle = scene.add(mesh, { position: [0, 0, 0] });

// Later:
handle.setTransform({ position: [5, 0, 0] });
handle.remove();
mesh.dispose();
```

### Imperative API reference

**`createPolyScene(host, options)`**

| Option | Type | Description |
|---|---|---|
| `perspective` | `number` | CSS perspective distance |
| `rotX` | `number` | Camera X rotation in degrees |
| `rotY` | `number` | Camera Y rotation in degrees |
| `zoom` | `number` | Camera zoom scale |
| `distance` | `number` | Camera dolly pull-back in CSS pixels |
| `target` | `Vec3` | World-coordinate camera target |
| `directionalLight` | `PolyDirectionalLight` | Directional light config |
| `ambientLight` | `PolyAmbientLight` | Ambient light config |
| `textureLighting` | `"baked" \| "dynamic"` | Texture lighting mode |
| `atlasScale` | `number \| "auto"` | Raster scale for generated atlas pages |
| `autoCenter` | `boolean` | Rotate around the union bbox center of added meshes |

Returns a `PolySceneHandle`:

```ts
interface PolySceneHandle {
  add(mesh: ParseResult, opts?: { position?: Vec3; scale?: number | Vec3; rotation?: Vec3 }): PolyMeshHandle;
  setOptions(partial: Partial<PolySceneOptions>): void;
  destroy(): void;
}
```

**`loadMesh(url, options?)`**

Fetches and parses a mesh by URL (dispatches by extension: `.obj`, `.glb`, `.gltf`, `.vox`). Returns `Promise<ParseResult>`.

## Subpath imports

| Import | Effect |
|---|---|
| `import { createPolyScene } from "@layoutit/polycss"` | Imperative API + custom element classes (no auto-registration) |
| `import "@layoutit/polycss/elements"` | Side-effect: registers the polycss custom elements |

## Re-exports from `@layoutit/polycss-core`

All `@layoutit/polycss-core` exports are re-exported from `@layoutit/polycss`, so vanilla users install one package:

```ts
import { parseObj, parseGltf, parseVox, loadMesh, normalizePolygons } from "@layoutit/polycss";
import type { Polygon, Vec3, ParseResult } from "@layoutit/polycss";
```

## Docs

Full documentation at [polycss.com](https://polycss.com).
