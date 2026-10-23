# @glyphcss/maps agent guide

Geographic data, relief meshes, vector layers and `createGlyphMap`. Root is browser-safe; `@glyphcss/maps/node` holds fs readers (never `gdal-async`). No React/Vue surface.

Docs: `README.md`, `website/src/content/docs/maps/**`. Local rationale lives in code comments.

## Invariants

- Public API uses lat/lng and degrees; `GlyphMapView` is aspect-locked.
- Branch on projection CAPABILITY (`visible`, `cameraForCenter`, `tileRange`), never on `projection.id` or a provider id.
- Crop, don't clamp: `project()` returns `NaN` outside its window. Sole exception: a `raster` elevation window clamps per vertex.
- `project` is the one elevation conversion. Ground is exaggerated; structure heights, altitudes, eye height and lifts are TRUE metres via `glyphMapTrueScaleElevation`.
- Everything planted shares `groundElevation`, else mounted raster tiles, else datum. Tile sampling follows NW–SE triangles, clamped per vertex. `null` means datum. Only `contour` is exempt.
- Relief resolution is per pyramid LEVEL, never per tile. Non-target tiers are sunk by `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M`.
- Every scene write goes before that frame's `scene.rerender()`; input handlers never write to the scene; one motion loop, one render per frame.
- Never bake a camera verdict into a mesh; wall/sliver culls run per frame on the mesh's own polygons (`Polygon.hidden`, stable array identity).
- Opt-in features are byte-identical when off, each with a failing mutation test.
- Extrusion `outline: "braille"`: retain planted mesh edges; quiet `.` fill first. Freeze depth per grid; test exact building planes, excluding incident faces without bias. Cut off footprints below two live cells.
- `box` depth-tests against the pre-layer surface, never its own ink. Closed extents <2 cells become one geometry-centroid dot; open stubs never become dots. Paths join accepted cells (gaps split paths), collapse backtracks and add depth-tested corners only on their own path or unowned cells; drop unjoined remnants. Other strategies are unchanged.
- `snapPan` is opt-in: camera pans use a cell lattice at fixed lens/tilt/bearing/grid; held views stay exact. Orbit uses a local tangent lattice. Zoom/tilt reset it; walking bypasses it. Renderer dithering stays screen-anchored.
- Line `sharedArcs: true` deduplicates exact polygon boundary edges into junction-pinned arcs once per source feature set/tile, before live VW; explicit line features remain separate. Reversed edges share geometry; no snapping or noding of differently sampled edges. Tile replacements get fresh topology.
- Stamp surface reconstruction starts at the rasterizer’s integer cell sample and interpolates forward, never from an assumed half-cell centre. Depth forgiveness remains curvature plus measured elevation rise.
- Line `simplify: "vw"`: latitude-corrected VW at half a live cell, eight quarter-octave buckets per source line/arc. Simplify before clipping/draping; preserve endpoints and collapsed rings. Walk retains detail. Omitted is byte-identical; no cross-tile topology guarantee.
- Walk mode keys on "walk is active" and the local horizon (`nearSideVisible`), never on a widened projection capability.
- `symbol` label box = arbiter box: anchors, offsets and wraps go through the shared tables.
- OMT line styling/hierarchy are opt-in. Hierarchy uses live grid degrees/cell (walk keeps all); line palettes fall back to row colour. Shared arcs retain explicit line properties.
- `/maps` URL row lists are positional: append rows, never insert.
- No clock or refresh policy in the package; live data goes through `setLayerSource`.
- Tests settle on `await map.idle()`, never timers or stability polls. Moving-camera probes advance frames to a pose. `vi.waitFor` gets an explicit timeout.

## Don't

