# @glyphcss/maps — design notes

> Design notes moved out of `AGENTS.md` (the agent guide keeps the contract and points here).
> Covers every slice of the maps package: the raster pipeline, projections and the chirality gate, relief meshes and LOD tiers, geographic tiles and the curated overlay, the widget (capabilities, tiers, gestures, inertia, flyTo, cover-not-contain, tilt), projection transitions, the render bench, the vector pipeline (fill/extrusion orientation and refinement, strokes and contours, clipping, quantization, curated vector tiles), attribution, point layers, and heatmap relief.
> Cross-references to "above"/"below" that no longer resolve refer to sibling files in `docs/design/`.

`@glyphcss/maps` bakes a georeferenced scalar field (elevation, land cover,
any raster) to a static ASCII `<pre>`, through a deterministic pipeline:

    source → sample → FIELD → classify → bands → compile

Two entry points: the root (`@glyphcss/maps`) is pure and browser-safe;
`@glyphcss/maps/node` adds `fs`-backed source readers and is never imported
by the root. **`gdal-async` is not a dependency of this package** — the
shipped reader (`parseGlyphMapAsciiGrid`/`loadGlyphMapSource`) is a pure-JS
Esri/Arc-Info ASCII Grid parser; a GDAL-backed reader is future work behind
the same `/node` subpath, kept out of installs the way
`website/scripts/bake-labels.mjs` keeps GDAL out of the website's own
install.

Everything public speaks lat/lng, never grid coordinates: `GlyphMapView` is
`{ center: [lon, lat], span, cols, rows }`, with height derived from `span *
(rows/cols)` (the aspect lock) so a pan/zoom view never shears terrain.
`glyphMapBounds({ west, east, south, north, cols, rows })` is a convenience
constructor for the static-bake case — it carries the EXACT requested box on
`.bounds` rather than re-deriving one through the aspect lock, since a
one-shot bake wants the precise window it asked for even when that window's
aspect doesn't match `cols/rows`.

`sampleGlyphMapField(source, view, opts)` is async (forward-compatible with
a future COG/range-read source) and implements the sampler footprint exactly
as frozen: a source pixel belongs to the output cell whose geographic box
contains that pixel's CENTRE, half-open on the north/west edges so no pixel
is counted twice. `GlyphMapSampler` is `"mean" | "max" | "min" | "nearest" |
"majority" | ((samples: Float32Array, cell: GlyphMapCellContext) => number)`
— every named aggregation is undefined on an empty sample set, so a cell
with ZERO landing pixels (the view outresolves the source) falls back to a
separate `upsample: "bilinear" | "nearest"` rule (`"bilinear"` default for
continuous, `"nearest"` default and only legal choice for categorical).
`noData` aggregates over valid samples only; a cell is `noData` only when
ALL its samples are, unless `noData: "strict"` (any invalid sample marks the
cell). A callback sampler opts out of the byte-identity guarantee — a
function has no id, so `glyphMapSamplerId` resolves it to `"custom"`.

`classifyGlyphMapField(field, classifier)` turns a field's continuous values
into a small integer band per cell. A classifier is a value with an id, not
a flag — two quantile-classified fields are never comparable to each other,
even under the same id, because their fitted breaks differ. `GlyphMapField.kind`
(`"continuous" | "categorical"`) gates which classifiers are legal:
`glyphMapQuantile`/`glyphMapLog` (order-statistic classifiers) throw on a
categorical field rather than coercing; `glyphMapBreaks`/`glyphMapEqualInterval`
do not. `GlyphMapClassifiers.etopo1V1` freezes `website/scripts/bake-globe.mjs`'s
former `elevToBand` thresholds as a `glyphMapBreaks` value — that script
imports `GlyphMapClassifiers.etopo1V1.classifyValue` instead of keeping its
own copy, so the thresholds exist exactly once. `GlyphMapBands` retains its
source `field` (not just band indices), because a later slice's relief mesh
builds `z` from elevation values.

`compileGlyphMap(bands, presentation)` returns `{ html: string; css?: string
}`, not a bare string, because the underlying `encodeStaticGlyphHtml`
separates them in its smallest (class-based) mode. The pure path is
`encodeGlyphBuffers` → `encodeStaticGlyphHtml` (both exported by
`glyphcss`), **not** `compileScene` — this slice has no polygons or camera
to project. `GlyphMapPresentation.hillshade` is a flat-path-only raster-space
slope-difference shade (Horn's algorithm over grid-relative central
differences, `zFactor` absorbing the degree-vs-real-distance mismatch a
geographic grid has no fixed conversion for) — under a relief mesh (a later
slice) glyphcss's own Lambert shading IS the hillshade, and running both
would double-light the map.

`buildGlyphMapArtifact(bands, { source, sampler })` is the single-artifact
bake format a geographic tile (a later slice) is an instance of: bounds,
grid, bands, and the `source`/`classifier`/`sampler` ids a re-bake needs, so
a legitimate source upgrade (ETOPO1 2009 → ETOPO 2022) never silently reads
as drift. `source`/`sampler` aren't threaded through `GlyphMapField`/
`GlyphMapBands` themselves — the caller already knows both (it chose them)
— so the artifact builder takes them explicitly.

**Projections (slice 2).** `GlyphMapProjection` is a vertex transform —
`{ id, project(lon, lat, elev): Vec3, unproject(p): [lon, lat], domain }` —
so a flat map and a globe are one geometry under two functions. Units are
DEGREES in (repo convention — see "Numeric conventions"), not d3's radians;
`glyphMapFromD3Raw` converts. `project` returns `[NaN, NaN, NaN]` outside a
projection's valid window (Mercator past `±maxLat`, orthographic on the far
hemisphere) — "crop, don't clamp": a clamped pole collapses a row of
vertices onto one point, which a mesh builder would still draw as a
zero-area boundary edge. `domain` is a coarse lon/lat bounding box for tile
culling, an over-approximation for orthographic (a spherical cap, not a
box) — `project()` itself is the authoritative per-point check. Every
projection treats elevation the same way: `z = (elev /
GLYPH_MAP_EARTH_RADIUS_M) * exaggeration`, so `exaggeration: 1` is
true-scale relief everywhere, globe included. `glyphMapEquirectangular`,
`glyphMapMercator`, and `glyphMapOrthographic` share one world frame — `X` =
north/south (increasing north), `Y` = east/west (increasing east) — and
`glyphMapFromD3Raw` swaps a raw `(x, y)` into that same `(Y, X)` order (d3's
own convention is the opposite: `x` tracks longitude, `y` tracks latitude).
`glyphMapGlobe({ radius, exaggeration })` is a genuine 3D sphere mesh (every
`(lon, lat)` is valid, unlike the flat projections): `X = r·cosLat·cos(lon)`,
`Y = r·cosLat·sin(lon)` (increasing EAST), `Z = r·sinLat` (increasing
north) — the textbook right-handed spherical-to-Cartesian map, pinned and
tested by a CHIRALITY gate anchored outside this package's own math
(`packages/maps/src/chirality.test.ts`, using `glyphcss`'s real
`createGlyphOrthographicCamera`): camera `rotY: 0` (which, by
`glyphcss`'s own rotation order, forces screen `col` to depend on world `Y`
alone, for ANY `rotX`) facing Greenwich with north up ⇒ 30°E must project to
a GREATER `col` than 0°E, and 30°N to a LESSER `row` than 0°N.

**This chirality gate FAILS for `website/scripts/bake-globe.mjs`'s own
`latLonToXYZ`, which negates `Y`.** That negation is a pre-existing,
isolated defect (`bake-globe.mjs`'s own flat-map path, `flatToPlane`, maps
longitude UN-negated in the same file — only the sphere formula has this
sign), so `/examples/world`'s globe is mirrored east-west relative to true
Earth geography. `glyphMapGlobe` ships the chirality-correct (un-negated)
convention, NOT `bake-globe.mjs`'s; `packages/maps/src/parity.test.ts`
proves the resulting deviation from `bake-globe.mjs`'s checked-in
`website/public/data/tiles/` is an EXACT, whole-value `Y` sign flip (`X`/`Z`
agree to ~5e-6, the reference JSON's own 5-sig-fig truncation; a literal
(non-negated) `Y` comparison differs by ~1.0) and documents this in place
rather than silently matching a mirrored reference. Fixing `bake-globe.mjs`
itself is a separate, not-yet-scheduled change — this package does not
depend on it, and `glyphMapPolygons`'s own quad winding (`[nw, sw, se, ne]`,
the reverse of `bake-globe.mjs`'s `[a, b, c, d]`) is correct for the
convention `glyphMapGlobe` actually ships.

`glyphMapPolygons(tile, projection, opts?)` is the relief mesh: one quad per
`GlyphMapGeoTile` cell (see below), corners projected through
`projection`, skipped whole when any corner is outside the projection's
valid window (never clamped). It takes a `GlyphMapGeoTile`, not slice 1's
cell-centered `GlyphMapBands` — a relief mesh needs a value at every QUAD
CORNER for adjacent quads to share an edge with no seam, which a
cell-centered field cannot provide without inventing an interpolation rule
`bake-globe.mjs` itself doesn't use.

