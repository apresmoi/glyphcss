# Glyph API design — unified shape across all four paths

Single source of truth for what the **same scene** looks like across the four supported usage paths: vanilla JS, custom elements (HTML), React, Vue. If any path diverges from this shape, it's a bug.

**This describes the target state.** The current codebase ships symbols prefixed `Glyphcss*` / `<glyphcss-*>` / `.glyphcss-*` and a few API gaps relative to this design — see "Known drift" at the bottom. AGENTS.md / CLAUDE.md are updated alongside the implementation PR that closes each drift item.

---

## Goal

One mental model. A user who learns the React API can write the Vue, vanilla JS, and HTML versions without re-learning anything except idiom (camelCase vs kebab-case, function calls vs JSX). The polycss/voxcss family uses `Poly*`; glyph uses `Glyph*`; the rest of the design rhymes.

## Tree shape

```
GlyphCamera
└── GlyphScene
    ├── Controls (GlyphOrbitControls / GlyphMapControls / GlyphFirstPersonControls) — optional
    ├── Helpers (GlyphAxesHelper / GlyphDirectionalLightHelper / GlyphGround) — optional
    └── Content (GlyphMesh / hotspots) — one per node
```

**Why camera wraps scene:** matches the polycss/voxcss family. The glyph rasterizer doesn't need this for layout reasons — projection happens in JS, not in CSS — but mirroring the family means knowledge transfers across the three engines without re-learning composition. Same source of truth, same tree, different paint backend.

## Camera taxonomy

Two cameras, shared orbital state.

| Name | Projection | When to pick |
|---|---|---|
| `GlyphOrthographicCamera` (alias `GlyphCamera`) | Parallel | **Default.** Iso/voxel/diagrammatic scenes. The voxel render mode and ASCII rasterizer favor flat depth. |
| `GlyphPerspectiveCamera` | Foreshortened | Character models, game-like scenes, first-person views. Depth is in world units (default `distance: 3`). |

Shared state on every camera: `rotX`, `rotY` (radians), `target` (Vec3), `zoom` (fraction of `min(cols, rows)`). Perspective additionally has `distance` (world units).

**Camera defines projection; controls define behavior.** "First-person view" is `GlyphPerspectiveCamera` + `GlyphFirstPersonControls`. No separate first-person camera, no cinematic camera. Controls own the FPV-specific configuration (eye-position offset, near-plane cull) on the same perspective camera.

**Why ortho is the default:** glyph has a `voxel` render mode whose identity is iso/orthographic. Setting `GlyphCamera` to ortho aligns the most ergonomic name with the most distinctive mode. Diverges from three.js's `PerspectiveCamera`-as-default convention deliberately.

**Rotations are in radians.** Diverges from voxcss (degrees). Glyph inherits the radians convention from the asciss rasterizer.

## Controls taxonomy

| Name | Behavior |
|---|---|
| `GlyphOrbitControls` | Drag/wheel to orbit/zoom around target. Supports `animate` for auto-rotation. |
| `GlyphMapControls` | Like orbit but pan plane is horizontal (Google-Maps-style). |
| `GlyphFirstPersonControls` | WASD + mouse-look. Configures the parent perspective camera for FPV. |

**No `GlyphTransformControls`** — manipulator gizmos are deferred. Glyph's voxel/diagrammatic identity doesn't lean on per-object transform handles.

## Render modes

Glyph-specific. Lives on `<GlyphScene mode=…>` and equivalents.

| Mode | How cells are filled |
|---|---|
| `wireframe` | Polygon edges rasterized as ASCII rules. `featureEdges` threshold trims flat-coplanar internal edges. |
| `solid` (default) | Filled cells; glyph picked from `glyphPalette` by Lambert-shaded intensity. |
| `voxel` | Cube-aligned geometry; face normals drive glyph selection. |

---

## Minimal mesh — all four paths

The same scene, every path. **If a path can't express this verbatim, it's a bug.**

### Vanilla JS

```js
import { createGlyphCamera, createGlyphScene, loadMesh } from "glyphcss";

const camera = createGlyphCamera({ rotX: 0.5, rotY: 0.4 });
const scene  = createGlyphScene(document.getElementById("app"), { camera });

const { polygons } = await loadMesh("/cottage.glb");
scene.add(polygons);
```

### Custom elements (HTML)

```html
<script type="module" src="https://esm.sh/glyphcss/elements"></script>

<glyph-camera rot-x="0.5" rot-y="0.4">
  <glyph-scene>
    <glyph-mesh src="/cottage.glb"></glyph-mesh>
  </glyph-scene>
</glyph-camera>
```

### React

```tsx
import { GlyphCamera, GlyphScene, GlyphMesh } from "@glyphcss/react";

<GlyphCamera rotX={0.5} rotY={0.4}>
  <GlyphScene>
    <GlyphMesh src="/cottage.glb" />
  </GlyphScene>
</GlyphCamera>
```

### Vue 3

```vue
<script setup>
import { GlyphCamera, GlyphScene, GlyphMesh } from "@glyphcss/vue";
</script>

<template>
  <GlyphCamera :rot-x="0.5" :rot-y="0.4">
    <GlyphScene>
      <GlyphMesh src="/cottage.glb" />
    </GlyphScene>
  </GlyphCamera>
</template>
```

---

## Minimal interactive scene (orbit controls)

### Vanilla JS

```js
import {
  createGlyphCamera, createGlyphScene, createGlyphOrbitControls, loadMesh,
} from "glyphcss";

const camera = createGlyphCamera({ rotX: 0.5, rotY: 0.4 });
const scene  = createGlyphScene(host, { camera });
createGlyphOrbitControls(scene, { drag: true, wheel: true });

const { polygons } = await loadMesh("/cottage.glb");
scene.add(polygons);
```

### Custom elements

