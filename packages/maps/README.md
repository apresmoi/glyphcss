# @glyphcss/maps

Geographic raster data → glyphcss. A deterministic `source → sample →
classify → compile` pipeline that bakes a georeferenced grid (elevation,
land cover, any scalar field) to a static ASCII `<pre>`, with zero runtime.

This is **slice 1 + 2** of the package: the raster core (sampling,
classifying, presenting a flat field) plus projections and geographic tiles
(a real 3D relief mesh). There is no interactive widget, pan/zoom,
transitions, or vector data yet — those are later slices (see
`.plan/MAPS.md`).

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

## Scope

In slice 1: `GlyphMapField`/`GlyphMapView`/bounds, samplers (named +
callback), classifiers, band→glyph presentation (ramp, water, noData, flat
hillshade), `compileGlyphMap`, the ASCII Grid reader, and the bake-artifact
format (`buildGlyphMapArtifact`).

In slice 2: `GlyphMapProjection` (equirectangular, Mercator, globe,
orthographic, a d3-raw adapter), `GlyphMapGeoTile` and antimeridian
splitting, `glyphMapPolygons` (the relief mesh), and the ETOPO1→geographic-
tile bake script.

Not yet: the interactive widget, LOD/tile providers, pan/zoom, projection
transitions, vector layers (fill/line/symbol/circle/heatmap/contour), and
the website `/maps` page. See `.plan/MAPS.md` for the full plan.
