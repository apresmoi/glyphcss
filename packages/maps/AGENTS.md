# @glyphcss/maps agent guide

Geographic data → glyphcss: `source → sample → field → classify → bands → compile`, relief meshes, vector layers, and `createGlyphMap` (the interactive widget). Root entry is pure and browser-safe; `@glyphcss/maps/node` holds fs readers (never `gdal-async`). No React/Vue surface.

Docs: `README.md` (package reference), `website/src/content/docs/maps/**` (user docs). Rationale for a specific rule lives in the comment next to its code.

## Invariants

- Public API speaks lat/lng and degrees; `GlyphMapView` is aspect-locked.
- Branch on projection CAPABILITY (`visible`, `cameraForCenter`, `tileRange`), never on `projection.id` or a provider id.
- Crop, don't clamp: `project()` returns `NaN` outside its window. Sole exception: a `raster` elevation window clamps per vertex.
- `project` is the one elevation conversion. Ground is exaggerated; structure heights, altitudes, eye height and lifts are TRUE metres via `glyphMapTrueScaleElevation`.
- Everything planted uses the one ground source (`groundElevation` option, else mounted raster tiles, else the datum). `null` means datum, never a dropped feature. `contour` is the only exception.
- Relief resolution is per pyramid LEVEL, never per tile. Non-target tiers are sunk by `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M`.
- Every scene write goes before that frame's `scene.rerender()`; input handlers never write to the scene; one motion loop, one render per frame.
- Never bake a camera verdict into a mesh; wall/sliver culls run per frame on the mesh's own polygons (`Polygon.hidden`, stable array identity).
- Opt-in features are byte-identical when off, each with a test that goes red.
- Walk mode keys on "walk is active" and the local horizon (`nearSideVisible`), never on a widened projection capability.
- `symbol` label box = arbiter box: anchors, offsets and wraps go through the shared tables.
- `/maps` URL row lists are positional: append rows, never insert.
- No clock or refresh policy in the package; live data goes through `setLayerSource`.
- Tests settle on `await map.idle()`, never timers or stability polls. Moving-camera probes advance frames to a pose. `vi.waitFor` gets an explicit timeout.

## Don't

- Don't forgive stroke/contour/point depth with a flat or slope-scaled bias: forgive only curvature plus ground rise measured in ELEVATION and converted by the projection. Camera depth ramps on flat ground under a pitch, so any depth-unit slack draws roads through low buildings.
- Don't write a drape lift or bias on the exaggerated axis: 10 m there was 240 true metres at 24x and buried every building. Measure rise and chord sag; the constant is a 1 true-metre tie-break.
- Don't plant anything on a feature attribute (`ele`, `min_height` as ground): the drawn surface is the terrain sample; `min_height` is a true-metre offset above it.
- Don't drape the ocean on the DEM: its zero is sea level and below it is seabed, so the sea turns into cliffs. Datum for `ocean` only; lakes keep the drape.
- Don't separate an opaque layer casually (`density`, a differing `renderMode`/`glyphPalette`, `ambientIntensity`): one makes `computeOcclusionIds` raster the whole scene (~+10 ms); each distinct stroke density adds a full overlay grid.
- Don't move a camera-following mesh (the walk sky) with `setTransform`: a transformed mesh rebuilds its cull runs every render. Rebuild world-space polygons past a distance threshold.
- Don't use `projection.visible` or `view.span / cols` under the walk camera: point consumers go through `nearSideVisible`, tiles through the horizon BOX, LOD through the finest level (span-keyed LOD depends on window width and drops buildings on a phone).
- Don't let a tile batch's `Promise.all` reject: resolve a failed tile as missing. One rejection blanked whole layers and a contour forever. The raster sweep still has this gap.
- Don't rebuild point layers on an unchanged sweep, create labels visible then hide them (the consumer's CSS transition flashes every label), or move one by remove+add. Compare tile identity, create at `opacity: 0`, move with `setAt`.
- Don't give glyphcss shadows their default `lift` (0.05 = 318 km on the globe) or let terrain cast (256 texels across the Earth). A headlight key light shows no shadows at all.
- Don't widen a positional URL tuple (`M`, `J`, `l`, `1`) or insert into a row list: a tuple's width is wire format. Add a new token, appended last.
- Don't take an OSM schema's names, flags or ranks from its docs: read the vendored tiles. Lakes' `water_name` are lines, flags come as `0`/`1` or present-`true`, and `rank` counts 1 = most important.
- Don't lerp `camera.zoom` or clamp on landing in a projection transition: schedule apparent size log-linearly, clamp to the destination up front, assign endpoints verbatim.
- Don't trust `stubMonospaceMetrics` when a test reads `unproject` per cell: it stubs existing `<pre>`s only, so glyphcss's probe falls back to 8x16 and the render disagrees with `unproject`. Stub the prototype.
- Don't gate an occlusion test on one road direction or with no ground source: a west-east road with no ground skips the drape path entirely and hid a real defect.
- Known gaps, not tunings: the orbit pivot is the datum (city-span terrain leaves the grid); `getMaxTilt` ignores the orbit base pitch; `temporalBlend` smears at nonzero bearing; stamps never receive shadows; a contour below a floored terrain is buried; single-cell fill loss at the antimeridian.

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