```html
<glyph-camera rot-x="0.5" rot-y="0.4">
  <glyph-scene>
    <glyph-orbit-controls drag wheel></glyph-orbit-controls>
    <glyph-mesh src="/cottage.glb"></glyph-mesh>
  </glyph-scene>
</glyph-camera>
```

### React

```tsx
<GlyphCamera rotX={0.5} rotY={0.4}>
  <GlyphScene>
    <GlyphOrbitControls drag wheel />
    <GlyphMesh src="/cottage.glb" />
  </GlyphScene>
</GlyphCamera>
```

### Vue

```vue
<GlyphCamera :rot-x="0.5" :rot-y="0.4">
  <GlyphScene>
    <GlyphOrbitControls drag wheel />
    <GlyphMesh src="/cottage.glb" />
  </GlyphScene>
</GlyphCamera>
```

---

## Manual polygons (no file)

A mesh where geometry is defined inline as `Polygon[]` rather than loaded from a URL. The `Polygon` type lives in `@glyphcss/core`:

```ts
interface Polygon {
  vertices: Vec3[];           // N coplanar vertices, CCW from outside
  color?: string;
  uvs?: Vec2[];
  data?: Record<string, string | number | boolean>;
}
```

The rasterizer fan-triangulates internally — author N-gons or triangles, both work.

### Vanilla JS

```js
const scene = createGlyphScene(host, { camera });
scene.add([
  { vertices: [[0, 0, 0], [1, 0, 0], [0.5, 1, 0]], color: "#ff6644" },
]);
```

### React

`polygons` prop is mutually exclusive with `src` on `<GlyphMesh>`.

```tsx
const polygons = [
  { vertices: [[0, 0, 0], [1, 0, 0], [0.5, 1, 0]], color: "#ff6644" },
];

<GlyphCamera rotX={0.5} rotY={0.4}>
  <GlyphScene>
    <GlyphMesh polygons={polygons} />
  </GlyphScene>
</GlyphCamera>
```

### Vue

```vue
<script setup>
const polygons = [
  { vertices: [[0, 0, 0], [1, 0, 0], [0.5, 1, 0]], color: "#ff6644" },
];
</script>

<template>
  <GlyphCamera :rot-x="0.5" :rot-y="0.4">
    <GlyphScene>
      <GlyphMesh :polygons="polygons" />
    </GlyphScene>
  </GlyphCamera>
</template>
```

### Custom elements

Inline polygons on the elements path are **deferred** (not "do not implement" — just not in scope today). HTML attributes can't carry `Polygon[]` ergonomically: a JSON blob in one big attribute is ugly and a child `<glyph-polygon vertices="[…]">` element pulls the polygon authoring tree into the markup, which fights the "elements are for declarative composition, JS is for data" split. Use `<glyph-mesh src=…>` with a file, or set `mesh.polygons` from JS, until there's clear demand.

### Built-in shape generators

`@glyphcss/core` (re-exported from every wrapper) ships polygon factories. Every factory returns `Polygon[]` and slots into `scene.add()` directly.

```js
import { cubePolygons, spherePolygons } from "@glyphcss/core";
scene.add(cubePolygons({ size: 1, color: "#ff6644" }));
scene.add(spherePolygons({ subdivisions: 2, radius: 1, color: "#44aaff" }));
```

**Inventory (target).** Mirrors the polycss/voxcss factories where they exist, expanded with sphere + Archimedean / Catalan / Kepler-Poinsot families that polycss skips for DOM-cost reasons.

- **Platonic (5):** `tetrahedronPolygons`, `cubePolygons`, `octahedronPolygons`, `dodecahedronPolygons`, `icosahedronPolygons`.
- **Kepler-Poinsot star polyhedra (4):** `smallStellatedDodecahedronPolygons`, `greatDodecahedronPolygons`, `greatStellatedDodecahedronPolygons`, `greatIcosahedronPolygons`.
- **Archimedean (13):** `truncatedTetrahedronPolygons`, `truncatedCubePolygons`, `truncatedOctahedronPolygons`, `truncatedDodecahedronPolygons`, `truncatedIcosahedronPolygons` (soccer ball), `truncatedCuboctahedronPolygons`, `truncatedIcosidodecahedronPolygons`, `cuboctahedronPolygons`, `icosidodecahedronPolygons`, `rhombicuboctahedronPolygons`, `rhombicosidodecahedronPolygons`, `snubCubePolygons`, `snubDodecahedronPolygons`.
- **Catalan duals (13):** `triakisTetrahedronPolygons`, `triakisOctahedronPolygons`, `triakisIcosahedronPolygons`, `tetrakisHexahedronPolygons`, `pentakisDodecahedronPolygons`, `rhombicDodecahedronPolygons`, `rhombicTriacontahedronPolygons`, `deltoidalIcositetrahedronPolygons`, `deltoidalHexecontahedronPolygons`, `disdyakisDodecahedronPolygons`, `disdyakisTriacontahedronPolygons`, `pentagonalIcositetrahedronPolygons`, `pentagonalHexecontahedronPolygons`.
- **Parametric polyhedral families (4):** `prismPolygons({ sides, radius, height })`, `antiprismPolygons(…)`, `bipyramidPolygons(…)`, `trapezohedronPolygons(…)`.
- **Round / parametric primitives (5):** `spherePolygons({ subdivisions, radius })` (icosphere), `cylinderPolygons(…)`, `conePolygons(…)`, `torusPolygons(…)`, `pyramidPolygons(…)`.
- **Helpers / utility (4):** `planePolygons`, `ringPolygons`, `ringQuadPolygons`, `arrowPolygons`, `axesHelperPolygons`.

**Why sphere ships here but not in polycss/voxcss:** in polycss, each polygon is a DOM leaf — a 32×16 UV sphere costs 1024 DOM nodes per instance. Glyph rasterizes polygons into character cells in one pass, so an 80-triangle icosphere is no more expensive at render time than an 8-triangle octahedron. `spherePolygons` defaults to `subdivisions: 1` (an icosphere = 80 triangles) which is plenty for ASCII.