**Mesh resolution.** `opts.resolution` (`{ cols, rows }`, optional; omitted
= the tile's own `cols`/`rows`, byte-identical to the option not existing)
emits a COARSER quad grid than the baked tile carries. It exists because the
pyramid ships ONE tile shape at every zoom (180x90 quads, `website/public/
data/geo-tiles/manifest.json`) regardless of how much output grid a tile
covers, so a settled view mounted ~15 tiles x 16,200 quads = ~243,000 quads
to fill a 160x64 = 10,240-cell grid — geometry an ASCII renderer cannot
show. Output grid line `i` samples source vertex `round(i * total / count)`;
that mapping is exactly the identity at `count === total` (the byte-identity
guarantee), lands its first and last entries exactly on `0`/`total` for ANY
count (so a coarsened tile's outer ring stays precisely on the tile
boundary), and is strictly increasing for `count <= total` (never
upsamples — a request larger than the tile clamps to the tile's own grid
rather than inventing vertices). It is a target COUNT, not a stride,
deliberately: a stride must divide the grid evenly or the last row/column
falls short of the tile's own edge, and 180/90 share only divisors of 90 —
too coarse a ladder to express the ~1.5-1.75x over-resolution the LOD's own
2x level steps actually leave. "Crop, don't clamp", the per-quad
`localUpDirection` winding probe, and the 4-corner average feeding
`opts.color` are all recomputed from the COARSE quad's own corners.
Elevation is POINT-sampled at the retained vertices, never aggregated
(mean/max) over the skipped block: an aggregate would need a symmetric
window that reaches outside the tile exactly on the boundary ring where
crack-freedom is decided, and a tile holds only its own samples. The cost is
peak fidelity — a lone summit between retained vertices is dropped rather
than averaged in.

**No cracks: resolution is resolved per pyramid LEVEL, never per tile.**
Because the index sequence depends only on `(total, count)`, two tiles at
the same level built at the same resolution sample the IDENTICAL source
vertices along their shared edge — exact vertex sharing, not an
approximation. A per-TILE resolution (tempting, since a tile near the
globe's limb is genuinely more foreshortened and cheaper to resolve) would
let neighbours disagree and open a T-junction crack along the whole shared
edge — a visible tear at the map's relief exaggeration, not a hairline.
`widget.ts`'s `reliefFractionForLevel` therefore resolves one fraction per
level, quantized to eighths of the baked grid (rebuilding a tier costs
~0.24us/quad measured, so a continuously-tracked resolution would rebuild
every mounted tile on essentially every settled zoom step); a fraction
change rebuilds that tier's already-mounted tiles synchronously, since a
level holding two resolutions at once is the same crack. An antimeridian
split applies the fraction PER PART, so both halves keep the tile's own
`rows` and the seam edge stays exactly shared.

**Per-tier policy** (`createGlyphMap`, raster runtime). The target-LOD tier
is built at the coarsest rung still resolving one quad per glyph cell — it
is the visible surface, so it is never coarser than that. The FALLBACK tier
(`GLYPH_MAP_RELIEF_FALLBACK_COARSEN = 2`, 4x fewer quads) exists only to be
glimpsed between a zoom settling and the fine tier's fetch landing, and is
evicted the instant the fine set mounts. The permanent FLOOR tier is capped
to `GLYPH_MAP_RELIEF_FLOOR_BACKSTOP_COLS = 32` quads per axis whenever it is
NOT itself the target LOD. When the floor IS the target LOD (zoomed out past
the pyramid's shallowest level) the cap does not apply. **This fixed a real
visual defect, not only cost**: measured
at span 2 over the curated Swiss z7 level, the full-resolution z0 floor was
winning 4,147 of 10,240 output cells — 40% of the viewport painted by 2°-
resolution global backstop terrain instead of the 0.0156° curated tiles —
and the depth-test early-outs that came with it were also hiding the true
render cost. With the cap, the floor wins 0 cells there. Measured on the
real baked pyramid at 160x64 (globe, exaggeration 20): span 140 world view
243,000 → 89,104 quads and 82.0 → 52.1 ms/render; span 30 210,600 →
110,672 and 64.5 → 50.9 ms; span 2 (Switzerland) 81,000 → 65,312 and 37.5
→ 91.2 ms — that last one is the correctness fix showing up as cost, since
the like-for-like comparison with the floor removed from BOTH arms is 88.0
vs 90.4 ms. The remaining waste at deep zoom is intrinsic tile granularity
(4 curated tiles overhang a 2°x0.8° viewport, so only 19,252 of 65,312
quads reach the screen); cutting it needs sub-tile culling, which is
view-dependent geometry and not attempted here. `decimatePolygons`
(`@glyphcss/core`) is the wrong tool for this job and is deliberately not
used: it clusters an arbitrary polygon soup against a per-mesh bounding-box
lattice, so it must build the full 16,200-quad list first (the projection
pass is the cost), it drops and dedupes polygons (destroying the per-quad
color), and its lattice is derived per mesh — two adjacent tiles would snap
their shared edge differently, which is precisely the crack this design
exists to avoid.

**A backstop tier must be BEHIND, not merely finer**
(`GLYPH_MAP_RELIEF_BACKSTOP_SINK_M = 20_000`, via `glyphMapPolygons`'
`elevationBias`). Capping the floor's resolution is a cost control; it does
not settle which tier a cell shows, because all three are opaque meshes in
ONE glyphcss scene and that is decided by the shared per-cell depth buffer
(`occlusionPriority` orders LAYERS — separate `<pre>`s — not meshes inside
the base grid). A coarse tier is not a blurrier version of the fine one: its
quads interpolate LINEARLY between vertices up to ~11° apart, so a quad
straddling a coast runs from the sea floor up to the summit and, over the
ocean half of that span, sits kilometres ABOVE the fine tier's own sea floor.
It wins those cells and paints them in its quad's colour — the majority of a
block that is mostly land. Reported live as "the sea is basically GREEN" on
`/maps` over the Peru–Chile trench and measured through the real widget at
486 of 4,462 sea cells in a land band, against 16 for the target tier
rendered alone. Sinking every non-target tier along the projection's own
elevation axis makes the depth test agree with the tier ladder: at that view,
and at spans 33/140 and tilt 0/40, the combined render then matches the
target tier alone cell for cell. Three things this is NOT: (a) a resolution
problem — the floor still stole 231 cells at its finest possible 2° quads;
(b) a colour-rule problem — no single colour per 11° quad is right, so
`corner-mean` merely trades sea-painted-as-land (486 → 14) for
land-painted-as-sea (52 → 101, and 1,377 for the floor alone), which is the
Andes/Bogotá defect the median was introduced to fix; (c) a tuning — 20,000 m
exceeds Earth's entire solid-surface relief (~19,784 m), which bounds how far
any coarse chord can rise above a finer sample of the same field, and it is
in METRES so a projection scales it by the same `exaggeration` it scales the
relief it must clear. Cost: in a genuine hole (fast pan into unfetched tiles,
or first paint) the backstop shows sunk — ~7.5% of the globe's radius at
`/maps`' exaggeration of 24 — a transient loading state in place of a
permanent steady-state artifact. Every backstop tier takes the SAME sink, so
their positions relative to each other are unchanged and no new z-fighting is
introduced. Gate: `widget.backstopOcclusion.test.ts`.

**Geographic tiles (slice 2's headline decision).** `GlyphMapGeoTile` —
`{ bounds, cols, rows, elevation, source, sampler }` — carries lon/lat/
elevation; the elevation grid is VERTEX-centered, `(cols + 1) x (rows + 1)`,
matching `bake-globe.mjs`'s own per-vertex sampling loop exactly
(`glyphMapGeoTileVertexLonLat`'s formula is that same loop, load-bearing for
the parity gate above). Projection is applied CLIENT-SIDE — this is what
lets one tile pyramid serve every projection, unlike both existing bakers
(`bake-globe.mjs`, `bakeFlatTile`), which pre-project. A tile whose bounds
straddle the antimeridian (`bounds.east > 180`, an "unwrapped" authoring
convention) is split with `splitGlyphMapGeoTileAtAntimeridian` BEFORE
projecting — a single mesh built across the seam would bridge the whole map
as garbage strips; the split is a literal grid slice on a whole-column
boundary, never a resample. `website/scripts/bake-geo-tiles.mjs` bakes this
schema from ETOPO1 (`--fixture` for the small vendored parity fixture at
`packages/maps/fixtures/geo-tile-parity.json`, unchanged plain JSON; the
default/`--tiles` mode for the full z0-z4 GLOBAL pyramid — 341 tiles, 11.2
MB on disk — at `website/public/data/geo-tiles/`, gitignored — regenerable,
and not small enough to vendor, unlike the fixture). Pyramid tiles are baked
as `{z}/{x}_{y}.bin` — a raw little-endian int16 payload (ETOPO1's own
elevation values are whole metres in `[-10898, 8271]`, well inside int16
range, so this is lossless), not JSON; `manifest.json` carries `format:
"int16"` plus `version: 2`, and the reader genuinely gates on BOTH (not
`format` alone) since a manifest's SCHEMA can change independent of the tile
payload encoding. `glyphMapDecodeGeoTileInt16(bytes, meta)` (pure,
browser-safe, exported from the root `@glyphcss/maps` entry point) decodes
one tile's raw bytes plus the shape/provenance metadata the manifest already
carries into a `GlyphMapGeoTile`, throwing a descriptive `RangeError` naming
expected vs. actual sample count on a length mismatch (or, for a byte length
that isn't a whole number of int16 samples, saying so instead of printing a
fractional sample count). `website/src/lib/geoTilesProvider.ts` is the
reference reader: it requires `manifest.format === "int16"` AND
`manifest.version === 2` and has no JSON fallback path.

**Curated raster overlay.** Past z4 the global pyramid would cost tens to
hundreds of MB per level (measured from the real 32,942 bytes/tile and 4^z
tiles/level: z5 ~33.7 MB, z6 ~134.9 MB, z7 ~539.7 MB as int16 — a prior
unmeasured "z5 ~90 MB, z6 ~360 MB" claim here was wrong) — `packages/maps/
src/curated.ts`'s `glyphMapCuratedProvider(base, curated)` is the raster
mirror of the vector curated provider below: it wraps a base `GlyphMapProvider`
with one or more DEEPER zoom levels that have REAL tiles only inside a
curated place's own bounds, degrading every other tile at those depths to
the deepest ancestor that actually exists (another, shallower curated level,
or the base pyramid's own max zoom) — never blank, never a throw. It differs
from the vector version in three ways raster's own shape forces: it accepts
MULTIPLE curated depths (not one); a second curated PLACE can share a depth
an existing place already occupies — entries are grouped by `zoom.z` and
their real-tile key sets unioned into one zoom record (`zoom.bounds` itself
is always set to `undefined` on the exposed record regardless — see the next
paragraph), rather than a later same-depth entry silently overwriting an
earlier one; and each `GlyphMapCuratedRasterTiles` level carries only the
SET of real `"x_y"` tile keys plus its own async `loadTile(x, y)` — a raster
curated tile is a `.bin` payload fetched over HTTP, not something already
held in memory the way the vector wrapper's `ReadonlyMap` assumes.
Curated-depth `bounds(z, x, y)` reuses `glyphMapVectorTileBounds` directly
rather than a fourth hand-rolled copy of the shared equal-angle formula —
confirmed identical to the raster addressing every level here already uses.
`curated.length === 0` returns `base` UNCHANGED, not a wrapper that merely
behaves like one — `base.bounds` still throws at an undeclared depth exactly
as it would with no overlay at all, so `geoTilesProvider.ts` can wrap its
base provider in `glyphMapCuratedProvider` unconditionally and still have
exactly one reader code path. `provider.zooms` is always returned sorted by
`z`, regardless of the order `curated` entries were passed in.
`website/scripts/bake-geo-tiles.mjs`'s `--tiles` mode bakes z5-z7 for
Switzerland (the same curated place `bake-vector-tiles.mjs` uses, same
bounds) into `website/public/data/geo-tiles/curated/{z}/{x}_{y}.bin`,
recording one `manifest.curated` entry per level (`{ name, zoom, bounds,
tiles }`) rather than a second manifest file; `geoTilesProvider.ts` folds
that entry's own `bounds` into the `GlyphMapProviderZoomLevel` it hands to
`glyphMapCuratedProvider` (see the next paragraph).

**Tile-sweep culling scopes to the VIEW's own window, not a level's declared
`bounds`, and ancestor degradation dedupes.** A curated raster level
deliberately leaves `GlyphMapProviderZoomLevel.bounds` `undefined` (the
previous paragraph, `curated.ts` — its effective coverage is global because
a miss degrades to an ancestor tile, so narrowing `bounds` to the curated
place's own footprint would make the sweep outside that footprint find
nothing). A tile-sweep restriction keyed on `level.bounds` therefore
degenerates to enumerating a curated level's ENTIRE `cols x rows` grid —
measured 16,383 raw candidates at a real z7 (128x128) level — which is what
`createGlyphMap`'s raster/vector/feature tile-sweep loops actually did before
this was fixed (an earlier draft of this doc claimed `bounds`-based
restriction already handled this; it did not, because `bounds` is
unconditionally cleared here). The fix: each sweep now computes its
candidate x/y range from the VIEW's own geographic window (center ± half
`view.span`, generously padded by the level's own tile size and `padCells`)
via `candidateTileRange`, which works identically whether or not a provider
declares `bounds` at all — a curated level included — and makes `bounds`
unnecessary for this purpose at any depth. Each sweep also computes its
`ProjectionGrid` (host/output `getBoundingClientRect()`) ONCE before the
loop and threads it into every `isBoundsVisible` call, instead of one fresh
`projectionGrid()` call per candidate — at the pre-fix full z7 sweep that
alone was 32,766 layout reads. `isBoundsVisible` remains the exact per-tile
visibility authority; a generous or even a wrong candidate window only costs
a slower sweep, never a missing tile. Separately, `GlyphMapProvider.
resolveTile?(z, x, y)` is an optional capability a degrading provider
implements to report, without fetching, what `loadTile(z, x, y)` will
actually return — `createGlyphMap`'s raster tile-diff loop keys its
cache/mount set by this resolved identity instead of the requested address,
so two sibling requests that both miss curated coverage and degrade to the
SAME ancestor tile fetch and mount that ancestor once, not once per sibling
(measured: at a partially-curated depth, two of the four sweep-visible tiles
could otherwise resolve to the same z4 ancestor and mount its ~16,200-polygon
mesh twice, at identical world bounds, for zero visual difference).
`glyphMapCuratedProvider` implements `resolveTile` (never `zoom.bounds`,
which it always clears — see above); a plain provider implements neither
and the widget falls back to the pre-existing full-sweep, no-dedupe
behaviour for it.

**`isBoundsVisible`'s complement case reads the VIEWPORT's own unprojected
samples, never `view.center`.** The projected 3x3 sample grid over a tile's
own bounds only proves a tile visible when one of ITS samples lands on
screen, which misses the opposite containment case — a small, zoomed-in
viewport sitting entirely inside a much LARGER tile. That complement used to
be "does the tile contain a SINGLE point", and one point is never enough: a
22.5-degree tile against a 3-degree viewport straddles it whenever that point
lands within a viewport-width of a tile edge, and Switzerland sits 0.8 degrees
from its own curated tile's south edge. (When this was found, the single point
was `view.center`, and it was doubly wrong: `tilt` then swung the camera about
the globe's CENTRE, so `view.center` was 40 degrees of latitude from the point
actually on screen. That displacement is gone — `tilt` pitches about the
surface point under `view.center` now, "Camera tilt" below — but the straddle
is not, and it is what these samples exist for. A pitch also makes the visible
window ASYMMETRIC, reaching much further toward the horizon than away from it,
so no box centred on `view.center` describes it either.)

Reported as "the border layer disappears at z > 6", and it bit exactly where
one pyramid stops deepening while the view keeps shrinking. The borders
pyramid tops out at its curated z4 (22.5x11.25-degree tiles) while terrain
continues to a curated z7, so `glyphMapTargetLOD` correctly pinned borders at
z4 and, past terrain's z6, no z4 tile had a sample of its OWN on screen
either — the complement then rescued a tile nobody could see and dropped the
tile the viewport was actually showing. Measured on the real baked pyramids at
`tilt: 40` / 160x64 (screen centre on Switzerland, terrain at z7): the border
sweep's only desired tile was `4/8_0`, and border ink was 0 at spans 3, 1.5
and 0.8.
Terrain never showed the symptom because its curated z5/z6/z7 tiles are small
enough that their own samples do land on screen, which is why the threshold
tracked the RASTER LOD readout the user was reading.

`viewportGeoSamples(padCells, grid)` is the fix: a 3x3 screen sample grid
over the padded viewport, unprojected once per sweep through the same
`unprojectSphere`/`sheetUnprojector` inverse `map.unproject()` uses, hoisted
and threaded exactly like `grid`. A tile containing one of those points
covers a point that is genuinely on screen, so accepting it is a true
positive by construction — not the over-approximation `candidateTileRange`'s
min/max box deliberately is, which is why the box could not be reused here (it
would accept the whole candidate range and mount up to 49 tiles per level). Nine points suffice because the two tests are
complementary — any tile small enough to slip between the viewport samples has
its own 3x3 samples land on screen. Nothing unprojecting (a
`setProjection` blend, whose `unproject` throws by design; a degenerate camera
basis; a viewport wholly off the globe) falls back to `[view.center]`, the
exact pre-existing behaviour, never an empty set. Sheet projections are
affected too and for the same reason — a huge tile straddling the viewport but
not containing its centre was dropped there as well. After the fix, same real-data fixture: 502 / 195 / 90
ink cells at spans 3 / 1.5 / 0.8, and the off-screen polar tile is no longer
fetched at ANY zoom (it was being fetched and mounted at spans 40, 12 and 6
too). Gate: `widget.tiltedTileCulling.test.ts`, which asserts both the
mechanism (the sweep requests the tile the viewport shows) and the symptom
(non-zero ink, in the row band the border actually crosses) at views resolving
terrain z5, z6 and z7.

`glyphMapFromD3Raw(raw, opts?)` adapts any `d3-geo-projection` raw
projection — `(lambda, phi) → [x, y]` in radians, with an optional
`.invert(x, y) → [lambda, phi]` (two SCALAR args, d3's own convention, not a
tuple) — into a `GlyphMapProjection`. `d3-geo-projection` is a devDependency
of `@glyphcss/maps` ONLY; the adapter never imports the module, so it never
becomes a runtime dependency.

**The widget (slice 3).** `createGlyphMap(host, opts)` is the interactive
widget replacing `website/src/pages/examples/world.astro` and
`flatmap.astro`'s own hand-rolled, near-duplicate scene wiring: tile cache,
active-handle diff, in-flight guard, fetch debounce, greedy label declutter,
and the "capture on host, not `e.target`" pointer-capture workaround are
absorbed once. It owns one `createGlyphScene` (`map.scene` is the escape
hatch for anything not modeled on the widget surface — effects, shadows,
`colorEncoding: "atlas"`, hotspots all compose for free) and returns
`setView`/`getView`/`fitBounds`, `project`/`unproject`, `addLayer`/
`removeLayer`/`moveLayer`, `addMarker`, `getMaxSpan`, `on`/`off`
(`"click"`/`"move"`/`"zoom"`/`"load"`), `resize`, and `destroy`. `GlyphMapView.cols`/`rows` are
the authoritative grid shape (`opts.autoSize: true` opts back into
host-pixel-driven `cols`/`rows`, both pages' own default; the widget default
is `false`) — `view.span` (degrees), not `camera.zoom`, is the public zoom
knob, converted internally via the chord length `projection.project`
reports between the view's centre and its half-span edge, and bounded by
`getMaxSpan()` (see "Cover, not contain" below).

**Every projection/gesture/culling difference lives on `GlyphMapProjection`
as a capability, never as an `if (projection is globe)` branch inside the
widget** (MAPS.md §7's "the interface must carry more than `project`," §13
slice 3's "stop, this reproduces two branches" instruction). Two OPTIONAL
members, both present ONLY on `glyphMapGlobe`:

- `visible?(world: Vec3, depthOf: (world: Vec3) => number): boolean` — a
  near/far-hemisphere test. Every flat projection already excludes an
  invisible point through `project()` returning `NaN`; the globe is
  different because EVERY `(lon, lat)` is a geometrically valid point on the
  sphere, front or back, so `project()` alone can't tell the widget which
  half faces the camera. `depthOf` is the caller's own
  `camera.project(...)[2]` (larger = nearer — `rasterize.ts`'s convention,
  verified directly against `fillDepthTri` and
  `createGlyphOrthographicCamera`'s own `project()`). A point AT THE DATUM is
  near-side when it is at least as near as `depthOf(project(anchor))` for the
  projection's own centre/anchor — comparing against that reference rather
  than a fixed sign keeps this correct under ANY camera orientation. That
  centre-plane comparison is NOT the whole test, because it is radially
  scale-invariant (the camera's depth functional is linear and homogeneous in
  world X/Y/Z, so raising a point along its own radius scales its depth and
  never flips the verdict) and a RAISED point genuinely clears the limb from
  `acos(r / (r + h))` of extra arc — the ship's-mast-before-the-hull effect.
  A point behind the centre plane is therefore still visible when its distance
  from the camera's view axis exceeds the sphere's own radius: exact under the
  orthographic camera `createGlyphMap` builds, where the silhouette is a
  CYLINDER of radius `r` about the view axis rather than a cone, and byte-
  identical to the old rule for every datum-level caller (tile culling,
  stroke clipping, `unproject`, a default-elevation marker), since a point at
  the datum has `|world| === radius` exactly. ONE
  sample-point test (`createGlyphMap`'s `isBoundsVisible`, 9 lon/lat samples
  per bounds box, plus 9 unprojected VIEWPORT samples for the "viewport
  inside one huge tile" complement — see "`isBoundsVisible`'s complement
  case" above) drives BOTH provider tile culling and
  `map.project(...).visible`/marker hiding — not a plane-AABB test for one
  projection and a great-circle test for another.
- `cameraForCenter(lon, lat): { rotX, rotY }` / `centerForCamera(rotX,
  rotY): [lon, lat]` — present only on a projection whose geometry is fixed
  once in world space and navigated by ORBITING the camera around it (a
  flat sheet centers a view by setting `camera.target = project(lon, lat,
  0)` directly, which needs no projection-specific support at all). The
  widget checks for these methods' PRESENCE to pick orbit-drag over
  pan-with-domain-clamp drag — never a branch on `projection.id`. Both are
  EXACT closed-form inverses of `createGlyphOrthographicCamera`'s own
  rotation math, not a search: the camera's depth of a point on the sphere
  is LINEAR in `(X, Y, Z)`, so the point that maximizes it (the sub-observer
  point the camera is centered on) is exactly that linear functional's
  gradient direction — solving `n = (sinRotX·cosRotY, sinRotX·sinRotY,
  cosRotX) = (cosLat·cosLon, cosLat·sinLon, sinLat)` gives `rotX = 90 -
  lat`, `rotY = lon` exactly, verified against `chirality.test.ts`'s
  independently-authored camera fixture.

**Two bugs fixed rather than ported**, both in `world.astro`:
`findFocalLatLon` (`:182-232`) scans lat/lon for MINIMUM projected depth as
the near-hemisphere focal point, and `:366` treats `depth < 0` as
front-facing — but the renderer's convention is **larger depth = nearer**,
so that scan resolves the ANTIPODE of the true focal point, masked in
practice by hemispheric z0/z1 tile coverage plus a failsafe tile. Neither
`glyphMapGlobe`'s closed-form `visible`/`cameraForCenter`/`centerForCamera`
nor `createGlyphMap` reproduce any scan. Separately, both pages
(`world.astro:91`, `flatmap.astro:235`) keyed LOD on absolute `camera.zoom`,
which only worked because both pages' world scale happened to be ≈ 1 unit ≈
hemisphere — a projection with a different native scale breaks that link.
`GlyphMapProvider` (`{ id, zooms, bounds(z,x,y), loadTile(z,x,y) }`) +
`glyphMapTargetLOD(provider, degPerCell)` key LOD on
`glyphMapDegreesPerCell(view)` (`view.span / view.cols`) instead — ground
units per glyph cell, geographic by construction, so two projections with
wildly different native scales (a `radius: 1` globe and a `radius: 100`
one) select the identical LOD for the identical view.

A raster layer's `source` is either a single already-loaded
`GlyphMapGeoTile` (mounted once via `glyphMapPolygons`) or a
`GlyphMapProvider` — the widget owns the tile cache, active-set diff,
in-flight guard, and ~180ms fetch debounce (absorbed from both pages) so a
provider implementation stays dumb: manifest + fetch. `GlyphMapLayer` is
`GlyphMapBackgroundLayer | GlyphMapRasterLayer` — slice-3-scoped
deliberately; MapLibre's `fill`/`line`/`contour`/`symbol`/`circle`/
`heatmap`/`fill-extrusion`/`model` vocabulary (MAPS.md §14) is slices 5/6's
own addition to this union, not typed speculatively ahead of them. A
`background` layer sets the scene output's CSS `background-color` (the
topmost mounted `background` layer wins) rather than emitting geometry — the
ASCII-render equivalent of "the empty-cell page/`<pre>` background shows
through" already documented under `charMode: "quadrant"` above.
`addMarker({ at: [lon, lat], label?, elevation? })` lifts along
`projection.project`'s own `elev` axis — the SAME mechanism
`glyphMapPolygons` uses to lift relief (world Z for a flat sheet,
sphere-radial for the globe) — so no separate label-anchoring concept was
needed; default `elevation: 0` places a marker exactly at its geographic
point (Leaflet's convention).

**Never a blank/black hole while panning or zooming.** A provider-backed
raster layer keeps THREE tiers of mounted geometry, not one. `activeHandles`
is the target-LOD "desired" set, unchanged from before. `fallbackHandles` is
the CURRENT view's own tiles at the nearest AVAILABLE zoom level strictly
coarser than the target LOD, mounted from cache immediately (zero-latency
for the common "you just zoomed in/out from here" case — its own fetch, if
one is needed, is awaited and mounted as its OWN phase, BEFORE the fine
tier's fetch even starts, so a slow/stuck fine fetch — a genuinely new
region's own tile, the case this whole mechanism exists for — can never
hold up an already-arrived fallback tile too) and evicted the instant the
fine `desired` set finishes mounting for that update (a still-missing fine
tile — a rejected fetch — keeps its fallback rather than leaving a hole).
`floorHandles` is EVERY tile of the provider's shallowest zoom level,
fetched once (`ensureFloorMounted`) and never evicted — this is the actual
guarantee: `fallbackHandles`/`activeHandles` both change with the view and
can momentarily cover nothing (tile churn is frozen mid-gesture — see
below — so a pan far enough that neither the old fine nor the old fallback
tiles still overlap the new viewport genuinely has nothing else to show),
but the floor covers the WHOLE domain unconditionally, regardless of where
the camera moves. Skipped when the provider has only one zoom level
(nothing coarser exists to sit beneath — `provider.zooms.length <= 1`), and
a per-update `floorKeys` set (every tile identity the floor level's own
grid already covers, computed synchronously from its shape, no fetch
needed) is subtracted from both `desired` and `fallbackDesired` so nothing
is ever mounted twice at the identical depth — not just the "target LOD
already equals the floor" case, but also a degrading provider
(`glyphMapCuratedProvider`) whose ancestor resolution for a fine/fallback
tile happens to land exactly on a floor tile's own identity (an earlier,
narrower "skip when `lod === floorZ`" special case double-fetched and
double-mounted in exactly that situation — measured live via this package's
own ancestor-dedup test; the identity-set subtraction subsumes it as one
mechanism instead of two).

Tile churn is already GESTURE-gated, not just debounced: `onPointerMove`
re-arms `scheduleTileUpdate`'s 180ms timer on every move (mirroring
`onWheel`'s own pre-existing behavior) instead of only calling it once on
`pointerup`, so an active drag never fetches/mounts/disposes mid-gesture
(every move defers the update again) but genuinely settles 180ms after the
LAST move — including a drag that never sees `pointerup`/`pointercancel`
at all (lost pointer capture, an interrupted gesture), which previously
could leave the widget waiting forever for an event that might not come.
During the gesture, coverage is guaranteed by whatever's already mounted —
the permanent floor plus any retained fallback/active tiles — never by a
mid-gesture fetch.

`padCells` (both `line`/`contour` still default `2`) defaults to `6` for
`raster` specifically — a modest overscan margin for the settled view's own
prefetch, not a correctness mechanism (that's what the floor/fallback tiers
are for): it only affects how much of a small nudge right after settling,
or the first few pixels of a NEXT gesture before its own 180ms settle, is
already-fetched fine detail rather than a momentary fallback/floor read.

Out of scope for slice 3, deliberately: vector layers, choropleth/symbols,
day/night, motion export, and the website page. No React/Vue surface yet —
nothing in the plan forces one, and none is added speculatively.

**Projection transitions (slice 4).** `GlyphMapHandle.setProjection(target,
{ durationMs? })` animates from the CURRENT projection to `target` over
`durationMs` (default 600, `0` = instant) instead of tearing the widget down
— a projection swap no longer means reconstructing `createGlyphMap` from
scratch. Every animation frame reassigns the widget's own projection
reference to `glyphMapProjectionTransition(from, to, t, opts?)`
(`transition.ts`, MAPS.md §13 slice 4 — the exact `from`/`to` object at
`t<=0`/`t>=1`, and one of THREE blend paths in between, picked by CAPABILITY
and never by `projection.id`; see "Projection blend paths" below) and blends camera
FRAMING between each endpoint's own framing independently — never from the
blended projection, which deliberately exposes neither `cameraForCenter` nor
`centerForCamera` (`transition.ts`'s own doc) — picked by CAPABILITY
presence on each endpoint (does it have `cameraForCenter`?), the same rule
every other projection-aware branch in `widget.ts` follows, never identity.
A sheet endpoint's framing is `{ rotX: tilt, rotY: 0, target:
project(lon,lat,0) }`; an orbit endpoint's is `{ rotX:
cameraForCenter(...).rotX + tilt, rotY: cameraForCenter(...).rotY, target:
project(lon,lat,0) }` — the SAME target on both sides, since both pivot about
the surface point under the view centre ("Camera tilt" below), so a flat↔globe
transition blends pan-based and orbit-based navigation into one continuous
camera move and its target travels between two real surface points rather than
out through the world origin. `rotX`/`rotY`/`target` are lerped linearly
strictly BETWEEN the endpoints — at `t <= 0` and `t >= 1` the endpoint framing
is assigned verbatim, because `a + (b − a)·1` is not `b` in floating point and
the parity gate wants the flight to settle bit-for-bit on what a plain
construction would produce. Each endpoint's pitch is clamped to ITS OWN
ceiling (a globe and a sheet at one view have completely different limbs), and
the applied pitch is carried in the framing so `applyDragState` can subtract
back out exactly what a mid-flight pose added. **`camera.zoom` is NOT**
lerped — see "Zoom is scheduled on apparent size" below. Mesh geometry reprojects every
frame too: a `raster` layer's cached tiles are disposed and remounted
against the newly-blended projection (no refetch), `fill`/`fill-extrusion`/
`symbol`/`circle`/`heatmap` rebuild from their own cached tiles the same
way, and `line`/`contour` need no extra step since `stamp()` already reads
`projection.project` fresh on every render. `unproject()` — and so
click-to-lonlat and contour field sampling — throws for a strictly-interior
blend (no closed-form inverse of two independently nonlinear maps); every
internal caller catches that and degrades to `null` for the transition's
duration rather than propagating it or crashing. Resolves once `t` reaches
`1`, at which point `projection`/camera framing are byte-identical to a
plain, non-animated `setProjection(target, { durationMs: 0 })` call. A
second call before the first settles cancels the in-flight one and restarts
from wherever the camera/projection currently are.

**Projection blend paths — the lerp, the NORMALIZED lerp, and the UNWRAP.**
`glyphMapProjectionTransition` chooses between three constructions for
`0 < t < 1`, by CAPABILITY presence (`cameraForCenter`), never by
`projection.id`:

- **The plain lerp** — the per-component lerp of the two `project()`
  results. It is right whenever both endpoints put a degree at the same
  number of world units (equirectangular ↔ Mercator: one unit per degree of
  longitude either way, at every latitude), and it is the fallback for every
  pair with no `anchor`, for an orbit ↔ orbit pair, and whenever either
  richer construction below declines.
- **Sheet ↔ sheet at DIFFERENT world scales, WITH an `anchor`** (neither
  endpoint orbit-capable): the same lerp, but **scale-normalized** —
  `q(t) = s(t)·lerp(pA/sA, pB/sB, t) + place(t)`, where `sA`/`sB` are each
  endpoint's own measured world-units-per-degree AT the anchor, `s(t)` is
  the reciprocal (harmonic) schedule the unwrap also uses, and `place(t)`
  translates the anchor onto `lerp(a.project(anchor), b.project(anchor), t)`
  — exactly where the caller's own linearly-lerped `camera.target` points,
  the same reconciliation the unwrap does. Orthographic is why this exists:
  it frames a whole visible hemisphere in ~1 world unit, ~57× smaller per
  degree than either flat map, so `lerp(pOrtho, pEqui, t)` is numerically
  dominated by the equirectangular term for all but `t < ~1/58` — the map
  holds one endpoint's SHAPE for ~99% of the flight and snaps into the
  other's inside the last percent (measured end to end on a rendered
  terrain: inked cells flat at 6,240 through `t = 0.9`, then 4,733 by
  `t = 1`). Both endpoints stay exact (`place` is zero and `s` is that
  endpoint's own scale there). An ORBIT pair is excluded outright rather
  than normalized: an orbit projection is framed by orbiting the camera
  about the WORLD ORIGIN, so translating its geometry to place an anchor
  would swing the whole sphere off that pivot.
- **Orbit ↔ sheet WITH an `anchor`** (`GlyphMapProjectionTransitionOptions
  .anchor`, `[lon, lat]`): an **unwrap**. At every `t` the surface is a real
  SPHERICAL CAP of radius `ρ(w)` tangent to a fixed anchor, carrying the map
  at a fixed arc-length scale — curvature runs from `1/R` (the globe) to `0`
  (the plane), so the interpolation is over the SURFACE, not over two
  unrelated endpoint positions, and every intermediate frame is a coherent,
  continuously-flattening shape rather than a sphere collapsing through its
  own interior. `λ = u·DEG·w`, `φ = v·DEG·w`, `ρ = s/(DEG·w)` with `ρ·λ ≡
  s·u`, so the map unbends without stretching; `(u, v)` are the two
  endpoints' own developed maps in degrees, lerped, which is the identity for
  an equirectangular sheet (a pure unbend) and the latitude stretch for
  Mercator. The frame is carried from the sphere's (north `+Z`) to the
  sheet's (north `−X`) by a rigid `−90°·(1−w)` rotation about `Y` composed
  with a `lon0·w` polar rotation, both exactly identity at their own
  endpoint. Relief rides the local normal, its magnitude lerped between the
  sphere's radial displacement and the sheet's own world `Z`. The orbit
  endpoint's sphere geometry is VERIFIED at build time (six `project()`
  probes against `r·(cosφcosλ, cosφsinλ, sinφ)`) rather than inferred from
  the capability — anything else falls back to the lerp, so a future orbit
  projection of another shape degrades instead of popping at `t→0`.

  **The world-scale schedule is RECIPROCAL, not linear**, and that was the
  first fix for the reported "it's like a zoom in and zoom out": apparent
  size is `worldScale × camera.zoom`, and each endpoint's zoom is
  `∝ 1/degreeScale`, so under a LINEARLY lerped `camera.zoom` — which is
  what `applyProjectionFrame` used to do — holding apparent size steady
  requires `1/s(t)` to be the linear interpolant. A linear `s(t)` multiplies
  two ramps running in opposite directions. Measured on globe →
  equirectangular (world diameter × a linearly-lerped zoom, 0.05 steps —
  `packages/maps/src/transition.test.ts`'s own acceptance gate): the plain
  lerp ran 114.6 → **5683.9** at t=0.5 → 390.0, a 49.6× mid-flight bulge;
  the unwrap rises monotonically 114.6 → 390.0. The remaining ~π growth is
  the unwrap itself (a great circle of circumference `C` presents a diameter
  `C/π`; laid flat it presents `C`), so the gate asserts monotonicity, not
  constancy. That gate keeps modelling a linear zoom deliberately, even
  though the caller no longer uses one (below): it is the harder case, and a
  schedule that needed the caller's help to look right would still show up
  as a bulge in those numbers.

  **Zoom is scheduled on APPARENT SIZE, not lerped** (`widget.ts`'s
  `transitionZoom`), and that is what fixed the follow-up report — "it
  unwraps and makes a zoom jump at the end". A linear zoom lerp only cancels
  one particular world-scale schedule; against any other, the product sits
  near one end for almost the whole flight and resolves over the last few
  percent. Measured at the `/maps` defaults, globe → equirectangular put
  **91% of its wide-shape travel into the final tenth** of the flight, and
  equirectangular ↔ orthographic inflated apparent size **15.7×** mid-flight
  before collapsing again. Instead: apparent size at the view centre —
  screen units per degree, `centerDegreeScale × zoom` — moves LOG-linearly
  from the flight's start value to its end value, and `camera.zoom` is that
  divided by the live blend's own measured scale. This cancels ANY schedule,
  including a future projection pair's, rather than asking every blend path
  to pre-cancel a linear ramp. Two details are load-bearing:
  - **Both endpoints are returned directly** (`t<=0` → the LIVE camera's own
    zoom, J5; `t>=1` → `to`'s own `framingFor` zoom), so exactness at the
    endpoint-object swaps is structural rather than a floating-point
    coincidence.
  - **The scale measure interpolates its AXIS**, it does not switch on one.
    `computeZoomForSpan` frames `view.span` along the meridian for an orbit
    projection and along the parallel for a sheet, and those differ by
    `1/cos(lat)`; a blend exposes no orbit capability, so a branching
    measure reads the same surface one way at `t=0` and the other way one
    frame later — measured as a **1.88× first-frame zoom snap** after a drag
    to 61N, and 7.75× at 75N. `centerDegreeScale(proj, alongParallel)` takes
    the axis weight as a number and geometrically blends the two rates;
    `transitionZoom` walks it from `fitAxisOf(from)` to `fitAxisOf(to)` with
    `t`, so a globe → sheet flight interpolates the two projections' own
    framing conventions instead of jumping between them.

  `widget.transitionContinuity.test.ts` is the gate for all of this: a
  DRIVEN `requestAnimationFrame` clock samples both boundaries at 0.0005
  steps (the coarse timer-based `widget.transitionAnchor.test.ts` cannot see
  the last percent of a flight at all), across globe/equirectangular/
  Mercator/orthographic pairs in both directions and at view latitudes 0
  through 75, asserting three things: apparent size stays inside the band its
  own endpoints define, no sampled step exceeds its share of the flight's
  own total change, and no more than 45% of the wide-shape travel lands in
  the first or last tenth of `t`.

  **The `anchor` is what ENGAGES the unwrap (and the normalized sheet lerp),
  and it must be the caller's view centre.** `camera.target` is the endpoint's
  own `project(centre)`, lerped LINEARLY, so the blended surface has to put
  the centre exactly there or the camera frames somewhere the map is not.
  Anchoring the surface ON the view centre resolves it: the anchor point is
  placed at exactly
  `lerp(orbit.project(centre), sheet.project(centre), t)`, which the lerped
  `camera.target` tracks to within the sphere's own radius (the same residual
  the lerp path already carries). Without it, an off-centre view frames empty
  space (measured at 140°E: ~70 world units, ~2000 px, off at t=0.5), which is
  worse than the bulge — hence the gate rather than a `[0, 0]` default. Only
  the anchor's LONGITUDE also moves the tangency: the equirectangular
  development is covariant under rotation about the polar axis but not under a
  meridional one, so a latitude tangency would break the exact-at-`t=0`/`t=1`
  guarantee. **`createGlyphMap.applyProjectionFrame` passes
  `{ anchor: view.center }`** unconditionally, so the widget takes the
  unwrap on every orbit<->sheet transition and the normalized lerp on every
  scale-mismatched sheet<->sheet one. `widget.transitionAnchor.test.ts` gates it
  BEHAVIOURALLY rather than by spying on the call: apparent size (the
  screen-cell distance between two points one degree apart at the view centre)
  must stay within 1.5x its own endpoints across the flight; dropping the
  anchor argument peaks that at 14.7x on the test's own fixture.

**The `/maps` render bench.** `bench/maps-render/mapsBench.mjs` (modeled on
asciiQuake's committed `test/perf/glyphBench.mjs`) drives the real `/maps` page
through four deterministic CONTINUOUS-motion replays — a smooth globe rotation,
a smooth pointer drag plus release, a continuous wheel sweep, and a `flyTo` arc
— and reports renders per displayed frame, the Chrome task/script/layout/paint
split, glyphcss's own stage breakdown, the base pass's polygon count, AND a
fidelity digest over eight fixed waypoints. Three of its design decisions are
themselves findings and must not be "simplified" away:

- **Input is synthesized IN-PAGE, not through CDP.** Two separate
  `setTimeout(…, 0)` tasks per displayed frame reproduce a trackpad's burst
  exactly; Playwright's `mouse.move` + await delivers roughly one event every
  two or three frames and measured renders/frame at 0.34, which says nothing
  about the real behaviour.
- **Vsync stays ON.** asciiQuake ran uncapped because its replay drove one
  camera move per rAF at any rate; here two scenarios are input-driven and an
  uncapped rAF turns their think-time into thousands of phantom "displayed
  frames" (measured: 990 fps, renders/frame 0.03, meaningless).
- **Grid shape is a GATE.** Every scenario asserts the rendered grid equals
  `--expect-grid` and FAILS otherwise, because a cheaper frame at a coarser grid
  is not an optimization.

The digest waits for QUIESCENCE (the `<pre>` unchanged across two consecutive
samples), not a fixed delay — a fixed delay made two of the eight waypoints
report different digests run to run on changes that provably could not alter a
pixel. Run it in `--encoding spans`: under the default `atlas` encoding a cell is
a PUA code point encoding *(glyph, palette-slot)* and the palette is median-cut
over whatever grids the quantizer trained on, so changing HOW MANY renders
happen per frame permutes slot indices and two builds painting identical colours
get different digests (asciiQuake measured 85% of atlas cells "differing" on a
byte-identical render). The page installs its harness seam only under
`?bench=1`.

**One camera-motion loop: input accumulates, the frame renders.** Every kind of
continuous camera motion the widget has — inertial drag glide, `flyTo`, and
`setProjection`'s blend — advances on ONE `requestAnimationFrame` loop that
issues at most ONE `scene.rerender()` per displayed frame, and stops entirely
when nothing is moving (a static map runs no frames). Two competing loops would
be a worse bug than the one this fixes.

The rule is the point. A trackpad emits 60-120 pointer/wheel events per second,
each arriving in its own task, and glyphcss coalesces renders on a **microtask**
— which drains at the end of *every* task. So before the loop, N input events
inside one displayed frame bought N complete grid renders and threw all but the
last away unpainted: measured on `bench/maps-render`'s continuous drag (two
synthesized pointer events per displayed frame, the real trackpad shape) at
**1.96 renders per displayed frame and 42.1 ms of main-thread time per frame**,
against 1.00 and 22.4 ms after. This is asciiQuake's own headline defect
(`../asciiQuake/PERF_REPORT.md`), reproduced here on the drag path only —
`setView`-driven animation and the wheel path were already at ~1.0.

Camera/view STATE still updates synchronously inside each input handler: it is
cheap pure math, `getView()`/`camera.zoom` must not lag the gesture for a caller
reading them between events, and the view<->camera round-trip invariants are
asserted immediately after firing 30 synchronous `pointermove`s with no frame in
between. **Only the render is deferred.** `applyDrag` is split into
`applyDragState` (view + camera, no repaint, no event) and the wrapper that marks
the frame dirty and emits; the wheel keeps applying its span outright rather than
easing toward a target, because an eased `view.span` would disagree with the
gesture the caller just made and would feed tile LOD a value the user never asked
for — the smoothness comes from frame coalescing, not from lag.

**Inertia.** `pointermove` keeps an exponentially-smoothed px/ms fling velocity;
`pointerup` releases into a glide that decays `exp(-dt / 220ms)` per frame and
ends below a quarter-pixel-per-frame threshold. A drag that PAUSED before release
does not fling (a velocity older than ~60 ms is not a throw), a single huge
pointer jump is capped, and grabbing the map again stops the glide exactly where
it is.

**Detail settles when MOTION stops, not when the pointer goes up.** Every moving
frame re-arms the same 180 ms `scheduleTileUpdate` debounce the drag already
used, so a glide or a flight fetches once at rest instead of at every waypoint.

**`GlyphMapHandle.flyTo(target, { durationMs?, bow? })`** is the animated
counterpart of the instantaneous `setView`/`fitBounds`, and the mechanism a
"fly to this place" search box drives. `target` is a centre and/or span, or
`{ bounds }` (framed by the same `framingForBounds` `fitBounds` itself uses, so
the two can never frame a box differently). The centre eases (`easeInOutQuad`)
along the SHORTER longitude arc; the span interpolates in LOG space (a zoom is
multiplicative — a linear lerp spends almost the whole flight at the wide end)
and is BOWED outward at mid-arc, so a cross-globe flight never skims the surface
at final detail. That bow is the performance-relevant half: it bounds how much
fine terrain is ever needed mid-flight. It is the simple `sin` bow, not van
Wijk's optimal-path zoom-and-pan — that buys a slightly more natural
constant-perceived-velocity arc for a lot more math and nothing here depends on
it; `bow: 1` opts out.

**Hand-over is continuous, never a snap.** A drag, a wheel, a `setView`, a
`fitBounds`, a `setProjection` or a second `flyTo` arriving mid-flight cancels
the flight WHERE THE CAMERA CURRENTLY IS — the glide and the flight only ever
write `view`/`camera` per frame, so nothing is re-derived from a flight's
original start. This is the same defect class `applyProjectionFrame`'s
`fromFraming` doc records (J4's measured 15.7x one-frame zoom snap), and it is
pinned by a test with the same acceptance shape. A programmatic `setView`/
`fitBounds` WINS IMMEDIATELY (cancels in place and renders synchronously) rather
than queueing behind a gesture: an explicit "go here" has no useful notion of
"later". An abandoned or destroyed flight still RESOLVES, so `await flyTo(...)`
never hangs.

`projectionGrid()` is deliberately NOT memoized despite reading two
`getBoundingClientRect()`s per call. A memo scoped to "until this widget's next
repaint" was built and measured, and removed on both counts: it moved `layout`
by nothing (1.787 -> 1.824 ms/frame, i.e. noise) and it was not sound — glyphcss
ALSO renders on its own microtask whenever a mesh is added or removed, so a tile
mount repaints without passing through any widget-side invalidation and the
stroke hook then stamped against a stale grid, changing the render at exactly
the two fidelity waypoints that mount tiles. If it is ever worth caching, the
invalidation has to come from glyphcss's own render boundary.

**Cover, not contain: a SHEET projection always fills the viewport.**
A flat map must never show page background around its edges, at any zoom or
pan position. Selected by the SAME capability every other projection-aware
branch uses — a projection with `cameraForCenter`/`centerForCamera` is
navigated by ORBITING fixed geometry, legitimately floats in space (dragging
the globe through the pole is a feature), and is exempt from all of the
below; everything else is a sheet.

Two constraints, both derived from the projection's OWN projected extent
(`projectedDomainBox` projects the declared `domain` on a 33x33 grid at
`elev: 0`, skipping the non-finite samples outside the true valid window, and
memoizes per projection object — never a per-projection table, never a branch
on `projection.id`):

- **A maximum span** (`spanCoverLimit`, public as
  `GlyphMapHandle.getMaxSpan()`) replacing the old default of "the
  projection's `domain` WIDTH". The binding axis is whichever needs the most
  zoom to be filled, so the limit follows the HOST's shape rather than
  assuming a world aspect, and it follows `tilt` (a tilted sheet's vertical
  axis is foreshortened — measured through a scratch camera posed at
  `framingFor`'s own sheet framing, not re-derived as `cos(tilt)`). Inverting
  "the zoom that covers" back into a span needs no search: the sheet branch
  of `computeZoomForSpan` is exactly `hostPxWidth / (rate(centre) * span)`,
  inverse-linear in span, so one probe at `span: 1` fixes the curve and the
  limit can never drift from the real camera. Measured on a 1280x720 host at
  the page's own `tilt: 40`: the old `domain`-width default left 31.9% of the
  viewport HEIGHT as background on equirectangular and 36.3% of its WIDTH on
  orthographic, and the `/maps` page's own `maxSpan: 720` left 50% of the
  width.
- **A pan clamp** (`clampWorldToCover`) keeping the VISIBLE WINDOW inside
  that extent, per axis, in WORLD space — the old rule clamped only the
  CENTRE into `projection.domain`, which stops the centre leaving the map but
  still lets the map's edge come inside the viewport (measured: a hard drag
  into a corner put the centre at `[-180, 90]` and left half the viewport
  empty).

Both are applied by one `clampViewToCover`, on every path a view can arrive
by: the constructor (so a stale shared LINK's span resolves clamped on read
rather than rendering letterboxed), `setView`/`fitBounds`/`flyTo` (via the
shared `applyViewState`), the wheel, and `resize` (the host's shape decides
which axis binds). It ITERATES to a fixed point (bounded at four passes)
because the two clamps are coupled wherever a projection's scale varies
across its own domain — orthographic's local rate falls off as `cos(dLon)`,
so pulling the centre in changes both the zoom the centre was measured
against and the span limit itself; a single pass left the view under-covered
and stepped `camera.zoom` back UP by 1.10x on the next wheel notch.

**The axis a map cannot fill is CENTRED, not pinned.** Cover is normally
always satisfiable (zoom in far enough), so this needs a floor that stops the
zoom first — `minSpan` above the cover limit, e.g. a Mercator cropped to a
narrow `maxLat` in a very tall viewport. There the constraint is infeasible
and `coverAxis` returns the map's own midpoint on that axis: one fixed point,
so a drag against it settles instead of oscillating between two clamps, and
the background it cannot avoid is symmetric rather than jammed to one edge.

**Two deliberate limits.** The contract is over the extent's axis-aligned
BOUNDING BOX, so a projection whose valid region is not a world-space
rectangle — orthographic's disc — still shows background in the viewport's
four CORNERS; covering those would mean cropping to the disc's inscribed
rectangle, putting the hemisphere's own limb permanently out of reach. And
an explicit `maxSpan` OPTS OUT of both constraints (span and pan): its
documented meaning is "overview margin around the whole projection", which is
exactly the background cover removes, so the caller's explicit request wins
and the widget behaves as it did before. `/maps` therefore no longer passes
one — it reads `getMaxSpan()` into its span slider's range instead — and its
globe's ceiling is that projection's own domain width (360) rather than the
720 overview it used to set.

**A `setProjection` flight resolves the two endpoints' differing limits ONCE,
up front.** `limitProjection()` returns the flight's DESTINATION for its
whole duration, and `setProjection` clamps `view` against it before capturing
`fromFraming`. Clamping when the flight LANDS instead would put the entire
span change into the final frame — the exact defect class
`widget.transitionContinuity.test.ts` gates at `t = 1` (that alternative,
run as a mutation, fails it with a 1.56x step across `t = 0.9995 -> 1` and
97-141% of three pairs' shape travel crammed into the last tenth). Clamping
up front cannot snap: `fromFraming` is the LIVE camera, so `t = 0` is
untouched and `transitionZoom` paces the whole change as ordinary
apparent-size travel. The blend itself is never asked for a limit — it
exposes no `cameraForCenter`, so a globe->sheet flight would read as a sheet
from its first blended frame and start clamping a view the globe endpoint is
entitled to.

**Camera tilt pitches about the SURFACE POINT under the view centre — one
rule at both scales and for both projection families.** `GlyphMapOptions.tilt`
/ `GlyphMapHandle.setTilt`/`getTilt`/`getMaxTilt` are "pitch about the surface
point under `view.center`, with the pivot distance equal to the camera's
altitude": Google Earth's and Cesium's model. `map.project(getView().center)`
therefore lands at the centre of the grid at every pitch and every span, and
the two feels the user asked for fall out of the ONE rule with no mode switch
and no threshold — zoomed out the pivot is far below the camera relative to
the view, so pitching swings the globe and the limb comes into frame
tangentially; zoomed in the pivot is directly beneath, so pitching reads as
raising your head off the ground, which is what makes 3D buildings legible.

Under glyphcss's ORTHOGRAPHIC camera the pivot's distance along the view axis
is unobservable — `createGlyphCamera.ts`'s `project` is `R·(v − target)`, so
shifting `target` along the view axis moves depth by a constant and col/row by
nothing at all. The "pivot at the camera's altitude" clause is therefore
degenerate here and the model reduces EXACTLY to "the surface point stays at
screen centre", i.e. `camera.target = projection.project(lon, lat, 0)`. That
is what a SHEET projection has always done, so ONE implementation serves both:
a plane is the degenerate case of the same rule, its `tilt` is still the total
`camera.rotX` (default `40`), and its pose is byte-identical (pinned exactly
in `widget.tiltPivot.test.ts` — the four numbers `rotX`/`rotY`/`target`/`zoom`
fully determine an orthographic render). An ORBIT projection's `tilt` still
ADDS to `cameraForCenter(lon, lat)`'s own pitch (default `0`, head-on); only
the PIVOT changed. It is still not a third rotational degree of freedom:
composing an extra `rotateX(tilt)` after `cameraForCenter`'s rotation is
identical to shifting `rotX` by `tilt` (both share the post-`rotY` local X
axis — `rotateVec3Voxcss`, `packages/glyphcss/src/api/createGlyphCamera.ts`).
`applyDragState` re-anchors the pivot on the centre the drag just produced and
subtracts the APPLIED pitch back out of `camera.rotX` before calling
`centerForCamera`, so `view.center` reports the point the viewer is looking at
and nothing derived from it (markers, `fitBounds`, tile LOD) is contaminated.

*What this replaced, and what it cost.* Before this, an orbit `tilt` swung the
camera about the GLOBE'S CENTRE with `camera.target = [0, 0, 0]`, so the
NUMBER in `view.center` stayed stable while the PICTURE was `tilt` degrees of
latitude away. Measured at the page's default `tilt: 40` on a 140x63 grid:
`project(getView().center)` landed at row 11.9 of 63 at a 140-degree span, row
−33.3 at 40 degrees, row −827.9 at 3 degrees and row −23,405 at 0.11 degrees.
Six separate defects on this branch traced to it (half the map not loading,
the pole unreachable, borders vanishing at deep zoom, shared links describing
the wrong place, curated tiles never fetched, the OSM layer flying to Zurich
and rendering Cameroon), and three artefacts existed only because of it:
`widget.osm.test.ts`'s "walks it off as the span shrinks" block (which PINNED
the arithmetic and has been inverted in place), the doc premises in
`viewportGeoSamples`/`orbitCandidateGeoBounds`/`widget.tiltedTileCulling.test
.ts` (the FAILURES those guard — a 22.5-degree tile whose own 3x3 samples all
miss a 3-degree viewport, and a `1/cos(lat)`-wide window at high latitude —
are untouched by the pivot and still guarded; only the premises were
rewritten and the harnesses re-aimed), and `/maps`' own
`MAP_SEARCH_FLY_TILT = 0` levelling, which is now dead page code. One real
change fell out of it: a transition's endpoint framings are now assigned
VERBATIM at `t <= 0`/`t >= 1` instead of through the lerp, because
`a + (b − a)·1` is not `b` in floating point — invisible while an orbit
endpoint's target was the exact `[0, 0, 0]`, an ulp once it is a real surface
point, and the "settles EXACTLY on the target" parity gate caught it.

**The pitch ceiling is the HORIZON ANGLE at the view's own scale.**
`GlyphMapHandle.getMaxTilt()` is `asin(R / (R + h))` capped at
`GLYPH_MAP_MAX_TILT` (85), where `R` is the datum's distance from the world
origin (`|proj.project(lon, lat, 0)|` — the SAME origin-centred sphere
`glyphMapGlobe.visible` already assumes when it takes `depthOf([0,0,0])` as
its reference plane) and `h` is the frame's world-space HALF-HEIGHT,
`(rows·cellHeight/2) / zoom`. That is the textbook horizon angle: the
half-angle of the cone of rays tangent to a sphere of radius `R` from a point
at altitude `h` is exactly where a view direction stops intersecting the
surface. The one modelling choice is `h`: an orthographic camera has no
altitude, so the view supplies the only length it has — its own frame's
half-height (equivalently, the altitude of the perspective camera that would
show the same ground straight down through a 90-degree vertical field). Any
other field of view rescales `h` by a constant and slides the whole curve;
`h` itself is the parameter-free member of that family. The numerator
`rows·cellHeight` is the host's rendered pixel height, so the ceiling is
invariant to `cols`/`rows`/cell size exactly as `camera.zoom` is, and is
gated the same way. `widget.tiltPivot.test.ts` re-derives it independently
through the PUBLIC surface — at pitch 0 the world point under the top-centre
cell sits exactly `h` from the view axis, measured via `map.unproject` +
`projection.project`, never from this arithmetic — and matches to 3 decimals
at three spans.

The shape is what the geometry demands, and it is what the requirement asked
for: ~21 degrees at a 360-degree span on a 16:7 grid (where the reported
"80 degrees of pitch aims the camera past the limb at empty space" lives),
~50 at 40 degrees, ~67 at 12, and the 85-degree cap by city scale — so the
page's default 40 is untouched at every scale a city or region is read at and
binds only at planet scale. The cap is not taste either: at exactly 90 degrees
the camera is edge-on, an orthographic projection collapses the surface to one
row of cells, and `sheetScreenScale` divides by a vertical extent going to
zero. A SHEET has no limb — a plane is intersected by every ray short of
edge-on — so its ceiling is the cap alone at every span, chosen by CAPABILITY
(`isOrbit`) and never by `proj.id`.

Two rejected alternatives. (1) The forced orthographic criterion — "the top
ray of the parallel bundle must still hit the sphere", `sin t <= 1 − h/R` — is
exactly derivable with no modelling choice at all, and wrong for the
requirement: it returns 0 for every view where the globe already fits in the
frame (`h >= R`), forbidding precisely the tangential-limb swing the zoomed-out
regime is supposed to give. (2) "The disc must stay framed", `sin t <= |1 −
h/R|`, is symmetric and continuous but returns ~53 degrees at a world view,
where the globe is shoved to the bottom of the screen and ~89% of the upper
frame is empty — the failure the ceiling exists to prevent. The clamp is
non-destructive: `tiltRequest` keeps what the caller asked for and only the
APPLIED pitch is clamped, so a zoom out that lowers the ceiling does not
destroy the request and zooming back in restores the full pitch. `getTilt()`
reports the applied pitch — the readout describes the picture — and the widget
holds `appliedTilt` as state rather than re-deriving it, because a projection
transition poses the camera at a lerp of two endpoints' pitches that no single
`maxTiltFor` call could reproduce, and `applyDragState` must subtract back out
exactly what was added.

**The pitch GESTURE: Ctrl+drag and right-button drag, 0.5 deg/px.** Pitch
existed only as `setTilt`, and on `/maps` that meant one slider inside a
collapsible Dock that the reader never opened — the feature was shipped and
unreachable. `controls.tilt` (default `true`, its own opt-out beside `drag`
and `wheel`) binds the pitch to the gesture Google Maps, Mapbox, MapLibre and
Cesium all converged on, so it is the one hands already have; on macOS
Ctrl+click IS the secondary click, so the two conditions are the same gesture
arriving under two names and both are accepted. `GLYPH_MAP_TILT_DRAG_DEG_PER_PX`
is MapLibre's own `pitchRate`: at half a degree per pixel the whole usable
range (85 degrees, the widest ceiling this widget ever offers) is 170px — one
flick, never a repeated stroke — while a pixel of tremor is half a degree
rather than a visible jump.

Three decisions inside it. (1) The gesture goes through `applyTiltState`, the
STATE half split out of `setTilt` for exactly the reason `applyDragState` is
split out of `applyDrag`: `getTilt()` must not lag the gesture for a caller
reading it between events, while the REPAINT is coalesced onto the one motion
loop — `markMotionDirty()`, never a second `scene.rerender()` path (gated:
20 synchronous `pointermove`s render nothing and still report the exact live
pitch). (2) The delta accumulates from `appliedTilt`, NOT from `tiltRequest`.
The two differ only above the view's own ceiling, and accumulating from the
request there gives the gesture DEAD TRAVEL: at a whole-world span (ceiling
~21) a request left at 85 by a close-in gesture needs 128px of downward drag
before the picture moves at all. Reading the applied pitch makes the gesture
relative to what the reader can actually see, which is what direct
manipulation has to be — and it costs nothing observable elsewhere, because a
zoom never rewrites `tiltRequest`, so the remembered-request behaviour above
survives intact (both halves gated in `widget.tiltGesture.test.ts`). (3) No
inertia. A pitch that kept moving after the hand stopped would coast into the
horizon ceiling and sit there, and there is nothing physical about an angle to
justify the momentum; a tilt gesture also never emits `click` (a secondary or
modified press is not a map click) and `preventDefault`s its own `pointerdown`
so the stroke cannot start a text selection. `contextmenu` is suppressed over
the host whenever the gesture is enabled — on some platforms the native menu
appears on `mousedown`, i.e. before the drag has moved a pixel, which would
make the right-button half unusable rather than merely untidy.

**BEARING IS A ROTATION ABOUT THE PIVOT'S SURFACE NORMAL, NOT A ROLL ABOUT
THE VIEW AXIS.** The pitch half of this work shipped with the wrong one-line
model written down — "bearing is a third rotation about the VIEW axis" — and
it is worth stating why that is wrong before anything else, because it is
wrong in the way that survives review. Rolling about the view axis ROLLS THE
HORIZON: the map tips sideways, like a photograph turned in its frame. No map
product does that, and it is not what a heading is. What Google Maps, Mapbox,
MapLibre and Cesium all do is turn the camera about the LOCAL UP at the point
it is looking at — the camera swings around a cone at constant pitch, the
horizon stays level, and only the compass direction changes. The two models
are IDENTICAL AT ZERO PITCH, which is exactly why the error is easy to miss
and exactly why it matters: they diverge only when the camera is tilted, and
tilted is the case bearing exists for.

The number is the compass heading that points UP on screen: `0` is north up,
`90` puts east up, so the picture turns counter-clockwise as it grows — the
MapLibre convention, taken rather than invented because a heading a reader
already knows how to read is worth more than a self-consistent new one.
`getBearing()` reports it normalized to `[0, 360)`, and exactly `0` (never
`-0`) at every multiple of a turn, because `bearing === 0` is the guard that
keeps the whole render bit-identical.

**The composition.** In glyphcss's own axis-swapped c-frame (`(v[1], v[0],
v[2])` — `createGlyphCamera.ts`'s `rotateVec3WithMat` bakes that swap in), the
installed matrix is

    M = E · Rot(uc, −bearing),    E = RotX(camera.rotX) · RotZ(camera.rotY)

where `uc` is the pivot's local up in that same frame. Two things fall out of
the RIGHT-multiplication, and both are the reason for it:

 1. **The horizon stays level.** `up` is the rotation's own axis, so
    `M · uc = E · uc` identically, for every bearing: the screen-space
    direction of local up at the pivot cannot move. A roll is
    `RotZ(ψ) · E` — LEFT multiplication — and fails exactly this clause.
    Measured on a globe at pitch 40: up's screen angle moves by 8e-9 degrees
    across a 60-degree turn under the right model, and by 36.2 degrees under
    the roll.
 2. **It is the third Euler angle, in the right slot.** Where the pivot is
    the view centre, `E0 · uc = ẑ` (proven, not assumed: `(E·c(u))_z` is
    `glyphMapHeadlightDirection(rotX, rotY) · u`, and for the globe that
    vector IS the radial direction at the view centre), so
    `E0 · Rot(uc, −b) = RotZ(−b) · E0` and the whole camera reads
    `RotX(tilt) · RotZ(−b) · RotX(trueRotX) · RotZ(rotY)` — navigate, turn,
    pitch. That is the MapLibre/Cesium camera exactly, and it is what makes
    the drag correction a single 2×2 rotation rather than a re-derivation.

The axis `uc` is asked of the PROJECTION, through `localUpDirection`'s
`project(lon, lat, +1m)` probe, not hardcoded as `+Z` (right for a sheet) or
"radially outward" (right for the globe). `glyphMapFromD3Raw` lets a caller
bring a projection this package has never seen, and a `setProjection` blend is
a fourth thing again; all of them agree that a positive elevation nudge moves
a point up, which is the entire definition needed. It is rebuilt from
`camera.rotX`/`rotY`/`target` after EVERY write of any of them — construction,
`syncCameraToView`, `applyDragState`, `applyTiltState`, `applyProjectionFrame`,
`setBearing` — because a stale matrix is not a stale picture, it is a wrong
`project()` for every caller in `widget.ts` (unproject, tile sweep, strokes,
hotspots) until the next render.

**Bearing 0 is the map that existed before this feature, and that is a
guarantee with a test.** No matrix is installed at all there (`useMat` false,
`mat` null), so glyphcss stays on its memoized Euler path and the default map
pays nothing. `widget.bearing.test.ts` pins the render STRING, `project()` on
five points, `unproject()` on three cells, `getMaxSpan()`, `getMaxTilt()` and
`getTilt()` identical across three maps: one that never heard of bearing, one
constructed at `bearing: 0`, and one turned to 137 and back — the third being
the one that catches a matrix left on the camera (mutation-checked: not
clearing it moves a probe cell from col 164.65 to col 24.55). Every branch
that could change a cell is guarded on `bearing === 0` and takes the ORIGINAL
expression verbatim rather than the general one with `cos 0`/`sin 0`
substituted, because `(a/b)/c` and `a/(b·c)` are not the same double.

**What the audit got right, and the one thing it got wrong.** Right: no core
change is needed (`GlyphCamera.mat`/`useMat` is public and `project()` already
honours it); `chirality.test.ts` needs no parameterizing, since it pins the
zero-bearing frame; `maxTiltFor` reads only a radius and a half-height; and
every unproject-derived footprint — `unprojectSphere`'s Newton on
`camera.project`, `sheetUnprojector`'s three-probe basis, `viewportGeoSamples`,
`orbitCandidateGeoBounds` — is derived from SCREEN cells rather than an
axis-aligned lon/lat window, so the tile sweep, the contour labels' "near
horizontal, locally straight" screen criterion and `glyphMapDeclutterLabels`
all follow a heading for free. Wrong: **`glyphMapHeadlightDirection` is NOT
bearing-invariant.** The audit's reasoning was sound for the model it was
written against — a roll about the view axis cannot move that axis — but a
rotation about the SURFACE NORMAL genuinely swings the camera, so reading the
Euler pair while a matrix is installed lights the map from where the camera
used to be. `headlightDirection()` reads the matrix instead:
projected depth is `row3(mat) · c(v)`, so its world gradient is that row
un-swapped, `(mat[7], mat[6], mat[8])` — already unit length, being a row of a
rotation, and reducing ALGEBRAICALLY to `(sin rotX cos rotY, sin rotX sin
rotY, cos rotX)` at bearing 0, where the Euler call is still the one that runs.
At zero pitch it is invariant after all, which is the two models coinciding
again and is pinned as its own case.

**The drag.** `camera.rotX`/`rotY` are the NAVIGATION rotation and the heading
sits on top of them, so a raw pixel delta means something else once the map is
turned. `RotZ(−bearing)` acts on exactly the two components that become col
and row, so undoing it is one 2×2 rotation by `+bearing` in screen
coordinates (`y` DOWN, hence the plain unmirrored matrix). Check it at 90
degrees, where east is up: dragging right there must move the centre NORTH,
and `(1, 0)` maps to `(0, 1)` — drag DOWN in the navigation frame, which is
what the orbit branch already turns into a northward step. Measured: the same
40px stroke gives `lon −1.4213` at bearing 0 and `lat +1.4213` at bearing 90,
the same magnitude spent on the other axis. The SHEET branch takes NO such
correction and must not: `screenToWorldDelta` solves its basis from three
probes of the live `camera.project`, which already carries `camera.mat`, so
rotating the delta first would apply the turn twice.

**The cover clamp DOES under-cover, and it is measurable.** A sheet's visible
window is a rectangle in world space, and a bearing turns it; the AABB of a
`w × h` rect turned by `b` is `w|cos b| + h|sin b|` by `w|sin b| + h|cos b|`,
worst at 45 degrees. `sheetScreenScale`'s per-axis probe is unchanged (the
rect's own axes turn with it, so the foreshortening still belongs to
`perWorldX`); only the half-extents `clampWorldToCover` compares and the
`coverZoom` `spanCoverLimit` needs take the turned AABB. On Mercator at
140×63 the ceiling drops from 306.4 degrees of span to 234.1 at bearing 45,
and without the term a viewport CORNER falls off the map at the ceiling —
which is the gate, rather than the arithmetic. At the corrected ceiling the
four corners land exactly on the domain edge (lat ±85.0511…, Mercator's own
`maxLat`), i.e. the rule is exact rather than slack.

**The one thing this cannot fix from inside `packages/maps`, reported not
worked around:** glyphcss's TAA history camera. `rasterize.ts`'s
`temporalBlend` path rebuilds the previous frame's camera from `rotX`/`rotY`
(plus `target`/`zoom`/`center`/`perspective`/`distance`/`stretch`/`fovScale`)
and DROPS `mat`/`useMat`, both in the `curCam` parameter it is handed and in
the `H.cam` history it stores, so a turned scene would reproject its history
against an unrotated frame and smear. The fix is small and belongs there —
carry the two fields through both structures and set them on the rebuilt
camera — and it is not made here. `@glyphcss/maps` never sets `temporalBlend`,
and a consumer would have to pass it through `GlyphMapOptions.scene` to reach
it, so nothing ships broken; but a maps scene that did opt in would be wrong
at any nonzero bearing.

**The gesture** is the HORIZONTAL axis of the stroke whose vertical axis is
pitch, at `GLYPH_MAP_BEARING_DRAG_DEG_PER_PX` (0.8 — MapLibre's own
`bearingDegreesPerPixelMoved`, a full turn in 450px), and dragging RIGHT
INCREASES the bearing, which turns the picture ANTI-clockwise. The rotation is
about the view centre, so one half of the picture always turns against the
hand and the only question is which half the reader is grabbing: under a pitch
— the pose this gesture exists for — the near ground fills the LOWER half and
the upper half is horizon, so the hand is on the lower half and the
anti-clockwise turn is the one that carries the ground under the cursor to the
right. The opposite sign shipped first, argued as "the TOP of the picture
follows the hand"; the reader who used it reported it backwards, and it also
disagreed with the Dock's own `Bearing °` slider, where dragging the handle
right raises the heading. Both now move the map the same way. Both axes are live in the one stroke
rather than the gesture committing to one at `pointerdown`: that is what every
map with this binding does, it is the only way a reader can compose "look
across it and turn it" in one movement, and an axis lock would make a
slightly-off-vertical pitch silently refuse to turn. `controls.tilt` is the
one opt-out for both halves — one press, one stroke, and two flags would let a
caller enable half of it. It goes through `applyBearingState` +
`markMotionDirty()`, so `getBearing()` is exact per `pointermove` while the
repaint stays on the one motion loop (gated: 20 synchronous moves render
nothing and still report the exact live heading). No inertia, for the reason
the pitch half has none.

**View state and the page.** `bearing` appends to `mapsUrlState`'s
token-keyed schema under `b` with a 1-degree step and a `0` default — no
version bump, nothing retired, and a link written before it existed carries no
`b` and decodes to north up, which is the map it always described. On `/maps`
the Dock's View folder carries a `Bearing °` row directly under `Tilt °`
(`MAP_BEARING_SLIDER_RANGE`, a fixed `0..360` — a heading has no ceiling to
follow, so unlike Tilt it needs no per-sync range push) whose VALUE still
syncs every frame, because the horizontal half of the gesture moves the camera
without the page writing it and a row that did not read it back would show a
stale heading — the exact defect just fixed for Tilt. `0..360` rather than
`-180..180` because it is a compass heading and matches `getBearing()`; the
cost is a seam at north where the handle jumps 359 → 1, which is only a
redraw, since the row is written to per sync and never read back into the
gesture. The on-map control that was `MapTiltReset` is now `MapCompass`: one
button, in the same corner, showing whichever of heading and pitch is off home
(with a needle that turns with the map and a 16-point compass label) and
resetting both in one click — which is what a map compass has always done, and
is why this is not a second button beside the first.

**`cameraForCenter` is a 2-to-1 inverse, and the widget remembers which
preimage it is on.** `centerForCamera`'s parametrization
`n = (sinRotX·cosRotY, sinRotX·sinRotY, cosRotX)` maps `(rotX, rotY)` and
`(−rotX, rotY + 180)` to the SAME `(lon, lat)` — `cos` is even, so latitude
is unchanged while `nx`/`ny` (longitude) both flip sign — but
`cameraForCenter(lon, lat)` can only ever answer with the canonical
`rotX = 90 − lat` branch, inside `[0, 180]`. An orbit drag is deliberately
UNCLAMPED (dragging THROUGH the pole and down the far meridian is a feature,
not an edge case), so `camera.rotX` can genuinely leave that range and
`view.center` alone can no longer say which branch the camera is on.
Re-deriving it from `cameraForCenter` on the next `syncCameraToView` — a
wheel notch, `setView`, `resize`, `setTilt` — silently jumps to the OTHER
branch: same view AXIS, but 180° of ROLL about it, which point-REFLECTS the
whole screen (measured at `tilt: 0` — lon −150/lat 78 col 45.6 → 74.4, lon
−180/lat 88 row 52.5 → 7.5), and because `tilt` is ADDED to whichever branch
was picked (`camera.rotX = rotX + tilt`) a nonzero tilt makes the two
different AXES outright (at the page default `tilt: 40`, lon 0/lat 60 — rotX
28.663 → 51.337, rotY 0 → −180; with the surface-point pivot `view.center`
itself stays at screen centre through the flip, so the picture rolls and
re-pitches about it rather than leaving the grid, but it is the same
unrequested jump). `widget.ts` therefore holds the true (tilt-free)
`orbitRotation` the camera is actually on — recorded by `applyDrag`, the only
thing that can reach the non-canonical branch — and `orbitRotationFor` reuses
it whenever it still frames the requested centre, re-deriving the canonical
north-up branch only for a genuinely different one (`setView({ center })`,
`fitBounds`). The reuse test is a capability question asked of the projection
(`sameSurfacePoint(proj, proj.centerForCamera(held), center)`, compared
through `proj.project` so longitude wrap and the pole's arbitrary longitude
need no special case), never a projection-identity check, so a
`setProjection` to a different orbit projection whose inverse disagrees
simply falls back to its own canonical branch. This is what keeps the
view↔camera round-trip the identity PAST a pole, not just inside `[0, 180]`.

### Vector: strokes, contours, tiles (slice 5)

`GlyphMapLayer` includes `background`, `raster`, `line`, `contour`, `fill`,
`symbol`, `circle`, `heatmap`, `fill-extrusion`, and `model`. `fill` supports
attribute-to-color joins; symbols use stable greedy decluttering; circles and
heatmaps read point attributes; extrusions use height/base attributes; model
passes ordinary `Polygon[]` through.

**`fill`/`fill-extrusion` geometry (`layers.ts`'s `glyphMapVectorPolygons`)
decides orientation from real geometry and honours holes.** Source rings
arrive in EITHER winding (GeoJSON says CCW-outer/CW-hole, MVT the opposite,
real data neither), and glyphcss backface-culls on the sign of the projected
2x area in `scanFillTriangle` — so a wrongly wound ring is silently invisible
and a wrongly wound extrusion is inside-out, its walls facing into the solid.
Orientation is normalized in two independent steps, never from an assumed
input convention: (1) TOPOLOGY, in lon/lat — the outer ring to CCW and every
hole to CW by 2D signed area; that is the ring-to-ring relationship, which is
projection-independent, and it is what makes ONE wall formula correct for
outer and hole alike (walking a hole the other way puts its wall's front face
into the hole, i.e. away from the solid, which is exactly right); (2) FACING,
in world space — `mesh.ts`'s `localUpDirection` probe (exported for this;
internal to the package, not in `index.ts`) reports which way a small positive
elevation nudge displaces a point through `projection.project`
itself, and the NEWELL normal is compared against it. CAP faces are probed
INDIVIDUALLY, at each face's own lon/lat centroid — "up" turns with position
on a curved projection, so one verdict at the ring's mean cannot be right for
a group spanning tens of degrees — while WALLS keep the group's verdict, since
a wall's normal is tangential and the up probe says nothing about it (what
makes a wall outward-facing is step 1's ring topology, a whole-group property).
This is `glyphMapPolygons`'s own per-quad probe, for the same
reason: a flat sheet's frame and the globe's are independently chosen axis
mappings with no shared handedness, and `glyphMapFromD3Raw` can bring a third
with neither's. Step 1 alone settles every projection this package ships (all
of them are orientation-preserving); step 2 is what an orientation-reversing
d3 raw projection needs, and `layers.fill.test.ts` exercises it with one. A
probe that fails to project falls back to step 1's order rather than guessing.
The cap is TRIANGULATED with holes (earcut — the same tessellator
`@glyphcss/fonts`'s `extrudeContours` already uses for the identical
outer-ring-plus-holes shape, and now a runtime dependency of
`@glyphcss/maps` too), and every ring, holes included, grows its own wall, so
an extruded lake is walled from the inside. Emitting the outer ring as one
n-gon instead would not only fill its lakes: glyphcss fan-triangulates an
n-gon from vertex 0, which is only correct for a CONVEX polygon, and a
coastline is anything but. There is deliberately no floor cap — an extrusion
sits on opaque terrain, so its underside is never the depth winner. "Crop,
don't clamp" is unchanged: one non-finite vertex anywhere in a group discards
the whole group, since a partial cap would not match its walls. `heatmap`
does NOT share this code (it goes through `glyphMapPointHeatmap` plus
`glyphMapPolygons`, which has always carried the per-quad probe), and neither
does `model` (caller-authored `Polygon[]`, passed straight through).

**An extrusion's HEIGHT is exempt from the terrain's `exaggeration`; the
GROUND it stands on is not.** Every vertical quantity in the package went through one conversion,
`reliefZ` = `(metres / GLYPH_MAP_EARTH_RADIUS_M) * exaggeration`, and `/maps`
defaults `exaggeration` to 24 because true-scale relief is invisible at planet
scale (Everest is 0.14% of Earth's radius). A `fill-extrusion`'s
`render_height` took that same path, so an OSM building drew 24x too tall — a
20 m house at 480 m, a 60 m block at 1,440 m, taller than anything on Earth,
which is the reported "the height of the OpenStreetMap buildings seems a bit
disproportioned". Exaggeration is a statement about TERRAIN — it exists so a
mountain is legible against a planet — while a structure's height is a real
measured quantity, so `glyphMapVectorMesh` now converts `options.height`
through `glyphMapTrueScaleElevation(metres, projection)` (`metres /
projection.exaggeration`) before adding it to the base.

The GROUND deliberately keeps the terrain's factor. The ground a structure
stands on is wherever the exaggerated relief puts it, so de-exaggerating it as
well sinks every extrusion into the terrain it should be standing on — at
exaggeration 24 a ground of 1,000 m would sit 24x below the relief around it.
Exempting the ground *instead* of the height gets both halves wrong at once.
`layers.extrusionHeight.test.ts` pins the split from both sides: the world
height is bit-identical at exaggeration 1 and 24 while terrain at the same
metre count is 24x taller, and the base ring's world Z is exactly
`project(lon, lat, ground)`. Mutating the fix to divide the ground instead
prints `expected 0.0001569612305760477 to be 0.003767069533825145` for the
ground clause and `expected 1 to be close to 24` for the globe's radial
clause.

`GlyphMapProjection.exaggeration` had to become READABLE for this. `project`
is the package's one elevation conversion, and the factor is not recoverable
from its output: a sheet's `X`/`Y` are degrees while the globe's are Earth
radii, so there is no world-units-per-metre a probe of `project` could divide
out. Every projection here is affine in `elev` (`reliefZ` is one multiply), so
dividing is exact rather than approximate — `project(lon, lat, base + m/exag)`
is `project(lon, lat, base)` displaced along that projection's own local up by
exactly `m / EARTH_RADIUS_M` world units, which is what makes the globe's
radial case fall out with no globe-specific code. `exaggeration: 0` (relief
off entirely) is the one singular value: the axis has collapsed, so the metres
pass through unchanged and both quantities render flat, exactly as they
already did. `glyphMapProjectionTransition`'s blended projection lerps the
two endpoints' values, which is the shared constant throughout in practice
(`createGlyphMap` swaps geometry, never relief scale).

**A sheet's own axis anisotropy is untouched by this and worth stating.** On
`glyphMapEquirectangular`/`glyphMapMercator`/`glyphMapOrthographic`, `X`/`Y`
are DEGREES while `Z` is a fraction of Earth's radius, so one metre of height
is `1/6,371,000` of a world unit against one metre of ground at `1/111,320` —
vertical is compressed 57x relative to horizontal, per unit of exaggeration.
That predates this change and applies identically to terrain, `elevationBias`,
marker `elevation` and heatmap relief; the globe has no such mismatch (every
axis is Earth radii, so a true-metre extrusion there is exactly true 3D
shape). The practical consequence is that a true-metre extrusion is genuinely
small on a sheet — which is what `/maps`' own extrusion slider range (20 m to
2,000,000 m, its tooltip already noting that "a building-scale value is
genuinely sub-pixel at a global view") reflects, and what `heightScale`
exists to answer for a caller who wants a legible skyline there.

`GlyphMapVectorWall.elevTop` is consequently the cap's own AXIS elevation, not
the raw metre count — `glyphMapVectorCullWalls` feeds it straight back through
`project()` to decide whether a wall clears the globe's limb, and a true-metre
number there would over-reach the horizon by the exaggeration factor.

**The opt-in for a stylised skyline is `heightScale`, and no second option was
added.** `heightScale` is documented as "metres of extrusion per unit of
`heightProperty`" — a unit conversion — and a deliberate exaggeration is the
same multiply on the same metre count, so `heightScale: 24` on an OSM
buildings layer restores the old look exactly. Two options that multiply the
identical number would only make their product ambiguous. The flat `height`
fallback stays unscaled by it and needs no knob of its own for the same
reason: it is an authored literal, not measured data, so "make it taller" is
typing a bigger number.

**What was NOT exempted, and why.**

- `heatmap` relief. Its amplitude is a normalized DENSITY mapped onto a
  display height (`GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M`), not a measured one,
  and the layer's whole job is to read as relief sitting on the terrain it
  hugs. Exempt it and at exaggeration 24 the heat bumps become 1/24 of the
  mountains they are drawn against and stop being comparable to anything on
  screen. It is not a true-metre quantity, so there is nothing to be true to.
- `model`. Caller-authored `Polygon[]` in world space that never touches
  `project`, so it already inherits nothing — nothing to fix.
- Marker `elevation`. Documented as the same axis `glyphMapPolygons` lifts
  relief along, and its only real use (`website/src/components/MapsWorkbench/
  mapPin.ts`) is standing a pin ON the terrain. A pin that ignored
  exaggeration would float or sink exactly like a de-exaggerated extrusion
  base.
- `elevationBias` (the backstop sink) and the heatmap's surface lift. Both are
  explicitly documented as pre-exaggeration metres so they scale with the
  relief they must clear or avoid z-fighting against; that coupling is the
  point.

### An extrusion stands on the terrain, and `min_height` is not a ground

Stating the ground's exaggeration is only half a contract; the other half is
where the ground comes from. It used to come from the FEATURE: one `base`
option, fed `min_height ?? 0`, treated as an absolute elevation on the terrain
axis. With any `raster` layer mounted that plants every structure at SEA LEVEL,
and at `/maps`' own OSM view (globe, `exaggeration: 24`, 40 degree tilt, 4.8 m
per cell, ground at 400 m) a 60 m building drew **not one cell** — 9,600 world
metres underground — while a `line` at the same place still drew, because
`stroke.ts` had already been taught the ground offset. `widget
.extrusionGround.test.ts`'s first clause is that measurement; removing the
planting prints `expected 0 to be greater than 0`.

**`min_height` is a STRUCTURE measurement, not a terrain one, and the two were
being conflated.** OSM's `min_height` is metres above a building's own footing
— a tower starting at the top of a podium — in exactly the unit `height` is
in. So a single absolute `base` was carrying two different quantities at once,
and it took the wrong side of the exemption for both: it exaggerated the
structure offset (a 20 m podium drawn 480 m up at 24x — the identical defect
the height exemption had just fixed) while providing no ground at all. The
split is therefore into the two quantities:

- `GlyphMapVectorMeshOptions.groundElevation(feature, lon, lat)` — the TERRAIN
  under this piece, on the exaggerated axis, exactly like the relief mesh;
- `GlyphMapVectorMeshOptions.baseOffset(feature)` — TRUE metres above that,
  through `glyphMapTrueScaleElevation`, exactly like `height`.

On the layer, `baseProperty` became `baseOffsetProperty` (still defaulting to
`min_height`). A rename rather than a silent re-interpretation: the quantity
changed, and there are no BC shims here. It is NOT scaled by `heightScale`,
which converts a `heightProperty`'s own units into metres and has nothing to
convert here.

**ONE ground per polygon GROUP, at its outer ring's mean lon/lat** — the same
representative point `groupUp` already asks the projection about, now computed
once (`ringMean`) and shared. A structure is RIGID: one ground per piece keeps
its cap planar, its walls planar quads, and `GlyphMapVectorWall`'s two
elevations the scalars `glyphMapVectorCullWalls` re-projects. Per-VERTEX ground
would shear the cap over any slope, leave a wall no single pair of elevations
describes, and cost a tile lookup per refined vertex instead of per piece.

**The widget answers it with `groundElevationSampler` — the same one the
strokes use, not a second sampler**: the mounted `raster` layers' own tiles,
finest tier first, topmost layer first, `null` when no raster layer is mounted
at all. `null` means no `groundElevation` option is passed, the ground is the
datum, and the render is byte-identical to before planting existed (pinned as a
frame hash captured at `9191e4b`). A `fill` is deliberately NOT planted: it is
a flat overlay on the datum, and it has no walls to stand on.

**Staleness had to be answered, because a `fill-extrusion` on a STATIC source
is never rebuilt.** Its mesh is camera-independent by design, so
`scheduleTileUpdate` skips it — which is right for the camera and wrong for the
ground, since a building mounted while its terrain is still in flight would
stand at the datum for the life of the map (and be buried by the terrain that
arrives under it). `groundChangeSyncs` is the answer: the raster runtime calls
`notifyGroundChanged()` wherever its MOUNTED tile set changes, each listener
re-probes the points its own last build recorded, and only a real difference
triggers a rebuild. A registry separate from `nearSideSyncs` because the event
is different — the tile set, not the camera — and coalesced onto a microtask
since one raster update mounts across several turns.

Measured on the vendored Zurich Protomaps extract (`fixtures/pmtiles/
zurich-z12.pmtiles`, its `buildings` layer: 8 features, 469 polygon groups,
7,768 polygons, real MVT geometry, median of nine interleaved runs): the
planting adds **+0.02 ms to a 2.6 ms mesh rebuild** (~0.9%), and the re-probe
pass that runs per terrain change costs **0.013 ms** for all 469 groups.
Nothing runs per frame — the retained mesh is re-culled exactly as before.

**The horizon cull holds, and gets better.** `elev` and `elevTop` are both AXIS
elevations, so planting raises both by the ground: a wall on a mountain reaches
past the limb from that mountain's own `acos(r / (r + h))`, which is what the
terrain under it does too. `widget.extrusionHorizon.test.ts` pins both
directions — a box at 126-132 degrees is dropped whole at the datum and keeps
walls when planted on 1,200 km of ground (122.7 degrees of reach becomes
133.4), while a genuinely far-side box is still dropped whole with the same
mountain under it. Planting is not a licence to draw past the limb.

**What planting does NOT fix, and must not be confused with.** Under a TILTED
camera, anything standing on exaggerated relief is displaced by that relief's
own parallax: at `exaggeration: 24` and 4.8 m per cell, 400 m of ground moves a
building's image about 2,000 rows up the screen — off any viewport — while a
`line` layer, whose vertices are stamped at elevation zero, does not move at
all. That is a true statement about 24x relief seen at an angle, not a
regression this introduced (the terrain mesh has always been displaced by
exactly the same amount; a uniform terrain simply makes it unobservable), and
it is why `widget.extrusionGround.test.ts` measures visibility in PLAN view —
where an orthographic camera's view axis is the local radial, so a lift at the
view centre moves nothing sideways — and measures the base elevation itself on
a tilted camera with small grounds, as a displacement that is exactly linear in
the ground under it (5 m and 10 m of ground move the image 8 and 16 rows, and
the row EXTENT is unchanged, because the height is still true metres).

**On a CURVED projection those faces are refined until the projection is
locally affine across each one, and an extrusion's walls are culled against
`projection.visible`.** earcut triangulates in lon/lat and will join boundary
vertices tens of degrees apart; the face emitted for such a triangle is a
CHORD, not the surface. Measured on the real baked
`website/public/data/vector-tiles` pyramid: a z1 tile emitted a face with a
1.922-radius edge (96% of the sphere's own diameter) whose centroid sat 0.575
of a radius INSIDE the globe, and the z0 tile emitted faces whose plane was
tangent at the ANTIPODE — an "outward" normal aimed straight back at the
camera from the far hemisphere. That is one mechanism behind two reported
symptoms: a straight line drawn through the world, and far-side geography
showing over the near side. `edgeNeedsSplit` asks the PROJECTION (never a
projection id) whether an edge's projected midpoint still coincides with its
chord's midpoint, and red-green `refineTriangle`/`refineEdge` split until it
does; the verdict is a pure function of the edge's own two endpoints, so two
faces sharing an edge always agree and no T-junction can form, and a cap
boundary edge and its wall reach identical midpoints by the identical
predicate. An AFFINE projection (`glyphMapEquirectangular`) answers "no split"
with an exact zero deviation, so the flat path is untouched face for face
(`layers.globe.test.ts` pins the exact counts). `GLYPH_MAP_FILL_MIN_EDGE_DEG`
(0.5°) is the real terminator; `GLYPH_MAP_FILL_MAX_REFINE_DEPTH` (8) is a
safety valve for a pathological `glyphMapFromD3Raw` projection only, and the
one rule here that is not a pure function of an edge. A refined face whose
normal still lands more than 26° off the local up
(`GLYPH_MAP_FILL_MIN_FACE_UP_ALIGNMENT` = 0.9) is a degenerate SLIVER — three
nearly collinear points have an ill-conditioned plane however close together
they are — and is DROPPED: its facing is numerical noise, so it survives the
backface cull on the wrong hemisphere about half the time; the same degeneracy
makes its area negligible (measured: 0.9 is the first threshold that leaks
nothing at any distance behind the limb, at a cost of 3 of 388 near-side cells
on the real z0 admin_0 tile). Refined CAP faces then carry the surface's own
outward normal, so the rasterizer's backface cull removes the far hemisphere
for free, view-independently. WALLS cannot work that way — a wall is a
vertical curtain whose normal is TANGENTIAL, so roughly half of a far-side
ring's walls genuinely face the camera through the globe (measured 14 of 29 on
one far-side box; 200/340 leaked cells with/without a terrain layer mounted) —
only a near-side predicate can answer that, and it is CAMERA-dependent.

**That wall verdict is re-evaluated PER RENDERED FRAME, never baked into the
mesh.** `glyphMapVectorMesh(features, projection, opts)` is the camera-
INDEPENDENT build: it returns `{ polygons, walls }`, where `walls` reports each
wall face's index into `polygons`, its two ring endpoints in lon/lat, and BOTH
the AXIS elevations it spans (`elev` = the ground under that piece plus its
true-metre base offset, `elevTop` = that plus the true-metre height — per
group, since `heightProperty`/`baseOffsetProperty` and the terrain under a
footprint all vary), and
`glyphMapVectorCullWalls(mesh, visible)` then drops a wall when NONE of those
four (endpoint x base/top) corners passes the predicate. A wall is a quad, not
a segment, and it is visible if ANY part of it is: on a globe a point at height
`h` clears the limb from `acos(r / (r + h))` of extra arc, so a tall
extrusion's base ring can be well past the limb while its top — and therefore
most of its wall band — is genuinely in view (`widget.extrusionHorizon.test
.ts`). Testing the base pair alone made such an extrusion vanish whole the
instant its footprint crossed the limb; testing the top pair alone fixes
NOTHING on its own, because `glyphMapGlobe.visible` had to stop being a plain
centre-plane test first (see its own entry above — a centre-plane verdict is
radially scale-invariant, so base and top of one wall always agreed). The base
corner is tested first so a near-hemisphere wall — the overwhelming majority on
any real tile — still short-circuits after one predicate call. Dropping on
"none" rather than "not all" over-draws by at most one refined wall segment
past the limb instead of eroding a visible bite out of the silhouette; a KEPT
wall whose lower portion is behind the globe is over-drawn in full, which an
opaque terrain layer's own depth test hides and which is visible only when no
`raster` layer is mounted at all. A CAP needs none of this and deliberately
gets none: its outward normal is radial, so it turns away exactly at the 90
degree silhouette and the rasterizer's backface cull removes it there. The wall
rule is therefore strictly the more permissive of the two — a roof with no
walls is unreachable, and the walls-with-no-roof band past the limb is correct,
since the viewer is looking at the roof's underside, which the mesh
deliberately does not carry. `glyphMapVectorPolygons` is
`glyphMapVectorMesh(...).polygons` and no longer takes a `visible` option at
all. `createGlyphMap` builds the predicate from `projection.visible` plus its
own camera-depth function (`layers.ts` has no camera) and re-culls through
`nearSideSyncs` — the ONE registry draining every camera-dependent visibility
question the renderer cannot answer for itself, which a symbol/circle/marker
hotspot's hemisphere `visibility` already used. Each layer's cull memoizes on
the live camera (`rotX`/`rotY`/`zoom`/`target`), so repeated syncs with an
unmoved camera are a string compare; a `fill` layer (no walls) and every flat
projection (no `visible` capability) short-circuit to O(1).

Baking the verdict into geometry instead is what made walls "sometimes"
disappear: the mesh is rebuilt by `scheduleTileUpdate`, on a 180ms debounce
that EVERY moving frame re-arms, so through a drag and its inertial glide no
rebuild ran at all and the walls kept the verdict taken for a camera the view
had long since left — an extrusion the camera had turned to face drew its roof
and none of its sides, then popped them in once motion stopped (measured 0 of
41 wall faces for 681ms; `widget.extrusionWalls.test.ts` asserts per-snapshot
across a real glide against a reference map freshly mounted at that same view,
since a settled-view test always passes). Re-culling is also far cheaper than
the rebuild it replaces — measured on the real baked z0 admin_0 tile (177
countries, 2,058 wall faces): 0.5ms to re-cull against 13.7ms to rebuild —
and because the mesh is now camera-independent, `scheduleTileUpdate` no longer
rebuilds a `fill-extrusion` on a view change at all; it is the plain
provider-only condition every other layer kind uses.

`line` and `contour` render by
**post-raster stamping into the
scene's `CellGrid`** rather than mesh mounting: `createGlyphMap` composes
every mounted `line`/`contour` layer's `stamp(grid)` into ONE
`transformCells` hook (glyphcss allows exactly one), installed lazily —
zero `line`/`contour` layers means the hook is never touched, keeping the
raster-only byte-identical default true. `inkGlyphForTangent` (glyphcss's
tangent→glyph quantizer) is now exported from the `glyphcss` package root
(`index.ts`) for this — it already existed internally but was never
re-exported before this slice.

**Strokes are DRAPED on the terrain.** A `line` layer's vertices are
projected at the GROUND elevation under their own lon/lat
(`groundElevationSampler`, read from the tiles the mounted `raster` layers
actually have up, finest tier first), not at the datum. Everything else in a
`/maps` scene already stands on the exaggerated relief — the terrain mesh by
construction, a `fill-extrusion` through this same sampler — and under a tilt
that relief has PARALLAX, so a stroke left at the datum lands somewhere its
own ground is not. Measured at `/maps`' defaults (globe, `exaggeration: 24`,
40 degree pitch, 4.8 m per cell): 10 m of ground displaces the building
standing on it by **16 rows** and displaced the road beside it by **zero**,
so the two no longer coincided; 400 m displaces by ~2,000 rows, which is why
every fixture here measures single-digit metres. No raster layer mounted ⇒
the sampler is `null`, the ground is the datum for every vertex, and the
whole expression collapses to `projection.project(lon, lat, 0)` — the
pre-drape line, byte for byte, with no lookup at all (frame-hash gate in
`widget.strokeDrape.test.ts`).

**The depth contract, pinned** (`stroke.ts`): compare `project()[3] ??
project()[2]` against `CellGrid.depth`, larger = nearer. The allowance before
a nearer surface counts as OCCLUSION is now a SINGLE term — the ordinary
coplanar-surface bias:

**Reconstruct first, then forgive only the curvature.** Two different
quantities separate a draped stroke's depth from the surface's, and only one
of them is an allowance.

1. **A SAMPLING OFFSET, which is corrected.** `CellGrid.depth` is written by
   the rasterizer at the cell CENTRE (`rasterize.ts`: `px = x + 0.5`) while
   the stroke sits wherever inside the cell its own geometry puts it, so on a
   tilted view a stroke lying FLUSH on the surface reads up to half a cell of
   depth away from it for that reason alone. `stroke.ts` evaluates the
   surface at the stroke's own `(subCol, subRow)` using the grid's own local
   slope and compares there.
2. **FACETING, which is the allowance**
   (`GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE = 0.25`). A stroke is draped on
   the ground FIELD (`glyphMapGeoTileElevationAt`, bilinear over a tile's
   full vertex grid) while the terrain under it is rasterized from a
   COARSENED quad mesh (`glyphMapPolygons`' per-level `resolution`), whose
   chord cuts under every rise inside a quad. The two are near-coplanar, not
   coplanar.

**The allowance scales on the surface's SECOND difference, not its first**,
because faceting is a statement about ROUGHNESS and not about how steeply the
camera foreshortens the surface: a plane has no curvature at any pitch.
Scaling it on the SLOPE — the shipped `GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE =
0.5` — therefore granted a full half cell of depth on FLAT GROUND under a
tilt, which is metres, and that is the second reported "the roads are again
showing on top of the buildings": measured on the vendored Zürich z14 tile,
one row of a horizontal surface is 1.73e-6 of depth at a 60 degree pitch
(~12 m) where a two-storey building stands only 1.06e-6 in front of the road
beside it. At `/maps`' own default 40 degree pitch EVERY building of 6 m or
under was drawn straight through — all 23 cells of the road inside its own
footprint — while the 60 m tower `widget.strokeOcclusion.test.ts` pinned was
ten times over the threshold and never failed. The height at which a real
occluder became invisible was a function of the camera's PITCH and nothing
else, which is exactly the dimension that test had fixed.

`0.25` has a bound behind it rather than a tuning. For a locally quadratic
surface BOTH remaining errors are one EIGHTH of the second difference — a
linear reconstruction evaluated at most half a cell away departs by
`f''·(1/2)²/2`, and a chord's greatest departure from a parabola through its
own endpoints is `f''·L²/8` — and `0.25` is that doubled, because real relief
is not quadratic and a three-point second difference is itself a noisy
estimate of its curvature.

Measured, the two together (real vendored data, both directions):

| scene | before | after |
|---|---|---|
| Zürich z14, 60 degree pitch, one rail line over 1,991 footprints | 129 road cells drawn over building ink | 37 (25 of which are geometrically legitimate — the road really is in front there) |
| the same view, all 605 road features | 417 | 268 |
| the ridge fixture below (span 12, 40 degrees) — terrain fidelity, which must NOT regress | 71 cells / 61 columns / 0 breaks | 72 / 61 / 0 |

The floor is real and documented rather than padded away: at a 70 degree
pitch a 4 m building still fails, because at that pitch its roof and the road
beside it are inside the reconstruction's own error. Every ordinary height at
every pitch `/maps` offers is closed.

The ridge fixture is what keeps the allowance from being tuned to zero.
Measured there (3,800 m gaussian ridge plus 200 m of tile-scale roughness,
720x360 tiles, span 12, 40 degree pitch), the border inks **72 cells across
61 consecutive columns**; with `GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE`
mutated to `0`, **16 of those 72 go dark**, the border survives in 52 columns
and the run **breaks in six places**. Dropping the sub-cell reconstruction
instead leaves that test green and doubles the city defect (74 rail cells
against 37), so each half has its own gate: `stroke.test.ts` pins the
reconstruction on a plane with no curvature to hide behind, and the ridge
pins the allowance.

**Two allowances died here, and neither was reduced — both had their premise
removed.** Both existed only because a `line` vertex used to be projected at
elevation zero:

1. **A flat `GLYPH_MAP_STROKE_DEPTH_BIAS = 0.03`** — the ground offset stated
   as a guess. At `exaggeration: 24`, 0.03 earth radii is ~7,960 m of terrain,
   i.e. Earth's whole relief spent on every stroke everywhere. Sized to
   survive Everest it swallowed everything a city contains, which is the
   reported defect "buildings should cover the road layers clearly": measured
   at that view (globe, 40 degree tilt, 0.006 degree span, 140x63) a 60 m OSM
   building stands **1.1676e-5** world units in front of a road crossing under
   it, against an allowance of **0.0300006** — 2,570x too generous, so all 25
   crossing cells drew the road through the building.
2. **`GLYPH_MAP_STROKE_GROUND_MARGIN = 2`** — that same offset MEASURED, by
   projecting each vertex a second time at the ground under it and forgiving
   the difference (`1/cos(60°)`, the pitch-parallax term). Correct about
   WHETHER a stroke was occluded and silent about WHERE IT WAS DRAWN. It is
   exactly the projection the drape now IS.

For scale, the ground offset the two dead allowances existed to cover is
**~2e-2** at the ridge view (3,950 m at 24x), orders of magnitude above
anything the surviving curvature term forgives. The premise is gone, not the magnitude tuned. The drape also
costs LESS than the allowance it replaces: measured on 9,600 border vertices
at 160x64, span 12, 40 degree pitch with terrain mounted, the stamp is
**2.76 ms** draped against **3.26 ms** pre-drape (median of 3, 60 renders
each) — one projection per vertex where there were two. With no raster layer
mounted both are **~3.05 ms**, the same code path.

Gates: `widget.strokeDrape.test.ts` (position against an analytically derived
ground row, the building/road coincidence, the frame hash with no raster
layer, tier-following, and the unbroken run over a coarsened mesh),
`stroke.test.ts` (the allowance and its BOUND, both directions red),
`widget.strokeOcclusion.test.ts`, `widget.tiltedTileCulling.test.ts` (whose
border ink now lands on the ridge's own row at every span, derived the same
analytic way).

#### The third report was not about the allowance at all

`/maps?m=…M1a1a1a1a1a1h1a1a1a1a…w1` — "I can clearly see the roads above the
buildings". The `M` token is the per-row OSM density tuple, and it reads nine
rows at `1` and `omt-buildings` at `1.7`. That one number is the whole defect.

A mesh-backed layer whose `density` differs from the scene's pops into its own
`<pre>` (a glyphcss detail layer), while a `line` at `density: 1` is stamped
by the composed hook into the BASE grid — and a base grid's `CellGrid.depth`
holds the base pass's geometry and nothing else. The building was not merely
forgiven by a too-generous allowance; it was **absent from the buffer the
stroke tests against**, at every allowance and every building height.
Measured on `widget.strokeDensityOcclusion.test.ts`' fixture (Zurich, 0.006
degree span, 40 degree pitch, 140x63, a 60 m block on an 89 m footprint): all
**23 of 23** road cells strictly inside the footprint inked, over base cells
reading `-Infinity`, and **identically at `781486f` and at its parent
`2d27c55`** — the curvature allowance neither caused nor could affect it. The
three neighbouring pairings were already correct and are pinned beside it:
both layers at `1` (0 cells), both at `1.7` (0 — a stroke with a density of
its own goes to a meshless viewport overlay, whose depth pass is built from
every opaque mesh in the scene), and buildings `1` with roads `1.7` (0).

The fix is glyphcss's, not this package's, because only glyphcss knows the
answer: its cross-layer occlusion pass already BLANKS exactly those base cells
for belonging to the detail layer, it just could not say so — a blanked cell
is `" "` at `-Infinity`, byte for byte what open sky is. `rasterize` now
records the verdict on `CellGrid.occluded` (`docs/design/detail-layers.md`,
"Cross-layer occlusion") and `stampGlyphMapPolyline` honours it: **a stamp
paints a cell only in the grid whose layer owns it.** Nothing is lost, because
the same composed hook runs over every grid the frame renders, so the owning
layer stamps there against its own real depth — and the ink that used to
double up in a detail layer's own `<pre>` outside its silhouette goes with it.

`contour` was never exposed: its `requireSurface` gate already skips a cell
whose depth is non-finite, which is exactly what a blanked cell reads as.

Gate: `widget.strokeDensityOcclusion.test.ts`.

**Contour needs none of this and is byte-identical.** A `contour` layer
projects no vertex and runs no depth test at all: it samples per CELL
(`unproject(cell centre) → lon/lat → elevationAtLonLat`) and inks a level
crossing between neighbouring cells, gated only on surface COVERAGE. It never
carried a ground offset, so there is nothing to double-count. It does have the
MIRROR-IMAGE of the same parallax, unfixed and out of scope here: `unproject`
inverts at elevation zero, so a cell showing raised terrain is attributed the
lon/lat of the sea-level point under the view ray rather than of the terrain
point actually drawn there, which offsets the contour field against the relief
it annotates by the same 16 rows per 10 m at `/maps`' defaults. Closing it
needs a ray-march against the terrain, not a per-vertex sampler.

**Sub-cell stability.** The sampler reads MOUNTED tiles and the relief mesh is
built from those same tiles, so the two can never disagree about where the
ground is. Within one tier the sample is a pure function of `(lon, lat)` and
of nothing the camera does, so a pan, a zoom or an orbit moves a stroke
exactly as much as it moves the terrain under it — no shimmer is possible.
When a FINER tier lands the stroke DOES move, to wherever that tier says the
ground now is, in the same frame the terrain itself moves there: `stamp()`
resolves `groundElevationSampler()` on every call and holds no snapshot. A
stroke that did not move would be the defect — it would then be the only
thing in the scene still standing on the old tier. Gate:
`widget.strokeDrape.test.ts`'s tiered-provider test, which goes red when the
sampler is made to answer from the permanent floor tier instead of the finest
mounted one.

A `line` layer draws unconditionally through an empty (`-Infinity` depth)
cell — no base surface there means nothing to be occluded by. A `contour`
layer's `requireSurface` option (default `true`) instead gates on surface
coverage — an ANNOTATION of whatever surface won a cell, not an
independent 3D object — but degrades to `false` (draw wherever the field
itself is defined, ignoring `grid.depth`) whenever the widget has no
mounted `raster` layer at all: with no opaque base, every cell reads
non-finite depth UNIFORMLY, and the surface-gated read would blank the
whole layer rather than reading as "hidden terrain, draw everything."
`createGlyphMap`'s contour runtime recomputes this from the live
`layerStates` on every render, not a cached flag.

**A contour's elevation mosaic is sampled through each tile's VERTEX grid,
never through a cell-centered field derived from it.**
`glyphMapGeoTileElevationAt` (`tile.ts`) bilinearly interpolates a
`GlyphMapGeoTile`'s own `(cols+1) x (rows+1)` vertex grid, which is exactly
the bilinear patch `glyphMapPolygons` builds the relief from — so a contour
annotates the surface the terrain actually draws. The contour runtime and the
heatmap's ground-hugging terrain reader both read the mosaic through one
`GlyphMapElevationPiece.valueAt` (`widget.ts`), which wraps that for a
provider tile and `glyphMapFieldValueAt` for a static, already-sampled
`GlyphMapField` source.

This is load-bearing, not a refactor. Deriving a cell-centered field per tile
(one value per quad, the average of its four corners — what the runtime used
to do) places a tile's outermost sample HALF A CELL inside its own bounds, and
`glyphMapFieldValueAt` clamps past that, so a band one cell wide straddling
every shared boundary has no sample on either side and each neighbour
flat-extrapolates its own edge cell across it. The two extrapolations differ
by one cell of terrain gradient — measured at 39 m across a meridian boundary
and 59 m across a parallel one on a gentle synthetic terrain, with the true
value the midpoint of the two — and a contour inks wherever the field crosses
a level between neighbouring cells, so the STEP manufactures a crossing along
the whole boundary. On the real z3 pyramid those boundaries are the parallels
67.5/45/22.5 and eight meridians, which at a pole read as three concentric
octagons, mirrored at the south pole. Adjacent tiles SHARE their edge vertex
row/column (that is why the schema is vertex-centered at all), so vertex
sampling makes both sides agree bit-for-bit and the fix is exact rather than a
tolerance. Pinned differentially in
`packages/maps/src/widget.contourTileBoundary.test.ts`: the same terrain
rendered through an 8x8 tiling and through ONE global tile must produce
IDENTICAL cells — before the fix, 205 extra and 278 missing inked cells at a
north-pole view, the extra bucketed on those ring latitudes and seven of z3's
eight tile meridians.

**A globe view centred exactly on a pole still unprojects.**
`unprojectSphere` seeds its Newton iteration with the sub-observer point, and
at a pole that is a coordinate singularity — every longitude is the same
place, so the `(lon, lat)` Jacobian's longitude column is zero, the first
iteration reports a degenerate determinant, and EVERY cell returns `null`
(measured: 0 of 1,128 sampled cells at `center: [0, 90]`, against 357 a tenth
of a degree away). Everything that unprojects goes with it — `map.unproject`,
click-to-lonlat, and a `contour` layer's per-cell elevation lookup, so the
layer paints nothing at all. The start point (like every step the loop makes)
is therefore clamped to `POLE_SAFE_LAT` off the pole; latitude is degenerate
there whatever the camera is doing, and the iteration only needs a starting
point, not the exact sub-observer point.

**The depth test is NOT the far-side test, and a `line` layer is clipped
to the visible hemisphere BEFORE it is stamped.** An orthographic camera
maps the globe's far hemisphere onto the SAME screen disc as the near one,
so far-side border geometry projects inside the silhouette and reads as
lines drawn through the sphere. The depth test above cannot stop that: it
is explicitly a no-op wherever `grid.depth` is non-finite (the rule
directly above), which is every cell the terrain mesh does not cover — the
polar caps, the ring just inside the limb, and EVERY cell when no `raster`
layer is mounted. `widget.ts`'s `visibleStrokeRuns` therefore splits each
ring into the maximal runs lying on `projection.visible`'s own near side,
bisecting (16 steps, in lon/lat) to insert a real limb vertex at each
crossing, and `createLineLayerRuntime`'s `stamp` walks those runs instead
of the raw ring. Clipping the GEOMETRY, in the layer that owns the
projection, keeps `stroke.ts` pure and mirrors `vector/clip.ts`'s own
discipline exactly — real neighbouring geometry on the visible side of the
cut, and never a synthetic single-point fragment (a 1-point run draws
nothing, since `stampGlyphMapPolyline` walks SEGMENTS), so the
no-endpoint-special-case tangent contract below holds across a limb cut
exactly as it does across a tile seam. A projection with no `visible`
capability — every flat one, where `project()` returning NaN is already
its own exclusion — gets the ring back BY IDENTITY, so the flat path is
byte-identical. `contour` needs none of this: it reaches its field through
`unproject()` -> `unprojectSphere`, whose Newton solve is seeded from
`centerForCamera(...)` (the near-side sub-observer point) and additionally
gated on `projection.visible`, so it never resolves a far-side `(lon, lat)`
in the first place.

**A provider-backed `contour` layer holds a tile MOSAIC, not one tile.** A
`GlyphMapField` answers only inside its own `bounds` (`glyphMapFieldValueAt`
returns NaN outside them), so resolving the single tile containing
`view.center` — which is what the runtime used to do — capped the layer's
ink at that one tile's geographic box and silently skipped every cell
beyond it, with no error. What the symptom LOOKED like was purely a
function of the LOD the view resolved to (a z0 tile is the whole world and
hides the defect entirely; z1 is a hemisphere, z2 a quadrant), and
`view.center` `[0, 0]` sits exactly on a tile corner at every z >= 1, so
the box lay wholly east and south of screen centre. The contour runtime now
runs the SAME visible-set sweep the raster runtime does —
`candidateTileRange` + `isBoundsVisible` against one hoisted
`projectionGrid()`, keyed by `provider.resolveTile`'s resolved identity so
a degrading provider (`glyphMapCuratedProvider`) derives one ancestor's
field once, under the same in-flight guard and the same
`scheduleTileUpdate` debounce — and `levels` as a count or an `{ interval }`
resolves against the min/max of the WHOLE mounted mosaic (a per-tile range
would give neighbouring tiles different level sets and tear every contour
at the seams).

**Tangent orientation has no endpoint special case.** `stampGlyphMapPolyline`
walks each segment computing the local tangent from the segment's own two
endpoints — never a synthetic "this is where the line starts/ends" glyph.
This is what keeps a vector-tile-clipped cut end visually indistinguishable
from an interior point: the clipper (`vector/clip.ts`) never emits a
synthetic single-point fragment, always keeping real neighboring geometry
on both sides of a cut.

**The vector pipeline** (`vector/`): `decodeGlyphMapTopoJsonArcs` +
`glyphMapTopoJsonFeatures` read a TopoJSON topology (delta-encoded,
optionally quantized arcs; `~i` = arc `i` reversed) into
`GlyphMapVectorFeature[]`. `glyphMapSimplifyArcs`/`glyphMapSimplifyArc` run
Visvalingam-Whyatt (heap-based, O(n log n)) — area-based, not
distance-based, and critically over the SHARED ARC LIST, never over
resolved per-feature rings: two adjacent countries simplified independently
would decimate their shared border differently (sliver cells), because
each ring's neighboring context differs. Arc endpoints are never removed
(topology junctions). The per-point area threshold is
`(epsilonEquatorDeg · cos(lat))²` (`glyphMapAreaThresholdDeg`) — a fixed
equator-derived epsilon over-simplifies high-latitude coasts by up to
`1/cos(85°) ≈ 11.5×` under Mercator (`dy/dlat = 1/cos(lat)`), so the
per-point threshold shrinks toward the poles instead.
`glyphMapCellEpsilonDeg(degPerCell)` is half a glyph cell's geographic
size — the §6 "epsilon is free" bound, reused as a bake-time-per-level
constant (the pyramid levels ARE the discretized epsilon schedule), not
recomputed per live view.

`vector/clip.ts`'s `glyphMapClipPolyline(points, bounds, closed)` clips a
polyline/ring against a tile's box (Liang-Barsky), returning open
fragments. **`closed` does NOT add an implicit wraparound edge** — a closed
ring's `points` must already repeat its first point as its last
(GeoJSON/TopoJSON convention, and what `resolveRing` actually produces);
`closed` only gates merging the first/last OUTPUT fragment when the ring
happens to cross the boundary exactly at that shared vertex. Two adjacent
tiles clip the SAME segment against the SAME shared boundary constant with
the SAME formula, so the computed intersection point is bit-identical on
both sides — the mechanism that keeps a border crossing a tile seam
visually continuous.

**A FILL takes a different clip from a LINE, and both ship.** The open
fragments above are exactly right for a `line` layer and exactly wrong for
an area: a country crossing a tile boundary arrives as one open fragment
per tile, and `layers.ts`'s earcut closes an open ring with a straight
CHORD between its first and last point, so the filled region became
"fragment plus chord" rather than "country ∩ tile" — and a tile a country
SWALLOWS carries no fragment at all, so the feature was dropped from it
entirely. Measured through the real bake → decode → `glyphMapVectorPolygons`
→ `compileScene` path on the shipped z3 admin_0 pyramid, cells strictly
inside a country's own outline that came back blank: United States
1,905/3,112, Russia 770/909, Canada 1,674/2,864, Brazil 1,023/1,566,
Australia 1,728/3,034 — while Switzerland, Belgium and Lesotho, each wholly
inside one tile, were already perfect at 0. That split (large multi-tile
countries broken, single-tile countries fine) is the defect's signature.

`vector/clip.ts`'s `glyphMapClipPolygonGroup(group, bounds)` is the area
clip: Sutherland-Hodgman against the four half-planes of the convex tile
box, which WALKS the boundary to re-close the ring, applied to a whole
`[outer, ...holes]` group so a lake stays a hole of its own country instead
of becoming a second country. It reuses the same
`t = (bound - a) / (b - a)` intersection formula `clipSegmentToBox` uses;
unlike the polyline clip that is not a bit-identity guarantee, because
Sutherland-Hodgman applies its planes in sequence and a segment already cut
by one feeds slightly different endpoints to the next — a float-epsilon
residual in degrees, against a glyph cell that is tenths of a degree wide.
The antimeridian is handled by UNWRAPPING longitude rather than cutting
(the polyline path's drop leaves a ring open, and closing that with a chord
paints the very polar bar the cut exists to prevent): the ring becomes one
continuous ring in an extended longitude domain, and the piece past ±180 is
recovered by clipping against the box shifted a whole world east or west. A
ring that crosses the seam an ODD number of times never closes — it
encircles a pole (Antarctica) — and is closed over the pole its own
vertices sit nearest. Results after the fix, same measurement: United
States 2, Russia 3, Canada 35, Brazil 4, Australia 4; the untiled reference
render of the same geometry leaves 2 and 28 for the US and Canada, so what
remains is the fill mesh's own sliver guard and archipelago detail, not the
tile cut.

`GlyphMapVectorWireFeature.polygons` carries those closed groups ALONGSIDE
`lines`, never instead of it — they are two genuinely different cuts of one
source ring, and the border path must keep its open fragments. Verified: on
the shipped pyramid, all 1,078 baked `lines` fragments are byte-identical to
what the pre-change code emits from the same source. `topology.ts` supplies
the grouping (a TopoJSON `Polygon`/`MultiPolygon` now keeps its
`[outer, ...holes]` arcs and is tagged `geometryType: "polygon"`, while
`rings` stays flat and in source order for the line path). The pyramid grows
from 752 KB to 1.2 MB. Gate: `vector/tile.polygonFill.test.ts`.

**The antimeridian is cut BEFORE the box** (`vector/clip.ts`'s
`glyphMapSplitAtAntimeridian(points, closed)`, called by
`glyphMapBuildVectorTile` ahead of `glyphMapClipPolyline`) — the vector
twin of `splitGlyphMapGeoTileAtAntimeridian`'s raster rule above. Natural
Earth (and every ±180-duplicating source) writes a polygon spanning the
seam as ONE ring carrying vertices on both sides: the 50m source's Russia
ring 17 steps `[179.867, 69.012] -> [-180, 68.984]`, Fiji's ring 15
`[-180, -16.540] -> [180, -16.540]`, Antarctica's ring 3 `[179.622,
-84.268] -> [-180, -84.352]`. Read as a PLANAR segment — which is what
Liang-Barsky does — each of those is a 360°-wide bar at a near-fixed
latitude sweeping the whole world backwards, so the box clip deposited one
full-tile-width chord in EVERY tile at that latitude, in tiles the country
never touches; projected onto the globe those chords read as concentric
`2^z`-sided polygons ringing each pole (measured on the shipped z3 bake:
Russia at lat 65.05/68.99/70.99/71.53, Fiji at −16.50/−16.54, Antarctica
at −84.3, all 8 columns). **The render path cannot fix this** — after
clipping, each chord is an ordinary `tileLonSpan`-wide segment
indistinguishable from real geometry — so the cut has to happen at bake
time. A step wider than 180° of longitude is the test (no real simplified
edge spans that; every seam wrap does, by construction); the wrap segment
is DROPPED rather than interpolated to ±180, since both its endpoints
already sit on the seam and synthesizing one would invent a latitude the
source never states. A polyline with no wrap comes back BY IDENTITY, so
every non-wrapping ring bakes byte-identically to before, and a closed
ring's runs are rejoined through its own repeated start vertex so the only
cut is at the seam.

`vector/quantize.ts` quantizes to `GLYPH_MAP_VECTOR_TILE_EXTENT` (4096,
MVT's own convention) tile-local integers, delta-encoded
(`glyphMapEncodeQuantizedLine`/`glyphMapDecodeQuantizedLine`) — a point
exactly ON a tile edge quantizes to EXACTLY `0` or `extent` (no rounding
noise), which is what keeps the cross-tile bit-identity guarantee intact
through the wire format, not just the float clip math.

`vector/tile.ts`'s `glyphMapVectorTileBounds(z, x, y)` reuses the EXACT
same equal-angle lon/lat quadtree addressing `website/src/lib/
geoTilesProvider.ts`'s raster `tileBounds` already uses (`lonMin = -180 +
x·360/2^z`, doubling `cols`/`rows` per level) — not a second, Web-Mercator-
square scheme — so a vector provider's `zooms`/`bounds(z,x,y)` are directly
comparable to a raster provider's. `glyphMapTargetLOD` (`provider.ts`)
takes only the `{ zooms }` shape it actually reads, not the full raster
`GlyphMapProvider` interface, specifically so `GlyphMapVectorProvider` (the
SAME `GlyphMapProviderZoomLevel` record shape) works with it unmodified —
one LOD/visible-set codepath for both raster and vector tiles.
`glyphMapBuildVectorTile`'s bake order is load-bearing: simplify the WHOLE
level's arcs first, resolve features, THEN clip+quantize per tile — never
the reverse, for the same shared-border reason arc-level simplification
matters in the first place.

`vector/curated.ts`'s `glyphMapCuratedVectorProvider(base, { zoom, tiles })`
wraps a base vector provider with one DEEPER zoom level that only has real
tiles for a curated place's own bounds; every other tile at that depth
degrades to the base provider's own deepest ancestor tile covering the same
quadrant (exact quadtree containment via the shared addressing above) —
never blank, never a throw. `website/scripts/bake-vector-tiles.mjs` is the
reference baker: world-atlas's 110m/50m Natural Earth admin_0 TopoJSON for
a 4-level global pyramid (z0-1 → 110m, z2-3 → 50m — world-atlas ships no
10m file, so the z4+ → 10m tier from the design sketch is NOT reached for
the global pyramid) plus one curated place (Switzerland) baked one level
deeper at near-zero simplification straight from the 50m source.

**Attribution is derived from mounted layers, never hardcoded.**
`GlyphMapAttribution` (`{ name, url?, license, date? }`) lives on
`GlyphMapProvider.attribution` / `GlyphMapGeoTile.attribution` (raster) and
`GlyphMapVectorProvider.attribution` / `GlyphMapVectorFeatureCollection.
attribution` (vector) — a data source declares its own provenance once, at
the type level. `GlyphMapHandle.getAttributions()` walks the CURRENTLY
mounted layer list and deduplicates (`attribution.ts`'s
`glyphMapDedupeAttributions`, by `name`+`url`) on every call, so the result
changes as layers toggle and as curated tiles swap in.

**A raster layer's tiles of one TIER share one detail output.** At
`density > 1` every tile used to pop into its own `<pre>`, and two abutting
tiles then sampled coverage on two differently-phased lattices, leaving a dark
line along every tile boundary — a regular grid whose z3 latitudes sit within
a degree of the tropics and the polar circles, so it read as a deliberate
graticule. `mountTile` now stamps glyphcss's `GlyphMeshTransform.detailGroup`
(AGENTS.md's "Shared detail outputs") as
`glyph-map-raster:<layerId>:fine|fallback|floor`, so each never-black tier
renders into ONE grid. Per TIER rather than per LAYER on purpose: tiles within
a tier abut exactly and are what the seam runs between, while the three tiers
are near-coincident surfaces built at DIFFERENT mesh resolutions, and putting
those in one depth buffer would let them win alternate cells (speckle) instead
of being composited by the id-map as they are today. The group name is set
unconditionally, including at `density: 1`, where it is inert — `detailGroup`
never separates a mesh by itself, so that path stays byte-identical. Tiles
remain the unit of fetching, caching, `resolveTile` dedupe and eviction;
only the render GROUPING changed.

**`density` is a uniform field on every `GlyphMapLayer` type.** Every
MESH-BACKED layer (`raster`, `fill`, `fill-extrusion`, `heatmap`, `model`)
passes it straight through to glyphcss's own per-mesh `density` via
`glyphMapMeshTransform` (AGENTS.md's "Per-mesh detail layers" — the mounted
mesh pops into its own silhouette-fitted `<pre>` at `density`× the scene's
glyph resolution, cross-layer-occlusion-correct against the base grid for
free — entirely existing glyphcss machinery, not new work); `line`/`contour`
instead route a genuine (`!== 1`) value to their own meshless viewport
overlay grid (below), and `background` is a documented permanent no-op.
Measured caveat for an EXTRUSION specifically: a `density > 1` mesh's
cross-layer-occlusion boundary still leaves the documented residual seam, and
an extrusion's silhouette is its thin WALL band rather than a broad flat cap,
so it takes the worse end of it — on a 120x48 globe view with a 50x36-degree
box, coverage the density-1 control paints that goes blank at density 3 is
1,700 subcells (14.9% of the sampled silhouette band) for `fill-extrusion`
against 239 (1.6%) for the same box as a flat `fill`. It reads as a roughly
one-cell dark rim tracing the extrusion's footprint. `occlusionContourPx: 0`
was measured as a mitigation and makes it WORSE (6,176 subcells), so the
widget does not set it.

**`renderMode` is a per-LAYER field on every MESH-BACKED layer type**
(`raster`, `fill`, `fill-extrusion`, `heatmap`, `model`) and passes straight
through to glyphcss's per-mesh `GlyphMeshTransform.mode` via
`glyphMapMeshTransform` (`widget.ts`). A map is not one picture in one mode:
terrain reads as `solid` while an administrative overlay reads as `ink`.
Omitted — or set to the mode the scene is already rendering in — the layer
stays in the shared base grid, one pass, byte identical (glyphcss only
separates on a genuinely different mode; see "Per-mesh `mode`" above), which
is what keeps the raster-only default free. A `wireframe`/`ink` layer is
additionally mounted `transparent` (`GLYPH_MAP_EDGE_RENDER_MODES`): those
modes paint EDGES only, and glyphcss's shared occlusion id-map is a geometry
raster that would claim the layer's whole triangle footprint, blanking the
terrain the outline is drawn OVER. `solid`/`voxel` fill their coverage and
stay opaque. `line`/`contour` carry no `renderMode` and never will — they own
no mesh, are stamped post-raster, and already emit oriented stroke glyphs by
construction; `symbol`/`circle` mount DOM hotspots rather than geometry, so
they carry none either. The `/maps` page is the reference consumer: its Dock
has NO scene-wide render mode (nor feature-edge or crease-angle) control —
each is gated out of the SHARED `useRenderingFolder` by a `show*` opt-out
prop defaulting to today's behaviour, so `/gallery` is unchanged — and the
scene's own mode is pinned to `solid` while every mesh-backed layer card in
the left rail carries its own `mode` row.

**`glyphPalette` is a per-LAYER field on the same five mesh-backed types**,
routing to glyphcss's per-mesh `GlyphMeshTransform.glyphPalette` through the
same `glyphMapMeshTransform`. It is the CHARACTER ramp — which glyphs carry
the shade — and it composes with, never replaces, a `raster` layer's `colors`,
which is the elevation-band COLOUR ramp. `line`/`contour`/`symbol`/`circle`
carry none, for exactly the reasons they carry no `renderMode` (glyphcss
documents `glyphPalette` as a no-op for a post-raster stroke path anyway).

**The "same ramp is free" escape lives in this package, not in glyphcss, and
it is exact rather than approximate.** glyphcss's `isDetailMesh` separates on
ANY non-null per-mesh `glyphPalette` on purpose: an unrecognized name resolves
to the default ramp, so two DIFFERENT names can mean one ramp and an inequality
test there would be unsound in the direction that matters to it. That
asymmetry does not touch the test `glyphMapMeshTransform` actually makes — two
EQUAL names always resolve to one ramp, known or not — so comparing the
layer's ramp against the scene's own live `glyphPalette` and simply not
setting the per-mesh option is correct, and it is what keeps the default
(every layer on the scene's ramp) byte-identical. The scene's palette is read
LIVE at mount via `scene.getOptions()`; a later `map.scene.setOptions({
glyphPalette })` through the escape hatch does not re-evaluate already-mounted
meshes, so re-add the layer — which is how every other per-layer appearance
change on this widget already works, there being no live setter for one.

Measured (`bench/maps-render`, `--scenario orbit --encoding spans`,
1440x900, grid gate `140x63` held on every row, one-quad `model` probe added
through `--layer`, two runs each):

| configuration | fps | task ms/frame | script ms | base-raster | base pass polys |
|---|---|---|---|---|---|
| no probe layer (baseline) | 41.7 / 41.9 | 23.93 / 23.82 | 19.81 / 19.72 | 16.73 / 16.68 | 65,312 |
| probe `glyphPalette: "default"` — the scene's own ramp | 41.3 | 24.16 | 20.12 | 17.05 | **65,313** |
| probe `glyphPalette: "blocks"` — separated, opaque | **29.4 / 28.5** | **34.04 / 35.00** | **29.83 / 30.70** | 15.89 / 16.35 | 65,312 |

The `65,313` row is the escape working in-page rather than argued: the probe's
own quad is IN the base pass's polygon count, so no separate output exists at
all and the run is inside baseline noise. The diverging row is the same shape
the per-layer-mode `voxel` row above measures — `base-raster` is flat or
lower, so the whole ~+10.4 ms is outside it, in `computeOcclusionIds`
rastering all 65,312 polygons into the shared id-map once per render because
one opaque detail layer now exists.

The `/maps` page is again the reference consumer, on the same argument as
`mode`: no scene-wide "Glyph palette" row in the Dock (gated out of the shared
`useRenderingFolder` by a `showGlyphPalette` opt-out prop, same shape as
`showRenderMode`/`showDensity`), scene ramp pinned to `default`
(`MAP_SCENE_GLYPH_PALETTE`), and a `glyphs` row on every mesh-backed layer
card. The Terrain card's colour-ramp row is relabelled from `palette` to
`colors` in the same change: one card now carries two ramps, and "palette"
names neither unambiguously. Terrain's ramp keeps the retired scene-wide
control's URL token `g` — the same "closest honest translation" token `m` made
when the scene-wide `renderMode` was retired (an older link's `g=blocks` now
reads as "terrain in blocks"); the demo layers' ramps are page-local, like
their colours and modes.

A `line`/`contour` layer follows every grid it crosses instead of owning
one of its own: `createGlyphMap` composes every mounted stroke layer's
`stamp(grid, cellToSceneGrid)` into ONE `transformCells` hook, and glyphcss
invokes that hook once per output grid it produces — the shared base grid,
then each per-mesh detail grid in turn — so a border or contour is stamped
into ALL of them, each at that grid's own resolution and depth-tested
against that grid's own depth buffer (`GlyphTransformCellsLayer
.cellToSceneGrid`, AGENTS.md's `transformCells` doc, is the affine that
makes this possible: it maps a grid's own cell coordinates back to the
scene's base-grid coordinates, so a stroke projected once in scene space
converts into whichever grid is currently being stamped). This is what
fixed a real defect: a raster layer mounted at `density > 1` moves its
geometry ENTIRELY into its own detail grid and gets blanked out of the
base grid by cross-layer occlusion, and a stroke that only ever stamped
the base grid vanished across that whole layer's footprint with no error.

`density` on `line`/`contour` now has TWO meanings, resolved by
`widget.ts`'s `strokeLayerStampsIntoGrid`. `undefined`/`1` (the default)
keeps the behavior above — the layer follows every surface it crosses,
with no resolution of its own to raise. A genuine value (`!== 1`) instead
asks for the layer's OWN independent resolution, decoupled from every
mesh's: `createGlyphMap` routes it through glyphcss's
`scene.setViewportOverlayDensities` — a meshless, full-viewport output
grid at that density (AGENTS.md's "Meshless viewport-wide overlay
outputs") — and the layer stamps ONLY into the matching overlay grid, not
into the base grid or any mesh's detail grid, so the same stroke is never
drawn twice at two different resolutions. `syncViewportOverlayDensities`
recomputes the requested set (deduped, `1` excluded) from every mounted
`line`/`contour` layer's own `density` on every stroke-layer add/remove —
a layer's `density` can't change after `addLayer` (no per-layer setter),
so no other event needs to trigger it. This is what lets a Terrain layer
render at `density: 1` while its Contour sits on its own `density: 3`
overlay, independently sharper, still correctly occluded by whatever
terrain (base or detail, any density) actually sits nearer. `background`'s
`density` is a documented permanent no-op (a flat CSS colour has no glyph
resolution to multiply).

`fill`/`symbol`/`circle`/`heatmap` all shipped in later work (see
"`symbol`/`circle`/`heatmap`: point layers over the populated-places
pyramid" below) — this list is no longer accurate as an "out of scope"
note and is kept only for the remaining gaps: choropleth, day/night, and
motion export. No React/Vue surface yet.

**`symbol`/`circle`/`heatmap`: point layers over the populated-places
pyramid.** All three read `GlyphMapVectorProvider` POINT features exactly
like `fill` reads polygon ones — `symbol`/`circle` mount one DOM hotspot
per feature (`createPointFeatureRuntime`), `heatmap` bakes a
`glyphMapPointHeatmap` density field into a synthesized relief tile
(below). `website/scripts/bake-place-tiles.mjs` bakes the reference
dataset the `/maps` page points all three at:
`ne_50m_populated_places_simple` (Natural Earth, public domain, pinned
tag) into the SAME quadtree vector-tile pyramid format
`bake-vector-tiles.mjs` uses for country polygons — `place-tiles`,
distinct from `vector-tiles` because points and polygons have different
LOD-thinning rules (Natural Earth's own `scalerank` column vs.
Visvalingam-Whyatt epsilon) and a page that never turns a point layer on
shouldn't pay for it. Three baked `sourceLayer`s share one pyramid:
`places` (every place, thinned per zoom by `scalerank`), `capitals`
(`adm0cap === 1`, unthinned, 200 features), `megacities` (`pop_max >=
5,000,000`, unthinned, 53 features) — `website/src/lib/
placeTilesProvider.ts`'s `PLACE_TILE_LAYERS` re-exports the three names so
the page's dataset picker and the bake script cannot drift apart. Feature
properties are Natural Earth's own column names verbatim (`name`,
`pop_max`, `adm0name`, `scalerank`) plus one derived column, `pop_scale` —
population log-normalized to 0..1 over 1e3..4e7 people (baked, not a
runtime expression: `@glyphcss/maps` layers read column DATA, not
expressions, and population is log-distributed over four decades — a
linear scale makes Tokyo a single 357x dot and 1,200 invisible ones).
`/maps`' own demo cards default `symbol` to `capitals`, `circle` to
`megacities`, `heatmap` to `places`.

`model` has no dataset of its own — it takes caller-authored `Polygon[]`
with no source to revive — so `/maps`' demo card gives it the one thing a
map genuinely wants in 3D and no other layer type expresses: a landmark
spike (`website/src/components/MapsWorkbench/mapPin.ts`'s
`buildGlyphMapPinPolygons`, a four-sided pyramid with no floor cap)
standing on the terrain at Zermatt/the Matterhorn, rebuilt against the
live projection whenever it changes. Its winding is decided by a
handedness PROBE (`localUpDirection`'s own technique — nudge along `elev`
through the LIVE projection, cross-product against the result) rather than
a fixed order, since a caller-supplied `glyphMapFromD3Raw` projection can
mirror the frame `mapPin.ts` cannot assume.

**`heatmap`'s relief hugs the real terrain surface, not the datum.** The
density field (`glyphMapPointHeatmap`) is unitless after normalization —
its own elevation channel is ONLY ever `density * reliefHeight`, which
put a zero-density vertex exactly at elevation 0 regardless of what was
actually there: floating over ocean basins, buried inside mountains, and
(the reported live defect) visibly "not glued to the planet" wherever the
dataset is sparse. `createHeatmapRuntime`'s own `createHeatmapTerrainReader`
resolves an elevation MOSAIC — reusing the contour runtime's own
`loadGlyphMapContourField`/`glyphMapFieldValueAt` machinery, a SEPARATE
instance rather than a shared cache, since a heatmap layer's mounted
lifecycle is independent of any contour layer's — over whichever `raster`
layer is currently mounted (found by kind in `layerStates`, mirroring the
contour runtime's own `hasOpaqueSurface` lookup). Every heatmap VERTEX's
elevation is `terrainElevationAt(thatVertex'sLonLat) + lift + density *
reliefHeight` — looked up per vertex (the same `glyphMapGeoTileVertexLonLat`
mapping `glyphMapPolygons` itself uses), not a per-tile average or
constant, so the relief genuinely follows the ground it sits over. With NO
raster layer mounted, the mosaic is empty and elevation resolves to the
honest datum (0) — not a bug, since there is then no terrain for the
relief to hug. Both terrain's own elevation and the heatmap's stay in RAW
metres, pre-exaggeration: `glyphMapPolygons` feeds them through the SAME
`projection.project(lon, lat, elev)` call terrain uses, which is what
applies `exaggeration` — the heatmap code must never multiply by it a
second time. `lift` (`GLYPH_MAP_HEATMAP_SURFACE_LIFT_M`, 10 raw metres) is
added ONLY when a raster layer is actually mounted (`terrain.hasTerrain()`
— not "elevation resolved to 0", which is indistinguishable from genuine
sea-level terrain): two independently-meshed surfaces sharing one exact
depth would z-fight per cell as the camera moves, which reads as
shimmering and is a worse defect than the floating bug this exists to
fix; with no terrain mesh to fight there is nothing to lift away from, so
a flat, terrain-less heatmap keeps its pre-existing bounded-relief
contract (`[0, reliefHeight]`) exactly. The colour ramp reads DENSITY, not
absolute elevation — since `elevation[]` now carries terrain + lift +
relief, `glyphMapPolygons`'s own per-quad `elevCenter` (the 4-corner
average it hands to `color`) is no longer proportional to density alone,
so `createHeatmapRuntime` builds its own `colorByCenter` map from that
SAME combined-elevation average (computed identically — same 4 corners,
same order, same division, so the float value is bit-exact and safe as a
lookup key) back to the density-only relief average that drove it.

**A hotspot's hemisphere-visibility (`opacity`/`visibility`, the channel
`syncMarkers()` owns) is kept synced to the camera on every `pointermove`,
not only once the widget's own deferred motion frame gets around to it.**
`applyDragState` updates `camera`/`view` synchronously per drag delta, but
`syncMarkers()` was previously reachable only from the widget's OWN render
call sites (`motionStep`, `setView`, etc.) — deferred to the next `rAF`
even though `map.scene` is a documented escape hatch any caller may reach
into directly. The reported live symptom: "when you move with some
inertia and the globe keeps spinning, before finishing the spin some
labels of the symbol layer that shouldn't be visible flicker into view and
disappear." `/maps` itself triggers it — `MapsWorkbench.tsx`'s own
`pointerup` handler calls `map.scene.rerender()` synchronously (to settle
an `interactiveDownscale` font-size change) right after the widget's OWN
`pointerup` handler has already applied the final drag delta and released
into an inertial glide, but BEFORE the deferred motion frame that would
otherwise call `syncMarkers()` has run. That raw `rerender()` re-stages
glyphcss's own `display` from the fresh camera (an on-grid-but-far-side
symbol becomes `display: ""`) but never touches `opacity`/`visibility` —
so a symbol just carried to the far side by that drag stayed visibly shown
at its stale near-side opacity for one frame. `applyDrag` now calls
`syncMarkers()` itself, synchronously, right after `applyDragState` —
closing the window for ANY external caller, not just this one, since the
DOM is then never more than one drag increment stale.


## OpenStreetMap: the Protomaps schema mapping (`vector/protomaps.ts`)

`pmtiles.ts` reads an archive; it never knew what is IN one. That gap is why
the reader shipped with a working `new PMTiles(url)` branch, a real MVT
decoder and a vendored 150 KB extract — and no path from any of it to a
rendered map. This slice closes it.

### What the archive actually contains

Read out of `fixtures/pmtiles/zurich-z12.pmtiles` — its own `vector_layers`
metadata and both of its tiles — not out of the published schema docs. It is a
planetiler build of the Protomaps basemap over OSM data, zoom 12 only, bbox
`8.52,47.36 → 8.56,47.39` (two tiles, `12/2144/1434` and `12/2145/1434`).

| source layer | zooms | geometry | discriminator (`kind`) | other columns used |
|---|---|---|---|---|
| `roads` | 3–15 | line | `highway`, `major_road`, `minor_road`, `path`, `rail`, `ferry` | `kind_detail` (`motorway`…), `name`, `ref`, `is_bridge`, `is_tunnel`, `min_zoom` |
| `water` | 0–15 | point + line + polygon | `water`, `river`, `canal`, `basin`, `swimming_pool` | `kind_detail`, `name` |
| `landuse` | 2–15 | polygon | `meadow`, `residential`, `grass`, `pitch`, `farmland`, `school`, `forest`, `park`… | `sort_rank` |
| `buildings` | 11–15 | polygon | `building` | `height`, `min_height`, `addr_housenumber` |
| `places` | 1–15 | point | `locality`, `neighbourhood`, `macrohood` | `name`, `kind_detail` (`city`), `population`, `population_rank`, `wikidata` |
| `pois` | 5–15 | point | `station`, `hospital`, `university`, `peak`, `park`… | `name`, `elevation`, `iata` |
| `boundaries` | 0–15 | line | `county`, `locality` | `kind_detail`, `disputed`, `brk_a3` |
| `earth` | 0–15 | line + polygon | `earth`, `cliff` | `name`, `min_zoom` |
| `landcover` | 0–7 | polygon | — | (absent at z12) |

The discriminator is a plain `kind`. Pre-v4 archives spell it `pmap:kind`;
`glyphMapProtomapsKind` reads either, so a caller never has to know which
generation of archive it was handed. `protomaps.test.ts` re-derives the whole
table from the fixture on every run — a schema drift is a red test, not an
empty layer.

### The mapping

`GLYPH_MAP_PROTOMAPS_LAYERS` is a `(source layer, kind, geometry) → glyph
layer type` table, and the second and third axes are not decoration. `roads`
is one layer holding a motorway and a garden path; drawn undifferentiated it
is not a map. `water` is one layer holding rivers as LINES and lakes as
POLYGONS; `sourceLayer` cannot separate them and a `kind` list cannot either
(a river polygon and a river line share `kind: "water"` with
`kind_detail: "river"`). So a spec carries both, and
`glyphMapProtomapsFeatureFilter({ kinds, geometry })` is the predicate.
`glyphMapProtomapsLayers(extract, { kinds, colors, densities, include })`
builds ready-to-mount layers; a spec whose source layer the extract does not
hold produces NOTHING, so a rail built from the result can never offer a
toggle that draws nothing.

`buildings` maps to `fill-extrusion` on `height` because that column is real
OSM data, not a synthetic magnitude — it is the one layer in the vocabulary
whose source already speaks metres.

### Why an extract, not a mounted provider

PMTiles is Web Mercator addressed. Every tile pyramid in this package — and
therefore `createGlyphMap`'s sweep, which runs through
`glyphMapTileRangeForLevel` — is equal-angle addressed. At z12 the Zurich data
lives at Mercator `y = 1434`; the equal-angle formula over the same bbox
answers `y = 1025`, whose tile bounds sit above 60°N. A sweep would enumerate
tiles the archive does not hold and never request either of the two it does.
`protomaps.test.ts` asserts exactly that divergence.

Retiling Mercator onto the equal-angle grid is real machinery, and there is no
data here to justify it: an extract is a handful of tiles at ONE zoom, so
there is no LOD ladder for a provider to select across and nothing for the
sweep to add. `glyphMapProtomapsExtract` therefore reads the archive's tiles
once, up front, into one `GlyphMapVectorFeatureCollection` per source layer,
with a `maxTiles` ceiling (64) that throws with the count rather than trying
to pull a world pyramid into memory.

### `GlyphMapFeatureFilter`

`filter?: (feature) => boolean` on `line`, `fill`, `fill-extrusion`, `symbol`,
`circle` and `heatmap`, applied after `sourceLayer` and instead of it for a
static collection. A predicate rather than a declarative match spec because
the alternative — pre-splitting features into one collection per rendered
layer — is impossible for a provider-backed source, whose tiles arrive after
mount and are refetched as the view moves.

Four code paths consume it: the `line` runtime's static and provider branches,
and `createFeatureLayerRuntime`'s two. Each has its own test. The provider
branch of `createFeatureLayerRuntime` initially had none — a mutation that
deleted the filter there survived the suite, which is what added the test.

### Attribution

OSM data is ODbL: a derived rendering must credit "© OpenStreetMap
contributors". Nothing on the page writes that string. Every collection
`glyphMapProtomapsExtract` produces carries
`GLYPH_MAP_PROTOMAPS_ATTRIBUTION`, `getAttributions()` walks the mounted layer
list, and the page renders whatever comes back. `widget.osm.test.ts` gates
both directions — mounting adds the credit, removing the last OSM layer
withdraws it — and that mounting N layers credits OSM exactly once.

### Hosting: OpenFreeMap, not a vendored extract

Protomaps ask people to self-host rather than read from their buckets, and
their public demo bucket 404s, so the vendored 150 KB Zürich archive was never
a candidate for a default fetch URL — it was copied into the website's
`public/` at build time and read whole. That made the /maps OSM card the one
card on the page whose DATA DID NOT COVER THE VIEW: ~4 km at one zoom on a
page that opens on the globe.

The page now mounts `glyphMapOpenFreeMapProvider` instead — OpenFreeMap's
whole planet, OpenMapTiles schema, z0–z14, no API key and no registration,
which is public hosting the service explicitly offers (that is why it is the
default; nothing here points at anyone's private infrastructure). It is a
`GlyphMapVectorProvider`, so the widget's existing sweep streams it: tile
cache, in-flight guard, 180 ms gesture-gated debounce, LOD by
degrees-per-cell. `MapOsmSourceOptions.tileUrl` takes a `{z}/{x}/{y}` template
for a planet you host yourself; opt-in, never a default.

The vendored archive stays where it was — it is the basis of
`pmtiles.fixture.test.ts`, `protomaps.test.ts` and `widget.osm.test.ts`, which
are the tests that keep the PMTiles/Protomaps reader honest — it is simply no
longer shipped to the website. `website/scripts/copy-osm-fixture.mjs` and the
`dev`/`build` steps that ran it are gone.

**Why the page wraps the provider's loader.** Every mounted layer runs its own
tile sweep with its own cache (`widget.ts`'s `createFeatureLayerRuntime`), and
the card mounts up to ten layers on ONE provider. Their sweeps run in the same
tick, so without deduplication a world view costs one request per ENABLED ROW
for the very same `0/0/0`. `createOsmSource` shares IN-FLIGHT requests by
address — in-flight only, because each layer runtime already retains what it
fetched and a second retained cache here would pin the whole panned-over
planet in memory to save a hit the browser's own HTTP cache absorbs. Measured
through the real widget with all four default rows mounted
(`mapsOsmMount.test.ts`): 1 tile at a world view (z0), ≤ 24 at a country view
(z5), ≤ 24 at a city view (z12) — the same counts the single-layer probe in
`widget.mercator.test.ts` records, which is the point.

### What the coverage UI lost, and why nothing replaced it

Three rows and a button existed on that card ONLY because the data was a 4 km
box: an `extent` row printing the bbox, a live `coverage` row saying whether
the current view was on it, a `fly` button that framed it, and a flight fired
on the enable edge so the toggle produced a visible result. With the planet
mounted there is no box to be outside of and nowhere in particular to fly to,
so all four are deleted rather than kept as controls that would state a
coverage limit that no longer exists. What replaced them is one provenance row
(`mapOsmSourceLabel` — service, schema and zoom ladder, all read off the
provider) and a `tiles` line that appears ONLY while tiles are actually
missing.

The tilt lesson the flight taught has since been fixed at the source rather
than worked around. `tilt` used to swing the camera about the globe's CENTRE,
so at the ~0.11° a city view needs, the page's default 40° put the view centre
at row −22,775 of a 63-row grid; it now pitches about the surface point under
`view.center` ("Camera tilt" above), so the destination is at the centre of
the grid at every span and pitch. `MAP_SEARCH_FLY_TILT = 0` and the levelling
in `flyToMapSearchResult` are therefore dead page code — the flight can keep
the reader's pitch. `mapsSearch.flyTilt.test.ts`'s assertion (the destination
is on the grid, via `map.project()` against the real widget) is the part worth
keeping, and it holds at any pitch now.

**Failure.** A tile that 404s, times out or arrives undecodable resolves EMPTY
rather than rejecting: the sweep awaits a `Promise.all` over every missing
tile in the visible set, so one rejection would drop a whole frame's fetch and
blank layers that had nothing wrong with them. That region simply has no data
this frame. `onError` is how the card still gets to say how many, instead of
the reader guessing why a render looks thin.

### One density PER ROW, and the two opposite costs behind it

The card mounts one layer per OpenMapTiles row and used to hand all ten of
them a single number (`mapOsmLayers` fanned the card's one slider out over
every enabled row), so a reader who wanted ROADS sharpened had to sharpen
land cover with them. `glyphMapOpenMapTilesLayers(source, { densities })` had
taken a per-row record from the day it was written; the page was the only
thing collapsing it. Each row now carries its own control on its own line,
`MapOsmLayerOptions.densities` is that record, and nothing in
`@glyphcss/maps` changed.

**Master and per-row.** The RECORD is the single source of truth — there is
no second master value in page state. The card's surviving one-drag control
is derived both ways: it WRITES every row (`mapOsmDensityRecord`, an
overwrite, never a ratio — a ratio makes "all of it, this dense" unreachable
from any mixed state without flattening it by hand first) and it READS as the
shared value or as **"mixed"** (`mapOsmMasterDensity` answers `null`), because
no single number is true of ten different ones. A mixed slider's thumb sits at
the mean of the rows shown: a range input needs a position, and the mean
belongs to no row, so it cannot be read as a claim about one.

**The two costs are opposite, which is why the card states them per row
rather than once.**

- A `fill`/`fill-extrusion` row is **free** to differ. A mesh-backed vector
  layer mounts with `meshTransform(layer, layer.density)` and NO
  `detailGroup` (only a raster layer's tiles are grouped, `widget.ts`), so it
  already popped into its own `<pre>` the moment it left 1x. Water at 2x and
  buildings at 3x is exactly as many passes as both at 2x.
- A `line` row is **not**. A stroke owns no mesh; it is stamped post-raster,
  and `syncViewportOverlayDensities` routes the SET of distinct, non-1 stroke
  densities to `scene.setViewportOverlayDensities` — so the card's three
  stroke rows (waterways, roads, boundaries) sharing one number cost ONE
  full-viewport overlay grid and holding three cost THREE, each with its own
  geometry depth pass.
- `symbol`/`circle` rows read no density at all (nothing in `widget.ts`
  consumes it for the two hotspot-mounting types), so their control is
  disabled with that reason rather than offered as a knob that does nothing.

**Measured**, 140x63 over a relief mesh with three stroke layers mounted
(median of 60 renders, node/happy-dom, so read the RATIOS rather than the
absolute milliseconds):

| stroke densities | overlay grids | ms/render |
|---|---|---|
| 1 / 1 / 1 | 0 | 6.6 |
| 2 / 2 / 2 | 1 | 27.4 |
| 2 / 2.1 / 2.2 | 3 | 63.4 |
| 2 / 3 / 4 | 3 | 86.2 |
| 3 / 3 / 3 | 1 | 63.6 |
| 4 / 4 / 4 | 1 | 117.7 |

The 2 / 2.1 / 2.2 row is the one that isolates the claim: three grids at
essentially ONE resolution cost 2.3x one grid at that resolution, so it is the
grid COUNT being charged for and not the sharpness. (2 / 3 / 4 then adds the
resolution cost on top, and 4 / 4 / 4 shows a reader can spend as much on one
sharp shared grid as on three distinct ones.) That is material, so the card
says it twice where the choice is being made: in each stroke row's own
tooltip, and as a live `stroke grids` info row counting the distinct non-1
densities the ON stroke rows are currently asking for
(`mapOsmStrokeOverlayCount`, derived in the panel from rows it already has —
no page state, and it moves in the same render as the slider that caused it).

**On the wire.** Token `Q` (`osmDensity`) is a single float and is in links
already shared. It stays, decoding exactly as it did, and
`readInitialMapsState` seeds EVERY row from it when a link carries no per-row
token — which is not a fallback but the map that link described, since that
one number was applied to every enabled row when it was written. The new token
`M` (`osmDensities`) carries the vector as a `floatTuple` of
`MAPS_OSM_DENSITY_SLOTS` = 10 slots at step 0.1, positional over
`MAPS_OSM_SUBLAYER_KEYS`. A tuple, where the six per-LAYER densities beside it
are one token each, because the common cases are opposite: those six are
touched one at a time, while the master gesture writes all ten of these at
once. It is appended LAST in the field list, since `decodePacked` stops at the
first unrecognized token and there is then nothing after `M` for an
older build to strand. A uniform card writes `Q` at the shared value; a mixed
one writes it at the default and so spends no characters on it, because there
is no honest single float for ten different ones. The tuple's WIDTH is itself
a wire format — unlike the `osmMask` bitfield beside it, which has 31 bits of
headroom — so `mapsUrlState.osmDensity.test.ts` asserts the two lists still
match and an eleventh row goes red here rather than silently reinterpreting
every shared `M` link.

Gates: `mapsOsm.density.test.ts` (the record, the master reading, and that a
row's density reaches that row and only that row), `mapsOsmDensity.cost.test.ts`
(both cost claims, through the real widget, against
`pre[data-glyph-overlay-density]`), `mapsUrlState.osmDensity.test.ts` (legacy
`Q` seeding, mixed round trip, `M` beating a `Q` carried beside it),
`LayersPanel.osmDensity.test.tsx` (the rows, the master's "mixed", the gated
types, the live grid count).

## Cast shadows (`GlyphMapOptions.shadow`)

The ask was small — "we have light, could the buildings drop shadows, with a
toggle in the Lighting section" — and glyphcss has had a shadow map since
before this package existed. Everything below is what it took to make that
shadow map mean something in a world whose unit is an Earth radius.

### What the widget adds, and why each part is not the caller's to supply

`GlyphMapOptions.shadow` / `handle.setShadow`/`getShadow` take a
`GlyphMapShadowOptions` (`{ color?, opacity?, lift? }`) or `null`. `color` and
`opacity` pass straight through to glyphcss. Three things do not.

**WHO casts and WHO receives.** `GLYPH_MAP_SHADOW_CASTERS` is
`fill-extrusion` + `model` — the layers that stand UP off the ground.
`GLYPH_MAP_SHADOW_RECEIVERS` is `raster` + `fill` + `heatmap` — the ground
surfaces — PLUS both casters. `line`/`contour`/`symbol`/`circle` own no mesh
and can be neither.
The flags are set on every mounted mesh through `glyphMapMeshTransform`
UNCONDITIONALLY, not gated on whether shadows are currently on: glyphcss reads
them only inside a pass that carries `scene.shadow` (`buildShadowMap` is
skipped outright otherwise and `makeShadowCtx` returns `null`), and
`isDetailMesh` does not consider them, so with shadows off they change nothing
— which is what makes the Dock toggle ONE `scene.setOptions({ shadow })`
instead of re-mounting every mesh in the map. Gated by rendering the real
renderer twice, flags and no flags, and comparing `textContent`, `innerHTML`
and the `<pre>` count.

The two sets OVERLAP. They were disjoint at first, on the reasoning that
glyphcss had no slope-scaled bias, so any surface that both casts and receives
is compared against a quantized copy of its OWN depth — and that disjoint sets
remove the case by construction. The reasoning was sound and the conclusion
was wrong, because the thing it gave up is the case a reader in a city
notices first: **a building shadowing the building next to it, which was
impossible by construction.** Measured on two towers 278 m apart under a
20-degree sun, where the near one's shadow covers the far one completely:
0 of the far tower's 450 roof cells darkened.

The overlap is safe because the acne was mis-attributed. It is not a
depth-PRECISION artefact — glyphcss's shadow buffer is a `Float64Array` —
it is a POSITION quantization artefact with an exact size. A receiver reads
the map at `tu = lu | 0`, i.e. the texel BELOW-LEFT of where it actually
stands, so a self-receiving surface is compared against its own depth taken up
to one full texel away in each light-space axis: an error of exactly
`|dd/du| + |dd/dv|`, the two per-texel components of its own depth gradient.
That quantity is a function of the shadow map's FITTED VOLUME, so it cannot be
written as `lift`, which is a world length — and this is why the fix had to go
into glyphcss rather than here. `SHADOW_SLOPE_BIAS_TEXELS` (`rasterize.ts`)
computes the gradient per receiver triangle from the same light-space triple
the sampling already uses and adds `1.25` texels of it. Both bounds were swept
on this package's own fixture, a lone tower in plan view where every changed
cell on its roof is by construction acne (a convex box can legitimately shadow
only faces turned away from the light, and those are lit by ambient alone,
which the shadow term never touches):

| slope factor | self-shadowed roof cells (of 450) | 4 m building's ground shadow (cells) |
|---|---|---|
| 0 | 450 | 10 |
| 0.5 | 225 | 10 |
| **1.0** | **0** | 10 |
| 1.25 (shipped) | 0 | 10 |
| 1.4 | 0 | 10 |
| 1.5 | 0 | 8 |
| 2 | 0 | 0 |
| 3 | 0 | 0 (8 m goes too) |
| 6 | 0 | 0 (20 m goes too) |

Acne stops at exactly `1.0`, which is the derivation's own bound rather than a
fitted number, and the first real shadow loss is at `1.5`. `1.25` sits between
them with 25% headroom above the acne bound and 20% below the first loss. Note
the failure mode without the guard is not a speckle but a near-uniform
darkening — 450 of 450, not half of them — because `floor` errs in ONE
direction where `round` would err symmetrically. The peter-panning column is
measured with the casters spread over ~1.8 km (the widget mounts whole tiles,
so the fitted volume is the city, not one building) at a 45-degree sun; that
is the shadow map's own resolution talking, and a shadow shorter than a texel
was never representable at any bias.

**TERRAIN NEVER CASTS**, and this is the load-bearing exclusion.
`buildShadowMap` fits the light-space volume to the AABB of ALL casters at a
fixed 256x256, and the relief system keeps a PERMANENT GLOBAL floor tier
mounted at every view. Terrain casting would therefore stretch those 256
texels across the whole Earth — ~156 km per texel, at which no shadow of
anything survives — and would re-rasterize the floor tier's entire polygon set
into the depth buffer on every render. Mountain-shadow-on-valley needs a
view-fitted cascade this renderer does not have; it is not a tuning away.

**The BIAS.** `GLYPH_MAP_SHADOW_LIFT` is `0`. glyphcss's own default `lift` is
`0.05`, and that number is the real trap in this feature — not `maxExtend`
(see below), which does nothing at all. `lift` is a WORLD-UNIT length, and on
the globe `0.05` is 5% of Earth's radius: 318 km, about 36,000 times the
tallest building on the planet. Every receiver then clears every caster by a
margin nothing can exceed and NOT ONE SHADOW IS DRAWN. On a sheet the same
number is 0.05 Earth radii on an axis whose neighbours are degrees. No single
value is right for both, so the widget owns the field. Zero stays the right
value now that the sets overlap, and for a better reason than before: the
self-shadow case a bias exists for is closed by the derived slope-scaled guard
above, in the shadow map's own texels, which is the only frame in which the
error is expressible. `lift` is then a purely EXTRA absolute term, and a map
has no absolute length to offer — while any nonzero `b` erases every shadow
whose caster stands less than `b / sin(sun altitude)` above its receiver,
taking the SHORT buildings first and worst at a LOW sun, exactly where shadows
are longest and most legible. The residual error is horizontal (a shadow edge
lands within one shadow-map texel of the truth) and no depth bias addresses
that anyway. Gated both ways:
the geometry tests go red if the constant is put back to `0.05`, and one test
hands `lift: 0.05` through the public option and asserts it changes not one
cell.

**The DIRECTION is deliberately not an option.** Shadows are cast along the
scene's own `directionalLight.direction`, which is whatever
`getKeyLightDirection()` reports — the sun, the headlight, or the page's own
azimuth/elevation sliders. One vector lights the scene and casts its shadows,
so the two can never point different ways. Gated with a manual sun over Zurich
whose shadow lands in the opposite half-plane from the direction the scene was
CONSTRUCTED with, plus a cell-exact landing derived from
`getKeyLightDirection()` alone.

### A HEADLIGHT and a visible shadow are mutually exclusive

This is why `/maps` showed no shadow anywhere at its own defaults, and it is
not a bias, a receiver set, or a fitted volume — it is geometry, and it is
exact.

`keyLight: "headlight"` aims the key light along the camera's OWN view axis
`n` (`glyphMapHeadlightDirection`). An orthographic camera's screen position
is the component of a world point PERPENDICULAR to `n`. A shadow is its caster
displaced ALONG the light, i.e. along `n` — a displacement with zero
perpendicular component. So the shadow of every point lands in that point's
own column and its own row, hidden behind the thing that threw it. Measured on
the tower fixture: **535 shadow cells under a fixed light, 27 under a
headlight** — and those 27 are a sub-texel fringe at the silhouette, all of
them inside the footprint's own rows.

`/maps` opens on the globe with Sun "Full", and Full on an orbit projection IS
a headlight (that is the whole point of it: no terminator anywhere, while
Lambert still varies per face so relief survives). So the reader turned
shadows on and correctly saw nothing — over the floor, over other layers, and
over other buildings.

The fix is a precedence rule, in the page rather than the widget because it is
a question about two page controls: `mapKeyLightForSunMode(mode, projection,
shadows)` returns `"fixed"` whenever shadows are on. An evenly lit globe and
cast shadows cannot both exist, so the reader gets whichever they asked for
last, and asking for shadows hands the direction back to the Azimuth/Elev
sliders. Those sliders are dimmed in exactly the cases something else owns the
direction, which is no longer `isOrbitProjectionId(projectionId)` alone —
`mapDirectionLocked(projection, mode, shadows)` derives it from
`mapKeyLightForSunMode` and the sun's own rule, so the row cannot drift from
who is actually aiming the light. `mapsKit.sun.test.ts` pins the equivalence
across every mode/projection/shadow combination, and pins that globe + Full is
the ONE case the shadow flag changes (a targeted un-dim, not a blanket one).

Real time and Manual were never affected: the sun writes a real outward vector
at the subsolar point, which is not the view axis, so shadows worked in those
modes all along.

### Separation WAS the blocker, at the DEFAULTS the reader had moved off

The headlight fix above was correct and did not make a shadow appear, because
the link that reported it was not in a headlight mode at all. Decoded with the
real codec (`mapsUrlState.mapsCodec`), `?m=p3x6-yrbivy6-klok9s4-9v9t21dE1v21jn2j26xh223b218D1L18O21fQ1t`
is: globe, Buenos Aires (`-58.381591, -34.603929`), span `0.00167` deg, tilt
49, bearing 44, exaggeration 24, sun **manual** (day 249, hour 18.75 UTC),
shadows **on**, `layerMask 8` — the OSM card and NOTHING else, so no terrain,
no borders, and neither of the standalone `fill-extrusion`/`model` demo layers
— `osmMask 51` (landcover, landuse, roads, buildings), and **`osmDensity
2.9`**. `mapKeyLightForSunMode` returns `"fixed"` here twice over (manual sun,
and shadows on), so the headlight was never in play; the manual sun at that
instant stands ~32 degrees above Buenos Aires, well clear of the ~10-degree
altitude where shadows start to dither.

`2.9` is the whole story. The OSM card gave its ten rows ONE density slider at
the time (`mapOsmLayers` fanned it out over every enabled row; it now carries
one control per row plus a master that writes all ten — "One density PER ROW"
above, which changes nothing here: the master gesture still writes every row
at once, so this link is reproduced exactly), and `density !== 1` is
exactly what `isDetailMesh` separates on — so moving that one slider separated
the `omt-buildings` `fill-extrusion` that CASTS and the `omt-landuse` /
`omt-landcover` `fill`s that RECEIVE, in the same gesture. The base grid was
then left holding neither, and the shadow pass ran over an empty stage.
Measured on the fixture in `widget.shadowDensity.test.ts`: **535 changed cells
at `density: 1`, exactly 0 at `2.9`** — the toggle was not weak, it was inert.

The fix is in glyphcss and is described in AGENTS.md's "Shadows": the shadow
map is now built once per frame from every `castShadow` mesh in the SCENE
(`GlyphShadowCasters`) and shared across the frame's passes through a
`GlyphShadowMapCache`, so a detail layer casts onto the base grid, the base
grid casts into a detail layer, and two detail layers cast onto each other.
The earlier note here claimed casting out of a detail layer would need the map
built "after every mesh's world geometry is known, which the per-layer pass
structure does not guarantee". That was wrong: `doRenderTransaction` already
applies every mesh's transform in one loop BEFORE it splits base from detail,
so the world geometry of the whole scene is in hand at exactly the point the
caster set has to be assembled. Collecting it there costs one extra walk of
the caster polygons and no extra shadow-map rasterization.

On the reported configuration the count is now **4,469** changed cells, all of
them in the landuse layer's own output grid and none on the building that
threw them (a lone convex tower has nothing of its own to shadow, so a count
there would be acne — the clause `widget.shadow.test.ts` makes for the base
grid, restated for a detail grid).

**What still cannot receive is a STAMP.** `line` and `contour` are not meshes:
they are painted into the `CellGrid` by the composed `transformCells` hook
after shading, and the stamp writes the layer's flat colour (`grid.color[idx]
= color`). The shadow term is consumed inside `scanFillTriangle` when the
cell's final colour is computed and nothing per-cell survives it that a hook
could read — the requirement-gated `shade` buffer is the LIGHT term, not an
occlusion fraction. So a building shadows the landuse under it and never the
road running past it. That is architectural, it is visible, and it is recorded
here rather than left for a reader to discover; closing it means a new
requirement-gated per-cell shadow buffer on `CellGrid`, which is a feature and
not a wire.

### The glyphcss defect this uncovered, and the fix

Shadows did not appear at all at first, at any setting. The cause was in
`buildShadowMap`, not here: the light-space bounds were padded by
`(span * 0.05) + 0.01` — an ABSOLUTE world length. The padded volume is then
divided into 256 texels, so that constant sets a smallest scene the shadow map
can resolve. A city block on the unit-radius globe spans ~1e-5 world units, so
the pad made the volume 500x the casters and left every building a 0.23-texel
speck. Bisected by rendering the same cube-on-a-plane scene at scale 1 and at
scale 3e-5: 18 cells differed at scale 1, zero at 3e-5.

The additive term exists only to keep a DEGENERATE axis from dividing by zero
in `toLightUV` — a caster set flat in one light-space direction (one wall seen
edge-on from the light). It now borrows the other axis's span for that case,
and only a set collapsed to a point falls back to an absolute epsilon; the
ordinary pad is purely relative. glyphcss's own 910 tests, its six shadow
tests included, are unchanged by it. This is the same class of bug as `lift`,
in the same function: a room-scale assumption in a renderer used at planetary
scale.

`GlyphShadowOptions.maxExtend` (documented default `2000`, "half-extent of the
light-space projection volume") is READ BY NOTHING — `GlyphSceneElement`
assembles it, the type declares it, and `buildShadowMap` fits the volume to
the casters instead. It is therefore not a trap to be tuned but dead surface;
removing it is a public break and was not taken here.

### What it looks like, and what it costs

Shadows cross `<pre>`s: `doRenderTransaction` collects every `castShadow`
mesh's world polygons in the same loop that applies transforms — before base
and detail are split — and hands that one set, plus one shared built map, to
the base pass and to every detail pass. A layer separated by its own
`density`, `renderMode` or `glyphPalette` casts and receives like any other,
which is what `/maps`' single "OSM density" slider needs. See "Separation WAS
the blocker" above for the measurement.

**Low sun**, measured on a 60 m block over flat ground at 140x63, ~4.8 m per
column (shadow cells = the cells a render changed when the shadow was switched
on):

| sun altitude | shadow cells | rows | look |
|---|---|---|---|
| 60 deg | 100 | 4 | solid |
| 30 deg | 275 | 11 | solid |
| 10 deg | 520 | 22 | solid, every ~4th row starting to dot |
| 5 deg | 251 | 22 | a stipple — about half the cells lost |

That degradation is the shadow map's finite resolution meeting a receiver that
is nearly parallel to the light, and it is the case a slope-scaled bias would
address. It matters less than the table suggests: at 5 degrees of altitude the
direct term is `cos(85 deg) = 0.087`, so the lit and shadowed ground differ by
almost nothing anyway.

**Cost** (`bench/maps-render`, spans, 1440x900, 140x63, headed,
`--demo-layer fill-extrusion`, base-raster ms per render):

| scenario | shadows off | shadows on | delta | fps |
|---|---|---|---|---|
| orbit | 19.60 | 22.06 | +2.46 (+13%) | 19.3 -> 17.8 |
| drag | 21.54 | 24.04 | +2.50 (+12%) | 12.4 -> 11.3 |
| wheel | 4.58 | 7.53 | +2.95 (+64%) | 41.8 -> 33.9 |
| flyto | 9.39 | 12.27 | +2.88 (+31%) | 34.4 -> 29.4 |

Making the CASTERS receive as well — the change that buys
building-on-building — is inside that measurement's noise. Measured directly
on `rasterize` (989 polygons, 845 of them caster polygons: a 13x13 grid of
boxes on a tiled ground, 140x63, oblique ortho, colours on, 120 renders after
20 warm-up, three runs):

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| shadows off | 0.29 | 0.29 | 0.30 |
| ground receives only | 0.76 | 0.74 | 0.79 |
| casters receive too | 0.75 | 0.76 | 0.75 |

The extra receivers cost nothing measurable next to the shadow feature's own
+150%, because the added work per caster triangle is three `toLightUV` calls
and one 2x2 solve for the depth gradient, against a scan-fill that was already
running.

A flat +2.5 to +3.0 ms per render, which is what the mechanism predicts: the
shadow map is rebuilt from the casters and the receiver test runs per covered
cell, and neither depends on where the camera is. So it costs most where the
frame was cheapest. It is opt-in and off by default, and `renders/frame` is
unchanged (2.0 / 2.98 / 1.95 / 2.01 against 2.0 / 2.97 / 1.96 / 2.01) — the
toggle buys no extra render.

**Off is byte-identical.** No `shadow` key reaches `createGlyphScene` at all
when it is off, and the bench's fidelity digest for the default page is
`c61977879666aa92104d9e64` for all three of: no token, `D0` (explicitly off),
and `D1` with no caster layer mounted. At unit level, turning shadows on and
back off restores the render's `textContent` AND `innerHTML` exactly.

### The page

`/maps` carries it as a two-state icon toggle in the Dock's Lighting folder,
portaled through the same `extras` seam and the same `.dock-subcell` row as
the Sun toggle — a shadow is thrown by the key light, so the reader who has
just set the sun is the reader who wants to know whether it casts. It renders
BELOW Sun, which means it is rendered ABOVE it in the JSX: `useDockSlot`'s
`position: "top"` inserts each slot before the folder's current first child,
so the last one mounted ends up first. URL token `D`, appended with no version
bump (`S` and `s` were already spent on `smoothShading` and `span`); a link
written before it decodes to `false`, which is the map every such link already
described.

## Street-level walk mode (`GlyphMapHandle.setWalk`)

Off by default and byte-identical there: no perspective camera is ever
constructed, `walk` is `null`, and every branch in `widget.ts` is guarded on
it. `packages/maps/src/walk.ts` holds the pure half (lens, step, keys) and
carries the derivations; this section is the record of what was decided, what
was measured, and — the larger half — what was BUILT AND THEN DROPPED.

### It is a GATED mode, and that is what makes it small

The two spikes that preceded this feature (scratchpad `FPV_MAPS_FEASIBILITY.md`,
`FPV_SPIKE.md`, `FPV_RENDER.md`) identified one P0: `glyphMapGlobe.visible()`
is explicitly derived for the orthographic camera — its own comment says so —
and under a positioned perspective camera at 1.7 m it reports the ground ONE
METRE IN FRONT OF THE WALKER invisible. Its consumers are the tile sweep,
`unprojectSphere`, `viewportGeoSamples`, `fill-extrusion` wall culling and
marker visibility, so naively swapping the camera gives a BLANK map, not a
degraded one.

Generalising `visible()` is a real interface change (`visibleFrom(world, eye)`
or similar) to a capability that serves a camera walk mode does not use.
Walk mode does not need it: over the few hundred metres a walker can see the
Earth is locally flat, so the visibility question reduces to "is this within
`far` metres of where I am standing". So the mode is GATED — the control is
only offered on the globe, over OSM, already near the ground — and every walk
branch keys on "walk mode is active", never on a projection id and never by
widening a projection capability.

### The pose is the EXISTING orbit camera read at its limit

Almost nothing new. The widget already pitches the camera about the surface
point under the view centre with a ceiling of `asin(R / (R + h))`, which opens
to 90 deg as the altitude goes to zero, and already turns it about the pivot's
own local up (`bearing`). At `tilt: 90` the camera's depth-gradient direction
is the local horizontal, so the view axis is dead ahead. Therefore:

- `tiltRequest`/`appliedTilt` IS the walker's pitch, measured from
  `GLYPH_MAP_WALK_HORIZON_TILT_DEG` (90) and clamped to a NECK
  (`maxPitch`, 84 deg either side) instead of to the horizon ceiling. 84 is
  the parthenon's own `FPV_MIN_PITCH = 6` / `FPV_MAX_PITCH = 174` read from
  the same horizontal (`90 -+ 84` IS `6..174`), and what it protects is the
  YAW AXIS: at exactly straight up or down the view axis is parallel to the
  axis a heading turns about, so the heading stops meaning anything. It was
  55, on the argument that "looking far up puts the true horizon back in
  shot" — which is backwards, since looking up REMOVES ground from the frame,
  and which cost a reader standing 20 m from a building the top of anything
  taller than 28 m.
- `bearing` IS the walker's heading, unchanged. It keeps the horizon LEVEL by
  construction (`M · u_c = E · u_c` for every bearing) — the one thing a
  walker cannot do without, and exactly what a view-axis roll would destroy.
- `view.center` IS where the walker stands.
- `view.span` DESCRIBES the horizon footprint (`glyphMapWalkSpan`), so tile
  LOD, the URL codec and every readout keep working without learning about a
  camera mode. It stops being a zoom CONTROL: the wheel is a no-op while
  walking, deliberately not repurposed as an FOV control.

What is genuinely new is the POSITION (an orthographic camera has no eye) and
the LENS. The eye sits `P / BASE_TILE` world units behind `camera.target`, so
standing at eye height means putting `target` that far AHEAD of the eyes.
`BASE_TILE` is PROBED off the live camera rather than assumed: `eyeDepth` is
affine in the world point (its own contract) and its slope along the view axis
is exactly that constant, independent of `perspective`, so two evaluations
recover it and the eye lands where the arithmetic says even if glyphcss's
constant ever moves. Every TRUE metre — the eye height, the near plane —
converts through `glyphMapTrueScaleElevation`, the same exemption a
`fill-extrusion`'s height takes: the ground a walker stands on is wherever the
exaggerated relief puts it, and only what is measured up from that ground is
exempt.

### The lens: why `perspective` is 3.9e-4 CSS pixels, and why that is right

`website/src/pages/examples/parthenon.astro` is this repo's reference FPV, and
its lens model is a REAL CSS-pixel focal length (`FPV_PERSPECTIVE = 1000`,
anchored at `FPV_REF_WIDTH = 1060`, floored at 320) scaled with the rendered
width and re-applied on `resize`, so the horizontal FOV holds across a phone
and a desktop.

That model cannot be lifted verbatim, and the reason is the unit system, not
the arithmetic: the parthenon is authored at 1 world unit = 1 METRE while this
package's world unit is an EARTH RADIUS. glyphcss's CSS-perspective near plane
is `P / BASE_TILE / 100` WORLD units, so `P = 1000` puts it 1,274 km in front
of the eye. Measured by substituting exactly that constant into
`glyphMapWalkLens`: the field of view collapses to **0.02 degrees** and the
near plane goes past 10 m — the whole planet is clipped.

Solved in the map's own units the same lens is
`P = 0.5 / 6371000 * 50 / 0.01 = 3.9240e-4` CSS pixels at the default entry
(Zurich, globe, 140x63 at 8x16 px cells). That number looks broken and is not:
measured through the REAL `project()` — bisecting for the off-axis angle whose
ray lands on the last column — it produces **exactly 70.000 degrees** of
horizontal field of view, which is `GLYPH_MAP_WALK_FOV_DEG`, with the near
plane at 0.500 m.

What DOES carry over from the parthenon is the invariant rather than the
constant. Solving `zoom` from `viewportWidthPx` holds the FOV across every
rendered width exactly, where `fpvPerspective()` holds it approximately — but
the parthenon's other half, **re-applying it on resize**, was genuinely
missing and was the reported "the FOV is super wrong". `/maps` never calls
`map.resize()` at all: the scene's own `autoSize` observer re-fits the grid
underneath the widget, so a reader who resized a window, rotated a phone or
opened a devtools pane while walking kept a lens cut for the old width, in
direct proportion. Measured at a third of the width: **26.3 degrees where 70
was asked for.** The widget now owns a `ResizeObserver` on the host for the
duration of a walk and nothing else — constructed on entry, disconnected on
exit and on `destroy`, so a map that never walks observes nothing.

### Steering: the eye used to swing 70 m when you turned your head

The second reported defect ("it cannot be steered") was one number. The eye
sits `P / BASE_TILE` world units BEHIND `camera.target` — at the default lens,
**50 metres** — and a heading change used to install a bearing matrix and
nothing else (`applyBearingState` -> `syncCameraBearing`). So the view axis
turned about a target that stayed put and the EYE orbited it on a 50 m circle.
Measured at Zurich on the shipped build: a **4 degree turn (five pixels of the
old 0.8 deg/px drag rate) slid the walker 3.49 m** sideways through the world,
and a quarter turn slid them **70.7 m**, while `view.center` — where the map
believes they stand, and where `refreshWalkGround` samples the terrain under
their feet — did not move at all. One step then re-posed and snapped the eye
back. `applyBearingState` now re-poses through `poseWalkCamera` while walking
(the orthographic branch genuinely is matrix-only: it has no eye to move), and
`widget.walkLook.test.ts` pins the eye to within a centimetre across a full
turn; removing the re-pose puts 68.17 m back.

On top of that, walk mode had no mouselook at all — it steered through the
map's own Ctrl/right-drag orient gesture. It now takes the parthenon's control
model whole:

- **Pointer lock acquired from `pointerdown`, never `click`.** That page found
  the failure and named it: a per-frame effect layer rewrites the `<pre>`'s
  coloured spans, so a mousedown landing on a glyph has its target detached
  before mouseup and the browser never fires `click`. EVERY render in this
  package rewrites the same `<pre>`, so walk mode inherits it exactly.
  (`createGlyphFirstPersonControls` still binds `click` internally — the
  parthenon calls that a good candidate for an upstream fix, and this is the
  second consumer to route around it.)
- **Its own look RATE.** `GLYPH_MAP_WALK_LOOK_DEG_PER_PX` is 0.15, which is
  `createGlyphFirstPersonControls`' own `lookSensitivity` default, not the
  map's 0.8/0.5 drag rates — those are tuned for a hand holding onto the
  ground, and at 0.8 deg/px a 5 px twitch was a 4 degree turn.
- **Drag-to-look for the pointers that cannot lock** (touch, and a refused
  lock), at the parthenon's own `LOOK_SENS` = 0.24
  (`GLYPH_MAP_WALK_DRAG_DEG_PER_PX`). A locked mouse stands down in
  `onPointerMove` so the two models can never both fire on one event.

`createGlyphFirstPersonControls` itself is NOT reused, and the reason is the
world frame rather than a preference. Its movement integrates
`cameraOrigin[0] += cos(rotY) * moveSpeed * dt` on the world XY PLANE with a
fixed `groundZ` — a flat-Earth step in world units. Here a step is a geodesic
on a sphere whose ground elevation is re-sampled per frame
(`glyphMapWalkStep` + `refreshWalkGround`), the eye height is a TRUE metre
converted through `glyphMapTrueScaleElevation`, and the heading is `bearing`
(a rotation about the pivot's local up, which is what keeps the horizon level)
rather than `camera.rotY`. Every one of its movement, gravity, crouch and
jump paths would have to be overridden, leaving only the input plumbing —
which is the part reproduced above. What IS taken from it is its numbers and
its shape: the look rate, the pitch clamp, and the pointer-lock model.

### The horizon is 600 m, and it was never the thing limiting the view

`GLYPH_MAP_WALK_FAR_M` shipped at 400 and the report was "there is too much
distance culling I think, can't we render a bit more". The honest answer
needed two defects fixed first, because **both of them were the real distance
limit and neither was this constant** — the ladder taken before they were
fixed measured a scene that was clipped to one tile, and it says the opposite
of the truth.

**Defect 1 — the sweep kept ONE tile.** `isBoundsVisible` is the per-tile
authority. Its first half asks whether a tile contains one of the VIEWPORT's
own unprojected sample points, and under the walk camera not one screen point
unprojects (the same measurement `orbitCandidateGeoBounds` is dropped for), so
`viewportGeoSamples` degrades to `[view.center]` — which only ever lands in
the tile the walker is standing in. Its second half probes the tile's own 3x3
corners through `projection.visible`, i.e. exactly the expression this
document already establishes as WRONG under a positioned perspective camera.
Measured on the real page at Zurich with the OSM card on: `candidateTileRange`
offered 35 z14 candidates and `isBoundsVisible` kept **1**. That was invisible
for as long as the only thing walked was the curated z7 relief pyramid, where
one 2.8 deg tile IS the right answer; with buildings mounted it is the whole
city clipped to one 1.67 km tile, so a walker within `far` of any tile edge
saw nothing across it and no increase to `far` could reach past it.

The fix is the horizon as a BOX — `glyphMapWalkBoundsWithinHorizon`, the
walker's lon/lat clamped into the tile's box (both axes; and +-360 for the
antimeridian) and the great-circle distance to that point. The old note argued
a `far` DISC would reject the tile the walker stands on: true of a disc tested
against the tile's own sample POINTS, and false of the distance to the BOX,
which is zero there by construction. Measured after: 1 z14 tile at 400 m, 3 at
800, 6 at 1200, 9 at 2000 — still an order under the page's <=100 budget.

**Defect 2 — the LOD was keyed on the walk FOOTPRINT.** `view.span` is pinned
to `glyphMapWalkSpan(far)` so tile LOD, the URL codec and the readouts keep
working, and `glyphMapTargetLOD(provider, span / cols)` then read that as a
RESOLUTION. It is not one under a perspective camera: one output column
subtends a fixed ARC (`fov / cols`), so the ground it covers is centimetres a
few metres ahead and metres at the horizon, and the near field is the one the
reader is standing in. The consequence was that the walker's DATA LEVEL
depended on the WINDOW WIDTH. The z13/z14 boundary sits where
`span / cols >= tileLonSpan / tileCols`, i.e. at `9.54 * cols` metres:

| viewport | grid cols | z14 holds while `far` < |
|---|---|---|
| 390x844 (phone) | 49 | 468 m |
| 768x1024 | 59 | 563 m |
| 1024x768 | 87 | 830 m |
| 1440x900 | 140 | 1,336 m |
| 2560x1440 | 283 | 2,701 m |

The shipped 400 m cleared the phone's own cliff by 15% and nothing said so —
a ~330 px map host would already have crossed it. And crossing it does not
blur the city, it DELETES it: rendered at Zurich with the buildings row on,
`far: 2000` dropped to z13 and not one building was drawn. So while walking
the sweep asks for the provider's DEEPEST level (`glyphMapFinestLOD`) and
nothing else. Gate for both: `widget.walkHorizon.test.ts`.

### The distance ladder, measured after those two fixes

`bench/maps-render --scenario walk --walk-look 0`, headed Chromium on `astro
preview`, `--encoding spans`, 1440x900, grid gate 140x63, Zurich at
`span 0.02`, the OSM card's `omt-water` / `omt-roads` / `omt-boundaries` /
`omt-buildings` rows on — the same scene the walk budget section below uses.
`--walk-far` drives the widget's own `setWalk` RECONFIGURE path, which is
exactly what shipping a different constant does.

| `far` | base polygons | base-raster p50 | render burst p50 | frame gap p50 / p95 / p99 | fps |
|---|---|---|---|---|---|
| 400 | 39,156 | 6.4 ms | 8.0 ms | 16.7 / 17.6 / 17.7 | **59.1** |
| 500 | 59,556 | 9.3 ms | 11.8 ms | 16.7 / 33.5 / 34.1 | 46.3 |
| 550 | 61,281 | 9.0 ms | 11.4 ms | 16.7 / 33.4 / 34.1 | 49.7 |
| **600** | **63,141** | **9.5 ms** | **12.0 ms** | **16.7 / 33.5 / 34.3** | **48.5** |
| 700 | 66,925 | 9.9 ms | 12.3 ms | 16.7 / 33.4 / 33.9 | 48.5 |
| 800 | 87,577 | 17.5 ms | 21.0 ms | 33.3 / 34.1 / 50.1 | 32.2 |
| 1000 | 113,037 | 19.1 ms | 23.6 ms | 33.3 / 50.0 / 50.7 | 29.0 |
| 1200 | 146,917 | 26.8 ms | 32.4 ms | 50.0 / 50.9 / 66.7 | 22.5 |
| 1600 | 213,703 | 40.8 ms | 49.3 ms | 66.7 / 83.9 / 100 | 14.8 |
| 2400 | 298,987 | 64.1 ms | 74.5 ms | 100 / 116.2 / 117.4 | 10.8 |

Three readings, and the third is the choice:

1. **The cost is the AREA, not the distance.** Polygons roughly track `far^2`
   in the near band (400 -> 500 is 1.52x against an area ratio of 1.56), which
   is why the ladder is so much steeper than "a bit further".
2. **500-700 is ONE plateau** (base-raster 9.0-9.9 ms), and 800 is the next
   tier — 17.5 ms, and the first row whose MEDIAN frame is a dropped one. The
   plateau's edge is scene-dependent, since the polygon count depends on which
   block the reader is standing in.
3. **600 sits inside the plateau with room.** Half again the distance; the
   median frame still lands on its vsync (16.7 ms); the 95th percentile at the
   two-vsync bound. Going to the plateau's own edge at 700 buys 17% more
   distance for none of that margin.

A walk with only terrain mounted is **free at every value on that ladder** —
16,792 polygons, 3.2 ms, 60.0 fps, unchanged from 400 to 2400 — because this
page's relief pyramid stops at a curated z7 whose 2.8 deg tiles already cover
any horizon a walker can have, and its mesh resolution is a separate question
from the LOD. The constant is paid for entirely by the city.

**The aesthetic claim did not survive.** The old note said the cap was doing
two jobs, the second being that "past ~400 m a building is a couple of rows
tall and the far field collapses into an undifferentiated band". Rendered at
600 with the tile clip fixed, the far field is still individual blocks with
sky between them — the reading was taken through defect 1, where there was
nothing out there to read. The constant is a PERFORMANCE cap now, and the
picture is the thing it is buying.

**Its own hard ceiling is the ENTRY GATE**, which is a separate bound and
lower than anything the ladder would suggest. `setWalk` pins
`view.span = glyphMapWalkSpan(far)`, and a walk link carries that span back
through `GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG` (0.05 deg) when the page re-gates
it on arrival (`mapWalkLinkEntry`). They collide at **2,780 m**, above which a
shared walk link silently opens the ordinary map instead of the walk it was
taken in — no error, and no symptom at the sender's end.
`walk.entryGate.test.ts` pins that number and the shipped horizon's margin
against it (600 m is 0.0108 deg, under a fifth of the gate).

**Not shipped as a control.** A view-distance slider was considered and
rejected: `far` is not a preference a reader can evaluate — the same number is
free over terrain and halves the frame rate over a city, and the ladder above
is a property of one scene at one grid size, so the control would offer a
setting whose cost the reader cannot see until they have already paid it.
`interactiveDownscale` (the page's "Drag density") is the lever that already
exists for a heavy walk, and it is honest because it trades RESOLUTION, which
is visible in the frame it changes.

### Two visibility branches were built, measured, and DROPPED

The obvious design gives walk mode its own local-horizon test everywhere
`projection.visible` is consulted. Two of those were built and then removed
because they changed nothing (the third, `isBoundsVisible`, was dropped on a
measurement that did not generalise — see defect 1 above):

- **`orbitCandidateGeoBounds`** — measured, all 49 of its screen samples fail
  to unproject under the walk camera, so it returns `null` and
  `candidateTileRange` falls back to its own `view.span` box — which walk mode
  has ALREADY set to the footprint. The bound therefore reaches the candidate
  RANGE through `view.span`, where every other consumer already reads it, and
  `isBoundsVisible` is the per-tile authority over what that range offers.
- **`nearSidePredicate`** (wall culling, markers) — `projection.visible`'s
  cylinder test already cuts a `fill-extrusion`'s far walls at street scale.
  Measured, a 300 m block on the view axis paints 4,590 cells at 80 m, 1,485
  at 160 m, 480 at 400 m and ZERO from 800 m out, identically with and without
  a horizon predicate. Adding one changed not a cell.

The ONE point consumer that is load-bearing is `project()`: a point at 5x the
horizon is on the near hemisphere AND squarely on grid, so `projection.visible`
cannot reject it and the public projector would report it visible. Removing
that branch turns `widget.walk.test.ts`'s horizon clause red.

### What is NOT in scope, and why the ground is bare

Road ribbons are a separate slice (a per-layer `GlyphMapLineLayer.ribbon`
option): the `line` layer is a post-raster STAMP by design, so a road has no
geometry for a perspective camera to converge. Until that lands the ground
between the buildings is one flat colour, which is a real limitation and not a
defect to chase here — `FPV_RENDER.md` measured the ribbons at +1.2 ms and
identified them as what turns the lower third of the frame from a floor into a
street.

Collision was out of scope on both spikes' recommendation and is now IN — see
"Buildings are solid" below. What is still out is everything else being solid:
a `fill` layer, terrain slope, and a structure's own `min_height`.

The relief backstop tiers are NOT suppressed while walking, deliberately.
They are sunk `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M` (20,000 m), and a point
20 km below the eye is off the bottom of a 35 deg vertical frame for every
distance under ~63 km — so at street level the sink that exists to keep a
backstop from occluding the target tier also keeps it entirely out of frame,
for free and with no branch.

### Buildings are solid (`walkCollision.ts`)

Reported as "the buildings are not walls, it's like you can get through them".
Collision had been cut from v1 twice on the spikes' recommendation; this is
what shipping it turned out to need.

**Only `fill-extrusion` footprints are solid.** A `fill` (landuse, landcover,
water) is a flat overlay drawn on the datum, and walking across a park or over
a lake surface is exactly what a reader expects to be able to do — making them
solid would fence the walker into the road network on the strength of a
colour. Terrain stays free-climb: there is no slope limit, deliberately.

**The STEP is tested, not the position, and a blocked step SLIDES.** This is
where the whole feel of the feature is. Cancelling a blocked step is correct
and unusable: a street is a corridor of touchable surfaces, so the reader ends
up glued to every wall they brush. The resolver instead drops the component of
the step INTO the blocking wall and keeps the component ALONG it, which is
what makes a corridor walkable and what lets a walker round an inside corner
in one frame — measured on the synthetic fixture, a walker driven north-east
into an east-west wall keeps 30 of the 52 m of east intent that a halt-on-
contact model throws away.

**A 0.3 m body radius.** A walker is a point to every other part of this mode,
and a point stops with the EYE inside the wall's own face — which reads as the
render tearing, not as an impact. 0.3 m puts the stop a shoulder's half-width
short of the surface and stays clear of the 0.5 m near plane, so the wall the
walker is stopped against is still drawn. It is deliberately SMALLER than a
real body (~0.55 m): the narrowest passable gap is `2 * radius`, so 0.3 m
keeps every alley that visibly looks walkable walkable.

**Metres, never degrees.** A footprint is in lon/lat and a degree of longitude
is `cos(latitude)` of a degree of latitude — 0.68 at Zürich, 0.5 at 60. Every
distance is taken in a local metric frame pinned at the walker's own position
(east metres, north metres), which is what makes the radius mean 0.3 m on both
axes. `walkCollision.test.ts` pins it at latitude 60, where a degree-denominated
test is exactly 2x wrong on one axis and right on the other.

**A local index, rebuilt on the mounted tile set.** Point-in-polygon against
every footprint in view, per frame, would hand back the frame time `abe22d2`
and `55b9d80` recovered — at the 600 m horizon that is thousands of buildings.
Footprints are filed into a uniform lon/lat bucket grid sized in METRES
(`GLYPH_MAP_WALK_COLLISION_CELL_M` = 32) at the set's own mean latitude, so a
query whose radius is one step plus a body touches one bucket, or four at a
boundary. The index is invalidated at ONE site — `createMeshFeatureRuntime`'s
`build`, which is the only path that gives a layer features (the first
`update()`, a tile landing, and `dispose`'s own `rebuild([])` all go through
it) — and rebuilt LAZILY on the next step, so a map that never walks pays one
assignment per layer rebuild and never constructs an index at all. Registering
at mount and invalidating at dispose were both built and DROPPED as provably
redundant with that one site: each was mutation-tested and nothing went red.

**Never trap the walker.** Tiles stream in while walking, so a building can
appear around a walker already standing there, and a walker who cannot move is
worse than one who walks through walls. Two rules, and BOTH are needed:

1. If the step starts with the walker's own point inside a footprint,
   collision is off for that step — every direction, including further IN.
   Deleting this rule leaves the *centre* case working (from the middle of a
   block, every direction reduces the distance to the nearest wall) and breaks
   the off-centre one: standing 5 m inside the south edge, walking north
   increases the distance to the nearest surface, so a "may only reduce
   penetration" rule refuses it and the reader presses a key with nothing
   happening. `widget.walkCollision.test.ts` walks that case explicitly.
2. Otherwise a step is allowed whenever it REDUCES penetration, even if the
   destination is still inside the body-radius shell. This is what lets a
   walker standing 0.1 m from a wall that just appeared step away from it —
   their point is outside the footprint, so rule 1 does not fire, and a plain
   destination test would refuse every direction including the one leading
   out.

**Holes are holes.** A footprint is `[outer, ...holes]` — `glyphMapVectorMesh`'s
own grouping, carried on a feature's `polygons` — and the inside test is an
even-odd crossing count over EVERY ring, so a courtyard reads as open ground
exactly as it renders. A source that lost hole ownership (flat `rings`) gives
separate solids, which is a documented consequence rather than a surprise.

**A step longer than a body is SUBDIVIDED**, into sub-steps of at most one
radius, so a stalled tab coming back cannot tunnel a walker through a block.
It is not a swept capsule; each sub-step is still a point-plus-radius test.

**Known limitations, stated rather than discovered.** A footprint is solid
from the ground UP whatever its `baseOffsetProperty` (OSM `min_height`) says,
so an arcade, an overhang or a bridge deck starting 4 m up blocks a walker who
could in reality walk under it — fixing it needs the walker's own elevation
tested against a per-feature base, a second axis this model does not carry.
Terrain is free-climb. A footprint spanning the antimeridian is filed by its
raw lon/lat box and so simply does not collide.

**The defeat key is `G`, held, not toggled.** It collides with nothing (the
movement bindings are WASD and the arrows, the modifier is Shift, the exit is
Esc), and holding rather than toggling is what lets `MapWalkButton`'s legend
state it without the page having to mirror a state — the same shape `Shift`
already has. A window blur releases it like every other held key.
`GlyphMapWalkOptions.collision` (default `true`) is the same switch as an
option, which is what the render bench prices the mode with and without.

**Measured, and it is free.** `bench/maps-render --scenario walk --walk-look 0`,
headed, 1440x900, 140x63, Zürich with the OSM water/roads/boundaries/buildings
rows — the same 63k-polygon scene the horizon ladder above was measured on —
run twice each way through the new `--walk-collision` flag: collision ON 47.6
and 47.6 fps, OFF 48.3 and 45.5. The run-to-run spread is larger than the
difference, base raster p50 moves 9.7-10.3 ms in both directions, and `polys`
is 63,133-63,143 across all four. That is the index doing its job: a query is
one bucket, and the rebuild happens on tile changes rather than on frames.
A separate probe walked the real page 400 frames on eight headings with and
without collision and compared END POSITIONS — 0.0-0.6 m apart on the four
that run down the open street the scenario starts on, 3.5, 6.4, 16.0 and 25.0 m
apart on the four that walk into the block, which is how the bench comparison
is known to be between an active path and an inactive one rather than between
two no-ops.

Gates: `walkCollision.test.ts` (the model: stop distance, slide, corner, gap,
narrow gap, escape from inside and from the shell, metres at latitude 60,
holes, the index's neighbourhood) and `widget.walkCollision.test.ts` (the
wiring: extrusions block, fills do not, buildings that stream in block,
removing a layer frees the street, the ghost key, the option, blur).

### The `/maps` gate, and why it is not about layers

`website/src/components/MapsWorkbench/mapsWalk.ts` owns the gate. It was first
surfaced as a **Walk row in the Dock's View folder**, under Tilt and Bearing,
and that placement was rejected outright: "that walk shouldn't be a toggle ...
it feels stupid as a checkbox". The objection is right and it is the same one
`MapCompass` answers. Walk is a MODE — the reader stops looking at the map and
stands in it — and a mode is not a preference ticked beside a slider. Every
map product that ships one puts it ON the map: Google Maps' pegman sits
permanently in a corner, greys where the mode cannot be entered, and is an
ICON rather than a word and a tick.

So the control is `MapWalkButton.tsx`, the third of this page's map overlays
after `MapCompass` (top right) and `MapSearchBox` (top centre): `position:
absolute` inside `InstrumentMain`, `z-index: 20`, `pointer-events: auto`,
covering only its own box, in the bottom-right corner nothing else on the page
claims. Unlike the compass it is ALWAYS rendered — the compass is FEEDBACK
about a state the reader created, this is an ENTRANCE, and an entrance nobody
can find is not one, which was the whole complaint. While walking it becomes
the way out and carries the keys (`WASD` / `Shift` / `G` / `click` / `Esc`, the
parthenon's own sidebar legend plus the collision defeat key, needed here
because pointer lock hides the cursor) plus the horizon and tile-budget readout the Dock used to hold. Tilt
and Bearing stay in the View folder and keep meaning something while walking
(the walker's pitch and heading), which is what the old placement argument was
really about.

Two clauses, each disabling the control with its own reason on its `title` and
`aria-label` rather than leaving an inert one — `mapDirectionLocked`'s
Azimuth/Elev treatment, and Google's own greyed pegman:

1. **The globe.** A flat sheet puts X/Y in degrees and Z in Earth radii, so
   anything standing up — a 20 m building, a mountain — is drawn 85x too short
   relative to its own footprint. `setWalk` throws a `RangeError` on a sheet;
   this gate is what stops a reader ever reaching it.
2. **Already near the ground.** `GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG` = 0.05
   (~5.6 km, ~40 m per cell on this page's grid). At eye height the walker
   sees a few hundred metres, so entering from much further out discards everything on
   screen, which reads as the map blanking rather than as a mode changing.

**There is deliberately no clause about WHICH LAYERS ARE MOUNTED.** An
earlier draft gated this on OpenStreetMap and put the toggle on the OSM card,
and that was wrong on the mechanism: the property that makes walk mode safe
was never "the data is OSM", it is that the eye is near the surface, so the
Earth is locally flat over the visible frame and `glyphMapGlobe.visible()`'s
orthographic path is never consulted. That property holds identically over
bare terrain. The walker's height comes from `groundElevationSampler`, which
answers off ANY mounted `raster` layer's own tiles (finest tier first) and
answers `null` — the datum, correct and not an error — for none. So walking up
a ridge with only the relief mounted is the same code path as walking down a
street, and `widget.walk.test.ts` pins the climb on a raster-only map.

The TILE cap is not an OpenStreetMap concern either: a ground-level footprint
reaching the horizon is swept the same way over a mountain range as over a
city. What the two do NOT share is the COST of the horizon — a terrain walk on
this page's own curated z7 relief (2.8 deg tiles) is one tile and one mesh at
any `far` on the ladder above, so `GLYPH_MAP_WALK_FAR_M` is paid for entirely
by the extruded footprints inside it. The walk overlay's horizon readout
quotes the budget at z14, the densest level the page serves.

Gates: `widget.walk.test.ts` (entry, step, terrain, exit, footprint),
`widget.walkHorizon.test.ts` (the tile sweep reaching across a tile edge, and
the LOD not depending on the window width), `walk.entryGate.test.ts` (the
horizon against the gate a shared walk link is re-run through, and the box
half of the local horizon), `widget.walkLens.test.ts` (the FOV the camera
actually produces, its
width-invariance, the resize re-application, the near plane),
`widget.walkLook.test.ts` (pointer-lock wiring, the look rate, the pitch
clamp, and the eye that does not move), `mapsWalk.test.ts` (the gate),
`MapWalkButton.test.tsx` (the overlay and its disabled reason),
`mapsKit.viewFolder.test.tsx` (the folder must not grow the rows back).

The toggle is NOT part of the URL state: it is a mode a reader steps into and
back out of, and a shared link that dropped someone at eye height would hide
the map they were sent. The gate is recomputed from live state, so switching
projection or flying out while walking auto-exits — which costs nothing,
because leaving restores the pre-walk view exactly.

## The frame budget, and the double render that was in it

Reported as "it goes slow as fk ... the fps drop and the hang", most acutely in
walk mode. It was two different things and only one of them was a defect.

Everything below is measured in a REAL browser — `bench/maps-render`, headed
Chromium, `astro preview` (not the dev server), `--encoding spans`,
1440x900, grid gate `140x63` held on every row, Zürich at `span 0.02` with the
OpenStreetMap card's `water` / `roads` / `boundaries` / `buildings` rows on.

### The defect: a scene write placed after the frame's own render

`createGlyphScene`'s `rerender()` supersedes a queued microtask render — it
bumps `renderGeneration` and clears `pendingRender` — so a scene write BEFORE
it costs nothing and the identical write AFTER it arms a second, full,
never-superseded render on that same task's microtask checkpoint. The widget
knew this for `applyKeyLight` (its comment said so) and had `syncNearSide()` on
the wrong side of the line in all nine of its render paths. For a
`fill-extrusion` layer that sweep calls `syncWalls`, which re-culls the
far-side walls and hands the survivors to `handle.setPolygons()`.

Worse, `applyDrag`/`applyOrient` ran the same sweep synchronously per
`pointermove` — added to close a one-frame `opacity` flicker on symbols — so
with buildings mounted a trackpad bought a whole grid render PER EVENT.

Attributed rather than guessed: a probe inside `scheduleRender` reported
exactly two arms per walking frame, `applyKeyLight → setOptions` (superseded)
and `syncNearSide → syncWalls → setPolygons` (not).

| | before | after |
|---|---|---|
| walk, W held | 38.5 fps, **1.72** renders/frame, task 23.7 ms | **58.7 fps**, 0.87, task 13.9 ms |
| drag at street level | 11.8 fps, **2.98** renders/frame, task 85.3 ms | **28.8 fps**, 1.00, task 34.8 ms |
| walk frame gap p50 / p95 / p99 | 32.9 / 33.9 / 49.8 ms | **16.7 / 17.4 / 33.4 ms** |
| drag frame gap p50 / p95 / p99 | 83.3 / 100 / 100.6 ms | **33.3 / 50 / 50.4 ms** |

The painted picture is unchanged: the second render was the painted one and it
used exactly the cull the first now gets.

The fix is an ORDERING plus a SPLIT. `syncNearSide()` moved ahead of
`scene.rerender()` everywhere; the sweep split into `syncNearSideDom` (the
`opacity`/`visibility` channels, what an input handler runs — it cannot arm a
render) and `syncNearSideGeometry` (the wall cull). `map.scene` is a documented
escape hatch a host may repaint through at any time, and
`widget.extrusionWalls.test.ts` pins that one `pointermove` across the limb
followed by a raw `scene.rerender()` with NO frame awaited shows the wall band
— so the handle's `scene` is a proxy whose `rerender` runs the geometry sweep
first. That keeps the guarantee and still costs nothing, because the sweep is
then immediately followed by the `doRender()` that supersedes it.

Both halves are mutation-checked: putting the frame sweep back after
`rerender()` fails at 2 renders for 1 frame, and letting the input handler
sweep geometry again fails at 12 renders for a 12-event burst.

### What the walk frame is actually spent on

Zürich, 140x63 = 8,820 cells, one render:

| mounted | base-pass polygons | base-raster | render burst | fps |
|---|---|---|---|---|
| terrain only | 16,840 | 3.46 ms | 3.8 ms | 60.0 |
| + water / roads / boundaries | 17,456 | 5.37 ms | 5.7 ms | 59.8 |
| + buildings | 61,063 | 9.31 ms | 11.0 ms | 58.2 |

**6.9 polygons per glyph cell** with buildings on, against asciiQuake's 0.63 on
the same renderer. Buildings alone are 43,607 of the 61,063. This is the
mesh/product decision `bench/maps-render/README.md` already names for the
globe, arriving at street level for a different reason: a few hundred metres of
horizon over a city is thousands of extruded footprints, and none of it is renderer waste.

### The two things a reader can spend by accident, priced

Both are pre-existing mechanisms and both are reachable from ONE slider on the
OpenStreetMap card. Same scene, same walk, only the densities changed:

| configuration | fps | render burst p50 | frame gap p50 / max | long tasks |
|---|---|---|---|---|
| every row at 1x (the default) | 58.4 | 11.2 ms | 16.7 / 116.7 ms | 1 (122 ms) |
| `roads` at 2x — ONE stroke overlay grid | 40.6 | 20.1 ms | 17.1 / 183 ms | 1 (195 ms) |
| three line rows at 2 / 2.1 / 2.2 — THREE grids | 21.4 | 30.2 ms | 50 / 366 ms | 162, worst 383 ms |
| `buildings` at 2x — ONE separated OPAQUE detail mesh | 21.7 | 35.6 ms | 50 / 367 ms | 90, worst 375 ms |
| the card's master slider at 2x (all ten rows) | 18.3 | 39.1 ms | 65.7 / 433 ms | 251, worst 454 ms |

Each DISTINCT stroke density is a full-viewport overlay grid with its own depth
pass and costs **+9 ms per render**, linear in the grid COUNT — which confirms
the node/happy-dom ratio (27.4 ms for one, 63.4 for three) in a real browser.
One opaque separated detail mesh is worse: **+24 ms per render**, `detail-project`
alone 20.7 ms, because `computeOcclusionIds` rasterizes the whole scene into the
shared id-map once per render. Neither is new and neither is a bug; what is new
is that the card mounts up to ten layers and hands all of them to one slider,
so a reader reaches 3.2x the frame cost in one gesture with no warning.

### The hang, located

Two different things wear the same word.

**Sustained**: every configuration above with a density above 1 sits at
50-67 ms per frame — hundreds of >50 ms long tasks, 15.2 s of blocked main
thread in a 250-frame window at the master 2x.

**A single stall**: at the defaults, walking blocks the main thread for
**117 ms exactly 302 ms after the key is released** — the 180 ms
`scheduleTileUpdate` debounce firing, plus the frame it lands in. Nothing over
40 ms happens while the key is DOWN. It scales with what the sweep has to
rebuild: 0 long tasks with no OpenStreetMap layer mounted, one of 57 ms with
the line rows, one of 121 ms with buildings. Clicking the pegman costs the
same kind of stall twice — 117 ms + 250 ms entering, 216 ms leaving.

**Memory is not in it.** Three minutes of continuous walking: heap sawtooths
between 79 and 422 MB and ends where it started (217 -> 206 MB), frame gap p50
16.7 / p95 18.2 / p99 18.7 / max 116.7, renders/frame 0.97. No growth, one
stall, and that stall is the tile settle above.

### Killed: the tile-fetch storm

`motionStep` calls `scheduleTileUpdate()` on every moved frame, so a held
movement key re-arms the 180 ms debounce forever and the sweep never fires
while walking. That is real and deliberate (the same clause keeps a glide or a
flight from fetching at every waypoint), but it produces neither a storm nor a
visible starvation at the distances a reader covers: two walks of 2.16 km each,
one continuous and one letting go for 300 ms every 10 s, both issued **zero**
tile requests while moving and zero after stopping — the footprint never leaves
the mounted z14 ring. An unbounded walk would eventually outrun its data; that
is a policy question, not a measured defect.

### Killed: a metrics mismatch behind the walk camera's geometry

Reported alongside as "the buildings are not straight ... walking with some
weird angle". `glyphMapWalkLens` is solved against `grid.cols * grid.cellWidth`
from the widget's own `projectionGrid()`, while the rasterizer projects with
glyphcss's separately MEASURED monospace advance, and `resolveProjectionMetrics`
falls back to `BASE_TILE / cellAspect` when none is supplied — so the two could
in principle disagree on the real page while agreeing under
`stubMonospaceMetrics`. Measured live, they do not: 7.82701 px against
7.82668 px (0.004%), `centerCol` 70.2056 against 70.2086, and the fallback is
never reached.

The camera is right on every axis that was questioned. A 30 m world vertical
projects with `dcol` **0.000** at the centre, at both frame edges, at bearing 0
and at bearing 45 — no lean and no keystoning at all, which is what the CSS
perspective model gives for a level camera. Horizontal FOV measures **69.84°**
against the 70° asked. The picture is isotropic to **0.18%** (one true metre
across is 39.1222 px, one true metre up is 39.0523 px, and the ratio is the
same at 20 m, 80 m and 300 m). The camera is level: eye-height points at 60 m
and 300 m land on rows 31.846 and 31.848, on the projection's own centre row
(31.846).

What IS there is the 70° lens itself. A rectilinear projection draws a 1 m
object at the frame edge `1/cos(35°)` larger than the same object dead ahead at
the same true distance — measured 1.0154x at 10°, 1.0642x at 20°, 1.1547x at
30°, **1.2208x at the 35° edge**, matching `1/cos` exactly. That is correct
projection and the classic wide-angle look; `GLYPH_MAP_WALK_FOV_DEG` is the
only lever on it.

### Fixed: raising the view blanked the frame

Reported as "when I raise the camera the whole rendering / buildings disappear".
It is one expression, and it is `glyphMapGlobe.visible()` — consulted by four
of the widget's five point consumers while a positioned PERSPECTIVE camera is
installed.

That test computes `axial = depthOf(world) - depthOf(origin)`, accepts
`axial >= 0` as "in front of the sphere's centre plane", and otherwise asks
whether the point falls outside the silhouette CYLINDER of radius `radius`
about the view axis (`|world|² - axial² >= radius²`). Both halves assume the
ORTHOGRAPHIC camera's own depth — the raw rotated `z`, in the same WORLD units
as `|world|`, which is what makes the comparison dimensionally legal at all.
The walk camera's `project()[2]` is `r_z * BASE_TILE - distance`, i.e. **50×**
that; and its eye is ON the sphere rather than infinitely far from it, so
"behind the centre plane" stops meaning "round the back of the world" and
starts meaning "the view axis is tilted up by anything at all".

Measured through the real camera at the default walk entry (radius 1, so
`axial` is comparable to 1), for the ground 80 m in front of the walker:

| camera tilt | pitch | `axial` | `|world|² - axial² - 1` | verdict |
|---|---|---|---|---|
| 88 | −2° | +1.7443 | −3.043 | true (first clause) |
| 90 | 0° | −6.278e−4 | −3.94e−7 | **false** |
| 90.1 | +0.1° | −8.789e−2 | −7.73e−3 | false |
| 95 | +5° | −4.3584 | −18.996 | false |

`axial` is `-BASE_TILE · sin(pitch)`, so five degrees of looking up places the
pavement under the walker's feet four and a third EARTH RADII off the view
axis. Every consumer of the verdict then rejects everything at once, which is
why the whole picture goes rather than a piece of it.

Two consequences, both measured at 140×63:

- **Buildings.** A 300 m block 80 m ahead painted 4,900 cells at every pitch up
  to +0.01° and **0** from +0.1° up — a cliff, not a fade. It survived level
  pitch only by accident: a wall is kept when ANY of its four corners passes,
  and at pitch 0 a corner 300 m up has `|world|² - 1 = +9.4e-5` against an
  `axial²` of 3.9e-7, so the TOP corners carried it.
- **Roads.** A ground-level `line` has no such margin (`|world|` is exactly
  `radius` at the datum, so the test needs `axial === 0` EXACTLY). A road 30 m
  in front of the walker painted 140 cells at 2° of down pitch and **0** at the
  DEFAULT entry pitch — walk mode shipped with its roads already missing.

The same expression is wrong in the other direction too, which is what
disqualifies it as a far-field cull rather than merely mis-scaling it: looking
DOWN, `axial >= 0` accepts every distance, and a block six horizons away
painted 24 cells at 10° of down pitch.

**The fix** is the branch `walk.ts`'s header has always described and only
`project()` actually had: one predicate, `nearSideVisible(lon, lat, world,
grid)`, which answers `glyphMapWalkWithinHorizon` while walking and
`projection.visible` otherwise. All five point consumers route through it —
`project()`, `visibleStrokeRuns`, `unprojectSphere`, marker/point-hotspot sync,
and `nearSidePredicate` (the wall cull). `glyphMapGlobe.visible()` itself is
untouched; `widget.farSideFill.test.ts` and `widget.farSideStroke.test.ts` are
the orthographic contract and go red (5 clauses, 238/258/122/2,114/46 leaked
cells) the moment the branch leaks out of walk mode.

`isBoundsVisible` does not route through `nearSideVisible` either — it takes
the same horizon as a BOX rather than as a point (`glyphMapWalkBoundsWithinHorizon`).
The distinction is the whole of it: a z14 tile is 2.4 km across, so a `far`
DISC tested against the tile's own sample POINTS would reject the very tile the
walker stands on, while the distance to the BOX is zero there by construction.
Staying on `projection.visible` here — on the argument that the sweep is
pitch-invariant either way, which it is (terrain painted the same 4,340 cells
before and after a look up past the horizon) — was measured keeping 1 tile of
35 once real city data was mounted. See "The horizon is 600 m" above.

After the fix the picture behaves like a picture, on the same 300 m block:
4,900 cells level, 5,040 at +1°, 5,740 at +5°, 6,580 at +10°, 8,511 at +30°,
7,341 at +45° and 1,831 at the +84° neck limit — rising as the block fills the
frame, then falling as its top passes overhead. Roads hold 140 cells at every
pitch from −10° to +10°. Gate: `widget.walkPitch.test.ts`.

## The OSM buildings row: `render_min_height`, the facade, and a per-footprint tone

The report was "the buildings all look the same". Three things already existed
and were not wired to `GLYPH_MAP_OPENMAPTILES_LAYERS`' `building` row; wiring
them found a fourth (the facade's own tile was tuned in the wrong view) and a
fifth (a per-feature colour seed cannot work on this schema at all).

### `render_min_height` is real data, and it was being thrown away

The row set `heightProperty: "render_height"` and nothing else. The service's
own TileJSON declares `render_min_height` as a second `Number` beside it, and
every feature in a real tile carries both — measured on five live z14 city
tiles fetched for this work:

| tile | buildings | non-zero `render_min_height` |
|---|---|---|
| Zürich `14/8580/5737` | 82 | 9 (11%) |
| Manhattan `14/4824/6157` | 1,488 | 272 (18%) |
| Paris centre `14/8298/5636` | 150 | 59 (39%) |
| Paris Eiffel `14/8296/5636` | 68 | 22 (32%) |
| London `14/8186/5448` | 510 | 267 (52%) |

The vendored fixture `fixtures/openfreemap/z14-8579-5736.mvt` (Zürich, 50
features) has 8. So this is not a hypothetical: 11–52% of a city tile's
features are parts of a stepped mass whose base was being discarded, and the
whole mass was drawn from the pavement.

The clearest single example, read out of the live Eiffel tile: the tower is
**35 parts**, `0 → 3 m` up to `300 → 330 m` — four legs `4 → 58`, the first
platform `57 → 61` (99 × 99 m), four legs `57 → 116`, the second platform
`115 → 120` (53 × 53 m), a `115 → 277 m` shaft and a `300 → 330 m` summit.
With the base dropped, every one of those is drawn from the ground and the
tower is a solid nest of boxes.

### The two properties share ONE datum, and it had never been decided

`glyphMapVectorMesh`'s primitive is a thickness measured up from the offset
(`base = ground + baseOffset`, `top = base + height`), which is the right
primitive and is pinned by `layers.extrusionHeight.test.ts`. But at the LAYER
level both OSM and OpenMapTiles measure height and base from the same ground:
a `building:part` tagged `min_height=115, height=277` *is* the piece between
those two elevations, exactly as MapLibre's `fill-extrusion-base` /
`fill-extrusion-height` pair. So the layer subtracts. Adding — which is what
the untested composition did — makes a stepped structure GROW rather than
stack: the Eiffel shaft would run 115 → 392 m and its summit 300 → 630 m.

`max(0, …)` clamps the degenerate rows real data carries: 5 of the 629
non-zero features across those five tiles have `render_height` below their own
base. `heightScale` scales both, since under one datum they are the same
quantity in the same frame.

Nothing shipping exercised the pairing before (the Protomaps buildings layer
carries only `height`), so this was a decision, not a break.

### A per-FEATURE colour seed cannot separate anything on this schema

`colorVariation` was seeded from `glyphMapFeatureSeed(feature)`. On a real OSM
pyramid that is close to useless, because the tiler emits every
attribute-identical building as ONE multipolygon:

| tile | features | footprints | largest single feature |
|---|---|---|---|
| Zürich `14/8579/5736` (vendored) | 50 | 1,991 | 400+ |
| Zürich `14/8580/5737` | 82 | 3,582 | **2,437** |
| Paris centre | 150 | 5,228 | 1,265 |
| Manhattan | 1,488 | 4,835 | 268 |

2,437 buildings in one tone is the report. So `glyphMapVectorMesh` now
resolves `color` once per polygon GROUP rather than once per feature, handing
the callback that group's own anchor (its outer ring's first vertex, read
BEFORE the winding normalisation, which reverses rings), and
`glyphMapFeatureSeed` takes it as an optional second argument. A
colour-by-attribute callback ignores it and is unchanged.

### The range, chosen on real footprints rather than by eye

`GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION = 0.5`. Measured over 400
real footprints from the vendored tile, "separable" being a redmean distance
above 40 between a footprint and its nearest geographic neighbour:

| amount | neighbours separable | widest excursion from the row colour (redmean) |
|---|---|---|
| 0.15 | 6% | 31 |
| 0.25 | 46% | 52 |
| 0.35 | 73% | 73 |
| **0.5** | **88%** | **105** |
| 0.7 | 93% | 146 |
| 1.0 | 95% | 209 |

0.5 is the knee. Past it each extra point of separation costs roughly twice
the spread, and redmean spans ~765 over the whole gamut, so 105 keeps every
building inside ~14% of the row's own colour — one material — while 209 is a
city of unrelated colours.

### The facade was tuned in the wrong view

`facade.ts` was authored and measured against an ORBIT view; walk mode did not
exist yet, and eye height is the view the reader judges it in. Measured there
— five standing points from the vendored tile × four distances (12/30/90/200 m),
through the real widget and the real rasterizer:

| window level | mean run vs no facade | viewpoints improved | wall cells DELETED |
|---|---|---|---|
| 58 (as shipped) | **0.71x** | 0 / 20 | **1,523** |
| 80 | 0.81x | 8 / 20 | 0 |
| 100 | 0.72x | 2 / 20 | 0 |
| 120 | 0.74x | 5 / 20 | 0 |
| **140** | **0.88x** | **10 / 20** | **0** |

Two separate defects, both from the same constant. A texel MULTIPLIES the
cell's intensity, so a window at 58/255 = 0.23 of the surface put wall cells
below the level at which the rasterizer prints anything: the facade was
punching holes in buildings. And the pier/window ratio is what ALIASES — a
3.6 m bay is under one character cell wide past ~60 m, and the rasterizer
point-samples — so 4.3:1 turned a far wall into salt-and-pepper and made it
measurably noisier than no facade at all.

The pier also moved 250 → 255, so it is the identity: a facade now only ever
takes light away, and an untextured reading is exactly the layer's own colour.

At 12 m from a real 81 m wall the difference is visible directly. Before, a
window band rendered as ` . . . . ` and `.......` — gaps in the wall. After,
it renders as `::::::::::` against `-===-===` piers, and the bay rhythm is
countable. The rhythm holds from 3 m (windows 17–25 cells wide) to 90 m;
`GLYPH_MAP_FACADE_BAY_METRES` (3.6) and `GLYPH_MAP_FACADE_FLOOR_METRES` (3.2)
were checked across that range and left alone.

Caps stay untextured, and that is now asserted end to end: a top-down frame
over the real tile is byte-identical with the facade on and off.

### The one existing assertion that had to move

`widget.facade.test.ts` carried `meanRun(facade) > meanRun(flat) * 1.3` on a
camera at which one 3.6 m bay is **1.4 character cells** wide — under the rate
at which the rasterizer samples the texture. What that threshold actually
rewarded was therefore the AMPLITUDE of the aliasing, not the presence of
structure, and the only tile that cleared it was the 58 that deletes 1,523
wall cells on real data. Every low-contrast candidate was tried against it,
including a full-width floor band (which is constant in `u` and so cannot
alias horizontally, and which does clear the threshold at 2.79) — but the band
renders as a third dither at eye height and looks worse in the view that
matters.

So the margin moved rather than weakened: it is asserted at the same 1.3x in
`widget.osmBuildings.test.ts`, 12 m from the real 81 m wall (1.34 untextured,
1.96 with the facade), and `widget.facade.test.ts` gained the
scene-independent guarantee the old threshold could not express — texturing a
wall may not REMOVE it.

### Cost, measured separately

Through the real renderer at 140×63 over the vendored tile's 1,991 footprints,
five passes, warm:

| | mesh build | render, street level | render, orbit |
|---|---|---|---|
| none | 17.6–19.7 ms | 1.90–2.07 ms | ~2.0 ms |
| + facade | +1.5 ms | **4.01–4.57 ms** | +0.1–0.2 ms |
| + `colorVariation` | +1.5 ms | 1.92–2.15 ms (free) | free |
| + `baseOffsetProperty` | free | 1.84–2.04 ms (free) | free |
| all three | ~20.9 ms | 3.77–3.85 ms | +0.4 ms |

The facade is the whole cost and it is scale-dependent in the favourable
direction: it is paid where walls dominate the picture and is nearly free
where they do not. No span rule is needed, and the schema makes the point
anyway — `building` has `minzoom: 13`, so at any view where this row draws at
all the reader is at city scale.

### Defaults, not controls

All three are on by default for the `omt-buildings` row and none gets a
control. Each answers a defect rather than adding a style, `colorVariation`
and the base are free, and the facade at ~2 ms is worth it at the only scale
the row exists at. A caller who disagrees owns the returned layer objects.

## The walk-mode sky (`sky.ts`)

Asked for as "lets put the sky, shall we? we can use a similar method to the
examples/parthenon — but lets not set clouds for now, the sky + sun is
enough … only in FPV view ofc".

### The sky is real geometry, and that is the whole design

`website/src/pages/examples/parthenon.astro` builds one and it works. The
idea taken whole is that the sky is a large INWARD HEMISPHERE added as an
ordinary mesh. Everything else follows: the renderer projects it exactly like
the terrain, so it is anchored to the world with zero camera math; it is
occluded by whatever is nearer, so a building's roofline cuts into it for
free; and it moves under a look the way the world does, because it is in the
world. There is no sky pass, no "paint the cells above the horizon", no
re-derived view axis.

The cloud half of that page is deliberately absent.

### Lambert had to be defeated, and the parthenon's escape does not port

An inward hemisphere's normals face the viewer from above, so ordinary
shading modulates the dome by wherever the key light points — a sky is not a
lit surface. The parthenon's answer is an appearance program over the dome's
own surface, and that is the answer here too.

Where it differs is the discriminator. That page asks "am I on the dome" with
`dist < SKY_R * 0.6` — distance from the WORLD ORIGIN — which is only
meaningful because its world is centred on the camera. A map's origin is the
centre of the Earth, and, crucially, **terrain beyond the dome radius
genuinely renders**: the walk horizon (`glyphMapWalkWithinHorizon`) gates
`fill-extrusion` walls, markers and point features, and nothing else. The
raster relief mesh is never horizon-culled — it draws to the mounted tile's
full extent, which on `/maps`' curated z7 pyramid is hundreds of kilometres.
A distance test would therefore paint far terrain as sky.

So the layer is MESH-TARGETED at the dome's own handle (AGENTS.md's
"Per-object targeting"): `target.coverage` is exactly the cells whose depth
winner is the dome, and no radius heuristic exists at all. That is also why
the dome is mounted only in solid mode — mesh targeting reads `winnerMesh`,
which is null elsewhere, and `worldPosition` is a hard requirement. A dome
mounted where the program cannot run would be a Lambert-shaded hemisphere,
i.e. the exact thing the program exists to prevent.

`ambientIntensity` was never a candidate: per AGENTS.md it pops the mesh into
its own `<pre>`, and one opaque separated layer makes `computeOcclusionIds`
raster the whole scene per render — measured on this page at +10.4 ms/frame,
more than the entire feature costs.

### The radius, and the premise that turned out to be false

The dome sits at `GLYPH_MAP_SKY_RADIUS_FRACTION` (0.98) × `far` — 588 m at
the shipped 600 m horizon. The brief's reasoning was that everything past
`far` is already culled, so a dome just inside it becomes the backdrop
exactly where the world stops, with no depth-range fight.

**Half of that is wrong and it was measured, not assumed.** Extrusion walls
and point features do stop at `far`; the relief mesh does not. Rendered at
`/maps`' default Zürich walk (1440×900, 140×63, OSM water/roads/boundaries/
buildings, `exaggeration: 24`), of 8,820 cells the dome fills **1,903 that
were blank** and takes over **678 that the distant exaggerated relief had
painted** — a jagged green mass reaching a third of the way up the frame,
replaced by sky and a clean horizon line.

That is kept, on the argument that it is what makes it a sky rather than a
wash in a small blank wedge, and that at `exaggeration: 24` the far field it
replaces is a coarse stepped ramp rather than a legible hillside. It is a
real change to what a walker sees and is recorded here as one. The lever if
it is ever wanted the other way is the fraction: a dome beyond the mounted
tile's own reach would occlude nothing, at the cost of the sky only appearing
where geometry does not.

The slack the fraction leaves is not spare — it is the re-centring budget
(below), so the two numbers are one decision.

### Re-centring: a rebuild, on the horizon's own test

`glyphMapSkyRecentreDistanceM(far)` is `far * (1 - fraction)` = 12 m at the
default, and `advanceWalk` re-centres when the walker leaves that radius —
measured with `glyphMapWalkWithinHorizon` against the dome's own centre, i.e.
the same great-circle test the horizon already uses. At 6 m/s that is one
rebuild every two seconds, or two thirds of a second at a run.

It re-centres by REBUILDING world-space polygons (`setPolygons`), not by
`setTransform({ position })`, and that is not a style choice:
`createGlyphScene.ts`'s `cullChunkCache` is keyed on the TRANSFORMED polygon
array's identity, so an untransformed mesh gets the same array back from
`applyTransform` every render and its pre-projection cull runs are built once,
while a transformed one rebuilds them on every single render. A dome that
followed the walker through a transform would pay per frame what it now pays
per 12 m.

A re-centre also re-probes the ground under the walker, so the rim follows
the relief instead of staying at the elevation the walk was entered at.

The test shrinks `far` to 12 m (dome radius 11.76 m) so that "walked clean
out of the sky" is a handful of frames rather than 33 seconds of running.

### The sun is the scene's own, and a headlight is not one

The disc is drawn at the direction the frame was actually lit by, and the
gradient is a function of that direction's ALTITUDE above the walker's local
horizontal. Precedence: `sunDirection()` first (the widget's real NOAA solar
vector, so sky and terminator can never disagree), then the consumer's own
`scene.directionalLight.direction` — which is how `/maps`' Azimuth/Elev
sliders reach the sky, through the `publicScene` proxy's `setOptions` so a
reader standing still still gets a fresh sky.

**A headlight is declined**, and this is the one place the sky departs from
`getKeyLightDirection()`. A headlight IS the camera's view axis. Taken as a
sun it glues a disc to the middle of the frame and makes the sky's altitude
equal the reader's pitch. Measured on `/maps`' own default — Sun "Full" on an
orbit projection, which `mapKeyLightForSunMode` resolves to a headlight — a
level gaze put the light's altitude at −0.02° and rendered the entire sky at
DUSK, at every hour of every day. The widget's own precedence note already
carries the reason: a real sun is a statement about the world and a headlight
one about the viewer, and a sky is part of the world. With no world sun the
sky is plain daylight and draws no disc at all.

### Banding, because a continuous ramp costs spans

`stampGlyphMapNight` already paid for this lesson (1,679 spans / 9.40 ms
against 123 / 1.00 ms for a continuous night ramp), and the sky is the
largest flat region a street-level frame has. The gradient parameter is
quantized into `GLYPH_MAP_SKY_BANDS` (32) steps, so each band is one colour
and one glyph; a bearing keeps the horizon level, so the bands run along
screen rows.

Measured on the real page under `spans` encoding: the sky adds **1,903
painted cells for 26 extra spans** (835 → 861), i.e. about 73 cells per span,
and `commit-write` in the render bench is flat at 0.65 ms with and without.

The glyph is picked from `GLYPH_MAP_SKY_RAMP` by the band colour's own Rec.
601 luminance rather than by the band index, so a mono render
(`useColors: false`) shows the same gradient and the same glow. The ramp
contains no space: a blank cell is a hole, not a dark sky.

### Cost

`bench/maps-render --scenario walk --walk-look 0`, headed, 1440×900, 140×63,
spans encoding, Zürich with the OpenStreetMap water/roads/boundaries/
buildings rows on, three runs each through the widget's own
`setWalk({ sky: false })` reconfigure (`--walk-sky off`) so both halves are
the same build and the same scene:

| | fps | base-raster ms/render | ms/render | commit-write | base polys |
|---|---|---|---|---|---|
| sky off | 41.8 | 10.37 | 13.49 | 0.65 | 61,647 |
| sky on | 40.2 | 10.72 | 13.20 | 0.65 | 62,016 |

+0.35 ms of base raster (384 quads plus the compositor's pass over the grid),
no commit-write cost at all, and about 1.6 fps of a 42 fps frame. The eight
fidelity waypoints, which are all outside walk mode, hash identically with
the sky on and off (`492cc3d90b4f2b7ba55cb7dd`) — the feature changes nothing
a non-walking map renders.

### The horizon seam

The dome is centred on the walker's own GROUND point, not on the eye. On the
eye its rim would sit exactly on the horizontal, leaving a sliver between the
last terrain the picture holds (flat ground at radius `R` projects
`atan(1.7 / R)` = 0.166° below the horizontal) and the first sky cell. On the
ground the rim is that same 0.166° BELOW the horizontal, so it overlaps the
terrain band by construction and whichever is nearer wins the ordinary depth
test. Rendered, the join is one row: the last sky band and the first terrain
row abut with no gap and no double-drawn line.

### Two existing assertions had to change their METRIC, not their claim

`widget.walk.test.ts`'s "draws the buildings inside the horizon and none of
the ones past it" and `widget.walkPitch.test.ts`'s "still refuses everything
past the local horizon, at every pitch" both measured total ink in the
`<pre>` and asserted zero. A street-level frame now has a sky in it and is
never empty, so ink stopped being the block's own contribution. Both now
compare against the IDENTICAL scene with no block mounted — "the far block
changes not one cell" — which is the same property stated more strictly.

### And one latent flake, closed rather than lived with

`widget.walkCollision.test.ts` drives real rAF frames and asserts METRES, and
the motion loop's `dt` is the wall clock (`rAF now - previous`, clamped to
`[1, 64]` ms). The harness sat ON the 1 ms floor, so it was calibrated for
frames that cost nothing — and any machine load pushes a frame to 10 or 60 ms
and multiplies one step by up to 64. Adding a test file to the maps worker
pool was enough: two clauses with tight distance windows (a two-frame drive
that must stay short of `STREAM_WALL_M / 2`, and the slide's tangential
travel) began failing in roughly a third of full-suite runs, on a change that
touched nothing about collision.

Giving those walks `sky: false` did NOT fix it, which is what identified the
cause correctly: the trigger is the added parallel load, not the sky's own
render cost. `requestAnimationFrame` is now stubbed in that file with a clock
that advances by exactly 1 ms per fired callback, and `driveForward` waits on
a plain macrotask rather than borrowing a frame of its own (which would
double every `dt`). That reproduces the file's own calibration exactly — the
first frame carries the loop's 16 ms seed and the rest sit on the floor, so
an unobstructed 40-frame drive is 55.000 m and a two-frame one is 17 m,
bit-identical across runs — and four consecutive full-suite runs are green.
The walks also keep `sky: false`, on its own merits: nothing in that file
looks at a pixel.
