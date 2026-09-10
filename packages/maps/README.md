# @glyphcss/maps

Geographic data → glyphcss. Two things live here, on one shared lon/lat core:

- **A static bake pipeline.** A deterministic `source → sample → classify →
  compile` pass that turns a georeferenced grid (elevation, land cover, any
  scalar field) into a static ASCII `<pre>` with zero runtime.
- **An interactive map.** `createGlyphMap` — projections, an LOD'd elevation
  tile pyramid, a real 3D relief mesh, ten MapLibre-shaped layer types over
  TopoJSON / MVT / PMTiles vector sources, tilt and bearing with their
  gestures, animated projection transitions, real-sun lighting and cast
  shadows, and a street-level walk mode.

Everything public speaks lat/lng; rotation and projection units are degrees.
There is no React or Vue binding — the surface is imperative.

Two entry points. The root is pure and browser-safe (no `fs`, no native
modules); `@glyphcss/maps/node` re-exports all of it and adds
filesystem-backed source readers, and is never imported by the root.

This file is the package reference. The reader-shaped version is at
[glyphcss.com/maps/overview](https://glyphcss.com/maps/overview); the design
record — every measurement, fixed defect and rejected alternative — is in
`docs/design/maps.md`, and the contract summary is `AGENTS.md`'s "Maps"
section.

## Bake a region

```ts
import { loadGlyphMapSource } from "@glyphcss/maps/node";
import {
  glyphMapBounds,
  sampleGlyphMapField,
  classifyGlyphMapField,
  compileGlyphMap,
  GlyphMapClassifiers,
} from "@glyphcss/maps";

const src = await loadGlyphMapSource({ path: "ETOPO1.asc.gz", id: "etopo1-2009" });
const view = glyphMapBounds({
  west: 84.5, east: 86.5, south: 27.6, north: 28.8,
  cols: 140, rows: 48,
});

const field = await sampleGlyphMapField(src, view, { sampler: "max" });
const bands = classifyGlyphMapField(field, GlyphMapClassifiers.etopo1V1);

const { html, css } = compileGlyphMap(bands, {
  ramp: " .:-=+*#%@",
  colors: ["#2a55a8", "#3a6b30", "#5a7a30", "#8a7050", "#a89070", "#c0a080", "#d0b090", "#e0c0a0", "#f0e0d0", "#ffffff"],
  water: "~",
});
// html/css inline anywhere — a few KB, no JS, no runtime.
```

The pure path is `encodeGlyphBuffers` → `encodeStaticGlyphHtml` (both
exported by `glyphcss`), not `compileScene` — the static bake has no polygons
or camera to project.

## Everything public speaks lat/lng

`GlyphMapView` is `{ center: [lon, lat], span, cols, rows }` — height is
derived from `span * (rows / cols)` (the aspect lock), so the pan/zoom widget
never shears terrain. `glyphMapBounds({ west, east, south,
north, cols, rows })` is a convenience constructor for the static-bake case:
it carries the exact requested box on `.bounds` rather than re-deriving one,
since a one-shot bake wants precisely the window it asked for.

## The sampler is a lever, with rules that are frozen under its id

Many source pixels land in one output cell; how they collapse is a real
visual choice, not an implementation detail:

```ts
type GlyphMapSampler =
  | "mean"     // stable under panning; flattens summits
  | "max"      // keeps peaks — usually best for terrain legibility
  | "min"
  | "nearest"  // fast; ALIASES — features pop in/out as you pan
  | "majority" // categorical only
  | ((samples: Float32Array, cell: GlyphMapCellContext) => number);
```

A source pixel belongs to the cell whose geographic box contains that
pixel's centre (half-open on the north/west edges, so no pixel is counted
twice). A cell with **zero** landing pixels (the view outresolves the
source) falls back to `upsample: "bilinear" | "nearest"` — every named
aggregation above is undefined on an empty set. `noData` is aggregated over
valid samples only; a cell is `noData` only when **all** its samples are,
unless `noData: "strict"` (any invalid sample marks the cell). A callback
sampler opts out of the byte-identity guarantee below — a function has no
id, so it records `sampler: "custom"` on a built artifact.

## Classifiers

```ts
GlyphMapClassifiers.etopo1V1        // frozen ETOPO1 breaks
glyphMapBreaks([0, 250, 800, ...])
glyphMapQuantile(9)                 // fit against the field's own distribution
glyphMapEqualInterval(9, [min, max])
glyphMapLog(9)
```

A classifier is a value with an id, not a flag — two quantile-classified
fields are not comparable to each other, even under the same id. `kind` on a
`GlyphMapField` gates which classifiers are legal: order-statistic
classifiers (`glyphMapQuantile`, `glyphMapLog`) throw on a categorical
field rather than coercing.

## Determinism

Same source + same bounds + same classifier + same sampler id ⇒
byte-identical output, per engine (transcendental math is not pinned
cross-engine by ECMAScript). `compileGlyphMap`'s output is a pure function of
its inputs; `buildGlyphMapArtifact` records the `source`/`classifier`/
`sampler` ids a re-bake needs to reproduce a tile, so a legitimate source
upgrade never silently reads as drift.

## ASCII Grid reader, and the `/node` entry

`parseGlyphMapAsciiGrid` (root, pure JS) parses an Esri/Arc-Info ASCII Grid
(`.asc`/`.grd`) already in memory. **`gdal-async` is deliberately not a
dependency of this package** — a GDAL-backed reader is future work behind the
`/node` subpath, kept out of installs the way
`website/scripts/bake-labels.mjs` keeps GDAL out of the website's install.

`@glyphcss/maps/node` is that subpath, and its whole surface is deliberately
small: it re-exports EVERYTHING from the root, and adds exactly one thing —
`loadGlyphMapSource(opts)`, which reads an ASCII Grid off disk (gunzipping a
`.gz`-suffixed path automatically, or on an explicit `gzip: true`) and returns
a `GlyphMapSource`. `opts` is the grid's own `GlyphMapAsciiGridMeta` (the
`id` is REQUIRED — a silently defaulted source id would let a renamed or
replaced file read as an unrecorded source change) plus `path` and `gzip`.

```js
import { loadGlyphMapSource } from "@glyphcss/maps/node";

const src = await loadGlyphMapSource({ path: "ETOPO1.asc.gz", id: "etopo1-2009" });
```

So a Node consumer imports `/node` and nothing else; a browser consumer
imports the root, and cannot reach `node:fs` through it even transitively.

## Projections

```ts
import { glyphMapEquirectangular, glyphMapMercator, glyphMapGlobe, glyphMapOrthographic } from "@glyphcss/maps";

const globe = glyphMapGlobe({ radius: 1, exaggeration: 30 });
const [x, y, z] = globe.project(lon, lat, elevMeters); // degrees in
const [lon2, lat2] = globe.unproject([x, y, z]);
```

A `GlyphMapProjection` is `{ id, project(lon, lat, elev): Vec3, unproject(p):
[lon, lat], domain }` — units are DEGREES in (repo convention, not d3's
radians). `project` returns `[NaN, NaN, NaN]` outside a projection's valid
window (Mercator past `±maxLat`, orthographic on the far hemisphere) — a
mesh builder crops a quad with any invalid corner rather than clamping it,
which would collapse a row of vertices into a zero-area sliver. Elevation
scales the same way everywhere — `z = (elev / GLYPH_MAP_EARTH_RADIUS_M) *
exaggeration` — so `exaggeration: 1` is true-scale relief on every
projection, globe included.

`glyphMapEquirectangular`, `glyphMapMercator`, and `glyphMapOrthographic`
share one flat world frame: `X` = north/south (increasing north), `Y` =
east/west (increasing east). `glyphMapGlobe({ radius, exaggeration })` is a
genuine 3D sphere — every `(lon, lat)` is valid — with `X =
r·cosLat·cos(lon)`, `Y = r·cosLat·sin(lon)` (increasing EAST), `Z = r·sinLat`
(increasing north): the textbook right-handed spherical-to-Cartesian map.
This frame is pinned and tested by a chirality gate anchored OUTSIDE this
package's own math — see `src/chirality.test.ts`, which uses `glyphcss`'s
real camera to assert 30°E projects to a greater screen column than 0°E
under a camera facing Greenwich with north up. **This is deliberately NOT**
`website/scripts/bake-globe.mjs`'s own `latLonToXYZ`, which negates `Y` and
fails that same gate — see `src/parity.test.ts`'s "known deviation" note for
the full account (in short: `bake-globe.mjs`'s sphere formula mirrors
`/examples/world` east-west; its own flat-map formula, in the same file,
does not have this bug).

```ts
import { geoMollweideRaw } from "d3-geo-projection";
import { glyphMapFromD3Raw } from "@glyphcss/maps";

const mollweide = glyphMapFromD3Raw(geoMollweideRaw); // degrees ⇄ radians handled
```

`glyphMapFromD3Raw` adapts any `d3-geo-projection` raw projection —
`(lambda, phi) → [x, y]` in radians, optional `.invert(x, y) → [lambda,
phi]` — swapping its `(x, y)` into this package's `(Y, X)` frame.
`d3-geo-projection` is a **devDependency only**; the adapter never imports
it, so it never becomes a runtime dependency of a consumer.

## Geographic tiles and the relief mesh

```ts
import { glyphMapPolygons, glyphMapGlobe, splitGlyphMapGeoTileAtAntimeridian } from "@glyphcss/maps";

const polygons = glyphMapPolygons(tile, glyphMapGlobe({ exaggeration: 30 }), {
  color: (elev) => (elev < 0 ? "#2a55a8" : "#5a7a30"),
});
// polygons: Polygon[] — render with `createGlyphScene`/`compileScene` like any other mesh.
```