**Johnson solids are not shipped.** 92 convex regular-faced polyhedra with no clean parametric form, mostly niche. Add on demand if a specific one comes up; don't preempt.

**No primitive shape components** (`<GlyphBox>`, `<GlyphSphere>`, etc.) are shipped. The polygon factories cover the same need with one fewer abstraction layer. Reconsider if user demand appears.

---

## First-person scene

FPV needs perspective foreshortening, so this example uses the explicit `<GlyphPerspectiveCamera>` rather than the default `<GlyphCamera>` (which is orthographic). `GlyphFirstPersonControls` owns the WASD + mouse-look behavior and configures the camera's eye-position / near-plane handling internally.

### Vanilla JS

```js
import {
  createGlyphPerspectiveCamera, createGlyphScene,
  createGlyphFirstPersonControls, loadMesh,
} from "glyphcss";

const camera = createGlyphPerspectiveCamera();
const scene  = createGlyphScene(host, { camera });
createGlyphFirstPersonControls(scene);
const { polygons } = await loadMesh("/world.glb");
scene.add(polygons);
```

### Custom elements

```html
<glyph-perspective-camera>
  <glyph-scene>
    <glyph-first-person-controls></glyph-first-person-controls>
    <glyph-mesh src="/world.glb"></glyph-mesh>
  </glyph-scene>
</glyph-perspective-camera>
```

### React / Vue

```tsx
<GlyphPerspectiveCamera>
  <GlyphScene>
    <GlyphFirstPersonControls />
    <GlyphMesh src="/world.glb" />
  </GlyphScene>
</GlyphPerspectiveCamera>
```

---

## Helpers

Helpers are diagnostic / decorative scene children — they render polygons through the same `mesh` machinery but represent the scene's *own* state (axes, light direction, ground plane).

| Component | What it shows |
|---|---|
| `GlyphAxesHelper` | World-space XYZ axes as colored arrows. Sized via `size` prop. |
| `GlyphDirectionalLightHelper` | An arrow at the world origin pointing along the scene's `directionalLight.direction`. Updates when the light moves. |
| `GlyphGround` | A planar `<GlyphMesh>` parameterized by `size` / `color` — convenience over `planePolygons`. |

```tsx
<GlyphCamera rotX={0.5} rotY={0.4}>
  <GlyphScene directionalLight={{ direction: [0.5, 0.7, 0.5], intensity: 1 }}>
    <GlyphOrbitControls drag wheel />
    <GlyphAxesHelper size={1} />
    <GlyphDirectionalLightHelper />
    <GlyphGround size={10} color="#222" />
    <GlyphMesh src="/cottage.glb" />
  </GlyphScene>
</GlyphCamera>
```

Helpers are scene children, not props — they own a polygon list and register with the scene like any other mesh. Same shape across React / Vue / custom elements (`<glyph-axes-helper>`, etc.). Vanilla JS has no equivalent component wrapper; emit the same polygons directly via `scene.add(axesHelperPolygons({ size: 1 }))`.

## Hotspots

Hotspots are 3D anchors that produce 2D screen-space hitboxes in the consumer's DOM. They're glyph-specific — no equivalent in polycss/voxcss — because the rasterizer can project arbitrary world points to character-cell coordinates as a side effect of rendering.

A hotspot consists of:
- A 3D `at: Vec3` position
- A unique `id`
- An optional `size: [cols, rows]` (in character cells)

The rasterizer projects each hotspot through the camera every render and emits a `HotspotCell` (`col`, `row`, `depth`, `visible`). Consumers absolute-position a `<div>` over the cell — the rasterizer computes the position; it does **not** emit the DOM node.

```tsx
<GlyphCamera rotX={0.5} rotY={0.4}>
  <GlyphScene>
    <GlyphMesh src="/cottage.glb" />
    <GlyphHotspot id="door" at={[0, 1, 0.5]} onClick={openDoor}>
      <Tooltip>Enter</Tooltip>
    </GlyphHotspot>
  </GlyphScene>
</GlyphCamera>
```

```html
<glyph-hotspot id="door" at="0,1,0.5">
  <div class="tooltip">Enter</div>
</glyph-hotspot>
```

```js
const handle = scene.addHotspot({ id: "door", at: [0, 1, 0.5] }, () => openDoor());
// handle.remove() to dispose
```

Hotspots auto-hide when their projected depth is occluded by mesh polygons (same depth buffer the rasterizer fills).

## Animation

glTF animation clips are decoded by `loadMesh` and exposed as an `AnimationController` on the parse result. The mixer is mounted independently of the scene so animation is opt-in.

```tsx
import { useGlyphAnimation } from "@glyphcss/react";

const { polygons, animation } = await loadMesh("/character.glb");
// inside a component:
useGlyphAnimation(animation, { clip: "Walk", speed: 1, loop: true });
```

```vue
<script setup>
import { useGlyphAnimation } from "@glyphcss/vue";
useGlyphAnimation(animation, { clip: "Walk", speed: 1, loop: true });
</script>
```

```js
import { createGlyphAnimationMixer } from "glyphcss";

const { polygons, animation } = await loadMesh("/character.glb");
const handle = scene.add(polygons);
const mixer = createGlyphAnimationMixer(animation, handle, { clip: "Walk", speed: 1, loop: true });
// mixer.stop() to dispose
```

**No `<GlyphAnimation>` component.** Animation is an effect on an existing mesh, not a tree node. Hook/composable on React/Vue, factory on vanilla. Custom elements have no animation surface yet (deferred — would need attribute observers for `clip`, `speed`, `loop`).

---

## Scene & mesh features

### Feature placement (where does it live?)

