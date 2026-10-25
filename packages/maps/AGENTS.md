# @glyphcss/maps agent guide

`createGlyphMap` and geodata. Browser-safe; fs in `./node`, never `gdal-async`. No React/Vue API.

Docs: `README.md`, `website/src/content/docs/maps/**`.

## Invariants

- Public API uses lat/lng/degrees; views are aspect-locked. Camera pivots on drawn ground at `view.center` (planting sampler/window; datum fallback); `project`/`unproject`, pan lattices and transition targets share it. Mounts re-anchor before rendering, view unchanged.
- Branch on capability (`visible`, `cameraForCenter`, `tileRange`), never on `projection.id` or a provider id.
- Crop, don't clamp: `project()` is `NaN` outside its window, except `raster` elevation windows (clamp per vertex).
- `project` is the one elevation conversion. Ground is exaggerated; structure heights, altitudes, eye height and lifts are TRUE metres via `glyphMapTrueScaleElevation`.
- Planting: `groundElevation`, else mounted raster tiles, else datum. NW–SE tile triangles clamp per vertex. Still water is level (lowest shore, ≥ datum); rivers max(terrain, datum). `null` is datum; `contour` is exempt.
- Relief resolution is per pyramid LEVEL, never per tile. Non-target tiers are sunk by `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M`.
- Scene writes precede `scene.rerender()`; no scene writes from input handlers; one motion loop/render per frame.
- Never bake a camera verdict into a mesh; wall/sliver culls run per frame on the mesh's own polygons (`Polygon.hidden`, stable identity).
- `waterTerrain`: atomic coverage/fill; outside DEM dry ground/classification >=0. Indexed shores; convex merges; floor/colour backstops. No cutout lift. Tile-identity cache, 2 ms cancellable prep; removal restores DEM.
- Extrusion outlines: planted edges, `.`, <2-cell cutoff; frozen depth, unbiased planes, immutable numeric topology, exact replay. `fill:false`: no mesh. `blank:true`: integer-depth mask before edges in all grids; keeps holes/nearer cells. DOM overlays.
- `box` depth-tests against the pre-layer surface, never its own ink. Closed extents <2 cells become one centroid dot; open stubs never do. Paths join accepted cells (gaps split paths), collapse backtracks, add depth-tested corners only on their own path or unowned cells; unjoined remnants drop.
- `compositorPan`: opt-in ¼-grid overscan, fixed cells; translate scene/hide hotspots. Settle on release/rest/pose/layout changes; refresh at 80% margin/2° orbit. Rebase on render; public grid unchanged; no walk.
- `prerender.ts` jobs do a render's camera-only half (stroke plans, outline samples) at a snapshot pose in slices: at rest and from ~37% of margin. A re-anchor is validated against live, renders AT the prepared pose, then translates; else one live render. Plans reuse only on an equal key (incl. `filterAtResolution`), one per slot (`anchor`/`rest`/`settle`/`landing`); walk/`groundElevation` never plan.
- Glide: per-frame Euler stepping is FROZEN (`widget.glideTrajectory` vs base fixtures). Its end is predicted by simulating it at the cadence seen (3 frames in), prepared as `settle` + `landing`; `snapPan` lattice makes keys hit, else the live path runs. A settle consumes `settle`; the next drag `landing`.
- Landings (`renderContent`) own every scheduled scene render until the motion frame; it renders once. A sweep starts one layer per task and its landings render once (re-anchor waits).
- Extrusion tile arrival/ground move: mesh + outline topology built sliced (`sliceBuild`), installed whole; a topology compiled ahead is adopted only for identical mesh/outline arrays.
- `snapPan`: opt-in cell lattice at fixed lens/tilt/bearing/grid; exact held view. Orbit: tangent lattice. Zoom/tilt reset; walk bypasses. Dither stays screen-anchored.
- Line `sharedArcs: true` deduplicates exact polygon boundary edges into junction-pinned arcs once per feature set/tile, before live VW; explicit lines stay separate. Reversed edges share geometry; no snapping or noding of differently sampled edges.
- Stamp surface reconstruction starts at the rasterizer’s integer cell sample and interpolates forward, never from an assumed half-cell centre.
- Line `simplify: "vw"`: latitude-corrected VW at half a live cell, eight quarter-octave buckets per line/arc, before clipping/draping; keeps endpoints and collapsed rings. Walk keeps detail. Omitted is byte-identical.
- Walk mode keys on "walk is active" and the local horizon (`nearSideVisible`), never on a widened projection capability.
- `symbol` label box = arbiter box: anchors, offsets and wraps go through the shared tables.
- OMT line styling/hierarchy are opt-in. Hierarchy uses live grid degrees/cell (walk keeps all); palettes fall back to row colour.
- `/maps` URL row lists are positional: append rows, never insert.
- Live data: `setLayerSource`, no clock.
- A sweep whose filtered features are unchanged (filters rerun) renders nothing; a groundless `fill` ignores the view.
- Tests await `map.idle()`, never timers/polls. Probe camera poses; give `vi.waitFor` explicit timeouts.