`GlyphMapGeoTile` — `{ bounds, cols, rows, elevation, source, sampler }` —
carries lon/lat/elevation; projection is applied CLIENT-SIDE, so one tile
pyramid serves every projection (unlike both existing bakers this package
supersedes, which pre-project). Its elevation grid is VERTEX-centered
(`(cols + 1) x (rows + 1)`, not the static bake's cell-centered
`GlyphMapField`) so
adjacent quads share an edge with no seam — `glyphMapGeoTileVertexLonLat`'s
formula matches `bake-globe.mjs`'s own per-vertex sampling loop exactly,
which is what makes exact parity (below) possible. `glyphMapPolygons(tile,
projection, opts?)` builds one quad per tile cell, skipping any quad with a
corner outside the projection's valid window.

`opts.resolution` (`{ cols, rows }`) builds a COARSER mesh than the tile's
baked grid — a tile that only covers 20×10 glyph cells on screen does not
need 16,200 quads. Output grid line `i` samples source vertex
`round(i * total / count)`, so the first and last lines land exactly on the
tile's own boundary for any count, `resolution` matching the tile's own
`cols`/`rows` is byte-identical to omitting it, and a request larger than
the tile clamps rather than upsampling. Elevation is point-sampled at the
retained vertices. **Resolve one resolution per pyramid LEVEL, not per
tile**: two tiles built at the same resolution sample the identical source
vertices along their shared edge, so the edge is exactly shared; tiles at
different resolutions do not, and the T-junction gap shows as a tear.
`createGlyphMap` does this for you — target-LOD tiles get one quad per glyph
cell, the transient fallback tier is built 2× coarser, and the permanent
never-black floor is capped to a glimpse-only 32 quads per axis whenever it
is not itself the target level.

`opts.elevationBias` (metres) offsets every vertex's POSITION along the
projection's own elevation axis without touching the elevation `color` is
handed, so a biased mesh is the same map at a different radius rather than a
differently-classified one. `createGlyphMap` uses it to sink any tier that is
not the target LOD: all three tiers are opaque meshes in ONE scene, so a
coarse quad straddling a coast — whose chord runs linearly from the sea floor
up to the summit — otherwise sits kilometres above the fine tier's own sea
floor, wins the shared depth test over open ocean and paints it in the colour
of a block that is mostly land. Measured on the real ETOPO1 pyramid over the
Peru–Chile trench at 486 of 4,462 sea cells in a land band; with the sink the
combined render is cell-for-cell identical to the target tier alone. Raising
the floor's own resolution does not fix it (231 stolen cells even at 2°
quads) — a backstop has to be *behind*, not merely finer.

A tile whose bounds straddle the antimeridian (`bounds.east > 180`, an
"unwrapped" authoring convention — e.g. `{ west: 170, east: 190 }` for
170°E–170°W) must be split BEFORE projecting, or its quads bridge the whole
map as garbage strips: `splitGlyphMapGeoTileAtAntimeridian(tile)` splits on
a whole-column boundary near the seam — a literal grid slice, never a
resample.

`website/scripts/bake-geo-tiles.mjs` bakes this schema from ETOPO1: `--fixture`
writes the small vendored parity fixture at `fixtures/geo-tile-parity.json`
(a few KB — CI needs no ETOPO1 to run the parity gate); `--tiles` writes the
full z0-z4 global pyramid (341 tiles, ~11 MB) to `website/public/data/
geo-tiles/` (gitignored — regenerable, and at full resolution not small
enough to vendor), plus a curated z5-z7 overlay for Switzerland under
`geo-tiles/curated/`. Tiles are `{z}/{x}_{y}.bin` — a raw little-endian
int16 payload, not JSON — decoded with the root-exported
`glyphMapDecodeGeoTileInt16(bytes, meta)`; `manifest.json` records
`format: "int16"`/`version: 2` (a reader must gate on both) and, when a
curated overlay exists, a `curated` entry per level (`{ name, zoom, bounds,
tiles }`, `tiles` the real `"x_y"` keys at that level).

Past a global pyramid's affordable depth, `glyphMapCuratedProvider(base,
curated)` wraps a base `GlyphMapProvider` with one or more DEEPER zoom
levels that only have real tiles inside a curated place's bounds — every
other tile at those depths degrades to the deepest ancestor tile that
actually exists (another curated level, or the base's own max zoom), never
blank, never a throw:

```ts
import { glyphMapCuratedProvider } from "@glyphcss/maps";

const provider = glyphMapCuratedProvider(baseGeoTilesProvider, [
  { zoom: z5Zoom, tiles: new Set(["17_11"]), loadTile: (x, y) => fetchCuratedTile(5, x, y) },
  { zoom: z6Zoom, tiles: new Set(["35_23"]), loadTile: (x, y) => fetchCuratedTile(6, x, y) },
]);
```

`website/src/lib/geoTilesProvider.ts` is the reference caller — it wraps its
base provider unconditionally, and an empty/absent `curated` manifest field
returns `base` unchanged, so there's exactly one reader code path either way.

**Exact parity, honestly reported.** `src/parity.test.ts` projects that
vendored fixture through `glyphMapGlobe` and compares it, vertex for vertex,
against `bake-globe.mjs`'s own checked-in `website/public/data/tiles/0/0_0.json`.
`X`/`Z` agree to ~5e-6 (the reference JSON's own 5-significant-figure
truncation); `Y` agrees only once NEGATED, and the test also asserts that a
literal (non-negated) `Y` comparison is NOT close (differs by ~1.0) — proving
the deviation is an exact, understood sign flip, not loosened tolerance
masking noise. See the chirality gate above for why `glyphMapGlobe` ships the
un-negated convention regardless.

## The widget

```ts
import { createGlyphMap, glyphMapGlobe, glyphMapMercator } from "@glyphcss/maps";

const map = createGlyphMap(host, {
  view: { center: [0, 20], span: 60, cols: 120, rows: 50 },
  projection: glyphMapGlobe({ exaggeration: 30 }),
  layers: [
    { type: "background", color: "#03050a" },
    { type: "raster", source: reliefProvider, classifier: GlyphMapClassifiers.etopo1V1, colors: [...] },
  ],
});

