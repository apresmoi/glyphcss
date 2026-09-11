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
2x level steps actually leave. "Crop, don't clamp" and the per-quad
`localUpDirection` winding probe are both recomputed from the COARSE quad's
own corners; the elevation feeding `opts.color` is the deliberate exception
and reads the tile's own full-resolution surface over the block the coarse
quad covers (next section). Vertex elevation is POINT-sampled at the
retained vertices, never aggregated (mean/max) over the skipped block: an
aggregate would need a symmetric window that reaches outside the tile
exactly on the boundary ring where crack-freedom is decided, and a tile
holds only its own samples. The cost is peak fidelity — a lone summit
between retained vertices is dropped rather than averaged in.

### A quad's colour is the median of the SURFACE it covers

`colorSample: "surface-median"` (the default) hands `opts.color` the level
that halves the AREA of the tile's own full-resolution bilinear surface over
the block `[col..colNext] x [row..rowNext]`. Two earlier rules were tried on
real data and each broke in the opposite direction; this one is not a third
guess but the same idea as the second with its evidence corrected.

**The 4-corner MEAN painted the Andes as ocean.** Where a quad straddles a
coastline the mean is dragged below zero by the ocean corner, and the deeper
the adjacent ocean the further inland it reaches — measured on the real
ETOPO1 pyramid, the floor tier's quad covering Bogota averaged **-155 m**
across its corners over terrain that is 379 of 441 samples above sea level
(Quito's **-718 m**), which `GlyphMapClassifiers.etopo1V1` paints
bathymetric blue. Point-sampling the quad CENTRE was measured as the obvious
alternative and is worse than the mean (268 majority-land quads
misclassified across an Andes window against the mean's 65): it drops into a
river, lake or inlet.

**The SAMPLE median fixed that and was defended with a guarantee that does
not hold where it matters.** The claim was: "if strictly more than half a
quad's covered samples are at or above sea level then more than half the
sorted samples are, so the sample at index `n >> 1` is too — a majority-land
quad can NEVER be classified below sea level, at any mesh resolution". The
arithmetic is right and the premise is not, because `n` is 4 at the tier a
reader actually looks at: `widget.ts`'s `reliefFractionForLevel` returns 1
for every span the target tier is drawn at, so a quad's "covered samples"
are its own four corners and `values[2]` of four is an upper median — a
3-of-4 vote, ties to land, magnitude ignored. Reported live as Buenos Aires'
city centre rendered as river: the z4 quad under downtown reads
`(nw -1, ne -1, sw +12, se -1)`, three estuary samples outvote the city, and
at the reported span that single 0.125-degree quad covers 54% of the screen
with a straight edge through Retiro and Palermo. **2,756 base cells that
OpenStreetMap's own water polygons call land were painted as water** (1,673
of them visible, the rest under roads), while 72.6% of the surface drawn
between those four corners is above sea level. The guarantee was never
wrong about sorted samples; it was measuring the wrong thing. The samples
were 1:3 and the surface between them 3:1.

**What replaced it, and why this guarantee is exact.** An area median is a
majority vote over the same terrain, weighted by how much of it each height
occupies rather than by how many baked samples happen to sit on it. Its
property needs no `n`: a band that less than half the covered surface
occupies cannot contain the level that halves that surface. So it holds at
n = 4 and at 441 alike, in BOTH directions — which is what
`mesh.seaLevelBand.test.ts` now asserts, against a brute-force 32x32
reference lattice it does not share with the implementation. Under the
sample median that clause fails on **94 quads** of the vendored fixtures
alone, including a quad only 2.2% of whose surface is above sea level
painted as land.

**It reads the bilinear patch, not the two triangles glyphcss fills.** The
renderer fan-triangulates a quad from its first vertex, so the surface it
literally rasterizes is two triangles sharing the nw-se diagonal — and that
diagonal is an artefact of the fill order, not of the data. Reading it would
make the statistic depend on it: the same Buenos Aires corners are **42.6%**
above sea level split nw-se and **85.2%** split sw-ne, bracketing the
bilinear's 72.6%. The bilinear patch is the diagonal-independent interpolant
between those two and is what a gridded height field means, so it is what
the statistic reads. (Nothing per-cell is claimed either way: a quad's
colour is flat across it, which is why the boundary is a quad edge and not a
shoreline.)

**Exact along a row, discretized across rows.** For a fixed `v` the bilinear
surface is LINEAR in `u`, so that row's heights are distributed uniformly
between its two edge heights — a closed form, not a sample. Each source cell
of the block therefore contributes one uniform interval per strip, the
block's value distribution is a mixture of uniforms whose CDF is piecewise
linear in the elevation with a breakpoint at every interval end, and the
median is SOLVED (sort the ends, binary-search the segment where the CDF
reaches one half, invert the single linear piece it crosses) rather than
searched for. Only the `v` direction is approximated, by a midpoint rule
that converges as `1/k^2`, which is why this beats spending the same work on
a `k x k` lattice of point samples: against a 64-strip reference over the
real z4 tile under Buenos Aires (16,200 quads), a 16-point lattice
disagrees on the BAND of 27 quads and 8 strips on 5, of which 1 crosses sea
level. `SURFACE_MEDIAN_STRIPS` is 8 because 4 leaves one quad of the
fixtures misclassified against the reference lattice (49.85% of its surface
above sea level) and 8 leaves none, at every rung of the ladder. A FLAT
strip is an atom in that mixture and has to be counted the moment the level
reaches it — the first implementation treated `h <= lo` as "not yet
counted", which loses half the mass of a block whose cells are flat at
exactly -1 m (the common shape at a coast) and lands the median up on the
one sloping corner; the fixture clause caught it.

**The cost was measured and accepted, not discovered.** The area rule paints
MORE water overall, because the surface between a lone high sample and its
low neighbours really is mostly low. On the real z4 tiles, against the
sample median: Buenos Aires' own tile `4/5_11` changes 191 of 16,200 quads —
14 water->land (the reported quad among them) and **56 land->water** —
and Amsterdam's `4/8_3` changes 722, with 39 water->land and **96
land->water**. On the fixtures at full resolution: Bogota 13 land->water,
Quito 9, the Altiplano 5, Amsterdam 6 water->land plus 4 land->water, Buenos
Aires 3 water->land. Four Bogota quads whose CORNERS are majority land now
come out water (e.g. `212, 426, -3046, 81` — a coastal cliff into the
Peru-Chile trench sampled at 0.5 degrees): the terrain there steps and the
interpolant ramps, so the surface really is mostly below zero and the
statistic is reporting its own premise faithfully. That is the trade the
rule makes, and it is the one a reader can see the right side of, because
the quads it gets wrong are cliffs at a half-degree sample spacing while the
quad it fixes was a whole city.

**Build cost.** Real z4 tile, same process, medians of ten runs: the target
tier goes **4.2 -> 6.2 ms/tile** (the mesh with no colour at all is 2.9 ms,
so the statistic itself roughly triples). The work is proportional to the
tile's own CELLS rather than to the quad count, so a coarsened tier would
pay as much as the tier under the reader's eye — 8.2 ms for a 32-quad floor
tier. The strip count is therefore divided among a coarse block's cell rows
(a block spanning 3 cell rows takes 3 strips per cell, not 8), keeping at
least `SURFACE_MEDIAN_STRIPS` rows of surface read per block however it is
shaped: floor tier **3.3 ms**, fallback tier at 90x45 **3.5 ms**, and the
area invariant holds identically either way at every rung.

**Below-zero DRY LAND is left alone, and that is a decision, not an
omission.** The same report covered Amsterdam, where the terrain layer
paints the polders, Waterland, Flevoland and the IJsselmeer bed as sea. It
is the DEM's honest answer: 138 of the 187 z4 samples around that view are
genuinely below 0 m at -1..-6 m, 30 of the 40 quads in frame have at least 3
corners below zero, and mean, median and area all agree there (the sample
median was even the best of the three, by a hair, on what are +/-3 m coin
flips). No per-quad statistic separates a polder from a lake bed at ~13 km
per sample, so nothing here is a sampling defect. Band 0 means "below the
datum" and `/maps`' terrain ramp presents that as water; the OSM `water`
layer, mounted on the same view, is the only real water mask. The two
alternatives were priced and rejected: reading OSM water to recolour terrain
is a cross-layer coupling this package does not do (and works only while the
OSM card is on), and a shallow below-datum land band fixes the polders by
breaking every shallow sea and estuary at -1..-20 m the other way — the Rio
de la Plata's own -1 m estuary included, which is the case that sits
directly beside the defect that WAS fixed.

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
Andes/Bogotá defect the colour statistic exists to prevent; (c) a tuning — 20,000 m
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
default/`--tiles` mode for the full z0-z4 GLOBAL pyramid — 341 tiles plus a
16-tile curated overlay, 11.8 MB on disk — at `website/public/data/geo-tiles/`,
COMMITTED like every other pyramid under that directory: the website deploy
(`.github/workflows/deploy-website.yml`) checks out, builds and publishes
`website/dist` with no bake step, so a gitignored pyramid is a 404 on the
deployed page — and because the terrain provider is what `MapsWorkbench`
awaits before it constructs the widget at all, that 404 leaves `/maps`
completely blank, not merely without terrain. The ~800 MB ETOPO1 SOURCE stays
out; only the baked pyramid is vendored, and the parity fixture stays separate
so package tests need neither.) Pyramid tiles are baked
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

**The Dock's own per-axis resets are INLINE, in each slider's name cell.** The
compass is the DISCOVERABLE reset and resets both angles together; the reader
also asked for the per-axis pair in the place the two sliders live. The first
attempt shipped them as lil-gui BUTTON ROWS — the Dock's existing reset idiom
(`Dock/folders/useCameraFolder.ts`'s `Reset camera`) — and was rejected on
sight: "NO, THE RESET BUTTONS HAVE TO BE NEXT TO THE TILT ° AND BEARING °
LABELS WE CANNOT ADD THOSE HUGE BUTTONS ... tiny reset button ... [reset]". Two
full-width rows for two angles is a third of the folder spent on undo.

So each row now carries a `[reset]` of its own — literally that word in
brackets, 9px monospace, borderless — INSIDE its own `.name` cell, and the View
folder has exactly the rows it had before the feature existed (`Center lon`,
`Center lat`, `Span °`, `Tilt °`, `Bearing °`, `LOD`). The bracket is the
rail's own language, not a new one: the Dock's slider already draws its track
as `[ ─█──── ]`, and 9px inline is the scale `/synth` drops `.gx-toggle-btn` to
when a control shares a line rather than owning one.

The geometric objection that killed inline the first time was real but aimed at
the wrong cell. A number row is `.name` at 45% plus a widget that ends in a
45..70px value box (`maps-workbench.rowWidths.test.ts` pins exactly that), so an
affordance in the WIDGET does come out of the slider TRACK — the part of the row
a reader drags. The NAME cell is where the room is. Measured in a real browser
on the running page at the Dock's 360px: the cell is 152.09px (148px of
content), the longer label (`Bearing °`) is 61.6px and the button 43.2px, so the
worse of the two rows uses 110.8 of 148 with the label untruncated
(`scrollWidth == clientWidth`), while `Tilt °`, `Bearing °` and the untouched
`Span °` all still report a 120.05px slider track at the same x — identical to
the third decimal to the measurement taken before the control existed. The
guarantee is then made structural rather than left to how long a label happens
to be: lil-gui gives `.controller > .name` a `min-width: var(--name-width)` and
NO max, so `.maps-view-name` pins `max-width` to that same 45% and the cell can
never grow into the widget. Gated three ways in `mapsKit.viewReset.test.tsx` —
the button's cell, the widget subtree left identical to `Span °`'s, and the
stylesheet clause itself.

