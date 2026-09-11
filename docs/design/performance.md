# Render-path performance — design notes

> Design notes moved out of `AGENTS.md` (the agent guide keeps the contract and points here).
> Covers: pre-projection cull runs and back-face run rejection, the empty-coverage skip, projection memoization, interactive LOD, and the WebGPU temporal presentation companion.
> Cross-references to "above"/"below" that no longer resolve refer to sibling files in `docs/design/`.

**Pre-projection cull runs.** `RasterizeContextOptions.cullChunks` — an ordered, contiguous list of `GlyphPolygonCullChunk` (a polygon-index run plus its world AABB and fan-triangle count, built by the exported `buildGlyphPolygonCullChunks`) — lets the **solid** rasterizer reject a whole run whose box provably projects entirely off the grid WITHOUT projecting one of its vertices. It is a pure cost reduction: the surviving polygons, their order, and every per-cell decision are identical with or without it, so a render is byte-identical either way. Two rules are load-bearing. (1) **A box not wholly in front of the near plane is always accepted** — behind the eye the projection stops being a projective map, so the 2D hull of the 8 projected corners no longer bounds the run's contents, and glyphcss's own near-plane clipping stays authoritative. Both shipped cameras signal that by projecting such a corner to `NaN` (orthographic has no eye and never does), so the NaN test IS this rule, and that camera contract is pinned by its own test. (2) **Nothing is ever reordered** — a run is skipped or drawn in place — because `depthEpsilon` deliberately resolves coplanar ties by draw order; a skip also advances the positional cross-frame shade-cache index by the run's whole triangle count, exactly as the per-polygon `poly.hidden` skip does. **Runs, not per-mesh boxes:** measured on `/maps`' globe over 12 poses, a whole-mesh AABB rejects only **2.4%** of triangles (every terrain tile is partly on screen) while ~48-polygon runs reject **39.3%**, against a **42.9%** ceiling (what the existing per-triangle *post*-projection off-grid test finds anyway, having already paid for the projection); 90-polygon runs reach 30.5% and 180-polygon 27.8%, which is why `GLYPH_CULL_CHUNK_POLYGONS` is 48 and not a rounder number. `createGlyphScene` builds and caches these per mesh in a `WeakMap` keyed by the TRANSFORMED polygon array identity — a mesh with no position/scale/rotation gets the identical array back from `applyTransform` every render, so a terrain tile's boxes are built once for the life of the mesh — and memoizes the base grid's concatenated list on the ordered identities of its parts. Wireframe/voxel/ink run their own polygon loops and ignore it. Measured on `/maps` (`bench/maps-render`, continuous motion, 140x63, byte-identical output): `base-raster` 11.7 → 9.9 ms/render on a full-globe overview, 9.4 → 3.6 at a zoomed-in wheel sweep, 10.5 → 5.8 on a fly-to arc.