map.addMarker({ at: [-58.38, -34.60], label: "Buenos Aires" });
map.on("click", ({ lngLat }) => console.log(lngLat));
map.fitBounds({ west: -74, east: -34, south: -56, north: 13 });
const { col, row, visible } = map.project([-58.38, -34.60]);
map.destroy();
```

`createGlyphMap(host, opts)` owns one `createGlyphScene` under the hood — a
plain vertex projection (`GlyphMapProjection`) and one real 3D relief mesh
(`glyphMapPolygons`) under two very different navigation feels, unified
instead of reimplemented per projection kind. `GlyphMapProjection` carries
two OPTIONAL capabilities beyond `project`/`unproject`/`domain`, and the
widget picks its behavior by checking for their PRESENCE, never by branching
on a projection's `id`:

- `visible?(world, depthOf)` — a near/far-hemisphere test. Absent on every
  flat projection (which already excludes an invisible point via `project()`
  returning `NaN`); present only on `glyphMapGlobe`, where every `(lon, lat)`
  is a geometrically valid point on the sphere, front or back. Drives both
  tile culling and `map.project(...).visible`/marker hiding through ONE
  sample-point test, not a plane-AABB test for one projection kind and a
  great-circle test for another.
- `cameraForCenter`/`centerForCamera` — present only on a projection
  navigated by ORBITING the camera around fixed world geometry (the globe).
  Their presence is what makes the widget's drag gesture orbit instead of
  pan-with-domain-clamp, with no `if (projection is globe)` anywhere in
  `widget.ts`.

### Camera pitch

`tilt` pitches the camera ABOUT THE SURFACE POINT UNDER THE VIEW CENTRE, with
the pivot distance equal to the camera's altitude — the Google Earth / Cesium
model. `map.project(map.getView().center)` therefore lands at the centre of
the grid at every pitch and every span, and the two feels fall out of the one
rule with no threshold: zoomed out the pivot is far below the camera relative
to the view, so pitching swings the globe and the limb comes into frame
tangentially; zoomed in the pivot is directly beneath, so pitching reads as
raising your head off the ground. Under the orthographic camera the pivot's
distance along the view axis is unobservable, so this reduces exactly to
"`camera.target` is the projected view centre" — which is what a sheet
projection has always done, so a plane is the degenerate case of the same
rule.

`map.getMaxTilt()` is the live ceiling `setTilt` clamps to, and `getTilt()`
reports the pitch the camera actually has. It is the HORIZON ANGLE at the
view's own scale, `asin(R / (R + h))` for the frame's world half-height `h`
— small at planet scale (~21 degrees on a 360-degree span, where 80 degrees
would aim past the limb at empty space) and rising to `GLYPH_MAP_MAX_TILT`
(85) as the surface goes locally flat. A sheet has no limb, so its ceiling is
that cap at every span. The request is remembered unclamped, so zooming back
in restores the full pitch.

### Camera bearing

`bearing` is the compass heading, in degrees, that points UP on screen. `0`
(the default) is north up; `90` puts east up — MapLibre's convention, so the
picture turns counter-clockwise as the number grows. `map.setBearing(b)` /
`map.getBearing()`, reported normalized to `[0, 360)`.

It is a rotation about the SURFACE NORMAL AT THE PIVOT — the same point
`tilt` pitches about — and not a roll about the view axis. The two are
identical at zero pitch and diverge exactly when tilted: a view-axis roll
tips the horizon, and no map product does that. Turning about the pivot's
local up instead swings the camera around a cone at constant pitch, so the
horizon stays level and only the heading changes. In glyphcss's own frame the
composition is `RotX(tilt) · RotZ(-bearing) · RotX(trueRotX) · RotZ(rotY)`:
navigate, then turn, then pitch.

At bearing `0` no camera matrix is installed at all and the render is
bit-for-bit what it was before the feature existed — the same string, the
same `project()` cells, the same `getMaxSpan()`. At any other heading the
widget installs it through `GlyphCamera.mat`/`useMat`, glyphcss's public
rotation override.

Two things follow the heading automatically and are worth knowing about: a
drag still pans the way the picture looks (the pixel delta comes back through
the bearing before it becomes navigation), and a SHEET's cover ceiling
TIGHTENS, because a turned viewport is a rotated rectangle whose reach along
each world axis is `w|cos b| + h|sin b|` — worst at 45 degrees.

**Ctrl+drag — or a right-button drag — ORIENTS the camera**: VERTICAL travel
pitches it at `GLYPH_MAP_TILT_DRAG_DEG_PER_PX` (0.5) degrees per pixel,
HORIZONTAL travel turns it at `GLYPH_MAP_BEARING_DRAG_DEG_PER_PX` (0.8) —
the binding Google Maps, Mapbox and MapLibre all use, and MapLibre's own two
rates. Dragging right INCREASES the bearing, turning the picture
anti-clockwise, so the near ground — the lower half of a pitched picture, the
half the hand is actually on — follows the hand, and the Dock's own Bearing
slider moves the same way the drag does. Both axes are live in
one stroke; there is no axis lock. Plain drag keeps its meaning (pan on a
sheet, orbit on the globe). `controls.tilt` (default `true`) is the one
opt-out for both halves — it is one press and one stroke — alongside
`controls.drag`/`controls.wheel`, and while it is enabled the widget
suppresses the host's context menu so the right-button half is usable. The
pitch clamps live to `getMaxTilt()` as the zoom changes it, neither angle
carries inertia, and the gesture shares the widget's one animation frame with
every other one — at most one render per displayed frame.

### Cover, not contain

A SHEET projection (no `cameraForCenter` — equirectangular, Mercator,
orthographic) always FILLS the viewport: no page background around its edges
at any zoom or pan position. `map.getMaxSpan()` is the live ceiling every
span path clamps to — the widest view that still covers, computed from the
projection's own projected `domain` extent against the host's real pixel
shape and the camera `tilt`, so it moves when any of those do. A pan is
clamped in world space so the visible WINDOW stays inside that extent, not
just the centre. Both are selected by capability: an ORBIT projection (the
globe) legitimately floats in space and is exempt, and an explicit `maxSpan`
is the documented opt-out — it means "overview margin around the whole
projection", which is precisely what cover removes.

Where a map genuinely cannot fill an axis (a `minSpan` floor holding the view
wider than cover would like — a Mercator cropped to a narrow `maxLat` in a
very tall viewport), that axis is CENTRED rather than pinned to an edge: one
fixed point, so a drag against it settles instead of oscillating. And the
guarantee is over the extent's bounding BOX, so orthographic's disc still
leaves the viewport's four corners uncovered — filling those would mean
cropping to the disc's inscribed rectangle and putting the hemisphere's limb
out of reach.

**Two bugs fixed rather than ported** from `website/src/pages/examples/{world,flatmap}.astro`,
the two hand-rolled pages this widget replaces:

1. `world.astro`'s focal-point scan picked the MINIMUM projected depth as
   the near-hemisphere point, and treated `depth < 0` as front-facing — but
   `glyphcss`'s own convention (`rasterize.ts`, `createGlyphOrthographicCamera`)
   is **larger depth = nearer**, so that scan resolved the ANTIPODE, masked
   in practice by hemispheric tile coverage plus a failsafe tile.
   `glyphMapGlobe`'s `visible()`/`cameraForCenter()`/`centerForCamera()` are
   closed-form (derived from the camera's own verified depth formula — see
   `projection.ts`), not a scan.
2. Both pages keyed LOD on absolute `camera.zoom`, which only worked because
   their world scale happened to be ≈ 1 unit ≈ hemisphere. `GlyphMapProvider`
   + `glyphMapTargetLOD` instead key LOD on `glyphMapDegreesPerCell(view)` —
   ground units per glyph cell, geographic by construction — so two
   projections with different native scales (a `radius: 1` globe and a
   `radius: 100` one) select the same LOD for the same view.

A raster layer's `source` is either a single already-loaded
`GlyphMapGeoTile` (mounted once) or a `GlyphMapProvider` — a tile pyramid
(`{ id, zooms, bounds(z,x,y), loadTile(z,x,y) }`) the widget fetches,
caches, culls, and debounces exactly like both example pages did by hand.
`view.cols`/`view.rows` are the authoritative grid shape (`autoSize: true`
opts back into host-pixel-driven `cols`/`rows`, both pages' own default).
`map.addLayer`/`removeLayer`/`moveLayer` mutate an ordered layer list.
`background` sets the scene output's CSS background color and `raster` builds
the relief mesh; the rest of `GlyphMapLayer` is MapLibre's
`fill`/`line`/`contour`/`symbol`/`circle`/`heatmap`/`fill-extrusion`/`model`
vocabulary, over the vector sources documented below.

### Per-layer render mode

A map is not one picture in one mode: terrain reads as `solid` while an
administrative overlay reads as `ink`. Every MESH-BACKED layer — `raster`,
`fill`, `fill-extrusion`, `heatmap`, `model` — carries an optional
`renderMode` that passes straight through to glyphcss's per-mesh
`GlyphMeshTransform.mode`:

```ts
map.addLayer({ type: "raster", source: reliefProvider, /* solid, the scene's own mode */ });
map.addLayer({ type: "fill", source: adminProvider, renderMode: "ink" });
```

Omitted — or set to the mode the scene is already rendering in — the layer
stays in the shared base grid: one rasterizer pass, byte identical. A
genuinely different mode pops that layer's mesh into its own `<pre>` and
costs a full extra pass, so it is a per-LAYER choice, not a per-mesh one. A
`wireframe`/`ink` layer is additionally mounted `transparent`, because those
modes paint edges only and an opaque claim over the layer's whole footprint
would erase the terrain the outline is drawn over.

`line` and `contour` layers have no `renderMode` and never will: they own no
mesh, are stamped into the cell grid after rasterization, and already emit
oriented stroke glyphs by construction. (A contour is real 3D geometry —
see "Contours stand on the terrain" — but it is *stamped*, not mounted.) `symbol`/`circle` mount DOM hotspots
rather than geometry, so they carry none either.

### Markers stand on the terrain

A `symbol` label and a `circle` dot are anchored at the GROUND elevation under
their own lon/lat, read from whichever `raster` layers are mounted (finest
tier first) — the same sampler a `line`'s draped vertices and a
`fill-extrusion`'s base use. With no `raster` layer mounted the ground is the
datum and the render is byte-identical, elements included.

The height is the terrain SAMPLE, never a feature's own elevation property. A
`mountain_peak`'s `ele` is where the real summit is; the sample is where the
DRAWN one is, and a raster pyramid under-samples a summit by hundreds of
metres — so anchoring at `ele` floats the label above the mountain it names by
that difference times the terrain's `exaggeration`. It is also the only rule
that works for a place name, a lake label or a POI, none of which carry an
elevation at all.

Markers are re-planted when the mounted tile set changes, so a label moves
onto a finer tier's ground in the same frame the terrain does.

### Fills stand on the terrain too — `drape`

```js
map.addLayer({ type: "fill", source: water, color: "#1e6fd9" });                    // draped (default)
map.addLayer({ type: "fill", source: landuse, color: "#4a5a3a", drape: "flat" });   // datum overlay
```

`GlyphMapFillLayer.drape` is `"surface"` (the default) or `"flat"`:

- **`"surface"`** projects every cap vertex at the ground under its own
  lon/lat, so the wash lies ON the relief. A lake really is at height — Lake
  Titicaca's surface is 3,812 m — and a fill drawn on the datum under a
  mounted terrain raster is kilometres beneath the mountains around it, i.e.
  invisible.
- **`"flat"`** is the datum overlay: coplanar with every other flat layer,
  never wrapping a ridge, never eaten by the relief it lies on — which is
  what an administrative or landcover tint you are *reading* usually wants.

The elevation comes from the terrain, because a vector tile has none: in the
OpenMapTiles schema `water` carries `class`/`brunnel`/`intermittent`,
`landcover` `class`/`subclass`, and only `mountain_peak` has an `ele` at all.
It is sampled per VERTEX, not once per polygon — a fill is a sheet of ground,
and one elevation for a park that spans a valley floats one end and buries the
other. Draped fills are re-planted when the mounted tile set changes, exactly
like markers and extrusions.

With no ground to read (see below) the two settings render identically, cell
for cell.

#### The ocean is the one body of water the terrain cannot place

`drape` also takes a PREDICATE — `(feature) => "surface" | "flat"` — and the
shipped `omt-water` row carries one, because a DEM's zero *is* mean sea level:
over the sea the terrain is BATHYMETRY, so draping an ocean polygon on it
builds the sea surface on the sea FLOOR.

```js
import { glyphMapOpenMapTilesWaterDrape } from "@glyphcss/maps";

map.addLayer({ type: "fill", source: water, colorProperty: "class",
               drape: glyphMapOpenMapTilesWaterDrape });   // ocean flat, lakes draped
