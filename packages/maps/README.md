# @glyphcss/maps

Geographic raster data → glyphcss. A deterministic `source → sample →
classify → compile` pipeline that bakes a georeferenced grid (elevation,
land cover, any scalar field) to a static ASCII `<pre>`, with zero runtime.

This is **slice 1** of the package: the raster core (sampling, classifying,
presenting a flat field). There is no camera, no projection, no widget, and no
vector data yet — those are later slices (see `.plan/MAPS.md`).

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

## Scope

In this slice: `GlyphMapField`/`GlyphMapView`/bounds, samplers (named +
callback), classifiers, band→glyph presentation (ramp, water, noData, flat
hillshade), `compileGlyphMap`, the ASCII Grid reader, and the bake-artifact
format (`buildGlyphMapArtifact`).

Not in this slice: projections, cameras, meshes, geographic tiling/LOD,
interactivity, vector data. See `.plan/MAPS.md` for the full plan.