**Pre-projection BACK-FACE run rejection.** The AABB test above is structurally blind to a globe's far hemisphere: a far-side run still projects inside the near side's own disc, so its box is on-grid and it survives to be projected and thrown away one triangle at a time (measured on `/maps` at 2560x1440: **17.3%** of every triangle submitted). Each `GlyphPolygonCullChunk` therefore also carries a bounding **normal cone** — `coneX/Y/Z` (unit axis) plus `coneCos` (the min `normal · axis` over the run's fan triangles, built by the same `buildGlyphPolygonCullChunks`) — and a run whose cone lies entirely in the back-facing half-space is skipped ahead of the AABB test (a handful of multiplies against eight corner projections). **The orientation sign is DERIVED from the camera, never assumed.** When a camera's screen map is affine — `s(v) = M v + t` with rows `r1`, `r2` — the rasterizer's own `area2` is exactly `(r1 x r2) · (u x v)`, i.e. a fixed linear functional `G` of the triangle's world face normal, so back-facing is exactly `G · n > 0`. `deriveFacingGradient` (`render/rasterize.ts`) recovers `G` by EVALUATION, not by algebra over the camera's axis convention, rotation order or handedness: three probe triangles built to have face normals `h²·e_x/e_y/e_z` under the same `u x v` the rasterizer uses are projected through the same `camera.project`, and their `area2` values ARE `G`'s components. Affinity is verified the same way rather than branched on `camera.kind` — the probe is repeated at a second, well-separated base point and a different scale, and the mechanism disables itself unless both agree, so a perspective camera (whose scale varies with depth) simply keeps drawing every run. `glyphChunkIsBackFacing` rejects only when `axis · Ĝ > sin(halfAngle)`, which is the exact condition that EVERY normal in the cone is back-facing; a cone wider than a hemisphere, an unusable cone (`coneCos: -1`, set for any run holding a zero-length or non-finite normal), a `doubleSided` scene, and any run straddling the horizon are all kept. Probes are placed and scaled from the chunks' own union AABB so a scene authored at any world scale is probed at its own scale.

**Empty-coverage skip.** `scanFillTriangle` clamps a triangle's screen bbox to whole cells and returns immediately when that range is empty — no cell CENTRE can lie inside a triangle narrower than the gap between two integers. That same first test is hoisted to the call site, so those triangles never pay the shadow context, the texture context or the 60-argument call. It is the dominant case for any mesh finer than the glyph grid, not an edge one: measured on `/maps` at 2560x1440 (283x105 cells), **145,935 of the 212,373 triangles** surviving the backface and off-grid culls — 68.7% — clamp to an empty box and paint nothing, and the mean cells scanned per surviving call is **0.61**. **The hoist sits BELOW the shading block, and that placement is load-bearing.** `litCache` is keyed on the base colour plus the triangle's key intensity QUANTIZED to 8 bits, but the colour it stores is computed from that triangle's own UNQUANTIZED intensity — so which triangle first populates a bucket decides the colour every later triangle in it receives. Skipping ahead of the shading block changed that arrival order and moved six of the eight `/maps` fidelity waypoints while leaving **0 of 29,715 glyph cells** differing: a colour-only regression a glyph-level diff would have missed entirely. (That order-dependence in `litCache` is real and pre-existing; it is not introduced or fixed here, only respected.)

**The camera's per-vertex projection path is memoized.** `project()` runs once per mesh vertex per render — a quarter of a million times a frame on a terrain scene (measured on `/maps`: 65,312 quads x 4 = 261,248 calls per render) — so `resolveProjectionMetrics` building a fresh result object per call, and `rotateVec3Voxcss` recomputing `Math.cos`/`Math.sin` of two angles that are CONSTANT for the whole render, were 3.7% and 8.0% of the entire script budget in a CPU profile of a continuous globe rotation. Both are now memoized on exact input equality, so a hit returns bit-identical values to a recompute and no arithmetic anywhere changes; `NaN !== NaN` means a NaN angle always misses rather than serving a stale cache.

**Indexed vertex projection.** `rasterizeSolid` shared a projection across the
fan triangles WITHIN a polygon but not BETWEEN adjacent ones, and an
adjacency-heavy mesh is mostly shared edges: measured on the committed ETOPO1
z2 relief tier at the resolution `@glyphcss/maps` mounts, **404,992 vertex
occurrences for 101,761 distinct positions**, i.e. `project()` ran 4.0x more
often than the geometry has corners. `render/vertexIndex.ts` builds a per
polygon-array index — `offsets`/`slots` into a distinct-position table — and the
raster loop projects a position the FIRST time a pass touches it and re-serves
the camera's own returned tuple for every later occurrence. Measured in the real
page (`bench/maps-render`, 140x63, spans, headed, base-raster ms/render, three
interleaved runs each): globe orbit 17.73 -> 16.57 (-6.5%), globe drag 19.17 ->
17.91 (-6.6%), terrain-only street walk 2.68 -> 2.37 (-11.3%). Four things make
it exact rather than a weld.

- **The key is the IEEE-754 BIT PATTERN of the three coordinates**, read through
  an `Int32Array` view, never `===` and never a tolerance. `+0` and `-0`
  therefore land in different slots, and two NaNs share one only when their
  payloads agree. `project()` is deterministic, so bit-identical inputs give
  bit-identical outputs and a hit returns exactly what a recompute would.
- **Nothing is reused across passes.** A pass generation is bumped at the top of
  every `rasterizeSolid` call and every slot is stale until re-projected, so a
  detail grid — its own camera centre, metrics, cell size and grid shape — can
  never read coordinates the base grid produced. There is no camera-state
  comparison to get wrong.
- **The stored tuple is the camera's OWN return value**, held by reference. The
  obvious alternative — copy the lanes into a pre-shaped scratch row — is a
  REGRESSION, because an orthographic camera returns three elements and a
  perspective one four, so a fixed-shape row has to carry `undefined` in its
  fourth slot and V8 demotes what was a packed-double array to a boxed generic
  one; every `pa[0]` downstream then costs more than the projection saved
  (measured: +1% on the globe, against -3.5% for the reference form).
- **It is built on the SECOND render of an array, never the first**, and an
  array whose distinct count is above 90% of its occurrences is declined for
  good. Building it is O(occurrences) hash work — the same order as the
  projections one frame saves — so on an array that renders once (a static
  compile, a consumer handing over a fresh array per frame) or shares nothing
  (a cube authored with per-face corners) it would be pure loss. Invalidation
  is the polygon array's IDENTITY, the invariant `cullChunkCache` and
  `worldBoxCache` already run on.

Where it does NOT pay: a scene whose polygons are buildings rather than terrain.
Measured on the street-level walk with the whole OpenStreetMap card mounted
(106,584 polys), base-raster 11.23 -> 11.20 ms — flat. `glyphMapVectorMesh`'s
walls are quads that share only their two vertical edges, its earcut caps share
ring vertices, and 85% of the walls are `hidden` before projection anyway, so
there is little duplication left to remove. The win is a terrain win.

**`fillDepthTri` samples `ceil(min) .. floor(max)`.** The id-map / surface-depth
rasterizer samples at INTEGER `(x, y)`, so an integer outside the triangle's own
screen bbox cannot be inside the triangle: the old `floor(min) .. ceil(max)`
bounds only ever sampled those extra integers in order to reject them.
`scanFillTriangle` has always used the tight form — it is the same argument as
its empty-coverage skip. Byte-identical by construction, and therefore invisible
to any output diff; what `rasterize.fillBounds.test.ts` pins instead is the
INCLUSIVE boundary, because narrowing it one step further silently loses a
column and a row off every claimed footprint.

**`scanFillTriangle` decides depth, then alpha, then writes.** It used to sample
a polygon's texture BEFORE deciding whether the fragment loses the depth test,
so every losing textured fragment paid a texel lookup it could not use.
`fillDepthTri` has always decided first and sampled after. What did NOT move is
the alpha rejection, which stays ahead of the depth WRITE: a fully transparent
texel does not cover its cell and must not occlude what is behind it — sampling
after the write and then declining to use the texel is the bug where a sprite's
transparent margin rendered as a solid block. Every cell's coverage, depth and
colour verdict is unchanged; only the lookups for already-losing fragments are
gone.

**Interactive LOD.** Cost scales ~quadratically with scene-wide density (font ÷ d → cells × d²), so a tiny cell (high density / small font) can blow the frame budget while dragging (Script + browser Layout/Paint of a huge `<pre>`; colored output's `innerHTML` spans add ParseHTML/Style/Paint on top). The `interactiveDownscale` scene option (default `1` = off) renders at `1/n` resolution *while a control is actively dragging* and restores full detail on release — same on-screen size (camera `zoom` unchanged; bigger cell → fewer cells), just coarser mid-gesture. All three controls signal this automatically via the shared listener registry (`emitInteraction` → `scene.setInteracting`); consumers can call `scene.setInteracting(active)` for custom interaction sources. Mirrored across React/Vue `<GlyphScene interactiveDownscale>` and `<glyph-scene interactive-downscale>`.

**The downscale is a RENDER-grid change, and a DOM overlay is not on the render grid.** `setInteracting(true)` divides `options.cols`/`rows` in place, so `getOptions()` — and therefore any consumer that measures in cells — reports the coarser grid for the whole gesture. That is the honest answer for rasterized work, and the wrong one for anything laid out by the browser: the only DOM the downscale touches is the `<pre>`'s `font-size`, and hotspots live in a SIBLING `.glyph-hotspot-layer` taking their font from the consumer's own stylesheet, so a label's CSS pixel size is invariant while the cell it is expressed in grows by `n`. `scene.getBaseResolution()` exists for exactly that consumer. The base pair is captured on BOTH branches of `setInteracting`, not only the one that restores from it — an `autoSize` scene's exit path re-derives cols/rows from the restored font rather than reading them back, so without the capture the accessor answers `0` there (its mutation gate).

The bug that produced it, in `@glyphcss/maps`: a `symbol` layer's declutter arbiter reserves `label.length` CELLS per label, and its input positions come from `projectionGrid()`. Under a drag with `/maps`' "Drag density" at 1/3 that reserved three times the screen width each label occupies, so most of them lost the arbitration and were written `opacity: 0` for the whole gesture — the reported "drag and release and all the labels flicker and disappear". Measured on an 8-label fixture at 140x63, sampled per frame: `mount:8, pointerdown:8, drag-1..6:4, pointerup:4, settle-1..5:8`. Two things in that trace are worth keeping. `pointerup:4` is with `cols` ALREADY restored — the grid is fine and the DOM is still wrong, because the widget only re-sweeps markers from a motion frame; and a release that starts no inertial glide schedules no such frame, so the suppression outlived the gesture entirely (the "disappear", as against the "flicker"). An earlier fix that made `applyDrag` call `syncNearSideDom()` synchronously could not close it: it was about STALENESS, and every sweep it added ran against the same downscaled grid, so it only made the wrong answer arrive promptly. The label's `textOffset`, documented in cells, had the same defect on the other DOM channel and slid the label `n` times too far on grab.

The conversion is one scalar per axis, because `projectionGrid()` DEFINES `cellWidth` as the rendered width over `cols` — so `cols * cellWidth` is that width whichever grid is live, positions scale by `base.cols / cols` and the cell in pixels by its reciprocal. Both are exactly `1` when the scene is not interacting, so a map that never downscales arbitrates on exactly the numbers it always did (pinned cell for cell against the same gesture run with no `interactiveDownscale`).

**GPU temporal presentation companion.** `createGlyphSurfaceAtlasWebGpuSession`
is a browser-only, imperative image-generation companion, not a glyph render
mode. It keeps surface-addressed RGB/confidence state private on WebGPU,
reprojects stable surfaces from exact control frames, and presents the
immediate RGB result through one persistent adjacent canvas. It never changes,
reads, or replaces the scene's `<pre>`, and has no CPU/WASM presentation
fallback. `readback()`, `checkpoint()`, and optional presentation capture are
explicit untimed integrity boundaries. Device loss and destruction invalidate
the whole session. React and Vue mirror the factory and types as re-exports;
there is no framework component because the session is not scene ownership.
The additive diagnostic `submitProfiled()` follows the same internal submit
path and reports CPU routing, upload, dispatch encoding, render encoding,
canvas-submit, and GPU-completion milestones plus optional WebGPU
`timestamp-query` compute/render durations; normal `submit()` does not allocate
profiling resources.

---

## Street-level walk mode: where the frame went, and what it cost to get it back

The `/maps` walk-mode frame in Zürich with the whole OpenStreetMap card
mounted was **36.2 ms of renderer main-thread time per displayed frame at
30 fps** (`bench/maps-trace`, `--scene walk-city`, 1440x900, grid 140x63,
`spans`, headed, `astro preview`). It is now **21.0 ms at a locked 60 fps** —
**41.8% less main-thread time per frame** — with every rendered cell
unchanged at every gate taken along the way.

Two fidelity digests were compared after each change: the shipped
`bench/maps-render --fidelity-only --encoding spans` eight-waypoint globe
digest (`d7b0c77de562e14d276d5f10`, unchanged throughout) and a walk-scene
digest over nine settled street-level poses that actually carry buildings,
shadows, the sky dome and the perspective camera (`45b07e1c27f93a0fad31b794`,
unchanged throughout). The globe digest alone is blind to every change below,
because none of its waypoints has a building in it.

| # | change | ms/frame | running |
|---|---|---|---|
| 1 | a re-cull with the same verdict stops re-submitting (superseded by 5) | ~0.4 | 1% |
| 2 | the AABB cull rejects a run **wholly behind** the near plane | 2.1 | 6.8% |
| 3 | the shadow map builds into scratch instead of 166,200 fresh tuples | 0.4 | 8.0% |
| 4 | the stroke stamp hoists three closures per RUN up to per STAMP; `glyphMapGeoTileElevationAt` stops allocating a clamp closure per read | 1.4 | 12.0% |
| 5 | the wall cull writes `Polygon.hidden` in place instead of a new array | 3.3 | 21.2% |
| 6 | the horizon test is resolved on the walker, and the projection is paid for only by what it admits | 2.2 | 28.9% |
| 7 | the same conjunction reorder inside `visibleStrokeRuns` | 0.8 | 31.2% |
| 8 | two exact pre-rejects in front of the haversine; the shade cache is journalled rather than copied | 1.5 | 35.3% |
| 9 | the per-render flattening of the mounted mesh set is memoized | 0.3 | 36.2% |
| 10 | a raster layer's ground reader resolves its mounted tiles once per pass | 0.8 | 38.5% |
| 11 | the wall cull rules out 85% of walls with one compare, by cached distance | 1.0 | 41.3% |
| 12 | the `hidden` skip moves ahead of two unused reads; caster light-space extents are cached | 0.2 | 41.8% |

**The shape of the frame changed completely.** At the start, `base-raster`
was 18.2 ms of 36.2 and the rest was the widget's own per-frame work; the
CPU profile's largest single entry was `glyphMapVectorCullWalls` at 8% of
everything. At the end `base-raster` is 13.7 ms of 21.0, the cull is 1.9%,
and `refreshTextureSamplers`, `buildGlyphPolygonCullChunks`,
`buildChunkNormalCone`, the world-AABB walk and `doRenderTransaction`'s
flattening have all left the top of the profile entirely.

### The one structural change: `Polygon.hidden`, not a new array

Everything else on the list is a hoist, a memo or an exact early reject. This
one is a change of shape, and it is what unlocked four of the others.

`@glyphcss/maps`' `fill-extrusion` re-decides which of its walls are inside
the walker's local horizon on every camera-moving frame, and it used to
express that verdict by handing `handle.setPolygons()` a fresh array of
survivors. glyphcss's caches key on polygon-array **identity** — the
cross-frame shade cache, `refreshTextureSamplers`' whole-scene walk,
`cullChunkCache`'s `WeakMap` of pre-projection cull runs and their normal
cones, and `resolveBaseCullChunks`' merged run list — so that write cost
~2.1 ms per frame plus the garbage behind it, to express a verdict that
**moves by 1 to 7 polygons out of 45,726**.

Recognising an unchanged verdict and skipping the write was tried first and
recovers almost nothing: instrumented over a real 263-frame walk, the
survivor list changed on **251 of 263 frames**. The write has to stop
happening, not be skipped. `glyphMapVectorMarkWalls` writes `Polygon.hidden`
on the mesh's own polygons instead — the consumer-driven cull the solid
rasterizer already honours before any projection, shading or scan-fill, and
which advances the positional shade-cache index by the polygon's own triangle
count so that cache stays aligned as the hidden set moves.

Two consequences had to be taken deliberately:

- **The shadow map now honours `hidden`, on both of its passes.** A caster
  the consumer has culled away must stop casting AND stop shaping the fitted
  light-space volume, or the map silently tracks geometry nobody can see.
  Excluding it only from the depth raster is not enough and is not the same
  bug: 256 texels are divided across that volume, so a caster left in the box
  makes every texel coarser and wrecks the shadows that ARE on screen
  (`shadow.hidden.test.ts` has a clause for each, and each catches only its
  own mutant).
- **The scene submits more polygons and culls them later.** `polys` per
  render goes 66,829 → 105,783, because the hidden walls are now in the list.
  The per-polygon skip is one property read, and it is worth far more than it
  costs — but the pre-projection cull runs are now built over boxes that
  include hidden walls, so the AABB cull is weaker than it was. That is a
  real trade and it is on the winning side by 3.3 ms.

### The exact rejects

Three of the wins are lower bounds that let an expensive exact test be
skipped, never approximated. All three are one-sided: a point either fails a
bound and is provably outside, or falls through to the original expression
and is answered by it unchanged.

**A cull run wholly behind the near plane.** The pre-projection cull's rule 1
— "a box not wholly in front of the near plane is always accepted" — is a NaN
test on the eight projected corners, and it cannot tell a run that STRADDLES
the near plane from one entirely behind the eye. Under an orthographic camera
that never mattered; under the walk camera it is most of the scene. Measured
by the trace's census: 1,096 of 1,444 runs accepted on a NaN corner, **681 of
them wholly behind the walker's head, 48.4% of every triangle submitted**.
The near plane is a plane and the box is the convex hull of its corners, so
"no corner strictly in front of it" means the whole box is behind it — the
same argument `rasterizeSolid` already makes one triangle at a time
(`nanCount === 3 → continue`). The finite-box guard is load-bearing: an
UN-CULLABLE run carries a deliberately infinite box whose corners also
project to NaN, for a reason that has nothing to do with the near plane.

**The walker's horizon, twice.** `glyphMapWalkHorizonTest` puts two bounds in
front of the haversine. Latitude: `cos σ = cos(φ1-φ2) - cosφ1 cosφ2 (1 - cos Δλ)
<= cos(φ1-φ2)`, so `σ >= |Δφ|` always. Longitude, valid only once the latitude
band has passed: with `|φ| <= φmax` for both points, `cosφ1 cosφ2 >= cos²φmax`,
so `sin(σ/2) >= cos φmax · |sin(Δλ/2)|`. The `min(cos φ1, cos φ2)` form
WITHOUT the latitude band first is false and was rejected by counterexample —
two points at 80°N half a world apart are 20° apart and that bound claims 31°.

**The wall cull's distance proof.** Great-circle distance is 1-Lipschitz in
the viewer, so a wall whose nearest corner was `d` from an anchor is at least
`d - moved` from a walker who has since travelled `moved`. If that bound is
past the horizon, every corner fails the horizon test. At street level in
Zürich **38,954 of 45,726 mounted extrusion polygons (85%) are beyond the
600 m horizon**, and each was paying a projection plus a haversine per corner
to say so; they now cost one compare against a cached `Float64Array`. The
anchor re-bases when the walker has moved a quarter of their own horizon —
about once every 100 seconds at walking pace, for the cost of one ordinary
sweep. Forgetting the `- moved` term is the failure this has a render-level
gate for (`widget.walkWallCull.test.ts`): it is silent, and it drops
buildings only for a reader who ARRIVED on foot.

### The shade cache is journalled, not copied

`publishRendererState` published a working COPY of the per-triangle shade
cache so a failure in a later stage left the next frame's inputs untouched.
At 105,783 polygons that copy is four `.slice()`s of ~130,000-element arrays
— about 4 MB of fresh array per displayed frame. `ShadeCache.journal` buys
the identical guarantee for the cost of the entries a pass actually FILLS,
which on a warm cache is nearly none: a populated entry is a cache HIT, and a
hit never writes. That is exactly why the journal is a complete undo log —
every index in it was `undefined` a line earlier — and why the rollback also
restores the four array LENGTHS, since `delete` leaves a hole rather than a
shorter array.

### What did NOT pay, and why

- **Recognising an unchanged wall-cull verdict and skipping `setPolygons`.**
  ~0.4 ms of the hoped 2.1: the verdict changed on 251 of 263 walking frames.
  Superseded by the `hidden` form, which does not care how often it changes.
- **Removing the normal cones the perspective camera cannot use.** 0.43 ms on
  paper, and the trace's own item 2. It never needed doing: once the wall
  cull stopped handing over a new array, the cull runs — cones included —
  are built once for the life of the mount and `buildChunkNormalCone` left
  the profile entirely. A lazy or camera-conditional cone would have been
  machinery for a cost that had already gone.
- **Caching the shadow map across frames.** Its inputs are the caster set and
  the light, and the light is fixed — but the hidden set moves by a handful of
  walls every frame and the map is fitted to exactly that set, so a
  content-keyed cache misses on every moving frame. Only the per-caster
  light-space extents survive (0.2 ms), because they do not depend on which
  casters are hidden.
- **Making `worldToSceneScale` lazy.** The walk-mode sky dome declares
  `requirements: ["worldPosition"]` and never reads the scalar it forces, so
  laziness looked like a free 1.6 ms. It is not reachable without threading a
  getter through `GlyphEffectCoordinates`, because `composeEffectLayers` reads
  the field unconditionally to decide whether to forward it. Memoizing the
  world AABB per mesh (the same `WeakMap` keying `cullChunkCache` uses) gets
  the same millisecond once the polygon arrays are stable, and changes no
  public shape.
- **An incremental `scanFillShadowTriangle`.** Accumulating edge functions
  instead of recomputing them per texel changes the floating-point result, so
  it is not available under a byte-identity contract.

### Two defects this measurement found and did not fix

Both are camera-model questions, not performance ones, and both are
architectural enough to belong to the architect.

1. **In orbit at city zoom, `/maps` shows no terrain.** `camera.target` is
   `projection.project(lon, lat, 0)` — the datum — while the terrain stands
   at `elevation × exaggeration` above it. Measured at Zürich through the
   page's own seam, projecting the real 408 m ground point through the live
   camera onto a 63-row grid: span 140° → row 31.5 (centred), span 1° → 27.5,
   span 0.1° → **-8.2**, span 0.0108° → **-336.3**. The datum itself projects
   to row 31.5 at every span, so the camera is aiming exactly where the
   terrain is not. The fix is to target the ground rather than the datum,
   which moves the picture and therefore re-opens `centerForCamera`'s
   inversion and every pinned pose in `widget.tiltPivot.test.ts`.
2. **`getMaxTilt()` ignores the base pitch.** `tilt` ADDS to
   `cameraForCenter`'s own orientation, which for the globe is `90 - lat`.
   Measured at Zürich, span 0.0108: `getMaxTilt()` answers **85 at every
   tilt** while `camera.rotX` runs 42.62, 62.62, 82.62, 87.62, 92.62, 112.62,
   122.62, 127.62 for tilts 0, 20, 40, 45, 50, 70, 80, 85 — and the grid is
   **8,820 of 8,820 cells blank** at tilts 80 and 85. What the right ceiling
   IS cannot be settled while (1) stands: at this span everything still drawn
   at a high tilt is the stamped `line`/`symbol` layers over an empty raster
   grid, so the pose at which the picture "goes" is a statement about the
   strokes, not about the horizon.

---

## The string encoders, and the 6.56 ms that was not them

A previous pass reported that `solidBufToString` — the encoder that turns the
finished cell grid into the string assigned to `<pre>.textContent` — was
**6.56 ms of the 13.96 ms `base-raster`** on the street-level walk frame, 47%
of it and the largest single remaining item. **It is 0.27 ms.** The number was
real and the attribution was not, and the misattribution is worth recording
because the field that produced it is still there and still called `string`.

`bench/maps-trace` reports `stringMs` from glyphcss's own
`__glyphPerfDetail.string` probe, which spans from the end of the triangle loop
(`rasterize.ts`, the `__tLoop` stop) to the function's return. Between those two
points sit the supersample downsample, temporal reprojection, the buffer
plumbing, **`applyCellHook` — the whole of `@glyphcss/maps`' composed
`transformCells` stamp** — and only then the encoder. Measured in the real page
with a probe on each (walk-city, 1440x900, grid 140x63, `astro preview`,
headless, `--walk-look 0`, 176 renders):

| inside the probe's window | ms/render | share |
|---|---|---|
| `applyCellHook` (the maps stroke/contour stamp) | **6.30** | 96% |
| `solidBufToString` | 0.27 | 4% |
| downsample / TAA / plumbing | ~0.02 | — |
| — total, i.e. the reported `stringMs` | 6.59 | |

The previous pass's own CPU profile agreed all along and was not read that way:
`encodeGlyphBuffers` sits at 68.32 ms of self time over a 6,769.8 ms span and
274 frames — **0.249 ms/frame** — while `drapedRunPerCell`,
`stampGlyphMapPolyline`, `stamp`, `vertexAt` and `glyphMapGeoTileElevationAt`
together carry 962 ms, i.e. ~3.5 ms/frame of self time inside that same window.

So **the largest single item in the walk frame is `@glyphcss/maps`' own
per-render `transformCells` stamp at 6.3 ms of an 11 ms `base-raster`**, not
anything in glyphcss's string path. That is the next target, and it is in the
maps package.

### What the encoders do cost, and the three run-aware short-circuits

Measured the same way, per render, walk-city at 140x63. The page ships
`colorEncoding: "atlas"`; the bench defaults to `spans`, so both are given.

| phase | spans | atlas |
|---|---|---|
| `isGlyphAtlasEncodable` | — | 0.124 |
| palette resolve (`histogramGridColors` is 97% of it) | — | 0.390 |
| `encodeGlyphAtlas` | — | 0.348 |
| `encodeGlyphBuffers` | 0.272 | — |
| **`solidBufToString` total** | **0.272** | **0.868** |

Decomposed by ablation on the real captured grids, the cost is not the string
building — it is **per-cell revalidation of a colour the encoder has already
seen**. `assertColor` is a regex (`/^#[\da-f]{6}$/i`) per non-blank cell and is
52% of the spans encoder and 48% of the atlas encoder; `packHexColor` is the
same regex plus a `parseInt` per cell inside the histogram. A rasterized grid
is runs of one Lambert-shaded colour — these grids measure **17 cells per
colour run** — so all three passes were re-deriving, per cell, what the run had
already established.

Three short-circuits, each keyed on a string the pass is already holding:

- **`encodeGlyphBuffers` validates a colour only when it DIFFERS from the run's
  anchor.** `runColor` is only ever assigned from an `assertColor`-validated
  `nextColor` and starts `null`, so by induction every value it holds has
  passed; a cell that differs still validates at its own index, including one
  the `colorTolerance` anchor rule merges without re-anchoring. Widening the
  test from "same string" to "extends the run" is a hole, not a refinement:
  `#ff0000x` is not a colour, but `parseInt` stops at the `x` and packs it to
  the anchor's own value, so the tolerance test accepts it and never looks at
  the string (`cells.test.ts` has that exact cell).
- **`encodeGlyphAtlas` collapses a cell repeating the previous cell's
  `(glyph, colour)`** to one `+=` of the unit it already produced. Every step
  between that pair and the code point — both asserts, the slot lookup, the
  atlas index lookup, `String.fromCodePoint` — is a pure function of those two
  strings. Nothing is cached across a change, so a grid where every cell
  differs pays two compares.
- **`histogramGridColors` counts a RUN at a time.** Counts are unchanged and so
  is the map's INSERTION ORDER — `medianCutPalette` and the quantizer's drift
  walk both iterate it, so a reordering would be a silent recolouring — because
  a run is always flushed before the next one opens, which makes first-flush
  order equal first-occurrence order.

Measured in the real page, same scene and probes:

| phase | before | after |
|---|---|---|
| spans — `encodeGlyphBuffers` | 0.272 | **0.150** (−45%) |
| atlas — palette resolve | 0.390 | **0.068** (−83%) |
| atlas — `encodeGlyphAtlas` | 0.348 | **0.150** (−57%) |
| atlas — `isGlyphAtlasEncodable` | 0.124 | 0.129 (unchanged) |
| **`solidBufToString` total, atlas** | **0.868** | **0.347** (−60%) |
| **`solidBufToString` total, spans** | **0.272** | **0.150** (−45%) |

`isGlyphAtlasEncodable` is left alone: its own `validated` Set already
memoizes per distinct colour, and a charCode hex test in place of its regex
measured no better.

That is 0.52 ms/render of an 11.4 ms `base-raster` in the encoding the page
ships — worth taking, and ~4.5% of the frame, which is below what a `base-raster`
A/B can resolve. It is reported as the phase measurement it is, not as an fps
claim.

Byte-identity was established by a differential run against faithful copies of
the three previous bodies over randomized grids — valid and invalid colours and
glyphs, blanks, holes, `colorTolerance` 0/32/200, weight buffers, and atlas
palettes including empty and malformed ones — comparing both the returned string
and the thrown message: **5,200 comparisons, 0 mismatches**. Three fidelity
digests were taken before and after and are identical: the eight-waypoint globe
digest at 140x63 (`7c8018579ed6601f01f438f9`) and at 283x105
(`56a8f869c736f91f7b25ab79`), and a seven-pose street-level walk digest
(`b26631e7bc93110a84eb9f9d`) over every `<pre>` the scene produces.

### Where it does NOT pay: a scene at `density > 1`

Measured at the reported OSM-density state (walk, every OSM row, `--osm-density
2`, spans, headless, 1440x900, 140x63) the change is worth NOTHING: the whole
frame is 112.2 ms before and 112.8 after, and `detail-encode` — 13 separated
`<pre>`s encoded per render — is 10.95 ms before and 11.37 after, i.e. inside
that state's very large run-to-run variance (262 long tasks, worst 1,280 ms).
The reason is the shape of a detail grid: it is silhouette-fitted and mostly
BLANK, and a blank cell never had a colour to validate in the first place. The
win is a base-grid win, on the one grid that is dense and colour-bearing.

### What did NOT pay

- **A charCode hex validator in place of the regex.** 85 -> 89 µs on the real
  grid: the regex is already cheap PER CALL, and what made it expensive was the
  number of calls.
- **`String.fromCharCode` in place of `String.fromCodePoint`** in the atlas
  encoder. Every atlas code point is BMP, so it is available — and it measured
  291 -> 287 µs, inside noise. The code point was never the cost.
- **Interning the span prefix/suffix, or building into a preallocated code-unit
  buffer.** Removing `escapeGlyphHtml` entirely measured 213 -> 223 µs, i.e.
  nothing, and the residual after the asserts are gone is 89 µs for 8,820 cells
  — V8's cons-string `+=` and one `join` are not what to attack.

### The cross-layer occlusion id-map ignores `Polygon.hidden`

Found while pricing the `/maps` OSM density cliff, and reported rather than
fixed because it is not byte-identical. Every polygon loop in
`render/rasterize.ts` skips `poly.hidden` — the paint loop, the wireframe loop,
the ink loop, both shadow passes — except `computeOcclusionIds`'s, which
projects and depth-rasters the polygon and CLAIMS its cells for that layer.
Shown directly: a base quad in front of a detail quad claims all 64 cells of an
8x8 id-map, and claims the same 64 with `hidden: true`.

Two consequences, and both bite exactly where the cliff is. A layer that
actually paints those cells is blanked at them, so the consumer's own cull
punches holes in whatever is behind it; and `@glyphcss/maps`' walk-mode wall
cull hides **38,954 of 45,726 extrusion polygons (85%)** — the whole point of
the `Polygon.hidden` form landed in the previous pass — every one of which the
id-map still projects and rasters once per render. The one-line skip that fixes
both changes what gets blanked, so it is the architect's call, not a
performance change.

### The `/maps` OSM density cliff, priced

Measured on the same build, walk mode, every OSM row, spans, headless,
1440x900, grid gate 140x63 held on both rows, `--walk-look 0`:

| | density 1 | density 2 |
|---|---|---|
| fps | 67.1 | **8.8** |
| task ms/frame | 12.42 | **112.78** |
| renders/frame | 0.73 | 1.04 |
| base pass polys | 107,143 | **17,002** |
| `base-raster` | 11.24 | 2.84 |
| `detail-project` | — | **50.63** |
| `detail-encode` | — | 11.37 |
| `detail-raster` | — | 6.49 |
| `commit-write` | 0.81 | 2.32 |
| long tasks | 2, worst 231 ms | **262, worst 1,280 ms** |

The geometry LEAVES the base grid — `base-raster` falls by 8.4 ms and the base
pass loses 90,141 polygons — and comes back as 68.5 ms spread over 13 separated
passes, plus ~23 ms/frame of script that lands in no stage at all, which is
where `computeOcclusionIds` sits (it runs before the `base-validate` marker).
`detail-project` alone is half the frame.

**This is not one cost, it is three, and only one of them is a renderer
inefficiency.** (1) Thirteen rows separating means thirteen full rasterizer
passes, which is the documented price of the feature — "each distinct mode is a
full extra rasterizer pass — reach for it per layer, not per mesh" — and the
card's one slider writes every row at once. (2) `computeOcclusionIds` rasters
the whole scene into the shared id-map once per render the moment ONE opaque
detail layer exists; the README already prices that at +10.4 ms/frame for a
65,312-polygon globe and a ONE-QUAD probe, and here it is 107,143 polygons at
street level. (3) That id-map raster is the only polygon loop in
`render/rasterize.ts` with neither the pre-projection cull runs nor the
`Polygon.hidden` skip — so it pays for the 681-of-1,444 runs that sit wholly
behind the walker's head AND for the 38,954 walls (85%) the wall cull has
already hidden.

The tractable lever is (3), and it is two separate changes. Threading the
existing `cullChunks` through `computeOcclusionIds` is byte-identical by the
same argument the base pass's cull rests on — a run whose box projects entirely
off the grid claims no cell — but needs the `doubleSided` flag respected (a
double-sided scene's back faces do claim) and a fidelity gate at `density > 1`,
which none of the three digests currently covers. Honouring `Polygon.hidden` is
NOT byte-identical and is the architect's call; it is written up above as a
defect, not a tuning. Neither is taken here.