```

Measured across every tile vendored under `packages/maps/fixtures/openfreemap/`,
the ground under each water class's own ring vertices: `lake` 0% below sea
level (min +4 m), `pond` 0%, `river` 0%, `swimming_pool` 0% — and `ocean`
**48.8%, min -5,296 m**. So the per-vertex drape is already flat wherever a DEM
resolves a water body; the ocean is the single exception, and its surface is
the datum by definition rather than by any estimator. Per FEATURE and not per
layer, because one `water` source layer carries the ocean beside the lakes and
flattening the whole layer would put Titicaca back under the mountains.

### Where the ground comes from — `groundElevation`

Everything that stands on the ground — a `line`'s draped vertices, a
`symbol`/`circle` marker's anchor, a `fill-extrusion`'s footing, a draped
`fill`'s cap — reads ONE elevation source. By default that is the mounted
`raster` layers' own tiles, finest tier first. Supply your own and it wins,
with no `raster` layer needed at all:

```js
createGlyphMap(host, {
  view, projection,
  // metres, or null where you have no data for that point
  groundElevation: (lon, lat) => myDem.sample(lon, lat) ?? null,
  layers: [...],
});
```

`null` (or a non-finite number) means the datum for that point, so a source
that answers for part of the world is fine. **With no terrain and no source
everything sits on the datum** — that is not a degraded mode, it is what a
flat map looks like, and it is what all of these rendered before any of them
learned to drape.

One exception, and it is structural: a `contour` does not read this. Its lines
are marched from the mounted raster mosaic's own vertex grids — a field, not a
point lookup — so a caller-supplied function cannot serve it.

### Long labels wrap

A `symbol` label longer than `GLYPH_MAP_LABEL_WRAP_CELLS` (20 characters) is
broken onto up to `GLYPH_MAP_LABEL_WRAP_MAX_LINES` (3) balanced lines, centred
on each other and on the feature's own point. At word boundaries only — a
single word longer than the width overflows its line rather than being
hyphenated — and balanced rather than filled greedily, so
`Region de Magallanes y de la Antartica Chilena` (46 cells; a city view is
about 140) reads

```
     Region de
 Magallanes y de la
 Antartica Chilena
```

rather than one full line and a stub. A label at or under the width is
untouched.

`glyphMapWrapLabel(label, width?, maxLines?)` is exported if you want the
same rule for your own text — for instance inside
`GlyphMapSymbolLayer.text`. The declutter arbiter measures the wrapped block
(`GlyphMapLabelCandidate.lines`: `max(line length)` wide by `lines.length`
tall), so a long name no longer reserves a strip across a third of the frame.
Contour labels pass no `lines` and never wrap.

### What a `symbol` labels

A `symbol` layer labels POINT and LINE features. A point — or each point of a
multipoint — is labelled where it is. A LINE gets ONE anchor,
`glyphMapLabelAnchorPoint`'s arc-length midpoint of its longest part (with
longitude weighted by `cos(lat)`, so the midpoint is a ground midpoint):

```ts
import { glyphMapLabelAnchorPoint } from "@glyphcss/maps";

glyphMapLabelAnchorPoint({ geometryType: "line", rings: [[[0, 0], [1, 0]]] });
// → [0.5, 0]
```

Lines are labelled because a vector schema ships an elongated feature's name
as the PATH a curved-text renderer would run the name along — OpenMapTiles'
`water_name` does, and every lake in it is a line — while this renderer has no
curved text. The midpoint is on the polyline by construction, so a lake's name
lands in the lake rather than on its shore or in a different arm; the longest
part rather than each part, so a multi-part water body is named once.

A POLYGON is not labelled. Its anchor is a pole of inaccessibility, which is a
different algorithm, and a point on the boundary would be a wrong answer
rather than no answer.

### Label placement

A `symbol` layer's labels are centred on their own point by default. Move
them with `textAnchor` — MapLibre's `text-anchor` vocabulary and semantics
(`center`, `left`, `right`, `top`, `bottom` and the four corners; `left` puts
the label's LEFT edge on the point, so it reads out to the right) — and nudge
them with `textOffset`, `[x, y]` in CELLS with `y` down, applied on top of the
anchor.

```ts
map.addLayer({
  type: "symbol",
  source: places,
  textProperty: "name",
  // Beside the dot, one cell clear of it.
  textAnchor: "left",
  textOffset: [1, 0],
});
```

The offset is there for the same reason MapLibre pairs `text-offset` with
`text-anchor`: an anchor alone puts the label's edge exactly ON the point, so
a name anchored `left` of a `circle` layer's dot has its first character
inside the dot. Cells rather than ems because a cell is this package's unit
and the one both the CSS and the declutter arbiter can convert exactly.

The arbiter reserves the box where the label LANDS, not where its point is
(`GlyphMapLabelCandidate.anchor`/`offset`, off the same
`glyphMapLabelAnchorFraction` table the CSS percentage comes from) — otherwise
moving a label would increase collisions while emptying the map. Contour
labels pass neither and are unaffected.

Omitting both, or passing `textAnchor: "center"` with `textOffset: [0, 0]`, is
byte-identical: no `transform` is written at all.

### Per-layer glyph palette

The same argument, one axis over: a map is no more one picture in one
character ramp than it is in one mode. The same five mesh-backed layer types
carry an optional `glyphPalette` that routes to glyphcss's per-mesh
`GlyphMeshTransform.glyphPalette`, and `line`/`contour`/`symbol`/`circle`
carry none for the same reasons as above (glyphcss documents `glyphPalette`
as a no-op for a post-raster stroke path).

```ts
map.addLayer({ type: "raster", source: reliefProvider, colors: terrainRamp });
map.addLayer({ type: "fill-extrusion", source: adminProvider, glyphPalette: "blocks" });
```

`glyphPalette` is the CHARACTER ramp — which glyphs carry the shade. It is a
different axis from a `raster` layer's `colors`, which is the elevation-band
COLOUR ramp; the two compose.

Omitted — or set to the ramp the scene is already on — the layer stays in the
shared base grid: one pass, byte identical. A genuinely different ramp costs a
full extra rasterizer pass at the base cell size (no extra detail), and an
opaque one additionally turns on the whole-scene occlusion id-map raster.

That "same ramp is free" escape lives in this package rather than in glyphcss
on purpose. glyphcss's `isDetailMesh` separates on any non-null per-mesh
`glyphPalette`, because an unrecognized name resolves to the default ramp and
so two DIFFERENT names can mean one ramp. Two EQUAL names cannot: they always
resolve to one ramp, known or not, which is exactly the comparison this
package makes before setting the per-mesh option at all. The scene's palette
is read live at mount; changing it afterwards through the `map.scene` escape
hatch does not re-evaluate already-mounted meshes — re-add the layer, which is
how every other per-layer appearance change here already works.

### Contours stand on the terrain

A `contour` layer's lines are real geometry at their own elevation. Each
level's isoline is cut out of the elevation field with marching squares, in
lon/lat, and every vertex it produces is projected through
`projection.project(lon, lat, level)` — the same call the terrain vertex beside
it goes through. So a 2,000 m contour sits on the 2,000 m ground at every
`exaggeration` and, crucially, at every tilt: pitch the camera and the lines
wrap the relief in three dimensions instead of lying flat under it.

This replaced a per-cell scan that asked `unproject` what elevation was under
each output cell. `unproject` inverts at elevation ZERO (a projection's `z`
axis is one-way relief), so under a tilt the cell you are looking at was
attributed the lon/lat of the sea-level point beneath the view ray, and the
line landed where sea level would be — the mirror image of the parallax the
`line` drape closes. Measured on a 24x alpine fixture at a 40-degree pitch:
every one of 280 inked cells sat at the datum position, none at the level's.
There is no flat/elevated toggle, because at zero pitch the two are the same
picture and everywhere else the flat one is simply wrong.

Consequences worth knowing:

- A contour is now depth-tested like any other stroke, so a ridge in front of
  it hides it, and it inherits the same curvature-scaled coplanar allowance a
  draped `line` uses.
- The geometry is CACHED and re-projected per frame. It is re-cut only when
  the mounted tile mosaic changes or the resolved level list does — never on a
  pan, zoom, orbit or tilt, which only re-project it.
- Cost, measured on the real ETOPO1 pyramid at an alpine view (0.6 degrees,
  140x63, Switzerland's curated z7, 64,800 quads mounted): the per-render
  stamp is 1.2 ms at a 1,000 m interval and 8.7 ms at 200 m, against a flat
  ~11-12 ms for the per-cell path it replaces (whose cost was a function of
  the OUTPUT grid, not of how many levels you asked for). Re-cutting the
  geometry costs 4.8 ms at a 1,000 m interval and ~35 ms at 200 m, and is paid
  only when the mosaic or the level list changes.

### Terrain elevation window

A `raster` layer takes `minElevation`/`maxElevation` too — metres, both
optional, both omitted by default and byte-identical there. Terrain outside
the window is **held AT the window edge**, not dropped:

```js
// Draw the land; replace the seabed with a smooth plane at sea level.
map.addLayer({ type: "raster", id: "terrain", source: provider, classifier, colors, minElevation: 0 });

