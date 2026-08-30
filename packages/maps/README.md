# @glyphcss/maps

Geographic raster data → glyphcss. A deterministic `source → sample →
classify → compile` pipeline that bakes a georeferenced grid (elevation,
land cover, any scalar field) to a static ASCII `<pre>`, with zero runtime.

This is **slice 1 + 2 + 3** of the package: the raster core (sampling,
classifying, presenting a flat field), projections and geographic tiles (a
real 3D relief mesh), and the interactive widget (`createGlyphMap` — tile
loading with LOD, pan/zoom/orbit, markers, layers, `project`/`unproject`).
Projection transitions, vector layers, and the website `/maps` page are
later slices (see `.plan/MAPS.md`).

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

A tile whose bounds straddle the antimeridian (`bounds.east > 180`, an
"unwrapped" authoring convention — e.g. `{ west: 170, east: 190 }` for
170°E–170°W) must be split BEFORE projecting, or its quads bridge the whole
map as garbage strips: `splitGlyphMapGeoTileAtAntimeridian(tile)` splits on
a whole-column boundary near the seam — a literal grid slice, never a
resample.

`website/scripts/bake-geo-tiles.mjs` bakes this schema from ETOPO1: `--fixture`
writes the small vendored parity fixture at `fixtures/geo-tile-parity.json`
(a few KB — CI needs no ETOPO1 to run the parity gate); `--tiles` writes the
full z0/z1 pyramid to `website/public/data/geo-tiles/` (gitignored —
regenerable, and at full resolution not small enough to vendor).

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

Not yet: projection transitions, vector layers (fill/line/symbol/circle/
heatmap/contour), day/night, motion export, and the website `/maps` page.
No React/Vue surface — nothing in the plan forces one yet. See
`.plan/MAPS.md` for the full plan.