| Feature | Camera | Scene | Mesh | Controls |
|---|---|---|---|---|
| `rotX` / `rotY` (radians) | ✅ | — | — | — |
| `target` (Vec3) | ✅ | — | — | — |
| `zoom` | ✅ | — | — | — |
| `distance` | ✅ (perspective only) | — | — | — |
| `stretch` (horizontal cell-aspect override) | ✅ | — | — | — |
| Render `mode` (`wireframe` / `solid` / `voxel`) | — | ✅ | — | — |
| Grid `cols` / `rows` / `cellAspect` | — | ✅ | — | — |
| `glyphPalette` (named ramp) | — | ✅ | — | — |
| `useColors` (emit color spans) | — | ✅ | — | — |
| `lineHeight` | — | ✅ | — | — |
| `featureEdges` (wireframe threshold) | — | ✅ | — | — |
| `directionalLight` / `ambientLight` | — | ✅ | — | — |
| `autoCenter` (boolean) | — | ✅ (re-centers world bbox) | ✅ (re-centers polygons into mesh-local space) | — |
| `meshResolution` (`"lossless"` \| `"lossy"`) | — | — | ✅ (top-level prop) | — |
| Mesh transform (`position` / `scale` / `rotation`) | — | — | ✅ | — |
| `animate` (`{ speed, axis }` \| `false`) — auto-rotation | — | — | — | ✅ (orbit / map) |

### Lights

Object-shaped props on `<GlyphScene>` — not components.

```ts
type GlyphDirectionalLight = { direction: Vec3; color?: string; intensity?: number };
type GlyphAmbientLight = { color?: string; intensity?: number };
```

```js
const scene = createGlyphScene(host, {
  camera,
  directionalLight: { direction: [0.45, 0.71, 0.54], color: "#ffffff", intensity: 1 },
  ambientLight:     { color: "#ffffff", intensity: 0.4 },
});
```

```html
<glyph-scene
  directional-light='{"direction":[0.45,0.71,0.54],"color":"#ffffff","intensity":1}'
  ambient-light='{"color":"#ffffff","intensity":0.4}'>
  …
</glyph-scene>
```

```tsx
<GlyphScene
  directionalLight={{ direction: [0.45, 0.71, 0.54], color: "#ffffff", intensity: 1 }}
  ambientLight={{ color: "#ffffff", intensity: 0.4 }}
>…</GlyphScene>
```

> **Note — no `<GlyphDirectionalLight>` / `<GlyphAmbientLight>` components.** Lights are inputs to the rasterizer, not transformable scene-graph nodes. Object-shaped props are the right primitive here. Reconsider if multi-light support is added.

### Mesh options — flat second arg on `scene.add()`

`scene.add(polygons, options?)` takes a single options object combining **transform** and **per-mesh flags**. Flat shape (not nested) so each path can spread it cleanly.

```ts
interface GlyphMeshOptions {
  // Transform
  position?: Vec3;
  scale?: Vec3 | number;
  rotation?: Vec3;      // Euler radians, XYZ order
  // Per-mesh flags
  id?: string;
  autoCenter?: boolean;
  meshResolution?: "lossless" | "lossy";
}
```

```js
scene.add(polygons, {
  id: "cottage",
  position: [0, 0, 0],
  scale: 1.5,
  rotation: [0, Math.PI / 4, 0],
  autoCenter: true,
});

// Built-in geometry via resolveGeometry:
import { resolveGeometry } from "@glyphcss/core";
scene.add(resolveGeometry("dodecahedron", { size: 1 }));
scene.add(resolveGeometry("torus", { size: 0.8, color: "#f97316" }));
```

On React / Vue, every field lifts to a `<GlyphMesh>` prop:

```tsx
<GlyphMesh
  src="/cottage.glb"
  id="cottage"
  position={[0, 0, 0]}
  scale={1.5}
  rotation={[0, Math.PI / 4, 0]}
  autoCenter
/>
```

On custom elements, each lifts to an attribute (`position="0,0,0"`, `scale="1.5"`, `auto-center`, `mesh-resolution="lossless"`, etc.).

### Geometry shortcut

`<GlyphcssMesh>` / `<glyphcss-mesh>` accepts a `geometry` prop/attribute that resolves to a built-in polygon factory by name, eliminating the need to import the factory explicitly for common shapes.

```ts
geometry?: GlyphcssGeometryName    // <GlyphcssMesh> / <glyphcss-mesh>
size?: number                       // default 1
```

Precedence: explicit `polygons` > `src` > `geometry`. When `src` and `geometry` are both supplied, `src` wins silently.

**React / Vue:**

```tsx
<GlyphcssMesh geometry="dodecahedron" size={1} />
<GlyphcssMesh geometry="sphere" size={0.8} color="#44aaff" />
```

**Custom elements:**

```html
<glyphcss-mesh geometry="dodecahedron"></glyphcss-mesh>
<glyphcss-mesh geometry="torus" size="1.2" color="#f97316"></glyphcss-mesh>
```

**Vanilla JS** — call `resolveGeometry` directly from `@glyphcss/core`:

```js
import { resolveGeometry } from "@glyphcss/core";
scene.add(resolveGeometry("dodecahedron", { size: 1 }));
```

**`GlyphcssGeometryName` union** covers all 44 built-in factories:

- Platonic (5): `tetrahedron`, `cube`, `octahedron`, `dodecahedron`, `icosahedron`
- Kepler-Poinsot (4): `smallStellatedDodecahedron`, `greatDodecahedron`, `greatStellatedDodecahedron`, `greatIcosahedron`
- Archimedean (13): `cuboctahedron`, `icosidodecahedron`, `truncatedTetrahedron`, `truncatedCube`, `truncatedOctahedron`, `truncatedDodecahedron`, `truncatedIcosahedron`, `truncatedCuboctahedron`, `truncatedIcosidodecahedron`, `rhombicuboctahedron`, `rhombicosidodecahedron`, `snubCube`, `snubDodecahedron`
- Catalan duals (13): `rhombicDodecahedron`, `rhombicTriacontahedron`, `triakisTetrahedron`, `triakisOctahedron`, `triakisIcosahedron`, `tetrakisHexahedron`, `pentakisDodecahedron`, `disdyakisDodecahedron`, `disdyakisTriacontahedron`, `deltoidalIcositetrahedron`, `deltoidalHexecontahedron`, `pentagonalIcositetrahedron`, `pentagonalHexecontahedron`
- Parametric families (4): `prism`, `antiprism`, `bipyramid`, `trapezohedron`
- Round / parametric primitives (5): `sphere`, `cylinder`, `cone`, `torus`, `pyramid`