// The reverse: bathymetry with the land flattened off.
map.addLayer({ type: "raster", id: "terrain", source: provider, classifier, colors, maxElevation: 0 });
```

This is the one place the package clamps where it otherwise crops, and the
tier ladder is why. A raster layer mounts three tiers of terrain at once, each
resolving the window against its own quad grid, so a dropped quad is a HOLE
the backstop underneath fills — in the colour of an 11-degree quad that is
mostly land. Measured on the real ETOPO1 pyramid, a cropped floor of 0 painted
641 of 1,752 Mediterranean sea cells in a land band against the target tier's
own 150, plus 200 coastal land cells lost. A clamp has no hole, and wherever
every sample a tier covers is out of window every tier's surface is the same
constant plane, so no coarse chord can rise above a finer one.

It moves POSITION only, per vertex. A quad's colour still reads the terrain's
own unwindowed elevation, exactly as `elevationBias` does — the sea keeps its
bathymetric band and only its floor goes — and a partially-submerged quad
keeps its land corners at their own heights, so a coast still slopes rather
than steps. `groundElevationSampler` takes the same window, so a draped road,
a planted building and a marker all stand on the surface actually drawn.

A `contour` layer is deliberately not windowed by this: it marches the mounted
mosaic's own vertex grids and carries its own window below. A contour below the
terrain's floor is buried under the flattened surface — set the contour's own
floor to match.

Cost: nothing. Mesh build on a real z4 tile 4.57 ms unwindowed against 4.39 ms
floored; a render at a coastal view 18.72 ms against 17.24 ms (a flat sea gives
longer same-colour runs, so the commit write is cheaper).

### Contour elevation window

A `contour` layer's `levels` resolves against whatever range the mounted
mosaic actually has, and ETOPO1's is roughly -10,900 m to +8,300 m — so a
count-based `levels` spends most of its lines on the abyssal plains and
leaves land with a handful. `minElevation`/`maxElevation` (metres, both
optional, both omitted by default and byte-identical there) are a floor and
a ceiling:

```ts
map.addLayer({ type: "contour", source: reliefProvider, levels: 8, minElevation: 0 });                    // land only
map.addLayer({ type: "contour", source: reliefProvider, levels: { interval: 250 }, maxElevation: 0 });    // bathymetry only
map.addLayer({ type: "contour", source: reliefProvider, levels: 6, minElevation: 0, maxElevation: 2000 }); // the foothills
```

Two numbers rather than a land/sea MODE, doing strictly more — and
sidestepping having to define "land" at all: the Caspian and the Dead Sea sit
below a `0` floor exactly like anywhere else.

Both halves happen, because either alone is a half-fix.

- **Levels are chosen within the window.** A count `N` spreads its lines
  evenly across the window ∩ the mosaic's own range — the part that actually
  fixes the crowding. An explicit array and an `{ interval }`'s absolute
  multiples are CLIPPED instead, never renumbered: an interval's whole point
  is that its lines sit at fixed elevations and do not crawl as you pan, which
  re-deriving them from the window's edges would undo.
- **Ink lands at the level, so the window needs no second gate.** A contour is
  cut as geometry (below), and a marching vertex stands AT its own level by
  construction — so a level inside the window can no longer put ink on terrain
  kilometres outside it. The per-cell scan this replaced could: it read a
  cell's right/down neighbours, so on a sea cliff — one cell at -5,000 m, the
  next at +2,000 m — a 1,000 m level crossed BETWEEN them and inked the ocean
  cell 5 km below the floor. That gate is subsumed, not dropped.

Levels stay computed across the WHOLE mounted mosaic, window included, so
neighbouring tiles can never resolve different level sets and tear at the
seams. An EMPTY window (floor above ceiling, or one the visible field never
enters) renders nothing and is not an error — the layer stays mounted and
starts drawing again as soon as the view brings terrain inside it.
`getContourFieldRange(id)` keeps reporting the field's own DATA range, never
the windowed one: a UI needs the data range to bound its floor/ceiling
controls, and a clipped report would let those controls shrink onto their own
last value and never widen back.

### Contour labels

`labels: true` on a `contour` layer prints the elevation on the lines
themselves. Off by default, and byte-identical to before the option existed
while off — no extra buffer is allocated and no extra pass runs.

```ts
map.addLayer({ type: "contour", source: reliefProvider, levels: { interval: 500 }, labels: true });
map.addLayer({ type: "contour", source: reliefProvider, levels: { interval: 500 }, labels: true, labelEvery: 10 });
```

What it keeps from paper cartography, and what a character grid forces it to
change:

- **Index contours only.** `labelEvery` (default 5, the USGS convention)
  labels every Nth line, not every line. Which lines that picks is anchored to
  ABSOLUTE elevation wherever the level list itself is: with
  `{ interval: 500 }` and the default, the labelled lines are the multiples of
  2,500 m, and they stay so as you pan — exactly as an interval's own lines
  do. `glyphMapContourIndexLevels(levels, step, every)` is that rule, exported.
- **The label breaks its own line.** The number sits in a gap, with the ink
  restored to the terrain glyph underneath it on both sides — ArcGIS's "break
  lines under text", not a number painted over a rule. Only cells this layer
  inked *with this label's own level* are restored, so a different contour
  crossing the label keeps its ink and the relief underneath is never
  punched through.
- **Placement is chosen, not periodic.** A label is only offered where the
  contour runs near-horizontally on screen, stays locally straight across the
  label's own width, sits over terrain for its whole run, and clears the map
  edge. Repetition and crowd control come from the same greedy declutter the
  `symbol` layer uses (`glyphMapDeclutterLabels`, with a padded box).
- **Orientation is dropped, and the convention behind it is kept by
  selection.** A cell is one character: there is no rotated text, so "aligned
  with the line, top of the number uphill" cannot be reproduced. Instead the
  placement gate *selects* for the case where a horizontal label already lies
  along its line. That is ArcGIS's own "Centered horizontal" contour style.
  The tempting inversion — label where the contour is STEEP on screen, so a
  horizontal label crosses it in one cell — is worse: contours are locally
  parallel, so where one runs vertically its neighbours are separated
  horizontally and the label ploughs through every one of them.

Labels inherit the elevation window and the globe horizon from the ink they
are derived from: a level outside `minElevation`/`maxElevation` has no ink and
so no label, and no label (nor any part of one) is placed past the limb.

### Extrusion heights are true metres, and extrusions stand on the terrain

A `fill-extrusion`'s height (`heightProperty` x `heightScale`, or the flat
`height`) is a REAL measured quantity and renders at true scale whatever the
projection's terrain `exaggeration` is. Without the split, a view at `/maps`'
own default `exaggeration: 24` drew a 20 m OSM building 480 m tall.

The GROUND an extrusion stands on is not exempt, and it does not come from the
feature at all: it is the terrain elevation under the footprint, read from the
tiles the mounted `raster` layers actually have up, and it rides the
`exaggeration` exactly like the relief mesh it is standing on. With no `raster`
layer mounted the ground is the datum and nothing extra runs. One ground per
polygon group, sampled at its own mean lon/lat: a structure is rigid, so its
cap stays planar and its walls stay planar quads.

`baseOffsetProperty` (default `min_height`; OpenMapTiles calls it
`render_min_height`) is the other half of what used to be a single absolute
`base`, and it is a STRUCTURE measurement — how far up its own footing the
drawn part starts, in TRUE metres above that ground, with the same exemption
the height has. Feeding `min_height` in as a terrain elevation was the defect:
with a `raster` layer mounted, every extrusion was planted at sea level, and a
60 m building over 400 m of ground drew not one cell.

It shares ONE datum with `heightProperty`: both are measured from the ground,
and the drawn band spans base → height — MapLibre's `fill-extrusion-base` /
`fill-extrusion-height`, and OSM's own `min_height` / `height`, where a
`building:part` tagged `min_height=115, height=277` *is* the piece between
those two elevations. So the two are subtracted, not added, and clamped at
zero for the degenerate rows real data carries. Adding makes a stepped
structure grow rather than stack: the Eiffel Tower is 35 OpenMapTiles parts,
and adding would put its `115 → 277 m` shaft at 115 → 392 m. `heightScale`
scales both.

For a deliberately stylised skyline, scale the metres: `heightScale: 24` means
"24 metres of extrusion per metre of building". There is no separate
extrusion-exaggeration option — it would multiply the same number twice.

The conversion is `glyphMapTrueScaleElevation(metres, projection)`, which is
public: `GlyphMapProjection.exaggeration` is readable precisely so a caller
building its own geometry can put a true-metre quantity onto the projection's
elevation axis. `exaggeration: 0` (relief off) passes metres through, so
terrain and extrusions are flat together, as before.

### Facades and per-feature colour on `fill-extrusion`

```js
map.addLayer({
  type: "fill-extrusion", source: buildings, heightProperty: "render_height",
  color: "#94a3b8", facade: true, colorVariation: 1,
});
```

An untextured flat-roofed box gives ONE Lambert value per face, so at eye level
a block of them is two tones and a wedge and the solid ramp dithers each face
into `=+=+=+=`. `facade: true` textures every WALL with window bays across and
floor bands up, derived from that wall's own length in metres and the feature's
own height — which is what turns that dither into structure. Measured through
the real renderer at 140x63, standing 12 m from a real 81 m Zurich wall:
**+2.2 ms a frame (2.0 → 4.2), mean glyph run length 1.34 → 1.96.** In an
orbit view it costs +0.1–0.2 ms, because there are barely any walls in the
picture — the cost is paid where it buys something.

The tile's levels are a MODULATION and the pier is the identity (255), so a
facade only ever takes light away and an untextured reading is exactly the
layer's own colour. The window sits at 140 for two measured reasons: a texel
multiplies the cell's *intensity*, so a darker one drops wall cells below the
level at which the rasterizer prints anything (the 58 this shipped with
deleted 1,523 wall cells across twenty street-level viewpoints — a facade
punching holes in a building), and the pier/window ratio is also what aliases,
because a 3.6 m bay is under one character cell wide past ~60 m. At 4.3:1 the
facade made a wall *noisier* than no facade at all.

It reads in a MONOCHROME render, which is the point: glyphcss folds a texel's
luminance into the glyph, not only into the colour, so the window rhythm arrives
as characters and does not depend on `useColors`.

There is exactly ONE image — a generated 12x12 tile, 576 bytes, built in plain
JS and handed to the scene through `scene.setTextureSamplers` (never fetched, so
it works under SSR and a test DOM alike). A wall's UVs carry its real
`(bays, floors)` count and `Polygon.textureWrap: "repeat"` tiles the image
across it. Pre-tiling one image per count pair instead needed 101 images and
1.86 MB for the same scene, at the same frame cost.

Pass an object for your own rhythm or your own texture key:
`facade: { texture, bayMetres, floorMetres }` (defaults 3.6 m and 3.2 m). Caps
stay untextured: a roof is edge-on from a street and already reads from above.

`colorVariation` (0..1) nudges each FOOTPRINT's colour deterministically
around `color`, seeded from the feature's own id plus that footprint's own
first ring vertex, so a building keeps its colour across re-tiles, pans and
projection changes. Per footprint rather than per feature because a real OSM
pyramid emits every attribute-identical building as one multipolygon — 50
features carrying 1,991 buildings in one vendored Zurich z14 tile, one of them
carrying 400-odd — so a per-feature seed paints a whole neighbourhood in a
single tone, which is the thing it exists to fix. Three independent channel offsets rather than a
lightness ramp, so neighbours separate across the colour solid instead of
bunching along one line through it. It is a colour, not a second rasterizer
pass, so it is the cheapest separation this layer has.

Both default off and are byte-identical when omitted.

### `fill`/`fill-extrusion` on a curved projection

`glyphMapVectorPolygons` triangulates a polygon in lon/lat with earcut, which
joins boundary vertices tens of degrees apart — and on a globe the flat face
emitted for such a triangle is a CHORD, not the surface. Measured on the
baked Natural Earth pyramid this repo ships: a z1 tile produced a face with a
1.922-radius edge (96% of the sphere's own diameter) whose centroid sat 0.575
of a radius inside the globe, and the z0 tile produced faces whose plane was
tangent at the ANTIPODE — an "outward" normal aimed straight back at the
camera from the far hemisphere. Rendered, that is a straight line drawn
through the world plus far-side geography showing over the near side.

Every face is therefore refined until the projection is locally affine across
it. The test is asked of the PROJECTION, never of a projection id: split an
edge while its projected midpoint misses the projected endpoints' midpoint by
more than 3% of the chord. An affine projection (`glyphMapEquirectangular`)
answers "no split" with an exact zero deviation, so the flat path is
untouched, face for face. The split verdict is a pure function of the edge's
own two endpoints, so two faces sharing an edge always agree and refinement
cannot leave a T-junction. A face whose normal still lands more than 26
degrees off the projection's local "up" after refinement is a degenerate
sliver — three nearly collinear points have an ill-conditioned plane whatever
their spacing — and is dropped: its facing is numerical noise, which is
exactly what leaked far-side ink, and its area is negligible.

Refined cap faces then carry the surface's own outward normal, so the
rasterizer's backface cull removes the far hemisphere for free, with no
view-dependent state. An extrusion's WALLS cannot work that way — a wall is a
vertical curtain whose normal is tangential, so roughly half of a far-side
ring's walls genuinely face the camera through the globe and no winding makes
them back-facing. Only a near-side predicate can answer that, and it is
camera-dependent — so it is applied per rendered frame rather than baked into
the geometry. `glyphMapVectorMesh` is the camera-independent build: it returns
`{ polygons, walls }`, where each entry of `walls` names a wall face's index
into `polygons`, its two ring endpoints in lon/lat, and both the elevations it
spans (`elev` = the feature's base, `elevTop` = base + height), and
`glyphMapVectorCullWalls(mesh, visible)` drops a wall only when NONE of those
four corners is on the visible side. A wall is a quad and is visible if any
part of it is: on a globe a point at height `h` clears the limb from
`acos(r / (r + h))` of extra arc, so a tall extrusion's base can be past the
limb while its top — and most of its wall band — is still in view. That is why
`glyphMapGlobe`'s own `visible` is horizon-aware rather than a plain
centre-plane test; a centre-plane verdict is radially scale-invariant, so
asking about the top elevation alone would return the base's answer.
`glyphMapVectorPolygons` is just that mesh's `polygons`.

The widget (which owns the camera) builds the predicate from
`projection.visible` and re-culls on every camera change, alongside the same
hemisphere check that hides a far-side symbol. Baking the verdict in at build
time instead meant a mesh rebuilt on the widget's 180ms tile debounce — which
every moving frame re-arms — so through a drag and its inertial glide an
extrusion the camera had turned to face drew its roof and none of its sides,
then popped them in once motion stopped. Re-culling is also much cheaper than
rebuilding: on the baked z0 Natural Earth tile (177 countries, 2,058 wall
faces) 0.5ms against 13.7ms.

## Street-level walk mode

`map.setWalk(opts)` drops the camera to eye height and hands it a perspective
lens; `map.setWalk(null)` leaves. It is the one mode that is not a map view,
and it is reachable only through the handle — there is no `GlyphMapOptions`
field for it.

```js
map.setWalk({});                                   // every default
map.setWalk({ far: 900, sky: false, collision: false });
map.getWalk();                                     // GlyphMapWalkState, or null
map.setWalk(null);
```

**It needs an ORBIT projection.** `setWalk` throws a `RangeError` when the
projection declares no `cameraForCenter`/`centerForCamera` — on a flat sheet a
metre of height and a metre of ground are different world units, so eye height
has no meaning. Capability-gated, never `projection.id`.

**It does NOT gate on zoom, and that is the caller's job.** `setWalk` pins
`view.span` to `glyphMapWalkSpan(far)` whatever span it was called at, and
refuses nothing. `GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG` (0.05 deg, ~5.6 km) is the
span walk mode is *meant* to be entered from — it is exported for a consumer to
check, and the website's own walk button is what enforces it. Enter from a
world view and you land on terrain with no street data around you: a blank
walk, not an error.

| Option | Default | Constant |
|---|---|---|
| `eyeHeight` | 1.7 m | `GLYPH_MAP_WALK_EYE_HEIGHT_M` |
| `fov` | 56 deg horizontal | `GLYPH_MAP_WALK_FOV_DEG` |
| `near` | 0.5 m | `GLYPH_MAP_WALK_NEAR_M` |
| `far` | 600 m | `GLYPH_MAP_WALK_FAR_M` |
| `speed` | 6 m/s | `GLYPH_MAP_WALK_SPEED_M_PER_S` |
| `maxPitch` | 84 deg | `GLYPH_MAP_WALK_MAX_PITCH_DEG` |
| `collision` | `true` | — |
| `sky` | `true` | — |

`far` is the local horizon: it bounds the tile footprint, the picture, the wall
cull and the sky dome's own radius. `speed` is deliberately not the ~1.4 m/s
anatomical pace, which is tedious across a 600 m horizon.

`GlyphMapWalkState` is the resolved options plus where the walker is: `center`
(same as `getView().center`), `heading` (same as `getBearing()`), `pitch`
(`getTilt() - 90`, `+` looks up) and `groundElevation` (metres, `0` with no
raster layer mounted).

**Controls.** `W`/`A`/`S`/`D` and the arrow keys move (`GLYPH_MAP_WALK_KEYS` is
the table); held keys accumulate into a normalized axis, so a diagonal is not
`sqrt(2)`x faster. `Shift` held runs at `GLYPH_MAP_WALK_RUN_MULTIPLIER` (3x).
`G` held is GHOST — it bypasses collision for as long as it is down, whatever
the `collision` option says. Mouse look runs under pointer lock, requested on
the first mouse `pointerdown` and released on Esc; a pointer that cannot lock
(touch, or a refused request) gets drag-to-look through the same path. The
wheel is a no-op — zoom is meaningless at eye height. Losing window focus
clears held keys, the run flag and the ghost flag, so a dropped `keyup` cannot
leave the walker sprinting forever. Pitch is clamped to `90 +/- maxPitch`, and
`getMaxTilt()` reports that neck ceiling while walking.

**Collision is wired for you.** The widget maintains the index from the mounted
`fill-extrusion` layers, invalidates it when their tile set changes, and
rebuilds it lazily — only extrusion footprints are ever solid, so `fill`
layers (landuse, water, parks) stay walkable. A blocked step SLIDES along the
wall tangent rather than stopping dead, sub-stepped at no more than one body
radius so a fast step cannot tunnel, and a walker already inside a footprint is
never trapped. With nothing mounted `glyphMapWalkResolveStep` returns the
requested destination VERBATIM (same object identity), which is the
no-buildings byte-identity guarantee.

```js
import {
  glyphMapWalkFootprints,
  createGlyphMapWalkCollisionIndex,
  glyphMapWalkResolveStep,
  GLYPH_MAP_WALK_BODY_RADIUS_M,   // 0.3 m
} from "@glyphcss/maps";