Behaviour is unchanged from the rejected shape. Both write through the folder's
own `onTilt`/`onBearing` — the callbacks the sliders drive, which
`MapsWorkbench` wires to `map.setTilt`/`map.setBearing` — so the tilt ceiling,
the `[0, 360)` bearing normalization, the single motion loop and the URL write
all still happen; nothing here touches page state directly. Home is
`mapTiltResetValue`/`MAP_BEARING_HOME`, the same pair the compass uses, so the
tilt reset is 0 on an ORBIT projection and `MAP_TILT_SHEET_HOME` (40) on a
SHEET — a control that wrote 0 to both would flatten a sheet into a plan view
and call it a reset. Each is DISABLED at its own home
(`mapTiltIsLevel`/`mapBearingIsNorth`, the compass's epsilons) as a real
`disabled` attribute on a real `<button>`, so the pair doubles as the indicator
that a pitch or a heading is in force. What could NOT carry over is the dim:
the row now belongs to the SLIDER, and lil-gui's `.controller.disabled` sets
`pointer-events: none` on every descendant, so disabling the row would take the
live slider down with the reset — the button dims itself instead (`:disabled`,
the same 0.38 the Dock dims a disabled row's name to). One asymmetry worth
stating rather than hiding: a bearing reset leaves the LINK untouched (`b`'s
default is 0, so the codec omits it) and so does a SHEET tilt reset (`t`'s
default is 40), but an ORBIT tilt reset ADDS `t` to the link —
`MAPS_URL_DEFAULTS.tilt` is one number, 40, while home is projection-dependent.
That is correct, not a defect: a head-on globe is not the map the default
describes, so the link has to say so.

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

#### The drape is PER CELL, and the field's own relief is the third term

**The sixth report, and the one the two terms above could not answer.**
`/maps?m=p3x5fvsday5f5t8js34cst10E1` — globe, centre 26.677E 25.465N, span
16.81 degrees, `exaggeration: 24`, **`tilt: 0`**, terrain and borders and
nothing else — "if you only have border + terrain the borders are not being
shown cutting the terrain anymore". Two thirds of every border over the Sahara
was gone; the crenellated Aegean ones a few rows above were untouched.

It bisects to **`6d88df2`**, the stroke drape itself, and not to `781486f`.
Measured on that link with the real ETOPO1 pyramid and the real Natural Earth
borders at 140x63, counting the BORDER's own cells (the frame with the layer
diffed against the frame without it) against the 498 the same stroke inks with
the depth test removed entirely:

| | border cells | rows of 63 |
|---|---|---|
| `226aa0c` (the flat 0.03 bias) | 498 | 63 |
| `9191e4b` (`GLYPH_MAP_STROKE_GROUND_MARGIN`) | 445 | — |
| **`6d88df2`** (the drape; both allowances gone) | **294** | — |
| **`781486f`** (curvature, not slope) | **267** | 44 |
| `34bc007` | 267 | 44 |

`781486f` is real but small here (-27); the drape cost 151. Both are the same
mechanism seen twice, and it is not faceting.

**The mechanism: a one-sided test against symmetric noise.** A draped stroke
and the terrain under it are the SAME surface reached two ways — the drape
reads the elevation FIELD at a vertex, `CellGrid.depth` holds the terrain MESH
rasterized at cell resolution. At a world view one output cell is 0.12 degrees,
i.e. ~13 km of real relief, and the two disagree accordingly. Instrumented over
every stamped sample at the reported view, `atStroke - depth` is centred on
**+3 m** of ground with quartiles at **-157 m and +172 m**: symmetric NOISE, not
a bias, against a median allowance of **21 m**. A test that occludes on one
side of symmetric noise deletes about half of every stroke crossing rough
ground — and all of one that crosses a lot of it. Over the sea and over flat
desert the noise is zero and the stroke survives, which is exactly the reported
picture. At `tilt: 0` EVERY one of those kills is a false positive, because an
orthographic camera looking straight down at a heightfield has no self-occlusion
at all.

**Raising `GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE` was measured and rejected.**
It works numerically — `0.25 -> 1.0` restores 478 of the 498 cells — and no
existing gate would catch it, because `stroke.test.ts`'s bound clause runs on a
PLANE, whose second difference is zero at every scale. That is precisely why it
is the wrong instrument: it is a tuning with no bound behind it, scaled on the
RENDERED surface's roughness rather than on the disagreement it is paying for,
and `781486f`'s own derivation (an eighth of the second difference, doubled)
would become a number chosen to make one link look right.

**Two fixes, each derived, each with its own failing mutation.**

1. **The drape is PER CELL** (`drapedRunPerCell`, `widget.ts`). A CORRECTION,
   not an allowance: `stampGlyphMapPolyline` walks a segment one sample per
   cell but interpolates both position and DEPTH linearly between the vertices
   it is handed, and a border simplified by Visvalingam-Whyatt has none to
   spare — Natural Earth bakes Egypt's 22 N parallel with Sudan as a single
   straight run, so 7.6 degrees of ground under it was never sampled. Measured
   at the reported view the median stamped segment was **2 cells** and the
   longest **49**; the median failing sample read **195 m** of ground behind
   the surface, and draping per cell drops that to **52 m** and lifts the count
   267 -> 333. It costs one projection and one ground read per sample the
   stamper was already walking, and is FREE in the frame: 18.64 -> 18.32 ms per
   render at 140x63 on that view, inside the noise of three runs. Only the part
   of a segment that can reach the grid is densified (`onScreenSegmentSpan`, a
   Liang-Barsky clip against the grid box grown by one cell), because a border
   feature's own segment spans a whole 22.5 degree tile and at a street-level
   span that is hundreds of thousands of cells of work outside the viewport;
   clipping changes no ink, since an out-of-bounds sample draws nothing anyway.
   With no ground to read (`groundElevationSampler()` null) nothing is
   densified at all and the expression stays the pre-drape one, vertex for
   vertex.
2. **`GlyphMapStrokeVertex.slack`**, the ground's own rise across the span the
   comparison reads from (`GLYPH_MAP_STROKE_GROUND_SUPPORT_CELLS = 2`). DERIVED,
   not sized: `grid.depth` is the surface at the cell CENTRE, reconstructed
   through a +/-1 cell central difference and evaluated up to half a cell from
   that centre, so the evidence reaches 1.5 cells from the stroke — and the
   depth at each of those cells was itself rasterized from a quad about a cell
   across, which is the next half. Within that span the terrain drawn in a cell
   and the ground the stroke stands on are the same surface reached two ways
   and their disagreement is evidence of nothing. It is read off the drape's
   OWN per-cell samples rather than probed for — after the densification
   consecutive samples are at most one cell apart on screen, so the neighbours
   within the support ARE the ground over that span, already projected and
   already in depth units — which makes it FREE (18.74 ms) and, better,
   correctly anisotropic: the samples are one output CELL apart by
   construction, where a lon/lat star of the same nominal radius is only under
   a locally isometric projection. Distance is tested rather than assumed, so
   the samples either side of a long un-densified off-screen stretch contribute
   nothing instead of a whole tile's relief. An isotropic 4-probe star of the
   ground field was built and measured as the alternative: 455 cells against
   434 for the support-2 neighbours, 61 rows against 63, and **+4 ms per
   frame** (18.6 -> 22.3) for the extra projections. Rejected on all three.

Together: **267 -> 474 of 498 cells and 44 -> 63 of 63 rows** on the reported
link, at 18.84 ms/frame against a 18.64 ms baseline. The 22 N parallel goes from
absent to a 69-column run.

Crucially the slack is ZERO on flat ground at every pitch and every zoom, which
is what keeps `781486f`'s whole family intact — a Zurich street's ground moves
by centimetres across two 4.8 m cells, so a 6 m building still occludes the road
beside it. All four of the gates that could have been weakened
(`widget.strokeOcclusion.test.ts`, `stroke.test.ts`,
`widget.strokeDensityOcclusion.test.ts`, `widget.walkDetailOcclusion.test.ts`)
pass unchanged.

**What DID have to change is three fixtures, and the reason is worth writing
down.** `widget.stroke.test.ts`'s gate 1, its density-3 sibling and
`widget.fractionalDensity.test.ts`'s occlusion clause each mount a raster tile
at 2,000,000 m as "a ridge in front of the line" and assert the line is occluded
under it. Post-drape that is unsatisfiable in principle: at `tilt: 0` a terrain
layer occupies exactly its own lon/lat box on screen, so the only stroke it can
occlude is one it is also the GROUND of — and a draped stroke stands on its
ground. Those gates read as green only because each feature's two vertices sit
OUTSIDE the ridge tile; the same fixture at `34bc007` with vertices at lon +/-4
inks straight through the ridge, so the verdict was a function of vertex spacing
and never a guarantee. Each now pins `groundElevation: () => 0` — which is what
their own comments already said ("uniformly raised well above the line's own
(zero) elevation") — and every assertion in them is unchanged.

Gate: `widget.strokeRelief.test.ts`, on the vendored real-ETOPO1 window
`fixtures/sahara-border.json` (8x8 degrees of the eastern Sahara at the same
0.125 degree vertex spacing the z4 pyramid level ships, baked by
`bake-geo-tiles.mjs --fixture`; the pyramid itself lives in the website tree and
is never a package-test dependency) plus the two ruler-straight borders that cross it. On that
fixture the stamp inks **92** cells over 33 rows with no depth test at all,
**3** over 2 rows at `34bc007`, and **79** over 33 after the fix; the busiest
row goes 2 -> 47 of 60 columns. Mutations, each printing its own failure:

- drop the per-cell drape, keep the slack: `expected 3 to be greater than 60`,
  `expected 2 to be greater than 35`.
- keep the per-cell drape, set the support to 0 cells: `expected 37 to be
  greater than 60`, `expected 9 to be greater than 35`.
- make `stampGlyphMapPolyline` ignore the vertex slack: the same two.

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

A `contour` was never exposed to this while it sampled per cell — its
`requireSurface` gate already skips a cell whose depth is non-finite, which is
exactly what a blanked cell reads as — and now that it stamps through
`stampGlyphMapPolyline` it gets the ownership skip itself, for free.

Gate: `widget.strokeDensityOcclusion.test.ts`.

**Walking, that fix was inert and the base grid was never blanked at all —
both halves in glyphcss, both invisible to an orthographic camera.** The next
report (`the roads are still on top of everything, the sky is also on top of
everything`) came from the same OSM stack in WALK mode, and neither symptom
had moved. Measured at the entry pose on a 60 m block 200 m ahead: the road
inked all 140 of its base cells with the building separated against 109 with
it in the base grid, and the dome painted all 4,480 of its cells against
3,767. `docs/design/detail-layers.md` ("Cross-layer occlusion") holds the
mechanisms — the id-map's sample point, its depth quantity, its missing
near-plane clip, and the retained-effect compositor dropping `occluded` on the
grid handed to the legacy hook, which is what made `a3b7c56` do nothing here
(walk mode always mounts an effect, because the sky is a mesh-targeted
appearance program). Nothing in this package changed. With all four closed,
separating the building into its own `<pre>` leaves the base grid's sky and
road cells EXACTLY as they are with the building in the base grid — 3,040 sky
cells and 95 road cells either way, cell for cell.

Gate: `widget.walkDetailOcclusion.test.ts`.

**And the FIFTH report was the road again, because that gate read the wrong
`<pre>`.** "The sky is now rightly culled behind the buildings, but I still see
lines from the roads on top of the buildings", same link. The ink the reader
was seeing had never been in the BASE grid at all — the gate above measured
that grid cell for cell and was right about it. The stroke was landing in the
BUILDINGS' own detail `<pre>`, which sits above the base one, at `1/density`
of its real height: `createGlyphScene`'s retained-effect compositor called the
legacy `transformCells` hook with the grid alone, dropping the
`GlyphTransformCellsLayer` second argument, so `composedTransformCells` could
not tell a detail grid from the base one and stamped every vertex through
`GLYPH_MAP_IDENTITY_CELL_AFFINE` into a grid `1.7` times finer (and, for the
same reason, never restored `cachedBaseCamera` for the duration of the detail
call, so the depth it tested against was the detail fit's framing too). Walk
mode always mounts an effect layer, so this was every street-level frame.
Measured on the real page at the reported link: 551 base cells of road in the
base `<pre>` at rows 37-44, and 86 more in the buildings' detail `<pre>` at
rows the unseparated render paints solid building — 48 base cells' worth, ten
to twenty rows above the road itself. Nothing in this package changed;
`docs/design/detail-layers.md` holds the fix.

Gate: `widget.walkStrokePlacement.test.ts` — the reported pairing (`omt-roads`
at `1`, `omt-buildings` at `1.7`) on the vendored OpenFreeMap Zürich tile,
composited across EVERY `<pre>` by each one's own declared geometry rather
than off the base grid alone, against the road's own screen path measured with
nothing in front of it. 265 misplaced base cells before, none after.

### Contours are geometry at their own elevation

**The defect.** A `contour` layer used to project no vertex at all: it sampled
per CELL (`unproject(cell centre) → lon/lat → elevationAtLonLat`) and inked a
level crossing between neighbouring cells, gated only on surface COVERAGE.
That carries the MIRROR IMAGE of the parallax the stroke drape closed above —
`unproject` inverts at elevation ZERO (`GlyphMapProjection.unproject`'s own
contract: a projection's `z` axis is one-way relief, never re-derived from
world space), so a cell showing raised terrain is attributed the lon/lat of
the SEA-LEVEL point under the view ray rather than of the terrain point
actually drawn there. Reported as "the lines are not actually set at the
height they should be set", and asked as "could we do it in height? so when I
tilt the camera I also see them from the side". This record used to say the
fix needed a terrain ray-march. It did not.

**What replaced it removes the question instead of answering it.**
`contourGeometry.ts` cuts each level's isoline with MARCHING SQUARES over the
mosaic's own vertex grids, in the field's own (lon, lat) domain. Every vertex
it produces is therefore at a KNOWN height — the level's own — and is
projected through `projection.project(lon, lat, level)`, the same call the
terrain vertex beside it goes through. There is no datum left to be wrong
about at any tilt, and the lines wrap the relief in three dimensions.

**No flat/elevated toggle.** At zero pitch the two are the same picture (the
elevation offset is along the view axis at the view centre, so it moves depth
and not the row — pinned), and everywhere else the flat one is simply wrong. A
toggle would preserve the defect as an option.

**Sampled at the grid's own vertices, and canonically ordered.** The input is
the same VERTEX-centered grid `glyphMapPolygons` builds the relief from, so
adjacent tiles — which SHARE their edge vertex row/column — cut identical
crossings on both sides of a boundary and the mosaic is seamless by
construction, exactly as the sampler was (see the tile-boundary octagon
below). Output is a segment LIST, not a chained polyline: a marching segment's
own two endpoints already give the exact local tangent, which is all
`stampGlyphMapPolyline` needs. The list is sorted by `(level, lon, lat)`, and
that sort is load-bearing rather than tidiness — the same terrain served as
one tile and as sixty-four yields the same segment SET in a different order,
and a contested output cell is won by whoever stamps last, so the sort is what
lets `widget.contourTileBoundary.test.ts` demand cell-for-cell identity.

**One stamping path.** Every cell is inked by `stampGlyphMapPolyline`, so an
elevated contour inherits the `line` layer's depth test (the sub-cell surface
reconstruction plus the curvature-scaled faceting allowance), its
cross-`<pre>` ownership skip, and its no-endpoint-special-case tangent — all
three of which a contour now needs and the per-cell scan could not have, since
a contour with a height is an object in the scene a ridge in front of it must
be able to hide. Two options were added to that shared path: `requireSurface`
(skip an empty cell instead of drawing through it — the contour ANNOTATION
rule, `false` for a `line`) and an `onInk` hook, which is how the LABEL plan is
accumulated: only the stamp knows which cells survived the depth test.
`restore` keeps the FIRST writer's glyph (the terrain) while `levelAt` keeps
the LAST (the level actually visible), which is what lets a label break its own
line without punching a hole in the relief.

**The elevation window's per-cell ink gate is SUBSUMED, not dropped.** It
existed because the crossing scan read a cell's right/down neighbours, so on a
sea cliff — one cell at -5,000 m, the next at +2,000 m — a 1,000 m level
crossed BETWEEN them and inked the ocean cell 5 km below a `minElevation: 0`
floor. A marching vertex stands AT its own level, so the ink now lands where
that level actually is. `minElevation`/`maxElevation` still clip the LEVEL
list, with the same two rules (a count DISTRIBUTED across the window, an array
and an `{ interval }` CLIPPED and never renumbered).

**The horizon gate for LABELS is the one thing geometry cannot read off the
grid.** With a surface mounted it is exact and free — after the pass a cell's
depth is finite exactly where terrain drew or this contour inked, and past the
limb it is neither. With no raster layer mounted anywhere, every cell reads
non-finite uniformly and the grid has nothing to say, so the widget passes a
`covered` predicate that asks `unproject` (memoized per cell, built only when
labels are on). Without it a label was born straddling the limb —
`widget.contourLabels.test.ts`'s near-side clause goes red.

**Caching, and what invalidates it.** The marched geometry is cached on the
contour runtime and re-cut only when the mounted MOSAIC changes (a tile sweep
resolved a different set, or a finer tier landed) or the resolved LEVEL LIST
changes (the mosaic's range moved under a count or an `{ interval }`, or the
window clipped it). The camera is deliberately not among them: geometry is in
lon/lat, so a pan, zoom, orbit or tilt re-PROJECTS it and never re-cuts it.

**The screen cull, and why it is a bound.** A mounted mosaic covers the swept
TILES, not the viewport, and the marching grid is finer than the output grid —
measured on the real ETOPO1 pyramid at an alpine view (0.6 degrees, 140x63,
Switzerland's curated z7), 22 levels cut 86,234 segments of which about 4% are
on screen. Projecting all of them, and letting `visibleStrokeRuns` project them
a second time, cost +57.6 ms per render. So the FIRST endpoint is projected and
tested, and the rest of the work skipped when it lands outside the grid by more
than `2 x quadDeg / degPerCell`: a marching segment lies inside ONE quad of its
own grid, and the camera's cells-per-degree is greatest at the view centre
along longitude (a sphere foreshortens everything else; a tilt only compresses
rows), so that covers a quad's diagonal anywhere in the frame. The cull runs in
SCENE coordinates, before the per-grid affine, so one bound serves the base grid
and every detail grid. Near/far side is then asked of the ELEVATED world point
the projection already produced, and only a limb-straddling segment is handed
to the shared `visibleStrokeRuns` for bisection.

**Measured**, real ETOPO1 pyramid, alpine view above, min of 40 renders:

| levels | per-render stamp, geometry | per-render stamp, per-cell scan | re-cut (mosaic/level change) |
|---|---|---|---|
| `{ interval: 1000 }` (4, `/maps`' default) | 1.2 ms | ~11 ms | 4.8 ms |
| `{ interval: 500 }` (8) | 2.7-3.0 ms | ~13 ms | 19.1 ms |
| `{ interval: 200 }` (22) | 8.7-10.3 ms | ~12 ms | 31-41 ms |

The per-cell path's cost was a function of the OUTPUT grid (8,820 per-cell
`unproject` Newton solves) and so flat in the level count; the geometry path
scales with the level count and is 1.4x to 10x cheaper across the range. The
re-cut is the one new cost and is paid only when the mosaic or the level list
changes. The whole-FRAME figure moved the other way at fine intervals, and for
a reason worth recording: at a 200 m interval on this terrain the per-cell scan
inked 6,484 of 8,820 cells — 73% of the frame, a wash rather than a contour map
— which COALESCED into 2,713 colour spans, while the geometry draws 1,479 cells
of thin precise line that break the terrain into 5,160 spans. The encoder then
costs more for a render that contains more distinct lines. (Whole-frame numbers
from the happy-dom harness are otherwise unreliable — the per-cell path's
allocation drags its own baseline from 28 to 46 ms across one run — so only the
stamp and re-cut times above are quoted; `bench/maps-render` is the browser
harness for frame-level work.)

**Gates.** `widget.contourElevation.test.ts` pins the elevation forward (the
terrain is exactly linear in latitude, so a level's isoline sits at a latitude
stated in closed form; the expected screen row comes from the same
radial/affine identity `widget.strokeDrape.test.ts` uses, out of public API
alone), the exaggeration tracking, the tilt-0 equivalence, survival of the
terrain's own depth test with a raster layer mounted, the screen-cull bound at
a coarse grid, the marching order's tiling invariance, and — on the VENDORED
real-ETOPO1 tile — that every marching vertex reads back at its own level
through the tile's own bilinear field. (The full z0-z4 pyramid under
`website/public/data/geo-tiles/` belongs to the website tree, so a package
test never reaches for it.) Mutation checks: projecting at the datum reddens three clauses
(280 of 280 cells at the datum position); a zero cull margin blanks the coarse
case; dropping the sort breaks tiling invariance; forcing `requireSurface`
reddens 16 tests; last-writer `restore` breaks the label gap.

**What is NOT reproduced.** Nothing from the per-cell path was dropped
silently. The two behaviours that changed rather than transferred are recorded
above: the window's per-cell ink gate (subsumed by the geometry standing at its
level) and the LABEL horizon gate with no raster layer mounted (moved from the
per-cell elevation array to a widget-supplied `unproject` predicate). The
per-cell `stampGlyphMapContour` stays exported for a caller holding a genuine
SCREEN-SPACE scalar field, which is a different input shape and not a second
way of doing the same thing.

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
click-to-lonlat, and (while a contour still sampled per cell) that layer's own
elevation lookup, so it painted nothing at all. The start point (like every step the loop makes)
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
byte-identical. A `contour` used to need none of this — it reached its field
through `unproject()` -> `unprojectSphere`, whose Newton solve is seeded from
`centerForCamera(...)` (the near-side sub-observer point) and additionally
gated on `projection.visible`, so it never resolved a far-side `(lon, lat)` in
the first place. Now that a contour is geometry it needs exactly the same clip
as a `line`, and gets it more cheaply: `nearSideVisible` is asked of the
ELEVATED world vector the stamp has already projected, and only a segment whose
two endpoints disagree is handed to `visibleStrokeRuns` to bisect.

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

### The three flags that said we were drawing things that are not there

The OpenMapTiles table read six properties and ignored the rest. Three of the
ignored ones are not enrichment — they are the schema stating that a feature
is **not on the surface**, and ignoring them made the render wrong rather than
plain. Each is now a default exclusion on the row it belongs to
(`GLYPH_MAP_OPENMAPTILES_LAYERS`), and all three are table edits: no new
widget capability, no new machinery, `GlyphMapFeatureFilter` was already on
every vector-source layer.

| flag | rows | measured on the vendored tiles |
|---|---|---|
| `brunnel: "tunnel"` | `omt-roads`, `omt-waterways` | roads 605 → 558 (z14 Zürich Hardbrücke) and 1,911 → 1,857 (z12); waterways **27 → 14** and 11 → 9 |
| `maritime` / `disputed` | `omt-boundaries` | the z0 world tile's two `admin_level: 2` lines → **1**; `z4-1-6-maritime.mvt`'s one line → **0** |
| `hide_3d` | `omt-buildings` | Houston `14/3851/6772`: 153 → **150**; the Zürich tile carries none, so the axis is a no-op there |

**Tunnels are hidden, not dimmed, and bridges stay drawn.** A tunnel is not
visible from the street, and this renderer has limited colour to spend on
subtlety — a dimmed tunnel would need a per-feature line colour, which is a
widget capability rather than a table edit. The scale is the argument: 14.8%
of z14 road features across ten live city tiles carry `brunnel`, and **29.5%
of the drawn road LENGTH in a Manhattan tile is underground**. On a waterway
it is worse per tile than on a road — 13 of the vendored z14 tile's 27
watercourses are culverts, i.e. a stream drawn running through a building.
Bridges are the other half of the same field and are the case a reader most
wants to see, so `excludeBrunnel` is a value list rather than a boolean.

**Maritime and disputed boundaries are off by default, and that IS a visible
change to the world view.** Of the boundary lines a world view actually drew
(`admin_level ≤ 2`, geometry `line`, sampled over z0/z2/z4×7/z5/z6), 46.3%
were `maritime: 1` and 44.4% `disputed: 1` — roughly half the world's border
ink was an EEZ line across open ocean in the same weight as the
France–Germany land border. An EEZ line is not a border a reader expects
drawn, and a disputed line is a claim rather than a border. The two axes are
separately gated by the two fixtures precisely because they could otherwise
pass on the same feature: `z4-1-6-maritime.mvt` is `maritime: 1` and
`disputed: 0`, `z0-0-0.mvt` is `maritime: 0` on both its lines and
`disputed: 1` on exactly one.

**`hide_3d` is the schema saying "its parts are mapped separately".** It is
small — 1.46% of features over eight city tiles — but where it fires it is a
block outline extruded over the individually-mapped buildings inside it: 15
such outlines swallowed 71 shorter buildings, and a live Munich case is a
22 m outline containing buildings at 4 m and 11 m. None of the three vendored
tiles carried the flag at all, which is why Houston is now vendored. The
broader building-overlap picture (60–78% of footprints have another
footprint's centroid inside them) is genuine OSM overlap and a depth-test
outcome, not a data bug — `hide_3d` fixes only the 1.5% the data itself flags.

**One reader for two writings.** `boundary.maritime` and `boundary.disputed`
arrive as `0`/`1` NUMBERS present on every feature; `building.hide_3d` and
`transportation.indoor` arrive as a real `true`/`1` and are ABSENT otherwise.
So neither "the property exists" nor "the property is `true`" is the test —
`glyphMapOpenMapTilesFlag` is falsiness, and it covers both writings exactly.
Both mutations go red: pinning it to `=== true` breaks six tests, pinning it
to `=== 1` breaks three.

**The one declutter judgement, stated as one.** The roads row also drops
`service: driveway`/`parking_aisle` (72 of the vendored z14 tile's 605 lines)
and `indoor` ways (4). These are correct ways that exist; a car-park aisle is
hatching and an indoor corridor is not a street, but unlike the three flags
above this is cartography rather than a correctness fix, and it is labelled
that way in the table's own comment. It is one array to revert.

**What it costs the reader, measured through the real rasterizer**
(`widget.osmFilters.test.ts`, the vendored z14 tile mounted as a static
collection at 140×63): the roads row inks **3,351 → 3,160 cells, −191, −5.7%**.
The ink falls by much less than the 605 → 497 feature count (−17.9%) because a
tunnel is a long feature drawn mostly under other geometry; the tunnel
features alone ink 155 cells and the bridges 377. Fewer cells is strictly
cheaper, so nothing here needs a bench.

**What is NOT in this slice.** `transportation.layer` (14.2% of z14 features,
−5…+4) makes the visible road at a grade separation arbitrary and able to flip
between frames as tiles land in a different order — that needs a per-layer
feature ORDER, which is a widget capability, not a table edit. Road hierarchy
by `class` (path 22.6% / minor 22.3% / motorway 2.6%, all in one colour) and
taking `rail`/`transit`/`ferry` out of the roads row both need a per-feature
line colour for the same reason: the table alone can only DELETE those classes,
which trades one wrong picture for a missing one, or add an eleventh row, which
would move the `/maps` URL codec's append-only sublayer bitfield and its
fixed-length density tuple. Both are deliberately left to the row-colour work.

### The additive half: three source layers, three colour tables, two throttles

The flags above were subtractive — they stopped the mapping drawing things
the data says are not there. This slice is the opposite: four kinds of data
the service ships on every tile that reached no row at all. Ranked by what
each is worth per line changed.

**1. `class` on the three ground/water FILL rows.** `GlyphMapFillLayer`
already carried `colorProperty` + `colors`, so this is a pure table edit with
zero new machinery, and it is the largest visual gain in the slice. Before
it, `landcover` painted glacier ice, desert sand, bare rock, wetland,
farmland, grass and wood in ONE green, and `water` painted a hotel swimming
pool in the blue of the Pacific. Measured on the vendored tiles:

| row | tile | classes present | distinct colours before → after |
|---|---|---|---|
| `omt-landcover` | `z0-0-0` | `ice` ×11 (Antarctica, Greenland) | 1 → 1, but it is no longer forest green |
| `omt-landcover` | Houston z14 | `grass` 116, `wood` 8, `sand` 2 | 1 → **3** |
| `omt-landcover` | Zürich z12 | `grass` 20, `farmland` 11, `wood` 4 | 1 → **3** |
| `omt-water` | Houston z14 | `swimming_pool` **26**, `lake` 5, `river` 2 | 1 → **3** |
| `omt-landuse` | Zürich z12 | 14 classes | 1 → **5** (bucketed) |

`landcover` keys on `class` (7 values), not `subclass` (21+, no natural
colour ordering — `flowerbed` beside `village_green` beside `scree`).
`landuse`'s ~20 classes collapse to five buckets, because a character grid
cannot carry twenty tints and `library` and `kindergarten` are the same thing
to a reader looking at a block. An unnamed class falls back to the row's own
colour, so a schema addition is never a hole.

An explicit `colors` OVERRIDE on one of these three rows now REPLACES its
class palette rather than sitting behind it. The widget's fill runtime prefers
`layer.colors[feature[colorProperty]]` over `layer.color`, so a caller asking
`glyphMapOpenMapTilesLayers` for `#123456` water got a `lake` painted
`#2c5c8f` — the override was present on the built layer, correct, and never
read. `openmaptiles.test.ts`'s own override clause asserts `built[1].color`,
i.e. exactly the property that stayed right, which is why it could not see
this; the new gate (`openmaptiles.colorOverride.test.ts`) asserts the rendered
`<pre>` cells instead. Naming one colour for a row is naming that row's
colour — the classification is what the request replaced, not what it applies
on top of. Rows nobody overrode keep their palettes, and a caller passing no
`colors` at all builds identical layer objects.

The standing "read the live data, never the docs" rule applies to the table's
VALUES too, and has a test: every key in the three tables must appear as a
`class` on a real decoded feature in the vendored set, and `landcover`'s
table must additionally be COMPLETE over what those tiles hold. `water.dock`
and `landuse.quarter` were both written from the schema vocabulary, both went
red on it, and both were removed rather than gated by a new fixture — an
unwitnessed key is a key with no test, and the fallback already covers it.

**2. `poi.rank`, the throttle the layer always had.** 3,944 POIs in the
vendored Zürich z14 tile, **every one of them a positioned DOM hotspot
`<div>`**, 27.0% of them street furniture (waste baskets, bollards, gates,
bicycle stands — see `GLYPH_MAP_OPENMAPTILES_POI_FURNITURE`). `rank` is on
100% of the POIs in both real z14 tiles and counts 1 = most important, so
`rank <= 20` plus the furniture exclusion is an ORDERING, not a quota: Zürich
3,944 → **686**, Houston 2,001 → **684**, and the z12 tile whose 51 POIs are
all stations ranked 1–7 keeps all 51. This is the only change in the slice
that makes a frame strictly cheaper.

**3. `mountain_peak` → a labelled `symbol`.** The layer is 100% named and
98.9% elevation-carrying in an alpine tile (92 peaks in `10/536/361`, 8 in
the vendored Zürich z12), and the row drew a 1px amber dot and discarded
both. Two things fell out of it:

- `GlyphMapSymbolLayer.text` — a label built from the whole feature rather
  than from one property name, so `Matterhorn 4478` is one label. A callback
  and not a property list, for the reason `GlyphMapFeatureFilter` is one: the
  joining rule belongs to whoever owns the schema. It is the slice's only new
  widget capability, three lines, and every existing `textProperty` row is
  untouched (`widget.symbolText.test.ts` pins both directions).
- Priority is **`ele`, not `rank`**. `glyphMapDeclutterLabels` keeps the
  LARGER priority and this schema's `rank` counts 1 = most prominent, so
  feeding it `rank` keeps the LEAST prominent peak of any overlapping pair.
  `ele` is both the right ordering and a column the tile already carries.
  (`omt-places` has the same inversion and keeps it — that row is not in this
  slice.)

**4. Three source layers the mapping never decoded at all.** `park`,
`aeroway`, `water_name`. Two of the six unmapped layers stay unmapped, on the
data rather than on taste: `housenumber` is 635 features against 1,991
building footprints in one vendored tile, each of which would be a DOM
hotspot and none of which is legible at a span where they fit; and
`aerodrome_label` is **0 features in five of the six vendored tiles,
including the JFK tile — the one tile in the set that is an airport**.

| row | source layer | shape | measured |
|---|---|---|---|
| `omt-parks` | `park` (z4–14) | `symbol`, points, named only | JFK z14: 9 features → **5** named points (`Bayswater Point State Park`). Live z6 US-East: 299 features, **251 named points** — a continent's national parks the map had never shown |
| `omt-aeroways` | `aeroway` (z10–14) | `line` | JFK z14: 16 features → **13** (3 runways + 10 taxiways), all carrying `ref` (`13R/31L`, `K3`). The 3 polygons (apron, aerodrome, one polygonal runway) are what the geometry filter drops |
| `omt-water-labels` | `water_name` (z0–14) | `symbol`, points **and lines** | z0: the **four oceans** — the world view labelled no water at all. z14 Zürich: 13 lake names as points. The z12 tile's Zürichsee and Greifensee are LINES — see "A lake's name is a LINE" below |

`park.class` is confirmed FREE TEXT on the tiles themselves — `"State Park"`,
`"National Recreation Area"`, `"Biosphärenreservat"`, `"Réserve de la
biosphère, aire de coopération"` — so the row narrows on no class at all and
keeps only what it can print.

#### A lake's name is a LINE — reported: "I see it in the seas but not in the lakes"

The `omt-water-labels` row opened with `geometry: "point"`, on the reading
that `water_name` is a mixed layer and points are the half a hotspot can
place. Read against the live service instead of against that reading, the
split is the schema saying what SHAPE a name has: a compact body's label is a
POINT, an elongated one's is the PATH a curved-text renderer runs the name
along. Sampled down the pyramid over Bariloche, every lake is a line and only
the straits and the oceans are points —

| tile | `water_name` | points | lines |
|---|---|---|---|
| z0 world | 4 | 4 (the oceans) | 0 |
| z5 / z6 (Golfo San Matías) | 1 | 1 | 0 |
| z8 `77/160` | 9 | 3 (2 straits, 1 gulf) | 6 lakes |
| z9 `154/320` | 8 | 1 | 7 |
| **z10 `308/640`** | **9** | **1** (`Angostura`) | **8**, incl. `Lago Nahuel Huapi` (95 vertices) |
| z11 `617/1280` | 6 | 1 | 5 |
| z12 `1235/2560` | 2 | 0 | 2 |

— and the same holds in the tiles already vendored for other reasons: the
Zurich z12 tile's Zürichsee and Greifensee are lines, and `z8-60-96-peaks.mvt`
carries Lake Red Rock and Perry Lake as lines. So the filter was not narrowing
a mixed layer to the drawable half; it was **keeping the seas and dropping
every lake on Earth**, which is the report verbatim.

**Where the fix lives.** In the `symbol` layer, not in the table. Pre-reducing
a line to a point inside `openmaptiles.ts` would have hidden the shape of the
answer from every other consumer of the layer vocabulary — the Protomaps
table, a static collection, anyone's own source — and left the widget still
believing a symbol is a point. `GlyphMapSymbolLayer` now accepts LINE
geometry and derives one anchor; the table's only edit is
`geometry: ["point", "line"]`, i.e. it stops discarding. A POLYGON is still
refused: its anchor is a pole of inaccessibility, a different algorithm, and
a boundary midpoint would be a wrong answer rather than no answer.

**The anchor: `glyphMapLabelAnchorPoint`, the arc-length midpoint of the
feature's longest part.** Three properties, each a measured failure avoided:

- **On the polyline by construction**, so it is in the water — the schema drew
  that path down the middle of the body. The alternative considered, the
  vertex nearest the polyline's centroid, is not: a bent arm's centroid lies
  off the arm and the nearest vertex to it sits at the bend, which puts
  `Brazo Blest` **outside every water polygon in its own tile**
  (`-71.7258, -41.0236`), and drags `Lago Nahuel Huapi` 0.057° down the
  `Brazo Tristeza` arm at z11 — the "name in the wrong arm" failure exactly.
- **ARC LENGTH, not the middle vertex.** The pyramid re-simplifies one feature
  per level (Nahuel Huapi is 57/95/100 vertices at z9/z10/z11), so an index
  midpoint slides along the lake as the reader zooms. Longitude is weighted by
  `cos(lat)` so the length is a ground length; unweighted degrees put the
  midpoint of a bent line at 60N in the wrong arm.
- **The LONGEST part, one label per FEATURE.** `Brazo Huemul` arrives at z12 as
  two parts, 64 vertices and 4; one hotspot per ring prints the name twice,
  the second time on a 0.005° stub in a corner of the arm.

Not the FIRST vertex, which is the naive reduction: a label line is clipped at
the tile buffer, so its first vertex is wherever the cut fell. Nahuel Huapi's
is `-71.8238, -41.0196` — inside no water polygon in its own tile, 24 columns
outside the Bariloche frame, and a different place again in the neighbouring
tile.

**Budget.** Nine `water_name` features over Bariloche at 140x63; the map drew
**1** label (the `Angostura` strait, in the middle of a lake district) and now
draws **5** — the lake and three of its arms, plus the strait. The four that
do not draw are off the frame, not decluttered: nothing that was in view lost
its place. Ocean labels are byte-identical — the z0 world view's twelve
markers (four names, each a multipoint across the world wrap) compare equal as
whole `outerHTML` against a point-narrowed row.

Fixtures: `z10-308-640-lakeline.mvt` (the reported lake as a line, with the
water polygons under it and a `water_name` point in the same tile) and
`z12-1235-2560-multipart.mvt` (the only multi-part label line in the set).
Gate: `widget.lineLabelAnchor.test.ts`.

**Why all three are APPENDED rather than filed into the draw order.** The
table is ordered back-to-front (ground → water → lines → buildings →
labels), and `park` belongs with the ground. It cannot go there: `/maps`
packs the OSM row set as a positional bitfield over this exact list
(`MAPS_OSM_SUBLAYER_KEYS`), and an INSERTION silently reinterprets every link
ever shared. Appending is harmless for a label row (DOM hotspots, order
independent) and right for `aeroway` (a stroke stamped after the roads it
crosses). It would NOT have been harmless for a `fill`: fills sit coplanar on
the datum, so draw order resolves the tie, and a protected-area polygon
appended last would paint over the lake inside it. That constraint and the
free-text `class` point the same way, which is why `park` is a label row and
not a green wash.

**The URL codec, and why `M` did not grow.** Three appended rows took the
card past `MAPS_OSM_DENSITY_SLOTS = 10`. `M` is a `floatTuple`, and a
`floatTuple` reads its declared width and then hands the cursor to the next
token — so the width IS the wire format, and an eleven-slot `M` would make
every already-shared `M` link decode the FOLLOWING token as a density and
strand every field from there on. The extra slots ride in a new token `J`
(`MAPS_OSM_DENSITY_EXT_SLOTS = 3`), appended last in the field list for the
reason `M` and `w` were: `decodePacked` stops at the first token it does not
recognize, so a link written here and opened by an older build strands only
what is ordered after it, and there is nothing. `J` is frozen at three rather
than given headroom for the same reason `M` is frozen at ten — spare slots
only move the same breakage to a fourteenth row while charging every
`J`-carrying link for the empties — and
`mapsUrlState.osmDensity.test.ts` asserts the two widths sum to the row count
so a fourteenth row is loud. `J` and not `j` (`sunDay`); the token map is
case-sensitive, the clause `M`/`m` and `w`/`W` already carry.

**Which appended rows default on.** Only `omt-water-labels`, and the test is
what a row DRAWS at the scale the page opens at: `water_name` starts at z0,
so the opening globe gets the four ocean names. `park` starts at z4 and
`aeroway` at z10, so both draw nothing there and start off, beside
`landcover`/`landuse`, which are off for the same shape of reason. The
inherent consequence, accepted where the append-only rule is documented: a
link carrying an EXPLICIT `O` written before the row existed has that bit
clear and opens the card without it, while a link carrying no `O` at all
takes the new default. No link's RENDER changes either way — the OSM card
itself is off by default, so a legacy link mounts no OSM layer at all.
`mapsUrlState.legacyLayerLink.test.ts` pins both halves.

**Measured** (`bench/maps-render`, `drag`, 1440x900, 140x63, `--encoding
spans`, `--at 8.548,47.376,0.02` — a Zürich city view — every run on the same
built page, rows switched on through the harness's own `--osm`):

| card | fps | ms/render | OSM tile addresses |
|---|---|---|---|
| the four rows that were default-on | 60.3 | 12.85 | z0 1, z1 4, z3 9, z5 4, z7 4, **z14 6** |
| the shipped default (those + `omt-water-labels`) | **59.4** | **13.05** | identical |
| all ten pre-existing rows | 17.2 | 29.53 | identical |
| all thirteen rows | **17.3** | **29.37** | identical |

Two things fall out of it. The **tile count is invariant to the row count** —
every run walks the same 28 OSM addresses — because `createOsmSource` shares
in-flight requests by address, so N rows sweeping the same view is N decodes
and one fetch. And the three appended rows **cost nothing measurable** even
with all thirteen on (29.37 against 29.53 ms/render is inside the run-to-run
spread); the one that defaults on costs ~0.2 ms/render.

**The POI throttle could not be measured as a delta, because the unthrottled
row does not finish.** The identical `drag` run with `--osm omt-pois` alone
completes in ~90 s throttled (24.2 fps, 6.43 ms/render, 2.75 ms base-raster —
the rest is hotspot work). With `GLYPH_MAP_OPENMAPTILES_POI_MAX_RANK` and the
furniture list removed and the package rebuilt, the same run was killed at 20
minutes with the browser pinned at 100% CPU and no scenario output at all;
the ten-row pre-change build failed the same way twice, at 15 and 30 minutes.
That is 3,944 positioned hotspot `<div>`s per z14 tile across the 6 tiles this
view mounts — ~23,700 — against ~4,100 after. The feature counts are the
honest number here; the frame time is "it does not run".

**Still not in this slice**, for the reason the section above gives:
`transportation.layer` z-ordering, road hierarchy by `class`, splitting
`rail`/`transit`/`ferry` out of the roads row — all three need a per-feature
line colour or a feature ORDER, which is a widget capability. Street-name
labels (`transportation_name`) need a line → label-anchor reduction and are
last.

### One density PER ROW, and the two opposite costs behind it

The card mounts one layer per OpenMapTiles row and used to hand all ten of
them a single number (`mapOsmLayers` fanned the card's one slider out over
every enabled row), so a reader who wanted ROADS sharpened had to sharpen
land cover with them. `glyphMapOpenMapTilesLayers(source, { densities })` had
taken a per-row record from the day it was written; the page was the only
thing collapsing it. Each row now carries its own control on its own line,
`MapOsmLayerOptions.densities` is that record, and nothing in
`@glyphcss/maps` changed.

**Per row, and ONLY per row.** The RECORD is the single source of truth —
there is no second master value in page state, and no master CONTROL either.
The card kept one for a while: a slider that WROTE every row
(`mapOsmDensityRecord`, an overwrite, never a ratio) and READ as the shared
value or as **"mixed"**. It is gone. Per-row control is the feature, a second
control standing for every row at once is redundant beside it, and its one
distinct reading — "mixed" — was a statement about the controls rather than
about the map. What still speaks for the card as a whole is the `stroke
grids` cost row below, and it matters MORE without the master: a reader can
no longer flatten every stroke back to one number in one drag, so the live
grid count is the thing telling them why the frame got slow.

`mapOsmMasterDensity` survives the control it was written for, because the
LINK still needs it — it is what token `Q` carries (see "On the wire" below),
and it is why removing the master needed no codec change at all.
`mapOsmDensityRecord` survives as the legacy `Q` seed and as the bench hook's
whole-card write (`__glyphMapsBench.setOsmDensities`, beside the per-row
`setOsmDensityRow`).

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
  consumes it for the two hotspot-mounting types), so those rows carry **no
  density control at all** — not a disabled one. A greyed slider is a control
  a reader has to work out is dead, and it spends the row's whole width
  saying nothing; the row keeps its label and its toggle, the checkbox stays
  in the same flex head of the same WIDGET column it occupies on every other
  row, and the value column is simply empty (the card body's three columns
  are declared on the row, not inferred from its children, so nothing
  reflows). The set is derived from each row's own `type` against
  `OSM_DENSITYLESS_TYPES`, never a list of row ids: the row list belongs to
  `@glyphcss/maps` and has already moved twice — `Peaks` became a labelled
  `symbol` row, and `Protected areas`/`Water labels` were appended as
  `symbol` rows — so a hardcoded list would have gone stale silently. Five of
  the thirteen rows are densityless today (`Places`, `Peaks`, `POIs`,
  `Protected areas`, `Water labels`).

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
are one token each, because the common cases were opposite: those six are
touched one at a time, while the master gesture wrote all ten of these at
once (the master is gone from the card, but the tuple's shape is a wire
format and does not move because a control did). It is appended LAST in the field list, since `decodePacked` stops at the
first unrecognized token and there is then nothing after `M` for an
older build to strand. A uniform card writes `Q` at the shared value; a mixed
one writes it at the default and so spends no characters on it, because there
is no honest single float for ten different ones. The tuple's WIDTH is itself
a wire format — unlike the `osmMask` bitfield beside it, which has 31 bits of
headroom — so `mapsUrlState.osmDensity.test.ts` asserts the two lists still
match and an eleventh row goes red here rather than silently reinterpreting
every shared `M` link.

Gates: `mapsOsm.density.test.ts` (the record, the `Q` reading, and that a
row's density reaches that row and only that row), `mapsOsmDensity.cost.test.ts`
(both cost claims, through the real widget, against
`pre[data-glyph-overlay-density]`), `mapsUrlState.osmDensity.test.ts` (legacy
`Q` seeding, mixed round trip, `M` beating a `Q` carried beside it, and a
captured ten-slot `M` string still decoding character-for-character),
`LayersPanel.osmDensity.test.tsx` (the rows, the absent master, the densityless
rows carrying no control at all, the live grid count) — the last two asserted
against the RENDERED control set, not a props object.

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
one control per row and no master at all — "One density PER ROW" above, which
changes nothing here: the link's `Q` still seeds EVERY row at 2.9 on decode,
so it is reproduced exactly), and `density !== 1` is
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

### The walker is on `groundChangeSyncs`, because a cold load has no stride

`refreshWalkGround` is called on entry and after every stride. Both are events
the WALKER causes, and a COLD LOAD is neither: the reader enters walk mode
while the pyramid is still in flight, the first tile lands a moment later, and
nothing asks the walker to look again — so the eye stays at the datum until the
first keypress. The widget already owns the registry for exactly this event
(`groundChangeSyncs`, which a `fill-extrusion`'s base and a marker's anchor
both ride, and whose own doc says it exists for consumers "invisible to the
sweep that would otherwise re-derive them"); the walker was simply not on it.
This is the FOURTH "wrong until you interact" defect of its shape on this
branch, after the marker, contour and palette paths.

Measured on a 500 m plateau entered before its tiles: `getWalk().groundElevation`
reported 0 after the load settled and 500 the instant the mode was left and
re-entered, and the picture agreed — the point 100 m ahead AT EYE LEVEL
projected to row **-73.8** of a 63-row grid (the plateau 500 m over the
walker's head, off the top of the frame) instead of the centre row, which is
where it lands now (31.500 of 31.5).

The sync re-poses the camera itself, because nothing else will, and REBUILDS
the sky dome — the dome stands on that same ground, and `recentreWalkSky`
deliberately will not do it (its trigger is horizontal DISTANCE, and a
stationary walker has not moved a metre). Unchanged ground returns before any
of that, so the tile updates an ordinary walk causes cost one sampler read.
Registration is per-WALK, not per-map: `setWalk(null)` removes it, so a tile
landing after the reader leaves cannot re-pose the orthographic camera off a
walker's ground.

`widget.walk.test.ts`'s three standing-height clauses structurally cannot see
this — every one of them awaits `map.on("load")` and only then calls
`setWalk({})`, so all three enter onto terrain that is already mounted. Gate:
`widget.walkColdGround.test.ts`, which inverts exactly that ordering.

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

### A facade is a claim about the wall, and a mast is not a storey stack

Reported on the Berlin Fernsehturm: "this tower shouldn't have freaking
windows". It is the right complaint — window bays and floor bands assert that
the wall is a stack of habitable storeys, and a concrete broadcast mast is not
one.

**The tag that says so never reaches us, and that was measured rather than
assumed.** The way carries `building=tower`, `man_made=communications_tower`
and `tower:type=communication` in OSM. Read straight out of the live
OpenFreeMap tile that draws it (`14/8802/5373`), the `building` layer's entire
property vocabulary is:

| layer | everything it carries |
|---|---|
| OpenMapTiles `building` | `render_height`, `render_min_height`, `hide_3d`, `colour` |
| OpenMapTiles `poi` | the tower IS here — id `5564352412`, `class: "attraction"`, `subclass: "attraction"`, 50 `name:*` translations |
| Protomaps `buildings` | `kind: "building"`, `height`, `sort_rank` |

Both schemas keep the handful of fields their own renderer needs and discard
the rest; openstreetmap.org is not reading vector tiles at all, it renders
server-side from the full osm2pgsql database. So a type lookup is not available
at any price short of a second network service, and the two that would work —
a point-in-polygon join against the `poi` layer, or Overpass — buy POI
semantics (`attraction`, `hotel`, `bar`) rather than structure semantics, and
one of them needs a widget capability that does not exist (a cross-layer join;
`filter`, `color` and `height` are each handed ONE feature at a time).

**So the shape is the signal, and it separates.** Slenderness — band thickness
over footprint width — measured across three real z14 city tiles, every
feature above 4:

| tile | genuine buildings | first mast above them |
|---|---|---|
| Houston (`z14-3851-6772`) | 4.0 – **7.8** (190 m over 24.4 m) | 11.2 (98 m over 8.7 m), then 12.8, 15.5, 261 (305 m over 1.2 m) |
| Berlin (`14/8802/5373`) | under 8 | **8.5** (82 m over 9.7 m), 13.1, **18.6 — the Fernsehturm shaft** (205 m over 11 m), 14.0 / 23.9 / 51.2 (its antenna bands) |
| `z14-8579-5736` | under 8 | 10.8, 11.7 (126 m over 8.4 m) |

`GLYPH_MAP_FACADE_MAX_SLENDERNESS = 8` sits in the 7.8 → 8.5 gap. Everything
it catches has a footprint under 18 m across — under any habitable floor plate
— and it is 2–4% of the features in those tiles. Houston's towers keep their
windows; the Fernsehturm's shaft and every band above it lose theirs.

**Width is the footprint's equivalent-circle diameter, never an extent.** A
terrace row is legitimately long and thin — 200 m by 8 m, 30 m tall — and
every extent-based width either calls it a mast (min extent 8, ratio 3.75 and
climbing with any taller row) or has to be loosened until a real mast passes.
By area it measures 45 m across and its ratio is 0.67, nowhere near the knee.

The verdict is resolved **per polygon group**, the same unit the ground probe
and the cap plane are resolved for, so one wall of a mast can never disagree
with the next. A refused band loses a TEXTURE and never a wall: its polygon
list is vertex-for-vertex the bare mesh's, gated as such.

### A raised band had no underside

`glyphMapVectorMesh` emitted a cap and walls and no floor. For a building
standing on its own ground that is right — the floor is coplanar with the
terrain and can never be seen. For a band standing OFF it, it is a hollow
shell from below: the cap faces up so back-face culling removes it, the far
walls go with it, and the eye looking up sees straight through to the sky.

The Fernsehturm is the worst case for it because the tower is not one feature.
Its live tile ships it as eight stacked `render_min_height` bands —

```
332..374  (antenna)      264..285
307..332                 256..264
284..307                 235..256
                         205..235  (the sphere)
                           0..205  (the shaft)
  plus 0..368 tagged hide_3d, which the schema filter already drops
```

— so seven of the eight were open underneath, and standing under the head is
exactly where a reader looks up.

Each floor face is the cap face's own refined triangle projected at `base`
with the **opposite winding to the cap it mirrors**, so it looks down by
construction however that cap's facing verdict was reached (plane alignment
for a well-conditioned face, the lon/lat winding times `localOrientation` for
a sliver). A second facing probe was rejected outright: it can disagree with
the cap above it and leave the band open at one end, which is the defect
wearing a different hat. A sliver's floor carries the negated
`Polygon.shadingNormal` and registers in `walls` at `base` like the cap
sliver does, so the per-frame near-side cull sees it.

The gate is a RENDER from underneath rather than a polygon count — a floor
wound the wrong way is still a polygon and still draws nothing — and its
grounded clause reddens when the `baseOffset > 0` gate is dropped.

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

## Not fixed, because it is not what it looked like: "`glyphMapTargetLOD` skips z13"

Reported as: the LOD picker steps **z14 → z12 at about a 4 km span**, so every
building disappears in one step because the OpenMapTiles `building` source
layer starts at z13. Investigated end to end; **the ladder does not skip a
level**, and the gate that now says so is `widget.lodLadder.test.ts`.

### What the ladder actually visits

`glyphMapMercatorZooms(0, 14, 256)` declares a native resolution of
`tileLonSpan / tileCols` = `1.40625 / 2^z` degrees per sample, strictly
halving per level, and `glyphMapTargetLOD` chooses the coarsest level with
`native(z) <= span / cols`. So level `z` owns exactly the octave
`[cols·native(z), cols·native(z-1))` of view span — **every level, z13
included, with no gap and no overlap**. At the `/maps` grid shape (140x63):

```
 z14 <  0.024033 deg      z13  0.024033 .. 0.048065      z12  0.048065 .. 0.096130
```

Measured three independent ways, all agreeing: the rule probed at both ends of
all fifteen windows; the real widget sweep re-mounted across the span range
(distinct `loadTile` zooms `14,13,12,…,0`, in order, none missing); and a
**paced** wheel zoom-out through the real gesture path (`14, 13, 12`).

The reported reading is a property of where two probes landed, not of the
ladder. z13's octave is narrow ON THE GROUND: at Zurich's latitude
(`cos 47.375 = 0.677`) it is **1.81 km to 3.62 km** of ground across the
viewport. A probe at "a street view" and another at "about 4 km" straddle it
and answer z14 and z12 — which is exactly the `[14, 12]` sequence the report
describes, and exactly what the new gate prints when z13 is deleted from the
declared ladder as a mutation.

A skip IS possible, but only from a ladder that is not strictly monotonic in
native resolution (a level baked at fewer samples per tile than its
neighbours declares the same resolution as the level above it and becomes
unreachable at every view). That hazard is demonstrated on a synthetic ladder
in the same file and then excluded for the Mercator ladder and for this
package's own equal-angle pyramids.

### What is really happening, and it is the schema

Buildings vanish at `span >= 0.048065 deg` (3.62 km of ground at Zurich)
because that is the z13 → z12 step and **the tile at z12 carries no `building`
layer at all** — `minzoom: 13`, read out of the vendored
`fixtures/openfreemap/tilejson.json` by the test rather than quoted. Counted
through the real `omt-buildings` row on a probe provider that mirrors only the
depth rule: 36 of 36 footprints built at z14, 36 of 36 at z13 one part in 1e9
under the boundary, **0 at z12** one part in 1e9 over it. Tile counts either
side of that step are 4 (z13) and 2–4 (z12) — the step costs nothing and buys
nothing; it just crosses the schema's floor.

### Why the window is so much narrower than a raster map's, and what it would cost to widen it

`glyphMapTargetLOD` compares the tile's generalisation size against
`view.span / view.cols` — **character cells**. `tileResolution` 256 is the
slippy-map tile's size in PIXELS. On `/maps` a cell is ~10.3 px wide
(1440 / 140), so at any given view the picker lands ~3.4 levels shallower than
the zoom those tiles were generalised for. Every OpenMapTiles `minzoom`
therefore kicks in ~3.4 levels later than the schema intends: MapLibre at
1440 px shows the same z13 building data across a ~19 km view; this shows it
below 3.62 km.

That is defensible for RESOLUTION — the output really is 140 cells wide, and
one tile's worth of generalised detail per ~256 cells is the right amount of
geometry for the grid. It is wrong for CONTENT, because a layer `minzoom` is a
cartographic policy keyed to apparent scale, not to detail. The two live at
different zooms for a vector basemap, and nothing in the current model
separates them.

Lowering `tileResolution` to the MapLibre-equivalent (`256 / pxPerCell` ≈ 25,
i.e. one tile per ~256 px rather than per 256 cells) does widen the window,
and the cost is prohibitive at the current sweep budget. Measured, same probe,
140x63, tiles per sweep:

| span (Zurich km) | `tileResolution` 256 | 32 | 25 |
|---|---|---|---|
| 0.048 (3.6) | z13, **4** | z14, 12 | z14, 12 |
| 0.096 (7.2) | z12, **6** | z14, 35 | z14, 35 |
| 0.190 (14.3) | z11, **4** | z14, **110** | z14, **110** |
| 0.250 (18.9) | z10, **4** | z13, 63 | z13, 63 |
| 0.490 (36.9) | z9, **4** | z12, 63 | z13, **169** |
| 6.0 (452) | z6, **9** | z9, **110** | z9, **110** |
| 90 (6785) | z2, **4** | z5, **135** | z5, **135** |

20–40x the fetches, and past the ~100-tile sweep ceiling at most of the
ladder — for a globe page that streams the planet on demand. So this is a
product decision with a real price, not a bug fix, and it is NOT taken here.
The cheaper shapes, if it is ever wanted, are: a per-LAYER LOD floor driven by
the source's own declared `minzoom` (TileJSON already carries it, so it would
be general rather than a building special case) which pays the deep-tile price
only for the layers that need it; or keeping the last-loaded deeper tiles
mounted across the step so buildings fade out with the view instead of
vanishing at one span.

## Long `symbol` labels wrap (`glyphMapWrapLabel`)

A `symbol` label was one line of characters however long the name was.
`Region de Magallanes y de la Antartica Chilena` is 46 cells and a whole city
view is 140, so one name took a third of the frame — and because the greedy
arbiter reserves a box per label, that strip also suppressed every neighbour
inside it. The fix is to break the label onto several lines and to make the
arbiter measure the block that is actually drawn.

### The rule

Word boundaries only, no hyphenation: a single word longer than the wrap
width overflows its line rather than being cut, because a broken place name
is worse than a wide one (`Llanfairpwllgwyngyll…` stays one line).

Balanced, not greedy. Greedy filling of that name gives
`Region de Magallanes` / `y de la Antartica` / `Chilena` — a 7-cell stub
beside a full line. `glyphMapWrapLabel` picks the line COUNT first,
`min(maxLines, words, ceil(label.length / width))`, so the width is what
decides whether a second line is needed at all, then partitions the words
into exactly that many lines minimising the sum of squared line lengths (the
classic minimum-raggedness objective; with the line count fixed and the total
near-fixed it is minimising the variance of the line lengths). A small DP over
the word list — the labels are a handful of words, so the O(lines · words²)
scan is free. The result on that name is `Region de` / `Magallanes y de la` /
`Antartica Chilena`, widest line 18.

The lines are centred on each other and on the feature's own point: the
element is already centred on the anchor by `.glyph-hotspot`'s
`transform: translate(-50%, -50%)`, so `text-align: center` inside a
shrink-to-fit box is the whole of it. (It was not shrink-to-fit when this was
written — see "Label placement" below, where that turns out to be the reported
"left-aligned label" defect and `text-align: center` turns out to have been
masking it for the wrapped path only.) `white-space: pre` is set alongside it
and is not decoration — the consumer's own `.glyph-map-symbol` rule (on
`/maps`, `maps-workbench.css`) sets `white-space: nowrap`, under which the
newlines collapse to spaces and the label is not wrapped at all. Those two
declarations are the wrap's mechanism, which is why they are set by the
library and the rest of a symbol's presentation still is not.

### The width and the line cap, against the real distribution

Both are fixed character counts rather than fractions of the viewport,
following MapLibre's `text-max-width` (10 ems): a place name's block shape is
a property of the NAME, and tying it to `cols` would reflow every label on a
resize for no cartographic reason.

`GLYPH_MAP_LABEL_WRAP_CELLS = 20` was chosen against the label lengths in the
vendored OpenFreeMap tiles — 1,981 named features across the world (z0),
Zurich city (z12, z14), an alpine peak tile (z8) and a maritime one (z4):

| p50 | p75 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|
| 12 | 17 | 23 | 29 | 39 | 54 |

At 20, 85.5% of real labels are left as one line and the ones that wrap are
exactly the outliers that provoked this. (16.0% of the 1,470 named features in
the Zurich z14 tile wrap.)

`GLYPH_MAP_LABEL_WRAP_MAX_LINES = 3`, not 2: a two-line cap leaves the reported
46-character name 23 cells wide, which is most of the complaint still standing,
and the p99 label at 20. Three brings those to 18 and 13, while a three-line
block of ~15 characters still reads as one label rather than a paragraph on the
map. A fourth line would only ever engage above 3 × 20 = 60 characters, longer
than the longest name in the fixtures, so it would be dead code.

### The arbiter had to learn the wrapped box

This is the half that decides whether wrapping helps or hurts.
`glyphMapDeclutterLabels` reserved `label.length × 1`. A wrapped label is
NARROWER and TALLER than its string, so an arbiter still reserving the strip
would make wrapping worse than not wrapping — freeing columns nothing draws in
while letting a neighbour land on the second line.

`GlyphMapLabelCandidate` therefore grew an optional `lines` (the array
`glyphMapWrapLabel` returned), and the box is `max(line length)` wide by
`lines.length` tall. Omitted means one line and the box is computed from
`label` exactly as before — which is what keeps every contour label untouched,
the same shape as the `padX`/`padY` addition before it. `widget.ts` wraps once
at feature-build time and carries `lines` on the record, so `sync` (which runs
on every marker update) pays for neither the wrap nor a rejoin.

Gates: `layers.test.ts` pins both edges of the reserved box from probes that
straddle them (widest line 18 against the string's 46, three rows against one)
and pins that a candidate with no `lines` keeps the old box exactly;
`widget.symbolWrap.test.ts` pins the rendered element — its lines, the two
declarations that make them render, its unchanged anchor, and the pair of
neighbours that discriminates a real fix from a half one (the one below is now
suppressed, the one 16 columns out is now kept). `stroke.test.ts` drives a
deliberately absurd 31-character contour label through the widget's own
plan → declutter → stamp sequence and pins that it still lands as one
contiguous run on one row.

### Cost

Nothing per frame. Measured on the 1,470 named features of the vendored
`z14-8579-5736.mvt`, scattered over a 140×63 grid, 500 declutter passes:
0.3117 ms/pass unwrapped against 0.3111 ms/pass wrapped — inside noise, because
a `max` over at most three short strings is nothing against the arbiter's own
O(n · placed) overlap scan. Wrapping all 1,470 names costs 0.577 ms ONCE, at
feature-build time. Labels surviving the arbiter were 310 against 309 on that
random scatter, i.e. wrapping neither gains nor loses labels in the aggregate;
what it changes is WHICH ones, and that a long name no longer clears a strip
across a third of the frame.

### No `/maps` change

Wrapping is applied where a label is turned into cells
(`createPointFeatureRuntime`), so every `symbol` layer gets it — `omt-places`,
`omt-parks`, `omt-water-labels`, `omt-peaks` — with no row in
`GLYPH_MAP_OPENMAPTILES_LAYERS` and no page control. There is deliberately no
per-layer option: the width is a property of the character grid, not of the
data, and a caller who wants a different one can call `glyphMapWrapLabel`
themselves through `GlyphMapSymbolLayer.text`.

## Label placement: `textAnchor` / `textOffset`, and the box that was never the label

The report was "labels of places shouldn't be left aligned, probably should be
centered", then "could we have placement options for the labels?". Those are
two separate things and one of them was a defect.

### The defect: the box was one character wide

glyphcss's `addHotspot` gives every hotspot a `size` box, defaulting to
`[1, 1]`, staged as `width: 1ch; height: <cellAspect>ch`. That is right for a
click anchor — a hit target on a vertex — and wrong for a label. A symbol
layer asked for no `size`, so every place name was a 1-character box with the
text overflowing it, and `.glyph-hotspot`'s `transform: translate(-50%, -50%)`
then centred THE BOX on the projected cell while the text ran off to the right
of it. A 6-character name sat about 2.5 cells right of its own point; a
14-character one, 6.5.

That is exactly the reported "left-aligned", and it is also why the WRAPPED
labels looked right while single-line ones did not. The wrap work set
`text-align: center` on multi-line labels only, and an overflowing line box
with `text-align: center` overflows SYMMETRICALLY — so the centring the wrap
record above describes ("`text-align: center` inside a shrink-to-fit box") was
accidentally compensating for a box that was never shrink-to-fit. The premise
in that record was wrong; the render it describes was right.

The fix is the box, not the alignment: `createPointFeatureRuntime` removes the
`width`/`height` declarations for a `symbol` (never for a `circle`, which sets
its own diameter), so the element is genuinely shrink-to-fit and glyphcss's
own rule centres the label itself. `text-align` is left exactly where the wrap
work put it — needed for several lines, meaningless for one.

### The option

`GlyphMapSymbolLayer.textAnchor` is MapLibre's `text-anchor`, vocabulary and
semantics unchanged (`center` — the default — `left`, `right`, `top`,
`bottom` and the four corners), because it is the established name for the
concept and `left` meaning "the label's left edge is on the point, so it reads
out to the right" is what anyone coming from a web map already expects.

`GlyphMapSymbolLayer.textOffset` is `[x, y]` in CELLS, `y` down, applied ON TOP
of the anchor. It is here for the reason MapLibre pairs `text-offset` with
`text-anchor`: an anchor alone puts the label's edge exactly ON the point, so a
name anchored `left` of a `circle` layer's dot has its first character inside
the dot. Cells rather than ems because a cell is this package's unit and the
only one BOTH halves of the placement can convert exactly — the arbiter's
boxes are already in cells, and the widget knows its own cell size in CSS
pixels. An em would be the label's font, which the consumer's stylesheet owns
and this package cannot see.

Both are LAYER options, not per-feature: this is a cartographic decision about
a class of things (city names sit beside their dot, region names sit on their
centroid), and a per-feature answer is what a `filter` plus a second layer
already expresses.

### One table, two units

`glyphMapLabelAnchorFraction` is the whole of the placement — the anchor as a
signed fraction of the label's own drawn box, `0` centred and `±0.5` for a
leading/trailing edge. Both halves read it:

- the arbiter multiplies it by the box it has already measured in CELLS;
- the widget turns it into the CSS percentage the browser multiplies by the
  box it lays out in PIXELS, `-50% + fraction × 100%`, so `left` is
  `translate(0%, -50%)` and `bottom-right` is `translate(-100%, -100%)`.

They are the same displacement in the only two units each side can see, so an
anchored label and the box reserved for it cannot drift apart. That is the
trap, and it is the same one the wrap work hit: an arbiter still reserving the
box on the point while the label is drawn to one side of it makes collisions
WORSE while the map looks emptier — every neighbour under the label survives,
and every neighbour where the label no longer is gets suppressed for nothing.

`glyphMapLabelPlacement` (widget) resolves a layer's pair into `null` for the
default, so nothing downstream touches `style.transform` or the candidate at
all — that is what makes the default byte-identical rather than merely
equivalent. Its transform is a FUNCTION of the cell size, because the anchor
half is a percentage of a laid-out box while the offset half is a count of the
map's own cells: only the first can be written once. It is therefore re-derived
in `sync` (the DOM-only sweep that already writes each label's `opacity`) and
assigned only when the string changes, so a resize costs one assignment per
label and a pan costs none.

### What each half can and cannot change

The anchor CAN change which labels survive, because its displacement is a
fraction of each label's OWN width and labels differ in width. The offset
CANNOT, within one layer: it is the same vector on every candidate, a rigid
translation, which preserves every pairwise overlap and therefore the whole
greedy result. Its box move is still plumbed and still pinned — on the arbiter
itself, where a single candidate can move alone — because the reserved box has
to be true by construction; the widget-level test asserts the invariance
instead of pretending to a discrimination that cannot exist.

Gates: `layers.test.ts` (the box moves with the anchor in both directions and
on both axes, the offset composes rather than replaces, an explicit
`center`/`[0,0]` equals an omitted one, and the CONTOUR call shape — padding,
no anchor — still reserves a symmetric box); `widget.symbolAnchor.test.ts` (the
element carries no `width`/`height` at all, asserted as its whole `outerHTML`
against glyphcss's own injected `translate(-50%, -50%)` rule; every one of the
nine anchors as the transform it stages with `left`/`top` unmoved; the
neighbour pair that discriminates a moved reservation from a stale one; the
default byte-identical across three labels and the rendered `<pre>`; and the
contour labels stamped cell-for-cell identically beside a symbol layer anchored
hard into a corner).

### `text-variable-anchor`: measured, and recommended as its own slice

MapLibre's `text-variable-anchor` is a LIST of anchors tried in order until one
does not collide, so a crowded label moves instead of being suppressed. The
arbiter this package now has is the machinery that would need; measured on the
vendored OpenFreeMap tiles (candidates projected through the widget's own
camera at 140×63, all named points, then arbitrated with the fixed box against
a greedy per-candidate anchor search):

| view | candidates | fixed | 5 anchors | 9 anchors |
|---|---|---|---|---|
| Zurich z12, span 0.15° | 105 | 72 | 84 | 85 (+18%) |
| Zurich z12, span 0.09° | 61 | 43 | 47 | 49 (+14%) |
| Zurich z12, span 0.05° | 38 | 30 | 33 | 33 (+10%) |
| Kansas z8, span 3° | 81 | 69 | 73 | 74 (+7%) |

Strictly more labels at the same density, and the fifth through ninth anchors
add almost nothing over the first five. It is worth building — as its own
slice, not folded into this one, because the cheap part is the arbiter loop and
the real work is elsewhere: the arbiter would have to report the CHOSEN anchor
back per candidate, which turns the widget's one shared transform string into a
per-record write in the sync sweep, and a label that flips anchor between
frames as the camera pans reads worse than one that disappears (MapLibre damps
that with its own fade; this widget has no such rule and would need one).

### Per-ROW placement on `/maps`' OSM card, and the URL token it needed

The follow-up ask was one line: *"label per row dude, because its a control
that is by layer, so since its by layer its independant by row // yes, save
everything in the url"*. `textAnchor` was already a layer option and the OSM
card mounts one layer per OpenMapTiles row, so the control had to be per row —
the same argument that killed the card's master density slider, and a stronger
one, because placement is a statement about a CLASS of things: a city name
reads beside its dot while a lake's name reads across the water it names, so
no single card-wide anchor can be right for two rows at once.

**Which rows get it is derived from each row's own `type === "symbol"`, never
a list of ids.** That list belongs to `@glyphcss/maps` and it has moved twice:
`omt-peaks` was a `circle` row before it became a labelled `symbol` one, and
`omt-parks`/`omt-water-labels` were appended as `symbol` rows later. A
hardcoded list written when this card was built was already two rows out of
date. `circle` is deliberately not in the set — it mounts a dot with no text,
so there is no label to place — which is why this is its own predicate rather
than the complement of the densityless one.

**The control lands in the widget column those rows freed.** A `symbol` row
carries no density (nothing in the renderer reads one for a positioned
hotspot), so since the per-row density work its widget cell held the toggle
and nothing else and its value cell was empty. The placement control takes
both (`grid-column: 2 / 4`, the same span the Dock gives a `<select>` and the
card's own info rows already take) — not a fourth column and not a second
line. It is the rail's own segmented `IconToggle`, the control /synth's
field/wave rows, the Projection picker and the Sun toggle all use, trimmed to
the 24px row through a descendant selector.

FIVE of the nine anchors, not nine: a nine-way segmented control in a 340px
rail row gives each button ~13px, narrower than the icon inside it, and the
corners are the placements a character grid distinguishes least (a label
displaced half its own box diagonally lands within a cell or two of the
edge-anchored answer beside it). The icon draws BOTH the point and the label
box, because the vocabulary is MapLibre's and MapLibre's `left` puts the
label's left EDGE on the point — so the name reads out to the RIGHT of it. An
icon showing a bar on the left for "left" would be showing the opposite of
what the option does.

**The builder owns the "default is byte-identical" rule, and owns it once.**
`glyphMapOpenMapTilesLayers` drops an anchor naming `"center"` and an anchor
aimed at a non-`symbol` row; `mapOsmLayers` hands its record over whole. The
first shape had the page filtering too, and the package-side guard then had no
reachable test — the mutation that removed it stayed green. One owner, one
test that bites.

**The URL is token `l`, a 13-slot `floatTuple` at step 1, appended LAST.** The
slot holds an INDEX into `GLYPH_MAP_LABEL_ANCHORS`, so that list is a wire
format on the same append-only rule as `MAPS_OSM_SUBLAYER_KEYS`, pinned in
`mapsUrlState.osmLabels.test.ts`. Positional over EVERY row rather than over
the labelled ones for the reason above: which rows are labelled is a property
of the package's row TYPES, and those move, so a wire list keyed on that set
would be silently reinterpreted the next time a row changed type. The empty
slots cost nothing — the whole token is omitted while every row is centred,
which is every link ever shared and every untouched card. Width frozen at 13
for the reason `M` is frozen at 10 (`MAPS_OSM_DENSITY_SLOTS`): a `floatTuple`
reads its declared width and hands the cursor on, so a fourteenth row means a
SECOND token, never a wider one. LAST for the reason `M`, `w` and `J` each
give: `decodePacked` stops at the first token it does not know, so a link
written here and opened by an older build strands only what is ordered after
it. `l` and not `L` (`layerMask`) — every upper-case letter was spent by `J`.

Old links are pinned by SNAPSHOT, not by inspection: `mapsUrlState.osmLabels.test.ts`
carries all eight packed strings vendored across the suite together with the
exact partial each decoded to before the token existed, and re-encodes the
longest real one (`p3x6-yc1a…J1a1o1a`, the reported field link carrying both
density tuples) to the byte-identical string it decoded from.

**Wrap width and max lines are NOT here.** `GLYPH_MAP_LABEL_WRAP_CELLS` (20)
and `GLYPH_MAP_LABEL_WRAP_MAX_LINES` (3) are module constants, not layer
options: `glyphMapWrapLabel(label, width, maxLines)` already takes both as
parameters, but `createPointFeatureRuntime` calls it as `glyphMapWrapLabel(label)`.
Making them per-row therefore needs two fields on `GlyphMapSymbolLayer` and
that one call site widened to read them — a `widget.ts` change, which this
slice did not own. The card is the only thing that would then need two more
rows and two more URL slots, and both are cheap once the layer options exist.

## Black lines in the middle of the sea: a `fill`'s tessellation slivers

The report was one line: "also lets fix these black lines in the middle of the
sea". The link decoded to a globe over the mid-Atlantic — centre
`-28.96126 / 9.653595`, span 40.41, tilt 4, bearing 359, exaggeration 24,
atlas encoding — with **terrain, borders and contour all OFF** and the OSM
card the only mounted layer, itself carrying a single row: `omt-water`, at
density 1.4. So the whole picture was one vector `fill` of the OpenMapTiles
`water` layer, and the lines were holes in it: one to two cells wide, tens of
cells long, curving with the surface, moving with the geometry rather than
with the grid, and present inside a SINGLE tile (the sweep asks for exactly
one at that framing, `3/3/3`).

### What it was not

- **Not a tile seam.** One tile is mounted at that view. The lines run
  diagonally across its interior, nowhere near `3/3/3`'s own bounds.
- **Not the antimeridian.** The visible window is roughly `-49..-9` degrees of
  longitude.
- **Not a `line` layer.** No stroke layer is mounted — the link's `O` mask has
  exactly one bit set, and `4be71a5`'s maritime/disputed exclusion is not
  involved because the boundaries row is off.
- **Not the relief mesh.** No `raster` layer is mounted at all, so no tier,
  no backstop and no sink is in the frame.
- **Not `e141f94`'s new `class` colouring.** `GLYPH_MAP_OPENMAPTILES_WATER_COLORS`
  falls back to the row's own colour for an unknown class, and the cells were
  BACKGROUND, not a colour.

Setting `GLYPH_MAP_FILL_MIN_FACE_UP_ALIGNMENT` to zero made every line vanish
in one run, which located it exactly: the faces were being DROPPED.

### The mechanism

`glyphMapVectorMesh` triangulates in lon/lat with earcut, whose ears connect
boundary vertices with no interior vertices to work with. An ocean polygon's
rings are the tile box plus its continents (the real `3/3/3` water layer: one
`ocean` feature, one group, 15 rings, 560 points), so earcut fans it from the
box's own corners — long, thin faces reaching right across the open sea.
Curvature refinement leaves them alone and is right to: its verdict is a pure
function of an EDGE, and each of their edges is already inside the 13-degree
limit that makes a chord a good stand-in for the arc.

A long thin triangle inscribed on a sphere, though, has a circumcircle whose
centre is tens of degrees away, and a triangle's plane normal points at its
circumcenter. So the face's PLANE is the great circle's rather than the
surface's, and its normal is up to 90 degrees off the local up — not noise,
a real geometric fact about a thin patch. The old guard read exactly that
normal for two jobs at once (which way the face points, and whether to trust
it) and dropped everything past `acos(0.9)` = 25.84 degrees.

Measured on the real OpenFreeMap `3/3/3` ocean polygon: 1,076 refined cap
faces, 122 of them cut. The widest was 13.72 degrees of arc and **0.500
degrees across** — at that framing's 0.25 degrees per cell, a two-cell gap 55
cells long, drawn straight across the Atlantic. The guard's own premise, that
"the same degeneracy that makes a sliver's normal meaningless also makes its
area negligible", is false: nothing bounded how FAR one reached.

### Three fixes that were measured and rejected

1. **Just keep them** (drop the alignment guard). The holes close — the
   vendored z0 ocean goes from 184 interior holes to 1 at the reported
   framing — but a kept face is shaded by its own plane, so the black line
   becomes a line of wrongly-toned cells (`@` and `%` against `#*+=`
   neighbours in the same render), and `layers.globe.test.ts`'s "no face may
   look into the sphere" plus three far-side clauses go red.
2. **Bound how far a face may reach** — a max lon/lat edge length, so the
   guard's premise becomes true. The bound is exact and derivable: a dropped
   face satisfies `L^2 / (8h) > 0.4510`, so its width is under
   `0.004836 * L_deg^2` degrees, which measured 0.500 -> 0.127 -> 0.031 at
   caps of infinity, 6 and 3 degrees. It does not work. A crack of ANY width
   still blanks a cell wherever it covers the cell's sample point, so the
   hole count falls only linearly while the face count rises quadratically
   (118 -> 49 holes at 4.9x the faces, 71 ms per render at a 3-degree cap
   against 21 ms), and an absolute or extent-relative cap fires on FLAT
   projections too, breaking "an affine projection is untouched, face for
   face".
3. **A better tessellator.** A constrained Delaunay in a local tangent frame
   emits no slivers at all and is the real root fix, but it is a new
   dependency and an architectural change, and earcut is shared with
   `@glyphcss/fonts`' `extrudeContours`.

### The fix: stop asking a sliver which way it points

A sliver cannot answer that question, and it never had to. Two things that
are well conditioned for ANY face shape answer it exactly:

- the face's own lon/lat **winding** (`signedArea2`, exact whatever its
  thickness — earcut and red-green refinement both preserve the outer ring's
  normalised orientation, though not universally: 5 CW and 8 zero-area
  triangles out of 12,099 in the vendored z14 tile, so the sign is read per
  face rather than assumed), and
- the projection's own local **handedness**, `localOrientation` — a probe of
  `project` in the same family as `localUpDirection`, central differences in
  lon and lat crossed against the up probe. A probe, never a projection id, so
  a `glyphMapFromD3Raw` projection and a `setProjection` blend both work.

Their product is the face's outward verdict. What the face's own plane still
decides is the ONE thing a winding cannot repair: whether the plane looks the
right way THROUGH the surface, since a face whose plane passes on the far side
of the globe's centre shades as if lit from inside. That is tested per VERTEX,
not at the centroid — a plane through the centre is edge-on, and the centroid
then reports a sign its own corners do not share (the pole-reaching patch in
`layers.globe.test.ts` produces exactly one such face, at a plane distance of
-3.4e-15). It cuts 14 of the 1,076 faces instead of 122, and those 14 are the
narrowest.

**The well-conditioned path is untouched.** A face at or above the old 0.9
alignment — 954 of 1,076 on that tile, and every face any affine projection
emits — takes the original branch, byte for byte, and pays for no extra probe.

### Near versus far is still camera-dependent, and rides the existing cull

A correctly wound sliver is removed by the rasterizer's own backface cull
wherever it lies wholly on one hemisphere. What that cull cannot decide is a
face reaching ACROSS the limb: its projected orientation is then whichever
half dominates, and a far-side sliver near the limb inks the near side
(measured on `widget.farSideFill.test.ts`'s own far-hemisphere patch: 16
cells, and refinement does not remove it — still 6 cells at half the curvature
tolerance).

So a sliver is reported for the same per-frame near-side test an extrusion
wall already gets, as a `GlyphMapVectorWall.cap` entry, and
`glyphMapVectorCullWalls` culls both. One list rather than two because the
widget's own gate is `mesh.walls.length` — a `fill` with slivers genuinely
DOES have camera-dependent faces, which is what that gate is asking. The
verdict is stricter than a wall's: a sliver is drawn only when EVERY corner is
visible, where a wall survives on ANY. A wall over-draws past the limb rather
than eroding a silhouette; a sliver has no silhouette to erode, it is one cell
wide, and the case that matters is one missing on the NEAR side, where all
three corners are visible anyway.

### Measured

Vendored real z0 OpenFreeMap `ocean` polygon (2 groups, 86 rings, 3,777
points), globe, 160x64, interior holes / longest 8-connected chain, before
against after:

| framing | before | after |
|---|---|---|
| the reported mid-Atlantic view (span 40.41, tilt 4, bearing 359) | 184 / 18 | 1 / 1 |
| South Pacific (span 80, tilt 0) | 65 / 7 | 14 / 2 |
| the page's own opening view (span 140, tilt 40) | 118 / 6 | 26 / 4 |

The residue at the two wider framings is coastline, not crack: single blank
cells at islands and straits, in chains of two to four. Frame cost is inside
noise (the reported view's render, real `3/3/3` tiles through the widget:
15.2 ms before, 10.6 ms after — the extra probes are paid only on the 11% of
faces that are slivers, and the filled cells coalesce into longer colour runs).

Gate: `widget.fillSliver.test.ts`. Mutation-checked by restoring the drop —
all five clauses go red (`expected 184 to be less than or equal to 2`,
`expected 7 to be less than or equal to 2`, `expected 6 to be less than or
equal to 4`, `expected 0 to be greater than 100`, and the cull clause throws
on a mesh that reports no sliver at all).

## The cracks that survived: the sliver's plane still decided one thing

The report came back with two more globe links, same shape (water `fill` only,
no terrain, no strokes), and the same complaint:

- centre `-47.101607 / 12.901767`, span 206.85, tilt 4, bearing 359
- centre `-132.816352 / -2.489387`, span 92.71, tilt 4, bearing 359

### First: the previous pass's harness was measuring a different picture

`stubMonospaceMetrics` — every widget test's cell-metric stub, the one the
section above measured through — overrides `getBoundingClientRect` on the
`<pre>` elements THAT EXIST WHEN IT RUNS. glyphcss's own cell probe is a fresh
20-line `<pre>` created per measurement inside its hidden sandbox, so it is
never one of them: it measures zero and falls back to `8 x 16`, while the
widget's `projectionGrid()` reads the stubbed `1120 x 768` output rect and
computes `7 x 12`. The widget then frames the camera for one cell size and the
rasterizer projects with another.

Two things follow, and both matter. The pictures in the table above are NOT the
framings the links ask for. And `map.unproject()` disagrees with the render by
tens of degrees — measured: the polygon that actually inks a given cell has its
nearest vertex 0.48 radii (about 28 degrees) from where `unproject` says that
cell's surface point is. That is why the previous pass could only ASSERT that
its residue was coastline: no cell in that harness could be classified at all.
`widget.fillCrack.test.ts` stubs the PROTOTYPE instead, deriving the probe's
rect from its own text, so the two agree and a cell's lon/lat is the one it
shows. `widget.fillSliver.test.ts` is left exactly as it was — its metric is
the text alone, which is self-consistent whatever the framing.

### Crack versus coastline, measured rather than asserted

A hole is a blank cell with ink on both sides in one axis. It is a CRACK when
its own `unproject` lon/lat is inside the source ocean polygon (even-odd
against the real ring set, holes included) and COASTLINE when it is not. At
160x64 on the vendored z0 ocean, at the correct framing:

| framing | holes | crack (open water) | coastline |
|---|---|---|---|
| span 206.85, the first reported link | 64 | 6 | 58 |
| span 92.71, the second reported link | 17 | 0 | 17 |
| South Pacific (span 80) | 6 | 1 | 5 |
| the page's opening view (span 140) | 31 | 5 | 26 |
| the earlier mid-Atlantic link (span 40.41) | 2 | 0 | 2 |

The coastline residue is real geography. The cracks are not, and at the finer
grid a real page reaches they are more numerous — the second link's framing
shows none at 160x64 and three at 320x128, because a crack is a fixed fraction
of a DEGREE wide and a coarser grid can sample straight past it.

### Every crack cell sits under exactly one dropped sliver

For each open-water crack cell, exactly ONE face of the tessellation contains
its lon/lat, and that face is one `aefc864` DROPPED. Its per-vertex
`planeAgrees` test — "the chord plane must have the surface's own outward side
at every vertex" — cut 1,112 of 22,009 faces on this tile, and those cuts are
these cracks. Two examples, both needles about 0.3 degrees tall and 13 degrees
long, exactly the `earcut` fan shape the section above describes:

    (-40.704, 56.891) (-47.615, 56.909) (-33.970, 56.559)
    (-16.859, -53.049) (-6.438, -52.698) (-18.820, -53.086)

`aefc864` stopped asking a sliver's plane which way it POINTS and still asked
it which way it LOOKS. A plane that is a great circle's cannot answer either.

### What was measured and ruled out

- **Not the tessellator.** `earcut`'s triangle area matches the polygon's own
  to 1.3e-15 with zero unused vertices, on both groups of the real z0 ocean
  (85 rings / 3,647 points and 1 ring / 44 points). A CDT would replace a
  triangulation that is already exact.
- **Refinement is a bad deal, not a non-answer.** Forcing 1 and 2 rounds of
  UNIFORM 4-way subdivision on top of the curvature refinement does reduce the
  cracks — the first link goes 6 -> 4 -> 2, the opening view 5 -> 1 -> 0, the
  second link's 320x128 grid 4 -> 1 -> 0 — because a sliver's plane error is
  `atan(sagitta / width)` and halving every edge cuts the sagitta by 4 while
  cutting the width by 2. It costs 4x and 16x the faces for that, and the
  render goes 8.53 -> 20.55 -> 57.53 ms at the first link, i.e. 6.7x for a
  count that is still not zero. Tightening the curvature tolerance to 0.008
  and the edge floor to 0.15 degrees buys the same shape of trade at 4x the
  cost. This is the section above's max-edge-cap rejection re-measured at a
  framing that is real, and it lands in the same place.
  **It is also why the red-green refinement never subdivided these faces on its
  own** — its verdict is a pure function of an EDGE, and a sliver's edges are
  already inside the 13-degree curvature limit that makes a chord a good stand-
  in for the arc. The face is ill-conditioned in its ASPECT RATIO, which no
  per-edge test can see.
- **Not the recursion cap.** Raising `GLYPH_MAP_FILL_MAX_REFINE_DEPTH` from 8
  to 24 changed not one face: `GLYPH_MAP_FILL_MIN_EDGE_DEG` terminates first,
  so the one rule that could leave a T-junction never fires.
- **Not the cull.** Relaxing the sliver's every-corner near-side verdict to a
  wall's any-corner one changed the ink by 1 cell in 3,168. Disabling
  glyphcss's pre-projection cull runs outright reproduces every count exactly.
- **Not shading.** Re-rendering with the space-free `solid` palette gives the
  identical ink count, so a blank cell is uncovered, not merely dark.
- **Not the rasterizer.** Every crack cell's depth is `-Infinity`: no triangle
  claimed it.

### The fix: the surface's own normal, carried on the face

`Polygon.shadingNormal` (new, `@glyphcss/core`) is an authored unit shading
normal replacing the geometric one. LIGHTING only and solid mode only:
visibility is still the projected-winding back-face verdict, depth and the
shadow map read geometry, and a zero-length or non-finite value falls back to
the geometry. `glyphMapVectorMesh` sets it, on the ill-conditioned faces only,
to `localUpDirection` at the face's centroid — the projection's own outward
surface normal there, the same probe family the facing verdict already uses.

The property `planeAgrees` was defending is then true BY CONSTRUCTION for every
emitted sliver, where the test could only DISCARD the faces that failed it. It
also closes the "up to 26 degrees off" shade error the previous section left
open, and closes it for every sliver rather than only the ones the test cut:
a kept sliver is now shaded by the surface, not by its own chord.

`layers.globe.test.ts`'s "no face may look into the sphere" clause reads the
shading normal where one is authored, and keeps its original geometric clause
verbatim for every face that authored nothing — so an authored normal can never
become a way for a bad plane to skip the check.

### Measured

Vendored real z0 OpenFreeMap `ocean` polygon, globe, 160x64, before against
after: open-water cracks 6 -> 0 (first link), 0 -> 0 at 160x64 and 4 -> 1 at
320x128 (second link, the survivor being the antimeridian seam below), 1 -> 0
(South Pacific), 5 -> 0 (opening view). Interior holes fall 64 -> 58, 6 -> 5 and
31 -> 26; the rest is coastline and is unchanged. The mesh grows 20,897 -> 22,009 polygons (+5.3%, exactly the
1,112 that were cut) and the cost is inside noise: mesh build 34.4-35.7 ->
35.3-36.5 ms, render 7.8-8.4 -> 7.8-8.6 ms at the first link, 3.4-3.6 -> 3.4-3.9
at the second. Affine projections are untouched — an equirectangular fill
refines nothing, so it reaches the ill-conditioned branch never, authors no
shading normal, and emits the identical face list.

Gates: `widget.fillCrack.test.ts` (both reported links, decoded, on the real
vendored tile, with the crack/coastline split measured per cell) and
`packages/glyphcss/src/render/rasterize.shadingNormal.test.ts` (the field is
lighting-only, is byte-identical when absent or set to the geometric normal,
never decides visibility, and degrades to geometry).

### Still open

The ANTIMERIDIAN SEAM. At fine grids a strip about a tenth of a degree either
side of +/-180 loses single cells (320x128: 1 in the second link's framing, 5
over the South Pacific, all between -179.8 and -180, none anywhere else). The
vendored z0 ring carries the tile's own buffer out to +/-185.625 degrees, so
this is about the seam rather than about face shape; it is one cell wide, it
does not chain, and `widget.fillCrack.test.ts` excludes that strip explicitly
rather than absorbing it silently.

## "Labels still flicker": a sweep that rebuilds what it already has

The third pass on the same report, and the first one that could not be found from the DOM at all.

`e60d3c5` had traced `mount / down / drag… / up / settle` and correctly established that nothing is removed or re-added *during* a drag — that is what `widget.symbolDownscale.test.ts` asserts, and it still holds. The rebuild happens 180 ms **after** the gesture, on `scheduleTileUpdate`'s debounce, and `createFeatureLayerRuntime.update()` used to call `rebuild()` unconditionally: same view, same LOD, same five cached tiles, full teardown anyway. Measured on the reported view (globe, span 67°, six OSM rows) with a `MutationObserver` on `.glyph-hotspot-layer`, three consecutive 40 px pans that fetched no tile at all produced `+4298 -5872`, `+4298 -4298`, `+4298 -4298` — one complete rebuild of every label per gesture.

**That rebuild is what paints, and it paints through a CSS transition.** A hotspot `<div>` is created by `scene.addHotspot` with no `opacity`, i.e. the CSS default `1`, and only the declutter arbiter — which runs at the *end* of the rebuild — writes `opacity: 0` on the ~4,230 labels it drops. In between, `sync()` read layout: `projectionGrid()` is two `getBoundingClientRect()` calls and `project()` called it **per record**, ~8,600 forced style-and-layout flushes for one sweep. The first of them RESOLVES the freshly inserted elements at opacity 1, so writing 0 afterwards is a change between two resolved styles — and `/maps`' own `.glyph-map-symbol { transition: opacity 120ms linear }` animates it. For ~120 ms after every gesture, every place name on Earth is painted over the map and fades out.

**Why no DOM trace can see this.** The DOM is correct at every frame boundary: a `requestAnimationFrame` sampler reads `n = 5872, shown = 67` on every single frame of the gesture, the release, the settle and the debounce, and never once sees a label in the wrong state. What paints is the *transition*, running off a computed style the DOM no longer holds. Four separate DOM-level traces (per-frame counts, per-frame visible-name sets, element identity, unstaged-position counts) all read clean. It took a CDP screencast to see it at all: twelve consecutive composited frames at 1.65× the normal PNG size, monotonically shrinking — the fade — while the sampler alongside them reported `shown = 67` throughout.

The fix is three statements, all in `widget.ts`, and each is a different half of the same rule — *a label the arbiter has not ruled on is not a label the reader may see*:

1. **The sweep does not rebuild what it already has.** `createFeatureLayerRuntime` remembers the tiles, in sweep order, that produced the mounted geometry, and skips `rebuild` when the next sweep resolves the same OBJECTS in the same order. Reference identity of the tiles rather than of the keys: a key set that re-resolves to a re-fetched tile is a real change, while the same objects in the same order can only produce the same `selected` array, so the skip is exact rather than a heuristic. It is opt-in (`featuresAreTheWholeInput`) and only `createPointFeatureRuntime` takes it — a `heatmap`'s relief samples the mounted TERRAIN, so an unchanged vector tile set still has to re-mesh when a finer elevation tier lands, and a `fill-extrusion` re-probes its ground through `groundChangeSyncs` instead. `reprojectGeometry()` passes `force`, because a projection change moves every hotspot anchor and is the one input to a rebuild that is not the tile set.
2. **The grid is measured before the DOM is touched.** `rebuild` takes `projectionGrid()` as its first statement, before a single node is removed or added, and hands it to `sync`; `projectOn(lngLat, grid)` is `project()` against a grid the caller already has. A rebuild now resolves style exactly ZERO times between inserting a label and deciding whether it is shown, so there is no earlier resolved style for a transition to run from — and it stops paying two synchronous layouts per record.
3. **A label is born hidden.** `handle.el.style.opacity = "0"` immediately after `addHotspot` returns (glyphcss appends the element itself, so that is the earliest the widget can speak), with the arbiter raising the winners inside the same synchronous rebuild. Redundant given (2) on the paths this file controls, and deliberately kept: any consumer that forces a layout mid-rebuild — a `ResizeObserver`, devtools — would otherwise reopen the window.

Measured after: the same three gestures produce ONE rebuild (the genuine tile-set change), and a screencast over four gestures including that rebuild has a max/min frame size ratio of 1.276 against 1.65 before, with no burst anywhere.

Gate: `widget.symbolRebuildFlash.test.ts`. It cannot observe the animation — no DOM environment can — so it pins the three properties that make the animation impossible, each mutation-checked: element identity survives an unchanged sweep (`+4298 -4298` had identical COUNTS, which is exactly why a count-based trace read clean, so the assertion is reference identity); the layout-read count at the first label insertion equals the count after the arbiter's verdict; and the previous label already carries `opacity: 0` at the instant the next one is appended.

---

## Markers stand on the ground: draping `symbol` and `circle`

Reported with the Peaks row and the terrain raster both on: *"seems that we are putting those labels at the floor so if I combine the peaks layer with the terrain map we have they loop off... do you think we could place those labels at the right height?"*

`createPointFeatureRuntime` anchored every marker at `projection.project(lon, lat, 0)` — the datum — while everything else in a `/maps` scene already stood on the exaggerated relief: the terrain mesh by construction, a `fill-extrusion` since `d517143`, a `line`'s vertices since the stroke drape. Under a tilt that relief has parallax, so the label was drawn wherever sea level happens to be under a camera that is looking at a mountain.

**A peak makes it obvious; it was never a peaks defect.** Every `symbol` and `circle` marker had it — places, water labels, parks, POIs — and the displacement is `elevation x exaggeration x sin(tilt)` of screen, divided by the metres a row covers. Measured on the gate's own alpine framing (globe, `exaggeration: 24`, `tilt: 40`, span 2.16 degrees over 140x63, i.e. ~167 km across): 13.9 rows over 3,089 m of ground. At a city-scale alpine view (span 0.05 degrees, 27.6 m per cell) the same 3,089 m is 862 rows — thirteen screens.

### Which height: the terrain SAMPLE, not the feature's own `ele`

This was the one real question. A `mountain_peak` carries `ele` in true metres, so there were two candidates and they are not the same quantity:

- the **terrain sample** under the peak's lon/lat — where the RENDERED relief is; and
- the feature's own **`ele`** — where the REAL summit is.

They disagree because a raster pyramid under-samples a summit: a peak is the extreme of its cell, and even the finest tier this repo bakes is ~1.2 km per sample. Read off the real ETOPO1 pyramid (`bake-geo-tiles.mjs`, z0-z4 global plus curated Switzerland z5-z7), `ele - sample` at the finest tier that exists for the point:

| Peak | `ele` | z4 sample | curated z7 sample | `ele - z7` |
|---|---|---|---|---|
| Matterhorn | 4478 | 2372.5 | 3089.1 | 1388.9 |
| Dufourspitze | 4634 | 2957.1 | 3973.3 | 660.7 |
| Dom | 4545 | 3367.3 | 3650.0 | 895.0 |
| Jungfrau | 4158 | 2245.9 | 3247.5 | 910.5 |
| Eiger | 3967 | 1849.0 | 2721.0 | 1246.0 |
| Piz Bernina | 4049 | 3039.3 | 3353.1 | 695.9 |

**The sample wins, and `max(sample, ele)` is the same mistake at half strength.** A label is a statement about the surface the reader can SEE, and that surface is the raster's own sample — so anchoring at `ele` floats the label above the drawn summit by the difference times the exaggeration. Rendered, not argued: mutating the anchor to `max(sample, ele)` puts the Matterhorn's label **6.25 rows** above the ground it names at the gate's framing, and the same arithmetic is 388 rows at a city-scale alpine view — six screens of sky. (Treating `ele` as a TRUE-METRE quantity through `glyphMapTrueScaleElevation` instead, the way a `fill-extrusion`'s height is exempt from exaggeration, is worse in the other direction: `4478 / 24 = 186.6 m` against 3,089 m of ground, ~810 rows BELOW the drawn summit at that same view.)

It is also the only answer that **generalises**, which is the constraint that settles it independently of the numbers: `ele` exists on peaks and on nothing else, while a place name, a lake label, a park or a POI carries no elevation property at all and still has to stand on its ground. One mechanism, one sampler, every marker.

### The mechanism, and why it needed its own channel

`markerGroundAt` is the whole rule: `groundElevationSampler()` if a raster layer is mounted, the datum otherwise, and the datum again for a non-finite sample (no mounted tile covers the point) rather than a NaN anchor — the same "the honest base is the datum" rule the stroke drape and the extrusion planting both take. It feeds three expressions that used to hard-code `0`: the `addHotspot` anchor, the `circle` branch's near-side probe, and the declutter candidate's `projectOn` (which grew an optional `elev`, defaulting to the datum so every other caller is byte-identical).

**Re-planting could not ride the feature sweep.** A point layer is the ONE runtime that asserts `featuresAreTheWholeInput`, so it skips its rebuild whenever the vector tile set is unchanged — that skip is `b4460d6`, and it is what stops a pan from destroying and re-creating every label `<div>` on screen. A finer TERRAIN tier landing changes no vector tile at all, so the sweep never sees it. `groundChangeSyncs` is the registry that already exists for exactly this event (the mounted tile set, not the camera), and `createPointFeatureRuntime` now registers a `syncGround` beside the `fill-extrusion`'s: re-resolve the sampler, re-probe every record, and move the ones that actually changed. Without it a label planted before its terrain arrived names a summit it is a screenful below for the life of the map — measured as four of this slice's six assertions going red when the registration is deleted, because `/maps` adds its layers in one turn and the labels are built before the first tile lands.

**Moving a marker without destroying it** needed one new thing in glyphcss: `GlyphHotspotHandle.setAt(at)`. The alternative is remove-and-re-add, which destroys the element — losing whatever the consumer wrote on it and restarting any CSS transition on it, i.e. re-opening the flash `b4460d6` closed. `setAt` replaces the anchor and schedules a render; the element and its listeners survive. `sync()` then re-runs the arbiter once, because a label that just moved 14 rows collides with different neighbours than it did before.

### Cost

Measured through the real widget at 4,300 markers (the count the flicker slice measured on the reported view), settled alpine framing, medians of three runs, against the same harness with the drape reverted:

| | baseline | draped |
|---|---|---|
| layer build (4,300 markers) | 178.0 ms | 181.2 ms |
| per render | 118.6 ms | 124.9 ms |
| ground change (tile set moves) | 182.5 ms | 220.9 ms |

The build cost is the one ground probe per marker: **+3.2 ms over 4,300 markers, 0.75 us each**. The ground change is the re-probe on every `notifyGroundChanged` notification (several per mount sequence, coalesced on a microtask): **+38 ms at 4,300 markers**, on the tile-set-change path only.

**The per-render sweep is unchanged in mechanism** — the ground rides on the record and is never re-sampled per frame, so `sync()` does exactly the work it did, with a nonzero `elev` on a `project()` call that already multiplied one. The +6.3 ms in the table is inside this harness's noise: three runs of the SAME baseline build over flat terrain spread 104.5 / 116.5 / 128.4 ms. (The stroke drape's own precedent — one projection per vertex, and *cheaper* than the offset-and-forgive pass it replaced — holds a fortiori here, where markers are three orders of magnitude fewer than stroke vertices.) At 0 markers both builds sit at ~1.6-2.0 ms per render and ~11 ms per ground change.

### Gate

`widget.markerDrape.test.ts`, six clauses on a real alpine view with real ETOPO1 sample values as the fixture's elevations (2,372 m coarse, 3,089 m fine — the actual z4 and curated-z7 readings under the Matterhorn), asserting staged positions and rendered cells, never that a sampler was called:

1. A peak's label lands on the terrain's own row, ±1, and more than 8 rows off the datum's — with the premise (the ground is genuinely elsewhere on screen, and still on screen) asserted first.
2. It reads the SAMPLE, not `ele`: the label carries `Matterhorn 4478`, so a mechanism that read `ele` had every chance to, and the two rows are 6+ apart with both on screen.
3. It coincides with a **draped `line`** through the same point — the rendered `<pre>` cells the label has to sit on. The datum's row is inked by nothing.
4. A `circle` dot and a label with **no elevation property at all** drape the same way.
5. It follows the ground: mounted wide so the coarse tier lands first, then zoomed until z4 arrives, and the label is on the fine tier's row and 3+ rows off the coarse one.
6. **No raster layer mounted is byte-identical**, asserted as the full `outerHTML` of the symbol and circle elements (staged `left`/`top` included) plus a hash of the `<pre>`, captured from the build before the drape existed.

Mutation-checked, each restored from a `cp` backup: unregistering `syncGround` turns 4 of 6 red; `max(sample, ele)` turns 5 of 6 red (6.25 rows off, and the no-raster golden with it); leaking a nonzero ground when the sampler is `null` turns exactly the byte-identity clause red and nothing else. On the glyphcss side, making `setAt` a no-op turns its own clause in `createGlyphScene.test.ts` red.

### Known limit, inherited

A marker whose lon/lat is not covered by any mounted tile falls back to the datum, so it can sit at sea level next to terrain that is drawn — the same limit `line` vertices have, and for the same reason (the alternative is a NaN anchor). `addMarker`'s imperative `GlyphMapMarkerOptions.elevation` is unchanged and still the caller's own absolute number: it is an explicit anchor, not a feature planted on a layer.

---

## A `fill` stands on the terrain: draping water, landcover, landuse and parks

Reported with the terrain raster and the water layer both on: *"lago titicaca is a lake that's on height, right? is there any way to put it on height? because if I look at the map with the terrain layer activated too, I cannot see that lake because it's on the floor below the terrain."*

Every `fill` was built at the datum. That was written down as a decision — *"a `fill` is deliberately NOT planted: it is a flat overlay on the datum, not a structure standing on the ground, and its own mesh carries no walls to stand on"* — and it was the last member of the family still there: the terrain mesh stands on the exaggerated relief by construction, a `fill-extrusion` since `d517143`, a `line`'s vertices since the stroke drape, a `symbol`/`circle` marker since `fddeb9d`, and a `contour` since `3924f61`. Lake Titicaca's surface is 3,812 m, so at `/maps`' default `exaggeration: 24` the datum is ~91 km of world below the ground drawn over it, and not one cell of the lake can win the depth test.

### The tile carries no elevation, so the terrain is the only height there is

Confirmed against the data rather than the schema docs, by enumerating the property keys of every feature in the nine real OpenFreeMap tiles vendored under `fixtures/openfreemap/`:

| source layer | every property key across the vendored tiles |
|---|---|
| `water` | `brunnel`, `class`, `id`, `intermittent` |
| `landcover` | `class`, `subclass` |
| `landuse` | `class` |
| `park` | `class`, `rank`, `name` + `name:*` |
| `mountain_peak` | `class`, `rank`, `ele`, `ele_ft`, `customary_ft`, `name` + `name:*` |

`mountain_peak` is the only layer in the whole schema with an elevation, and it is a point layer. So a fill's height can only come from the ground under it — the same answer, and the same `groundElevationSampler`, that the strokes, the markers and the extrusions already take, and the same reasoning the marker drape settled: *the surface a reader can SEE is the raster's own sample*.

### Per VERTEX, not per group

`glyphMapVectorMesh` samples ONE ground per polygon GROUP for an extrusion, deliberately, because a structure is rigid. A fill is not a structure, it is a sheet of ground — and the numbers say so. Measured on the vendored tiles against the real ETOPO1 pyramid this repo bakes (`website/public/data/geo-tiles`, z0-z4 global plus curated Switzerland z5-z7), the spread of the ground under ONE polygon's own ring:

| tile | layer | groups | ring spread p50 / p90 / max, metres |
|---|---|---|---|
| z10 Bariloche | `water` | 23 | 17 / 202 / 520 |
| z10 Bariloche | `landcover` | 67 | 29 / 254 / 508 |
| z10 Bariloche | `park` | 15 | 153 / 625 / 739 |
| z12 Zurich | `landuse` | 158 | 2.0 / 13 / 36 |
| z14 Zurich city | `landcover` | 179 | 0.14 / 0.71 / 3.1 |

At a city LOD a group is flat enough that the two rules agree to within a metre; at a regional one a single elevation floats one end of a park by up to 739 m and buries the other, which at 24x is 17.7 km of world. Per vertex, then — and it is cheap, because it adds no faces.

### No terrain refinement: the vector data is already finer than the elevation data

The obvious worry is that draping only the ring turns a polygon's interior into a chord across whatever the terrain does in between. Measured instead of assumed: earcut each real polygon, drape its three vertices, and compare the face's own plane at its centroid against the ground actually there.

| tile | layer | faces | \|chord error\| p50 / p90 / p99 / max, m | longest cap edge p50 / max, degrees |
|---|---|---|---|---|
| z14 Zurich city | `landcover` | 1,370 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0002 / 0.003 |
| z12 Zurich | `landuse` | 5,622 | 0.0 / 0.0 / 0.9 / 4.0 | 0.0018 / 0.054 |
| z10 Bariloche | `water` | 2,757 | 0.0 / 1.0 / 24.0 / 61.8 | 0.0035 / 0.126 |
| z10 Bariloche | `park` | 2,115 | 0.0 / 4.5 / 162.9 / 278.2 | 0.0048 / 0.454 |

The median is exactly zero everywhere and p90 never exceeds 4.5 m, and the reason is structural rather than lucky: a real vector ring carries a vertex every few hundred metres, so a cap face is 0.001-0.005 degrees across at the median, while the finest elevation grid here is 0.125 degrees per sample globally and 0.0156 degrees curated. A chord that lies inside ONE bilinear cell has nothing to learn from being split. Refining a fill against the terrain would therefore buy tenths of a metre in the tail and cost squared face counts, so it is not built. (The tail is real and named: the largest, sparsest polygons — a 0.45-degree park ring at a regional LOD — reach 264 m of burial in their interior, which is ~5 rows at that view's own scale.)

### No water rule, and why a "flat lake level" is worse than the surface

The brief was right that a lake surface is flat in reality while a landcover polygon follows the ground, and right that this package has chosen a robust statistic over a mean before (`colorSample: "surface-median"`). It does not follow here, and the measurements say why.

**Where the DEM resolves a lake, the per-vertex drape is ALREADY flat.** ETOPO1 encodes a lake surface as a plateau: read at Titicaca, the z4 tier answers exactly 3,815 m at every vertex line across the lake's own footprint (the real lake is 3,812 m). The surface rule gives a planar lake there for free, with no statistic and no special case.

**Where it does not resolve the lake, no level exists that is both visible and honest.** Lago Nahuel Huapi's real surface is 764 m; at the deepest tier that covers it (z4, 13.9 km per sample) the DEM reads 887 to 1,407 m around its own ring — the pyramid has smoothed a valley lake into the mountainside it sits in. Estimators over that ring: min 887, p25 1,116, median 1,220, mean 1,210, centroid 1,269, max 1,407. A median or a mean plants half the lake BELOW the terrain that is actually drawn — i.e. it reintroduces exactly the reported defect, in patches — and only the max avoids that, by floating the whole lake up to 520 m (12.5 km of world at 24x) above its own shore. The per-vertex surface is buried nowhere by construction, because it IS the drawn surface.

So there is ONE rule for every fill type, and the option has two values rather than three.

### The option: `GlyphMapFillLayer.drape`, default `"surface"`

`"surface"` (the default) drapes; `"flat"` is the datum overlay and is byte-identical to before this existed. Per LAYER rather than per map, which is the grain the density, the render mode and the label placement already have — a reader can drape the water and leave the landcover flat.

Draped is the default because flat-with-terrain-mounted is the reported defect, and `"flat"` earns its place rather than merely preserving a bug: a wash on the datum is coplanar with every other flat layer, never wraps a ridge, and cannot be eaten cell by cell by the relief it lies on — which is what a reader wants from an administrative or landcover tint they are READING rather than flying over. A draped one reads as a model of the ground; a flat one reads as a map.

With no ground to read — no `raster` layer mounted and no caller-supplied source — the two settings are the same render, cell for cell. There is nothing to drape onto and the datum is the honest answer.

### `GLYPH_MAP_FILL_DRAPE_LIFT_M`, and why it is not a formality

A draped fill and the relief under it are the SAME surface reached by two different meshes: the terrain rasterizes from a quad grid coarsened per pyramid level (`reliefFractionForLevel`), while the drape reads the tile's full-resolution bilinear field. glyphcss's depth-test deadband cannot arbitrate — it is relative and applies only to a perspective z-buffer, and every camera here is orthographic, which takes the plain `>` test, so every tie goes to whoever drew first (the terrain). Measured on the gate's own real-ETOPO1 Titicaca fixture, cells of the lake that survive:

| lift | 0 | 1 m | 3 m | 5 m | 10 m | 20 m | 50 m |
|---|---|---|---|---|---|---|---|
| lake cells drawn | 0 | 192 | 567 | 567 | 567 | 567 | 567 |

Zero at zero. `10` is the shipped value — comfortably inside the plateau, and the same constant and unit (raw metres, pre-exaggeration, so it scales with the relief it must clear) as the heatmap's own `GLYPH_MAP_HEATMAP_SURFACE_LIFT_M`, which exists for precisely this reason and was measured against the same failure.

**The lift is enough at every density, and that took a fix in glyphcss rather than a bigger lift.** Reported from a Titicaca link carrying `terrainDensity: 1.4` and the OSM `omt-water` row at `1.8`: *"the lake doesn't remove the glyphs from the terrain... seems it only works if they both share the same density, otherwise they overlap"*. A `density !== 1` is what glyphcss's `isDetailMesh` separates on, so each of those rows rendered into its own `<pre>` and ownership moved from the base grid's per-cell depth test to the shared cross-layer occlusion id-map — whose sub-cell seam refinement then forgave the whole 10 m. Measured on this gate's own fixture at the link's own `tilt: 51`, terrain cells the lake takes: 81 at 1/1, 81 at 1/1.8, 32 at 1.4/1.4 and 1.4/1.8, 0 at 1.8/1.8 and 2/1. So the reporter's reading was half right — it is not "different densities", it is the TERRAIN being separated at all, and the base grid kept working only because it samples the id-map 1:1 and so drew a zero allowance. The right lift was never a bigger number: the old allowance was a first-order bound on the map's own local depth change, and under a pitch that is the VIEW's depth ramp (~9e-5 world units per base cell here) rather than the surface's roughness, so no world-unit lift a map can honestly claim clears it. glyphcss now takes ONE ownership verdict per id-map cell, against this pass's own depth at the same screen point (`docs/design/detail-layers.md`), which makes the verdict independent of either layer's density and leaves the 10 m doing exactly the job it was measured for. Gate: `widget.fillDrapeDensity.test.ts`, which asserts the lake takes the same share of the terrain (`hidden / density^2`) in every pairing a reader can reach with the two sliders.

### The drape moves vertices and nothing else

The facing verdict, the sliver (ill-conditioning) verdict, the authored shading normal and the camera-dependent `walls` list are all computed from the face as it would be WITHOUT the drape; only the emitted vertices are draped. That is not tidiness. The sliver guard drops to a winding-based facing and a `localUpDirection` shading normal whenever a face's normal is more than 26 degrees off the local up, and its threshold is calibrated on the only thing that can tilt an UNDRAPED cap face: ill-conditioning. Terrain tilts a draped one for real, and at 24x a 5-degree hillside is a 50-degree face — so reading the verdict off the draped normal classes most of a mountain's fill as slivers, flattens their shading to the local up and pushes every one of them into the per-frame near-side cull. Gated on the block's own Amazon flank (a patch whose ring spans 500+ m of real relief): draped and flat meshes must have the same polygon count, the same wall count and the same shading-normal population. Mutated to take the verdict off the draped face, that clause prints `expected 2 to be +0`.

### Re-planting, and the memo that was measured and removed

A `fill` on a static source is never rebuilt by `scheduleTileUpdate` — its mesh is camera-independent — so the same `groundChangeSyncs` registry the extrusions and the markers use re-plants it when the mounted raster tile set changes. Without it a lake mounted before its terrain landed sits at the datum, i.e. buried, for the life of the map; `/maps` adds its layers in one turn, so that is the normal case rather than an edge one.

The probe is deliberately NOT memoized. The sampler is a pure function of `(lon, lat)`, so a shared vertex already answers the same metre count in every face that uses it and a cache can only ever be a speed question — and it is a losing one. Measured on the real Zurich z12 tile's 158 water/landcover/landuse/park features (225 groups, 10,012 ring vertices, 9,340 emitted faces, 28,039 probe calls), median of 11 interleaved runs:

| | mesh build | note |
|---|---|---|
| flat | 5.27 ms | |
| draped, `Map` keyed on `"lon,lat"` | 9.60 ms | 28,039 string keys |
| draped, no cache | 6.21 ms | shipped |
| draped, no cache, constant ground | 5.19 ms | the sampler is the whole +0.94 ms |
| re-probe pass (per terrain change) | 1.43 ms | 28,039 points |

So the drape costs **+0.94 ms on a 5.27 ms mesh build (+18%)**, all of it the bilinear reads, plus 1.43 ms per terrain-change event, and nothing per frame — the mesh is retained and re-culled exactly as before. Face count is identical either way.

### Where the ground comes from: `GlyphMapOptions.groundElevation`

Asked directly: *"we can somehow make it configurable and not tightly coupled, because what happens if you don't have the terrain? do we need to hardcode it? or how would somebody do it with the library?"*

The drape family was already library-side, but the ground was implicit — derived from the mounted `raster` layers and unreachable otherwise. `GlyphMapOptions.groundElevation: (lon, lat) => number | null` is the seam: supplied, it WINS everywhere and needs no raster layer, so a consumer drapes on its own DEM, a constant, or a service-backed lookup; omitted, the widget derives the ground exactly as it did. `null` (or a non-finite number) means "no ground for that point" and the caller takes the datum there — the same rule a map with no terrain at all takes — so a source that answers for some points and not others needs no bounds of its own.

**With no terrain and no source, everything sits on the datum, and that is correct rather than degraded**: it is what a flat map looks like, and what all five consumers rendered before any of them learned to drape. Nothing is load-bearing on having a ground.

It is ONE source for the whole family rather than an option per layer type, because a road, the building beside it, the label on it and the lake behind it must stand on one ground or they part company under a tilt. Verified rather than assumed: `line` (`stamp`), `symbol`/`circle` (`markerGroundAt`), `fill-extrusion` and `fill` (`createMeshFeatureRuntime`) all resolve through `groundElevationSampler()`, which is the single function the option short-circuits. **A `contour` is the one exception and it is structural**: since `3924f61` its lines are marched from the mounted raster mosaic's own vertex GRIDS, which is a field, not a point lookup — a caller-supplied `(lon, lat)` function cannot serve marching squares, and pretending otherwise would be a half-answer. That is stated in the option's own doc.

No setter was added. The function is read live on every build and every stamp, so a source closing over mutable state (a DEM still loading) needs none — change what it answers, then move the camera or re-add the layer. What a caller-owned source cannot do is announce itself: a raster layer's tile arrivals re-plant mounted geometry through `groundChangeSyncs`, and there is no such event for a function.

### Gate

`widget.fillDrape.test.ts`, six clauses. The fixture is real ETOPO1: `TITICACA_BLOCK` is a literal 25x25 slice of the z4 tile `4/9` that `bake-geo-tiles.mjs` bakes — lon -71..-68 by lat -17..-14 at the pyramid's own 0.125-degree vertex spacing — because the full pyramid lives in the website tree and is not a package-test dependency. The lake's own footprint in that block is a flat 3,815 m, the altiplano around it 3,800-5,000 m, and the Amazon flank falls to 386 m.

1. The lake is buried at `"flat"` (0 cells of its colour, with the premise that the terrain is genuinely drawn over it) and drawn at the default (567).
2. With no ground to read, `"surface"` and `"flat"` are byte-identical `<pre>` innerHTML — asserted at a 40-degree tilt, which is the framing where an elevation is observable at all, and with the premise that the SAME comparison sees a difference when a ground source is supplied. A leaked ground of terrain magnitude cannot hide in it.
3. A finer tier landing moves the fill onto the ground that tier describes (coarse tiers answer the real z0 reading of 3,302 m, z4 the block's 3,815 m; on the fine tier the fill is buried unless it re-planted).
4. `GlyphMapOptions.groundElevation` wins over the mounted raster and its `null` is the datum — one clause proves both, since a source answering `null` everywhere over terrain that reads 3,815 m must bury the lake. With no raster layer at all, the same option drapes on the caller's own DEM and moves the fill off the datum's rows.
5. A steep drape keeps the same faces, walls and shading normals as the flat mesh (the sliver verdict, above).
6. The draped mesh's vertices are exactly `3,815 x exaggeration / R_earth` further from the globe's centre than the flat mesh's, face for face.

Mutation checks, each restored from a `cp` backup, verbatim from the runner:

- drop the `drape` option at the mesh call: 3 of 6 red — `expected 0 to be greater than 300`, `expected 0 to be greater than 0`, `expected 0 to be greater than 3`.
- unregister the fill's `syncGround`: 2 of 6 red — `expected 0 to be greater than 300`, `expected 0 to be greater than 0`.
- leak a terrain-magnitude ground when the sampler is `null`: exactly the byte-identity clause red — `expected '…' to be '…' // Object.is equality`. (A leak of 1 m does NOT redden it, and that is honest: 24 world metres is 1% of a row at that framing. The clause is calibrated to catch a leaked GROUND, which is what a real mistake produces.)
- ignore `opts.groundElevation`: 2 of 6 red — `expected '…' not to be '…' // Object.is equality` and `expected 503 to be +0`.
- take the facing verdict off the draped face: the steep clause red — `expected 2 to be +0`.

### Known limits, inherited

A vertex no mounted tile covers falls back to the datum, so a fill can straddle the datum and the terrain at the edge of coverage — the same limit `line` vertices and markers have, and for the same reason. And the interior chord of a very large, very sparse polygon is only as good as its own ring, measured above at up to 264 m in the worst real case.

---

## The sea is not the seabed: the ocean is the one water body a DEM cannot place

Reported on the Aegean, with the terrain raster and the OSM `omt-water` row both on — `/maps?m=p3x5f8dcgy5n2t9ms32i8t21xE1j26zb1kF21eL1dO33d0T212N1kI31jkR1M1a1a1q1k1n1t1t1a1a1aJ1a2141a`, i.e. centre 25.585 E / 38.762 N, span 5.07 degrees, tilt 69, bearing 20, globe, the default `exaggeration: 24`, terrain density 3.8 and the water row at 2.6: *"the sea is a mess"*, *"there is a ton of black lines"*, *"and weird shapes"*.

### What was actually being fed to the sea

The section above drapes every `fill` cap vertex on `groundElevationSampler()`, whose answer is the TERRAIN elevation. Over the ocean the terrain is BATHYMETRY. Measured directly, on the live OpenFreeMap tile the reported view loads (Web Mercator `6/36/24`, now vendored as `fixtures/openfreemap/z6-36-24-aegean.mvt`: one `ocean` feature, 4 groups, 109 island holes, 12,449 ring vertices) against the real ETOPO1 pyramid, over the 37,599 vertices the drape actually probes:

| | min | p05 | p25 | p50 | p75 | p95 | max |
|---|---|---|---|---|---|---|---|
| ground under an ocean cap vertex, m | **-890** | -268 | -67 | -1 | +55 | +200 | **+622** |

50.7% of them below sea level. The `+622 m` tail is the same defect from the other side: where a 0.125-degree DEM cell straddles a coast, the sea climbs the hill.

### The two reported symptoms are one mechanism

They are not two defects, and neither is a regression of `d9b5371`'s sliver-drop family — the draped and the flat mesh carry exactly the same 12,499 faces (`glyphMapVectorMesh` takes the facing and sliver verdicts on the UNDRAPED face by construction, and that is asserted).

- **"Weird shapes"** is the sea surface being the seabed. Per draped face, the vertical spread of its own three vertices is 627 m of world at the median, 3,738 m at p90 and 20,746 m at the maximum; the face's normal sits 27 degrees off the local up at the median, 61 at p90, and **2,891 of 12,499 faces stand steeper than 45 degrees**. Nearly a quarter of the "flat" sea is a cliff.
- **"Black lines"** is what those faces draw. A face approaching 90 degrees off the local up is edge-on to the camera — it covers a line of cells rather than an area, and its Lambert term collapses. `/maps` opens a globe with Sun "Full", which is a HEADLIGHT (`mapKeyLightForSunMode`), so a face turned away from the view axis goes dark rather than merely dim. Rendered at 140x63 with the reported framing, the draped sea's cells carry 354 distinct colours reaching L23 luminance against the flat sea's 302 reaching L31.
  The page's own densities add the second half: terrain 3.8 and water 2.6 put each layer in its own `<pre>` and hand ownership to the shared occlusion id-map, and a draped sea is the SAME surface as the relief plus 10 m, so ownership flips cell to cell along every bathymetric slope. Measured at the reported densities, the terrain grid loses 1,471 of its own cells to the sea while the sea's grid gains only 555 of its (coarser) ones — about 20 base cells that neither grid paints, i.e. background, in lines that follow the seabed contours.

Isolated at the reported framing (140x63, tilt 69, headlight, terrain-only render subtracted so only the water layer's own cells are counted):

| | draped on bathymetry | at the datum |
|---|---|---|
| cells the water layer paints | 1,716 | 1,615 |
| of those, near-black (< L40) | **142** | **40** |
| distinct colours | 76 | 42 |
| luminance sd over the sea | **7.8** | **3.2** |
| luminance p01 | 32.3 | 36.1 |

The shade spread across the sea more than halves and the near-black cells drop by 3.5x — the sea stops being a shaded relief and starts being a surface. GLYPH-run length is deliberately NOT the metric at this framing: a sheet whose Lambert term falls between two ramp steps dithers between them, so it reads as a run length of 1 while being exactly the sheet wanted. It is the right metric at the gate's own closer framing, where the sea sits on one step (29.9 cells per run against 12.8).

### The rule: the datum, by the definition of the datum

The section above rejected a "flat lake level" ESTIMATOR (min/median/mean/centroid over a ring), and that rejection stands — it was a statistic, and every one of its candidates buried or floated Nahuel Huapi. This is not that. Read out of the real tiles rather than argued: across every tile vendored under `fixtures/openfreemap/` plus the Aegean one, the ground under each `water.class`'s own ring vertices —

| `water.class` | n | min | p50 | max | below sea level |
|---|---|---|---|---|---|
| `lake` | 4,278 | +4 | +1,166 | +1,413 | 0% |
| `pond` | 90 | +415 | +430 | +438 | 0% |
| `river` | 988 | +22 | +411 | +1,121 | 0% |
| `swimming_pool` | 240 | +22 | +23 | +442 | 0% |
| `ocean` | 16,375 | **-5,296** | +1 | +2,587 | **48.8%** |

The premise the drape rests on — *where a DEM resolves a water body it stores that body's own SURFACE* — holds for every class in the schema except one, and it fails for the ocean for a reason in the DATA rather than in the renderer: **a DEM's zero IS mean sea level**, so the sea is the single body of water whose surface a DEM never stores, because it stores what is under it. Its surface therefore needs no estimator, no statistic and no constant: it is the datum.

### What was rejected

- **A blanket `max(ground, 0)` clamp on every draped fill.** Rejected on measurement, not taste: with the clamp in place of the datum rule, the same ocean ring still tears — 13 crack cells inside it at the gate's own framing, because the clamp does nothing about the `+622 m` coastal probes and the sea still climbs the hills. And it breaks the land that is genuinely below sea level, floating a landcover or landuse wash up to 10 km of world above the ground it describes at `exaggeration: 24`: Death Valley (-86 m), the Dead Sea shore (-430 m), the Caspian (-28 m), a Dutch polder (-7 m). The mutation check below is exactly this alternative, and it prints its own failure.
- **`drape: "flat"` on the whole `omt-water` row.** One `water` source layer carries the ocean beside the lakes, so this is Lake Titicaca back under the mountains — the very report the drape exists to answer.
- **Splitting `omt-water` into two mounted rows** through the existing `filter`. It needs no library change at all, and it was rejected because it doubles the runtimes and sweeps for water, pushes a data-schema decision onto every consumer, and changes the `omt-water` id the `/maps` URL codec's density slots are keyed on.
- **A `kind: "ocean"` row for Protomaps.** The vendored Zurich archive's `water` kinds are `basin`, `canal`, `river`, `swimming_pool`, `water` — no ocean — and this package's rule is that every name in a schema table was read out of a real tile. `protomaps.ts` is unchanged, and the shipped OSM path is OpenFreeMap/OpenMapTiles.

### The seam: `GlyphMapFillDrapeFor`

`GlyphMapFillLayer.drape` now takes `GlyphMapFillDrape | ((feature) => GlyphMapFillDrape)`. PER FEATURE, because the grain the problem has is the feature's own class and not the layer's. A PREDICATE rather than a `drapeProperty`/`drapes` value table (which would have mirrored `colorProperty`/`colors`) for the same reason `GlyphMapFeatureFilter` is a predicate: a PROVIDER source's features arrive after mount, so nothing can be pre-split, and a consumer whose schema names the sea differently — or who has a single sea collection — writes their own one-liner.

`glyphMapVectorMesh`'s `drape` callback was ALREADY `(feature, lon, lat) => number`, so the primitive is untouched; the widget stopped discarding the feature it was handed.

Three things in the widget move with it, and each is load-bearing:

1. A feature the rule calls `"flat"` returns **`0`** — which is exactly `capElev` for a fill, i.e. the expression `drape: "flat"` has always produced — and reads no ground at all.
2. It takes **no `GLYPH_MAP_FILL_DRAPE_LIFT_M`**. That lift exists to clear the disagreement between a draped cap (the tile's full-resolution bilinear field) and the relief quads under it (coarsened per level); a sheet at the datum shares no surface with the relief, and over the sea the relief is below it everywhere by construction.
3. `syncGround`'s guard became `wantsDrape` instead of `(layer.drape ?? "surface") === "surface"`. That is not tidiness: the literal comparison is FALSE for a predicate, so the whole layer would have stopped re-planting — and a `fill` on a static source is never rebuilt by a tile sweep, so every lake mounted before its terrain landed would sit at the datum for the life of the map. The reported Titicaca defect, returning through the fix for the sea. It has its own clause and its own mutation check.

`GLYPH_MAP_OPENMAPTILES_DATUM_WATER_CLASSES` (`["ocean"]`) and `glyphMapOpenMapTilesWaterDrape` are exported so a caller composing their own water layer gets the shipped rule without restating it — and so the gate reads the rule off the table rather than reproducing it.

### Gate

`widget.oceanDrape.test.ts`, seven clauses. Both fixtures are real: `fixtures/openfreemap/z6-36-24-aegean.mvt` is the live tile the reported view loads, and `AEGEAN_BLOCK` is a literal 35x30 slice of the z4 ETOPO1 tile `4/9_4` (lon 23.5..27.75 by lat 37.0..40.625 at the pyramid's own 0.125-degree spacing) — -1,460 m in the Cretan basin, +1,139 m in the Anatolian hills, 699 of 1,050 samples below sea level. Cell metrics are stubbed on the PROTOTYPE (`widget.fillCrack.test.ts`'s own reader), so `map.unproject()` names the cell it is handed.

1. Every ocean cap vertex is within **1 m of one Earth radius** — sea level — and the drape reads no ground for it at all; with the premise that draping the same polygon on the same terrain sinks it past -20,000 m of world and that the face count is identical either way.
2. The shipped rule answers `"surface"` for every real `lake` in the same tile, for `river`/`pond`/`swimming_pool`, and for a feature with no `class` at all.
3. The sea renders as a SHEET: 4,450 cells in 149 same-glyph runs (29.9 per run) flat against 4,052 in 317 (12.8) draped — a factor of 2.34, measured over the sea's own cells and never over total ink.
4. No CRACK inside the ocean ring, with the ground supplied and no raster layer mounted so the sea's own mesh is the only ink; and the premise that the draped mesh genuinely tears there (24 crack cells).
5. A layer whose features are all lakes is byte-identical `<pre>` innerHTML under the shipped rule and under a plain `"surface"`.
6. The lakes beside the ocean still RE-PLANT when a finer tier lands (coarse tiers answer the real z0 reading of 147 m, the target tier the block's 306..1,003 m over the same Anatolian plateau), with the premise that a fill pinned to the coarse reading is buried there.
7. `GLYPH_MAP_OPENMAPTILES_LAYERS` names the rule on `omt-water` and on no other row.

Mutation checks, each restored from a `cp` backup, verbatim from the runner:

- drop `drape: glyphMapOpenMapTilesWaterDrape` from the shipped row: 5 of 7 red — `expected 'undefined' to be 'function'`, `resolve is not a function`, `expected 4052 to be less than 4052`, `expected [ '22,8@25.05,39.95', …(23) ] to deeply equal []`, `expected 'undefined' to be 'function'`.
- make the widget ignore the per-feature rule and drape every fill feature: 2 red — `expected 4052 to be less than 4052` and `expected [ '22,8@25.05,39.95', …(23) ] to deeply equal []`.
- replace the datum rule with a `max(ground, 0)` clamp: 2 red — `expected 4523 to be less than 4523` and `expected [ '29,9@25.20,39.85', …(12) ] to deeply equal []`. Thirteen cracks survive the clamp, which is the measurement that rejected it.
- restore `syncGround`'s old literal guard: the re-planting clause red — `expected 0 to be greater than 20`.

### The other fill layers were checked, and need nothing

Asked directly, because `landcover`, `landuse` and `park` also cross water and also cross land that is genuinely below sea level. Measured over the same tiles, the ground under each layer's own ring vertices:

| layer / class | n | min, m | below sea level |
|---|---|---|---|
| `landcover/ice` | 631 | -1,220 | 18.2% |
| `landcover/sand` | 109 | -2 | 60.6% |
| `landcover/wetland` | 692 | -3 | 44.2% |
| `landcover/grass` | 4,335 | -3 | 12.9% |
| `park/national_park` | 2,154 | -980 | 11.8% |
| `landuse/residential` | 4,899 | -45 | 1.8% |
| every other `landuse` class | 3,700+ | +22 and up | 0% |

Two different things are in that table and neither is the ocean's defect. The `-1..-3 m` bulk (beaches, marshes, coastal grass, 60.6% of `sand`) is the 0.125-degree DEM cell straddling a shoreline — metres, invisible even at 24x, and the polygon really is at the water's edge. The `-980`/`-1,220 m` tails are marine EXTENSIONS: a national park or an ice shelf whose ring reaches out over water. They are the same resolution artefact one order up, they are a handful of features, and unlike the ocean they have no honest datum to be moved to — a national park's ground IS the ground, and an ice shelf's surface is neither the datum nor the seabed. Nothing is changed for them, and nothing pretends to be: land that is genuinely below sea level (Death Valley, the Dead Sea, a polder) must keep draping on its own real elevation, which is precisely what the rejected `max(ground, 0)` clamp would have taken away.

### Known limits

A `line` and a `symbol` over the sea still drape on the bathymetry — a maritime boundary or a water label sinks the way the fill used to. Neither is in the reported picture (`omt-waterways` is inland and `omt-water-labels` are points over a sea that is now at the datum under them), and neither has been changed here; the seam that would fix them is the same one — a per-feature rule on those layers — but it is not built without a report to measure it against.

---

## A contour that could not answer its first sweep stayed empty forever

Reported on a page loaded from a URL with the contour layer on: *"for the contour it's like I need to disable it and enable it for it to load after I refresh the page"*.

### The order is the defect

A contour's mosaic is fetched by its own sweep. That sweep runs at MOUNT and then only from `scheduleTileUpdate`, which is driven by the VIEW. So on a page opened straight from a URL and not touched, the mount-time sweep is the ONLY sweep that will ever run — and on a fresh load it races the first terrain tiles. Since `3924f61` the cut geometry is CACHED on that mosaic, so whatever the sweep resolved is the layer's answer for the life of the map, and "nothing resolved" is a cached nothing. Toggling the layer builds a fresh runtime and sweeps again, which is precisely the workaround the report describes.

Both hypotheses in the brief were checked against the code and against a harness that mounts a raster layer and a contour layer over the same provider IN ONE TURN with every tile still in flight, and neither is what is happening: the contour runtime IS subscribed to the sweep, and the "mosaic changed" trigger DOES fire for the first tiles. Every clean ordering renders — layers in the constructor, layers via `addLayer`, a 120 ms tile latency, `autoSize: true`, and all four combinations — 142 contour cells in each.

What does reproduce it, exactly and permanently, is a single failed tile fetch on that one sweep:

```
one transient tile failure  terrain inked 10240  contour field range null  contour cells 0
```

The terrain is fully drawn (the raster runtime fetched its own tiles), `getContourFieldRange` reports `null` — the mosaic was never assigned — and no later render brings it back. A fresh page load is exactly where a tile fetch can 404, time out or be aborted, and a toggle a few seconds later is served from a warm HTTP cache, which is why the workaround works and why the fault does not reproduce on a settled page.

### Two hunks, one for each half

1. **One failed tile must not take the mosaic with it.** The sweep awaited a `Promise.all` over every missing tile, so one rejection rejected the batch, left `mosaic` unassigned and surfaced as an unhandled rejection. A tile that fails now resolves as one MISSING tile — the remaining tiles still form a mosaic, and the failure is deliberately not cached, so the next sweep retries it. This is the rule `@glyphcss/maps`' vector sweep already states in its own words (*"a tile that 404s/times out/is undecodable resolves EMPTY, never rejects — one rejection would take down the frame's whole `Promise.all`"*); the contour needed it more than any other layer, because its mosaic is not re-derived per frame.
2. **A sweep that resolved nothing must be retried when terrain lands.** The contour runtime now registers in `groundChangeSyncs` — the registry whose event is the mounted raster TILE SET rather than the camera, and the same second chance the markers and the planted extrusions take. A re-sweep that resolves the same tiles fetches nothing (they are in the runtime's own `fieldCache`) and reports no change, so a settled map pays one candidate-range loop per raster mount.

They are independent, and the gate keeps them so.

### Gate

`widget.contourFreshLoad.test.ts`, two clauses, both mounting the layers in one turn with every tile in flight and never touching the view afterwards (a test that mounted the tiles first would pass on the broken tree and prove nothing):

1. One tile of the first sweep fails, **with no raster layer mounted** — deliberately, so the second hunk's re-sweep cannot rescue it and the two hunks can be told apart. The mosaic must survive and the layer must ink.
2. EVERY tile of the first sweep fails, with a raster layer mounted. Only a terrain tile arriving can rescue it, since the view never changes.

Mutation checks, verbatim:

- remove the per-tile isolation: clause 1 red — `expected null not to be null` (and vitest reports the unhandled `Error: transient tile failure` alongside it).
- unregister the `groundChangeSyncs` re-sweep: clause 2 red — `expected null not to be null`.

### Found alongside, not fixed here

The RASTER runtime's own sweep has the identical fragility: with two of its tile loads rejecting, the harness rendered **0 inked cells** — one rejection took down the whole mount, not just the tiles that failed. That is a bigger blast radius than the contour's and it is a separate change to a different runtime, so it is reported rather than folded into this hunk.

---

## The terrain's own elevation window: why it clamps where everything else crops

Asked for as "a floor, so we decide if we want to render the sea level terrain (negative), like we do with the contour". `GlyphMapRasterLayer.minElevation`/`maxElevation`, metres, either end omitted and byte-identical there — the same two numbers as `GlyphMapContourLayer`'s window, on the layer that draws the surface rather than the layer that draws lines on it.

### The question the contour's window does not have to answer

A contour simply draws no line outside its window. Terrain is a SURFACE, so "outside the window" has to mean one of two things, and both were built and rendered on the real ETOPO1 pyramid through `createGlyphMap` before choosing.

**CROP** — do not emit the out-of-window quads. It is this package's own stated principle ("crop, don't clamp", `:83`), and for ONE tier it is exact. Rendering the target LOD alone with a floor of 0 left precisely the cells the unwindowed render painted in a land band and removed precisely the ones it painted as water: 150 of 1,752 sea cells over the Mediterranean at span 40 either way, 13 of 2,932 over the Peru–Chile trench at span 33. That exactness is not luck — the crop tested the same representative elevation `colorSample` hands `color`, so a quad was dropped exactly when it would have been painted in an out-of-window band.

It is not exact for the tier LADDER, and cannot be made so. A raster layer mounts three tiers at once, each resolving the window against its OWN quad grid, so their coastlines disagree by up to a coarse quad — and a dropped quad is a HOLE, which the backstop underneath simply fills, in the colour of an 11-degree quad that is mostly land. Measured with all three tiers up, the same cropped floor of 0 painted **641** of those 1,752 sea cells in a land band against the target tier's own 150, and **344** of 2,932 against 13. That is "the sea is basically GREEN" (`:210`) reintroduced at the magnitude it was first reported at (486 of 4,462), and `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M` cannot answer it: the sink ORDERS two surfaces where both exist and says nothing about what shows through a gap in one. Cropping also ate coastline — **200** land cells went blank, each a quad whose statistic fell below the floor taking its land half with it.

**CLAMP** — hold the out-of-window vertices at the window edge. It is what shipped. It has no hole, so none of the above arises, and the tier agreement is EXACT rather than merely ordered: wherever every sample a tier covers is below the floor, every tier's surface is the same constant plane at that floor, so no coarse chord can rise above a finer one. Measured, a clamped floor of 0 left the ladder's colour statistics untouched — 165 and 17 land-banded sea cells, exactly the unwindowed render's own, with no land cell lost.

### It is not a no-op, it just is not a COLOUR change

The clamp moves nothing in the colour channel and everything in the glyph channel, which is why the first audit almost dismissed it. At a world view the ocean goes from noise to a smooth Lambert ramp — 8.2% of glyphs change at tilt 0 and 14.3% under a 60-degree tilt. That is the whole point: at `exaggeration: 24` a 6,000 m basin is a 144 km pit and ETOPO1's deepest is 261 km, and that relief renders as speckle across every sea cell. Flooring at 0 is the difference between a globe and a globe with pits in it.

### Where the window is applied, and where it is not

**POSITION only.** A quad's colour still reads the terrain's own unwindowed statistic, exactly as `elevationBias` already does — a windowed mesh is the same map at a different shape, never a differently-classified one. Clamping the colour too would hand an elevation-band classifier the floor value for every sea quad on Earth, and `GlyphMapClassifiers.etopo1V1`'s first break is 0, so a floor of 0 would paint every ocean in the lowest LAND colour: the sea-painted-as-land defect `colorSample` exists to prevent, this time by construction rather than by accident.

**Per VERTEX**, which is the answer to "median, corners, or vertices". There is no quad-level accept/reject decision, so `colorSample` never enters it. It is also what makes a partially-submerged quad right: its land corners keep their heights while its sea corners sit on the plane, so the coast still slopes into the water instead of stepping. Clamping by a quad's own colour statistic would move all four corners together and flatten real coastal relief a whole quad at a time (gated: of the coastal quads in the trench fixture, not one comes out flat).

**Every tier**, through `mountTile` — one resolved window object spread into every `glyphMapPolygons` call. Observable only where a tier is itself the visible surface, i.e. at the span where the floor IS the target LOD and takes no sink; everywhere else an unwindowed backstop is hidden behind a closed windowed surface, which is the clamp's own safety property. Gated there: 135 changed cells with the floor windowed, exactly 0 with it left out.

**`groundElevationSampler`**, because it reports the ground things are PLANTED on and the window moves where that ground is drawn. A road draped at the seabed's own -4,000 m under a floored terrain would sit ~96 km of world below the plane the sea is now drawn at — the same parting-company-with-the-ground the stroke drape exists to prevent (`:1640`), caused by the window instead of by the datum. Mutating the clamp out does not merely displace the stroke, it DELETES it: the gate goes from a stroke on the floor's own row to zero inked cells, buried under the surface it is meant to lie on.

**IN the sampler, per vertex — not around it.** The clamp started life wrapped around `glyphMapGeoTileElevationAt`'s answer, and that is a different function from the one the mesh draws: `glyphMapPolygons` clamps each retained VERTEX and interpolates the clamped values, while a wrapped clamp interpolates the RAW field and clamps afterwards. `max(x, m)` is convex, so the two agree everywhere except across a quad that STRADDLES a bound, where the mesh is strictly higher. `widget.reliefWindowGround.test.ts` could not see it for a structural reason — its provider is `new Float32Array(...).fill(elevM)`, uniform terrain, where clamping every vertex and clamping the blend are the same number at every point of every quad. Measured on a quad falling -4,000 m to +4,000 m under `minElevation: 0`: the drawn surface at its midpoint is +2,000 m and the sampler answered 0, i.e. 48 km of world at `exaggeration: 24` — and again it does not displace the stroke, it DELETES it (0 inked cells against rows 17-20 around the independently predicted +2,000 m row of 19.13). The window is therefore a fourth argument to `glyphMapGeoTileElevationAt` itself (omitted = unbounded and byte-identical), so every consumer of that sampler inherits the right order rather than each having to re-derive it. Gate: `widget.reliefWindowGroundSlope.test.ts`.

**Not a `contour`.** It marches the mounted mosaic's own vertex GRIDS rather than reading the drawn surface, and it carries its own `minElevation`/`maxElevation` for the same job. Coupling them would let one layer's option silently reach into another's. The consequence is real and documented rather than hidden: a contour below the terrain's floor is buried under the flattened surface, and the fix is to set the contour's own floor to match.

### What it does to the ocean fill, and what that turned out to be

A `"flat"`-draped ocean (`685dcd3`) and a terrain floored at 0 both describe the sea's surface at the datum. The composition is stable — identical frame render to render, one contiguous surface, nothing blank — but ownership flips completely. Measured at span 33, 140x63:

| terrain floor | ocean-fill cells | terrain-water cells |
|---|---|---|
| none (seabed at -6,000 m) | 8,820 | 0 |
| 0 m | 0 | 8,820 |
| -20 m | 1 | 8,819 |
| -100 m | 38 | 8,782 |
| -400 m | 728 | 8,092 |
| -1,500 m | 8,820 | 0 |

It happens at a floor of -1 m too, so it is NOT a coplanar depth tie. It is the FILL's own tessellation: `glyphMapVectorMesh` refines a ring until the projection is locally affine, and the resulting chords sag INSIDE the sphere while the relief mesh's much finer quads sit close to it; the ~1,500 m crossover is that sagitta. The ocean fill only ever won these cells because the unfloored seabed sat 144 km of world beneath it. Raising the terrain to the datum uncovers a property the fill has always had.

Left as it is rather than tuned. `685dcd3` settled with its own measurements that a `"flat"`-draped ocean takes NO `GLYPH_MAP_FILL_DRAPE_LIFT_M`, and re-opening that on the strength of a different feature's fixture would be exactly the "shift the bug one layer down" move. The picture is coherent either way — one smooth sea at the datum, in the terrain palette's own sea band — so the ocean fill becomes redundant under a floored terrain rather than broken by it.

### What was rejected

- **An option to choose crop or clamp.** The measurements do not leave two usable behaviours: crop is unusable with the tier ladder that ships. An option here would be a way of not deciding.
- **Cropping only the target tier, or suppressing backstops under a window.** It trades a documented artefact for a blank hole during every pan, which is the thing the tier ladder exists to prevent.
- **A resolution-independent crop rule** ("drop only where every covered sample is out of window"). It makes the coarse tier's kept set a superset of the fine tier's only approximately — different pyramid levels hold differently decimated data — and at the floor's 11-degree quads it eats essentially every coastal quad on Earth.
- **Clamping the colour with the position.** Paints every ocean in the lowest land colour; see above.

### Cost

Free, and slightly negative. Mesh build on a real z4 tile (180x90 = 16,200 quads): **4.57 ms unwindowed, 4.39 ms floored** — two `Math.min`/`Math.max` per vertex against a projection. Render at the Peru–Chile coastal view, span 33, 140x63: **18.72 ms unwindowed, 17.24 ms floored**. Both differences are at or inside noise, and what direction there is, is self-funding in the way the headlight record already describes: a flat sea gives longer same-colour runs, so the commit write is cheaper.

### The page control

The Terrain card gets `floor` and `ceiling` rows — the SAME `ElevationWindowRow` the Contour card uses (renamed from `ContourWindowRow`, with `contourWindowTrack`/`CONTOUR_WINDOW_STEP`/`parseContourWindowEnd` renamed alongside it), because they are the same two numbers in the same units and a lookalike would be worse than a reuse. The terrain track runs over the ETOPO1 envelope (`elevationWindowTrack(null, …)`) rather than a live field range: the raster layer has no `getContourFieldRange` equivalent, and the envelope IS its range. URL: `f`/`o` appended LAST to the v3 schema, `step: 10` (finer than the control's own 50 m, so a typed value survives), `MAPS_TERRAIN_WINDOW_OFF` (±32,000) as both the unbounded sentinel and the default, so an untouched window costs zero characters. Its own constant rather than a reuse of `MAPS_CONTOUR_WINDOW_OFF` — two independent wire fields, and a retune of one must not silently move the other. Pinned against a real already-shared link (the Aegean framing from the ocean-drape record above), which still decodes field for field and re-encodes byte for byte.

### Gates

`mesh.elevationWindow.test.ts` (a vendored real 45x30 ETOPO1 slice of the trench-and-cordillera, 1,004 of 1,350 samples below sea level), `widget.reliefWindow.test.ts` (the tier ladder, on `widget.backstopOcclusion.test.ts`' own step-continent pyramid), `widget.reliefWindowGround.test.ts`, `widget.reliefWindowOcean.test.ts`, `mapsUrlState.terrainWindow.test.ts`, `LayersPanel.terrainWindow.test.tsx`.

Mutation checks, each restored from a `cp` backup afterwards:

1. `projectVertex` stops clamping → 7 red across the mesh and widget suites.
2. `groundElevationAt`'s `clampToWindow` becomes the identity → the draped stroke is not displaced but DELETED (`expected 0 to be greater than 0`).
3. `mountTile` stops forwarding the window → 2 red.
4. Only the `"fine"` tier is windowed → the floor-tier gate goes red (`expected 0 to be greater than 50`). This one was written twice: the first version of that test stayed GREEN under this mutation, because a clamp hides tier disagreement behind its own closed surface. The gate now targets the one span where the floor is the visible surface.
5. `terrainWindowOptions` passes the sentinel instead of omitting → 2 red.
6. The `f`/`o` tokens are inserted before an existing token → the ordering gate goes red.

## The drape family, corrected: what the allowances were measuring, and what they should have been

An adversarial review of the drape commits (`2d27c55..70f2359`) found five defects. Four of them are one mistake in four places: **a quantity stated in the wrong frame**. What follows is the record; the contracts are in `AGENTS.md`.

### The stroke's ground slack was measured in CAMERA DEPTH

`drapedRunPerCell` gave each drape sample `slack = max(neighbour.depth) - depth` over the samples within `GLYPH_MAP_STROKE_GROUND_SUPPORT_CELLS` screen cells. `depth` is `project()[2]`. On a flat plane under a pitch, a sample one row nearer the camera is one row of the VIEW's own depth ramp nearer — about 8 m at `/maps`' 40 degree default and 12 m at 60 — so any stroke with a screen-vertical component collected roughly two rows of that ramp on ground with no rise in it at all. That is the slope-scaled allowance `781486f` removed, back through a different door for one stroke direction.

Measured on `widget.strokeOcclusion.test.ts`'s own Zurich fixture (globe, 24x, span 0.006, 140x63, road through a building, counting road cells strictly inside the footprint):

| road direction | ground source | 6 m @40 | 12 m @40 | 20 m @60 |
|---|---|---|---|---|
| west-east | none | 0 | 0 | 0 |
| north-south | none | 0 | 0 | 0 |
| north-south | `groundElevation: () => 0` | **10** | **10** | **5** |

**Why every gate stayed green.** All four occlusion gates used a WEST-EAST road — screen-horizontal, so its neighbours sit at equal depth and the slack is zero by construction — and none of them mounted a ground at all, so `groundElevationSampler()` was `null` and `drapedRunPerCell` never ran. The gate that exists to pin `781486f` never executed the code `70f2359` added. Both dimensions had to move at once for the defect to appear, which is why the test file now parameterises both.

**The fix is the unit.** Elevation cannot express the camera. The neighbours' own ground ELEVATIONS are compared, and only a genuinely higher one is converted into depth — by re-projecting the sample's own lon/lat at that elevation, which is exact for every projection (all of them are affine in `elev`) and costs a projection only where there is real relief. Flat ground gives `highest === elev` and therefore no slack and no projection, at every pitch, zoom and direction.

**The support had to become 2D.** `stampGlyphMapPolyline` reconstructs the surface through a central difference in BOTH screen axes, so a border running along a parallel is tested against ground to the north and south of it that no sample ON the line ever reads. The densified run supplies the two along-line directions; `GLYPH_MAP_STROKE_GROUND_RING` reads the other six at a reach measured in screen CELLS rather than degrees (one trial projection per sample, because this widget's own 8x16 px cell spans twice the ground in a row that it does in a column, and a fixed number of degrees is the right reach in at most one direction). On the Sahara fixture the two across-line probes alone left 60 of 240 samples killed and an 8-column hole; the full ring leaves none, at a pitch where an orthographic camera cannot self-occlude and so every kill was a false positive.

**Cost**, on a synthetic 80-border load over the Sahara fixture at 140x63 (about 9,600 stamped vertices, five renders averaged): the stamp goes from 0.5-1.0 ms to 1.8-2.0 ms on a 3.3 ms base render. The ring's ground reads are most of it (1.6 ms with the trial projection removed, 0.8 ms with the ring removed). It is a correction, not an allowance, and it buys back the whole of `781486f`'s family in the direction that had lost it.

### The fill's drape lift was `10 x exaggeration` TRUE metres

`GLYPH_MAP_FILL_DRAPE_LIFT_M = 10` was added on the projection's own ELEVATION axis, which `exaggeration` multiplies. A `fill-extrusion`'s height is TRUE metres and exempt from that factor by design, so at `/maps`' 24x the lift was 240 true metres of world.

Measured on the Zurich fixture with `groundElevation: () => 0`, a landuse polygon three times the building footprint, counting cells in the building's own colour family:

| building | no ground source | with ground source |
|---|---|---|
| 6 m | 450 | **0** |
| 30 m | 450 | **0** |
| 200 m | 450 | **0** |

and a west-east road crossing the same polygon inked **0** of the 70-odd cells inside it.

**No constant reconciles the two frames.** What the lift was sized for — the disagreement between the drape (the tile's full-resolution field) and the coarsened relief quads — is a TERRAIN quantity that scales with exaggeration; a building is a true-scale one that does not. Sweeping the constant in true metres confirmed it: at 72 true metres the Titicaca gate passes and every building is buried; at 3 the buildings survive and the fill draws 0 cells; at ANY positive lift the coplanar road inside the fill is deleted whole.

So the disagreement is measured rather than forgiven, in three separable terms:

1. **The ground's own RISE across the terrain's own quad span** (`GLYPH_MAP_FILL_DRAPE_SUPPORT_CELLS`, eight compass probes at the view's degrees-per-cell). The same quantity as a stroke's slack, and necessarily so — the two lie on the same ground and are tested against the same terrain. Zero on flat ground at every exaggeration.
2. **The CHORD SAG.** A globe's relief mesh is chords and so is a fill's cap; where the two are triangulated differently they sag by different amounts, and the fill lands inside the terrain on ground with no relief in it at all. `widget.fillDrape.test.ts`'s tiered provider is exactly that case — elevation uniform per tier, zero rise anywhere — and it drew 0 cells with only the rise term. It is measured by projecting a chord against the surface it spans and resolving along the local up, so a SHEET answers exactly 0 and no `projection.id` is anywhere near it.
   Eight directions, not four: the axis probes alone lose `widget.oceanDrape.test.ts`' "draws the sea as a sheet at sea level" clause, so the diagonals are load-bearing and not symmetry for its own sake.
3. **The TIE-BREAK**, and this is all the constant is now: `GLYPH_MAP_DRAPE_LIFT_M = 1` TRUE metre, below every structure a vector source carries (the vendored OpenFreeMap tile's shortest `render_height` is 3 m). A draped fill IS the terrain's surface and an orthographic camera takes the plain `>` test, so a fill sitting exactly on the ground loses every cell of itself to whoever drew first.

**A draped `line` takes the same tie-break**, and that is what lets a road cross a park: a fill even a millimetre above a stamped stroke deletes the whole crossing, and lifting the two by the same amount makes them coplanar again, which is what they are on the ground.

**Cost.** The rise term is eight extra ground reads per drape vertex, paid on the mesh BUILD and never per frame. Measured on a synthetic 160-polygon / 10,240-ring-vertex city fill set over a rough raster tier at 140x63, add-layer-plus-settle went from a 227-260 ms median to 374-405 ms — about +55% of a rebuild that already runs only when the feature set or the terrain under it changes. The record's own note that a `Map` memo on `"lon,lat"` was measured slower than the reads still holds, and a quantized memo was not taken: it would make the lift piecewise constant and step a draped cap at every quantization boundary.

### The contour had the defect `70f2359` fixed for lines

`3924f61` made a contour real geometry — vertices projected at the level's own elevation and handed to `stampGlyphMapPolyline`. That is the same one-sided test against the terrain's depth buffer that the `line` layer needed the ground-support slack for, and the contour had neither the slack nor the per-cell densification. The record's "the contour was never exposed to this while it sampled per cell" stopped being true when it stopped sampling per cell.

Measured on the real-ETOPO1 Sahara fixture served through a pyramid so the raster and the contour read identical vertex grids, `{ interval: 200 }` at `tilt: 0`:

| view | contour alone | cells the terrain took |
|---|---|---|
| the reported Sahara span, 24x | 3,375 | **1,166** |
| a country span, 24x | 1,371 | **520** |
| span 3, TRUE scale | 609 | **296** |

With the depth test removed entirely the loss is under 20 in all three, so that is the structural floor and everything above it is a false positive.

The fix is the `line`'s, applied: the same ground-rise slack, converted by the projection at the vertex's own lon/lat, plus per-cell densification of each marching segment. Two things are specific to the contour:

- **The vertex's own elevation is the level it was cut at, exactly.** There is nothing to sample for it, so the probe ring only has to find the ground that RISES above it.
- **The reach is the comparison's support PLUS one relief quad.** At a country span one quad is around six output cells wide, so a two-cell reach reads none of the ground the surface's chord was actually cut from. Measured: the two-cell reach left 134 / 14 / 134, and widening it in CELLS saturated rather than closing (81 / 10 / 67 at 2x, 42 / 11 / 47 at 3x, 47 / 17 / 37 at 4x, 55 / 26 / 34 at 6x); adding one quad took it to **100 / 15 / 42**. Two quads bought 23 more at the reported view while COSTING 4 at a country span (77 / 19 / 35), and three cost 17 there (61 / 32 / 29), so one is where the evidence stops.
- **Densifying was measured and kept, but it is not what closed it** (133 / 18 / 128 from densification alone). It is kept because it is the same defect the `line` fixed and it costs one projection per accepted SEGMENT, not per sample: every projection here is affine in elevation, so one probe gives the depth-per-metre and every inserted sample's slack is a multiply.

The remainder is the coarse-quad-versus-fine-field disagreement `AGENTS.md` already records for a `line`, and the gate says so: its ceilings sit BETWEEN the defect and the fix with wide margin either way, in `widget.strokeRelief.test.ts`'s house style, rather than claiming a loss of zero.

### `groundElevation` answering `null` DELETED a `fill-extrusion`

`GlyphMapOptions.groundElevation`'s contract is that `null` (or a non-finite number) means "I have no ground for that point" and the caller takes the DATUM there — "a source that answers for some points and not others is therefore fine and needs no bounds of its own". Every consumer honoured it except the extrusion: the widget handed the sampler's `NaN` straight to `glyphMapVectorMesh`'s `groundElevation`, whose OWN contract is "crop, don't clamp" (a non-finite ground discards the group — right for a projection that cannot place a point), and `layers.ts` read it as `(ground ?? 0) + baseOffset`, which does not catch NaN.

Measured, 60 m building, tilt 40: **450** cells with the option absent, **450** with `() => 0`, **0** with `() => null`, **0** with `() => NaN`. A consumer draping on a partial DEM — the exact use case the option was added for — lost every building outside it.

The fix is in the widget's adapter, not in `layers.ts`: the widget owns the public contract and must translate to the mesh primitive's, so a non-finite sample falls back to the datum before it is handed on. The RECORDED probe is the fallen-back value too, which fixes the side effect the review found alongside it — `syncGround` compared `groundAt(...) !== p.ground`, and a probe recorded as NaN is never equal to itself, so such a layer rebuilt on every ground-change event for the life of the map.

### The heatmap was a second, undocumented ground route

`createHeatmapTerrainReader` swept the first mounted `raster` layer's PROVIDER on its own and read the tiles with its own `elevationAt`. It therefore honoured neither `GlyphMapOptions.groundElevation` (a caller-supplied source is documented to win everywhere — a heatmap sat on the datum on a map that had one and no raster layer) nor the `raster` layer's own elevation WINDOW (over a floored sea its relief hugged the unclamped seabed). The option's doc names the `contour` as the ONE structural exception; this was a second one and was not named.

It now reads the shared source. Its own mosaic survives as the LAST resort only, and earns that: it loads inside the heatmap runtime's own `update()`, so it can answer during the window in which the raster layer's sweep has not mounted the tile yet, where the shared reader would honestly say "nothing here" and the relief would drop to the datum.

### Verified, not fixed here

The review's last P3 — a datum ocean over a floored terrain with mismatched densities leaving about 180 base cells painted by BOTH `<pre>`s — was not re-measured and is not fixed. The mechanism it names is glyphcss's per-id-map-cell cross-layer ownership verdict (`computeOcclusionIds`, `packages/glyphcss/src/render/rasterize.ts`), which this package does not own; and the review's own finding is that nothing reads as a hole, because both surfaces paint the sea. It is recorded here so the next reader of the ownership code knows it is open.

## `map.idle()`: the completion signal the widget never had, and why the sleeps had to go

Three `@glyphcss/maps` tests timed out in CI three runs in a row —
`widget.test.ts`'s z0..z4 LOD ladder at 5,495 ms and 6,084 ms, the ocean-sheet
render at 6,020 ms and 7,584 ms, and the b3 high-latitude sweep at 32,949 ms
against its own 30,000 ms budget — while all three passed locally in 1.7-2.9 s.
Nothing about them was wrong. Reproduced on an 18-core machine by throttling to
one worker with `CI=true` and 200 busy-loop processes, the committed versions
fail identically (6,026 / 5,375 / 45,360 ms), and both failed CI runs' log
timestamps put every failure inside the same ~40 s window: `pnpm -r` runs four
packages' vitest at pnpm's default `--workspace-concurrency` of 4, each of those
takes `cpus - 1` forks, and a 4-vCPU hosted runner was therefore carrying 12
forks plus 4 main processes plus a happy-dom apiece. Vitest's `BaseSequencer`
orders files largest-first when there is no results cache, which a fresh
checkout never has, so this package's two biggest integration files started at
the contention peak every single run. After the window maps ran alone for 74 s
and passed everything else.

**Three fixes, in the order their leverage runs.**

**The runner.** `NPM_CONFIG_WORKSPACE_CONCURRENCY: 1` on CI's test step —
one package's vitest at a time. It is the layer that owns the cause: vitest
cannot see across package boundaries, so no `maxWorkers`, `pool` or
`--no-file-parallelism` in any package's config addresses cross-package
oversubscription (and `--no-file-parallelism` alone costs 134 s locally, ~9x,
for the contention it *can* see). The env var rather than a flag because the
flag would have to go inside the root `test` script — itself a recursive pnpm
invocation — and would serialize an 18-core developer machine for nothing. The
alternative priced against it was a separate `maps` job, which costs ~0 wall
because runners are parallel; it lost because this workflow must run
`build:packages` before tests (the compile package's parity test executes the
real built CLI), so a second job duplicates checkout, install and that build,
and buys a wall-clock saving inside a step that runs ~150 s against a 15-minute
timeout.

**A budget floor.** `testTimeout`/`hookTimeout` 30 s in
`packages/maps/vitest.config.ts`. 83 of this package's 125 files are `widget.*`
integration tests and account for 118.5 s of its 120.4 s cumulative test time;
their cost is real CPU work over real-shaped pyramids, and a hosted runner is
2-2.5x slower per thread before any contention. vitest's 5 s default left under
2x headroom on a 2 s test. Tests whose cost is genuinely large still declare
their own budget inline with a line naming the work — that is the number a
reader should see; the floor only stops the next `widget.sky` / `mesh` /
`widget.contourElevation`-shaped test from being the next report.

**The signal.** `map.idle()`.

### Why a settle helper was the wrong layer

The first attempt at this added a test-only `settleTiles(traffic)`: wrap a
provider's `loadTile`, count starts and completions, and resolve once nothing is
in flight and nothing has started for 220 ms (one debounce window plus a
margin). It read as principled and it is not. Its own docstring conceded the
premise — *"the sweep has no completion signal of its own"* — and then inferred
one from silence in a single provider's traffic:

- **It has a 220 ms floor per call**, so its docstring's "returns as soon as the
  widget is finished" is false. With a synchronous provider the whole sweep
  completes inside the microtask queue before any timer fires and it still waits
  the window. Measured on the ladder test under load it saved ~0 ms (2,362 ms
  against the sleeping version's 2,122 at 51 burners; 3,420 against 3,390 at
  105).
- **A stall straddling the debounce deadline is a false settle, deterministically.**
  Node runs expired timers in expiry order, so if the loop is blocked from
  before +180 ms to after +220 ms — a synchronous 65k-polygon `scene.rerender()`
  inside the sweep, a GC pause, a descheduled fork — a poll due at +17x runs
  first, sees a quiet window with nothing in flight, and returns before the
  sweep it was meant to observe has started. A model of exactly that rule gave
  0/100 false settles unloaded and **20/20** with one 150 ms synchronous stall.
- **It sees one provider.** A second raster/contour/vector provider, a
  cache-only sweep that calls no `loadTile`, and the motion loop (happy-dom
  polyfills `requestAnimationFrame` onto `setImmediate`, so a flight re-arms the
  debounce every frame) are all invisible to it.
- **It could not be spread** to the other ~25 sleeping files without carrying
  all of that, and the sleeps it would replace are 40, 60, 80, 150, 220, 250,
  300 and 600 ms against a 180 ms debounce with no principle relating any number
  to any wait. The disease is *a number standing in for a signal*, and the
  helper keeps the number.

It shipped, and CI's next run failed not on a timeout but on a real assertion —
`expected +0 to be 1` at the ladder's `expect(Math.max(...loadedZ))`, i.e. the
predicted false settle, asserting on a frame whose sweep had not run. The same
defect surviving a round means the previous fix aimed at the wrong layer. The
layer that owns "am I finished" is the widget, which already keeps every piece
of the answer.

### The contract

`idle()` resolves once `widgetBusy()` is false, polled by yielding a whole
event-loop turn (a `setTimeout(…, 0)` runs in the timers phase and lets the
check phase — where the rAF polyfill lives — and every resolved fetch's
microtasks run before the predicate is asked again). The yield carries no
duration of its own, so there is no window a unit of work can start and finish
inside of and be missed. Five clauses:

| Clause | What it catches |
|---|---|
| `tileUpdateTimer !== null` | A sweep is ARMED and has not run. This is what makes `setView(); await idle()` wait through the 180 ms debounce *and* the sweep it issues, instead of answering about the frame the previous view left. |
| `pendingUpdates > 0` | A dispatched layer sweep is running. Every `runtime.update()` in `widget.ts` is `void`-ed; `trackUpdate` counts the promises at the dispatch sites. One counter covers all three runtimes' in-flight guards without reaching inside them, because each runtime's own promise already spans its queued re-entry (`updateProvider`'s `finally` AWAITS the re-entrant call). |
| `groundChangeQueued` | A tile set changed and the registry that re-plants extrusions, markers and contour sweeps onto it has not run. `removeLayer` of a raster is the one public path that arms real async work from a synchronous call with nothing else outstanding — every other caller notifies from inside a sweep, where `pendingUpdates` covers the chain anyway. |
| `motionActive()` | An inertial glide, a `flyTo`, a `setProjection` blend, a held walk key, or an unrendered input-handler change. The only signal where there is no rAF at all (SSR, bare jsdom) and `motionStep` runs synchronously. |
| `motionRafId !== null` | A frame already SCHEDULED whose render is still owed. It outlives the state that armed it: `cancelCameraGlide` clears the flight and the glide and leaves the frame queued. |

It deliberately does **not** time out. A widget that never goes quiet is a real
hang; reporting it as a settle is the same lie a fixed sleep tells, and the
test's own budget is where a hang should surface. A destroyed map resolves
immediately.

It is public API, not a harness: every map library ships one
(`map.once("idle")`, `loaded()`), and the consumers that need it here are the
same ones a test is — an export, a screenshot, anything reading
`scene.output.textContent` after a mutation.

**Gated clause by clause.** `widget.idle.test.ts` holds one test per clause,
each red when its clause is deleted, plus `widget.oceanDrape.test.ts`'s
re-plant test for `pendingUpdates`. The two motion clauses are gated as a
pair — a `flyTo` sets both, and each alone is sufficient for that case; the
table above names the case each covers that the other does not. Mutating
`idle()` to resolve immediately reproduces CI's own failure verbatim
(`AssertionError: expected +0 to be 1` at `widget.test.ts:1228`).

### The rule that replaces the sleeps

Stated in `AGENTS.md`'s "Tests & build": **settle on the component's own idle
signal, never on the wall clock.** A `setTimeout` in a test body is legitimate
only when the duration is the quantity under test — a paced loader, the sun
tick, a mid-transition probe — and a stability poll ("the same frame three times
in a row") is the same guess wearing a coat. `vi.waitFor` takes an explicit
`{ timeout }`; its 1,000 ms default is not sized for a runner several times
slower than a laptop.

Converted here: `widget.test.ts` (the ladder, the b3 sweep, the density-raise
LOD test, the post-`fitBounds` render), `widget.oceanDrape.test.ts` (its whole
`render()` helper), `widget.contourFreshLoad.test.ts` (an 800 ms sleep loop, now
378 ms for the file), `widget.markerDrape.test.ts` (a frame-stability poll of up
to 4 s, now 567 ms), `widget.contourElevation.test.ts`, `widget.osm.test.ts` and
`widget.tiltedTileCulling.test.ts`. `tileSettle.harness.ts` is deleted — two
settle mechanisms is one too many, and the one with the unsound contract is the
one that goes.

The constrained reproduction then turned up the next class, which `idle()` does
not cover because these tests are not waiting for a settle at all: five probes
that sample a MOVING camera at a wall-clock instant — `flyTo`'s mid-arc bow, its
"genuinely in flight" and shorter-arc checks, its interrupt hand-over, and
`setProjection`'s J4/J5. A flight's progress is a function of real time, so
"180 ms into a 400 ms flight" is a race a loaded machine wins: at 105
background CPU processes the sleep landed after the flight had finished and the
bow was gone, and at ~210 it took the J4/J5 pair with it. Each is now a
condition on the widget's own frames instead — `trackFlight` collects the whole
trajectory off the `"move"` event stream, so "the bow rises above both
endpoints" reads `Math.max(...spans)` over the path rather than one sample of
it, and the shorter-arc check now holds for EVERY frame instead of one. **Where
an interrupt happens is the discriminator, so the interrupt points are poses,
not instants**: the divergence a re-derived `from` framing produces grows with
how far the blend has come, so a hand-over near t=0 catches nothing. Both
interrupt tests advance to 45% of a MEASURED destination (J4 reads the
destination pose off an identical map taken there instantly; the flight reads
its own target longitude) and then assert the premise — that the first
transition has not settled — rather than hoping for it. Verified against the
same mutations the wall-clock versions caught, at the same magnitudes: the
re-derived `fromFraming` shows as a 31.8-degree rotX snap (39.1 at HEAD), a
flight re-derived from the previous flight's origin as 32.2, and removing the
bow term reddens the bow test.

Unfinished: 45 `widget.*` files still contain a `setTimeout`
(some legitimately) and 69 of 83 `vi.waitFor` calls still ride the default.

### Considered and not taken: a `slow` vitest project

The ~10 real-fixture rendering tests (`widget.strokeDrape`, `widget.reliefWindow`,
`widget.fillDrape`, `widget.walkStrokePlacement`, the multi-tier pyramid tests)
are rendering-regression gates, not unit tests, and a `test.projects` split with
its own 60 s budget would let the fast half finish in ~30 s of CI wall. It is
not taken here because it does not act on this failure: the split's value is
wall-clock shape, and serializing the packages already removed the contention
that made the budget thin, while the 30 s floor already gives those tests a
budget matching their nature. Taking both at once would also make it impossible
to say which one made CI green. It stays on the table as a wall-clock
optimization once this is proven quiet.

## Touch gestures: the two-finger vocabulary, and telling its three members apart

The reported gap was blunt and correct: "there is something missing for
mobile, we don't have the gestures like pinching or moving two fingers away to
zoom in / zoom out. also the two fingers moving together in one direction
should change the tilt and bearing, right? lets do exactly what google maps
does". A phone has no wheel, no Ctrl key and no second mouse button, so every
gesture this widget had shipped up to here — the wheel zoom, the Ctrl/right
drag that owns both pitch and heading — was unreachable from a touch device.
What a touch reader actually had was ONE gesture, drag to pan, and no way at
all to zoom, turn or pitch a map that has spent this entire design document
acquiring a pitch and a heading.

### Google publishes the vocabulary and none of the numbers

The instruction was "exactly what Google Maps does", so the first job was to
establish what that is rather than to reconstruct it from memory. Google's
Maps SDK for Android documents the SET, in its own words:

| Gesture | Google's wording |
|---|---|
| pan | "scroll (pan) around the map by dragging the map with their finger" |
| zoom | "two finger pinch/stretch" |
| zoom in | "Double tap to increase the zoom level by 1" |
| zoom out | "Two finger tap to decrease the zoom level by 1" |
| one-handed zoom | "double tapping but not releasing on the second tap, and then sliding the finger up to zoom out, or down to zoom in" |
| tilt | "placing two fingers on the map and moving them down or up together to increase or decrease the tilt angle" |
| rotate | "placing two fingers on the map and applying a rotate motion" |

The iOS SDK says the same in fewer words. **What Google publishes nowhere is a
single threshold, rate or arbitration rule** — not in the Android SDK docs,
not in the iOS ones, not in the Maps JavaScript API's `gestureHandling`
documentation, and the Maps SDK does not expose its own gesture detector's
constants either. There is therefore nothing of Google's to copy for the part
that decides how a gesture FEELS.

MapLibre GL JS is: it is open source, it is the library this file has already
taken `GLYPH_MAP_TILT_DRAG_DEG_PER_PX` (0.5) and
`GLYPH_MAP_BEARING_DRAG_DEG_PER_PX` (0.8) from, and its numbers are the ones
that survived contact with Google's on the same hardware. Every threshold
below is read out of `src/ui/handler/two_fingers_touch.ts`,
`tap_recognizer.ts`, `tap_drag_zoom.ts` and `handler_manager.ts`, not
recalled.

One place the two sources genuinely disagree, and it is worth recording
because the disagreement is in WRITING rather than in behaviour: Google's
Android doc says two fingers moving DOWN increase the tilt. MapLibre GL JS
(`degreesPerPixelMoved = -0.5`, applied to the average finger y-delta),
MapLibre Native Android (`pitch -= 0.1 * deltaPixels`) and the Google Maps app
itself all raise the pitch on an UPWARD drag; Google's iOS doc declines to say
which. This widget follows UP, on two grounds: it is what the products do, and
it is what this widget's own Ctrl+drag stroke has always done, so a reader who
learns the pitch with a mouse does not have to unlearn it with a thumb.

### The hard part is that "two fingers are moving" describes all three

Pinch, twist and two-finger pitch are the same physical event — two contact
points changing position — and they differ only in WHICH component of the
finger pair's motion is the intent. A finger pair has exactly four degrees of
freedom: translation (2), scale (1), rotation (1). Pan, pinch and twist ARE
those components; the pitch is a re-reading of the translation component as
something else entirely. Nobody's hand isolates one of them: a pinch always
turns a few degrees, a twist always spreads a few percent, and a two-finger
drag always does both. So a naive implementation that simply applies all the
components every frame produces the failure the reader would have reported
next — every tilt drifts the bearing, every pinch turns the map.

The resolution has two halves, and both are taken from MapLibre's arbitration
(`handler_manager.ts`'s `allowed` lists) rather than invented:

**1. Pan, pinch and twist COMPOSE.** MapLibre's `touchPan`, `touchZoom` and
`touchRotate` each list the other two as allowed-while-active. That is the
right answer because they are the three components of ONE similarity
transform, and a reader zooming into a corner while straightening the map is
making a single movement. Each gets its own ACTIVATION threshold, so a gesture
that is purely one of them moves only that one; past its threshold each rides
the same state write.

**2. The pitch is EXCLUSIVE, and it is decided ONCE.** MapLibre's `touchPitch`
has no allowed list at all, and its recogniser latches: `gestureBeginsVertically`
returns `this._valid` immediately once it has ever been set, so a gesture ruled
not-a-pitch can never become one however vertical it turns later. MapLibre
Native Android reaches the same shape from the other direction, with explicit
`shoveScaleSet` / `shoveRotateSet` mutual-exclusion sets. Nothing weaker would
do: a pitch that left pinch and twist live would zoom and turn the map on
every stroke, for the reason above.

### The four tests a two-finger drag must pass to be a pitch

MapLibre's, adopted verbatim, with this widget's constant names:

1. **The fingers landed SIDE BY SIDE.** `isVertical(points[0].sub(points[1]))`
   in MapLibre; `sideBySide` here, evaluated once at the second `pointerdown`.
   With the fingers STACKED, "both fingers moved down" and "the fingers
   closed" are literally the same pixels — a pitch is not distinguishable from
   a pinch at that grip — so the pitch is refused for the whole stroke rather
   than guessed at.
2. **Both fingers have travelled at least
   `GLYPH_MAP_TOUCH_TILT_THRESHOLD_PX` (2).** Not an activation distance —
   a recognised pitch moves the camera from its very next pixel — but the
   distance below which a finger's DIRECTION is noise.
3. **Each finger's travel is more vertical than horizontal, and both the same
   way.** `isVertical(vectorA) && isVertical(vectorB) && isSameDirection`.
4. **Neither finger is allowed to lead for longer than
   `GLYPH_MAP_TOUCH_SINGLE_TOUCH_GRACE_MS` (100).** This is the clause that
   is easy to leave out and impossible to do without. Two fingers never move
   at the same instant, so the start of every honest two-finger drag has a
   window in which one has travelled and the other has not — and one finger
   moving alone is also the exact signature of a pinch or a twist. Inside the
   grace window the gesture stays UNDECIDED and moves nothing; past it, a
   still-lonely finger means pinch/twist after all.

   The first version of this checked the elapsed time only on the branch
   where ONE finger had moved, so once both had, the window was not consulted
   at all — and whether both had moved by the time the recogniser ran depended
   on whether an unrelated event happened to arrive during the wait. A finger
   that led by 250ms then classified as a pitch. It is now stated on the
   evidence directly: `firstMoveAtA` and `firstMoveAtB` are stamped from the
   RAW event (ahead of the coherence gate below, which would otherwise have
   swallowed the lead — the pair arrives complete and the lead is gone), and
   the pitch needs `|firstMoveAtA - firstMoveAtB| < grace`. Same constant,
   same window, now unconditional.

### The two thresholds are a RATIO and an ARC, and neither is a pixel count

`GLYPH_MAP_TOUCH_ZOOM_THRESHOLD_LEVELS` is `0.1` ZOOM LEVELS of
`|log2(distance / startDistance)|` — a 7.2% change in finger separation. It is
expressed as a ratio because a pinch held 400px apart and one held 80px apart
are the same gesture, and a fixed pixel threshold would make the narrow grip
hair-trigger. It is what keeps a TWIST from zooming: rotating two fingers
about their midpoint holds their distance constant, so it never trips.

`GLYPH_MAP_TOUCH_ROTATE_THRESHOLD_PX` is `25` PIXELS OF ARC along the circle
the fingers describe — the mirror of the same argument. A given ANGLE is a far
longer and more deliberate movement at a wide grip than at a narrow one, so a
fixed angle would be unreachable close in and hair-trigger far apart. The
angle it stands for is `25 / (pi * minDistance) * 360`: 28.6 degrees at a
100px grip, 14.3 at 200px, 7.2 at 400px. It is measured against the SMALLEST
spacing seen so far in the gesture, because a pinch closes and the threshold
must not get easier as it does. It is what keeps a PINCH from turning the map:
closing two fingers along their own line changes no angle at all.

Neither threshold is protecting against a PERFECT gesture — a perfect pinch
changes no angle and a perfect twist changes no distance, so the geometry
already protects those. They exist for the imperfect one, and the gates say so
explicitly: `widget.touchGestures.test.ts` drives a pinch with 8 degrees of
incidental turn (a realistically sloppy hand, inside the 23.9-degree threshold
of the narrowest grip in that stroke) and asserts the bearing does not move at
all, and a twist with 5% of incidental spread and asserts the span does not.
Mutate either threshold away and exactly those two go red while the
perfect-gesture tests stay green — which is the whole reason they are in the
file.

### Nothing is measured from an INCOHERENT pair — one rule, the whole gesture

This is the one place the implementation is not simply MapLibre's, and it is
forced by Pointer Events rather than chosen. MapLibre's handlers read
`TouchEvent.touches`, so every event carries BOTH fingers' current positions
and a "finger pair" is always a real simultaneous sample. A Pointer Event
carries exactly one pointer, so a pair assembled after any single event holds
one live position and one stale one.

Using such a pair as the reference configuration leaves the gesture owing a
fraction of a finger's travel — and the zoom that follows then MAGNIFIES it.
Measured on the anchoring gate before the fix: a synthetic pinch whose fingers
alternate by 10px left a 5px reference error, which grew to 5.38px at 1.08x,
6.15px at 1.23x and 6.92px at 1.38x — exactly `5 * magnification`, which is
what identified it. It is not drift in the ordinary sense (each individual
increment is exact, and the whole stroke telescopes correctly), it is one
wrong starting configuration being scaled up.

The first fix covered RECOGNITION only: any event that entered the recogniser
undecided advanced the last-event baselines and returned, the resolving event
included. From there every increment is a true similarity between two real
configurations, and the composition `E_n o ... o E_1` telescopes to exactly the
transform the fingers describe — which is why every rate assertion in the gate
file is a TWO-PHASE stroke that arms the gesture, reads the state, and only
then makes the movement it measures. The cost is one event of travel, and it is
the same event the threshold was already spending.

**That fix was incomplete, and the half it left out was worse than the half it
covered.** Recognition was fixed; the RESOLVED gesture still read a mixed pair
on every event. That does not merely blur an increment, it invents motion that
is not there: two fingers 80px apart sliding 8px THE SAME WAY read as 72px
apart for exactly one event, and `|log2(72/80)|` is 0.152 — past the 0.1 zoom
threshold. So a pure two-finger PAN activates the pinch.

The spurious zoom out and the matching zoom back in telescope to nothing —
UNTIL something refuses one of them, and `clampViewToCover` at the maximum span
refuses exactly the first. Measured on a globe at span 360, fingers at
`(520,504)`/`(600,504)`, moved 8px right one finger at a time: the separation
never changes and the span settles at **324°**, which is `360 * 72/80` to the
digit. A constant-distance twist from 20° to 70° delivered the same way (the
half-turned pair is `240 * cos 25°` = 217.5px apart, 0.142 levels) settled at
**326.27°**.

The rule is therefore ONE rule for the whole gesture, not two patches:

> A pair is measured only once every finger has reported since the last
> measured sample — or once the grace window says a silent finger is genuinely
> AT REST rather than late.

`sampledA`/`sampledB` record who has spoken since the last measured sample and
`pendingSince` opens the round; an event that does not complete the round
updates `touchPoints` and the raw `firstMoveAt*` stamps and returns. The
"at rest" clause is not defensive: a finger held still on glass emits no
`pointermove` at all, so a pair that waited for both fingers unconditionally
would run an ANCHORED pinch — thumb still, index sliding — at one increment
per grace window. After a whole window of silence the quiet finger is marked
`resting` and the gesture stops waiting for it until it speaks again, which
costs one event of latency when the roles swap and nothing otherwise.

The same rule subsumes the pitch's own grace clause (test 4 above): both are
"do not classify from state you should not be reading". They are one
mechanism with one constant.

### The span is an ABSOLUTE function of the grip, not a product of factors

The coherence rule removes the ACCIDENTAL zoom, but the mechanism it exposed —
a clamp that swallows one increment and honours its inverse — is real for a
genuine gesture too. `span *= lastDist / dist` per event banks whatever the
clamp refuses: at the maximum span, finger jitter that crosses the (already
armed) zoom is clamped away on the outward half and applied on the inward one,
so the span walks down and never back. Measured: a grip wobbling 150↔160px at
span 360 ends at **337.5°**.

The span is now `zoomBaseSpan * zoomBaseDist / dist`, measured from the grip
that CROSSED the threshold (so the threshold's own travel is still spent on
recognition and never replayed as a jump). Nothing can be banked, because
nothing accumulates: put the fingers back at `zoomBaseDist` and the span is
`zoomBaseSpan` again, to the bit. The rate assertions are unchanged, because a
telescoping product and an absolute ratio agree exactly wherever nothing
clamps — which is every one of them.

### The pinch is anchored, and one re-pin does all three components

"Anchored on the midpoint" is not decoration: zooming about the view centre —
what `applyWheel` does, correctly, for a wheel that has no anchor to offer —
slides the ground out from under a hand that is holding it. Google anchors
both the zoom and the rotation on the pinch centre, and so does MapLibre
(`pinchAround`).

`applyTouchTransform(spanFactor, bearingDelta, fromX, fromY, toX, toY)` is the
single write, and its contract is one sentence: multiply the span, turn the
heading, and leave the ground that was under `(fromX, fromY)` under
`(toX, toY)`. Expressing it as ONE re-pin rather than as three separately
anchored operations is both simpler and exact, because the span change, the
heading change and the fingers' own translation all move the anchor on screen
and correcting once for where it ended up covers all three. The rotation then
turns about the pinch centre for free, without a second rotation-about-a-point
implementation.

Everything inside it goes through the existing setters —
`clampViewToCover` + `syncCameraToView` for the span, `applyBearingState` for
the heading, `applyDragState` for the pan — so the cover clamp, the bearing
normalization, the orbit branch's non-canonical-preimage bookkeeping and the
`emitViewChange` contract all apply exactly as they do to a mouse. The repaint
is `markMotionDirty()`: the one motion loop, never a second render path, and
never a scene write from an input handler (the rule "The frame budget"
above exists for).

The re-pin ITERATES, and the iteration is a SECANT one — which it was not at
first, and the difference is the whole of whether it converges.

`applyDragState` turns pixels into degrees through a linearization
(`degPerPx = 1 / camera.zoom`) that is exact only in the limit — fine for a
pinch's few-pixel increments, not fine for a double-tap's whole zoom level
taken in the corner of the grid. The first version fed the raw residual back
and called that a contraction. It is one on a SHEET, where a pixel is a pixel
everywhere. It is not one on a globe: that gain is the VIEW CENTRE's, the
anchor is not at the view centre, and a degree of `rotY` is a degree of ground
only on the equator — at latitude 80 the same pixel ask moves the anchor about
`1 / cos 80` = 5.8x too far. Feeding the residual back then OVERSHOOTS by
4.8x, the loop's "stopped improving" bail fires on the very next pass, and the
gesture stops with the ground nowhere near the finger.

Measured on a 1120x1008 host, globe, span 12, double-tap at `(300,200)` — the
ground originally under the tap ends up:

| view | drift, raw residual, 3 passes | raw residual, 8 passes | secant, 8 passes |
|---|---|---|---|
| lat 46, tilt 0 | 10.9 px | < 1 px | 0.0011 px |
| lat 80, tilt 0 | 178.0 px | 93.1 px | 0.0022 px |
| lat 0, tilt 60 | 63.8 px | 3.4 px | 0.000003 px |

The middle column is the point: **three passes were never the problem, the step
size was.** More passes fix the mildly wrong gain and cannot fix the divergent
one.

Each pass now measures what the LAST ask actually bought and divides the next
one by it. Per screen axis, not as a scalar, because `bearingDragDelta` has
already brought the pixels back onto the navigation frame, which leaves the
Jacobian diagonally dominant. `GLYPH_MAP_TOUCH_ANCHOR_PASSES` (8) is a ceiling
rather than a cost: it converges to `GLYPH_MAP_TOUCH_ANCHOR_STOP_PX` (0.005) in
four or five and exits. The stop is chosen for the PINCH rather than for a lone
tap, because a pinch spends one re-pin per event and the slack accumulates —
end to end on a globe (150px to 400px, anchored in the grid's corner, 24
anchored transforms) the ground finishes **0.76px** away at a `0.1` stop and
**0.0002px** away at `0.005`, for the same four passes per event either way.
Tightening it to `0.001` buys nothing visible and costs a pass.

The end of the loop is now "the last ask bought nothing", which is what a cover
clamp REFUSING the pan actually looks like from in here — the old
non-improving-residual test was a proxy for it that also fired on a healthy
overshoot.

### ...and where no local model converges at all, the loop keeps its best point

The secant fixes the gain. It does not make every view solvable, and it must
not be allowed to pretend otherwise. A double-tap in the CORNER of a globe
centred at latitude 88 unprojects to a point 119 degrees of longitude away —
near the pole a screen corner is most of a hemisphere — and doubling the zoom
throws it to `(-480, -444)`, hundreds of pixels off a 1120x1008 grid. Bringing
it back is not a correction, it is a journey across a pole, and the iteration
simply wanders: with the raw residual, and with the secant, and (checked)
whatever the pass count.

So the loop now **cannot end worse than the best point it found**. Every ask is
accumulated since the last improvement and the sum is undone at the end. In the
orbit branch that is EXACT — `camera.rotX`/`rotY` are additive in the ask and
`degPerPx` is constant for the whole loop, since nothing inside it touches
`camera.zoom` — so the negated sum restores the pose bit for bit. The last
iteration only MEASURES, spending no budget, so the step taken with the final
pass is judged like every other rather than accepted unseen.

Swept across 147 globe views (latitudes 0/30/60/80/88 x tilts 0/40/75 x spans
0.5/12/120/359 x four tap points, dropping taps that unproject to nothing):

| | over 0.005 px | worst |
|---|---|---|
| fixed gain, 3 passes | 81 of 147 | 574.6 px |
| secant, 8 passes, best-point guard | 6 of 147 | 548.5 px |

All six remaining are at latitude 60 and above with the tap far off centre, and
every one of the six is closer than the old loop left it at the same view
(277.1→27.1, 447.3→20.1, 268.0→187.3, 574.6→548.5, 282.1→280.9, 306.3→274.2).
Twelve views the old loop happened to nail exactly now finish 1.4e-5 to 1.2e-3
px out, which is the stop threshold declining to spend a pass on a
six-hundredth of a character cell.

`applyDragState` also gained a `dx === 0 && dy === 0` early return (both of its
branches re-derive `view.center` by round-tripping the camera, exact only to
float noise, so a zero-delta event — the first `pointermove` after a hand-over
resumes from exactly where the surviving finger already is — used to nudge the
centre for nothing) and now measures `projectionGrid()` only in the SHEET
branch, which is the only one that uses it: it reads two
`getBoundingClientRect`s, and the re-pin calls it several times per event.

The anchor gates cover the GLOBE, at latitude 46, at latitude 80 and under a
60-degree pitch, for both the double-tap and the pinch. They did not before —
they exercised sheets only, which is exactly why the orbit branch shipped with
178px of drift.

The origin the client coordinates are measured from is `touchOrigin()`, which
walks the SAME fallback ladder `projectionGrid()` itself walks — the output
`<pre>` when it has been laid out, the host otherwise — because the two have
to agree or the pinch anchors on a point the reader is not touching.

### Taps

A double-tap is one zoom level IN about the tapped point and a two-finger tap
one level OUT about the point between the fingers, which is Google's own
binding in Google's own words. The tolerances are MapLibre's `TapRecognizer`:
`MAX_TAP_INTERVAL` 500ms between the taps, `MAX_TOUCH_TIME` 500ms for one
press, `MAX_DIST` 30px both for how far a tap may travel and for how far apart
the two taps may land.

Both are applied OUTRIGHT rather than eased, which is where this departs from
MapLibre's 300ms `easeTo` — for the reason `applyWheel` already gives about
the wheel: an eased `view.span` makes `getView().span` disagree with the
gesture the caller just made and feeds tile LOD a span the reader never asked
for. Smoothness in this widget comes from frame coalescing, not from lag.

A double-tap still emits a `click`, as does the first tap, which is what
MapLibre does too — a double-tap on a marker should also select it. A
two-finger gesture emits none: the moment a second finger lands, the first
finger's press stops being a map click and stops being able to fling.

### The one-handed zoom was INCLUDED, and why

Google's double-tap-hold-drag is the one gesture on the list it would have
been defensible to leave out, so the reason to keep it is worth stating: it is
the only zoom on the list that a reader holding a phone in one hand can
perform, and that is most readers most of the time. It cost one more
`gestureMode` and no new machinery — the double-tap recogniser already had to
exist for the zoom-in, and the drag is the same `applyTouchTransform` anchored
on the tap point.

`GLYPH_MAP_TAP_DRAG_ZOOM_LEVELS_PER_PX` is MapLibre's `1/128` — 128px of
travel is one doubling — and the SIGN is the one place Google and MapLibre
agree explicitly: dragging DOWN zooms IN. That reads backwards written down
and is right in the hand, because a thumb on the phone it is holding reaches
down comfortably and up awkwardly, so the common direction gets the
comfortable half.

It differs from MapLibre in one detail: MapLibre enters the drag-zoom on the
first `touchmove` with no movement threshold at all, so a double-tap whose
second tap wobbles by a pixel becomes a 1/128-level drag instead of a zoom.
This enters on the widget's own existing 3px `didDrag` click tolerance, so a
wobbling tap is still the double-tap the reader meant; 3px is 0.023 of a zoom
level, which nobody can see.

### No new `controls` flag: the three that exist are CAPABILITIES

The obvious fourth flag — `controls.touch` — was considered and not added.
`drag`, `wheel` and `tilt` are already named for capabilities rather than for
devices (the `tilt` flag's own doc says so: ONE flag covers both axes of the
orient stroke "because it is one press"), and every touch gesture here IS one
of those three capabilities arriving through a different device:

- `wheel` is the ZOOM capability — wheel notches, the pinch, both tap zooms,
  and the one-handed drag-zoom.
- `tilt` is the ORIENT capability — the Ctrl/right-drag stroke's two axes, the
  two-finger pitch, and the twist.
- `drag` is the PAN capability — a one-finger drag, the two-finger pan, and
  (because an anchored zoom moves the centre) the pinch's anchoring. With
  `drag: false` a pinch still zooms, about the CENTRE, which is the only thing
  "the centre is pinned" can mean.

A `controls.touch` on top of those would be a second gate on every gesture
answering a question no caller has asked; a caller who wants a fully inert map
sets the three it already has. The nearest real use case — a map inside a
scrolling article that must not swallow a one-finger drag — is
`controls.drag`, plus the `touch-action` note below, and would not be served
by a flag that also killed the pinch.

### `touch-action: none`, which is not optional — but IS conditional

Without it there are no touch gestures at all. A browser hands a touch to the
page's own scrolling and pinch-zoom first and merely REPORTS it to script;
until the element declares that it consumes them, the pointer events for a pan
or a pinch are cancelled the moment the browser claims the gesture.
`createGlyphMap` now sets `host.style.touchAction = "none"` and restores the
caller's own inline value on `destroy()` — which is exactly what glyphcss's
own `createGlyphOrbitControls` / `createGlyphMapControls` / `createGlyphFirstPersonControls`
do, for exactly this reason. `/maps` already had the equivalent rule in
`maps-workbench.css`; every other consumer used to need it and now does not.

It is set only when the widget has a gesture to claim. With
`controls: { drag: false, wheel: false, tilt: false }` there is no touch
gesture left, and claiming the page's touches anyway makes an inert map a HOLE
in the page: a swipe that starts over it scrolls nothing. That is precisely the
case the `controls` section above names as the nearest real use for
`controls.drag` — a map inside a scrolling article — so declaring consumption
of gestures the widget then refuses would have defeated it. One condition, on
the same three capability flags; anything less than all three off still sets
it, because any one of them still consumes touches.

### An interrupted gesture cleans up; it never navigates

`pointercancel` used to share `onPointerUp` outright, on the reasoning that a
pointer that goes away is a pointer that went up. It is not: the browser has
TAKEN the pointer — a system edge gesture, a palm rejection, a lost capture —
and the reader completed nothing. Sharing the release handler meant a
cancelled press could still be RECOGNISED, and both recognisers fired:

- two stationary fingers plus a `pointercancel` on either of them inside the
  tap window read as a two-finger tap and zoomed the map out a level
  (measured, span 12 to 24);
- a cancelled single press stamped `lastTapAt`, arming a double-tap that the
  next genuine press then completed.

`onPointerCancel` is now its own handler. It drops the contact, releases the
capture, clears `doubleTapArmed` and `lastTapAt`, ends a pair WITHOUT
`endTwoFinger`'s tap recognition, emits no `click` and starts no glide. It
still hands the stroke back to a finger still on the glass, because that
finger is real and did not go anywhere.

### A third contact is ignored, and must not strand the fingers that are not

Every gesture here is defined on exactly two fingers, so a third is ignored
rather than re-forming the pair under the reader's hand. Ignoring it turned out
to be harder than not: the hand-over to a surviving finger lived at the END OF
THE PAIR (`endTwoFinger`), and with a third contact down, "the pair ended" and
"one finger is left" are different moments. Pinch with A and B, add C, lift A:
the pair ends with TWO fingers still down, so there is nobody to hand to and
`activePointerId` is cleared. Lift C and B is alone on the glass — pressed,
and driving nothing. The reader had to lift and touch down again.

`handBackToLoneFinger` is therefore called from every release that takes the
count to one: from `endTwoFinger`, from the ordinary touch release, and from
`onPointerCancel`. The condition is a state, not an event.

### `drag: false` pins the centre; it does not remove a zoom

`onPointerDown` returned early under `controls: { drag: false }` before it
established `activePointerId` — correctly for a pan, wrongly for the
double-tap-drag, which is steered by exactly that pointer. So the one-handed
zoom silently collapsed: the drag moved nothing, and the release then applied
the DISCRETE double-tap zoom, a whole level for a stroke the reader was still
making. That contradicts the section above: the one-handed drag-zoom is listed
under `wheel`, the ZOOM capability, and `drag: false` is not supposed to touch
it.

The press is now established when it is the armed second tap of a double-tap,
whatever `drag` says. It carries `tapZoomOnlyPointer`, which suppresses the map
`click` on release — so a `drag: false` map emits exactly the clicks it emitted
before (none from touch), rather than gaining one only on second taps.

### Walk mode is not reachable from a touch device, and the guard says so

Entering walk needs Pointer Lock (which iOS Safari does not ship) and a
keyboard, so `mapsWalk.ts` already refuses it on touch. The two-finger
recogniser refuses independently: `beginTwoFinger` returns immediately while
`walk` is non-null, so a walker's single-finger LOOK drag is untouched and
`view.span` — which DESCRIBES the horizon there rather than framing it — is
never handed a pinch. That is a guard rather than an assumption, which is the
same distinction the rest of this widget's capability checks draw.

### The interleaving is also why the page's drag-density had to change

`/maps` drives `interactiveDownscale` itself, from a generic `pointerdown` /
`pointermove` / `pointerup` triple, and it held the press as a BOOLEAN. Every
two-finger gesture is two pointers, and the first finger to leave one of them
is not the end of the gesture: the boolean settled back to full detail
mid-pinch and — because the surviving finger's moves then found `pointerDown`
already false — never went coarse again for the rest of the stroke, so the
heaviest gesture on the page ran at full density from that moment on. It is a
`Set` of pointer ids now, and the downscale lifts when the LAST finger leaves.

### Gate

`widget.touchGestures.test.ts`, 48 cases. Six mutation checks were run against
the original 31, each restored from a `cp` backup afterwards:

| Mutation | Went red |
|---|---|
| pitch mode no longer exclusive (`tilt` branch dropped) | 4 |
| `isSameDirection` clause forced true | 6 |
| rotate arc threshold removed | 3 |
| pinch ratio threshold removed | 3 |
| the anchor re-pin skipped | 2 |
| `sideBySide` forced true | 1 |

Thirteen more were run against the seventeen cases added for the review
findings above, same protocol:

| Mutation | Went red |
|---|---|
| coherence gate disabled (`if (false)`) | 2 (pan 324°, twist 326.27°) |
| `together` forced true | 1 (pitch 20° instead of 10°) |
| span back to `lastDist / dist` | 2 (ratchet 337.5°; anchored pinch 4.73 vs 5.09) |
| `resting` marking removed | 1 (anchored pinch stops at the arm, span 12) |
| secant gain removed (`dx` for `dx / gainX`) | 2 (lat 80: 93.1px; tilt 60: 3.4px) |
| best-point undo removed | 1 (lat 88, tilt 75: 723.9px against 274.2px) |
| `pointercancel` back on `onPointerUp` | 2 (span 24; two clicks) |
| `touch-action` unconditional | 1 |
| the second `handBackToLoneFinger` call site removed | 1 |
| `drag: false` early return restored | 1 (one whole level, not 0.5) |
| the double-tap TIMEOUT comparison deleted | 1 (span 6 instead of 12) |
| `!g.moved` deleted from the two-finger tap | 1 (span 24) |
| the `dx === 0 && dy === 0` guard removed | 1 |

**Two of those exist because the tests they belong to were BLIND.**

The double-tap timeout case stamped its first tap at `performance.now() === 0`,
and `lastTapAt` doubles as the "a tap is pending" flag (`lastTapAt > 0`) — so
the second tap was unrecognisable whatever the interval was, and the timeout
the case is named for was never consulted. Deleting the comparison left it
green. Stamped `1000 -> 1550` instead, the mutation prints span 6.

"A two-finger gesture that MOVED is not a two-finger tap" drove a two-finger
PITCH, which the tap recogniser already refuses on `g.mode !== "undecided"`, so
`!g.moved` — the clause it is named for — could be deleted with the case still
green. The guard's real subject is a gesture that travels far while staying
UNDECIDED, which only one finger moving inside the grace window produces: the
added case drags one finger 40px with the other still, and mutating `!g.moved`
away zooms it out a level.

Every other case in the file was checked for the same defect — a premise
satisfied by an unrelated guard — by reading which clause each one would have
to reach; the two above were the only ones that could not reach theirs.

## Live data: `setLayerSource`, and why the clock is not in this package

Every layer here was static once mounted. `addLayer` captures a source and
there was no way to hand a runtime a new one, so a dataset that REFRESHES
could only be expressed as `removeLayer` + `addLayer`. That is wrong twice
over: it loses the layer's place in `layerOrder`, and for a `symbol`/`circle`
layer it destroys and re-creates every hotspot `<div>` on every refresh — the
`+4298 -4298` churn `widget.symbolRebuildFlash.test.ts` exists to prevent, on
a timer.

### One primitive, and it is idle-neutral

`setLayerSource(id, source)` is the whole package-side surface. It is valid
for every vector-source layer (`line`, `fill`, `fill-extrusion`, `symbol`,
`circle`, `heatmap`) and throws a `RangeError` naming the id for anything
else: `raster` and `contour` read a FIELD, `background` has no source, and a
`model` is a polygon list.

Mechanically it is three steps. The runtime's held source is replaced and its
`lastInputs` identity skip cleared (a new source's features are a genuinely
different input and must not take the skip that stops an unchanged tile set
from rebuilding); its tile cache is cleared with it, since the cache is keyed
by `z/x_y` alone and would otherwise serve one provider's tiles for another's
addresses; and the stored options object is replaced too, so `getAttributions()`
and every later read see the new source.

`createFeatureLayerRuntime.update()` now captures `source` ONCE at the top of
a sweep. It awaits, and the binding is replaceable, so reading it after the
await would let a sweep that started on one source finish on another —
fetching for the second and rebuilding from the first. `setSource` clears
`lastInputs` and the caller dispatches a fresh `update()`, so the older
sweep's result is simply superseded.

**It is idle-neutral, and that is the design constraint, not a side effect.**
The dispatch goes through the same `trackUpdate` counter `addLayer`'s does, so
`setLayerSource(id, next); await idle()` resolves once the new features are on
screen and `map.idle()` keeps its exact meaning.

A `refreshMs` on the LAYER was considered and rejected, because there is no
third option:

- **Counted in `widgetBusy()`**, `idle()` never resolves. A map that refreshes
  forever is never idle, literally. Every test that awaits it hangs, so does
  the bench harness, so does any consumer awaiting quiescence for an export.
- **Excluded**, the widget holds a timer that `idle()` deliberately does not
  report. That is a rule with no other instance in the file: all five of
  `widgetBusy()`'s clauses are state the widget sets synchronously before the
  work begins, and each is gated by a test that reddens when removed.

There is a second, independent reason. `refreshMs` would force the widget to
own an abort, an error channel, a backoff, a `document.hidden` gate and a
per-service rate-limit policy it has no vocabulary for. The repo already
decided this once: `website/src/components/MapsWorkbench/mapsGeocode.ts` puts
a live HTTP call, its usage policy and its vendored fixtures in the website
and keeps this package pure. `mapsLiveRefresh.ts` follows it exactly.

### The marker reconcile

A refresh cannot take the `featuresAreTheWholeInput` skip — the features
really did change — so without a reconcile a live layer reintroduces exactly
the churn and the opacity flash that skip was built to remove.

So `createPointFeatureRuntime` RECONCILES whenever the incoming features carry
unique `id`s: survivors move through `handle.setAt` (the same call `syncGround`
already uses, for the same reason), departures are removed, arrivals take the
identical creation path including the `opacity: 0` that keeps a label from
ever being painted before the arbiter has ruled, and `sync()` runs once at the
end. A multipoint feature's markers key as `id#index`. Ids absent, empty or
non-unique fall back to the pre-existing wholesale rebuild — a duplicate key
would silently make two markers fight over one element, which is worse than
the churn it saves — so a baked pyramid that never refreshes is unaffected
either way.

Measured on the real `/maps` page at 384 markers (built site, `astro preview`,
1440x900), timing `setLayerSource` + `idle()` with a `MutationObserver` on
`.glyph-hotspot-layer`:

| path | node churn | ms |
|---|---|---|
| reconcile (keyed ids) | **+0 / −0** | 5.7 – 8.4 |
| rebuild (no ids) | +384 / −384 | 6.8 – 9.8 |
| `removeLayer` + `addLayer` | +384 / −384 | 14.8 – 15.8 |

A full live refresh of that row — fetch, 272 KB JSON parse, reconcile and
render — is 2.1 – 2.5 ms, and every one of the 384 marker elements survives it
by reference. The satellite row, which re-propagates 157 objects every second,
is +0 / −0 and issues zero network requests per tick.

One latent defect was fixed on the way: `placementTransform` persisted across
rebuilds while `sync` writes the transform only when the STRING changes, so a
marker created after a placement had already been resolved would never receive
it and would sit centred among correctly-offset neighbours. A fresh marker now
takes the resolved transform at creation.

`destroy()` also disposes `feature`-kind runtimes, which it skipped entirely —
a map torn down with point or mesh layers still mounted leaked every hotspot
handle, both registry entries, and the mesh handles.

### What the four live rows are, and what they cost

The rows themselves are entirely in the website (`mapsLive.ts`,
`mapsLiveSatellites.ts`, `mapsLiveRefresh.ts`), with one real captured
response per feed vendored under `fixtures/live/`. All four are keyless,
openly licensed, and send `Access-Control-Allow-Origin: *` on a GET carrying a
real browser `Origin` — verified, not quoted.

| row | source | payload | cadence |
|---|---|---|---|
| Earthquakes | USGS `2.5_week.geojson` (US Gov, public domain) | ~270 KB, ~385 events | 5 min (12/h) |
| Disasters | GDACS event list (EC JRC / UN OCHA) | ~140 KB, 99 events | 15 min (4/h) |
| Launch sites | Launch Library 2 `upcoming?limit=20&mode=normal` | ~190 KB, 13 distinct pads | hourly (1 of a measured 15/h) |
| Satellites | CelesTrak `GROUP=visual` element sets | ~26 KB, 157 objects | elements ONCE; motion is local SGP4 |

The two quantitative rows have since grown a TIME WINDOW, so the source,
payload and cadence above are each row's DEFAULT one — see "The time window
each row is read at" below for the whole ladder.

Three corrections to the feasibility report the work started from, each
measured:

- **GDACS cyclone TRACKS are real lines, but they are not in the feed.** The
  event list is 99 `Point` features and nothing else; a track lives behind a
  per-event geometry endpoint, and one live cyclone's document is 389 KB for
  48 `LineString`s and 62 polygons. Eighteen live cyclones is ~7 MB across 18
  requests — a fan-out, not a feed. The row is the event list.
- **Launch Library's 23 KB `mode=list` carries no pad at all** — no latitude,
  no longitude, nothing to place a marker with. `mode=normal` is the lightest
  response that does, and it is ~190 KB, most of it per-launch image and
  licence metadata this page never reads. There is no field selection on that
  API.
- **`mode=normal` is SLOW from a browser**: 10.6 s, 28.2 s and once past 25 s
  on three consecutive calls, against 1.3 s to curl and 4.4 s for their own
  `mode=list`. That is what put `MAP_LIVE_TIMEOUT_MS` at 45 s — the first
  browser run of this feature left the row at "loading..." indefinitely, which
  is the one failure a reader cannot tell from a bug.

The rows are `circle` for the three quantitative feeds and `symbol` for
launches, and that split is not a style choice: `circle` runs NO declutter
arbiter (its `sync` culls the far hemisphere and returns), so it draws every
point at every zoom — right for a few hundred sized dots, wrong for a few
hundred names. It is also why 16,560 CelesTrak objects is not a layer and 157
is.

### Failure, and the CORS trap

No fetch here rejects, and a failed refresh calls no `setLayerSource` at all:
the layer keeps the features it last had and the row says why it is not newer.
The card distinguishes STALE (data on screen, last refresh failed) from FAILED
(nothing ever loaded) because they are different sentences — replacing a
count with an error would tell a reader the map had gone blank when it had not.

The trap worth knowing about for any feed: several of these services send
`Access-Control-Allow-Origin` on their 200s and NOT on their error responses,
so a perfectly readable `429` reaches the browser as an opaque `TypeError`
with no status, no `Retry-After` and no message. Nothing in the page can tell
that apart from an outage, and on these services the throttle is the likelier
of the two, so an unexplained failure is reported as PROBABLY rate limiting.
A timeout is reported separately, because that one the page does know.

### The time window each row is read at

Asked for in these words: *"those sets need a filter of recency, like last
hour, today, last week, etc"*. Three decisions carry it.

**A window is a different SOURCE, never a filtered payload.** USGS publish one
summary feed per window and Launch Library take a `net` bound, so a narrower
window is a smaller download rather than a large one with most of it thrown
away. Measured against the live services:

| USGS feed | bytes | events |   | USGS feed | bytes | events |
|---|---|---|---|---|---|---|
| `all_hour` | 11 K | 15 |   | `all_week` | 1.5 M | 2,184 |
| `all_day` | 195 K | 278 |   | `2.5_month` | 1.5 M | 2,225 |
| `2.5_day` | 20 K | 28 |   | `4.5_month` | 440 K | 644 |
| `2.5_week` | 265 K | 380 |   | `1.0_month` | 5.2 M | 7,716 |
| `4.5_week` | 58 K | 85 |   | `all_month` | 7.5 M | 10,988 |

**ONE axis, not two.** USGS cross a magnitude FLOOR (`all`/`1.0`/`2.5`/`4.5`)
with a WINDOW (`hour`/`day`/`week`/`month`), and the control is the window
alone with the floor chosen per window. Two axes is sixteen combinations, and
the table says what is in them: a 7.5 MB / 10,988-event `all_month` at one
corner and an almost always empty `4.5_hour` at the other, with nothing on the
card able to tell a reader which is which. The floor is not a thing a reader of
a MAP wants to pick — it is the PRICE of the window, the only lever that keeps
a month inside half a megabyte — so it belongs to the window, derived. Because
it is hidden it is STATED: every button's tooltip names the floor it carries,
and `mapsLive.windows.test.ts` reddens if one stops. The ladder that falls out
rises in floor exactly as the window widens, and every rung is between 11 KB
and 440 KB:

| row | window | source | payload | cadence |
|---|---|---|---|---|
| Earthquakes | 1h | `all_hour` | 11 KB, 15 events | 5 min |
| | 24h | `all_day` | 195 KB, 278 | 5 min |
| | **7d** (default) | `2.5_week` | 265 KB, 380 | 5 min |
| | 30d | `4.5_month` | 440 KB, 644 | 30 min |
| Launch sites | 24h | `net__lte` +1 d | 15 KB, 2 launches | 30 min |
| | 7d | `net__lte` +7 d | 85 KB, 9 | hourly |
| | 30d | `net__lte` +30 d | 190 KB, 20 of 23 | hourly |
| | **all** (default) | no date bound | 190 KB, 20 | hourly |

**Two of the four rows have no time axis, and get no control.** A control that
cannot change anything is worse than no control, so `windows.length > 1` is the
whole rule the card reads.

- **Disasters (GDACS)** is a list of currently ACTIVE events, not a rolling
  window. The payload does carry dates (`fromdate`, `todate`, `datemodified`),
  so a filter is possible — and measured on the vendored 99-event capture it is
  destructive: not one of those events began in the previous seven days, and
  the median age of a start date is 142 days for an earthquake, 271 for a
  flood, 309 for a tropical cyclone. Every window a reader would pick empties
  the row. That is the mechanical answer; the real one is that filtering an
  ongoing cyclone by when it FORMED hides a live hazard.
- **Satellites (CelesTrak)** is a live position. There is no recency dimension
  at all: the elements are fetched once and propagated locally.

**The cadence follows the window**, on one rule — poll at the publisher's own
regeneration interval unless the payload makes that wasteful. USGS regenerate
every one to five minutes, so five minutes is the floor below which nothing new
can arrive, and three of the four quake windows sit on it because all three are
light and all three genuinely gain events at that scale (one every 4 min, 5 min
and 27 min respectively). The month window is the one where they diverge: 644
events a month is 0.075 per five minutes, so twelve of every thirteen requests
would re-read an unchanged 440 KB file — 5.3 MB an hour to learn nothing.
Half-hourly is 0.45 new events per request and 880 KB an hour. On the launch
side the 24-hour window is the only one finer than hourly: a T-0 inside the next
day slips by minutes, and it is 15 KB against 190 KB, so it spends 2 of the
reader's own measured 15 requests an hour instead of 1.

**Mechanically it is not a second path.** `MapLiveController.setWindow(id,
window)` cancels the pending tick, runs the same `refresh` -> `publish` ->
`update` a scheduled tick runs — so the mounted layer is REPLACED through
`setLayerSource` and the markers reconcile — and re-arms at the new window's own
cadence. A row that is off spends nothing and simply remembers the window; the
window is also the one thing that survives `stop()`'s "switching a row off is a
fresh start" rule, because it is the reader's standing choice rather than state
the row accumulated. The requested window is NORMALIZED through `mapLiveWindow`
before the equality check, so a link naming a window this build does not offer
resolves to the row's own default instead of spending a request to re-fetch the
URL the row was already on.

**On the wire** it is `liveWindows`, token `1` — the SECOND digit this schema
has spent, after `0` took the row bitfield when all 52 letters ran out. A
4-slot `floatTuple` of indices into `MAPS_LIVE_WINDOW_KEYS`, one per row in
`MAPS_LIVE_FEED_KEYS` order, both append-only. A tuple rather than one token per
row for the reason `l` is one: only two rows have a choice, and the other two
always sit at their own index and therefore always equal the default, which is
what keeps the whole token off an ordinary link. Both defaults are the URL the
page fetched before the control existed, so a link shared then still shows what
it showed — `mapsUrlState.liveWindows.test.ts` decodes a verbatim pre-change
link and pins every field of it.

Verified in a real browser (built site, `astro preview`, 1440x900, world view,
one row mounted at a time), each window's own URL answering 200 and the mounted
count following it: **12 / 277 / 381 / 644 quakes** and **2 / 8 / 13 / 13 pads**.
The month and `all` launch windows agree because at 30 days the COUNT bound is
what binds, which is what that button's tooltip says.

One layout consequence, measured rather than guessed: on a 302 px row the four
buttons plus the longest row name ("Launch sites", 82.1 px) and the longest
readout the month window can produce ("644 quakes · 12s", ~106 px) do not all
fit on the shared `38% / auto / 1fr` track. `.maps-live-row--windowed` takes
`28% / auto / 1fr` with a 3 px widget gap and `1px 2px` button padding; at 27%
the name lost its last character to an ellipsis and at 29% the readout wrapped
and made that row 6 px taller than its neighbours. The two rows with no window
keep the original track exactly.

One guard was corrected on the way, in both this control and the OSM card's
label-placement toggle it copies: the `preventDefault` that stops a click on a
button inside the row's `<label>` from activating the row's checkbox has to run
in the CAPTURE phase. React delegates every handler to the root container, so a
bubble-phase `onClick` there does not run until the native event has already
passed the `<label>` — and a DOM that forwards the click (happy-dom does; a
real browser does not, because the spec exempts interactive descendants) reads
`defaultPrevented` at exactly that moment.

satellite.js is pinned to **6.0.2**, the last pure-JS release. Version 7 ships
a WebAssembly accelerator whose Emscripten glue uses top-level await and is
reachable from the package's only entry point, which fails Astro's static
build outright (`Module format "iife" does not support top-level await`); the
deep pure-JS modules are not exported, so there is no way to import past it.

## Stamped point marks: the `glyph` layer

The four live rows landed as `circle`/`symbol` layers — DOM nodes positioned
over the `<pre>` — and the report on seeing them was:

> "lets not use that for the live datasets, lets use glyphs for them :/ also,
> the satellites are super tiny, don't we have also the height at which the
> satellites are orbiting? so we can make them at the right height? and maybe
> we can make them bigger?"

and, on the labels:

> "lets put the label of magnitude + title for the quake /// and lets make the
> size dependant of the magnitude too -- if you click it you open the url in a
> new tab"
>
> "ofc we cannot put labels for all the quakes, if there are too many we will
> need to decide which ones we label, probably depending on magnitude and how
> long has it happened"

### A THIRD point layer, not a mode on the two that exist

`symbol` and `circle` are DOM by CONTRACT rather than by implementation
accident. A `symbol` exists so a reader can select and copy a place name; a
`circle` sizes itself in CSS pixels. Every option either carries has meaning
only in that medium — `textAnchor` resolves to a CSS percentage of a
laid-out box, `radiusScale` to `style.width`, `minPriority` to
`style.opacity` — and none of it survives a translation into cells. A
`mode: "glyph"` flag on them would be a discriminated union hiding inside one
interface, with two disjoint runtimes and two disjoint option sets behind one
name.

What the new layer IS, meanwhile, already existed and is exact: `line` and
`contour` are stamped layers composed into the scene's single `transformCells`
hook, depth-tested per cell against whatever geometry won it, and clipped to
the projection's own horizon. `createGlyphPointLayerRuntime` is structurally
`createLineLayerRuntime` with a point where a polyline was — the same
provider-sweep/static-collection feature loading read live by `stamp()` on
every render, rather than `createFeatureLayerRuntime`'s mount/rebuild cycle,
which exists to manage DOM elements this layer does not have.

The three are complementary and all three stay. The page's other point rows
(places, peaks, POIs, countries, every OSM sublayer) are deliberately
untouched: converting them is a separate decision about a shipped surface.

### The depth test is the stroke's, lifted verbatim

`glyphMapSurfaceOccludes` is `stampGlyphMapPolyline`'s inner loop moved out of
it unchanged — the sampling-offset CORRECTION (evaluate the surface where the
stamp actually is, not at the cell centre `grid.depth` was sampled at) and the
second-difference ALLOWANCE (forgive the terrain's own faceting, never the
camera's foreshortening). A mark planted on the terrain is coplanar with it to
within that terrain's own faceting, exactly as a draped stroke is, and a
second independently-tuned test for the same question would be a second answer
to it.

The test runs PER CELL of a mark, not per mark: a mark large enough to span
several cells can straddle a ridge, and the half behind it must go dark
exactly as a stroke crossing the same ridge does.
`stampGlyphMapPoint` returns the CELL COUNT it inked, and that count is the
visibility answer everything downstream keys on — a mark that inked nothing is
not clickable and gets no label, for free and by construction rather than by a
second visibility rule that could disagree with the picture.

### Size is a glyph, and there is one rule for it

A `circle` expresses magnitude as a CSS pixel radius, which a character grid
cannot draw: the smallest paintable thing is one cell and everything below
that rounds to the same dot. The unit here is a disc radius in CELL ROWS, and
`glyphMapPointCells` is the whole rule — rasterize the disc (columns stretched
by `cellAspect`, or a "circle" on a 2:1 grid renders as a vertical ellipse),
then pick each cell's glyph by HOW MUCH OF THAT CELL THE DISC COVERS out of an
ordered ramp of increasing ink.

That is the solid rasterizer's own rule (glyphcss picks a cell's glyph from a
`CharRamp` by intensity) applied to a disc instead of to a Lambert term, and
it is what makes ONE expression serve both halves of "bigger": under one cell
the disc grows by climbing the ramp, past one cell it grows by covering more
cells, with the partially-covered rim automatically landing on the smaller
ramp entries. No threshold, no second mode. Coverage is measured with 16
sub-samples per cell (`GLYPH_MAP_POINT_COVERAGE_SAMPLES`), which is about how
finely the ANSWER is quantized rather than how exact the integral is: with a
3-entry ramp the boundaries sit at 1/3 and 2/3 and 16 samples resolve those to
+/-1/16 of a cell's area.

`GLYPH_MAP_POINT_RAMP` is `. dot bullet` — U+00B7, U+2022, U+25CF. Three
properties decided it, in order: they are the SAME SHAPE at three sizes (a
ramp of `.` `+` `*` `#` also increases in ink but reads as four different
marks a reader has to learn the order of); they are CENTRED in the cell (a
full stop sits on the baseline, so a ramp starting at `.` puts the smallest
mark visibly below its own feature); and all three are in `GLYPH_FONT_ATLAS`
AND in ordinary system monospace stacks. The ramp stops at U+25CF rather than
reaching for U+2B24 (BLACK LARGE CIRCLE) for the second half of that: U+2B24
is in the atlas but missing from most monospace fonts, where it renders as
tofu at a non-monospace advance and tears the grid.

`size: 0` — the default — is exactly ONE cell carrying the ramp's largest
glyph, and it is the rule an IDENTITY mark takes. That is not a degenerate
case but the answer to a measured problem: across 100 sub-cell placements, a
multi-cell disc with a core-and-halo ramp (`. . . star` at radius 0.55-0.7
rows) draws ZERO cores 5-36% of the time and TWO cores 11-62% of the time,
i.e. it loses the star or doubles the satellite depending on where the object
happens to land. A disc rasterizer cannot express "one bright core plus a
halo"; a one-cell mark can.

`GLYPH_MAP_POINT_MAX_SIZE_ROWS` (8) is a blast radius, not a design limit:
`size` comes from a feature's own property, and a source shipping a population
column where a magnitude was expected would otherwise walk a viewport-sized
bounding box per feature.

### Altitude is TRUE METRES, and the limb needed no new code

`altitudeProperty x altitudeScale` is a height above the ground in true
metres, converted with `glyphMapTrueScaleElevation` exactly as a
`fill-extrusion`'s height is, and measured FROM the exaggerated relief the
drape puts under the mark — the same split that paragraph already argues for.
At `/maps`' default `exaggeration: 24` the exempt answer puts a 550 km orbit
at 8.6% of a radius and the un-exempt one at 207%, two Earth radii past the
far side of the planet.

The limb falls out of what is already there. `glyphMapGlobe.visible` grew a
raised-point test for `fill-extrusion` walls — a point behind the centre plane
is visible exactly when it lies outside the sphere's silhouette CYLINDER,
which is the ship's-mast-before-the-hull effect — and a satellite is that same
question at a much larger height. Measured through the real renderer at
`span: 150` centred on `[0, 0]`: an object at 550 km and lon 100 draws ink
BEYOND the datum's own silhouette column (nothing on the surface can reach
those columns), and one at lon 175 draws nothing at all. The horizon reaches
`acos(R / (R + h))` = 23.1 degrees past the datum's 90, so visibility ends
around 113 degrees from the sub-observer point, and both sides of that are
gated.

**An earthquake's depth is NOT an altitude.** USGS ships it in km, positive
downward, and the vendored week reaches 608 km. Fed to `altitudeProperty` with
a negative scale it is stamped inside the planet and blanked by the surface
the reader can see — rendered, not argued: `widget.glyphPoint.test.ts` mounts
exactly that and counts zero cells for the deep event beside a surface control
that draws. The epicentre is where a map says an earthquake is, and the depth
stays a property.

### Labels: folded to ASCII, and rationed by score

A stamped label is characters IN the render, which brings a constraint a DOM
label never had. `/maps` renders with `colorEncoding: "atlas"`, and glyphcss
latches the WHOLE SCENE back to the span encoder for any frame containing a
glyph the 212-glyph colour font does not carry. Real place names carry exactly
such glyphs: measured on the vendored USGS week, 385 titles contain `i` and
`e` and `a` with diacritics, `u`, `o`, and a right single quote — 25
characters in all, none in the atlas, and ONE of them anywhere on screen costs
the entire map its zero-span rendering. It was observed in a real browser
before it was reasoned about: the page's own `<pre>` reported
`font-family: monospace` with the live rows on, and `GlyphCssAtlas` with them
off.

`glyphMapAsciiLabel` folds a label to printable ASCII (NFD decomposition with
combining marks stripped, plus a substitution table for what has no
decomposition — stroked letters, ligatures, typographic punctuation). It is
applied UNCONDITIONALLY rather than only when the scene is on the atlas,
because nothing can know: the encoder a frame lands on is decided by that
frame's own glyphs, i.e. after this text is already in the grid. Given a
stripped diacritic against a scene-wide silent downgrade, the diacritic goes.
A label that folds to empty (a wholly non-Latin script) draws nothing, which
is the honest answer — this atlas cannot write those scripts and a row of
substitution boxes would be worse than a name the reader looks up elsewhere.

The RATIONING is `priorityProperty` through the same greedy
`glyphMapDeclutterLabels` a `symbol` uses, in the stamped grid's own cells. A
SCORE and not a threshold: the arbiter drops a label only when it actually
collides with a higher-ranked one, so the set thins smoothly as the view zooms
out instead of switching on at some scale, and the MARKS are never rationed —
every quake is drawn at its own magnitude whether or not it keeps its name.

`/maps`' own score (`mapLiveQuakeLabelScore`, in the website) is
`mag + 1.5 * exp(-ageHours / 12)`. Magnitude is the UNIT and needs no scaling:
the Richter scale is already logarithmic in energy, which is what every
seismological map draws. Recency is a DECAY rather than a linear age, because
the difference between an hour ago and two hours ago is enormous and the
difference between five days and six is nothing; a 12-hour constant leaves 61%
of the bonus after 6 h, 37% after 12 h, 14% after a day and nothing after
three, against a rolling seven-day window.

`1.5` is a statement a reader can check — a quake minutes old outranks one up
to 1.5 magnitudes larger from earlier in the week, and nothing under M4 can
outrank a M5.5 however fresh. Measured on the vendored week (385 events,
M2.46-M5.6, the top of the list): at `1.5` it is the two events of the last
two hours (M5.4 southern East Pacific Rise, 1.8 h; M5.3 Lospalos, 1.4 h) and
then the week's M5.5s and M5.6s, with a fresh M4.8 (Cliza, 8 h) and M5.0
(Quepos, 11.7 h) among them. At `2.0` an M4.1 from two hours ago outranks
every M5.5 on the planet, which is the wrong trade; at `1.0` recency barely
reorders anything and the score is magnitude with extra steps.

Showing recency on the DOT as well was considered and not built — the user
asked for it on the labels, the mark's one visual channel is already spent on
magnitude, and a second encoding on the same mark is its own decision.

### Selection is a hit test, not an element

A glyph is not a node and cannot receive a click, and the fix must not be "put
a `<div>` back", which is the thing being removed. The stamp RETAINS each
drawn mark's scene cell (`GlyphMapPointHit`), and `onPointerUp` matches a
click's own cell against that list. One handler for a whole layer instead of
one element per point, no second projection, no second visibility rule, and no
second declutter: a mark that was not drawn left no record.

Four details carry it:

- **It rides the existing `!didDrag` branch**, the same guard the widget's own
  `click` event uses (set past 3 px of travel, and by the touch path too), so
  a pan that happens to end over a mark opens nothing. Reusing that branch
  rather than adding a second one is what makes the two answers unable to
  disagree.
- **The threshold is in CELLS**, not pixels — `GLYPH_MAP_POINT_HIT_CELLS` = 2
  cell ROWS, with columns divided by `cellAspect` so the target is round on
  screen rather than round in cells. A pixel threshold would shrink to nothing
  on a dense grid and swallow half a continent on a coarse one, and this
  widget changes its own grid resolution mid-gesture
  (`interactiveDownscale`). At `/maps`' 140x63 on 1440x900 a cell is about
  10 x 14 px, so two rows either side is a 40 x 56 px box — just past the
  44 px both Apple's and Google's guidelines ask for. A mark's own `size` is
  added on top, so a large mark is selectable across its whole disc.
- **The widget resolves WHICH feature and nothing else.** What a click MEANS
  belongs to the consumer; a library calling `window.open` itself would be
  choosing a navigation policy for every page that mounts it. The page's own
  `mapLiveOpenFeature` passes `noopener,noreferrer` (without it the opened
  third-party document gets a live handle on this one) and CHECKS THE SCHEME
  — `url` came out of a network payload, and `window.open("javascript:...")`
  executes in this origin.
- **A row with nothing to open is inert, and that is read off the DATA.** Only
  the USGS feed ships a `url`; `featuresCarryUrls` decides, so it is a
  property of what arrived rather than a `case "quakes":`. No `onSelect` means
  no hit test and no cursor — a mark that opens nothing must not advertise
  that it would.

The HOVER affordance is the one place there was no alternative to a
per-pointermove test: the whole map is a single element, so there is no
`:hover` rule to write and no per-feature node to hang `cursor: pointer` on.
It runs only while a layer declares `onSelect`, only while no button is down,
reads the list the last render already built, and writes `style.cursor` only
on a real change.

### What the four rows became, and what it looks like

Verified in a real headed browser against the vendored captures (routed
through Playwright, so no network), at 1440x900 on the page's own 140x63 grid:

| Row | Mark | Size |
|---|---|---|
| quakes | the default disc ramp | `mag * 0.2` rows (M2.46-M5.6 -> 0.49-1.12) |
| disasters | a ring ramp | `alertRank * 0.25` rows |
| launches | one `▲` | `0` (one cell) |
| satellites | one `★` | `0` (one cell) |

At a WORLD view (span 140 centred on the Pacific): 136 quake cells, 71
disaster-ring cells, 55 satellite stars standing clear of the globe's own
limb, one launch pad, and 25 label lines — the week's notable quakes and the
last few hours' named along the Indonesian and Melanesian arcs, the rest drawn
but unnamed. At a REGIONAL view (span 20 over Japan): 33 quake cells, 6 rings,
one star, 3 label lines. `<pre>` `font-family` is `GlyphCssAtlas` at both, and
`document.querySelectorAll(".glyph-map-circle")` and `.glyph-hotspot` are both
EMPTY — which is the whole report answered.

A satellite went from a 4 px CSS circle (about 11% of a cell's drawn area) to
a full-cell `★` — roughly seven times the area and 2.6x linear at this page's
cell — and from invisible at a world view to legible at one.

### Gates

- `point.test.ts` — the disc-to-cells rule (one cell at `size: 0`, the ramp
  climb, the footprint growth and its aspect, monotonicity, the cap, the
  coverage floor), the depth test including the per-cell straddle and the
  cross-`<pre>` skip, and the ASCII fold.
- `widget.glyphPoint.test.ts` — no DOM node and a changed `<pre>`;
  byte-identical on removal; size varies with magnitude at TWO views and the
  large mark is genuinely multi-cell; hidden behind terrain (with the
  negative control that the clear mark still draws) and round the limb; the
  altitude exemption against the exaggerated candidate AND the ground; the
  mast-before-the-hull pair; the buried negative altitude; `onSelect` on a
  click, not on a drag, not in open space, and inert without it; the cursor;
  and the label arbitration.
- `mapsLive.test.ts` — every row is a `glyph` layer, every mark glyph and
  every folded label is in `GLYPH_FONT_ATLAS`, `onSelect` is armed only where
  the data carries urls, the scheme check, and the score's two bounds plus
  what it actually selects on the vendored week.

Mutation-checked: removing `glyphMapTrueScaleElevation` from the elevation
reddens 2 clauses (the satellite lands 14.2 columns off and the mast pair
draws nothing); disabling `glyphMapSurfaceOccludes` in the point stamp reddens
4 across both files; disabling `nearSideVisible` reddens the two limb clauses;
and returning the label unfolded reddens the atlas gate with the 25 real
characters listed.