For parametric shapes (`cylinder`, `cone`, `torus`, `pyramid`, `prism`, `antiprism`, `bipyramid`, `trapezohedron`), the `size` field drives radius/height with reasonable defaults derived from a single scalar. When richer control is needed (e.g. different `majorRadius` and `minorRadius` on a torus), call the factory directly instead.

### Auto center

`autoCenter?: boolean` exists at **two** levels:

- **Scene level** (option on `GlyphSceneOptions` / `<GlyphScene>`): translates the *world* so the bbox of all live meshes sits at origin. Camera orbits the model's visible center.
- **Mesh level** (option on `scene.add()` / `<GlyphMesh>`): re-centers a mesh's polygons into mesh-local space. Useful for OBJ/GLB assets whose origin is at a corner / feet / arbitrary point.

These are independent — both can be `true`. Default: both `false`. Catches the common "asset is way off-axis" failure mode without forcing users to compute a bbox by hand.

### Mesh resolution

Top-level `meshResolution?: "lossless" | "lossy"` prop on `<GlyphMesh>`.

- `"lossy"` (default) — bounded geometric approximation when it reduces polygon count.
- `"lossless"` — preserve the authored surface; only apply exact merges.

```js
const { polygons } = await loadMesh("/cottage.glb", { meshResolution: "lossless" });
scene.add(polygons);
```

```html
<glyph-mesh src="/cottage.glb" mesh-resolution="lossless"></glyph-mesh>
```

```tsx
<GlyphMesh src="/cottage.glb" meshResolution="lossless" />
```

### Auto rotation

**There is no `autoRotate` prop on the scene or camera.** Auto-rotation is the `animate` option on `GlyphOrbitControls` / `GlyphMapControls`:

```ts
animate?: { speed: number; axis?: "x" | "y"; pauseOnInteraction?: boolean } | false
```

```tsx
<GlyphOrbitControls drag wheel animate={{ speed: 0.3 }} />
<GlyphOrbitControls animate={{ speed: 1, axis: "x" }} />
<GlyphOrbitControls animate={false} />
```

```html
<glyph-orbit-controls drag wheel animate-speed="0.3"></glyph-orbit-controls>
<glyph-orbit-controls animate-speed="1" animate-axis="x"></glyph-orbit-controls>
```

```js
createGlyphOrbitControls(scene, { animate: { speed: 0.3 } });
```

### Camera target

`target?: Vec3` on the camera. The orbital state rotates around this point. Default `[0, 0, 0]`.

```tsx
<GlyphCamera rotX={0.5} rotY={0.4} target={[1, 0, 0]}>…</GlyphCamera>
```

```html
<glyph-camera rot-x="0.5" rot-y="0.4" target="1,0,0">…</glyph-camera>
```

```js
const camera = createGlyphCamera({ rotX: 0.5, rotY: 0.4, target: [1, 0, 0] });
```

Combined with scene-level `autoCenter`, the effective orbit pivot is `target + autoCenterOffset`. Users typically set either, not both.

### Cross-path consistency matrix

Per-path syntactic differences (camelCase vs kebab-case, JSX vs HTML) are expected. What must match: **field name root, value shape, default**.

