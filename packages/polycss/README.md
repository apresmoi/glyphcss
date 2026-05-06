> **Status: pre-1.0; API surface frozen per [POLYCSS_MIGRATION.md](../../POLYCSS_MIGRATION.md). Breaking changes possible until 0.1.0 release.**

# polycss

Vanilla JS / custom elements package for CSS-based polygon mesh rendering. Loads OBJ, glTF, and GLB files; renders each polygon as a real DOM element (atlas-backed `<i>` for both textured and flat-color faces) positioned with `transform: matrix3d(...)`. No WebGL, no canvas-as-scene.

Two entry points:

- **`polycss`** — imperative `createPolyScene` API + custom element classes (without auto-registering them).
- **`polycss/elements`** — side-effect import that registers `<poly-scene>`, `<poly-mesh>`, and `<poly-polygon>` as custom elements.

## Install

```bash
npm install polycss
```

Or via CDN (no build step):

```html
<script type="module" src="https://esm.sh/polycss/elements"></script>
```

## Custom elements (declarative, primary path)

Register elements with the side-effect import:

```html
<script type="module" src="https://esm.sh/polycss/elements"></script>

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
import "https://esm.sh/polycss/elements";

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
| `light-direction` | Comma-separated `x, y, z` e.g. `"0.5, -0.7, 0.6"` |
| `light-color` | Directional light color hex |
| `light-ambient` | Ambient intensity `0`–`1` |
| `light-ambient-color` | Ambient light color hex |
| `atlas-scale` | Raster scale for generated atlas pages; lower values reduce memory/detail |

Note: `auto-rotate` and `interactive` are not supported in the v1 vanilla package. Use `@polycss/react` or `@polycss/vue` for animated or interactive scenes.

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
import { createPolyScene, loadMesh } from "polycss";

const scene = createPolyScene(document.querySelector("#scene"), {
  perspective: 1000,
  rotX: 65,
  rotY: 45,
  directionalLight: { direction: [0.5, -0.7, 0.6] },
});

const mesh = await loadMesh("/cottage.glb", { targetSize: 60 });
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
| `directionalLight` | `DirectionalLight` | Lighting config |

Returns a `SceneHandle`:

```ts
interface SceneHandle {
  add(mesh: ParseResult, opts?: { position?: Vec3; scale?: number | Vec3; rotation?: Vec3 }): MeshHandle;
  setOptions(partial: Partial<PolySceneOptions>): void;
  dispose(): void;
}
```

**`loadMesh(url, options?)`**

Fetches and parses a mesh by URL (dispatches by extension: `.obj`, `.glb`, `.gltf`, `.vox`). Returns `Promise<ParseResult>`.

## Subpath imports

| Import | Effect |
|---|---|
| `import { createPolyScene } from "polycss"` | Imperative API + custom element classes (no auto-registration) |
| `import "polycss/elements"` | Side-effect: registers `<poly-scene>`, `<poly-mesh>`, `<poly-polygon>` |

## Re-exports from `@polycss/core`

All `@polycss/core` exports are re-exported from `polycss`, so vanilla users install one package:

```ts
import { parseObj, parseGltf, parseVox, loadMesh, normalizePolygons } from "polycss";
import type { Polygon, Vec3, ParseResult } from "polycss";
```

## Docs

Full documentation at [polycss.com](https://polycss.com).