const index = createGlyphMapWalkCollisionIndex(glyphMapWalkFootprints(features));
const next = glyphMapWalkResolveStep({ index, from, to, radiusM: GLYPH_MAP_WALK_BODY_RADIUS_M });
```

**The sky** (`sky.ts`) is a hemisphere of geometry plus a glyphcss appearance
program painting a horizon-to-zenith gradient, quantized to
`GLYPH_MAP_SKY_BANDS` (32) steps over `GLYPH_MAP_SKY_RINGS` x
`GLYPH_MAP_SKY_SEGMENTS` (8 x 48) quads, with a sun disc
(`GLYPH_MAP_SKY_SUN_DISC_DEG` 1.6, glow 11) where a light direction is known.
Three conditions gate the mount: walking, `sky !== false`, and a scene in
`solid` mode — the program's mesh-targeting and `worldPosition` requirements
cannot run in the others, so it is not mounted there at all rather than mounted
inert. `sky: false` mounts no dome and no program: zero extra polygons, not a
hidden one.

Its light direction is the scene's real sun if one is set, else the scene's own
`directionalLight.direction`. A HEADLIGHT is deliberately excluded — a
headlight is a statement about the viewer, not the world, and a sky lit by one
would put the sun wherever the walker happened to look. The dome is re-centred
(rebuilt, not translated) once the walker leaves a slack band around it
(`glyphMapSkyRecentreDistanceM`, 12 m at the default `far`), and rebuilt when
the ground elevation or the scene mode changes.

**Leaving restores everything.** `view`, `tiltRequest`, applied pitch, bearing
and the camera come back verbatim to what entry captured, and the rendered text
is byte-for-byte the pre-walk render; the dome is disposed rather than hidden,
so the polygon count returns to baseline. Calling `setWalk` again while walking
RECONFIGURES in place (no restore, no re-capture); a `setProjection` while
walking LEAVES walk mode instead of blending through it.

## OpenStreetMap (OpenFreeMap) — the shipped path

`glyphMapOpenFreeMapProvider` mounts
<https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf> — public, no API
key, no registration, OpenMapTiles schema, z0-z14 — as a real
`GlyphMapVectorProvider`, so the widget's own tile sweep streams the planet on
demand. This is what `/maps`' OSM card uses.

```js
import {
  createGlyphMap,
  glyphMapEquirectangular,
  glyphMapOpenFreeMapProvider,
  glyphMapOpenMapTilesLayers,
} from "@glyphcss/maps";