| Feature | Lives on | Field root | Value shape | Default | Vanilla JS | Custom elements | React / Vue |
|---|---|---|---|---|---|---|---|
| Camera rotation | Camera | `rotX`, `rotY` | `number` (radians) | `0`, `0` | `{ rotX: 0.5, rotY: 0.4 }` | `rot-x="0.5" rot-y="0.4"` | `rotX={0.5}` / `:rot-x="0.5"` |
| Camera target | Camera | `target` | `Vec3` | `[0,0,0]` | `{ target: [1,0,0] }` | `target="1,0,0"` | `target={[1,0,0]}` |
| Camera zoom | Camera | `zoom` | `number` | `0.4` | `{ zoom: 0.6 }` | `zoom="0.6"` | `zoom={0.6}` |
| Camera distance | Perspective camera | `distance` | `number` (world units) | `3` | `{ distance: 5 }` | `distance="5"` | `distance={5}` |
| Render mode | Scene | `mode` | `"wireframe" \| "solid" \| "voxel"` | `"solid"` | `{ mode: "voxel" }` | `mode="voxel"` | `mode="voxel"` |
| Grid cols / rows | Scene | `cols`, `rows` | `number` | `80`, `24` | `{ cols: 100, rows: 30 }` | `cols="100" rows="30"` | `cols={100}` |
| Cell aspect | Scene | `cellAspect` | `number` | `2.0` | `{ cellAspect: 2 }` | `cell-aspect="2"` | `cellAspect={2}` |
| Glyph palette | Scene | `glyphPalette` | `string` | `"default"` | `{ glyphPalette: "blocks" }` | `glyph-palette="blocks"` | `glyphPalette="blocks"` |
| Use colors | Scene | `useColors` | `boolean` | `true` | `{ useColors: false }` | `use-colors="false"` | `useColors={false}` |
| Line height | Scene | `lineHeight` | `number` | `1` | `{ lineHeight: 1.1 }` | `line-height="1.1"` | `lineHeight={1.1}` |
| Feature edges (wireframe) | Scene | `featureEdges` | `number` (radians) | `0` | `{ featureEdges: 0.3 }` | `feature-edges="0.3"` | `featureEdges={0.3}` |
| Directional light | Scene | `directionalLight` | `{ direction: Vec3; color?: string; intensity?: number }` | (none) | object option | JSON attr `directional-light='{…}'` | object prop |
| Ambient light | Scene | `ambientLight` | `{ color?: string; intensity?: number }` | (none) | object option | JSON attr `ambient-light='{…}'` | object prop |
| Auto center (scene) | Scene | `autoCenter` | `boolean` | `false` | `{ autoCenter: true }` | bare attr `auto-center` | bare prop |
| Auto center (mesh) | Mesh | `autoCenter` | `boolean` | `false` | `scene.add(p, { autoCenter: true })` | bare attr `auto-center` | bare prop |
| Mesh resolution | Mesh | `meshResolution` | `"lossless" \| "lossy"` | `"lossy"` | `loadMesh(url, { meshResolution })` | `mesh-resolution="lossless"` | `meshResolution="lossless"` |
| Mesh position | Mesh | `position` | `Vec3` | `[0,0,0]` | `scene.add(p, { position: [1,0,0] })` | `position="1,0,0"` | `position={[1,0,0]}` |
| Mesh scale | Mesh | `scale` | `Vec3 \| number` | `1` | `scene.add(p, { scale: 1.5 })` | `scale="1.5"` | `scale={1.5}` |
| Mesh rotation | Mesh | `rotation` | `Vec3` (Euler radians, XYZ) | `[0,0,0]` | `scene.add(p, { rotation: [0,1,0] })` | `rotation="0,1,0"` | `rotation={[0,1,0]}` |
| Mesh id | Mesh | `id` | `string` | (none) | `scene.add(p, { id: "cottage" })` | `id="cottage"` | `id="cottage"` |
| Auto-rotate (orbit / map) | Controls | `animate` | `{ speed: number; axis?: "x"\|"y"; pauseOnInteraction?: boolean } \| false` | (off) | `{ animate: { speed: 0.3 } }` | flat attrs `animate-speed="0.3"` `animate-axis="x"` | object prop |
| Geometry shortcut | Mesh | `geometry` | `GlyphcssGeometryName` | (none) | `scene.add(resolveGeometry("dodecahedron"))` | `geometry="dodecahedron"` | `geometry="dodecahedron"` |
| Geometry size | Mesh | `size` | `number` | `1` | `resolveGeometry("dodecahedron", { size: 1.5 })` | `size="1.5"` | `size={1.5}` |
| Hotspot anchor | Hotspot | `at` | `Vec3` | (required) | `scene.addHotspot({ at: [0,1,0] })` | `at="0,1,0"` | `at={[0,1,0]}` |

**Nested-object props on custom elements** follow the same split as voxcss:

- **Settings-shaped** (lights) → **JSON-stringified attribute**.
- **Behavior-shaped with "boolean + tuning"** (`animate`) → **flat attributes** (`animate-speed`, `animate-axis`).

No further nesting conventions — if a new feature needs a nested object, pick one of these two patterns to match its character.

---

## Per-path naming conventions

| Concept | Vanilla JS | Custom elements | React | Vue (template) |
|---|---|---|---|---|
| Camera (default = ortho) | `createGlyphCamera(opts)` | `<glyph-camera>` | `<GlyphCamera>` | `<GlyphCamera>` |
| Scene | `createGlyphScene(host, opts)` | `<glyph-scene>` | `<GlyphScene>` | `<GlyphScene>` |
| Mesh (file) | `scene.add((await loadMesh(url)).polygons)` | `<glyph-mesh src="url">` | `<GlyphMesh src="url" />` | `<GlyphMesh src="url" />` |
| Mesh (inline) | `scene.add(polygons)` | (deferred) | `<GlyphMesh polygons={…} />` | `<GlyphMesh :polygons="…" />` |
| Mesh options | `scene.add(p, opts)` second arg | attributes on `<glyph-mesh>` | props on `<GlyphMesh>` | props on `<GlyphMesh>` |
| Hotspot | `scene.addHotspot(opts, onClick)` | `<glyph-hotspot at="…">` | `<GlyphHotspot at={…}>` | `<GlyphHotspot :at="…">` |
| Animation | `createGlyphAnimationMixer(…)` | (deferred) | `useGlyphAnimation(…)` | `useGlyphAnimation(…)` |
| Prop casing | camelCase (`rotX`) | kebab-case (`rot-x`) | camelCase (`rotX`) | kebab-case in template (`:rot-x`), camelCase in `<script>` |
| Boolean prop | `{ drag: true }` | bare attribute (`drag`) | bare JSX prop (`drag`) | bare JSX prop (`drag`) |
| Nested object prop | `{ animate: { speed: 0.3 } }` | flat attrs (`animate-speed="0.3"`) | nested object (`animate={{ speed: 0.3 }}`) | nested object (`:animate="{ speed: 0.3 }"`) |

---

## Three.js comparison

Names mirror three.js where they cleanly fit (all prefixed `Glyph`). Composition tree diverges deliberately to match the polycss/voxcss family.

| three.js | glyph | Status |
|---|---|---|
| `new THREE.Scene()` + `scene.add(mesh)` | `createGlyphScene(host)` + `scene.add(polygons)` | ✅ same verb |
| `new THREE.PerspectiveCamera()` | `createGlyphPerspectiveCamera()` | ✅ name mirrors |
| `new THREE.OrthographicCamera()` | `createGlyphOrthographicCamera()` / `createGlyphCamera()` | ✅ name mirrors; default alias diverges from three.js |
| **Default camera** = perspective | **Default camera (`GlyphCamera`)** = orthographic | ❌ deliberate divergence — voxel mode + iso scenes |
| Camera + scene as siblings under renderer | Camera wraps scene | ❌ matches polycss/voxcss family for cross-engine learnability |
| `new WebGLRenderer()` + `.render(scene, camera)` | None — scene mounts into a `<pre>` directly | ❌ no renderer; the `<pre>` is the render surface |
| `requestAnimationFrame` draw loop | None — render on state change only | ❌ no per-frame JS; rasterize→`textContent` on demand |
| `new GLTFLoader().load(url, cb)` | `await loadMesh(url)` | ⚠️ different — one async function for OBJ / glTF / GLB / VOX |
| Degrees in `Object3D.rotation` | Radians on cameras and meshes | ⚠️ glyph is radians; voxcss / polycss are degrees |
| `<AnimationMixer>` per frame | `useGlyphAnimation` hook drives a mixer | ✅ same mental model |