## Don't

- Never bias stroke/contour/point depth: forgive only curvature plus projected elevation rise. Pitch slopes flat ground in depth; slope slack draws through buildings.
- Don't write a drape lift or bias on the exaggerated axis (10 m was 240 true metres at 24x). Measure rise and chord sag; the constant is a 1 true-metre tie-break.
- Don't plant on a feature attribute (`ele`, `min_height`): the drawn surface is the terrain sample; `min_height` is a true-metre offset above it.
- Ocean DEM is seabed, not surface: drape `ocean` at datum; lakes keep the terrain drape.
- Opaque `density`/`renderMode`/`glyphPalette`/`ambientIntensity` splits cost a whole-scene id raster (~+10 ms); each stroke density adds an overlay grid.
- Camera-following meshes (walk sky): rebuild polygons past a distance threshold.
- Don't use `projection.visible` or `view.span / cols` under the walk camera: points use `nearSideVisible`, tiles the horizon BOX, LOD the finest level (span-keyed LOD drops buildings on a phone).
- Don't let a tile batch's `Promise.all` reject: resolve a failed tile as missing (a rejection blanked layers forever). The raster sweep still has this gap.
- Don't rebuild point layers on an unchanged sweep, create labels visible then hide them (CSS transitions flash), or move one by remove+add. Compare tile identity, create at `opacity: 0`, move with `setAt`.
- Shadows: never default `lift` (0.05 = 318 km) or terrain casting (256 texels across Earth); a headlight key casts none.
- Don't widen a positional URL tuple (`M`, `J`, `l`, `1`) or insert into a row list: a tuple's width is wire format. Add a new token, appended last.
- Read OSM schemas from vendored tiles: `water_name` are lines, flags `0`/`1` or present-`true`, rank 1 most important.
- Don't lerp `camera.zoom` or clamp on landing in a projection transition: schedule apparent size log-linearly, clamp to the destination up front, assign endpoints verbatim.
- Per-cell `unproject` tests stub the metrics prototype (existing `<pre>`s miss the 8x16-fallback probe).
- Don't swap the glide's Euler stepping for a closed form: its positions and duration depend on frame cadence, and that feel is fixed.
- Test occlusion in both road directions with a ground source (west-east without one skips draping).

## Key gates (`src/`)

- Tiles: `chirality`, `parity`, `widget.backstopOcclusion`, `mesh.seaLevelBand`, `mesh.surfaceMedian`, `widget.reliefSurfaceBand`, `mesh.elevationWindow`, `widget.reliefWindow*`
- Loop: `widget.motion`, `widget.prerender`, `widget.glideTrajectory`, `widget.sweepSplit`, `widget.compositorPan`, `widget.idle`, `widget.liveSource`
- Walk: `widget.walk*`, `walkCollision`, `widget.sky`
- Strokes: `stroke`, `widget.stroke*`, `widget.contour*`
- Fills: `widget.fill*`, `widget.oceanDrape`, `layers.extrusion*`, `widget.extrusionGround`, `widget.osmBuildings`
