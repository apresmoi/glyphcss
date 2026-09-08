# @glyphcss/maps

Geographic raster data → glyphcss. A deterministic `source → sample →
classify → compile` pipeline that bakes a georeferenced grid (elevation,
land cover, any scalar field) to a static ASCII `<pre>`, with zero runtime.

This is **slices 1, 2, 3, and 5** of the package: the raster core (sampling,
classifying, presenting a flat field), projections and geographic tiles (a
real 3D relief mesh), the interactive widget (`createGlyphMap` — tile
loading with LOD, pan/zoom/orbit, markers, layers, `project`/`unproject`),
and the complete map-layer set over TopoJSON or PMTiles/MVT vector providers
(`fill`, `line`, `symbol`, `circle`, `heatmap`, `fill-extrusion`, `model`,
and `contour`). Projection transitions and day/night are
later slices (see `.plan/MAPS.md` and `AGENTS.md`'s "Maps" section for the
full, current API reference).

Two entry points. The root is pure and browser-safe (no `fs`, no native
modules); `@glyphcss/maps/node` adds filesystem-backed source readers and is
never imported by the root.

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
exported by `glyphcss`), not `compileScene` — this slice has no polygons or
camera to project.

## Everything public speaks lat/lng

`GlyphMapView` is `{ center: [lon, lat], span, cols, rows }` — height is
derived from `span * (rows / cols)` (the aspect lock), so a pan/zoom widget
(a later slice) never shears terrain. `glyphMapBounds({ west, east, south,
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

## ASCII Grid reader

`parseGlyphMapAsciiGrid` (root, pure JS) parses an Esri/Arc-Info ASCII Grid
(`.asc`/`.grd`) already in memory. `loadGlyphMapSource` (`/node`) reads one
from disk, gunzipping a `.gz`-suffixed path automatically. **`gdal-async` is
deliberately not a dependency of this package** — a GDAL-backed reader is
future work behind this same `/node` subpath, kept out of installs the way
`website/scripts/bake-labels.mjs` keeps GDAL out of the website's install.

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
(`(cols + 1) x (rows + 1)`, not slice 1's cell-centered `GlyphMapField`) so
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
`map.addLayer`/`removeLayer`/`moveLayer` mutate an ordered layer list;
`background` sets the scene output's CSS background color, `raster` is the
only geometry-producing layer kind this slice implements (MapLibre's
`fill`/`line`/`contour`/`symbol`/`circle`/`heatmap`/`fill-extrusion`/`model`
vocabulary is slices 5/6's own addition to `GlyphMapLayer`, not typed
speculatively ahead of them).

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
oriented stroke glyphs by construction. `symbol`/`circle` mount DOM hotspots
rather than geometry, so they carry none either.

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
- **Ink is clipped to the window.** No cell whose own elevation is outside it
  inks, even where a level legitimately crosses between it and a neighbour.
  The crossing scan reads a cell's right/down neighbours, so on a sea cliff —
  one cell at -5,000 m, the next at +2,000 m — a 1,000 m level crosses BETWEEN
  them and the ink lands on the ocean cell. Filtering the level list cannot
  catch that; the level is legitimately inside the window.

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

## PMTiles / MVT vector sources

`glyphMapPMTilesProvider(urlOrSource)` range-reads a self-hosted PMTiles
archive with `pmtiles` and decodes MVT payloads with
`@mapbox/vector-tile` + `pbf`. These focused libraries keep archive indexing,
compression, and protobuf geometry parsing out of this package. The provider
adds the required OpenStreetMap/Protomaps ODbL attribution automatically.

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

In slice 1: `GlyphMapField`/`GlyphMapView`/bounds, samplers (named +
callback), classifiers, band→glyph presentation (ramp, water, noData, flat
hillshade), `compileGlyphMap`, the ASCII Grid reader, and the bake-artifact
format (`buildGlyphMapArtifact`).

In slice 2: `GlyphMapProjection` (equirectangular, Mercator, globe,
orthographic, a d3-raw adapter), `GlyphMapGeoTile` and antimeridian
splitting, `glyphMapPolygons` (the relief mesh), and the ETOPO1→geographic-
tile bake script.

In slice 3: `createGlyphMap` (the widget), `GlyphMapProvider`/
`glyphMapTargetLOD`/`glyphMapDegreesPerCell` (LOD), `background`/`raster`
layers, markers, `project`/`unproject`, and `GlyphMapProjection`'s
`visible`/`cameraForCenter`/`centerForCamera` capabilities.

Current vector layers are `fill`, `line`, `symbol`, `circle`, `heatmap`,
`fill-extrusion`, `model`, and `contour`, backed by the same vector-provider
interface for TopoJSON and PMTiles/MVT. Not yet: motion export.
No React/Vue surface — nothing in the plan forces one yet. See
`.plan/MAPS.md` for the full plan.