const map = createGlyphMap(host, {
  view: { center: [8.54, 47.375], span: 0.06, cols: 140, rows: 63 },   // Zurich
  projection: glyphMapEquirectangular({ exaggeration: 24 }),
  tilt: 55,
});

const osm = glyphMapOpenFreeMapProvider();

for (const layer of glyphMapOpenMapTilesLayers(osm, {
  include: ["omt-water", "omt-roads", "omt-buildings", "omt-places"],
})) {
  map.addLayer(layer);
}
```

Options, all optional: `id` (default `"openfreemap"`), `tileUrl`
(`GLYPH_MAP_OPENFREEMAP_TILE_URL`), `layers` (default: every source layer the
tile carries), `minZoom`/`maxZoom` (`0`/`14`), `tileResolution` (`256`),
`attribution` (`GLYPH_MAP_OPENFREEMAP_ATTRIBUTION`), `fetchTile` (real
`fetch`), and `onError`.

**A tile that 404s, times out, or does not decode resolves EMPTY — it never
rejects.** One rejection would take down the frame's whole `Promise.all`, so a
missing tile is a blank tile and nothing more; `onError` is how you hear about
it. Each mounted layer sweeps on its own, so mounting several rows off one
provider re-requests the same tile per row — wrap `fetchTile` to share
in-flight requests, which is what the website does.

### Web Mercator, through a provider capability

Every pyramid this package bakes is addressed on an EQUAL-ANGLE quadtree;
OpenFreeMap, like every slippy-map service, is WEB MERCATOR. At z12 the Zurich
tile sits at Mercator `y = 1434` and equal-angle `y = 1025`, so a sweep on the
wrong grid enumerates tiles the service does not hold and requests neither of
the two it does.

The fix is a CAPABILITY, exactly as projections do it: a provider may declare
`tileRange` (`GlyphMapTileRangeStrategy`), and `createGlyphMap` keys on that
field's presence — never on a provider id. A provider declaring nothing keeps
this package's `glyphMapEqualAngleTileRange` and is byte-identical.

```js
import { glyphMapMercatorTileRange, glyphMapMercatorZooms } from "@glyphcss/maps";

const provider = {
  id: "my-mvt",
  zooms: glyphMapMercatorZooms(0, 14),   // tileResolution defaults to 256
  tileRange: glyphMapMercatorTileRange,  // the opt-in
  bounds: mercatorBounds,
  loadTile: myLoader,
};
```

`tileResolution` is 256 because that is the pixel size the tiles were
generalized FOR. The MVT extent of 4096 is coordinate precision, not detail —
feed it to the LOD picker and z0 looks like it already resolves street detail,
so the ladder never deepens. `GLYPH_MAP_MERCATOR_MAX_LAT`
(85.0511287798066) is Web Mercator's own latitude limit; above it the strategy
returns an EMPTY range rather than clamping. Volume falls out of that: 1 tile
at a world view, a couple of dozen at a country or city view, capped at the
pyramid's own max zoom rather than requesting z18.

### The OpenMapTiles schema

`vector/openmaptiles.ts` is this package's SECOND schema mapping, and
deliberately not a generalization of the Protomaps one below: the discriminator
is `class` not `kind`, the roads layer is `transportation` not `roads`,
`waterway` is split from `water`, `boundary` carries a NUMBER (`admin_level`)
rather than a kind, the height property is `render_height` not `height`, and
there is no landmass polygon at all. One table covering both would be wrong
about each.

| spec id | layer type | source layer | notable defaults |
|---|---|---|---|
| `omt-landcover` | `fill` | `landcover` | coloured by `class` |
| `omt-landuse` | `fill` | `landuse` | coloured by `class` |
| `omt-water` | `fill` | `water` | `glyphMapOpenMapTilesWaterDrape` — ocean flat, lakes draped |
| `omt-waterways` | `line` | `waterway` | excludes `brunnel: tunnel` |
| `omt-roads` | `line` | `transportation` | excludes tunnels, driveways, parking aisles, indoor |
| `omt-buildings` | `fill-extrusion` | `building` | `render_height`/`render_min_height`, `facade`, `colorVariation` |
| `omt-boundaries` | `line` | `boundary` | international only (`admin_level <= 2`), no maritime or disputed |
| `omt-places` | `symbol` | `place` | `textProperty: name`, `priorityProperty: rank` |
| `omt-peaks` | `symbol` | `mountain_peak` | requires `name`; label is `name` + elevation |
| `omt-pois` | `circle` | `poi` | `rank <= 20`, excludes furniture classes |
| `omt-parks` | `symbol` | `park` | requires `name` |
| `omt-aeroways` | `line` | `aeroway` | |
| `omt-water-labels` | `symbol` | `water_name` | points AND lines |

**Every name in that table was read out of the live service's own TileJSON and
tiles**, vendored at `fixtures/openfreemap/` and re-derived per run by
`vector/openmaptiles.test.ts` — never from the published schema docs.
`housenumber`, `aerodrome_label` and `transportation_name` have no row, and
that is data-driven too: illegible volume, or near-zero real occurrence.

`glyphMapOpenMapTilesLayers(source, opts)` builds them. `opts.include` picks
spec ids IN THAT ORDER (default: all), `classes` narrows a source layer,
`colors` REPLACES a spec's class→colour table rather than layering over it,
`densities` sets a per-spec `density`, and `textAnchors` a per-`symbol`
`textAnchor`. Every spec is always built, even where the current view holds no
data for it — "does this layer have data" is a property of the view, not of a
live provider. The last three rows are APPENDED rather than filed into draw
order, because `/maps` packs this list as a positional bitfield in its URL
state and inserting elsewhere would reinterpret every shared link.

Three helpers read the schema's own discriminators, so a `filter` need not
hardcode property names: `glyphMapOpenMapTilesClass`,
`glyphMapOpenMapTilesAdminLevel`, `glyphMapOpenMapTilesBrunnel`.
`glyphMapOpenMapTilesFeatureFilter` builds a predicate from a spec's own rules.

Attribution (`GLYPH_MAP_OPENFREEMAP_ATTRIBUTION` — OpenStreetMap ODbL,
OpenMapTiles CC-BY 4.0, OpenFreeMap ODbL) rides the provider into
`getAttributions()` like every other credit. OpenFreeMap calls its own line
optional but recommended; it ships anyway. The OpenStreetMap line is not
optional at all.

## PMTiles / MVT vector sources

The other OSM path: a SELF-HOSTED archive or a small vendored extract, rather
than the live service above. Reach for it when you want the data local,
offline, or pinned to one build.

`glyphMapPMTilesProvider(urlOrSource, opts?)` range-reads a self-hosted PMTiles
archive with `pmtiles` and decodes MVT payloads with
`@mapbox/vector-tile` + `pbf`. These focused libraries keep archive indexing,
compression, and protobuf geometry parsing out of this package. It also
reports the archive header's own `extent`, and defaults `attribution` to
`GLYPH_MAP_PROTOMAPS_ATTRIBUTION` (OpenStreetMap + Protomaps, both ODbL) and
`tileResolution` to `4096` — a generic archive reader has no basemap-specific
LOD assumption to make, unlike OpenFreeMap's 256.

Generate a small extract without downloading the planet:

```sh
pmtiles extract https://build.protomaps.com/DATE.pmtiles packages/maps/fixtures/pmtiles/region.pmtiles --bbox=WEST,SOUTH,EAST,NORTH --maxzoom=MAX_ZOOM
```

Full archives and extracts outside `packages/maps/fixtures/pmtiles/` are
gitignored. Review fixture size before committing and keep committed extracts
to a few megabytes total. This uses the downloadable ODbL basemap, not the
hosted Protomaps API.

### The Protomaps basemap schema

`glyphMapPMTilesProvider` reads an archive; `glyphMapProtomapsExtract` turns
one into layers. The basemap's nine source layers are not map layers — `roads`
holds motorways, footpaths and railways together under a `kind` property, and
`water` holds rivers as lines beside lakes as polygons — so the mapping is
`(source layer, kind, geometry) → layer type`, with both discriminators
exposed.

```ts
import {
  glyphMapPMTilesBufferSource,
  glyphMapProtomapsExtract,
  glyphMapProtomapsLayers,
} from "@glyphcss/maps";

const bytes = await (await fetch("/data/osm/zurich-z12.pmtiles")).arrayBuffer();
const extract = await glyphMapProtomapsExtract(glyphMapPMTilesBufferSource(bytes));