---

## What we deliberately don't have

Features that exist in voxcss/polycss (or are commonly requested for 3D engines) and that glyph **does not** ship — with reasoning, so future contributors don't add them by reflex.

| Feature | Why not |
|---|---|
| `textureLighting` (baked / dynamic) | No texture atlas; lighting is computed on CPU per cell during rasterize. |
| `textureQuality` (raster scale) | No texture atlas. |
| `strategies` (`{ disable: ["b","i",…] }`) | No per-polygon DOM tag system. Glyphs come from the ASCII palette. |
| `shadow` / `castShadow` | No DOM shadow leaves to emit. The rasterizer's depth buffer is internal. |
| `<GlyphTransformControls>` | Voxel/diagrammatic identity doesn't lean on per-object gizmos. Revisit if demand appears. |
| Primitive shape components (`<GlyphBox>`, `<GlyphPlane>`, etc.) | Polygon factories (`cubePolygons`, `planePolygons`, …) cover the same need with one fewer abstraction layer. |
| `<GlyphCanvas>` R3F-style root | No canvas concept; the tree is `Camera > Scene > content`. |
| `GlyphControls` generic shorthand | Users pick a specific behavior. Only `GlyphOrbitControls` / `GlyphMapControls` / `GlyphFirstPersonControls`. |
| `<GlyphDirectionalLight>` / `<GlyphAmbientLight>` components | Lights are inputs to the rasterizer, not scene-graph nodes. Object-shaped props. |
| `<GlyphPolygon>` child component | Manual polygons author through `polygons` prop on `<GlyphMesh>`. Custom elements path is deferred (see Manual polygons). |
| `<GlyphAnimation>` component | Animation is an effect on a mesh, not a tree node. Hook / factory only. |
| `GlyphFirstPersonCamera` (separate camera type) | Camera = projection, controls = behavior. FPV is `GlyphPerspectiveCamera` + `GlyphFirstPersonControls`. |
| `autoRotate` prop on scene / camera | Lives on the controls instead (`animate` option). Auto-rotation is a behavior. |

---

## Known drift (must fix to reach target)

### Naming (whole-codebase rename)

1. **Symbol prefix is `Glyphcss*`; target is `Glyph*`.** Everything in `packages/*`, the website, the elements registry, CSS classes (`.glyphcss-host`, `.glyphcss-output`, etc.), HTML tags (`<glyphcss-scene>`, …), TS symbol names, and hooks (`useGlyphcss*`) currently use the longer prefix.
   - **Fix:** mechanical rename across all packages + website + tests. CSS classes: `.glyphcss-*` → `.glyph-*`. HTML tags: `<glyphcss-*>` → `<glyph-*>`. Symbol prefix: `Glyphcss*` → `Glyph*` (functions, types, components, hooks, elements classes). Update CLAUDE.md / AGENTS.md naming section in the same PR. Decide npm package names separately (see "Open questions" below).

### Architectural

2. **Scene currently wraps camera; target is camera-wraps-scene.** React, Vue, and custom elements today expose `<GlyphcssScene>…<GlyphcssCamera/>…</GlyphcssScene>`. Vanilla `createGlyphcssScene` accepts `{ camera }` directly so it's tree-shape-neutral.
   - **Fix:** invert the React + Vue trees so `<GlyphCamera>` wraps `<GlyphScene>`. The camera component creates the camera handle and provides it via context; `<GlyphScene>` reads from context (no `camera` prop). Update the elements wiring so `<glyph-camera>` becomes the outer element and the inner `<glyph-scene>` adopts the camera handle. Drop any `camera`-on-scene shortcut. Update CLAUDE.md component list and the CodePanel snippet generator in the same PR.

3. **`GlyphCamera` alias points to perspective; target is orthographic.** CLAUDE.md says "GlyphcssCamera is a kept alias for GlyphcssPerspectiveCamera — the ergonomic default." Flip to ortho.
   - **Fix:** repoint `GlyphCamera` → `GlyphOrthographicCamera` in vanilla, custom elements, React, and Vue. Update CLAUDE.md. Gallery defaults stay free to choose perspective explicitly via `<GlyphPerspectiveCamera>`.

4. **Three camera factories instead of two.** `createGlyphcssFirstPersonCamera` ships alongside perspective and orthographic. Target: two cameras only; FPV is `Perspective + GlyphFirstPersonControls`.
   - **Fix:** fold FPV-specific projection (eye-at-origin, near-plane cull at `r[2] >= 0`, `focal`) into `GlyphPerspectiveCamera` — either as an internal "eye mode" flag toggled by the controls, or by having the controls drive `target` + a near-plane cull threshold on the existing camera. Drop the factory, the `<glyphcss-first-person-camera>` element, and `GlyphFirstPersonCamera` from React/Vue. Update CLAUDE.md component list.

### Missing features