- Don't bias stroke/contour/point depth: forgive only curvature plus measured elevation rise converted by the projection. Pitch creates depth slopes on flat ground; slope slack draws through low buildings.
- Don't write a drape lift or bias on the exaggerated axis: 10 m there was 240 true metres at 24x and buried every building. Measure rise and chord sag; the constant is a 1 true-metre tie-break.
- Don't plant anything on a feature attribute (`ele`, `min_height` as ground): the drawn surface is the terrain sample; `min_height` is a true-metre offset above it.
- Don't drape the ocean on the DEM: its zero is sea level and below it is seabed, so the sea turns into cliffs. Datum for `ocean` only; lakes keep the drape.
- Opaque `density`/`renderMode`/`glyphPalette`/`ambientIntensity` splits trigger a whole-scene id raster (~+10 ms); each distinct stroke density adds an overlay grid.
- Don't move a camera-following mesh (the walk sky) with `setTransform`: a transformed mesh rebuilds its cull runs every render. Rebuild world-space polygons past a distance threshold.
- Don't use `projection.visible` or `view.span / cols` under the walk camera: point consumers go through `nearSideVisible`, tiles through the horizon BOX, LOD through the finest level (span-keyed LOD depends on window width and drops buildings on a phone).
- Don't let a tile batch's `Promise.all` reject: resolve a failed tile as missing. One rejection blanked whole layers and a contour forever. The raster sweep still has this gap.
- Don't rebuild point layers on an unchanged sweep, create labels visible then hide them (the consumer's CSS transition flashes every label), or move one by remove+add. Compare tile identity, create at `opacity: 0`, move with `setAt`.
- Don't give glyphcss shadows their default `lift` (0.05 = 318 km on the globe) or let terrain cast (256 texels across the Earth). A headlight key light shows no shadows at all.
- Don't widen a positional URL tuple (`M`, `J`, `l`, `1`) or insert into a row list: a tuple's width is wire format. Add a new token, appended last.
- Don't take an OSM schema's names, flags or ranks from its docs: read the vendored tiles. Lakes' `water_name` are lines, flags come as `0`/`1` or present-`true`, and `rank` counts 1 = most important.
- Don't lerp `camera.zoom` or clamp on landing in a projection transition: schedule apparent size log-linearly, clamp to the destination up front, assign endpoints verbatim.
- Stub the metrics prototype for per-cell `unproject` tests: stubbing existing `<pre>`s misses the probe, whose 8x16 fallback disagrees with the render.
- Don't gate an occlusion test on one road direction or with no ground source: a west-east road with no ground skips the drape path entirely and hid a real defect.
- Known gaps: datum orbit pivot; `getMaxTilt` ignores base pitch; `temporalBlend` at nonzero bearing; stamps receive no shadows; contours below floored terrain; antimeridian single-cell fill loss.

## Key gates (`src/`)

- Projection/tiles: `chirality`, `parity`, `widget.backstopOcclusion`, `mesh.seaLevelBand`, `mesh.surfaceMedian`, `widget.reliefSurfaceBand`, `mesh.elevationWindow`, `widget.reliefWindow*`
- Widget loop: `widget.motion`, `widget.extrusionWalls`, `widget.idle`, `widget.symbolRebuildFlash`, `widget.liveSource`
- Camera: `widget.tiltPivot`, `widget.tiltGesture`, `widget.bearing`, `widget.transitionContinuity`, `widget.transitionAnchor`, `widget.touchGestures`
- Lighting: `widget.headlight`, `widget.sun`, `widget.shadow`
- Walk: `widget.walk*`, `walkCollision`, `walk.entryGate`, `widget.sky`
- Strokes/contours: `stroke`, `widget.strokeDrape`, `widget.strokeRelief`, `widget.strokeOcclusion`, `widget.contourElevation`, `widget.contourRelief`, `widget.contourFreshLoad`
- Fills/extrusions: `widget.fillDrape*`, `widget.oceanDrape`, `widget.fillSliver`, `widget.fillCrack`, `layers.extrusionHeight`, `layers.extrusionFloor`, `facade.slenderness`, `widget.extrusionGround`, `widget.osmBuildings`
- Labels/points: `layers`, `widget.symbolWrap`, `widget.symbolAnchor`, `widget.markerDrape`, `point`, `widget.glyphPoint`
- OSM: `vector/openmaptiles`, `vector/protomaps`, `widget.osmFilters`, `widget.featureFilter`