extract.bounds;       // the archive header's own bbox — outside it there is no data
extract.kinds.roads;  // ["ferry", "highway", "major_road", "minor_road", "path", "rail"]

for (const layer of glyphMapProtomapsLayers(extract, {
  include: ["osm-roads", "osm-water", "osm-waterway", "osm-buildings"],
  kinds: { roads: ["highway", "major_road"] },   // narrow a source layer by `kind`
})) {
  map.addLayer(layer);
}
map.getAttributions();  // [{ name: "OpenStreetMap contributors", license: "ODbL" }, ...]
```

| spec id | source layer | layer type | selects |
|---|---|---|---|
| `osm-earth` | `earth` | `fill` | polygons |
| `osm-landuse` | `landuse` | `fill` | polygons |
| `osm-water` | `water` | `fill` | polygons (lakes, basins) |
| `osm-waterway` | `water` | `line` | lines (rivers, canals) |
| `osm-roads` | `roads` | `line` | lines |
| `osm-buildings` | `buildings` | `fill-extrusion` | polygons, extruded on `height` |
| `osm-boundaries` | `boundaries` | `line` | lines |
| `osm-places` | `places` | `symbol` | points, labelled by `name` |
| `osm-pois` | `pois` | `circle` | points |

An archive is read as an EXTRACT — one `GlyphMapVectorFeatureCollection` per
source layer, decoded once up front — not mounted as a `GlyphMapVectorProvider`.
PMTiles is Web Mercator addressed while every pyramid `createGlyphMap` sweeps
is equal-angle addressed, and an extract is a handful of tiles at one zoom, so
there is no LOD ladder for a provider to select across. `maxTiles` (default 64)
refuses an archive whose bbox is too large to hold in memory.

Attribution rides on every collection, so mounting an OSM layer credits
OpenStreetMap through `map.getAttributions()` and removing it withdraws the
credit — no page ever hardcodes the string.

### Filtering a layer's features

Every vector-source layer takes `filter`, applied after `sourceLayer`:

```ts
map.addLayer({
  type: "line",
  source: extract.sources.roads,
  filter: (f) => f.properties?.kind === "highway",
});
```

It is a predicate rather than a match spec because a provider-backed source's
tiles arrive after mount, so a caller cannot pre-split them.

## Real-sun lighting

`glyphMapSubsolarPoint(date)` is the pure, clock-free solar position — the
lon/lat where the sun is directly overhead, from NOAA's standard formulation
including the equation of time (worth up to ±16 minutes, i.e. ~±4° of
longitude, so it is not optional). The caller passes the instant; nothing in
this module reads a clock.

`createGlyphMap`'s `sun` option turns that into light:

```ts
const map = createGlyphMap(host, { view, projection, sun: { mode: "realtime" } });
map.setSun({ mode: "manual", date: Date.UTC(2024, 5, 21, 12) });
map.getSunDirection();   // the light's source vector, or null on a sheet
map.getSubsolarPoint();  // where the sun is right now
map.on("sun", (e) => console.log(e.subsolar));
```

- `"off"` (default) — the widget never touches lighting: no light write, no
  timer, no cell hook. Byte-identical to a map built before this existed.
- `"realtime"` — the sun's true current position, re-resolved every
  `GLYPH_MAP_SUN_TICK_MS` (30 s) so the terminator keeps advancing on its own
  at 0.25° of longitude per minute. Snapped immediately when the mode is
  entered; the timer is cleared by `destroy()`.
- `"manual"` — pinned to one instant. No timer.

**Two mechanisms, chosen by projection capability.** An ORBIT projection (the
globe — `cameraForCenter` present) is a real sphere, so the sun is a real
directional light: the widget writes `directionalLight.direction` as the
outward unit vector at the subsolar point and leaves `intensity`/`color`
alone, and Lambert shading draws the terminator. A SHEET projection has one
surface normal everywhere, where a directional light can only dim the whole
map — so it instead gets a per-cell day/night term (`stampGlyphMapNight`)
stamped through the same single `transformCells` hook `line`/`contour` share.
That term darkens colour only, never the glyph, and is therefore invisible
under `useColors: false`.

`GLYPH_MAP_NIGHT_LEVELS` quantizes the sheet terminator's darkness for cost,
not for looks: see its doc for the measured spans/ms table.

## Camera-following key light (`keyLight`)

Turning the sun off does NOT mean "everything lit" — the key light is still a
fixed direction, so a globe keeps a lit half and a dark half that merely stops
tracking the clock. `keyLight: "headlight"` is the mode that actually delivers
it:

```ts
const map = createGlyphMap(host, { view, projection, keyLight: "headlight" });
map.setKeyLight("fixed");        // hand the direction back to the consumer
map.getKeyLightDirection();      // whichever owner is live (sun, headlight), or null
glyphMapHeadlightDirection(rotX, rotY);  // the pure vector, degrees in
```

- `"fixed"` (default) — the widget never writes `directionalLight.direction`.
  Byte-identical to a map built before this existed.
- `"headlight"` — the direction is the camera's own view axis,
  `n = (sin rotX·cos rotY, sin rotX·sin rotY, cos rotX)`, rewritten whenever
  the camera moves. glyphcss's `direction` points from the surface *toward*
  the light, and that is the sign here: the whole visible face is lit, with no
  terminator anywhere, while Lambert still varies per face so **terrain relief
  stays legible**. (Pure ambient also removes the terminator — and flattens
  every face to one shade, which is why it is not what this does.)

Like the sun it writes `direction` only; `intensity`/`color` stay yours. **The
sun outranks it**: with `sun.mode` set to `"realtime"`/`"manual"` on an orbit
projection the sun owns the direction and the headlight waits. Compose your
own key-light write from `getKeyLightDirection()`, not `getSunDirection()` —
the latter is `null` while a headlight is on, so reading it would clobber the
headlight with your own vector.

## Cast shadows

Off unless asked for. `shadow` turns them on; `null` turns them off again.

```js
const map = createGlyphMap(host, { view, projection, shadow: {} });
map.setShadow({ color: "#000000", opacity: 0.35 });  // color/opacity pass through to glyphcss
map.setShadow(null);                                  // off — and byte-identical to never asking
```

**`fill-extrusion` and `model` layers CAST; `raster`, `fill`, `heatmap` and
those same two RECEIVE.** The sets overlap, so a building shadows the building
next to it. Terrain deliberately never casts: the shadow volume is fitted to
the AABB of every caster and a raster layer keeps a global floor tier mounted,
so terrain casting would spread the 256x256 shadow map across the whole Earth.
`lift` defaults to `0` (`GLYPH_MAP_SHADOW_LIFT`) rather than glyphcss's
`0.05`, which in this package's world units is 318 km and erases every shadow;
the self-shadow acne guard is glyphcss's own, derived from the shadow map's
texels rather than from any world length.

**The direction is not an option here.** Shadows fall along the scene's own
`directionalLight.direction` — whatever `getKeyLightDirection()` reports —
so the sun and your own azimuth/elevation slider each cast the shadows they
light. **A camera-following `keyLight: "headlight"` is the one direction that
cannot show a shadow at all**: it points down the view axis, and an
orthographic camera's screen position is the component perpendicular to that
axis, so every shadow lands in its own caster's cells. Turn the headlight off
when you want shadows.

Shadows cross output grids. glyphcss builds one shadow map per frame from
every caster in the SCENE and shares it across the base pass and every detail
pass, so a layer separated into its own `<pre>` by a per-mesh `density`,
`renderMode` or `glyphPalette` casts and receives like any other — raising a
layer's density no longer switches its shadows off. What still cannot receive
is a `line` or `contour`: those are stamped into the cell grid after shading
and keep their flat colour, so a building shadows the ground under it and
never the road beside it. Cost is a flat +2.5 to +3.0 ms per render on `bench/maps-render`
at 140x63 with buildings mounted (the casters receiving as well is inside that
measurement's noise), and shadows stay solid down to roughly 10 degrees of sun
altitude — below that the shadow map's finite resolution dithers the edge.
`docs/design/maps.md` has the measurements.

## Scope

**The static bake.** `GlyphMapField`/`GlyphMapView`/bounds, samplers (named +
callback), classifiers, band→glyph presentation (ramp, water, noData, flat
hillshade), `compileGlyphMap`, the ASCII Grid reader, and the bake-artifact
format (`buildGlyphMapArtifact`).

**Geometry.** `GlyphMapProjection` (equirectangular, Mercator, globe,
orthographic, a d3-raw adapter) with its `visible`/`cameraForCenter`/
`centerForCamera` capabilities, `glyphMapProjectionTransition`,
`GlyphMapGeoTile` and antimeridian splitting, `glyphMapPolygons` (the relief
mesh), and the ETOPO1→geographic-tile bake script.

**The widget.** `createGlyphMap`, `GlyphMapProvider`/`glyphMapTargetLOD`/
`glyphMapDegreesPerCell` (LOD), markers, `project`/`unproject`, `flyTo`/
`fitBounds`/`setProjection`, `tilt`/`bearing` and their one orient gesture,
`groundElevation` and the drape family, real-sun lighting, the
camera-following key light, cast shadows, and street-level walk mode with
collision and a sky dome.

**Layers.** `background`, `raster`, `line`, `contour`, `fill`,
`fill-extrusion`, `symbol`, `circle`, `heatmap`, `model` — over static
TopoJSON collections, MVT/PMTiles archives, or a live vector provider
(OpenFreeMap).

**Not here.** Motion export. A React/Vue surface — nothing forces one yet.
A GDAL-backed source reader (kept out of installs; see "ASCII Grid reader").