5. **`autoCenter` is silently dropped.** `<GlyphcssScene>` (React) doesn't list it in `GlyphcssSceneProps`; `GlyphcssSceneOptions` doesn't have the field. The gallery passes `autoCenter` as a prop and the workbench normalizes geometry itself before handing it to `scene.add()`. Snippets generated by `CodePanel` advertise the prop but the public API ignores it.
   - **Fix:** add `autoCenter?: boolean` to `GlyphSceneOptions` (default `false`). When enabled, compute the bbox of all live mesh polygons on every `add` / `dispose` and apply a world-translation offset before projecting. Add the matching mesh-level option to `scene.add(polygons, { autoCenter: true })`. Wire `auto-center` attribute on `<glyph-scene>` and `<glyph-mesh>`, and the prop on the React + Vue components. The cross-binding parity test (see "Test surface") will fail until all four paths honor the flag identically.

6. **`meshResolution` is not a top-level mesh prop.** Currently only available via `loadMesh(url, { meshResolution })` at the parser level. Custom elements / React / Vue don't expose it as a `<GlyphMesh>` attribute.
   - **Fix:** add `meshResolution?` to `<GlyphMesh>` props on React + Vue and as `mesh-resolution` on `<glyph-mesh>`. Internally forward to the parser via `loadMesh`. Document the default (`"lossy"`).

7. **`scene.add` second arg is transform-only.** Currently `scene.add(polygons, { position, scale, rotation })`. Target shape merges per-mesh flags (`id`, `autoCenter`, `meshResolution`) into the same flat object.
   - **Fix:** broaden `GlyphMeshTransform` (rename to `GlyphMeshOptions`) to include the flag fields. Lift each field to a prop/attribute on `<GlyphMesh>` and to a JSON-stringified-or-flat attribute on `<glyph-mesh>`. Update the matrix above and the parity test.

### Bugs

8. **CodePanel snippets advertise `autoCenter` despite it being silently dropped.** Templated in all four tabs. Becomes correct as soon as #5 lands.

---

## Decisions (locked)

1. **Symbol prefix is `Glyph*`.** Vanilla factories `createGlyph*`, types `Glyph*`, React/Vue components `<Glyph*>`, HTML tags `<glyph-*>`, CSS classes `.glyph-*`, hooks `useGlyph*`. Four-character prefix matches `Poly*`.

2. **Camera-wraps-scene is the canonical tree shape.** Matches polycss/voxcss family. No scene-on-camera shortcut. Breaking change for current React/Vue/elements consumers — migration is mechanical (one wrapper swap). Requires an AGENTS.md update in the implementation PR.

3. **Default camera = orthographic.** `GlyphCamera` aliases `GlyphOrthographicCamera`, not `GlyphPerspectiveCamera`. Rationale: voxel render mode + iso/diagrammatic scenes are the differentiator. Requires an AGENTS.md update in the implementation PR.

4. **Camera = projection, controls = behavior.** Two camera factories only (ortho + perspective). FPV is `GlyphPerspectiveCamera + GlyphFirstPersonControls`. No standalone first-person camera.

5. **`scene.add(polygons, options?)` takes a flat options object** with transform fields (`position`, `scale`, `rotation`) and per-mesh flags (`id`, `autoCenter`, `meshResolution`) at the same level. Same shape lifts directly to `<GlyphMesh>` props and `<glyph-mesh>` attributes.

6. **No `<GlyphPolygon>` child component.** Manual polygons are authored as a `polygons` prop on `<GlyphMesh>` (mutually exclusive with `src`). Custom-element inline polygons are deferred.

7. **Rotations are radians.** Diverges from voxcss (degrees). Inherited from the asciss rasterizer math. Documented in every code snippet and the consistency matrix; not changing.

8. **`meshResolution` is a top-level `<GlyphMesh>` prop on every path.** Not buried inside `parseOptions`. Same `"lossless" | "lossy"` enum and same `"lossy"` default across all four paths.

9. **Hotspots are glyph-specific; they stay.** Polycss/voxcss don't ship anything equivalent. Glyph's rasterizer can project arbitrary world points to cell coordinates as a side effect, which makes hotspots cheap. The component is `<GlyphHotspot>` and the imperative API is `scene.addHotspot()`.

10. **Animation is opt-in via hook / factory, not a component.** `useGlyphAnimation` on React / Vue; `createGlyphAnimationMixer` on vanilla. No `<GlyphAnimation>` JSX.

11. **No primitive shape components, no `<GlyphTransformControls>`, no `<GlyphCanvas>`, no `GlyphControls` shorthand, no light components.** See "What we deliberately don't have" for reasoning.

12. **npm package names stay `glyphcss` / `@glyphcss/*`.** Symbols are `Glyph*`, HTML tags are `<glyph-*>`, CSS classes are `.glyph-*`, but the published package names keep the longer brand. Avoids an npm-scope landgrab and a website-domain rename. Minor cognitive cost (import string longer than symbol) is acceptable — the brand stays glyphcss, the API is just glyph.

## Open questions

None — all open decisions are locked above.

---

## Test surface

For each path, a parity test in `packages/glyphcss/test/snippet-parity.test.tsx`:

- Import only from the **published entry points** (`glyphcss`, `@glyphcss/react`, `@glyphcss/vue`) — never from internal paths.
- Mount each minimal example above into a jsdom host with a fixed mesh fixture (e.g. `cubePolygons({ size: 1 })`).
- Assert `host.querySelector("pre.glyph-output").textContent` is **byte-identical across all four paths** for the same camera, lights, grid, and mode.
- Cross-reference the existing `packages/glyphcss/test/fixtures/unit-cube.txt` byte-parity fixture.

**Why byte-parity:** the four paths all funnel into `createGlyphScene` + `rasterize()`. Any divergence in textContent means a wrapper silently dropped, transformed, or defaulted an option differently from another wrapper. That class of bug is exactly what this doc exists to prevent — and what the `autoCenter` drift item is an instance of.

**Doc-extraction CI step (future):** parse code fences from `website/src/content/docs/**/*.mdx` and the four package READMEs; transpile JSX / Vue; run through the same mount harness. A snippet that doesn't compile or doesn't produce a non-empty `<pre>` is drift.
