/**
 * createGlyphMap — the interactive widget (MAPS.md §9/§13 slice 3). One
 * factory replacing `website/src/pages/examples/world.astro` and
 * `flatmap.astro`'s hand-rolled, near-duplicate scene wiring: tile cache,
 * active-handle diff, in-flight guard, fetch debounce, greedy label
 * declutter, and the "capture on host, not e.target" pointer workaround are
 * all absorbed here, once. Mirrors `createGlyphScene`'s shape — a host +
 * options factory returning a handle with mutators and a `destroy()`.
 *
 * **What's on the `GlyphMapProjection` interface, and why nothing here
 * branches on projection identity** (MAPS.md §7's "must carry more than
 * `project`"): culling uses `projection.visible?.()` (present only where a
 * projected point can be geometrically valid yet camera-invisible — the
 * globe's back hemisphere); gesture semantics use the PRESENCE of
 * `projection.cameraForCenter`/`centerForCamera` (present only on a
 * projection navigated by orbiting the camera around fixed world geometry)
 * to pick orbit-drag over pan-drag; zoom range defaults to
 * `projection.domain`'s own width, with an explicit `maxSpan` escape hatch
 * for consumers that want overview margin around the whole projection.
 * Every one of these is a capability check on the interface, never an
 * `if (projection.id === "glyph-map-globe")`.
 *
 * **Two bugs fixed rather than ported** (MAPS.md §13 slice 3):
 * 1. `world.astro:182-232`'s `findFocalLatLon` scans for MINIMUM projected
 *    depth as the near-hemisphere focal point, and `:366` treats `depth < 0`
 *    as "front-facing" — but `rasterize.ts`'s convention (verified directly
 *    against `fillDepthTri`'s `z >` test and `createGlyphOrthographicCamera`'s
 *    own `project()`, and independently re-verified by
 *    `packages/maps/src/chirality.test.ts`) is LARGER depth = NEARER, so
 *    that scan resolves the ANTIPODE of the true focal point, masked in
 *    practice by hemispheric z0/z1 tile coverage plus a failsafe tile.
 *    `glyphMapGlobe.visible()` and `.cameraForCenter()`/`.centerForCamera()`
 *    (see `projection.ts`) are closed-form, derived from the camera's own
 *    (verified) depth formula, and used here with no scan at all.
 * 2. LOD keyed on absolute `camera.zoom` (`world.astro:91`,
 *    `flatmap.astro:235`) only worked because both pages' world scale
 *    happened to be ≈ 1 unit ≈ hemisphere. `glyphMapTargetLOD` (`provider.ts`)
 *    instead takes `glyphMapDegreesPerCell(view)` — ground units per glyph
 *    cell, geographic by construction — so two projections with different
 *    native scales (a `radius: 1` globe and a `radius: 100` one, say) select
 *    sensibly without a scale-specific threshold table.
 */

import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera, createGlyphScene } from "glyphcss";
import type {
  CellGrid,
  GlyphCamera,
  GlyphHotspotHandle,
  GlyphMeshHandle,
  GlyphMeshTransform,
  GlyphSceneHandle,
  GlyphSceneOptions,
  GlyphShadowOptions,
  RenderMode,
  TextureSampler,
  TransformCells,
  Vec3,
} from "glyphcss";
import type { GlyphMapAttribution, GlyphMapBounds, GlyphMapClassifier, GlyphMapField, GlyphMapView } from "./types";
import type { GlyphMapProjection } from "./projection";
import { glyphMapTrueScaleElevation } from "./projection";
import {
  GLYPH_MAP_WALK_DRAG_DEG_PER_PX,
  GLYPH_MAP_WALK_HORIZON_TILT_DEG,
  GLYPH_MAP_WALK_LOOK_DEG_PER_PX,
  GLYPH_MAP_WALK_RUN_MULTIPLIER,
  glyphMapWalkAxis,
  glyphMapWalkAxisForKey,
  glyphMapWalkBoundsWithinHorizon,
  glyphMapWalkLens,
  glyphMapWalkSpan,
  glyphMapWalkStep,
  glyphMapWalkWithinHorizon,
  resolveGlyphMapWalkOptions,
  type GlyphMapResolvedWalkOptions,
  type GlyphMapWalkOptions,
  type GlyphMapWalkState,
} from "./walk";
import {
  createGlyphMapWalkCollisionIndex,
  glyphMapWalkFootprints,
  glyphMapWalkResolveStep,
  type GlyphMapWalkCollisionIndex,
  type GlyphMapWalkFootprint,
} from "./walkCollision";
import { glyphMapProjectionTransition } from "./transition";
import type { GlyphMapGeoTile } from "./tile";
import { glyphMapGeoTileElevationAt, glyphMapGeoTileElevationRange, glyphMapGeoTileVertexLonLat, splitGlyphMapGeoTileAtAntimeridian } from "./tile";
import { glyphMapPolygons, localUpDirection } from "./mesh";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import { glyphMapDegreesPerCell, glyphMapEqualAngleTileRange, glyphMapFinestLOD, glyphMapTargetLOD, type GlyphMapTileIndexRange, type GlyphMapTileRangeStrategy } from "./provider";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorSource } from "./vector/types";
import { glyphMapFieldValueAt } from "./sample";
import { stampGlyphMapContour, stampGlyphMapContourLabels, stampGlyphMapPolyline, type GlyphMapStrokeVertex } from "./stroke";
import { GLYPH_MAP_NIGHT_LEVELS, GLYPH_MAP_NIGHT_OPACITY, GLYPH_MAP_SUN_TWILIGHT_DEG, glyphMapSubsolarPoint, glyphMapSunDirection, stampGlyphMapNight, type GlyphMapSolarPosition } from "./sun";
import { glyphMapDedupeAttributions } from "./attribution";
import { glyphMapFacadeTexture, glyphMapFeatureSeed, glyphMapVaryColor, GLYPH_MAP_FACADE_TEXTURE, type GlyphMapFacadeOptions } from "./facade";
import { glyphMapDeclutterLabels, glyphMapPointHeatmap, glyphMapVectorCullWalls, glyphMapVectorMesh, type GlyphMapVectorMesh } from "./layers";
import type { Polygon } from "glyphcss";

// ── Layers (MAPS.md §14 — `background`/`raster`/`line`/`contour`;
// `fill`/`symbol`/`circle`/`heatmap`/`fill-extrusion`/`model` are later
// slices' own additions to this union, not typed speculatively ahead of
// them) ──────────────────────────────────────────────────────────────────

/**
 * A raster layer's `source` (MAPS.md §9): either an in-memory dataset (a
 * single already-loaded {@link GlyphMapGeoTile}, mounted once) or a
 * {@link GlyphMapProvider} tile pyramid (mounted/unmounted per visible LOD
 * set, exactly like both example pages' own tile layers).
 */
export type GlyphMapRasterSource = GlyphMapGeoTile | GlyphMapProvider;

function isGlyphMapProvider(source: GlyphMapRasterSource): source is GlyphMapProvider {
  return typeof (source as GlyphMapProvider).loadTile === "function";
}

/**
 * Render modes that paint EDGES only, leaving every interior cell empty.
 * A mesh-backed layer in one of these renders as an OUTLINE over whatever is
 * beneath it, so it is mounted `transparent`: an opaque detail layer claims
 * its full triangle footprint in glyphcss's shared occlusion id-map (a
 * geometry raster — it knows nothing about which glyphs the layer will
 * actually paint), which would blank the terrain under the outline instead of
 * letting it show through. `solid`/`voxel` fill their coverage and stay
 * opaque, so they occlude normally.
 */
const GLYPH_MAP_EDGE_RENDER_MODES: ReadonlySet<RenderMode> = new Set<RenderMode>(["wireframe", "ink"]);

/** The ramp glyphcss itself falls back to when a scene declares no `glyphPalette` (`createGlyphScene`). */
const GLYPH_MAP_DEFAULT_GLYPH_PALETTE = "default";

/** The appearance a MESH-BACKED layer contributes to its own mesh transform. */
interface GlyphMapMeshAppearance {
  readonly type?: GlyphMapLayer["type"];
  readonly renderMode?: RenderMode;
  readonly glyphPalette?: string;
}

/**
 * Which mesh-backed layers CAST a shadow, and which RECEIVE one.
 *
 * The two sets OVERLAP: every caster is also a receiver, which is what makes
 * a building shadow the building next to it. They used to be disjoint, and
 * that made building-on-building impossible by construction — the case a
 * reader notices first in a city.
 *
 * What changed is not the sets but the ACNE GUARD they were working around. A
 * surface that both casts and receives is tested against its own depth read
 * out of a texel up to one texel away in each light-space axis, and glyphcss
 * had no guard for that other than `shadow.lift`, an absolute WORLD length —
 * unusable here, where the same number is 5% of a room and 318 km of a
 * unit-radius globe. glyphcss now derives the guard from the shadow map's own
 * texels and the receiver's own depth slope (`SHADOW_SLOPE_BIAS_TEXELS`, in
 * `rasterize.ts`), which is scale-free and so is right on a globe, on a sheet
 * and in a room alike. Measured on this package's own fixture: a lone tower
 * self-shadowed 450 of its 450 visible roof cells without the guard, 0 with
 * it, at every sun altitude from 10 to 60 degrees.
 *
 * CASTERS are the layers that stand UP off the ground: `fill-extrusion`
 * (OSM buildings, the reason this feature exists) and `model`. TERRAIN is
 * deliberately NOT a caster, and that is the load-bearing exclusion:
 * glyphcss fits the shadow map's light-space volume to the AABB of ALL
 * casters at a fixed 256x256, and the relief system keeps a PERMANENT GLOBAL
 * floor tier mounted at every view (AGENTS.md's "Relief mesh"), so terrain
 * casting would stretch those 256 texels across the whole Earth — ~156 km
 * per texel, at which no building, valley or mountain shadow survives at all
 * — and would re-rasterize the floor tier's whole polygon set into the depth
 * buffer on every render. Mountain-shadow-on-valley needs a view-fitted
 * cascade this renderer does not have; it is not a tuning away.
 *
 * RECEIVERS are the ground surfaces — `raster` (the relief itself), `fill`
 * (a flat overlay on the datum) and `heatmap` (whose relief hugs the terrain)
 * — PLUS the casters themselves. A `line`/`contour`/`symbol`/`circle` layer
 * owns no mesh and cannot be either.
 *
 * A per-layer `density` does NOT take a layer out of this. It used to: a
 * `density !== 1` separates the mesh into its own `<pre>` (glyphcss's
 * `isDetailMesh`), and the shadow map was built per PASS, so `/maps`' one
 * OSM density slider separated the buildings that cast and the landuse that
 * receives in a single gesture and the whole feature went silently inert
 * (measured: 535 changed cells at `density: 1`, 0 at `2.9`). glyphcss now
 * builds one map per frame from every caster in the SCENE and shares it
 * across the frame's passes (AGENTS.md's "Shadows"), so the choice of
 * density and the choice of shadows are independent again. What is still
 * outside the mechanism is a STAMP: `line`/`contour` are painted into the
 * cell grid after shading and keep their flat colour, so a building shadows
 * the landuse under it and never the road beside it.
 */
export const GLYPH_MAP_SHADOW_CASTERS: ReadonlySet<GlyphMapLayer["type"]> = new Set<GlyphMapLayer["type"]>(["fill-extrusion", "model"]);
export const GLYPH_MAP_SHADOW_RECEIVERS: ReadonlySet<GlyphMapLayer["type"]> = new Set<GlyphMapLayer["type"]>(["raster", "fill", "heatmap", "fill-extrusion", "model"]);

/**
 * The per-mesh transform a MESH-BACKED layer (`raster`, `fill`,
 * `fill-extrusion`, `heatmap`, `model`) mounts with. `density`, `renderMode`
 * and `glyphPalette` all pass straight through to glyphcss's own per-mesh
 * options (AGENTS.md's "Per-mesh detail layers"): `density` pops the mesh into
 * its own `<pre>` at that glyph resolution, and a `renderMode` or a
 * `glyphPalette` that DIFFERS from the scene's does the same so the layer can
 * be rasterized under its own mode / against its own ramp — the shared grid is
 * rasterized in ONE pass, under one mode, against one ramp. A layer declaring
 * none of them — or declaring the mode/ramp the scene is already in — stays in
 * the shared base grid at no extra cost.
 *
 * The ramp escape has to be applied HERE, not in glyphcss: `isDetailMesh`
 * separates on ANY non-null per-mesh `glyphPalette` on purpose, because an
 * unrecognized palette name resolves to the default ramp and so two DIFFERENT
 * names can mean one ramp. That asymmetry does not touch the case this
 * function screens for — two EQUAL names always resolve to one ramp, known or
 * not — so comparing against the scene's own live palette and simply not
 * setting the per-mesh option is exact, not an approximation. It matters
 * because a separated OPAQUE layer is not cheap: it makes `computeOcclusionIds`
 * raster the whole scene's geometry once per render (bench/maps-render measured
 * +8.8 ms/frame for a one-quad overlay), so the common case — every layer on
 * the scene's own ramp — must reach glyphcss with nothing set at all.
 *
 * `sceneGlyphPalette` is read from the LIVE scene at mount time. A consumer
 * that changes the scene's palette afterwards through the `map.scene` escape
 * hatch does not re-evaluate already-mounted meshes; re-add the layer (which
 * is how every other per-layer appearance change on this widget already
 * works — there is no live setter for one).
 *
 * `line`/`contour` layers never reach this: they own no mesh, are stamped
 * post-raster, and already emit oriented stroke glyphs by construction —
 * `glyphPalette` is a documented no-op for that path (AGENTS.md).
 */
function glyphMapMeshTransform(
  layer: GlyphMapMeshAppearance,
  sceneGlyphPalette: string,
  density?: number,
  detailGroup?: string,
): GlyphMeshTransform {
  const transform: GlyphMeshTransform = {};
  if (density !== undefined) transform.density = density;
  if (detailGroup !== undefined) transform.detailGroup = detailGroup;
  if (layer.renderMode !== undefined) {
    transform.mode = layer.renderMode;
    if (GLYPH_MAP_EDGE_RENDER_MODES.has(layer.renderMode)) transform.transparent = true;
  }
  if (layer.glyphPalette !== undefined && layer.glyphPalette !== sceneGlyphPalette) {
    transform.glyphPalette = layer.glyphPalette;
  }
  // Set UNCONDITIONALLY — not gated on whether shadows are currently on.
  // glyphcss reads these flags only inside a pass that has `scene.shadow`
  // set (`buildShadowMap` is skipped outright otherwise, and `makeShadowCtx`
  // returns null), and `isDetailMesh` does not consider them, so with
  // shadows off they change nothing about the render — which is what makes
  // the toggle ONE `scene.setOptions({ shadow })` instead of a remount of
  // every mounted mesh in the map.
  // Two independent `if`s, not an `else if`: the sets overlap, and a
  // `fill-extrusion` has to carry BOTH flags or a building cannot darken its
  // neighbour.
  if (layer.type !== undefined) {
    if (GLYPH_MAP_SHADOW_CASTERS.has(layer.type)) transform.castShadow = true;
    if (GLYPH_MAP_SHADOW_RECEIVERS.has(layer.type)) transform.receiveShadow = true;
  }
  return transform;
}

/**
 * The `GlyphMeshTransform.detailGroup` name a raster layer's tiles of ONE
 * TIER share, so that tier renders into ONE detail output instead of one per
 * tile.
 *
 * WHY: a raster layer mounts one mesh per tile, and glyphcss pops each mesh
 * carrying a `density` into its own silhouette-fitted `<pre>`. Two abutting
 * tiles then point-sample coverage on two lattices fitted to two different
 * silhouettes, so on a curved, foreshortened surface a sub-cell sliver along
 * their shared edge can fall inside neither and nothing paints it — a dark
 * line along every tile boundary, which at z3 sits within a degree of the
 * tropics and the polar circles and reads as a deliberate graticule. One
 * lattice per tier removes the boundary rather than refining a test at it.
 *
 * PER TIER, not per layer. The never-black system mounts up to three tiers of
 * the same terrain at once (fine / coarser fallback / permanent floor) whose
 * surfaces are near-coincident but built at different mesh resolutions.
 * Across tiers that is resolved today by the shared cross-layer occlusion
 * id-map; folding them into ONE depth buffer would instead let two
 * near-coplanar surfaces win alternate cells, which reads as speckle. Tiles
 * WITHIN a tier are the ones that abut exactly, and they are the ones the
 * reported seam runs between.
 *
 * Set unconditionally, including at `density === 1`. `detailGroup` never
 * separates a mesh by itself (glyphcss's `isDetailMesh` does not consider it),
 * so on the ordinary `density: 1` path the tiles stay in the shared base grid
 * and the name is inert — that path is byte-identical, not merely equivalent.
 */
function glyphMapRasterDetailGroup(layerId: string, tier: "fine" | "fallback" | "floor"): string {
  return `glyph-map-raster:${layerId}:${tier}`;
}

export interface GlyphMapBackgroundLayer {
  readonly type: "background";
  readonly id?: string;
  /** CSS color. `undefined` clears any color a lower `background` layer set, leaving the host's own CSS background to show through. */
  readonly color?: string;
  /**
   * Every {@link GlyphMapLayer} carries `density` (website UI scope addition
   * to MAPS.md §13 slice 5: "every layer row in the rail is the same shape")
   * so a caller can uniformly reach for it, but a flat CSS background colour
   * has no glyph resolution to multiply — permanently a documented no-op
   * here, the same "conceptually doesn't apply" category as e.g.
   * `wireframeJunctions` in `ink` mode (AGENTS.md), never validated against.
   */
  readonly density?: number;
}

export interface GlyphMapRasterLayer {
  readonly type: "raster";
  readonly id?: string;
  readonly source: GlyphMapRasterSource;
  /** Elevation-band classifier driving `colors`. Omitted → glyphcss's default uncolored fill. */
  readonly classifier?: GlyphMapClassifier;
  /** Color per band, indexed by `classifier.classifyValue`'s result. Ignored without `classifier`. */
  readonly colors?: readonly string[];
  /** Screen-space padding (output cells) a provider tile's bounds must be within to stay mounted — absorbed from both pages' "pad by a tile diagonal so tiles straddling the edge load before they pop in". Default {@link GLYPH_MAP_RASTER_PAD_CELLS_DEFAULT}. Ignored for a static (non-provider) source. */
  readonly padCells?: number;
  /**
   * Passed straight through as this layer's mounted mesh(es)' own
   * `GlyphMeshTransform.density` (glyphcss's per-mesh detail layer —
   * AGENTS.md's "Per-mesh detail layers": pops the mesh into its own
   * silhouette-fitted `<pre>` at `density`× the scene's glyph resolution,
   * cross-layer-occlusion-correct against the base grid for free). `1`
   * (default) keeps this layer in the shared base grid, unchanged.
   */
  readonly density?: number;
  /**
   * Per-layer render mode — this layer's mounted mesh(es) rasterize under
   * `renderMode` instead of the scene's own (glyphcss's per-mesh
   * `GlyphMeshTransform.mode`). A map is not one picture in one mode: terrain
   * reads as `solid`, an administrative overlay reads as `ink`. Omitted (the
   * default) = the scene's mode, and so does declaring the mode the scene is
   * already in — both keep this layer in the shared base grid, one pass, byte
   * identical. A genuinely different mode is a full extra rasterizer pass, and
   * `wireframe`/`ink` additionally mount `transparent` (see
   * {@link GLYPH_MAP_EDGE_RENDER_MODES}).
   */
  readonly renderMode?: RenderMode;
  /**
   * Per-layer GLYPH palette — the CHARACTER ramp this layer's mounted mesh(es)
   * shade with (glyphcss's per-mesh `GlyphMeshTransform.glyphPalette`),
   * instead of the scene's own. Distinct axis from a colour ramp: this picks
   * WHICH characters carry the shade, never which colours they are painted
   * in. Solid-mode ramps only, exactly as glyphcss documents — `charMode`,
   * `wireframeJunctions` and `solidWeightRamp` stay scene-level.
   *
   * Omitted (the default) = the scene's ramp, and so does naming the ramp the
   * scene is already on — both keep this layer in the shared base grid, one
   * pass, byte identical. A genuinely different ramp is a full extra
   * rasterizer pass at the BASE cell size (no extra detail), and an opaque one
   * additionally turns on the whole-scene occlusion id-map raster — see
   * {@link glyphMapMeshTransform} for why that escape lives here rather than
   * in glyphcss.
   */
  readonly glyphPalette?: string;
}

function isGlyphMapVectorProvider(source: GlyphMapVectorSource): source is GlyphMapVectorProvider {
  return typeof (source as GlyphMapVectorProvider).loadTile === "function";
}

/**
 * Selects which of a layer's source features it renders — applied AFTER
 * `sourceLayer` (and instead of it for a static
 * {@link GlyphMapVectorFeatureCollection}, which has no source-layer
 * grouping to name). Omitted = every feature, byte-identical to before this
 * option existed.
 *
 * A real vector-tile schema does not ship one source layer per cartographic
 * layer. The Protomaps basemap (`vector/protomaps.ts`) carries motorways,
 * footpaths and railways in ONE `roads` layer discriminated by a `kind`
 * property, and rivers (lines) alongside lakes (polygons) in ONE `water`
 * layer. `sourceLayer` can say "roads"; only this can say "motorways", or
 * "the line half of water".
 *
 * A predicate rather than a declarative match spec because the alternative —
 * pre-splitting the features into one collection per rendered layer — is
 * impossible for a PROVIDER-backed source, whose tiles arrive after mount and
 * are re-fetched as the view moves.
 */
export type GlyphMapFeatureFilter = (feature: GlyphMapVectorFeature) => boolean;

/**
 * A stroke layer (MAPS.md §13 slice 5): country/subdivision borders, roads,
 * rivers, routes. `source` mirrors `GlyphMapRasterLayer.source`'s
 * static-vs-provider split — a single in-memory `GlyphMapVectorFeatureCollection`
 * or a tiled `GlyphMapVectorProvider` (`vector/types.ts`), mounted/unmounted
 * per visible LOD tile exactly like a raster layer's own tile loop.
 * Rendered by post-raster stamping (`stroke.ts`'s `stampGlyphMapPolyline`)
 * into the scene's `transformCells` hook — see `stroke.ts`'s doc for why
 * that mechanism was chosen over `compileScene`.
 *
 * Its vertices are DRAPED on the terrain: each is projected at the ground
 * elevation under its own lon/lat, from the mounted `raster` layers' tiles,
 * so a road is drawn where the ground it belongs to is drawn rather than at
 * a datum the tilt's parallax would displace it from. With no `raster` layer
 * mounted the ground IS the datum and nothing extra runs.
 */
export interface GlyphMapLineLayer {
  readonly type: "line";
  readonly id?: string;
  readonly source: GlyphMapVectorSource;
  /** Named vector-tile source layer (for example Protomaps `roads`). Omit to consume every source layer. */
  readonly sourceLayer?: string;
  /** Narrows this layer to a subset of its source's features — see {@link GlyphMapFeatureFilter}. */
  readonly filter?: GlyphMapFeatureFilter;
  readonly color?: string;
  /** Screen-space padding (output cells) a provider tile's bounds must be within to stay mounted. Default `2`. Ignored for a static (non-provider) source. */
  readonly padCells?: number;
  /**
   * A stroke layer has no geometry of its own — it is a post-raster
   * annotation, stamped into an output grid the scene produces, depth-tested
   * against whatever surface already won each cell there. `density` picks
   * WHICH grid(s):
   * - `undefined`/`1` (the default): the layer has no resolution preference
   *   of its own, so it stamps into EVERY grid this scene produces (the
   *   base grid and each per-mesh detail grid), following the ANNOTATED
   *   SURFACE'S own density (raise {@link GlyphMapRasterLayer.density} to
   *   sharpen a border/contour where it crosses that terrain) — the
   *   pre-existing behavior.
   * - a genuine value (`!== 1`): the layer wants its OWN independent
   *   resolution, decoupled from every mesh's. `createGlyphMap` routes it
   *   through `scene.setViewportOverlayDensities` — a meshless, full-
   *   viewport output grid at that density, with its own geometry depth
   *   pass so a stroke stamped there is still occluded correctly by scene
   *   geometry rendered at a DIFFERENT density (glyphcss's
   *   `GlyphSceneHandle.setViewportOverlayDensities` doc has the mechanism).
   *   The layer then stamps ONLY into that overlay, not into the base grid
   *   or any mesh's detail grid, so the same stroke never renders twice at
   *   two different resolutions.
   */
  readonly density?: number;
}

/**
 * A contour layer's `source` (MAPS.md §13 slice 5): either an
 * ALREADY-SAMPLED `GlyphMapField` (`sample.ts`'s `sampleGlyphMapField`,
 * slice 1) — a fixed snapshot, mounted once — or a {@link GlyphMapProvider}
 * tile pyramid (the SAME provider type `raster` already uses), re-derived
 * into a field per visible LOD/tile exactly like `raster`'s own tiles are.
 * Reusing `GlyphMapProvider` rather than inventing a field-specific provider
 * type means a single elevation pyramid (e.g. ETOPO1) backs both the
 * relief mesh and its contour lines with no second data-access abstraction.
 */
export type GlyphMapContourSource = GlyphMapField | GlyphMapProvider;

function isGlyphMapFieldProvider(source: GlyphMapContourSource): source is GlyphMapProvider {
  return typeof (source as GlyphMapProvider).loadTile === "function";
}

/**
 * One member of an elevation MOSAIC — "what is the terrain height at this
 * lon/lat, and what range does this piece span", with `NaN` for a point the
 * piece does not cover. It exists so a `contour` layer's two source shapes —
 * a static, already-sampled {@link GlyphMapField} and a provider's
 * vertex-centered {@link GlyphMapGeoTile} — are read through one lookup
 * instead of coercing one into the other.
 */
interface GlyphMapElevationPiece {
  readonly min: number;
  readonly max: number;
  valueAt(lon: number, lat: number): number;
}

/**
 * A provider tile as an elevation piece, sampled through its own VERTEX grid
 * (`glyphMapGeoTileElevationAt`).
 *
 * This deliberately does NOT derive a cell-centered `GlyphMapField` from the
 * tile first, which is what it used to do. Adjacent tiles SHARE their edge
 * vertex row/column, so vertex sampling makes two neighbours agree EXACTLY on
 * their shared boundary; a cell-centered derivation places its outermost
 * samples half a cell inside the tile, leaving a one-cell band across every
 * boundary that each side flat-extrapolates on its own — a step in the
 * sampled field, which a contour then inks as a line the terrain does not
 * have (see `glyphMapGeoTileElevationAt`'s doc and
 * `widget.contourTileBoundary.test.ts`).
 */
function elevationPieceFromTile(tile: GlyphMapGeoTile): GlyphMapElevationPiece {
  const { min, max } = glyphMapGeoTileElevationRange(tile);
  return { min, max, valueAt: (lon, lat) => glyphMapGeoTileElevationAt(tile, lon, lat) };
}

/** A static, already-sampled cell-centered field as an elevation piece. It has no neighbours, so its own edge clamp has nothing to disagree with. */
function elevationPieceFromField(field: GlyphMapField): GlyphMapElevationPiece {
  return { min: field.min, max: field.max, valueAt: (lon, lat) => glyphMapFieldValueAt(field, lon, lat) };
}

async function loadGlyphMapElevationPiece(provider: GlyphMapProvider, z: number, x: number, y: number): Promise<GlyphMapElevationPiece> {
  return elevationPieceFromTile(await provider.loadTile(z, x, y));
}

/**
 * An isoline layer over an elevation field (MAPS.md §13 slice 5): reuses
 * field-synth's `subcellRes: "ink"` contour rule (AGENTS.md), pointed at
 * `source` instead of a synth field — see `stroke.ts`'s `stampGlyphMapContour`.
 * `levels` is one of:
 * - an explicit list of absolute elevation values;
 * - a count `N` of evenly spaced levels across the field's own `min..max`
 *   (excluding both extremes, so neither degenerates to a line along the
 *   field's own edge);
 * - `{ interval }` — every multiple of `interval` elevation units strictly
 *   between the field's `min`/`max` (the cartographic convention: contours
 *   at fixed absolute elevations, e.g. every 500m). Unlike a count, this
 *   stays visually STABLE as the view pans — a count re-spaces its lines to
 *   fill whatever elevation range is currently visible, which makes every
 *   line crawl on every pan; an interval's lines sit at the same fixed
 *   elevations regardless of what's in view, appearing/disappearing at the
 *   domain edges instead of re-flowing.
 *
 * All three are recomputed against whichever field is CURRENTLY resolved
 * when `source` is a provider, since a different tile can carry a different
 * `min`/`max`.
 */
export interface GlyphMapContourLayer {
  readonly type: "contour";
  readonly id?: string;
  readonly source: GlyphMapContourSource;
  readonly levels: number | readonly number[] | { readonly interval: number };
  /**
   * Elevation WINDOW in METRES (the unit every elevation in this package
   * speaks) — a floor and a ceiling, both optional, both omitted by default
   * (byte-identical to declaring no window at all). `minElevation: 0` is
   * land only, `maxElevation: 0` is sea only, `0..2000` is the foothills.
   *
   * It exists because `levels` otherwise resolves against whatever range the
   * mounted mosaic has, and ETOPO1's is roughly -10,900..+8,300 m: a count
   * spends most of its lines on the abyssal plains and leaves land with a
   * handful. Two numbers do strictly more than a land/sea MODE would, and
   * sidestep having to define "land" at all — the Caspian and the Dead Sea
   * are simply below a `0` floor, like anywhere else.
   *
   * It does BOTH halves of that, because either alone is a half-fix:
   *
   * - LEVELS ARE CHOSEN WITHIN THE WINDOW. A count `N` spreads its lines
   *   evenly across the window ∩ the field's own range instead of across
   *   the field's range alone — the part that actually fixes the crowding.
   *   An explicit array and an `{ interval }`'s absolute multiples are
   *   CLIPPED (a level outside the window is dropped), never renumbered:
   *   an interval's whole point is that its lines sit at fixed elevations
   *   and do not crawl as the view pans, which re-deriving them from the
   *   window's own edges would undo.
   * - INK IS CLIPPED TO THE WINDOW. No cell whose own elevation is outside
   *   it inks, even where a level legitimately crosses between it and a
   *   neighbour — see `stampGlyphMapContour`'s own `minElevation` doc for
   *   the sea-cliff case that makes this a separate, necessary gate.
   *
   * An EMPTY window (floor above ceiling, or one the visible field never
   * enters) renders nothing and is not an error — the layer stays mounted
   * and introspectable, and starts drawing again as soon as the view brings
   * terrain inside it. {@link GlyphMapHandle.getContourFieldRange} keeps
   * reporting the field's own DATA range, never the windowed one, so a UI
   * can bound its floor/ceiling controls by what the terrain actually holds
   * (a clipped report would let those controls shrink onto their own last
   * value and never widen back).
   */
  readonly minElevation?: number;
  readonly maxElevation?: number;
  readonly color?: string;
  /**
   * Elevation LABELS on the contour lines — off by default, and byte-identical
   * to before the option existed while off (no extra buffer, no extra pass).
   *
   * Only INDEX contours are labelled (see {@link labelEvery}), the number sits
   * in a GAP in its own line, and placement is chosen where the contour runs
   * near-horizontally on screen and has room — see `stroke.ts`'s
   * {@link GlyphMapContourLabelOptions} for which cartographic conventions
   * this keeps, which it drops, and why. Labels are drawn in the layer's own
   * {@link color}, as USGS prints them in the contour's own brown.
   */
  readonly labels?: boolean;
  /**
   * Label every Nth contour — the INDEX contour interval. Default
   * {@link GLYPH_MAP_CONTOUR_LABEL_EVERY} (5), the paper convention. `1`
   * labels every line.
   *
   * Which lines that picks is anchored to ABSOLUTE elevation wherever the
   * level list itself is (`{ interval }`, and any evenly-spaced explicit
   * array): with `{ interval: 500 }` and the default, the labelled lines are
   * the multiples of 2,500 m and stay so as the view pans, exactly as an
   * interval's own lines do. See {@link glyphMapContourIndexLevels}.
   */
  readonly labelEvery?: number;
  /** See {@link GlyphMapLineLayer.density}'s doc — the same "default follows the annotated surface, a genuine value gets its own viewport overlay" reasoning applies here. */
  readonly density?: number;
}

export interface GlyphMapFillLayer {
  readonly type: "fill"; readonly id?: string; readonly source: GlyphMapVectorSource;
  readonly sourceLayer?: string;
  /** Narrows this layer to a subset of its source's features — see {@link GlyphMapFeatureFilter}. */
  readonly filter?: GlyphMapFeatureFilter;
  readonly color?: string; readonly colorProperty?: string; readonly colors?: Readonly<Record<string, string>>; readonly density?: number;
  /**
   * Per-layer render mode — this layer's mounted mesh(es) rasterize under
   * `renderMode` instead of the scene's own (glyphcss's per-mesh
   * `GlyphMeshTransform.mode`). A map is not one picture in one mode: terrain
   * reads as `solid`, an administrative overlay reads as `ink`. Omitted (the
   * default) = the scene's mode, and so does declaring the mode the scene is
   * already in — both keep this layer in the shared base grid, one pass, byte
   * identical. A genuinely different mode is a full extra rasterizer pass, and
   * `wireframe`/`ink` additionally mount `transparent` (see
   * {@link GLYPH_MAP_EDGE_RENDER_MODES}).
   */
  readonly renderMode?: RenderMode;
  /**
   * Per-layer GLYPH palette — the CHARACTER ramp this layer's mounted mesh(es)
   * shade with (glyphcss's per-mesh `GlyphMeshTransform.glyphPalette`),
   * instead of the scene's own. Distinct axis from a colour ramp: this picks
   * WHICH characters carry the shade, never which colours they are painted
   * in. Solid-mode ramps only, exactly as glyphcss documents — `charMode`,
   * `wireframeJunctions` and `solidWeightRamp` stay scene-level.
   *
   * Omitted (the default) = the scene's ramp, and so does naming the ramp the
   * scene is already on — both keep this layer in the shared base grid, one
   * pass, byte identical. A genuinely different ramp is a full extra
   * rasterizer pass at the BASE cell size (no extra detail), and an opaque one
   * additionally turns on the whole-scene occlusion id-map raster — see
   * {@link glyphMapMeshTransform} for why that escape lives here rather than
   * in glyphcss.
   */
  readonly glyphPalette?: string;
}
export interface GlyphMapSymbolLayer {
  readonly type: "symbol"; readonly id?: string; readonly source: GlyphMapVectorSource;
  readonly sourceLayer?: string;
  /** Narrows this layer to a subset of its source's features — see {@link GlyphMapFeatureFilter}. */
  readonly filter?: GlyphMapFeatureFilter;
  readonly textProperty?: string; readonly priorityProperty?: string; readonly minPriority?: number; readonly color?: string; readonly density?: number;
}
export interface GlyphMapCircleLayer {
  readonly type: "circle"; readonly id?: string; readonly source: GlyphMapVectorSource;
  readonly sourceLayer?: string;
  /** Narrows this layer to a subset of its source's features — see {@link GlyphMapFeatureFilter}. */
  readonly filter?: GlyphMapFeatureFilter;
  readonly radius?: number; readonly radiusProperty?: string; readonly color?: string; readonly density?: number;
  /**
   * Output radius in CSS pixels per unit of {@link radiusProperty} (default
   * `1`, i.e. the property IS the radius — the pre-existing behaviour). A
   * real attribute is never already in pixels: a population column reads
   * `35_676_000`, which without a scale asks for a 35-million-pixel dot. The
   * multiplier lives here rather than being baked into the data because the
   * same baked property has to serve a 6-pixel dot and a 20-pixel one at two
   * different zoom levels or on two different pages.
   *
   * Ignored when `radiusProperty` is absent, and ignored for a feature whose
   * own property value is missing or non-numeric — both fall back to the flat
   * {@link radius} (then `2`), which is a pixel count already.
   */
  readonly radiusScale?: number;
}
export interface GlyphMapHeatmapLayer {
  readonly type: "heatmap"; readonly id?: string; readonly source: GlyphMapVectorSource;
  readonly sourceLayer?: string;
  /** Narrows this layer to a subset of its source's features — see {@link GlyphMapFeatureFilter}. */
  readonly filter?: GlyphMapFeatureFilter;
  readonly radius?: number; readonly weightProperty?: string; readonly colors?: readonly string[]; readonly density?: number; readonly bounds?: GlyphMapBounds;
  /**
   * Relief height in METRES at full (normalized `1`) density — the layer's
   * own vertical unit, lifted through the projection's own `elev` axis like
   * every other elevation in this package, so it exaggerates with the
   * projection exactly as terrain does. Defaults to
   * {@link GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M}, which is what this was as a
   * private constant.
   */
  readonly height?: number;
  /**
   * Normalized density (`0..1`, relative to the frame's own hottest cell)
   * below which a cell emits NO geometry at all, letting whatever is beneath
   * show through. Default `0` — every cell emits, an unbroken sheet over the
   * layer's whole `bounds`, byte-identical to before this option existed.
   *
   * A real point dataset is mostly empty: population is concentrated in a few
   * hundred cells and zero across every ocean. At `0` that renders as an
   * opaque flat sheet AT SEA LEVEL over the entire world, which both hides
   * the terrain layer and z-fights whatever terrain sits within `height` of
   * sea level. A small threshold is what turns the layer back into a heat
   * OVERLAY.
   *
   * Implemented by writing `NaN` into the relief tile's own elevation grid,
   * which {@link glyphMapPolygons} already drops quad-by-quad ("crop, don't
   * clamp"). A grid VERTEX is shared by up to four cells, so it is kept
   * whenever ANY incident cell clears the threshold — a quad therefore
   * survives when all four of its corners have some hot neighbour, i.e. the
   * emitted region is the hot set dilated by one quad and then eroded by
   * one. That deliberately over-draws by about a quad at the edge of a blob
   * rather than eating a ring out of it.
   */
  readonly threshold?: number;
  /**
   * Per-layer render mode — this layer's mounted mesh(es) rasterize under
   * `renderMode` instead of the scene's own (glyphcss's per-mesh
   * `GlyphMeshTransform.mode`). A map is not one picture in one mode: terrain
   * reads as `solid`, an administrative overlay reads as `ink`. Omitted (the
   * default) = the scene's mode, and so does declaring the mode the scene is
   * already in — both keep this layer in the shared base grid, one pass, byte
   * identical. A genuinely different mode is a full extra rasterizer pass, and
   * `wireframe`/`ink` additionally mount `transparent` (see
   * {@link GLYPH_MAP_EDGE_RENDER_MODES}).
   */
  readonly renderMode?: RenderMode;
  /**
   * Per-layer GLYPH palette — the CHARACTER ramp this layer's mounted mesh(es)
   * shade with (glyphcss's per-mesh `GlyphMeshTransform.glyphPalette`),
   * instead of the scene's own. Distinct axis from a colour ramp: this picks
   * WHICH characters carry the shade, never which colours they are painted
   * in. Solid-mode ramps only, exactly as glyphcss documents — `charMode`,
   * `wireframeJunctions` and `solidWeightRamp` stay scene-level.
   *
   * Omitted (the default) = the scene's ramp, and so does naming the ramp the
   * scene is already on — both keep this layer in the shared base grid, one
   * pass, byte identical. A genuinely different ramp is a full extra
   * rasterizer pass at the BASE cell size (no extra detail), and an opaque one
   * additionally turns on the whole-scene occlusion id-map raster — see
   * {@link glyphMapMeshTransform} for why that escape lives here rather than
   * in glyphcss.
   */
  readonly glyphPalette?: string;
}

/** Heatmap density is unitless after normalization; render it as bounded physical relief. */
const GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M = 1_000;
/**
 * A deliberate, small, constant lift (raw metres, pre-exaggeration — same
 * unit as `GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M`) added ON TOP of terrain
 * elevation everywhere, including where density is 0. Without it, a
 * zero-density cell's surface sits EXACTLY on the terrain's own mesh —
 * two independently-meshed surfaces (different grid resolutions, different
 * source data) sharing one depth would z-fight per cell as the camera
 * moves, which reads as shimmering and is a worse defect than the
 * "floating" bug this lift exists to help fix. It is small enough (1% of
 * the default relief height) to be visually indistinguishable from "on the
 * surface" at any reasonable exaggeration, while comfortably exceeding the
 * ~1m vertical resolution of a typical baked elevation grid (ETOPO1 is
 * whole metres), so it is never itself lost to source-data quantization.
 */
const GLYPH_MAP_HEATMAP_SURFACE_LIFT_M = 10;
export interface GlyphMapFillExtrusionLayer {
  readonly type: "fill-extrusion"; readonly id?: string; readonly source: GlyphMapVectorSource;
  readonly sourceLayer?: string;
  /** Narrows this layer to a subset of its source's features — see {@link GlyphMapFeatureFilter}. */
  readonly filter?: GlyphMapFeatureFilter;
  readonly heightProperty?: string;
  /**
   * The property carrying this feature's own base OFFSET in TRUE METRES above
   * the ground — OSM's `min_height` (the default) or OpenMapTiles'
   * `render_min_height`, i.e. how far up its own footing the drawn part of a
   * structure starts, the way a tower begins at the top of a podium.
   *
   * It is NOT a ground elevation, and naming it `baseOffsetProperty` rather
   * than `baseProperty` is the point: the GROUND an extrusion stands on comes
   * from the terrain under it (the mounted `raster` layers' own tiles), never
   * from a feature attribute. Feeding `min_height` in as an absolute terrain
   * elevation conflated two different quantities and, with any raster layer
   * mounted, planted every building at sea level — a 60 m block over 400 m of
   * ground drew not one cell.
   *
   * Being a STRUCTURE measurement it takes the same exemption from the
   * terrain's `exaggeration` that {@link height} takes; the ground under it
   * does not (see `glyphMapVectorMesh`'s `groundElevation`).
   *
   * **This and {@link heightProperty} share ONE datum: both are measured from
   * the ground, and the drawn wall band spans base → height** — MapLibre's
   * own `fill-extrusion-base`/`fill-extrusion-height` pair, and OSM's own
   * `min_height`/`height` pair, where a `building:part` tagged
   * `min_height=115, height=277` is the piece of the structure BETWEEN those
   * two elevations. So this layer converts to `glyphMapVectorMesh`'s own
   * primitive (a thickness measured up from the offset) by SUBTRACTING, and
   * `max(0, …)` clamps the degenerate rows real data carries — measured, 5 of
   * 629 non-zero `render_min_height` features across five live OpenFreeMap
   * z14 city tiles have `render_height` below their own base.
   *
   * Adding instead is what makes a stepped structure grow rather than stack:
   * the Eiffel Tower's 35 OpenMapTiles parts would put its 24 m spire section
   * (`115 → 277 m`) at 115 → 392 m and its summit (`300 → 330 m`) at
   * 300 → 630 m.
   *
   * Scaled by {@link heightScale} exactly as {@link heightProperty} is: under
   * one datum the two are the same quantity in the same frame, so a stylised
   * 3x skyline has to move a part's base and its top together or the part
   * detaches from the one below it.
   */
  readonly baseOffsetProperty?: string;
  /**
   * Flat extrusion height in TRUE METRES for every feature with no usable
   * {@link heightProperty} value — rendered at true scale whatever the
   * projection's terrain `exaggeration` is, exactly like a property-driven
   * height (see `glyphMapVectorMesh`'s own `height` option for why). Authoring
   * a taller skyline here is just typing a bigger number: this is a literal,
   * not measured data, so it needs no scale knob of its own.
   */
  readonly height?: number;
  readonly color?: string; readonly density?: number;
  /**
   * Metres of extrusion per unit of {@link heightProperty} (default `1`, i.e.
   * the property IS a height in metres — the pre-existing behaviour). Same
   * reason {@link GlyphMapCircleLayer.radiusScale} exists: a real attribute
   * (a population, a GDP, a count) is not already in the layer's output unit,
   * and the conversion belongs to the layer rather than to the baked data,
   * which has to serve more than one view scale.
   *
   * Applied to the property values only — {@link heightProperty} AND
   * {@link baseOffsetProperty}, which share one datum and so have to move
   * together. The flat {@link height} fallback is already metres and is NOT
   * scaled, so a layer with no `heightProperty` is untouched by this.
   *
   * This is ALSO the deliberate opt-in for a stylised skyline, and the reason
   * there is no second "extrusion exaggeration" option beside it. Extrusion
   * heights render at TRUE metres (terrain `exaggeration` is a terrain
   * concept and never reaches them), so a caller who wants OSM's
   * `render_height` drawn 24x tall sets `heightScale: 24` — "24 metres of
   * extrusion per metre of building" is the same multiply a unit conversion
   * performs, on the same quantity, and splitting it into two options that
   * multiply the identical number would only make their product ambiguous.
   */
  readonly heightScale?: number;
  /**
   * Per-layer render mode — this layer's mounted mesh(es) rasterize under
   * `renderMode` instead of the scene's own (glyphcss's per-mesh
   * `GlyphMeshTransform.mode`). A map is not one picture in one mode: terrain
   * reads as `solid`, an administrative overlay reads as `ink`. Omitted (the
   * default) = the scene's mode, and so does declaring the mode the scene is
   * already in — both keep this layer in the shared base grid, one pass, byte
   * identical. A genuinely different mode is a full extra rasterizer pass, and
   * `wireframe`/`ink` additionally mount `transparent` (see
   * {@link GLYPH_MAP_EDGE_RENDER_MODES}).
   */
  readonly renderMode?: RenderMode;
  /**
   * Per-layer GLYPH palette — the CHARACTER ramp this layer's mounted mesh(es)
   * shade with (glyphcss's per-mesh `GlyphMeshTransform.glyphPalette`),
   * instead of the scene's own. Distinct axis from a colour ramp: this picks
   * WHICH characters carry the shade, never which colours they are painted
   * in. Solid-mode ramps only, exactly as glyphcss documents — `charMode`,
   * `wireframeJunctions` and `solidWeightRamp` stay scene-level.
   *
   * Omitted (the default) = the scene's ramp, and so does naming the ramp the
   * scene is already on — both keep this layer in the shared base grid, one
   * pass, byte identical. A genuinely different ramp is a full extra
   * rasterizer pass at the BASE cell size (no extra detail), and an opaque one
   * additionally turns on the whole-scene occlusion id-map raster — see
   * {@link glyphMapMeshTransform} for why that escape lives here rather than
   * in glyphcss.
   */
  readonly glyphPalette?: string;
  /**
   * Texture this layer's WALLS with a tiling facade — window bays across, floor
   * bands up — derived from each wall's own real length and the feature's own
   * `heightProperty` metres.
   *
   * `true` uses the built-in generated tile ({@link glyphMapFacadeTexture},
   * registered by the widget itself, no image fetch); an object supplies the
   * bay/floor rhythm, or another texture key the caller has already put on the
   * scene through `scene.setTextureSamplers`. Omitted/`false` (the default)
   * leaves the walls flat and is byte-identical.
   *
   * This is the difference between a block of buildings reading as a street and
   * reading as two tones and a wedge: at eye height an untextured flat-roofed
   * box shows one or two faces, each one Lambert value, and glyphcss picks one
   * glyph for the whole of it. A texel modulates the GLYPH as well as the
   * colour, so the window rhythm arrives as character variety and does not
   * depend on `useColors`.
   */
  readonly facade?: boolean | GlyphMapFacadeOptions;
  /**
   * Deterministic per-feature colour variation around {@link color}, `0`
   * (the default, and byte-identical) to `1`.
   *
   * A crowd of buildings drawn in one colour is one silhouette; giving each its
   * own tone is the cheapest separation available on this layer, because it is
   * a colour and not a second rasterizer pass. Seeded from each FOOTPRINT's own
   * identity ({@link glyphMapFeatureSeed}), so a building keeps its colour
   * across re-tiles, pans and projection changes — and, on a real OSM pyramid
   * that merges attribute-identical buildings into ONE multipolygon feature,
   * so that two neighbours get two colours at all.
   */
  readonly colorVariation?: number;
}
export interface GlyphMapModelLayer {
  readonly type: "model"; readonly id?: string; readonly polygons: readonly Polygon[]; readonly density?: number;
  readonly attribution?: readonly GlyphMapAttribution[];
  /**
   * Per-layer render mode — this layer's mounted mesh(es) rasterize under
   * `renderMode` instead of the scene's own (glyphcss's per-mesh
   * `GlyphMeshTransform.mode`). A map is not one picture in one mode: terrain
   * reads as `solid`, an administrative overlay reads as `ink`. Omitted (the
   * default) = the scene's mode, and so does declaring the mode the scene is
   * already in — both keep this layer in the shared base grid, one pass, byte
   * identical. A genuinely different mode is a full extra rasterizer pass, and
   * `wireframe`/`ink` additionally mount `transparent` (see
   * {@link GLYPH_MAP_EDGE_RENDER_MODES}).
   */
  readonly renderMode?: RenderMode;
  /**
   * Per-layer GLYPH palette — the CHARACTER ramp this layer's mounted mesh(es)
   * shade with (glyphcss's per-mesh `GlyphMeshTransform.glyphPalette`),
   * instead of the scene's own. Distinct axis from a colour ramp: this picks
   * WHICH characters carry the shade, never which colours they are painted
   * in. Solid-mode ramps only, exactly as glyphcss documents — `charMode`,
   * `wireframeJunctions` and `solidWeightRamp` stay scene-level.
   *
   * Omitted (the default) = the scene's ramp, and so does naming the ramp the
   * scene is already on — both keep this layer in the shared base grid, one
   * pass, byte identical. A genuinely different ramp is a full extra
   * rasterizer pass at the BASE cell size (no extra detail), and an opaque one
   * additionally turns on the whole-scene occlusion id-map raster — see
   * {@link glyphMapMeshTransform} for why that escape lives here rather than
   * in glyphcss.
   */
  readonly glyphPalette?: string;
}

/** Every multiple of `interval` strictly between `min` and `max` (both exclusive, matching the `N`-count variant's own "never a line along the field's own edge" convention). Exported so a caller (e.g. a UI readout) can preview the level COUNT an `{ interval }` value will produce without re-deriving this math. */
export function glyphMapContourIntervalLevels(interval: number, min: number, max: number): readonly number[] {
  if (!(interval > 0)) throw new RangeError(`glyphcss/maps: contour "levels.interval" must be > 0 (got ${interval}).`);
  const first = Math.floor(min / interval) * interval + interval;
  const out: number[] = [];
  for (let v = first; v < max; v += interval) out.push(v);
  return out;
}

/** Default INDEX-contour interval: label every 5th line, the USGS/paper convention. */
export const GLYPH_MAP_CONTOUR_LABEL_EVERY = 5;
/** Declutter padding for contour labels, in cells. `X` doubles as the repetition spacing along one line (see {@link glyphMapDeclutterLabels}); `Y` keeps two labels off adjacent rows. */
export const GLYPH_MAP_CONTOUR_LABEL_PAD_X = 12;
export const GLYPH_MAP_CONTOUR_LABEL_PAD_Y = 1;

/**
 * The INDEX contours of a resolved level list — the subset that gets
 * labelled, `every`th line, drawn from `levels`.
 *
 * `step` is the list's own nominal spacing (an `{ interval }`'s interval, a
 * count's even spacing, an explicit array's smallest positive gap). Selection
 * is by a level's ORDINAL on the absolute ladder `Math.round(level / step)`,
 * not by its position in the array, and that distinction is the whole point:
 * an ordinal is a property of the ELEVATION, so for a list that already sits
 * at fixed absolute elevations (`{ interval: 500 }` → the multiples of
 * 2,500 m at the default `every`) the labelled lines never move as the view
 * pans, appearing and disappearing at the domain edges exactly like the lines
 * themselves. A position-in-array rule would instead renumber the whole
 * ladder every time the visible range gained or lost a line at one end, and
 * every label on the map would jump to a different contour.
 *
 * For a count-based list — whose levels already re-space themselves with the
 * visible range, by design — ordinals are still consecutive integers, so this
 * picks a genuine every-Nth subset there too.
 *
 * Returning `levels` unchanged when NOTHING qualifies is deliberate and is
 * the short-authored-array case: `[1000, 3000]` sits on no `every`-th rung of
 * its own ladder, and silently labelling none of a two-line map is worse than
 * labelling both.
 */
export function glyphMapContourIndexLevels(levels: readonly number[], step: number, every: number): readonly number[] {
  if (!(every > 1) || !(step > 0) || !Number.isFinite(step)) return levels;
  const picked = levels.filter((level) => Math.round(level / step) % every === 0);
  return picked.length > 0 ? picked : levels;
}

export type GlyphMapLayer = GlyphMapBackgroundLayer | GlyphMapRasterLayer | GlyphMapLineLayer | GlyphMapContourLayer | GlyphMapFillLayer | GlyphMapSymbolLayer | GlyphMapCircleLayer | GlyphMapHeatmapLayer | GlyphMapFillExtrusionLayer | GlyphMapModelLayer;

/**
 * A feature's TOP, in true metres above the ground it stands on — the
 * `heightProperty` value in the layer's own units, or the flat
 * {@link GlyphMapFillExtrusionLayer.height} fallback when the property is
 * missing or unparseable (OSM tags carry `"20 m"` and worse, and one bad row
 * must not NaN a whole building out of the render).
 */
function extrusionTopMetres(layer: GlyphMapFillExtrusionLayer, feature: GlyphMapVectorFeature): number {
  const raw = Number(feature.properties?.[layer.heightProperty ?? "height"]);
  return Number.isFinite(raw) ? raw * (layer.heightScale ?? 1) : layer.height ?? 0;
}

/**
 * A feature's BASE, on the same datum {@link extrusionTopMetres} reads — true
 * metres above the ground, not a terrain elevation. See
 * {@link GlyphMapFillExtrusionLayer.baseOffsetProperty}.
 */
function extrusionBaseMetres(layer: GlyphMapFillExtrusionLayer, feature: GlyphMapVectorFeature): number {
  const raw = Number(feature.properties?.[layer.baseOffsetProperty ?? "min_height"] ?? 0);
  return Number.isFinite(raw) ? raw * (layer.heightScale ?? 1) : 0;
}

/**
 * `GlyphTransformCellsLayer.cellToSceneGrid`'s own shape: the affine mapping
 * a CellGrid's own cell coordinates to the scene's BASE grid cell
 * coordinates (`sceneCol = a*col + e`, `sceneRow = d*row + f`, encoded
 * `[a, 0, 0, d, e, f]`). A stroke layer needs this in BOTH directions: `line`
 * projects world geometry into scene coordinates once (`camera.project`
 * always returns SCENE-space col/row, regardless of which grid it will be
 * stamped into — glyphcss's own `GlyphProjectionMetrics` carries no "which
 * grid" concept) and then needs the INVERSE to place a vertex into whichever
 * grid is currently being stamped; `contour` walks a grid's own LOCAL cells
 * and needs the FORWARD direction to recover the scene coordinate `unproject`
 * understands.
 */
type GlyphMapCellAffine = readonly [number, number, number, number, number, number];
const GLYPH_MAP_IDENTITY_CELL_AFFINE: GlyphMapCellAffine = [1, 0, 0, 1, 0, 0];

/** Scene/base-grid (col,row) → a grid's own LOCAL (col,row) — the inverse of `cellToSceneGrid`'s forward mapping. */
function glyphMapSceneToLocalCell(sceneCol: number, sceneRow: number, affine: GlyphMapCellAffine): { readonly col: number; readonly row: number } {
  return { col: (sceneCol - affine[4]) / affine[0], row: (sceneRow - affine[5]) / affine[3] };
}

/** A grid's own LOCAL (col,row) → scene/base-grid (col,row) — `cellToSceneGrid`'s own forward direction. */
function glyphMapLocalCellToScene(col: number, row: number, affine: GlyphMapCellAffine): { readonly col: number; readonly row: number } {
  return { col: affine[0] * col + affine[4], row: affine[3] * row + affine[5] };
}

/**
 * A layer kind whose rendering is post-raster CellGrid stamping rather than
 * mesh mounting — composed into ONE `transformCells` hook (see
 * `createGlyphMap`'s "stroke layers" section). `stamp` is called once per
 * output grid the scene produces (the base grid, then each per-mesh detail
 * grid) — `cellToSceneGrid` is THAT grid's own affine, letting one
 * line/contour layer stay correctly positioned and depth-tested against
 * every grid it crosses. `baseGrid` is a SNAPSHOT of `projectionGrid()`
 * taken at the base grid's own hook call (before this render's detail
 * layers exist) — `stamp` MUST use it instead of calling the live
 * `projectionGrid()`/`camera.project` itself: glyphcss temporarily mutates
 * the shared `camera` object's `zoom`/`center` to reproject EACH detail
 * mesh into its own grid, and that mutated state is still live exactly
 * while THIS hook runs for that mesh's own detail grid — reading the live
 * camera there projects world geometry through the WRONG (detail-layer)
 * center instead of the scene's true base framing (measured: a "flat"
 * mesh's own detail grid, off-center from the view, converted stroke
 * vertices hundreds of cells off — silently outside the grid's own bounds,
 * so nothing rendered, no error).
 */
interface StrokeLayerRuntime {
  update(): Promise<void>;
  stamp(grid: CellGrid, cellToSceneGrid: GlyphMapCellAffine, baseGrid: ProjectionGrid): void;
  dispose(): void;
}

/** A contour layer's runtime additionally exposes the elevation range of whichever field is CURRENTLY resolved — read-only introspection for {@link GlyphMapHandle.getContourFieldRange}. */
interface ContourLayerRuntime extends StrokeLayerRuntime {
  getFieldRange(): { readonly min: number; readonly max: number } | null;
}

// ── Markers ────────────────────────────────────────────────────────────

export interface GlyphMapMarkerOptions {
  readonly at: readonly [lon: number, lat: number];
  readonly label?: string;
  /**
   * Meters, passed straight through as `projection.project(lon, lat,
   * elevation)`'s third argument — the SAME axis `glyphMapPolygons` lifts
   * relief along, so a marker lifts along the locally-correct "up"
   * direction (world Z for a flat sheet, sphere-radial for the globe) with
   * no separate label-anchoring concept needed. Default `0` (exactly at the
   * geographic point, Leaflet's convention).
   */
  readonly elevation?: number;
}

export interface GlyphMapMarkerHandle {
  remove(): void;
  readonly el: HTMLElement;
}

// ── Events ─────────────────────────────────────────────────────────────

export interface GlyphMapClickEvent {
  readonly type: "click";
  /** `null` when the click landed off any projected surface (e.g. past a globe's silhouette). */
  readonly lngLat: readonly [number, number] | null;
  readonly originalEvent: PointerEvent;
}

export interface GlyphMapViewEvent {
  readonly type: "move" | "zoom";
  readonly view: GlyphMapView;
}

export interface GlyphMapLoadEvent {
  readonly type: "load";
}

export interface GlyphMapSunEvent {
  readonly type: "sun";
  /** The instant the sun was resolved at — `Date.now()` in `"realtime"`, the pinned {@link GlyphMapSunOptions.date} in `"manual"`. */
  readonly at: number;
  readonly subsolar: GlyphMapSolarPosition;
  /** The directional-light source vector for an ORBIT projection, or `null` for a sheet (which has no directional-light terminator — see `sun.ts`). */
  readonly direction: Vec3 | null;
}

export type GlyphMapEvent = GlyphMapClickEvent | GlyphMapViewEvent | GlyphMapLoadEvent | GlyphMapSunEvent;
export type GlyphMapEventHandler<E extends GlyphMapEvent = GlyphMapEvent> = (event: E) => void;

// ── project()/unproject() ─────────────────────────────────────────────

export interface GlyphMapProjectResult {
  readonly col: number;
  readonly row: number;
  /** Front-hemisphere per `projection.visible` (always `true` for a flat projection, which excludes an invisible point via `project()` returning `NaN`), AND within the output grid. */
  readonly visible: boolean;
}

// ── Options / handle ───────────────────────────────────────────────────

/**
 * Where the sun is.
 *
 * - `"off"` (the default) — the widget never touches lighting at all: the
 *   scene's own `directionalLight` is whatever the consumer set, no timer
 *   runs, and the `transformCells` hook is not installed on the sun's
 *   account. Byte-identical to every render before this option existed.
 * - `"realtime"` — the sun's TRUE current position, re-resolved on a
 *   wall-clock timer ({@link GlyphMapSunOptions.tickMs}) so the terminator
 *   keeps advancing (15 deg of longitude per hour) with no further input.
 * - `"manual"` — the sun at one pinned instant ({@link GlyphMapSunOptions.date}),
 *   frozen there. No timer runs.
 */
export type GlyphMapSunMode = "off" | "realtime" | "manual";

/**
 * Real-sun lighting. The MECHANISM is chosen by projection CAPABILITY, never
 * by `projection.id` — see `sun.ts`'s header:
 * - ORBIT projection (`cameraForCenter` present — the globe): the widget
 *   writes the scene's `directionalLight.direction` as the outward unit
 *   vector at the subsolar point, and glyphcss's own Lambert shading
 *   produces a real terminator, correctly tilted for the season.
 *   `intensity`/`color` are left exactly as the consumer set them.
 * - SHEET projection: one surface normal everywhere means a directional
 *   light can only dim the whole map uniformly, so instead a per-cell
 *   day/night term is stamped through the same single `transformCells` hook
 *   `line`/`contour` layers already share.
 *
 * Leaving `"realtime"`/`"manual"` for `"off"` stops the widget updating the
 * light; it deliberately does NOT restore some earlier direction (the
 * consumer owns that value and may have changed its intensity/colour
 * meanwhile — re-apply your own).
 */
export interface GlyphMapSunOptions {
  readonly mode?: GlyphMapSunMode;
  /** The instant `"manual"` mode is pinned to (a `Date` or epoch ms). Ignored in the other two modes. Defaults to the widget's construction time. */
  readonly date?: Date | number;
  /** Wall-clock cadence of `"realtime"` re-resolution, ms. Default {@link GLYPH_MAP_SUN_TICK_MS}. */
  readonly tickMs?: number;
  /** Sheet-projection terminator softness — solar-altitude half-width of the twilight ramp, degrees. Default `GLYPH_MAP_SUN_TWILIGHT_DEG`. */
  readonly twilightDeg?: number;
  /** Sheet-projection terminator depth, `0..1`. Default `GLYPH_MAP_NIGHT_OPACITY`. */
  readonly nightOpacity?: number;
  /** `#rrggbb` the sheet-projection night side is blended toward. Default `"#000000"`. */
  readonly nightColor?: string;
  /** Discrete darkness levels in the sheet-projection terminator. Default `GLYPH_MAP_NIGHT_LEVELS` — a PERFORMANCE knob (fewer levels = longer same-colour runs = fewer spans), see that constant's own measured table. */
  readonly nightLevels?: number;
}

/** {@link GlyphMapHandle.getSun}'s fully-resolved answer — every field defaulted, `date` normalized to epoch ms. */
export interface GlyphMapSunState {
  readonly mode: GlyphMapSunMode;
  readonly date: number;
  readonly tickMs: number;
  readonly twilightDeg: number;
  readonly nightOpacity: number;
  readonly nightColor: string;
  readonly nightLevels: number;
}

/**
 * How often `"realtime"` re-resolves the sun. The subsolar point moves
 * 0.25 deg of longitude per MINUTE, so 30 s is 0.125 deg — about a twelfth
 * of a cell at a world view, i.e. visually continuous — while costing two
 * re-renders a minute on an otherwise idle map. Driving this from the render
 * loop instead would be wrong in the other direction: a lighting change
 * forces a re-render, so a per-frame sun would pin the CPU on a still map
 * forever.
 */
export const GLYPH_MAP_SUN_TICK_MS = 30_000;

/**
 * Who aims the scene's key light.
 *
 * - `"fixed"` (the default) — nobody here does. The scene's
 *   `directionalLight.direction` is whatever the consumer set and the widget
 *   never writes it, byte-identical to every render before this option
 *   existed. (A `sun` in `"realtime"`/`"manual"` still owns the direction on
 *   an orbit projection; that is the sun's own contract and predates this.)
 * - `"headlight"` — the direction is the camera's OWN view axis, rewritten
 *   whenever the camera moves. On a globe this is the "everything lit"
 *   framing: the face you are looking at is lit edge to edge with no
 *   terminator anywhere, while Lambert still varies with each face's own
 *   normal, so terrain relief stays legible. Compare pure ambient, which
 *   also removes the terminator but gives every face the SAME shade and so
 *   erases relief entirely (rendered and pinned in
 *   `widget.headlight.test.ts`).
 *
 * Like the sun, this writes `direction` ONLY — `intensity` and `color` stay
 * exactly as the consumer set them, so a headlight and a consumer-owned key
 * light never fight over the same field.
 */
export type GlyphMapKeyLightMode = "fixed" | "headlight";

/**
 * The key-light source vector for a camera at `(rotXDeg, rotYDeg)` — i.e.
 * the unit vector from a shaded surface TOWARD the camera, which is
 * glyphcss's own directional-light convention (AGENTS.md, "Numeric
 * conventions": `direction` points from the surface toward the light).
 *
 * `createGlyphOrthographicCamera` rotates a world vector by `rotZ(rotY)` then
 * `rotX(rotX)` under the axis swap `world[0] -> CSS y, world[1] -> CSS x`,
 * and its projected DEPTH is `r[2] = (v1 sinY + v0 cosY) sinX + v2 cosX`
 * with larger = nearer. Depth is therefore LINEAR in the world point, so the
 * direction that increases it fastest — the direction the camera lies in —
 * is exactly that functional's gradient:
 *
 *     n = (sin rotX cos rotY, sin rotX sin rotY, cos rotX)
 *
 * already a unit vector. This is the same `n` `glyphMapGlobe.cameraForCenter`
 * inverts to place a view centre, which is the cross-check
 * `widget.headlight.test.ts` uses: the headlight at the camera framing for
 * `(lon, lat)` equals the SUN direction for a subsolar point at `(lon, lat)`.
 */
export function glyphMapHeadlightDirection(rotXDeg: number, rotYDeg: number): Vec3 {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const sinX = Math.sin(rx);
  return [sinX * Math.cos(ry), sinX * Math.sin(ry), Math.cos(rx)];
}

export interface GlyphMapOptions {
  readonly view: GlyphMapView;
  readonly projection: GlyphMapProjection;
  readonly layers?: readonly GlyphMapLayer[];
  /**
   * Per-gesture opt-outs. Each defaults to `true`.
   *
   * `tilt` is the Ctrl+drag / right-button-drag ORIENT gesture — its own
   * surface, independent of `drag`: a map that pins its centre (`drag:
   * false`) may still want the reader to be able to look across it, and a
   * map that must never leave its one pitch can keep panning.
   *
   * ONE flag covers both axes of that one stroke — VERTICAL travel is pitch
   * ({@link GLYPH_MAP_TILT_DRAG_DEG_PER_PX}), HORIZONTAL is bearing
   * ({@link GLYPH_MAP_BEARING_DRAG_DEG_PER_PX}) — because it is one press
   * and one stroke: a diagonal drag under two separate opt-outs would do
   * half of what the hand asked for, and no map product splits them either.
   */
  readonly controls?: { readonly drag?: boolean; readonly wheel?: boolean; readonly tilt?: boolean };
  /** Forwarded to the underlying `createGlyphScene` as-is. Default `false` — `view.cols`/`view.rows` are the authoritative grid (MAPS.md §3b: the view, not host pixels, owns the grid shape); `true` lets host resize drive `cols`/`rows` the way both example pages did. */
  readonly autoSize?: boolean;
  /** Smallest `view.span` (degrees) reachable by wheel-zoom or `setView`. Default `0.001`. */
  readonly minSpan?: number;
  /**
   * Largest `view.span` (degrees) reachable by wheel-zoom. Values beyond the
   * projection's domain width leave an overview margin around the complete
   * map or globe.
   *
   * Setting this OPTS OUT of the cover rule entirely (see
   * {@link GlyphMapHandle.getMaxSpan}), for both the span and the pan
   * clamp — "overview margin" is exactly the background cover exists to
   * remove, so the two cannot both hold and the explicit request wins.
   * Omitted (the default), a SHEET projection's ceiling is the cover limit
   * and an ORBIT projection's is its domain width, as before.
   */
  readonly maxSpan?: number;
  /**
   * Camera pitch, degrees — a rotation ABOUT THE SURFACE POINT UNDER THE
   * VIEW CENTRE, so `view.center` stays at the centre of the grid at every
   * pitch and every span. See {@link GlyphMapHandle.setTilt} for the model
   * and {@link GlyphMapHandle.getMaxTilt} for the ceiling it is clamped to.
   *
   * A SHEET projection (no `cameraForCenter`) has no view-driven base
   * orientation, so `tilt` there IS the total `camera.rotX` (default `40`).
   * An ORBIT projection (the globe) has one — `cameraForCenter(lon, lat)` —
   * that `tilt` ADDS to (default `0`, i.e. head-on).
   */
  readonly tilt?: number;
  /**
   * Camera heading, degrees — the compass direction that points UP on
   * screen, `0` (the default) being north up. A rotation about the SURFACE
   * NORMAL at the same pivot `tilt` pitches about, so the horizon stays
   * level at every pitch. See {@link GlyphMapHandle.setBearing}.
   */
  readonly bearing?: number;
  /** Forwarded to `createGlyphScene`, merged UNDER the widget's own `camera`/`cols`/`rows`/`autoSize` — this is how shading, `colorEncoding`, shadows, etc. compose (MAPS.md §9: "no new scene concepts"). */
  readonly scene?: Partial<GlyphSceneOptions>;
  /** Real-sun lighting. Omitted (the default) is `{ mode: "off" }` — see {@link GlyphMapSunOptions}. */
  readonly sun?: GlyphMapSunOptions;
  /** Who aims the scene's key light. Omitted (the default) is `"fixed"` — the widget never writes it. See {@link GlyphMapKeyLightMode}. */
  readonly keyLight?: GlyphMapKeyLightMode;
  /** Cast shadows. Omitted or `null` (the default) is OFF, and byte-identical to a map built before this option existed. See {@link GlyphMapShadowOptions}. */
  readonly shadow?: GlyphMapShadowOptions | null;
}

/**
 * Cast shadows for the map's standing geometry — buildings and models onto
 * the ground they stand on.
 *
 * Off unless asked for. What the widget contributes on top of glyphcss's own
 * `shadow` scene option is the two things a caller here cannot compute:
 * WHICH layers cast and which receive ({@link GLYPH_MAP_SHADOW_CASTERS}),
 * and a depth bias in the map's own world units ({@link
 * GLYPH_MAP_SHADOW_LIFT}) — glyphcss's default `lift` of `0.05` is 5% of the
 * globe's radius, ~318 km of terrain, which erases every shadow this feature
 * could draw. `color` and `opacity` pass straight through.
 *
 * The DIRECTION is not here, and must not be: shadows are cast along the
 * scene's own `directionalLight.direction`, which is exactly the vector the
 * sun / headlight / the consumer's own slider already own (AGENTS.md's
 * "Camera-following key light"). One vector lights the scene and casts its
 * shadows, so the two can never disagree.
 */
export interface GlyphMapShadowOptions {
  /** Shadow tint. Omitted = glyphcss's own `"#000000"`. */
  readonly color?: string;
  /** Darkness, 0..1 toward `color`. Omitted = glyphcss's own `0.25`. */
  readonly opacity?: number;
  /** Depth bias in the projection's own world units. Omitted = {@link GLYPH_MAP_SHADOW_LIFT}. */
  readonly lift?: number;
}

export interface GlyphMapSetProjectionOptions {
  /** Animation length, ms. `0` applies the target instantly (no animation frame at all). Default {@link GLYPH_MAP_PROJECTION_TRANSITION_DEFAULT_MS}. */
  readonly durationMs?: number;
}

/** Where a {@link GlyphMapHandle.flyTo} flight ends: a centre and/or span, or a box to frame (the same framing `fitBounds` computes). */
export type GlyphMapFlyToTarget =
  | { readonly center?: readonly [number, number]; readonly span?: number; readonly bounds?: undefined }
  | { readonly bounds: GlyphMapBounds; readonly center?: undefined; readonly span?: undefined };

export interface GlyphMapFlyToOptions {
  /** Flight length, ms. `0` applies the target instantly. Default {@link GLYPH_MAP_FLY_TO_DEFAULT_MS}. */
  readonly durationMs?: number;
  /**
   * How far the flight is allowed to zoom OUT at mid-arc, as a multiple of
   * the larger endpoint span. `1` flies at a straight log-span interpolation
   * (no bow). Default {@link GLYPH_MAP_FLY_TO_MAX_BOW}; see
   * {@link GlyphMapHandle.flyTo} for why the bow exists.
   */
  readonly bow?: number;
}

export interface GlyphMapHandle {
  readonly host: HTMLElement;
  /** The underlying scene this widget owns. Escape hatch for anything not modeled above (mesh finders, effect layers, direct camera reads). */
  readonly scene: GlyphSceneHandle;
  setView(view: Partial<GlyphMapView>): void;
  getView(): GlyphMapView;
  /**
   * The largest `view.span` this widget will currently accept — the live
   * ceiling `setView`/`fitBounds`/wheel-zoom all clamp to, so a consumer
   * driving a span SLIDER can bound it to what the map can actually show
   * instead of offering a range that silently snaps back.
   *
   * For a SHEET projection this is the COVER limit: the span at which the
   * projected map still fills the viewport on BOTH axes, so no page
   * background is ever visible around the edges. It moves with the host's
   * shape, the camera `tilt` and the projection (and, where a projection's
   * scale varies across its domain — orthographic — with `view.center`), so
   * it must be re-read rather than cached. For an ORBIT projection (the
   * globe) there is no cover limit at all — a globe legitimately floats in
   * space — and this is the projection's domain width, exactly as before;
   * an explicit {@link GlyphMapOptions.maxSpan} replaces both outright.
   * During a `setProjection` flight it is already the DESTINATION's
   * limit, so a mid-flight zoom cannot land somewhere the flight's own end
   * would have to snap away from.
   */
  getMaxSpan(): number;
  fitBounds(bounds: GlyphMapBounds): void;
  /**
   * Live camera pitch. ONE rule at both scales and for both projection
   * families: PITCH ABOUT THE SURFACE POINT UNDER THE VIEW CENTRE, with the
   * pivot distance equal to the camera's altitude — what Google Earth and
   * Cesium do. `map.project(map.getView().center)` therefore lands at the
   * centre of the grid at every pitch and every span
   * (`widget.tiltPivot.test.ts`), and the two regimes fall out of the one
   * rule with no mode switch and no threshold: zoomed OUT the pivot is far
   * below the camera relative to the view, so pitching swings the globe and
   * the limb comes into frame tangentially; zoomed IN the pivot is directly
   * beneath, so pitching reads as raising your head off the ground, which is
   * what makes 3D buildings legible.
   *
   * Under glyphcss's ORTHOGRAPHIC camera the pivot's distance along the view
   * axis is unobservable — the camera has no position, only an orientation
   * and the world point at screen centre (`createGlyphCamera.ts`'s
   * `project` is `R * (v - target)`, so a shift of `target` along the view
   * axis moves depth by a constant and col/row by nothing at all). The
   * "pivot at the camera's altitude" clause is therefore degenerate here and
   * the model reduces EXACTLY to "the surface point stays at screen centre",
   * i.e. `camera.target = projection.project(lon, lat, 0)`. That is what a
   * SHEET projection has always done, so one implementation serves both and
   * the sheet path is untouched — a plane is the degenerate case of the same
   * rule, and its `tilt` is still the total `camera.rotX`.
   *
   * There is no third rotational degree of freedom being invented: composing
   * an extra `rotateX(tilt)` after `cameraForCenter`'s own rotation is
   * mathematically identical to shifting `rotX` by `tilt` (both rotations
   * share the same post-`rotY` local X axis, and rotations about one axis
   * add — `rotateVec3Voxcss`, `packages/glyphcss/src/api/
   * createGlyphCamera.ts`); only the PIVOT changed. `applyDragState` still
   * subtracts the applied pitch back out before calling `centerForCamera`,
   * so `view.center` reports the point the viewer is looking at rather than
   * the camera's own axis.
   *
   * The request is CLAMPED to {@link getMaxTilt}, so `getTilt()` can report
   * less than what was passed at a wide view. The request itself is
   * remembered: zooming back in restores the full pitch rather than making
   * the caller re-ask for it.
   */
  setTilt(tilt: number): void;
  /** The pitch the camera actually has right now — the {@link setTilt} request clamped to {@link getMaxTilt}. */
  getTilt(): number;
  /**
   * The steepest pitch this view can hold, degrees, positive.
   *
   * DERIVED, not tuned. The pitch at which a view direction stops
   * intersecting a sphere of radius `R` from a camera at altitude `h` is the
   * HORIZON ANGLE — the half-angle of the cone of rays tangent to the
   * sphere, `asin(R / (R + h))`. An orthographic camera has no altitude, so
   * the view supplies the only length it has: the world-space half-height of
   * its own frame, `h = (rows * cellHeight / 2) / zoom`, which is half the
   * host's rendered pixel height over `camera.zoom` and so is invariant to
   * `cols`/`rows`/cell size exactly as `camera.zoom` itself is. (Equivalently
   * it is the altitude of the perspective camera that would show the same
   * ground straight down through a 90-degree vertical field.)
   *
   * The shape is what the geometry demands: at planet scale `h >> R` and the
   * limit is small (a 360-degree span on a 16:7 grid gives ~21 degrees — 80
   * degrees there aims the camera past the limb at empty space); as the view
   * narrows `h -> 0`, the surface is locally flat, and the limit rises to
   * {@link GLYPH_MAP_MAX_TILT}. A SHEET projection has no limb at all, so
   * its ceiling is that flat-surface cap at every span.
   */
  getMaxTilt(): number;
  /**
   * Live camera BEARING — the compass heading, in degrees, that points UP on
   * screen. `0` is north up (and is byte-identical to a widget that never
   * heard of bearing); `90` puts east at the top, i.e. the picture turns
   * COUNTER-CLOCKWISE as the number grows, which is MapLibre's own
   * convention. Reported normalized to `[0, 360)`.
   *
   * The model is ROTATION ABOUT THE SURFACE NORMAL AT THE PIVOT — the same
   * surface point {@link setTilt} pitches about — never a roll about the
   * view axis. The two are identical at zero pitch, which is exactly why the
   * wrong one is easy to ship: a roll about the view axis TIPS THE HORIZON
   * the moment the camera is pitched, and no map product does that. Turning
   * about the pivot's local up instead swings the camera around a cone at
   * constant pitch, so the horizon stays level and only the heading changes
   * (pinned in `widget.bearing.test.ts` at a nonzero pitch: the screen
   * direction of local up at the pivot is invariant under bearing, while the
   * heading is not).
   *
   * Composition, in glyphcss's own c-frame (`createGlyphCamera.ts`'s
   * axis-swapped `(v[1], v[0], v[2])`), is
   * `RotX(tilt) * RotZ(-bearing) * RotX(trueRotX) * RotZ(rotY)` — the
   * navigation rotation first, then the heading about the axis that
   * navigation has just brought onto the view axis, then the pitch. It is
   * installed as {@link GlyphCamera.mat}/`useMat`, glyphcss's public
   * 9-element row-major rotation override, which `project()` already
   * honours; `rotX`/`rotY` keep their existing meanings underneath so
   * `centerForCamera` still inverts the view centre. At bearing `0` no
   * matrix is installed at all (`useMat` stays `false`) and every projected
   * cell, every tile sweep and every stroke is bit-for-bit what it was.
   */
  setBearing(bearing: number): void;
  /** The camera's current heading, degrees, normalized to `[0, 360)`. `0` is north up. */
  getBearing(): number;
  /**
   * Enter (an options object), reconfigure, or leave (`null`) street-level
   * WALK mode: a positioned PERSPECTIVE camera at eye height, walked with
   * WASD/arrows and aimed by dragging.
   *
   * Off by default and byte-identical there — no perspective camera is ever
   * constructed, and every walk branch in the widget is guarded on this
   * being off.
   *
   * While walking, three of this handle's existing readouts change meaning
   * rather than being duplicated: `getView().center` is where the walker is
   * standing, `getBearing()` is the direction they face, and `getTilt()` is
   * their pitch measured in the usual `tilt` units (`90` looks dead ahead).
   * `getView().span` DESCRIBES the horizon footprint, so tile LOD, the URL
   * codec and every readout keep working; it stops being a zoom control, and
   * the wheel is a no-op while walking.
   *
   * Throws a `RangeError` on a flat sheet projection — see the implementation
   * for why that is geometry, not policy. A `setProjection` LEAVES walk mode
   * rather than blending through it.
   */
  setWalk(walk: GlyphMapWalkOptions | null): void;
  /** The live walker (position, heading, pitch, ground elevation and the resolved options), or `null` when walk mode is off. */
  getWalk(): GlyphMapWalkState | null;
  /**
   * Turn real-sun lighting on/off and tune it. A partial merge over the
   * current state — `setSun({ mode: "realtime" })` leaves every other field
   * alone. Entering `"realtime"` snaps the sun to the true CURRENT position
   * immediately (it never waits up to a whole {@link GlyphMapSunOptions.tickMs}
   * for its first tick) and starts the timer; leaving it stops the timer.
   * See {@link GlyphMapSunOptions} for the two mechanisms and why the choice
   * between them is a projection CAPABILITY check.
   */
  setSun(sun: GlyphMapSunOptions): void;
  getSun(): GlyphMapSunState;
  /** The current directional-light source vector for an ORBIT projection, or `null` for a sheet / while the sun is off / mid-`setProjection` blend. Consumers that own the scene's `directionalLight` (intensity, colour) read this to compose their own write without fighting the widget's. */
  getSunDirection(): Vec3 | null;
  /** The subsolar point the sun currently resolves to, or `null` while the sun is off. */
  getSubsolarPoint(): GlyphMapSolarPosition | null;
  /**
   * Switch who aims the key light. Applies immediately and re-renders, so a
   * `"headlight"` turned on mid-gesture lights the frame it was turned on
   * in. Leaving `"headlight"` for `"fixed"` stops the widget updating the
   * direction and — like leaving the sun — deliberately does NOT restore
   * some earlier value: the consumer owns it, re-apply your own.
   */
  setKeyLight(mode: GlyphMapKeyLightMode): void;
  getKeyLight(): GlyphMapKeyLightMode;
  /**
   * Turn cast shadows on (an options object, `{}` for the defaults) or off
   * (`null`). Applies immediately and re-renders.
   *
   * Cheap to toggle, by construction: the per-mesh cast/receive flags are
   * already on every mounted mesh (see {@link GLYPH_MAP_SHADOW_CASTERS}), so
   * this writes ONE scene option and nothing is rebuilt or re-mounted.
   * glyphcss's shading cache survives a shadow change too — shadows blend
   * per cell at fill time — so the frame this turns them on in is a plain
   * re-render, not a re-light.
   */
  setShadow(shadow: GlyphMapShadowOptions | null): void;
  /** The shadow options in force, or `null` when shadows are off. */
  getShadow(): GlyphMapShadowOptions | null;
  /**
   * The direction the WIDGET currently owns for the scene's key light, from
   * whichever owner is active — the sun if it is on and this projection
   * takes a directional terminator, otherwise the headlight — or `null` when
   * nobody here owns it (`keyLight: "fixed"` with the sun off, a sheet
   * projection with the sun on, mid-`setProjection` blend).
   *
   * This is the ONE call a consumer composing its own `directionalLight`
   * write needs: `getSunDirection()` answers only for the sun, so a consumer
   * reading that alone would clobber a headlight with its own slider vector.
   */
  getKeyLightDirection(): Vec3 | null;
  /**
   * Animates from the CURRENT projection to `target` over
   * `opts.durationMs` (default {@link GLYPH_MAP_PROJECTION_TRANSITION_DEFAULT_MS},
   * `0` = instant) — MAPS.md §13 slice 4, `transition.ts`'s own reference
   * caller. Every animation frame: (1) the closure projection is reassigned
   * to `glyphMapProjectionTransition(from, to, t)` (the exact `from`/`to`
   * object at `t<=0`/`t>=1`), which every mesh/stamp rebuild below reads
   * live; (2) camera FRAMING is blended between each endpoint's OWN framing
   * — picked by CAPABILITY presence on that endpoint (`cameraForCenter`),
   * never by identity, the same rule every other projection-aware branch in
   * this file follows — since the blended projection itself deliberately
   * exposes neither `cameraForCenter` nor `centerForCamera`
   * (`transition.ts`'s doc) to compute a framing from; (3) every mesh whose
   * geometry depends on projection is rebuilt against the newly-blended
   * projection (raster tiles reproject from cache, no refetch; `line`/
   * `contour` reproject for free every render already).
   *
   * `unproject()` — and so click-to-lonlat and contour field sampling,
   * which both go through it — degrades to `null` for the whole transition,
   * never throwing: `glyphMapProjectionTransition`'s blend has no
   * closed-form inverse by design, and every internal caller of
   * `projection.unproject` here catches that throw and treats it as "no
   * answer" rather than propagating it or crashing.
   *
   * Resolves once `t` reaches `1` — at that point `projection` is the exact
   * `target` reference and camera framing is byte-identical to a plain,
   * non-animated `setProjection(target, { durationMs: 0 })` call. Calling
   * this again before a prior transition settles cancels the in-flight one
   * and restarts from wherever the camera/projection currently ARE (not
   * from the original start), same "last call wins, no queueing" precedent
   * every other async layer update in this file follows.
   */
  setProjection(target: GlyphMapProjection, opts?: GlyphMapSetProjectionOptions): Promise<void>;
  /**
   * Animated camera flight to `target` — the eased counterpart of the
   * instantaneous {@link GlyphMapHandle.setView}/{@link GlyphMapHandle.fitBounds},
   * and the mechanism a "fly to this country" search box drives.
   *
   * Runs on the widget's ONE camera-motion loop, the same loop that owns
   * inertial drag glide and {@link GlyphMapHandle.setProjection}'s blend —
   * never a second animation mechanism of its own. That is what makes every
   * hand-over continuous: a drag, a wheel, another `flyTo`, a `setView` or a
   * `setProjection` arriving mid-flight simply cancels the flight WHERE THE
   * CAMERA CURRENTLY IS. Nothing is ever re-derived from the flight's
   * original start, so an interrupted flight cannot snap.
   *
   * The centre eases (`easeInOutQuad`) along the shorter longitude arc while
   * the span interpolates in LOG space — a zoom is multiplicative, so a
   * linear span lerp would spend almost the whole flight at the wide end.
   * On top of that the span is BOWED outward at mid-arc (`opts.bow`): a
   * cross-globe flight would otherwise skim the surface at final detail the
   * whole way, which is both the wrong look and the expensive one — the bow
   * is what bounds how much fine terrain is ever needed mid-flight. This is
   * the simple `sin`-bow, not van Wijk's optimal-path zoom-and-pan: the
   * latter buys a slightly more natural constant-perceived-velocity arc for
   * a lot more math, and nothing here depends on that.
   *
   * Detail settles when MOTION STOPS, not when the flight's promise
   * resolves — the shared loop re-arms the tile-fetch debounce on every
   * moving frame, so waypoints mid-flight never trigger a fetch.
   *
   * Resolves when the flight completes; a cancelled flight resolves too
   * (the caller asked to go somewhere and something else took over — that
   * is not an error), so `await flyTo(...)` never hangs.
   */
  flyTo(target: GlyphMapFlyToTarget, opts?: GlyphMapFlyToOptions): Promise<void>;
  project(lngLat: readonly [number, number]): GlyphMapProjectResult;
  unproject(cell: readonly [number, number]): readonly [number, number] | null;
  addLayer(layer: GlyphMapLayer, beforeId?: string): string;
  removeLayer(id: string): void;
  moveLayer(id: string, beforeId?: string): void;
  /** Provenance of every currently mounted layer's data source, deduplicated — see `attribution.ts`. Recomputed on every call, so it always reflects the live layer set (a toggled layer, a curated tile swap). */
  getAttributions(): readonly GlyphMapAttribution[];
  /**
   * The elevation range of a mounted `contour` layer's CURRENTLY resolved
   * field — `null` if `id` isn't a mounted contour layer, or a
   * provider-backed one whose first fetch hasn't resolved yet. Read-only
   * introspection for a caller previewing the level COUNT a `levels: {
   * interval }` value will produce (`glyphMapContourIntervalLevels`)
   * without duplicating the field-resolution logic itself.
   */
  getContourFieldRange(id: string): { readonly min: number; readonly max: number } | null;
  addMarker(opts: GlyphMapMarkerOptions): GlyphMapMarkerHandle;
  on<T extends GlyphMapEvent["type"]>(type: T, handler: GlyphMapEventHandler<Extract<GlyphMapEvent, { type: T }>>): void;
  off<T extends GlyphMapEvent["type"]>(type: T, handler: GlyphMapEventHandler<Extract<GlyphMapEvent, { type: T }>>): void;
  resize(): void;
  destroy(): void;
}

interface ProjectionGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly centerCol: number;
  readonly centerRow: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Per-`deltaMode` wheel-delta normalization ratios (pixel / line / page),
 * adopted from Leaflet's `DomEvent.getWheelDelta` — a battle-tested
 * cross-device/cross-browser table, not a value picked blind. A raw
 * `WheelEvent.deltaY` is meaningless on its own: `deltaMode` 0 (pixel), 1
 * (line), or 2 (page) changes what one unit of `deltaY` represents, and the
 * SAME physical gesture reports wildly different magnitudes across modes
 * and devices — a macOS trackpad emits many small pixel-mode events
 * (`deltaY` ~1-5), a physical mouse wheel notch emits a much larger
 * pixel-mode jump (`deltaY` ~100 on macOS Chrome/Safari) or a handful of
 * line-mode units elsewhere (Firefox on Windows, `deltaY` ~3, `deltaMode`
 * 1). The old fixed `deltaY * 0.001` coefficient ignored `deltaMode`
 * entirely and read pixel-mode trackpad events as a 0.1-0.5% span change
 * per event — the exact "locked in, barely moves" symptom.
 */
export const GLYPH_MAP_WHEEL_DELTA_MODE_SCALE: Readonly<Record<number, number>> = {
  0: 1 / 4.000244140625, // DOM_DELTA_PIXEL
  1: 20, // DOM_DELTA_LINE
  2: 60, // DOM_DELTA_PAGE
};

/**
 * `k` in `span *= exp(k * normalizedDelta)` — the exponential (not linear)
 * zoom step, chosen so a single physical mouse-wheel notch (macOS
 * pixel-mode `deltaY` ~100 -> normalized ~25 via the table above) lands a
 * ~12% span change: `exp(25k) = 1.12 => k = ln(1.12) / 25`. Exponential
 * rather than linear because zoom is naturally multiplicative — a linear
 * `span * (1 + delta)` step is asymmetric (zooming in then out by the same
 * raw delta does not return to the original span); `exp` is exactly
 * self-inverse under negation, which `widget.test.ts`'s wheel-symmetry test
 * pins directly.
 */
export const GLYPH_MAP_WHEEL_ZOOM_K = Math.log(1.12) / 25;

/**
 * Converts a raw `WheelEvent.deltaY`/`deltaMode` pair into the normalized
 * delta {@link GLYPH_MAP_WHEEL_ZOOM_K} is calibrated against. An
 * unrecognized `deltaMode` (none is standard beyond 0/1/2) falls back to
 * the pixel-mode ratio rather than throwing — a wheel gesture should never
 * hard-fail the widget.
 */
export function glyphMapNormalizeWheelDelta(deltaY: number, deltaMode: number): number {
  return deltaY * (GLYPH_MAP_WHEEL_DELTA_MODE_SCALE[deltaMode] ?? GLYPH_MAP_WHEEL_DELTA_MODE_SCALE[0]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * The pitch ceiling on a LOCALLY FLAT surface, degrees — the value
 * {@link GlyphMapHandle.getMaxTilt}'s horizon angle approaches as the view
 * narrows, and the constant ceiling for a projection with no limb at all
 * (every sheet).
 *
 * Not a taste value: at exactly 90 degrees the camera is edge-on to the
 * surface, an orthographic projection collapses it to a single row of cells,
 * and the cover math (`sheetScreenScale`, which measures the real screen
 * basis) divides by a vertical extent going to zero. 85 degrees keeps a real
 * surface in frame — its vertical foreshortening is `cos(85) = 0.087`, so a
 * sheet still needs ~11.5x the span to cover, which `maxViewSpan` already
 * measures rather than assumes.
 */
export const GLYPH_MAP_MAX_TILT = 85;

/**
 * Degrees of pitch per pixel of vertical travel in the tilt GESTURE
 * (Ctrl+drag / right-button drag).
 *
 * Half a degree per pixel is MapLibre's and Mapbox's own `pitchRate`, and it
 * is the right number here for the same reason it is there: it puts the whole
 * usable range inside one comfortable gesture. The widest ceiling this widget
 * ever offers is {@link GLYPH_MAP_MAX_TILT} (85), so head-on to fully pitched
 * is 170px of travel — a short flick of the wrist, never a repeated stroke —
 * while still being fine enough that a single pixel of hand tremor moves the
 * camera by half a degree rather than by a visible jump.
 */
export const GLYPH_MAP_TILT_DRAG_DEG_PER_PX = 0.5;

/**
 * Degrees of heading per pixel of HORIZONTAL travel in the same Ctrl+drag /
 * right-button-drag gesture whose vertical axis is pitch.
 *
 * `0.8` is MapLibre's own `bearingDegreesPerPixelMoved`, taken for the same
 * reason {@link GLYPH_MAP_TILT_DRAG_DEG_PER_PX} takes its `pitchRate`: it is
 * the rate hands already have. A full turn is 450px, so a reader can spin the
 * map right round inside one stroke on any real viewport, while a pixel of
 * tremor is under a degree.
 *
 * SIGN: dragging RIGHT INCREASES the bearing, which turns the picture
 * ANTI-clockwise on screen. The rotation is about the view centre, so
 * whichever half of the picture the hand is not on turns against it, and the
 * only question is which half the reader is actually grabbing. Under a pitch
 * — the pose this gesture exists for — the near ground fills the LOWER half
 * and the far half is horizon, so the reader's hand is on the lower half, and
 * an anti-clockwise turn is the one that carries the ground under the cursor
 * to the right. The opposite sign shipped first, justified as "the TOP of the
 * picture follows the hand"; read as a gesture on a pitched map it is
 * backwards, which is what the reader reported. The Dock's Bearing slider
 * agrees with this sign for free (right along the track = a larger heading =
 * the same anti-clockwise turn), where under the old sign the slider and the
 * drag moved the map opposite ways.
 */
export const GLYPH_MAP_BEARING_DRAG_DEG_PER_PX = 0.8;

/**
 * The depth bias {@link GlyphMapShadowOptions} applies to glyphcss's shadow
 * map, in the projection's own world units. ZERO, and derived rather than
 * tuned.
 *
 * glyphcss's own default is `0.05`, and that number is the trap in this
 * feature: it is a WORLD-UNIT length, and this package's world units are not
 * a room's. On the globe `0.05` is 5% of Earth's radius — 318 km, about
 * 36,000 times the tallest building on the planet — so with the default every
 * receiver's depth clears every caster's by a margin nothing can exceed and
 * NOT ONE SHADOW IS DRAWN. On a sheet the same number is 0.05 Earth radii on
 * an axis whose neighbours are degrees; equally meaningless. There is no
 * value of it that is right for both, which is why the widget owns it.
 *
 * Why zero is the RIGHT value and not merely the smallest one. A shadow bias
 * exists to stop a surface shadowing ITSELF, and a map now has that case:
 * {@link GLYPH_MAP_SHADOW_CASTERS} and {@link GLYPH_MAP_SHADOW_RECEIVERS}
 * OVERLAP, so a building is compared against its own depth read out of a
 * neighbouring texel. But the size of that error is a function of the shadow
 * map's own resolution, not of the world — it is `|dd/du| + |dd/dv|` in
 * texels of the fitted volume — so the guard belongs where the volume is
 * known, and glyphcss now derives it there
 * (`SHADOW_SLOPE_BIAS_TEXELS`, `rasterize.ts`), scale-free.
 *
 * That leaves this field as what it always was: an EXTRA absolute length on
 * top, and a map has no absolute length to offer. Every nonzero value costs
 * the exact thing the feature is for — a bias `b` erases every shadow whose
 * caster stands less than `b / sin(altitude)` above its receiver, taking the
 * short buildings first and worst at a LOW sun, which is precisely where
 * shadows are longest and most legible — so zero is the only value that adds
 * nothing to a guard that is already correct.
 */
export const GLYPH_MAP_SHADOW_LIFT = 0;

/**
 * A heading normalized to `[0, 360)`.
 *
 * Exactly `0` (never `-0`) for every multiple of a full turn, because
 * `bearing === 0` is the guard that keeps `camera.useMat` false and the whole
 * render bit-identical to a widget without this feature. A non-finite input
 * is north — a `NaN` heading would poison `camera.mat` and blank the map.
 */
export function glyphMapNormalizeBearing(bearing: number): number {
  if (!Number.isFinite(bearing)) return 0;
  return ((bearing % 360) + 360) % 360;
}

/** {@link GlyphMapHandle.setProjection}'s default animation length, ms. */
const GLYPH_MAP_PROJECTION_TRANSITION_DEFAULT_MS = 600;

/** Default {@link GlyphMapHandle.flyTo} flight length, ms. */
export const GLYPH_MAP_FLY_TO_DEFAULT_MS = 1400;
/** Default mid-arc zoom-out bow for {@link GlyphMapHandle.flyTo} — see its doc. */
export const GLYPH_MAP_FLY_TO_MAX_BOW = 3;
/**
 * Inertial glide: velocity decays by `exp(-dt / TAU)` per frame, and the
 * glide ends once speed drops below the threshold. 220ms reads as "the map
 * keeps going and settles" rather than either a hard stop or a long skate;
 * the threshold is a quarter of a pixel per 16ms frame, below which another
 * frame could not move a single glyph cell.
 */
const GLYPH_MAP_GLIDE_TAU_MS = 220;
const GLYPH_MAP_GLIDE_MIN_PX_PER_MS = 0.015;
/** Ceiling on the flung velocity, px/ms — a single huge pointer jump must not launch the camera across the globe. */
const GLYPH_MAP_GLIDE_MAX_PX_PER_MS = 4;
/** Exponential smoothing weight for the newest pointer sample when estimating fling velocity. */
const GLYPH_MAP_GLIDE_VELOCITY_MIX = 0.35;

/** Monotonic ms. `performance.now` where it exists (it is monotonic and immune to a clock step), `Date.now` otherwise. */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/**
 * Default {@link GlyphMapRasterLayer.padCells} — widened from the original
 * `2` (never-black investigation): tile updates are gesture-GATED
 * (`scheduleTileUpdate`'s debounce never fires mid-drag/mid-wheel, only once
 * events go idle), so a settled view's own prefetch margin is what a user
 * can nudge into — a small pan started right after settling, or the first
 * few pixels of a new gesture before its own settle — without immediately
 * falling back to coarser retained/floor geometry. `6` covers a few cells
 * of slack without materially growing the candidate sweep (still well under
 * `widget.test.ts`'s pinned <1000-candidate bound for a z7-shaped level).
 * Genuine "never black" coverage no longer depends on this value at all —
 * see the permanent floor level / retained-ancestor fallback below — this
 * is purely a "how much of the sharpen-in still needs a re-fetch" tuning.
 */
const GLYPH_MAP_RASTER_PAD_CELLS_DEFAULT = 6;

/**
 * Screen-space padding (output cells) for a provider-backed `contour`
 * layer's own visible-tile sweep. A contour has no mesh to pop in, so it
 * needs no pre-load slack for a sharpen-in the way `raster` does — but a
 * cell whose unprojected `(lon, lat)` lands a hair outside every mounted
 * tile's box samples NaN and is skipped, so a small pad keeps the mosaic
 * covering the whole visible disc rather than stopping exactly at it.
 * Matches the `line`/vector sweeps' own default.
 */
/**
 * How near a pole the globe's Newton unproject is allowed to sit. Latitude is
 * a degenerate coordinate AT a pole (the longitude derivative is zero there),
 * so both the iteration's start point and every step it takes are kept this
 * far off it — near enough that a genuinely polar answer is still reachable to
 * ~1 m, far enough that the Jacobian stays invertible.
 */
const POLE_SAFE_LAT = 89.999;

const GLYPH_MAP_CONTOUR_PAD_CELLS = 2;

/**
 * The relief-mesh resolution ladder, as fractions of a tile's own baked
 * quad grid (`glyphMapPolygons`'s `resolution` option). A tier's mesh is
 * built at the COARSEST rung that still resolves at least one quad per
 * glyph cell.
 *
 * Quantized to eighths rather than computed exactly for one reason:
 * rebuilding a tier's meshes costs ~0.24us/quad (measured), so a
 * resolution that tracked `view.span` continuously would rebuild every
 * mounted tile of a level on essentially every settled zoom step. Eighths
 * put at most 8 distinct resolutions across a level's whole zoom range —
 * so a rebuild happens a handful of times per zoom sweep, not per tick —
 * at a cost of at most one eighth of over-resolution.
 */
const GLYPH_MAP_RELIEF_FRACTIONS = [1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1] as const;

/**
 * How much coarser than "one quad per glyph cell" the FALLBACK tier is
 * built. That tier exists only to be glimpsed through the gap between a
 * zoom gesture settling and the fine tier finishing its fetch, and it is
 * evicted the instant the fine set is fully mounted — a fallback that
 * reads as visibly coarse is exactly what it is FOR. `2` per axis is 4x
 * fewer quads.
 */
const GLYPH_MAP_RELIEF_FALLBACK_COARSEN = 2;

/**
 * Hard cap on the permanent FLOOR tier's quads per axis, applied only
 * while the floor is NOT itself the target LOD. The floor is mounted
 * once and never evicted purely so no view can ever be black; at any zoom
 * deeper than its own level, every cell it could paint is already painted
 * by a nearer tier (measured with this cap in place: 8 of its 16,200 quads
 * even reach the screen at span 2, 4 of them front-facing). When the
 * floor IS the target LOD (zoomed out past the pyramid's own shallowest
 * level) this cap is not applied and it renders at the same
 * one-quad-per-cell resolution any other tier would.
 *
 * This cap is NOT what keeps the floor out of the way. An earlier note here
 * claimed "a coarser sphere is inscribed inside a finer one, so shrinking it
 * cannot make it poke through the tier above" — that is false as soon as
 * relief is exaggerated, and it is the bug
 * {@link GLYPH_MAP_RELIEF_BACKSTOP_SINK_M} exists to fix. Raising this cap
 * does not fix it either: measured on the real ETOPO1 pyramid over the
 * Peru-Chile trench, the floor still stole 231 open-ocean cells at its
 * FINEST possible resolution (180 quads/axis, 2 degrees) against 486 at this
 * cap of 32.
 */
const GLYPH_MAP_RELIEF_FLOOR_BACKSTOP_COLS = 32;

/**
 * Metres a relief tier is sunk along the projection's own elevation axis
 * ({@link GlyphMapPolygonsOptions.elevationBias}) while it is NOT the target
 * LOD — i.e. while it is a BACKSTOP, mounted only so a pan or a zoom never
 * opens a blank hole.
 *
 * All three tiers are opaque meshes in ONE glyphcss scene, so which one a
 * cell shows is decided by the shared per-cell depth buffer and nothing
 * else: glyphcss's `occlusionPriority` orders LAYERS (separate `<pre>`s),
 * not meshes inside the base grid. A coarse tier is not merely a blurrier
 * version of the fine one — its quads interpolate LINEARLY between vertices
 * up to ~11 degrees apart, so where one straddles a coast the chord runs
 * from the sea floor up to the summit and, over the ocean half of that span,
 * sits kilometres ABOVE the fine tier's own sea floor. The backstop wins
 * those cells and paints them in its own quad's colour, which is the
 * majority of a block that is mostly land. That is the reported
 * "the sea is basically GREEN" on `/maps`: measured through the real widget
 * over the Peru-Chile trench at 486 of 4,462 sea cells in a land band,
 * against 16 for the fine tier rendered alone.
 *
 * The sink makes the depth test agree with the tier ladder instead of
 * fighting it. `20_000` is a BOUND, not a tuning: it exceeds Earth's entire
 * solid-surface relief (Everest 8,849 m to Challenger Deep -10,935 m, about
 * 19,784 m), which is the most a coarse chord between two samples of ANY
 * terrestrial elevation source can rise above a finer sample of the same
 * field. Measured requirement at the reported view is between 5,000 and
 * 10,000 m (the worst within-quad relief range in the real z0 tile is
 * 10,817 m, at lon -78 lat -22 — the Altiplano over the trench, exactly
 * where the artifact was reported); at 10,000 m and above the combined
 * render is already cell-for-cell identical to the fine tier alone.
 *
 * Metres, not world units, so it is exaggeration-invariant: a projection
 * scales this by the same `exaggeration` it scales the relief it must clear.
 *
 * Every backstop tier gets the SAME sink, deliberately. Their positions
 * relative to EACH OTHER are then exactly what they were before this
 * existed — only their relationship to the target tier changes — so this
 * cannot introduce new z-fighting between fallback and floor.
 *
 * What it costs: in a genuine hole (a fast pan into unfetched tiles, or the
 * first paint before any target tile lands) the backstop shows sunk, which
 * at the `/maps` default exaggeration of 24 is about 7.5% of the globe's
 * radius. That is a transient loading state; the artifact it replaces was
 * permanent and in the steady-state view.
 */
const GLYPH_MAP_RELIEF_BACKSTOP_SINK_M = 20_000;

/** A relief mesh's quad resolution as a fraction of the tile's own baked grid. */
type ReliefFraction = number;

function reliefResolution(cols: number, rows: number, fraction: ReliefFraction): { readonly cols: number; readonly rows: number } {
  return { cols: Math.max(1, Math.round(cols * fraction)), rows: Math.max(1, Math.round(rows * fraction)) };
}

/**
 * The coarsest {@link GLYPH_MAP_RELIEF_FRACTIONS} rung whose quads are
 * still no larger than one glyph cell, for a pyramid LEVEL (never a single
 * tile) at `degPerCell` ground units per output cell.
 *
 * Per LEVEL, not per tile, is the crack-freedom rule: two tiles resolved at
 * the same fraction of the same baked grid shape sample the identical
 * source vertices along their shared edge (`gridLineIndices`' own doc), so
 * the edge is exactly shared rather than approximately met. Per-TILE
 * resolution would let a tile near the limb — genuinely more foreshortened,
 * and so genuinely cheaper to resolve — coarsen away from its neighbour and
 * open a T-junction crack along the whole shared edge, which at the map's
 * relief exaggeration is a visible tear, not a hairline.
 *
 * `coarsen` scales the requirement (a tier that may render coarser than one
 * quad per cell passes > 1).
 */
function reliefFractionForLevel(level: GlyphMapProviderZoomLevel, degPerCell: number, coarsen = 1): ReliefFraction {
  if (!(degPerCell > 0) || !(level.tileCols > 0)) return 1;
  // Quads the level's own baked grid would need to hold one quad per cell.
  const neededCols = level.tileLonSpan / (degPerCell * coarsen);
  const wanted = neededCols / level.tileCols;
  for (const f of GLYPH_MAP_RELIEF_FRACTIONS) if (f >= wanted) return f;
  return 1;
}

export function createGlyphMap(host: HTMLElement, opts: GlyphMapOptions): GlyphMapHandle {
  // `let`, not `const` — `setProjection` reassigns this to a
  // `glyphMapProjectionTransition` blend mid-animation and to the target
  // endpoint object itself once settled (MAPS.md §13 slice 4). Every
  // function below that closes over `projection` reads it live, so a
  // reassignment here is visible everywhere without extra threading.
  let projection: GlyphMapProjection = opts.projection;
  const minSpan = opts.minSpan ?? 0.001;
  if (opts.maxSpan !== undefined && (!Number.isFinite(opts.maxSpan) || opts.maxSpan <= 0 || opts.maxSpan < minSpan)) {
    throw new RangeError(`glyphcss/maps: maxSpan must be finite, positive, and >= minSpan (got ${opts.maxSpan}).`);
  }
  const controlsDrag = opts.controls?.drag ?? true;
  const controlsWheel = opts.controls?.wheel ?? true;
  const controlsTilt = opts.controls?.tilt ?? true;
  /**
   * A FUNCTION, not a one-time `const` — `projection` can change under
   * `setProjection`, and a strictly-interior transition blend deliberately
   * exposes neither `cameraForCenter` nor `centerForCamera` (`transition.ts`'s
   * own doc), so this must re-read the LIVE projection's capabilities on
   * every call rather than freezing whatever the constructor's projection
   * happened to be.
   */
  function isOrbitProjection(): boolean {
    return isOrbit(projection);
  }

  function domainWidth(proj: GlyphMapProjection = projection): number {
    const width = proj.domain.east - proj.domain.west;
    return width > 0 ? Math.min(360, width) : 360;
  }

  function isOrbit(proj: GlyphMapProjection): boolean {
    return !!(proj.cameraForCenter && proj.centerForCamera);
  }

  let view: GlyphMapView = opts.view;
  /**
   * The pitch the CALLER asked for, unclamped. What the camera actually gets
   * is this clamped to {@link maxTiltFor} — kept apart so a zoom out that
   * lowers the ceiling does not destroy the request, and zooming back in
   * restores the full pitch instead of making the caller re-ask.
   */
  let tiltRequest = opts.tilt ?? (isOrbitProjection() ? 0 : 40);
  /**
   * The pitch currently BAKED INTO `camera.rotX` — the single source for
   * every reader of "what pitch does the camera have": `getTilt()`, and
   * `applyDragState`'s subtraction before `centerForCamera`.
   *
   * Held as state rather than recomputed from `tiltRequest` at each use
   * because the two must not be able to disagree by a hair. The ceiling is a
   * function of the live view, and a projection TRANSITION poses the camera
   * at a lerp between two endpoints' pitches that no single call to
   * `maxTiltFor` could reproduce — subtracting a re-derived value there
   * would drift `view.center` on the next drag.
   */
  let appliedTilt = 0;

  /**
   * The camera's heading, degrees, normalized to `[0, 360)` — see
   * {@link GlyphMapHandle.setBearing} for the model.
   *
   * Exactly `0` is the whole point of storing it normalized: every branch
   * that could change a rendered cell is guarded on `bearing === 0`, so the
   * default widget installs no camera matrix, takes no extra cover term, and
   * rotates no drag delta. There is no `bearingRequest`/`appliedBearing`
   * split as there is for pitch, because a heading has no ceiling: every
   * angle is reachable at every scale, on a sheet and on a globe alike.
   */
  let bearing = glyphMapNormalizeBearing(opts.bearing ?? 0);

  /**
   * Declared HERE, beside the pitch state and the camera rather than down in the sun
   * block that reads it, because `applyKeyLight` runs from the construction
   * render — a `let` in the sun block would be in its temporal dead zone at
   * that point.
   */
  let keyLightMode: GlyphMapKeyLightMode = opts.keyLight ?? "fixed";

  /**
   * The TRUE (tilt-free) orbit rotation the camera is currently on —
   * `null` until the first orbit sync, and never read by a sheet
   * projection (which has no `cameraForCenter` branch at all).
   *
   * `cameraForCenter` is a 2-to-1 INVERSE, and this is the widget's memory
   * of WHICH preimage it is on. `centerForCamera`'s own parametrization
   * `n = (sin rotX cos rotY, sin rotX sin rotY, cos rotX)` maps
   * `(rotX, rotY)` and `(-rotX, rotY + 180)` to the SAME `(lon, lat)` —
   * `cos` is even, so `nz` (latitude) is unchanged while `nx`/`ny` (and so
   * longitude) both flip sign — but `cameraForCenter(lon, lat)` can only
   * ever answer with the canonical `rotX = 90 - lat` branch, inside
   * `[0, 180]`. While `applyDrag` clamped `rotX` into that range the two
   * were interchangeable; now that a drag deliberately carries the camera
   * THROUGH the pole (`applyDrag`'s own doc — dragging past the pole is a
   * feature, not an edge case), `view.center` alone can no longer say which
   * branch the camera is on, and re-deriving it from `cameraForCenter`
   * silently jumps to the other one. The two branches share a view AXIS but
   * differ by a 180deg ROLL about it — the screen point-REFLECTS (measured
   * at tilt 0: lon -150/lat 78 col 45.6 -> 74.4; lon -180/lat 88 row 52.5 ->
   * 7.5) — and because `tilt` is ADDED to whichever branch was picked
   * (`camera.rotX = rotX + tilt`), a nonzero tilt makes them different AXES
   * outright (at the page default tilt 40, lon 0 / lat 60: rotX 28.663 ->
   * 51.337, rotY 0 -> -180 — the surface-point pivot keeps `view.center`
   * itself at screen centre through the flip, so the whole picture rolls
   * and re-pitches about it instead of leaving the grid, but it is the same
   * unrequested jump). That is the reported "scroll closer to the pole, then zoom out
   * and it jumps around" — the flip discharges on the FIRST wheel notch
   * after the drag, because that is the next `syncCameraToView`.
   */
  let orbitRotation: { readonly rotX: number; readonly rotY: number } | null = null;

  /**
   * The map's own camera — the one every framing, sweep, unproject and
   * stroke in this file projects through. `let`, not `const`, for exactly
   * one reason: WALK MODE swaps a positioned PERSPECTIVE camera in for the
   * duration and puts this one back on the way out (see {@link setWalk}).
   * Every reader below reads the live binding, so the swap is invisible to
   * them; the orthographic instance is retained UNTOUCHED while walking, so
   * leaving walk mode restores the previous pose by putting the same object
   * back rather than by recomputing it.
   */
  const orthographicCamera: GlyphCamera = createGlyphOrthographicCamera({ zoom: 1 });
  let walkCamera: GlyphCamera | null = null;
  let camera: GlyphCamera = orthographicCamera;
  if (!isOrbitProjection()) {
    // A sheet's ceiling is the flat-surface cap and nothing else, so this
    // needs no measured grid — which the host may not have yet at
    // construction time anyway.
    appliedTilt = clamp(tiltRequest, -GLYPH_MAP_MAX_TILT, GLYPH_MAP_MAX_TILT);
    camera.rotX = appliedTilt;
    camera.rotY = 0;
  }

  // ── WALK MODE ─────────────────────────────────────────────────────────
  //
  // A GATED mode, not a general capability: `walk` is `null` for every map
  // that never asks for it, every branch below is guarded on it, and with
  // it null this file is byte-identical to before the mode existed.
  //
  // What walk mode replaces is exactly three things — the CAMERA (a
  // positioned perspective one at eye height, `poseWalkCamera`), the
  // VISIBILITY test (a local horizon disc instead of `projection.visible`,
  // which is derived for the orthographic camera and reports the ground one
  // metre in front of a walker invisible — `walk.ts`'s header carries the
  // measurement), and the INPUT bindings (keys walk, drag looks). Everything
  // else is reused as-is: `tiltRequest`/`appliedTilt` IS the walker's pitch
  // measured from `GLYPH_MAP_WALK_HORIZON_TILT_DEG`, `bearing` IS the
  // walker's heading, `view.center` IS where they are standing, and
  // `view.span` still describes the footprint so tile LOD, the URL codec and
  // every readout keep working without learning about a camera mode.

  let walk: GlyphMapResolvedWalkOptions | null = null;
  /** Terrain elevation under the walker's feet, metres — re-sampled on every step so the walk follows the relief instead of clipping through it. */
  let walkGroundElevation = 0;
  /** Movement keys currently held, lowercased. Non-empty is what keeps the motion loop running. */
  const walkHeldKeys = new Set<string>();
  /** Shift held: a jog. Tracked separately because it modifies rather than contributes an axis. */
  let walkRunning = false;
  /**
   * `g` held: GHOST. The collision model's defeat key, and the reason it is a
   * HELD key rather than a toggle is that every other binding this mode has
   * is momentary (`Shift` runs, `Esc` releases) and a momentary key needs no
   * state on screen to be honest about — the legend can say what it does
   * without the page having to mirror whether it is on.
   *
   * `g` collides with nothing: the movement bindings are WASD and the arrows,
   * the modifier is Shift, and the exit is Esc.
   */
  let walkGhost = false;
  /**
   * Every mounted `fill-extrusion` layer's live footprint features — the
   * COLLISION set, and the reason it is a set of callbacks rather than a
   * flat array is that a layer rebuilds its own features whenever its tiles
   * change and there is no event that says "some layer's features moved"
   * except the rebuild itself.
   *
   * Only extrusions are in here. A `fill` (a park, a lake, landcover) is a
   * flat overlay on the datum and walking across one is exactly what a reader
   * expects to be able to do.
   */
  const walkCollisionSources = new Set<() => readonly GlyphMapVectorFeature[]>();
  /**
   * The built index, or `null` when it needs rebuilding — which is whenever a
   * contributing layer rebuilt, mounted or unmounted, i.e. exactly when the
   * mounted TILE SET changed.
   *
   * Built LAZILY, on the first step that asks for it, so a map that never
   * walks pays a boolean assignment per layer rebuild and nothing else: no
   * index is ever constructed, and the walk-off path is byte-identical.
   */
  let walkCollisionIndex: GlyphMapWalkCollisionIndex | null = null;
  function invalidateWalkCollision(): void { walkCollisionIndex = null; }
  function walkCollisionIndexNow(): GlyphMapWalkCollisionIndex {
    if (walkCollisionIndex) return walkCollisionIndex;
    const footprints: GlyphMapWalkFootprint[] = [];
    for (const source of walkCollisionSources) footprints.push(...glyphMapWalkFootprints(source()));
    walkCollisionIndex = createGlyphMapWalkCollisionIndex(footprints);
    return walkCollisionIndex;
  }
  /**
   * The state walk mode is holding for its exit, captured VERBATIM on entry.
   * The camera itself is not in here: `orthographicCamera` is never written
   * while walking, so it still holds the exact pose it was left at.
   */
  let walkRestore: {
    readonly view: GlyphMapView;
    readonly tiltRequest: number;
    readonly appliedTilt: number;
    readonly bearing: number;
    readonly orbitRotation: { readonly rotX: number; readonly rotY: number } | null;
  } | null = null;

  /** The pitch floor/ceiling while walking: a neck's worth either side of the horizontal. */
  function walkTiltRange(): readonly [number, number] {
    const w = walk!;
    return [GLYPH_MAP_WALK_HORIZON_TILT_DEG - w.maxPitch, GLYPH_MAP_WALK_HORIZON_TILT_DEG + w.maxPitch];
  }


  /**
   * A second, never-rendered camera the cover math measures the SHEET screen
   * basis with (see {@link sheetScreenScale}). It exists because the cover
   * limit has to be asked about a projection the live camera may not
   * currently be posed for — `setProjection` computes the DESTINATION's
   * limit while the camera still holds the origin's pose, which for a
   * globe->sheet flight is an orbit pose with a completely different `rotX`.
   * Posing a scratch camera at the sheet framing (`framingFor`'s own sheet
   * branch: `rotX = tilt`, `rotY = 0`) and asking it through the same public
   * `project()` keeps this measured rather than re-deriving the camera's
   * internal world-axis -> screen-axis mapping here.
   */
  const coverProbeCamera = createGlyphOrthographicCamera({ zoom: 1, rotX: 0, rotY: 0 });

  // ── Bearing ───────────────────────────────────────────────────────────
  //
  // Bearing is a rotation about the SURFACE NORMAL AT THE PIVOT — the very
  // point `tilt` already pitches about — and NOT a roll about the view axis.
  // The two coincide at zero pitch and diverge exactly where this feature is
  // for: a view-axis roll TIPS THE HORIZON on a pitched camera, which is a
  // thing no map product does. `GlyphMapHandle.setBearing` carries the model;
  // what follows is how it reaches glyphcss.
  //
  // The route is `GlyphCamera.mat` + `useMat`, glyphcss's public, documented
  // 9-element row-major rotation override, which `project()` (and so every
  // depth test, every unproject, every stroke) already honours. `rotX`/`rotY`
  // keep their existing meanings underneath — the matrix is BUILT from them —
  // so `centerForCamera` still inverts the view centre, `appliedTilt` is
  // still subtractable, and the whole existing camera model is intact. At
  // bearing 0 no matrix is installed at all.

  /**
   * The pivot's local UP in world space, unit length — the axis a bearing
   * turns about.
   *
   * Asked of the PROJECTION through {@link localUpDirection} (which probes
   * `project(lon, lat, +1m)`), never hardcoded as `+Z` (right for a sheet) or
   * "radially outward" (right for the globe): `glyphMapFromD3Raw` lets a
   * caller bring a projection this package has never seen, and a
   * `setProjection` blend is a fourth thing again — all of them agree that a
   * positive elevation nudge moves a point UP, which is the whole definition
   * this needs.
   */
  function bearingUpAxis(): Vec3 | null {
    const up = localUpDirection(projection, view.center[0], view.center[1], 0);
    if (!up) return null;
    const len = Math.hypot(up[0], up[1], up[2]);
    if (!(len > 0) || !Number.isFinite(len)) return null;
    return [up[0] / len, up[1] / len, up[2] / len];
  }

  /**
   * The camera rotation matrix for `(rotX, rotY)` turned by `bearingDeg`
   * about world-space unit axis `up`, in glyphcss's own layout: 9 elements,
   * row-major, acting on the AXIS-SWAPPED vector `(v[1], v[0], v[2])`
   * (`createGlyphCamera.ts`'s `rotateVec3WithMat`).
   *
   * `M = E * Rot(uc, -bearing)`, where `E = RotX(rotX) * RotZ(rotY)` is
   * exactly what the Euler path builds and `uc` is `up` in that same swapped
   * frame. Right-multiplying is what makes this a rotation about the PIVOT'S
   * NORMAL rather than a screen roll: the world turns about `up` first, then
   * the unchanged camera looks at it. Since `camera.target` IS the pivot and
   * `project` subtracts it before rotating, the turn is anchored there with
   * no extra translation term.
   *
   * Two consequences worth naming, both load-bearing:
   *
   *  - THE HORIZON STAYS LEVEL. `up` is the rotation's own axis, so
   *    `M * uc = E * uc` for every bearing: the screen-space direction of
   *    local up at the pivot cannot move. A roll (`RotZ(psi) * E`, LEFT
   *    multiplication) fails precisely this.
   *  - IT IS THE THIRD EULER ANGLE, in the right slot. Where the pivot is
   *    the view centre, `E * uc = z-hat`, so the identity
   *    `E * Rot(uc, -b) = RotZ(-b) * E` holds and the whole composition
   *    reads `RotX(tilt) * RotZ(-b) * RotX(trueRotX) * RotZ(rotY)` —
   *    navigate, then turn, then pitch. That is the same camera MapLibre and
   *    Cesium build, and it is why `applyDragState` only has to rotate its
   *    pixel delta by the bearing rather than re-derive anything.
   */
  function bearingMatrix(rotXDeg: number, rotYDeg: number, up: Vec3, bearingDeg: number): number[] {
    // The axis, in the camera's swapped frame.
    const ax = up[1], ay = up[0], az = up[2];
    // Rodrigues for `Rot(uc, -bearing)`.
    const t = (-bearingDeg * Math.PI) / 180;
    const c = Math.cos(t), sn = Math.sin(t), k = 1 - c;
    const r = [
      c + ax * ax * k, ax * ay * k - az * sn, ax * az * k + ay * sn,
      ay * ax * k + az * sn, c + ay * ay * k, ay * az * k - ax * sn,
      az * ax * k - ay * sn, az * ay * k + ax * sn, c + az * az * k,
    ];
    // `E = RotX(rotX) * RotZ(rotY)`, the exact matrix `rotateVec3Voxcss`
    // applies in two steps.
    const yr = (rotYDeg * Math.PI) / 180, xr = (rotXDeg * Math.PI) / 180;
    const cy = Math.cos(yr), sy = Math.sin(yr), cx = Math.cos(xr), sx = Math.sin(xr);
    const e = [
      cy, -sy, 0,
      cx * sy, cx * cy, -sx,
      sx * sy, sx * cy, cx,
    ];
    const m = new Array<number>(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m[i * 3 + j] = e[i * 3]! * r[j]! + e[i * 3 + 1]! * r[3 + j]! + e[i * 3 + 2]! * r[6 + j]!;
      }
    }
    return m;
  }

  /**
   * Push the live bearing onto the camera. Called immediately after EVERY
   * write of `camera.rotX`/`rotY`/`target` — construction, `syncCameraToView`,
   * `applyDragState`, `applyTiltState`, `applyProjectionFrame`, `setBearing`
   * — because `camera.mat` is DERIVED from all three and a stale matrix is
   * not a stale picture, it is a wrong `project()` for every caller in this
   * file (unproject, tile sweep, strokes, hotspots) until the next render.
   *
   * At bearing 0 it clears the override rather than installing an identity-
   * equivalent matrix: `useMat: false` keeps glyphcss on its memoized Euler
   * path, so the default widget pays nothing and renders the same bytes.
   */
  function syncCameraBearing(): void {
    const up = bearing === 0 ? null : bearingUpAxis();
    if (!up) {
      camera.useMat = false;
      camera.mat = null;
      return;
    }
    camera.mat = bearingMatrix(camera.rotX, camera.rotY, up, bearing);
    camera.useMat = true;
  }

  /**
   * The widget's own shadow state. `null` = off, and then NO `shadow` key
   * reaches `createGlyphScene` at all — not `undefined`, not a disabled
   * object — so a map that never asks for shadows builds the same scene
   * options it built before this option existed, and a consumer that set
   * `scene.shadow` by hand still gets exactly what they asked for.
   */
  let shadow: GlyphMapShadowOptions | null = opts.shadow ?? null;

  /** `shadow` in glyphcss's own shape, with this package's world-scale {@link GLYPH_MAP_SHADOW_LIFT} filled in. */
  function resolvedShadow(): GlyphShadowOptions | undefined {
    if (!shadow) return undefined;
    const out: GlyphShadowOptions = { lift: shadow.lift ?? GLYPH_MAP_SHADOW_LIFT };
    if (shadow.color !== undefined) out.color = shadow.color;
    if (shadow.opacity !== undefined) out.opacity = shadow.opacity;
    return out;
  }

  const sceneOverrides = opts.scene ?? {};
  const scene: GlyphSceneHandle = createGlyphScene(host, {
    mode: "solid",
    useColors: true,
    ...sceneOverrides,
    ...(shadow ? { shadow: resolvedShadow() } : {}),
    camera,
    cols: view.cols,
    rows: view.rows,
    autoSize: opts.autoSize ?? false,
  });

  /**
   * Every mesh-backed layer's mount goes through here so the per-layer
   * glyph-ramp escape is applied in ONE place. The scene's palette is read
   * LIVE rather than captured at construction, because `map.scene.setOptions`
   * is a documented escape hatch a consumer may have used since — see
   * {@link glyphMapMeshTransform} for the escape itself and for what a later
   * scene-palette change does (and does not) do to already-mounted meshes.
   */
  function meshTransform(layer: GlyphMapMeshAppearance, density?: number, detailGroup?: string): GlyphMeshTransform {
    return glyphMapMeshTransform(layer, scene.getOptions().glyphPalette ?? GLYPH_MAP_DEFAULT_GLYPH_PALETTE, density, detailGroup);
  }

  // ── Screen-space geometry (absorbed from both pages' identical helper) ──

  /**
   * DELIBERATELY NOT MEMOIZED, though it reads two `getBoundingClientRect()`s
   * (each a forced synchronous layout) several times per rendered frame.
   * A memo scoped to "until this widget's next repaint" was built and
   * measured, and removed on both counts: it moved `layout` by nothing
   * (1.787 -> 1.824 ms/frame on `bench/maps-render`, i.e. noise), and it was
   * not sound — glyphcss ALSO renders on its own microtask whenever a mesh is
   * added or removed, so a tile mount repaints without passing through any
   * widget-side invalidation, and the stroke hook then stamped against a
   * stale grid. It changed the render at exactly the two fidelity waypoints
   * that mount tiles. If this is ever worth caching, the invalidation has to
   * come from glyphcss's own render boundary, not from this file's.
   */
  function projectionGrid(): ProjectionGrid {
    const o = scene.getOptions();
    const cols = o.cols ?? view.cols;
    const rows = o.rows ?? view.rows;
    const cellAspect = o.cellAspect ?? 2;
    const hostRect = host.getBoundingClientRect();
    const outputRect = scene.output.getBoundingClientRect();
    const fallbackCellHeight = 50;
    const fallbackCellWidth = fallbackCellHeight / cellAspect;
    const cellWidth = outputRect.width > 0 ? outputRect.width / cols
      : hostRect.width > 0 ? hostRect.width / cols
      : fallbackCellWidth;
    const cellHeight = outputRect.height > 0 ? outputRect.height / rows
      : hostRect.height > 0 ? hostRect.height / rows
      : fallbackCellHeight;
    const centerCol = cols * camera.center[0] + (hostRect.width > 0 ? (hostRect.width - cols * cellWidth) / (2 * cellWidth) : 0);
    const centerRow = rows * camera.center[1] + (hostRect.height > 0 ? (hostRect.height - rows * cellHeight) / (2 * cellHeight) : 0);
    return { cols, rows, cellAspect, cellWidth, cellHeight, centerCol, centerRow };
  }

  function depthOf(world: Vec3, grid: ProjectionGrid): number {
    return camera.project(world, grid.cols, grid.rows, grid.cellAspect, grid)[2];
  }

  /**
   * "Can the reader see the world at this lon/lat at all?" — the ONE near-side
   * predicate every POINT consumer in this file goes through: stroke run
   * clipping, `unprojectSphere`, `project()`, marker and point-feature
   * hotspot sync, and a `fill-extrusion`'s wall cull.
   *
   * Off walk mode it is `projection.visible` and nothing else, byte for byte:
   * a flat projection declares no capability (`project()` returning NaN is
   * already its exclusion) and everything is on the near side.
   *
   * WALKING it is the LOCAL HORIZON instead, and that is not an optimisation
   * — `glyphMapGlobe.visible()` is DERIVED FOR THE ORTHOGRAPHIC CAMERA and
   * gives the wrong answer under a positioned perspective one, hard enough to
   * blank the frame. It takes `axial = depthOf(world) - depthOf(origin)`,
   * accepts `axial >= 0` as "in front of the sphere's centre plane", and
   * otherwise asks whether the point falls outside the silhouette CYLINDER of
   * radius `radius` about the view axis. Both halves want the orthographic
   * camera's own depth — the raw rotated `z`, in the same WORLD units as
   * `|world|`, which is what makes that comparison dimensionally legal. The
   * walk camera's `project()[2]` is `r_z * BASE_TILE - distance`, i.e. 50x
   * that; and its eye is ON the sphere, so "behind the centre plane" stops
   * meaning "round the back of the world" and starts meaning "the view axis
   * is tilted up by anything at all". Measured through the real camera at the
   * default entry, for the pavement 80 m ahead (radius 1, so `axial` is
   * comparable to 1): `+1.7443` at 2 deg of DOWN pitch (accepted by the first
   * clause), `-6.3e-4` level, `-8.8e-2` at a tenth of a degree UP, `-4.36` at
   * 5 deg — `-BASE_TILE * sin(pitch)`, so five degrees of looking up puts the
   * ground under the walker's feet four and a third EARTH RADII off the view
   * axis and every consumer rejects everything at once. That is the reported
   * "when I raise the camera the whole rendering disappears", and it is a
   * cliff rather than a fade: a 300 m block 80 m ahead painted 4,900 cells up
   * to +0.01 deg and 0 from +0.1 deg (a wall survives while ANY corner
   * passes, and at level pitch its 300 m top corners just barely do — a
   * ground-level `line` has no such margin and was already dark at entry).
   *
   * `glyphMapGlobe.visible()` is deliberately NOT generalised (`walk.ts`'s
   * header, and AGENTS.md's walk paragraph): its orthographic consumers are
   * load-bearing and heavily tested, and over the few hundred metres a walker
   * can see the Earth is locally flat, so the honest question there is
   * "is this within `far` metres of where I am standing" — closed form, with
   * no camera in it. `widget.farSideFill.test.ts` / `widget.farSideStroke.test.ts`
   * are what go red if this branch ever leaks out of walk mode.
   *
   * `isBoundsVisible` deliberately does NOT route through here: it tests a
   * tile's BOX, not a point, and a z14 tile is 2.4 km across, so a 400 m disc
   * would reject the very tile the walker stands on. Measured, the sweep is
   * unaffected by pitch either way — terrain paints the same 4,340 cells
   * before and after a look up past the horizon — and the walk footprint
   * reaches it through `view.span` (`glyphMapWalkSpan`) as it always has.
   */
  function nearSideVisible(lon: number, lat: number, world: Vec3, grid: ProjectionGrid): boolean {
    if (walk) return glyphMapWalkWithinHorizon(view.center[0], view.center[1], lon, lat, walk.far);
    return !projection.visible || projection.visible(world, (w) => depthOf(w, grid));
  }

  /**
   * Split one lon/lat polyline into the maximal runs that lie on the
   * projection's VISIBLE side, inserting a bisected limb vertex at every
   * crossing so a run reaches exactly the silhouette and stops.
   *
   * This exists because a `line` layer's stamp previously projected every
   * ring vertex and stamped it with NO visibility test at all — the one
   * geometry path in this file that did not go through
   * `projection.visible`, which tile culling (`isBoundsVisible`), marker
   * sync, point-feature hotspots and `unprojectSphere` all already consult.
   * An orthographic camera maps the FAR hemisphere onto the same screen
   * disc as the near one, so a far-side border landed inside the globe's
   * silhouette and read as lines drawn through the sphere. The depth test in
   * `stampGlyphMapPolyline` was the only thing in the way and is explicitly
   * a no-op wherever `grid.depth` is non-finite ("no base surface there
   * means nothing to be occluded by") — which is every cell the terrain mesh
   * does not cover, the polar caps and the ring just inside the limb
   * included, and EVERY cell when no raster layer is mounted at all.
   *
   * Clipping the GEOMETRY here, rather than adding a per-sample test inside
   * `stroke.ts`, keeps the projection capability in the layer that owns the
   * projection and leaves the stamper pure — and it mirrors
   * `vector/clip.ts`'s own discipline exactly: clip against a boundary,
   * keep real neighbouring geometry on the visible side of the cut, and
   * never emit a synthetic single-point fragment (a 1-point run draws
   * nothing, since `stampGlyphMapPolyline` walks SEGMENTS). The inserted
   * limb vertex is a real point on the segment, so the "tangent comes from
   * the geometry, never from a segment happening to end there" contract
   * holds across a cut end exactly as it does across a tile seam.
   *
   * A projection with no `visible` capability (every flat projection —
   * `project()` returning NaN is already its own exclusion) returns the ring
   * UNCHANGED, by identity, so nothing about the flat path changes.
   *
   * Interpolation is linear in lon/lat, matching what `stampGlyphMapPolyline`
   * already does between two projected vertices in screen space; a segment
   * that wraps the antimeridian is no more (and no less) supported than
   * before, and the vector pipeline's tile-clipped rings never produce one.
   */
  function visibleStrokeRuns(
    ring: readonly (readonly [number, number])[],
    grid: ProjectionGrid,
  ): readonly (readonly (readonly [number, number])[])[] {
    const isVisible = projection.visible;
    if (!isVisible || ring.length === 0) return [ring];
    const visibleAt = (lon: number, lat: number): boolean => {
      const world = projection.project(lon, lat, 0);
      return Number.isFinite(world[0]) && Number.isFinite(world[1]) && Number.isFinite(world[2])
        && nearSideVisible(lon, lat, world, grid);
    };
    const vis = ring.map(([lon, lat]) => visibleAt(lon, lat));
    if (vis.every((v) => v)) return [ring];
    if (vis.every((v) => !v)) return [];

    /** Bisect toward the limb, always keeping `lo` on the VISIBLE side, and return that side's endpoint — so a run never carries a vertex the projection calls invisible. */
    const crossing = (a: readonly [number, number], b: readonly [number, number], aVisible: boolean): readonly [number, number] => {
      let [loLon, loLat] = aVisible ? a : b;
      let [hiLon, hiLat] = aVisible ? b : a;
      for (let i = 0; i < 16; i++) {
        const mLon = (loLon + hiLon) / 2;
        const mLat = (loLat + hiLat) / 2;
        if (visibleAt(mLon, mLat)) { loLon = mLon; loLat = mLat; } else { hiLon = mLon; hiLat = mLat; }
      }
      return [loLon, loLat];
    };

    const runs: (readonly [number, number])[][] = [];
    let current: (readonly [number, number])[] = [];
    for (let i = 0; i < ring.length; i++) {
      if (vis[i]) {
        if (current.length === 0 && i > 0) current.push(crossing(ring[i - 1], ring[i], false));
        current.push(ring[i]);
      } else if (current.length > 0) {
        current.push(crossing(ring[i - 1], ring[i], true));
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);
    return runs;
  }

  /**
   * The lon/lat points the VIEWPORT ITSELF is showing: a 3x3 screen sample
   * grid over the (padded) viewport, unprojected through the same
   * `unprojectSphere`/`sheetUnprojector` inverse `map.unproject()` uses.
   * `isBoundsVisible`'s complement case reads these — a tile containing one
   * of them covers a point that is genuinely on screen, so accepting it is
   * a true positive by construction, never an over-approximation of the
   * kind `candidateTileRange`'s min/max box deliberately is.
   *
   * A SINGLE point is not enough, and substituting `view.center` for these
   * nine was a real defect (reported as "the border layer disappears at
   * z > 6"). `view.center` does now project to dead centre of the viewport
   * by construction — `tilt` pitches about the surface point under it
   * ({@link GlyphMapHandle.setTilt}) — but that only makes it the CENTRE
   * sample, never the set: a 22.5 degree tile against a 3 degree viewport
   * straddles the viewport whenever the centre lands within a
   * viewport-width of a tile edge (Switzerland sits 0.8 degrees from its own
   * curated tile's south edge), so the corners and edge midpoints are what
   * keep the neighbouring tile from being dropped. That was the reported
   * failure's real mechanism, and it is untouched by the pivot: the borders
   * pyramid tops out at its curated z4, so past terrain's z6 no tile of it
   * had a sample of its OWN on screen either.
   *
   * Deriving them from the SCREEN also keeps them right under a pitch, where
   * the visible window is not a symmetric box around the centre at all — it
   * reaches much further toward the horizon than away from it, by exactly as
   * much as the pitch says. Nine points is enough BECAUSE the two tests are
   * complementary: any tile small enough to slip between these samples has
   * its own 3x3 samples land on screen and is caught by the primary test.
   *
   * Falls back to `[view.center]` when nothing unprojects (a projection
   * mid-`setProjection` blend, whose `unproject` throws by design; a
   * degenerate camera basis; a viewport entirely off the globe) — the exact
   * pre-existing behaviour for that case, never an empty set that would
   * silently disable the complement.
   */
  function viewportGeoSamples(padCells: number, grid: ProjectionGrid): readonly (readonly [number, number])[] {
    const orbit = isOrbitProjection();
    const solveSheet = orbit ? null : sheetUnprojector(grid);
    const samples: (readonly [number, number])[] = [];
    for (let i = 0; i <= 2; i++) {
      const col = -padCells + ((grid.cols + 2 * padCells) * i) / 2;
      for (let j = 0; j <= 2; j++) {
        const row = -padCells + ((grid.rows + 2 * padCells) * j) / 2;
        const lonLat = orbit ? unprojectSphere(col, row, grid) : (solveSheet ? solveSheet(col, row) : null);
        if (lonLat) samples.push(lonLat);
      }
    }
    return samples.length > 0 ? samples : [view.center];
  }

  /**
   * Single culling/visibility test for BOTH tile bounds and markers (MAPS.md
   * §13 slice 3: "stop, this reproduces two branches" — no plane-AABB vs
   * great-circle split; one sample-point test that degrades correctly for
   * every projection via `projection.visible`/NaN alone).
   *
   * The projected 3x3 corner/edge/centre sample grid below only proves a
   * tile visible when one of ITS OWN 9 sample points happens to land inside
   * the (padded) viewport — which misses the opposite containment case: a
   * SMALL, zoomed-in viewport sitting entirely INSIDE a LARGE tile, where
   * none of the tile's sparse samples has to be on-screen for the tile to
   * still cover the visible area. Found live on `/maps`: a provider whose
   * finest LOD tiles are still much coarser than a close, single-tile zoom
   * (jumping to a bounded region via `fitBounds`) failed every tile's
   * sample test, fell through to the "never blank the layer" failsafe below
   * (which always picks tile `0_0` regardless of where the camera actually
   * is), and rendered nothing when `0_0` wasn't it. The complement is
   * `viewportGeoSamples` — the lon/lat points the VIEWPORT ITSELF shows, so
   * a tile containing any of them is visible by construction. `±360` on the
   * longitude covers a view centred just past the antimeridian against an
   * "unwrapped" tile bounds box (the convention
   * `splitGlyphMapGeoTileAtAntimeridian` documents).
   */
  /**
   * `grid` is a caller-supplied {@link ProjectionGrid} rather than a fresh
   * `projectionGrid()` call per invocation (P2 "a2" fix): a deep tile sweep
   * calls this once per candidate, and `projectionGrid()` does two
   * `getBoundingClientRect()` calls — a real z7 sweep over 16,383 raw
   * candidates measured 32,766 layout reads from this alone. Every sweep
   * below now computes ONE grid before its loop and threads it through.
   * `geoSamples` is hoisted the same way and for the same reason (its own
   * doc) — one unprojection pass per sweep, not one per candidate tile.
   */
  /**
   * Which zoom level a sweep should ask for.
   *
   * Off walk mode this is `glyphMapTargetLOD(provider, span/cols)` and
   * nothing else, byte for byte.
   *
   * WALKING it is the provider's DEEPEST level, unconditionally, because
   * `view.span` stops being a resolution the moment the camera is a
   * positioned perspective one. `glyphMapWalkSpan` describes the horizon
   * FOOTPRINT, which is what the tile sweep's window needs; but the picture
   * inside it is not uniform — one output column subtends `fov / cols`
   * degrees of ARC, which at the frame's nearest ground (a few metres, under
   * a level 56 deg lens at 1.7 m) is CENTIMETRES per cell and at the horizon
   * is metres. It is the near field the reader is standing in, and no tile
   * pyramid resolves it, so "the finest level you have" is the honest answer
   * to `glyphMapTargetLOD`'s own question rather than a special case of it.
   *
   * Keying on the footprint instead made the walker's data resolution a
   * function of the WINDOW WIDTH, which is the defect this removes. The
   * threshold is `span/cols >= level.tileLonSpan/level.tileCols`, i.e. a
   * horizon of `9.54 * cols` metres for OpenFreeMap's z13/z14 boundary:
   * measured on the real page, 1,336 m at a 1440x900 grid (140 cols) but
   * only 468 m at a 390 px phone (49 cols), where the shipped 400 m horizon
   * sits 15% under the cliff by luck. Crossing it does not blur the city, it
   * DELETES it — rendered at Zurich with the buildings row on, `far: 2000`
   * dropped to z13 and not one building was drawn.
   */
  function sweepLOD(source: { readonly zooms: readonly GlyphMapProviderZoomLevel[] }): number {
    if (walk) return glyphMapFinestLOD(source);
    // `getView()`, not the raw `view` — see `updateProvider`'s own note: a
    // resize (or the density slider) never reaches the frozen `view.cols`.
    return glyphMapTargetLOD(source, glyphMapDegreesPerCell(getView()));
  }

  function isBoundsVisible(
    bounds: GlyphMapBounds,
    padCells: number,
    grid: ProjectionGrid,
    geoSamples: readonly (readonly [number, number])[],
  ): boolean {
    // WALKING, the horizon is LOCAL and this is its BOX half — the same one
    // predicate `nearSideVisible` is for points, and for the same reason:
    // every camera-derived answer below is derived for the ORTHOGRAPHIC
    // camera and is wrong under a positioned perspective one. Measured at
    // Zurich with the OpenStreetMap card on, `candidateTileRange` offered 35
    // z14 candidates and this function kept exactly ONE of them — the tile
    // the walker stands in — because `viewportGeoSamples` cannot unproject a
    // single screen point under the walk camera (so it degrades to
    // `[view.center]`, which only ever lands in the walker's own tile) and
    // `projection.visible` rejects the 3x3 corner probes of every neighbour.
    // With buildings mounted that is the whole city clipped to one 1.67 km
    // tile: a walker within `far` of any tile edge saw nothing across it,
    // and no increase to `far` could reach past it.
    //
    // A BOX test is what makes this safe, and is exactly what the note this
    // replaces warned a point test could not do: a tile is far bigger than
    // the horizon, so its corners and centre can all sit outside a `far`
    // disc while the walker stands in it — but its DISTANCE is zero there.
    if (walk) return glyphMapWalkBoundsWithinHorizon(view.center[0], view.center[1], bounds, walk.far);
    for (const [sampleLon, sampleLat] of geoSamples) {
      if (sampleLat < bounds.south || sampleLat > bounds.north) continue;
      for (const lon of [sampleLon, sampleLon + 360, sampleLon - 360]) {
        if (lon >= bounds.west && lon <= bounds.east) return true;
      }
    }
    const lons = [bounds.west, (bounds.west + bounds.east) / 2, bounds.east];
    const lats = [bounds.south, (bounds.south + bounds.north) / 2, bounds.north];
    for (const lat of lats) {
      for (const lon of lons) {
        const world = projection.project(lon, lat, 0);
        if (!Number.isFinite(world[0]) || !Number.isFinite(world[1]) || !Number.isFinite(world[2])) continue;
        if (projection.visible && !projection.visible(world, (w) => depthOf(w, grid))) continue;
        const [col, row] = camera.project(world, grid.cols, grid.rows, grid.cellAspect, grid);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
        if (col >= -padCells && col <= grid.cols + padCells && row >= -padCells && row <= grid.rows + padCells) return true;
      }
    }
    return false;
  }

  /**
   * Candidate tile index range for a sweep, computed from the VIEW's own
   * geographic window (P2 "a2" fix) — NOT from `level.bounds`, and not the
   * level's whole `cols x rows` grid. `glyphMapCuratedProvider` deliberately
   * leaves every curated level's `bounds` `undefined` (its effective
   * coverage is global — a miss degrades to an ancestor tile, see
   * `curated.ts`), so restricting on `level.bounds` degenerates to
   * enumerating the level's ENTIRE grid at every curated depth (measured:
   * 16,383 raw candidates at z7). The view's own window is real and cheap
   * regardless of whether a provider declares `bounds` at all, which is why
   * this replaces `level.bounds` as the sweep's restriction rather than
   * intersecting with it.
   *
   * Reuses `glyphMapTileRangeForLevel`'s own equal-angle math and
   * degenerate-range fallback (a synthesized `bounds` window that would
   * need antimeridian wraparound — `west < -180` or `east > 180` — is
   * dropped to `undefined`, which that function already falls back to the
   * full range for) rather than a second copy of the index formula.
   * `isBoundsVisible` remains the exact per-tile authority — a generous or
   * even a wrong window here only costs a slower sweep, never a missing
   * tile, the same contract `glyphMapTileRangeForLevel` already documents.
   */
  /**
   * The geographic box the camera can ACTUALLY see, for an ORBIT projection
   * (the globe — capability check, never `projection.id`), by unprojecting
   * a sample grid across the (padded) viewport through the same tilt-aware
   * `unprojectSphere` `map.unproject()` itself uses. `view.center`/
   * `view.span` are not enough on their own: `computeZoomForSpan` samples
   * `span` along the MERIDIAN so zoom stays latitude-invariant, so a plain
   * `view.span`-based box under-covers longitude by up to `1 / cos(lat)`
   * toward the poles; and `GlyphMapOptions.tilt` pitches the camera about
   * the surface point under `view.center`, which keeps the centre on screen
   * but makes the window ASYMMETRIC — it reaches much further toward the
   * horizon than away from it, so no box centred on `view.center` describes
   * it. Deriving the box from real unprojected screen samples is correct
   * under both effects at once, with no separate cos(lat) formula or tilt
   * bookkeeping needed.
   *
   * `null` (nothing on screen unprojects, or `isOrbitProjection()` is
   * false) tells `candidateTileRange` to fall back to its existing
   * `view.span`-based box (sheet) or the full sweep (orbit degenerate case)
   * — sampling never narrows the window below what a fallback would give,
   * only widens/repositions it, so a miss here only costs a slower sweep,
   * never a missing tile (this file's own standing contract for this
   * function).
   */
  /**
   * WALK MODE needs no branch here and deliberately has none. Measured
   * (z14 pyramid, 2.4 km tiles, 400 m horizon): every one of the 49 screen
   * samples fails to unproject under the positioned perspective camera, so
   * this returns `null` and `candidateTileRange` falls back to its own
   * `view.span` box — which walk mode has already set to the footprint
   * (`glyphMapWalkSpan`). The bound therefore reaches the sweep through
   * `view.span`, where every other consumer already reads it, and the sweep
   * asks for the four tiles under the walker.
   */
  function orbitCandidateGeoBounds(padCells: number): GlyphMapBounds | null {
    if (!isOrbitProjection()) return null;
    const grid = projectionGrid();
    const STEPS = 6; // 7x7 sample grid — cheap (candidateTileRange runs once per level per sweep, not per tile)
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    let hits = 0;
    for (let i = 0; i <= STEPS; i++) {
      const col = -padCells + ((grid.cols + 2 * padCells) * i) / STEPS;
      for (let j = 0; j <= STEPS; j++) {
        const row = -padCells + ((grid.rows + 2 * padCells) * j) / STEPS;
        const ll = unprojectSphere(col, row, grid);
        if (!ll) continue;
        hits++;
        west = Math.min(west, ll[0]);
        east = Math.max(east, ll[0]);
        south = Math.min(south, ll[1]);
        north = Math.max(north, ll[1]);
      }
    }
    if (hits === 0) return null;
    // A visible pole puts every longitude on screen; a min/max box over
    // sampled longitudes near a pole reads as an arbitrary narrow slice
    // depending on where samples happen to land, so widen explicitly
    // rather than trust the sampled west/east there.
    if (north >= 89 || south <= -89) { west = -180; east = 180; }
    return { west, east, south: Math.max(-90, south), north: Math.min(90, north) };
  }

  function candidateTileRange(
    level: GlyphMapProviderZoomLevel,
    padCells: number,
    /**
     * The provider's own addressing, defaulting to this package's
     * equal-angle one. Passing the raw geographic WINDOW (rather than a
     * pre-clamped `level.bounds`) is what lets a Mercator provider keep the
     * latitude restriction on an antimeridian-crossing view: the
     * equal-angle strategy's rule of dropping such a window to "sweep
     * everything" is survivable at a curated z7 and catastrophic at a
     * hosted z12, so that rule now lives inside the strategy that owns it
     * rather than out here. `glyphMapEqualAngleTileRange` applies it
     * verbatim, so this path is unchanged for every baked pyramid.
     */
    toRange: GlyphMapTileRangeStrategy = glyphMapEqualAngleTileRange,
  ): GlyphMapTileIndexRange {
    const geoBounds = orbitCandidateGeoBounds(padCells);
    if (geoBounds) {
      const west = geoBounds.west - level.tileLonSpan * (padCells + 1);
      const east = geoBounds.east + level.tileLonSpan * (padCells + 1);
      const south = Math.max(-90, geoBounds.south - level.tileLatSpan * (padCells + 1));
      const north = Math.min(90, geoBounds.north + level.tileLatSpan * (padCells + 1));
      return toRange(level, { west, east, south, north });
    }
    const [centerLon, centerLat] = view.center;
    // Slack beyond the view's own lon/lat box: a few tile-widths (absorbs
    // `padCells`' screen-space slack and camera tilt) plus the view's own
    // half-span again, so a moderately tilted/oriented camera can't see
    // past the window without a real chance of still being enumerated.
    // `getView()`'s live `cols`/`rows` (not the raw `view.cols`/`.rows`,
    // frozen wherever `setView` last left them — AGENTS.md's root-cause
    // doc): a wrong aspect here only costs a slower sweep, never a missing
    // tile (`isBoundsVisible` remains the real authority), but there is no
    // reason to feed it a stale one when the live value is one call away.
    const { cols: liveCols, rows: liveRows } = getView();
    const halfLonSpan = view.span / 2 + level.tileLonSpan * (padCells + 1);
    const halfLatSpan = (view.span * liveRows) / (2 * liveCols) + level.tileLatSpan * (padCells + 1);
    const west = centerLon - halfLonSpan;
    const east = centerLon + halfLonSpan;
    const south = Math.max(-90, centerLat - halfLatSpan);
    const north = Math.min(90, centerLat + halfLatSpan);
    return toRange(level, { west, east, south, north });
  }

  /**
   * `proj` defaults to the live closure `projection` for every ordinary
   * caller; `setProjection`'s `framingFor` passes an explicit ENDPOINT
   * projection instead, so it can ask "what zoom would projection X alone
   * use for this view" for both transition endpoints independently of
   * whatever `projection` currently holds mid-blend.
   */
  function computeZoomForSpan(v: GlyphMapView, proj: GlyphMapProjection = projection, grid: ProjectionGrid = projectionGrid()): number {
    const [lon, lat] = v.center;
    const fullDomainSpan = domainWidth(proj);
    const requestedSpan = Math.max(v.span, 1e-6);
    const sampledSpan = Math.min(requestedSpan, fullDomainSpan);
    const halfSpanDeg = sampledSpan / 2;
    const centerWorld = proj.project(lon, lat, 0);
    const isOrbit = !!(proj.cameraForCenter && proj.centerForCamera);
    // An ORBIT projection (the globe — detected by CAPABILITY, never
    // `proj.id`) is sampled along the MERIDIAN (varying latitude) instead of
    // the parallel (varying longitude): moving along a meridian is always a
    // full-radius great-circle rotation, so the resulting chord is
    // latitude-invariant. Sampling along the parallel — what this function
    // used to do unconditionally — shrinks the chord by `cos(lat)` toward
    // the poles, so the same `span` bought up to ~57x more `camera.zoom` at
    // lat 89 than at the equator (measured; AGENTS.md's "b1" fix). A sheet
    // projection (equirectangular/Mercator/orthographic) has no such axis
    // asymmetry — `project` is linear in `lon` for every one of them — so
    // this branch leaves the sheet path's sampled axis, and its output,
    // unchanged.
    //
    // The meridian sample is deliberately UNCLAMPED (no `Math.max(-90,
    // Math.min(90, ...))` any more): `glyphMapGlobe.project()` is periodic
    // in latitude and never NaN — going past a pole along a fixed meridian
    // is a genuine, continuous point on the OTHER side of the sphere, not an
    // invalid one. Clamping the SAMPLE (not the geometry) froze the
    // meridian chord the instant `lat + halfSpanDeg` crossed +/-90, which
    // made `halfWorldSpan` — and so `camera.zoom` — silently
    // latitude-dependent right at that crossing (measured: a drag north
    // that crosses this boundary then a single wheel notch produced a
    // x1.277 zoom snap) and froze it flat across an entire multi-notch wheel
    // range beyond it (measured: 4+ consecutive wheel-out notches with ZERO
    // visible span/zoom change from span ~221 to ~348). A projection making
    // the same orbit CAPABILITY promise without sharing that periodicity
    // still degrades safely: `worldSpanOf` below returns NaN for a
    // non-finite sample and the rate-based fallback further down picks it
    // up.
    const edgeWorld = (offset: number): Vec3 =>
      isOrbit ? proj.project(lon, lat + offset, 0) : proj.project(lon + offset, lat, 0);
    const worldSpanOf = (offset: number): number => {
      const edge = edgeWorld(offset);
      if (!Number.isFinite(edge[0]) || !Number.isFinite(edge[1]) || !Number.isFinite(edge[2])) return NaN;
      return Math.hypot(edge[0] - centerWorld[0], edge[1] - centerWorld[1], edge[2] - centerWorld[2]);
    };
    // A local rate (world units per degree) from a tiny, always-valid step
    // either side of CENTER, extrapolated linearly over the full
    // half-span. It never touches the far, possibly-invalid edge at all, so
    // it stays defined and continuous straight through a horizon crossing
    // that would otherwise flip which edge is finite.
    const rateEstimate = (): number => {
      const rateEps = 1e-4;
      const rateA = edgeWorld(rateEps);
      const rateB = edgeWorld(-rateEps);
      const rate = Number.isFinite(rateA[0]) && Number.isFinite(rateA[1]) && Number.isFinite(rateA[2])
        && Number.isFinite(rateB[0]) && Number.isFinite(rateB[1]) && Number.isFinite(rateB[2])
        ? Math.hypot(rateA[0] - rateB[0], rateA[1] - rateB[1], rateA[2] - rateB[2]) / (2 * rateEps)
        : NaN;
      const estimate = rate * halfSpanDeg;
      return Number.isFinite(estimate) && estimate > 1e-9 ? estimate : 1e-6;
    };
    let halfWorldSpan: number;
    if (!isOrbit) {
      // SHEET projections ALWAYS use the local-derivative estimate — never
      // "average both edges when both are valid, otherwise fall back to the
      // rate" (the old plus-then-minus-then-rate ladder). A measure that is
      // sometimes an average of two real samples and sometimes a rate-based
      // estimate is discontinuous exactly AT the boundary where one edge
      // flips from finite to NaN — orthographic's far-hemisphere `NaN`
      // (`projection.ts`'s `cosC < 0` crop) is exactly such a boundary
      // (measured: an extra x1.182 zoom-out in a single wheel notch at that
      // crossing, on top of the requested x1.12 step). The derivative never
      // touches the far edge at all, so it stays continuous straight
      // through. It is EXACT for equirectangular/Mercator (`project` is
      // linear in `lon` for both, so the local rate never differs from the
      // true chord) and a smooth, continuous APPROXIMATION for orthographic
      // — strictly better than a measure that saturates as `|sin(dLon)|`
      // and then discontinuously swaps to an unrelated one.
      halfWorldSpan = rateEstimate();
    } else {
      // ORBIT: with the clamp removed above, `glyphMapGlobe`'s own
      // `project()` never returns NaN, so `plus`/`minus` are always both
      // valid AND — by meridian/great-circle symmetry — always exactly
      // equal (chord distance depends only on the ANGULAR separation `h`,
      // not on which side of center it's measured from), giving an EXACT
      // closed-form chord with no approximation needed. A custom orbit
      // projection is not assumed to share the globe's own periodicity, so
      // this still degrades to the rate-based estimate if its own
      // `project()` returns non-finite at the (unclamped) sample point.
      const plus = worldSpanOf(halfSpanDeg);
      const minus = worldSpanOf(-halfSpanDeg);
      const validPlus = Number.isFinite(plus) && plus > 1e-9;
      const validMinus = Number.isFinite(minus) && minus > 1e-9;
      halfWorldSpan = validPlus && validMinus ? (plus + minus) / 2 : rateEstimate();
    }
    // The host's own rendered pixel WIDTH — `grid.cols * grid.cellWidth`,
    // not `v.cols * grid.cellWidth` (the OLD formula). `grid.cellWidth` is
    // itself DEFINED as `outputRect.width / grid.cols` (`projectionGrid()`),
    // so `grid.cols * grid.cellWidth` always recovers the real rendered
    // pixel width regardless of `cols`/cell size — invariant to both by
    // construction, unlike `v.cols`, which is `view`'s OWN `cols` field:
    // frozen wherever `setView`/`applyDrag`/`applyWheel` last left it, never
    // updated when `scene`'s live `cols` changes underneath it (autoSize, or
    // a caller poking `scene.setOptions({ cols, rows })` directly — e.g. a
    // density slider). That divergence is what let a font-size-only change
    // (cols same, cellWidth halved) silently multiply `camera.zoom` by
    // exactly 2 on the NEXT view->camera sync (AGENTS.md's "the view/camera
    // round-trip is not the identity" root cause).
    const sampledZoom = (grid.cols * grid.cellWidth) / (halfWorldSpan * 2);
    // Beyond the complete geographic domain there is no new edge to sample.
    // Continue the span scale linearly: 720° frames a 360° world at half
    // size, creating a real overview margin instead of pinning the camera.
    return sampledZoom * (sampledSpan / requestedSpan);
  }

  // ── PITCH: the ceiling, and the pitch actually applied ─────────────────

  /**
   * The steepest pitch `v` can hold under `proj`, degrees — the public
   * {@link GlyphMapHandle.getMaxTilt}'s implementation, where its derivation
   * is written out. In one line: the HORIZON ANGLE `asin(R / (R + h))` at
   * the view's own scale, capped at {@link GLYPH_MAP_MAX_TILT}.
   *
   * `h` is the frame's world-space HALF-HEIGHT, `(rows * cellHeight / 2) /
   * zoom`. That numerator is the host's rendered pixel height (`grid.rows *
   * grid.cellHeight` recovers it by the same construction `computeZoomForSpan`
   * relies on for the width), so — like `camera.zoom` itself, and gated the
   * same way — the ceiling is invariant to `cols`/`rows`/cell size for a
   * fixed host and span.
   *
   * `R` is read from the projection: `|proj.project(lon, lat, 0)|`, the
   * datum's distance from the world origin. That is the SAME origin-centred
   * sphere `glyphMapGlobe.visible` already assumes when it takes
   * `depthOf([0, 0, 0])` as its reference plane, so this introduces no new
   * assumption about an orbit projection's world frame.
   *
   * A SHEET has no limb — a plane is intersected by every ray short of
   * edge-on — so its ceiling is the flat-surface cap alone, and the check is
   * a CAPABILITY question (`isOrbit`), never `proj.id`. A degenerate measure
   * (zero radius, a non-finite zoom before the first sync) degrades to the
   * same cap rather than throwing or pinning the camera head-on.
   */
  function maxTiltFor(proj: GlyphMapProjection, v: GlyphMapView, zoom: number, grid: ProjectionGrid): number {
    if (!isOrbit(proj)) return GLYPH_MAP_MAX_TILT;
    const world = proj.project(v.center[0], v.center[1], 0);
    const radius = Math.hypot(world[0], world[1], world[2]);
    const halfHeight = ((grid.rows * grid.cellHeight) / 2) / zoom;
    if (!(radius > 0) || !(halfHeight > 0) || !Number.isFinite(halfHeight)) return GLYPH_MAP_MAX_TILT;
    return Math.min(GLYPH_MAP_MAX_TILT, (Math.asin(radius / (radius + halfHeight)) * 180) / Math.PI);
  }

  /** The pitch to actually pose the camera at for `(proj, v)`: the caller's request, clamped to {@link maxTiltFor}. */
  function tiltFor(proj: GlyphMapProjection, v: GlyphMapView, zoom: number, grid: ProjectionGrid): number {
    // Walking, the pitch is a NECK: measured from the local horizontal, not
    // from straight down, and bounded either side of it. The orthographic
    // ceiling `asin(R / (R + h))` is the wrong quantity here twice over —
    // it is a footprint bound, and it opens to 90 as the altitude goes to
    // zero, which is exactly where the walker already is.
    if (walk) { const [lo, hi] = walkTiltRange(); return clamp(tiltRequest, lo, hi); }
    const max = maxTiltFor(proj, v, zoom, grid);
    return clamp(tiltRequest, -max, max);
  }

  // ── COVER, NOT CONTAIN (sheet projections only) ───────────────────────
  //
  // A flat map must FILL the viewport: no page background around its edges,
  // at any zoom or pan position. Two constraints enforce that, and both are
  // gated on the same capability check every other projection-aware branch
  // in this file uses — a projection with `cameraForCenter`/`centerForCamera`
  // is navigated by ORBITING fixed geometry, legitimately floats in space
  // with background around it (dragging the globe through the pole is a
  // feature), and is exempt from both:
  //
  //   1. `spanCoverLimit` — the widest `view.span` whose camera still covers
  //      the viewport on BOTH axes, replacing the old default of "the
  //      projection's `domain` WIDTH" (360deg for equirectangular, i.e.
  //      the whole world laid out inside a viewport that is rarely 2:1, so
  //      it letterboxed on whichever axis was not binding).
  //   2. `clampWorldToCover` — the visible window is kept INSIDE the map's
  //      own projected extent, per axis, so a pan cannot pull the map's edge
  //      in from the side either.
  //
  // Both are derived from the projection's OWN projected extent, never from
  // a per-projection table: `projectedDomainBox` projects the projection's
  // declared `domain` and measures what comes out.

  interface ProjectedBox { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }

  /** Samples per axis over `domain`. 33x33 projections, memoized per projection object (below) — a settled widget computes this once. */
  const COVER_DOMAIN_SAMPLES = 32;
  let domainBoxCache: { readonly proj: GlyphMapProjection; readonly box: ProjectedBox | null } | null = null;

  /**
   * World-space AABB of everything `proj` can draw — its `domain` projected
   * at `elev: 0`, with the non-finite samples outside the projection's true
   * valid window skipped ("crop, don't clamp", `projection.ts`'s own rule).
   *
   * Sampled rather than derived, because `domain` is in DEGREES and
   * `project` is an arbitrary function: the only projection-agnostic way to
   * ask "how big is this map in world units" is to project it and measure.
   * A sampling grid can only ever UNDER-measure an extent it misses between
   * samples, which errs toward a slightly tighter (more zoomed-in) cover
   * limit — the safe direction, since a smaller measured map demands more
   * zoom, never less.
   *
   * An AXIS-ALIGNED BOX is deliberately the whole contract. A projection
   * whose valid region is not a world-space rectangle — orthographic's disc
   * — cannot cover a rectangular viewport's CORNERS at any span short of
   * cropping to the disc's inscribed rectangle, which would put the
   * hemisphere's own limb permanently out of reach. Covering the bbox
   * removes the letterbox BANDS (the whole visible margin for
   * equirectangular/Mercator, and the dominant one for orthographic) and
   * leaves only those four corner arcs.
   */
  function projectedDomainBox(proj: GlyphMapProjection): ProjectedBox | null {
    if (domainBoxCache && domainBoxCache.proj === proj) return domainBoxCache.box;
    const d = proj.domain;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= COVER_DOMAIN_SAMPLES; i++) {
      const lon = d.west + ((d.east - d.west) * i) / COVER_DOMAIN_SAMPLES;
      for (let j = 0; j <= COVER_DOMAIN_SAMPLES; j++) {
        const lat = d.south + ((d.north - d.south) * j) / COVER_DOMAIN_SAMPLES;
        const w = proj.project(lon, lat, 0);
        if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) continue;
        if (w[0] < minX) minX = w[0];
        if (w[0] > maxX) maxX = w[0];
        if (w[1] < minY) minY = w[1];
        if (w[1] > maxY) maxY = w[1];
      }
    }
    const box = maxX > minX && maxY > minY ? { minX, maxX, minY, maxY } : null;
    domainBoxCache = { proj, box };
    return box;
  }

  /**
   * Screen PIXELS per world unit along each world axis, at `zoom: 1`, for
   * the SHEET camera pose — world X (this package's north/south axis, see
   * `glyphMapEquirectangular`'s doc) and world Y (east/west).
   *
   * Measured through {@link coverProbeCamera}'s public `project()` rather
   * than computed as `zoom` / `zoom * cos(tilt)`, so the vertical
   * foreshortening a tilted sheet gets is whatever the real camera actually
   * applies. `rotY` is `0` for every sheet framing, so the two world axes
   * land on the two screen axes with no shear and the per-axis magnitude
   * below is exact.
   */
  function sheetScreenScale(grid: ProjectionGrid): { readonly perWorldX: number; readonly perWorldY: number } {
    // A sheet's pitch is the flat-surface cap and nothing more (`maxTiltFor`),
    // so this needs no view: it is exactly the pose `framingFor`'s sheet
    // branch and `setTilt`'s sheet branch install on the live camera.
    coverProbeCamera.rotX = clamp(tiltRequest, -GLYPH_MAP_MAX_TILT, GLYPH_MAP_MAX_TILT);
    coverProbeCamera.rotY = 0;
    coverProbeCamera.zoom = 1;
    coverProbeCamera.target = [0, 0, 0];
    const at = (v: Vec3) => coverProbeCamera.project(v, grid.cols, grid.rows, grid.cellAspect, grid);
    const o = at([0, 0, 0]);
    const ex = at([1, 0, 0]);
    const ey = at([0, 1, 0]);
    return {
      perWorldX: Math.hypot((ex[0]! - o[0]!) * grid.cellWidth, (ex[1]! - o[1]!) * grid.cellHeight),
      perWorldY: Math.hypot((ey[0]! - o[0]!) * grid.cellWidth, (ey[1]! - o[1]!) * grid.cellHeight),
    };
  }

  /**
   * The widest `view.span` at which `proj` still covers the viewport, or
   * `Infinity` where the rule does not apply (an orbit projection, or a
   * projection whose extent cannot be measured).
   *
   * Inverting "zoom that covers" back into "span" needs no search: for a
   * sheet, `computeZoomForSpan` is EXACTLY inverse-linear in span — its
   * sheet branch is `zoom = hostPxWidth / (rate(centre) * span)`, where
   * `rate` is a local derivative taken with a fixed epsilon that never
   * depends on the span — so one probe at `span: 1` fixes the whole curve.
   * That also keeps this consistent with the real camera by construction,
   * rather than re-deriving a second zoom formula that could drift from it.
   */
  function spanCoverLimit(proj: GlyphMapProjection, v: GlyphMapView): number {
    if (!coverApplies(proj)) return Infinity;
    const box = projectedDomainBox(proj);
    if (!box) return Infinity;
    const grid = projectionGrid();
    const { perWorldX, perWorldY } = sheetScreenScale(grid);
    const viewPxW = grid.cols * grid.cellWidth;
    const viewPxH = grid.rows * grid.cellHeight;
    const mapPxW = (box.maxY - box.minY) * perWorldY;
    const mapPxH = (box.maxX - box.minX) * perWorldX;
    // The BINDING axis is whichever needs the most zoom to be filled — that
    // is what makes this follow the host's shape (a wide viewport binds on
    // height, a tall one on width) instead of assuming a world aspect.
    //
    // With a BEARING the visible window is a rotated rectangle inside an
    // axis-aligned box, and both of its world-axis reaches grow: the AABB of
    // a `w x h` rect turned by `b` is `w|cos b| + h|sin b|` by
    // `w|sin b| + h|cos b|`, worst at 45 degrees. Ignoring that under-covers
    // — at bearing 45 on a 16:7 grid a corner of the map comes inside the
    // viewport, which is the exact letterbox the cover rule exists to
    // remove. Bearing 0 takes the original expressions verbatim, not the
    // general ones with `cos 0`/`sin 0` substituted, because `(a/b)/c` and
    // `a/(b*c)` are not the same double.
    const coverZoom = bearing === 0
      ? Math.max(
        mapPxW > 0 ? viewPxW / mapPxW : 0,
        mapPxH > 0 ? viewPxH / mapPxH : 0,
      )
      : (() => {
        const t = (bearing * Math.PI) / 180;
        const bc = Math.abs(Math.cos(t)), bs = Math.abs(Math.sin(t));
        // World reach the viewport needs along each axis, times `zoom`.
        const alongX = (viewPxH / perWorldX) * bc + (viewPxW / perWorldY) * bs;
        const alongY = (viewPxH / perWorldX) * bs + (viewPxW / perWorldY) * bc;
        const boxH = box.maxX - box.minX, boxW = box.maxY - box.minY;
        return Math.max(boxH > 0 ? alongX / boxH : 0, boxW > 0 ? alongY / boxW : 0);
      })();
    if (!(coverZoom > 0) || !Number.isFinite(coverZoom)) return Infinity;
    const probeZoom = computeZoomForSpan({ ...v, span: 1 }, proj);
    if (!(probeZoom > 0) || !Number.isFinite(probeZoom)) return Infinity;
    return probeZoom / coverZoom;
  }

  /**
   * The projection every span/centre clamp is taken against: the live one
   * when settled, and a `setProjection` flight's DESTINATION while one is in
   * the air.
   *
   * Using the destination is what keeps a flight from snapping at its own
   * boundary when the two endpoints' limits differ. The alternative — the
   * live blended projection — is not usable: it exposes no
   * `cameraForCenter`, so a globe->sheet flight would read as a sheet from
   * its very first blended frame and start clamping a view the globe
   * endpoint is entitled to. Reading the destination instead makes the limit
   * CONSTANT across the whole flight and exactly equal to the projection
   * that is live at `t = 1`, so nothing changes at either boundary.
   * `setProjection` applies it once, up front, so the flight's own zoom
   * pacing absorbs the change continuously (see its own comment).
   */
  function limitProjection(): GlyphMapProjection {
    return projectionAnim ? projectionAnim.to : projection;
  }

  /**
   * Does the cover rule apply at all?
   *
   * Two exemptions, both deliberate. An ORBIT projection legitimately floats
   * in space (capability, never `projection.id`). And an explicit
   * `maxSpan` is the documented "I want overview margin around the whole
   * projection" opt-out — margin is precisely what cover removes, so the two
   * cannot both be honoured, and the caller's explicit request wins. When it
   * is set, this widget behaves exactly as it did before the cover rule
   * existed: neither the span nor the centre is cover-clamped.
   */
  function coverApplies(proj: GlyphMapProjection): boolean {
    return opts.maxSpan === undefined && !isOrbit(proj);
  }

  function maxViewSpan(proj: GlyphMapProjection = limitProjection(), v: GlyphMapView = view): number {
    if (opts.maxSpan !== undefined) return Math.max(minSpan, opts.maxSpan);
    return Math.max(minSpan, Math.min(domainWidth(proj), spanCoverLimit(proj, v)));
  }

  /**
   * Clamp one world axis so the visible window (`half` either side of the
   * centre) stays inside `[lo, hi]`.
   *
   * When the window is WIDER than the map on that axis the constraint is
   * infeasible — Mercator's finite north/south window inside a very tall
   * viewport is the real case — and the axis is CENTRED on the map instead.
   * That is a single fixed point, so a drag against it settles rather than
   * oscillating between two clamps, and it degrades to symmetric background
   * top and bottom rather than pinning the map to one edge.
   */
  function coverAxis(value: number, lo: number, hi: number, half: number): number {
    const min = lo + half;
    const max = hi - half;
    if (!(min <= max)) return (lo + hi) / 2;
    return value < min ? min : value > max ? max : value;
  }

  function clampWorldToCover(wx: number, wy: number, box: ProjectedBox, zoom: number, grid: ProjectionGrid): readonly [number, number] {
    const { perWorldX, perWorldY } = sheetScreenScale(grid);
    const scaleX = zoom * perWorldX;
    const scaleY = zoom * perWorldY;
    if (!(scaleX > 0) || !(scaleY > 0) || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return [wx, wy];
    const halfX = (grid.rows * grid.cellHeight) / (2 * scaleX);
    const halfY = (grid.cols * grid.cellWidth) / (2 * scaleY);
    // The rotated-rect AABB — see `spanCoverLimit` for why, and for why
    // bearing 0 short-circuits instead of multiplying through by 1 and 0.
    if (bearing !== 0) {
      const t = (bearing * Math.PI) / 180;
      const bc = Math.abs(Math.cos(t)), bs = Math.abs(Math.sin(t));
      return [
        coverAxis(wx, box.minX, box.maxX, halfX * bc + halfY * bs),
        coverAxis(wy, box.minY, box.maxY, halfX * bs + halfY * bc),
      ];
    }
    return [
      coverAxis(wx, box.minX, box.maxX, halfX),
      coverAxis(wy, box.minY, box.maxY, halfY),
    ];
  }

  /**
   * `v.center`, pulled back to wherever the viewport still sits inside the
   * map. Works in WORLD space (project -> clamp -> unproject) rather than in
   * degrees, because "half a viewport" is a world-space length: clamping
   * lon/lat directly would need a per-projection conversion, which is
   * exactly the per-projection branching this file does not do.
   */
  function coverCenter(v: GlyphMapView, proj: GlyphMapProjection): readonly [number, number] {
    if (!coverApplies(proj)) return v.center;
    const box = projectedDomainBox(proj);
    if (!box) return v.center;
    const world = proj.project(v.center[0], v.center[1], 0);
    if (!Number.isFinite(world[0]) || !Number.isFinite(world[1])) return v.center;
    const [wx, wy] = clampWorldToCover(world[0], world[1], box, computeZoomForSpan(v, proj), projectionGrid());
    if (wx === world[0] && wy === world[1]) return v.center;
    return tryUnproject(proj, [wx, wy, 0]) ?? v.center;
  }

  /**
   * The one place a view is made legal. Span first (it decides how much of
   * the map the viewport shows, which is what the centre clamp measures
   * against), then the centre. A view this changed no longer names the
   * `bounds` box it may have been built from, so that box is dropped — the
   * same rule `applyDrag`/`applyWheel` already follow.
   */
  function clampViewToCover(v: GlyphMapView, proj: GlyphMapProjection = limitProjection()): GlyphMapView {
    let out = v;
    // ITERATED to a fixed point, because the two clamps are coupled wherever
    // a projection's SCALE varies across its own domain (orthographic:
    // `computeZoomForSpan`'s local rate falls off as `cos(dLon)` away from
    // the anchor). Pulling the centre in changes that rate, which changes
    // both the zoom the centre clamp measured itself against AND the span
    // limit — one pass left the view slightly UNDER-covered and made the
    // next wheel notch step the zoom back UP (measured x1.10 on the
    // orthographic notch ladder, i.e. a visible reversal mid-gesture).
    // Equirectangular/Mercator have a constant rate and settle on pass two
    // by the early-out below; the bound is a guard, never a convergence
    // promise — a projection that did not settle would simply keep the last
    // (still legal-by-span) iterate rather than loop.
    for (let pass = 0; pass < 4; pass++) {
      const span = clamp(out.span, minSpan, maxViewSpan(proj, out));
      const withSpan = span === out.span ? out : { ...out, span, bounds: undefined };
      const center = coverCenter(withSpan, proj);
      const next = center === withSpan.center ? withSpan : { ...withSpan, center, bounds: undefined };
      if (next === out) return out;
      out = next;
    }
    return out;
  }

  /**
   * Do `a` and `b` name the SAME point on `proj`'s surface? Compared through
   * `proj.project` rather than by comparing degrees, so longitude wrap
   * (`180` vs `-180`) and the pole degeneracy (where longitude is arbitrary
   * and `centerForCamera`'s `Math.atan2(0, 0)` answers `0`) both fall out for
   * free instead of needing their own special cases. Tolerance is relative to
   * the projection's own world scale — `glyphMapGlobe({ radius })` is
   * configurable, so an absolute epsilon would mean different things on
   * different globes.
   */
  function sameSurfacePoint(proj: GlyphMapProjection, a: readonly [number, number], b: readonly [number, number]): boolean {
    const pa = proj.project(a[0], a[1], 0);
    const pb = proj.project(b[0], b[1], 0);
    for (let i = 0; i < 3; i++) if (!Number.isFinite(pa[i]) || !Number.isFinite(pb[i])) return false;
    const scale = Math.max(1, Math.hypot(pa[0], pa[1], pa[2]));
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) <= scale * 1e-9;
  }

  /**
   * The TRUE (tilt-free) orbit rotation framing `(lon, lat)` under `proj` —
   * the held {@link orbitRotation} branch whenever that branch STILL frames
   * exactly this centre, and `proj.cameraForCenter`'s canonical branch
   * otherwise.
   *
   * This is what makes the view <-> camera round-trip the identity for a
   * camera that a through-pole drag left outside `cameraForCenter`'s own
   * `[0, 180]` range: a wheel notch, `resize`, `setTilt`, or a `setView` that
   * does not move the centre all re-sync against the SAME centre, so the held
   * branch still maps to it and is reused verbatim — no flip. A genuinely
   * different centre (`setView({ center })`, `fitBounds`) has no held
   * preimage and re-derives the canonical, north-up branch, which is what an
   * explicit "frame this place" request should give.
   *
   * The reuse test is a CAPABILITY question asked of `proj` itself ("does
   * this rotation still frame that centre under YOUR inverse?"), never a
   * projection-identity check, so it stays correct across a `setProjection`
   * to a different orbit projection: an endpoint whose `centerForCamera`
   * disagrees simply fails the test and gets its own canonical branch.
   */
  function orbitRotationFor(proj: GlyphMapProjection, lon: number, lat: number): { readonly rotX: number; readonly rotY: number } {
    const inverse = proj.centerForCamera;
    if (orbitRotation && inverse && sameSurfacePoint(proj, inverse(orbitRotation.rotX, orbitRotation.rotY), [lon, lat])) {
      return orbitRotation;
    }
    return proj.cameraForCenter!(lon, lat);
  }

  /**
   * Pose the perspective camera for a walker standing at `v.center`.
   *
   * The ORIENTATION is the widget's existing orbit pose read at its limit,
   * not a second camera model: `cameraForCenter(lon, lat)` gives the camera
   * looking straight DOWN at the walker, `appliedTilt` pitches it about that
   * same surface point, and at {@link GLYPH_MAP_WALK_HORIZON_TILT_DEG} the
   * pitch has swung the view axis onto the local horizontal — dead ahead.
   * `syncCameraBearing()` then turns it about the pivot's own local up,
   * which is a compass heading, and keeps the horizon LEVEL by construction
   * (`M * u_c = E * u_c` for every bearing) — the one thing a walker cannot
   * do without and a view-axis roll would destroy.
   *
   * The POSITION is the part the orthographic camera has no notion of. An
   * orthographic camera has no eye; this one's sits `P / BASE_TILE` world
   * units behind `camera.target` along the view axis, so standing at eye
   * height means putting `target` that far AHEAD of where the walker's eyes
   * are. `BASE_TILE` is glyphcss's own constant and is PROBED rather than
   * assumed: `eyeDepth` is affine in the world point (its own contract), so
   * two evaluations one world unit apart along the view axis give the slope
   * exactly, and the eye lands where this arithmetic says even if that
   * constant ever moves.
   *
   * Every length that is a TRUE metre — the eye height, the near plane —
   * converts through {@link glyphMapTrueScaleElevation}, the package's one
   * elevation conversion, so a terrain `exaggeration` raises the GROUND the
   * walker stands on without making them 40 m tall. Same rule, same reason,
   * as a `fill-extrusion`'s height.
   */
  function poseWalkCamera(v: GlyphMapView): void {
    const w = walk!;
    const [lon, lat] = v.center;
    const grid = projectionGrid();
    const ground = projection.project(lon, lat, walkGroundElevation);
    const oneMetre = glyphMapTrueScaleElevation(1, projection);
    const raised = projection.project(lon, lat, walkGroundElevation + oneMetre);
    // One TRUE metre straight up, in world units — direction and length both.
    const upM: Vec3 = [raised[0] - ground[0], raised[1] - ground[1], raised[2] - ground[2]];
    const worldPerMetre = Math.hypot(upM[0], upM[1], upM[2]);
    if (!(worldPerMetre > 0) || !Number.isFinite(worldPerMetre)) return;

    // The APPLIED pitch, clamped to the neck, exactly as the orthographic
    // branch resolves its own against the horizon ceiling — this is the one
    // place `tiltRequest` becomes `appliedTilt`, so `setTilt` and the orient
    // gesture both reach their bound through it rather than each carrying a
    // clamp of their own. (`camera.zoom` is a dummy argument here: `tiltFor`'s
    // walk branch is a function of `tiltRequest` and the neck alone.)
    appliedTilt = tiltFor(projection, v, camera.zoom, grid);
    const { rotX, rotY } = orbitRotationFor(projection, lon, lat);
    orbitRotation = { rotX, rotY };
    camera.rotX = rotX + appliedTilt;
    camera.rotY = rotY;
    const eye: Vec3 = [
      ground[0] + upM[0] * w.eyeHeight,
      ground[1] + upM[1] * w.eyeHeight,
      ground[2] + upM[2] * w.eyeHeight,
    ];
    // A provisional target so `syncCameraBearing`/`headlightDirection` read a
    // fully posed camera; replaced below once the view axis is known.
    camera.target = eye;
    syncCameraBearing();

    // `headlightDirection()` is the camera's own depth GRADIENT — the
    // direction from a point toward the eye — read off `camera.mat` when a
    // bearing is installed and off the Euler angles when it is not, so it is
    // the one expression that is right in both cases. The walker looks the
    // other way.
    const toCamera = headlightDirection();
    const forward: Vec3 = [-toCamera[0], -toCamera[1], -toCamera[2]];

    // glyphcss's BASE_TILE, probed rather than assumed: `eyeDepth` is affine
    // in the world point (its own contract) and its slope along the view
    // axis is exactly that constant, independent of `perspective`. So this
    // is one subtraction and it stays right if the constant ever moves.
    const e0 = camera.eyeDepth(eye);
    const e1 = camera.eyeDepth([eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]]);
    const baseTilePx = e1 - e0;
    if (!(baseTilePx > 0) || !Number.isFinite(baseTilePx)) return;

    const lens = glyphMapWalkLens({
      nearWorld: w.near * worldPerMetre,
      fovDeg: w.fov,
      viewportWidthPx: grid.cols * grid.cellWidth,
      baseTilePx,
    });
    camera.perspective = lens.perspective;
    camera.zoom = lens.zoom;
    // The eye sits `P / BASE_TILE` world units behind `target`, so standing
    // at eye height means putting the target that far AHEAD of the eyes.
    const ahead = lens.perspective / baseTilePx;
    camera.target = [
      eye[0] + forward[0] * ahead,
      eye[1] + forward[1] * ahead,
      eye[2] + forward[2] * ahead,
    ];
    // The heading matrix is built from `rotX`/`rotY` and the pivot's local up
    // alone, so moving `target` cannot have staled it.
  }

  function syncCameraToView(v: GlyphMapView): void {
    // Walk mode owns the whole pose — lens, position and orientation — and
    // shares only the pitch/heading state. There is no zoom-for-span to
    // compute and no pitch ceiling to derive from a synthetic altitude:
    // the walker has a real one.
    if (walk) { poseWalkCamera(v); return; }
    const [lon, lat] = v.center;
    // ONE grid for the whole sync (two `getBoundingClientRect`s, this file's
    // standing rule), and the zoom BEFORE the pitch: the pitch ceiling is a
    // function of `camera.zoom`, so deriving it from the zoom this sync is
    // about to install — rather than the one still on the camera — is what
    // keeps the sync idempotent across a span change.
    const grid = projectionGrid();
    const zoom = computeZoomForSpan(v, projection, grid);
    const pitch = tiltFor(projection, v, zoom, grid);
    if (projection.cameraForCenter) {
      const { rotX, rotY } = orbitRotationFor(projection, lon, lat);
      orbitRotation = { rotX, rotY };
      camera.rotX = rotX + pitch;
      camera.rotY = rotY;
      // The PIVOT: the surface point under the view centre, not the globe's
      // centre — `setTilt`'s doc for the model. At `pitch: 0` this is on the
      // view axis, so it moves depth by a constant and col/row by nothing.
      camera.target = projection.project(lon, lat, 0);
    } else {
      // A sheet's `camera.rotX` IS its pitch and is written by `setTilt`/
      // construction, never here — the sheet pose is byte-identical to
      // before this model existed.
      camera.target = projection.project(lon, lat, 0);
    }
    appliedTilt = pitch;
    camera.zoom = zoom;
    // The heading rides on TOP of the pose this just installed, and is
    // rebuilt from it — a matrix left over from the previous centre would
    // turn about the wrong point (see `syncCameraBearing`).
    syncCameraBearing();
  }

  // ── project()/unproject() ────────────────────────────────────────────

  function project(lngLat: readonly [number, number]): GlyphMapProjectResult {
    const grid = projectionGrid();
    const world = projection.project(lngLat[0], lngLat[1], 0);
    if (!Number.isFinite(world[0]) || !Number.isFinite(world[1]) || !Number.isFinite(world[2])) {
      return { col: NaN, row: NaN, visible: false };
    }
    const [col, row] = camera.project(world, grid.cols, grid.rows, grid.cellAspect, grid);
    const visible = Number.isFinite(col) && Number.isFinite(row)
      // Walking, the horizon is LOCAL — see `nearSideVisible`. The perspective
      // camera's own near-plane rejection already returns NaN for anything
      // behind the eye, so that plus the on-grid test below is the whole
      // verdict.
      && nearSideVisible(lngLat[0], lngLat[1], world, grid)
      && col >= 0 && col <= grid.cols && row >= 0 && row <= grid.rows;
    return { col, row, visible };
  }

  /**
   * `projection.unproject` THROWS for a strictly-interior `setProjection`
   * blend (`glyphMapProjectionTransition`'s own doc: "not generally
   * invertible"). Every caller of `unproject` — click-to-lonlat,
   * `unprojectSheet` itself, contour field sampling (through the public
   * `unproject()` wrapper) — must degrade to "no answer" for the
   * transition's duration rather than propagate that throw, per
   * `transition.ts`'s documented expectation. A `try`/`catch` here (rather
   * than a separate "is a transition active" flag threaded through every
   * call site) degrades correctly for ANY projection whose `unproject`
   * throws, not just this package's own transition blend.
   */
  function tryUnproject(proj: GlyphMapProjection, p: Vec3): readonly [number, number] | null {
    try {
      return proj.unproject(p);
    } catch {
      return null;
    }
  }

  /**
   * The sheet inverse, with its screen basis solved ONCE — a closure over
   * three `camera.project` calls that then answers any number of cells with
   * two multiplies plus the projection's own `unproject`.
   *
   * `unprojectSheet` (one cell) and the sun's per-cell night term (every
   * covered cell of every grid, on every render while the sun is on) share
   * this one implementation rather than each carrying its own copy of the
   * solve: hoisting the basis is what keeps a full-grid sweep from paying
   * three camera projections per cell.
   */
  function sheetUnprojector(grid: ProjectionGrid): ((col: number, row: number) => readonly [number, number] | null) | null {
    const o = camera.project([0, 0, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const ux = camera.project([1, 0, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const uy = camera.project([0, 1, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const ax = ux[0] - o[0], ay = ux[1] - o[1];
    const bx = uy[0] - o[0], by = uy[1] - o[1];
    const det = ax * by - ay * bx;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
    return (col: number, row: number): readonly [number, number] | null => {
      const dc = col - o[0], dr = row - o[1];
      const wx = (by * dc - bx * dr) / det;
      const wy = (-ay * dc + ax * dr) / det;
      const result = tryUnproject(projection, [wx, wy, 0]);
      if (!result) return null;
      const [lon, lat] = result;
      const d = projection.domain;
      if (lon < d.west - 1e-6 || lon > d.east + 1e-6 || lat < d.south - 1e-6 || lat > d.north + 1e-6) return null;
      return [lon, lat];
    };
  }

  function unprojectSheet(col: number, row: number, grid: ProjectionGrid): readonly [number, number] | null {
    const solve = sheetUnprojector(grid);
    return solve ? solve(col, row) : null;
  }

  /**
   * Numeric (Newton) unproject for a projection navigated by camera orbit
   * (the globe): the surface at `elev: 0` isn't a flat plane, so the linear
   * `unprojectSheet` solve doesn't apply. `camera.project ∘ projection.project`
   * is smooth over the visible cap, so 2-unknown (lon, lat) Newton on a
   * finite-difference Jacobian converges in a handful of iterations — this
   * uses only PUBLIC `project`/`camera.project`, no camera-internal math.
   */
  function unprojectSphere(col: number, row: number, grid: ProjectionGrid): readonly [number, number] | null {
    const centerForCamera = projection.centerForCamera;
    if (!centerForCamera) return null;
    let [lon, lat] = centerForCamera(camera.rotX, camera.rotY);
    // Start a hair OFF a pole. The (lon, lat) Jacobian's longitude column
    // vanishes at a pole — every longitude is the same point there — so a view
    // centred exactly on one starts Newton at a singular point, the first
    // iteration reports a degenerate determinant, and EVERY cell unprojects to
    // `null`: click-to-lonlat stops answering and a `contour` layer paints
    // nothing at all. The iteration only needs a starting point, not the exact
    // sub-observer point, so it takes the same clamp the loop below already
    // applies to every step it makes.
    lat = clamp(lat, -POLE_SAFE_LAT, POLE_SAFE_LAT);
    const EPS = 1e-4;
    let converged = false;
    for (let i = 0; i < 12; i++) {
      const p = projection.project(lon, lat, 0);
      const [c0, r0] = camera.project(p, grid.cols, grid.rows, grid.cellAspect, grid);
      const dCol = col - c0, dRow = row - r0;
      if (Math.hypot(dCol, dRow) < 1e-4) { converged = true; break; }
      const pLon = projection.project(lon + EPS, lat, 0);
      const [cLon, rLon] = camera.project(pLon, grid.cols, grid.rows, grid.cellAspect, grid);
      const pLat = projection.project(lon, lat + EPS, 0);
      const [cLat, rLat] = camera.project(pLat, grid.cols, grid.rows, grid.cellAspect, grid);
      const j00 = (cLon - c0) / EPS, j10 = (rLon - r0) / EPS;
      const j01 = (cLat - c0) / EPS, j11 = (rLat - r0) / EPS;
      const det = j00 * j11 - j01 * j10;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
      const dLon = (j11 * dCol - j01 * dRow) / det;
      const dLat = (-j10 * dCol + j00 * dRow) / det;
      lon += dLon;
      lat = clamp(lat + dLat, -POLE_SAFE_LAT, POLE_SAFE_LAT);
    }
    const world = projection.project(lon, lat, 0);
    // Newton can settle on a residual local minimum (e.g. clamped at a pole)
    // for a screen point that has NO true corresponding surface point (one
    // that missed the sphere's silhouette entirely) — a converged final
    // residual, checked explicitly, is what tells a genuine miss apart from
    // a true near-pole answer, since `visible` alone only asks whether the
    // point Newton STOPPED at happens to face the camera, not whether it
    // actually reprojects back to the requested cell.
    if (!converged) {
      const [c0, r0] = camera.project(world, grid.cols, grid.rows, grid.cellAspect, grid);
      if (Math.hypot(col - c0, row - r0) > 0.5) return null;
    }
    if (!nearSideVisible(lon, lat, world, grid)) return null;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return [lon, lat];
  }

  function unproject(cell: readonly [number, number]): readonly [number, number] | null {
    const grid = projectionGrid();
    return isOrbitProjection() ? unprojectSphere(cell[0], cell[1], grid) : unprojectSheet(cell[0], cell[1], grid);
  }

  // ── Events ────────────────────────────────────────────────────────────

  const listeners = new Map<GlyphMapEvent["type"], Set<GlyphMapEventHandler<GlyphMapEvent>>>();
  function emit(event: GlyphMapEvent): void {
    const set = listeners.get(event.type);
    if (!set) return;
    for (const handler of [...set]) {
      try { handler(event); } catch (err) { console.error(`[glyphcss/maps] createGlyphMap '${event.type}' listener threw:`, err); }
    }
  }
  function emitViewChange(type: "move" | "zoom"): void {
    emit({ type, view: getView() });
  }

  // ── Markers ───────────────────────────────────────────────────────────

  /**
   * Everything whose visibility is a NEAR/FAR-hemisphere question the
   * renderer cannot answer for itself, re-evaluated from the live camera:
   * a marker/symbol/circle hotspot's `visibility` (below), and a
   * `fill-extrusion` layer's wall faces (`createMeshFeatureRuntime` —
   * tangential normals, so no winding makes a far-side one back-facing).
   *
   * ONE registry, drained at every point the camera can have moved, because
   * these all share one failure mode: decide on one cadence, render on
   * another, and the picture is stale for the difference. Symbols hit it as a
   * one-frame label flicker; extrusion walls hit it as walls MISSING for a
   * whole gesture, since their verdict used to be baked into geometry rebuilt
   * on the 180ms `scheduleTileUpdate` debounce that every moving frame
   * re-arms (measured 681ms with 0 of 41 walls drawn).
   */
  const nearSideSyncs = new Set<() => void>();
  /**
   * The near-side sweeps that WRITE TO THE SCENE rather than to a DOM
   * channel — today just a `fill-extrusion`'s wall cull, which hands the
   * survivors to `handle.setPolygons()`.
   *
   * They are separated because a scene write ARMS A RENDER, and the two
   * places this sweep is called from want opposite things from that.
   * `applyDrag`/`applyOrient` call it from an INPUT HANDLER purely to close a
   * one-frame flicker on `opacity`/`visibility`, and glyphcss coalesces
   * renders on a microtask that drains at the end of every task — so a scene
   * write there buys a full grid render PER POINTER EVENT and defeats the
   * motion loop outright. The frame paths call it to install the geometry the
   * render on the next line is about to rasterize, where the write is free
   * because `rerender()` supersedes anything armed ahead of it.
   *
   * So an input handler sweeps {@link syncNearSideDom} and a frame sweeps
   * {@link syncNearSide}. A wall cull deferred to the frame is not stale: the
   * frame is the only thing that paints, and it re-culls before it does.
   */
  const nearSideGeometrySyncs = new Set<() => void>();
  /** DOM channels only (`opacity`/`visibility`) — never a scene write, so it can never arm a render. */
  function syncNearSideDom(): void {
    for (const sync of nearSideSyncs) sync();
  }
  /** The scene-geometry half alone. Only ever called immediately BEFORE a `scene.rerender()`, which supersedes the render it arms. */
  function syncNearSideGeometry(): void {
    for (const sync of nearSideGeometrySyncs) sync();
  }
  /** The whole sweep, DOM channels and scene geometry. Only ever called immediately BEFORE the frame's own `scene.rerender()`. */
  function syncNearSide(): void {
    syncNearSideDom();
    syncNearSideGeometry();
  }

  /**
   * Everything MOUNTED ON the terrain, re-planted when the terrain under it
   * moves — today just `fill-extrusion` layers, whose base is the ground
   * elevation `groundElevationSampler` reads off the mounted `raster` tiles.
   *
   * A separate registry from `nearSideSyncs` because it is driven by a
   * different event: not the camera (every frame) but the mounted TILE SET (a
   * finer tier arriving, a raster layer added or removed), which is exactly
   * when a ground reading can change and no more often. A `fill-extrusion` on
   * a STATIC source is never rebuilt by `scheduleTileUpdate` at all — its mesh
   * is camera-independent by design — so without this a building mounted
   * before its terrain landed would stand at the datum forever.
   *
   * Coalesced onto a microtask: one raster update mounts tiles across several
   * turns and calls `scene.rerender()` at each, and each listener re-probes
   * before it rebuilds anything, so the extra notifications cost a tile lookup
   * per group and stop there.
   */
  const groundChangeSyncs = new Set<() => void>();
  let groundChangeQueued = false;
  function notifyGroundChanged(): void {
    if (groundChangeQueued || groundChangeSyncs.size === 0) return;
    groundChangeQueued = true;
    queueMicrotask(() => {
      groundChangeQueued = false;
      if (destroyed) return;
      for (const sync of groundChangeSyncs) sync();
    });
  }

  /**
   * Hide/show a hotspot for the NEAR/FAR-hemisphere reason, on a CSS channel
   * glyphcss does not own.
   *
   * `display` is glyphcss's own hotspot-visibility channel: `stageHotspots`
   * (`createGlyphScene.ts`) re-stages `style.display` for EVERY hotspot on
   * every committed render, from its own on-grid `cell.visible` test — which
   * knows nothing about hemispheres, because an orthographic camera projects
   * the far hemisphere onto the same screen disc as the near one. Writing
   * `display: "none"` here therefore held only until the next commit, and
   * `scene.addHotspot()` itself schedules one: a far-side dot was hidden for
   * exactly as long as it took the coalesced render to run, then reappeared
   * and stayed until the next `syncNearSide()`. `visibility` is additive to
   * glyphcss's `display` (either one hides; neither clears the other), and a
   * `visibility: hidden` element is not hit-testable either, so a culled
   * marker stays unclickable as well as unseen.
   */
  function setHotspotNearSide(el: HTMLElement, nearSide: boolean): void {
    el.style.visibility = nearSide ? "" : "hidden";
  }

  let nextMarkerId = 0;
  function addMarker(markerOpts: GlyphMapMarkerOptions): GlyphMapMarkerHandle {
    const [lon, lat] = markerOpts.at;
    const elevation = markerOpts.elevation ?? 0;
    const world = projection.project(lon, lat, elevation);
    const hotspot: GlyphHotspotHandle = scene.addHotspot({ id: `glyph-map-marker-${nextMarkerId++}`, at: world });
    if (markerOpts.label !== undefined) {
      const label = document.createElement("span");
      label.className = "glyph-map-marker-label";
      label.textContent = markerOpts.label;
      hotspot.el.appendChild(label);
    }
    function sync(): void {
      const grid = projectionGrid();
      const visible = Number.isFinite(world[0]) && Number.isFinite(world[1]) && Number.isFinite(world[2])
        && nearSideVisible(lon, lat, world, grid);
      setHotspotNearSide(hotspot.el, visible);
    }
    sync();
    nearSideSyncs.add(sync);
    return {
      el: hotspot.el,
      remove(): void {
        nearSideSyncs.delete(sync);
        hotspot.remove();
      },
    };
  }

  // ── Layers ────────────────────────────────────────────────────────────

  function colorForLayer(layer: GlyphMapRasterLayer): ((elev: number) => string | undefined) | undefined {
    const classifier = layer.classifier;
    const colors = layer.colors;
    if (!classifier || !colors) return undefined;
    return (elev: number) => {
      const band = classifier.classifyValue ? classifier.classifyValue(elev) : 0;
      return colors[band] ?? colors[colors.length - 1];
    };
  }

  interface RasterLayerRuntime {
    update(): Promise<void>;
    disposeMeshes(): void;
    /**
     * Rebuilds every currently mounted mesh (static, or provider tiles
     * already sitting in `activeHandles`/`fallbackHandles`/the permanent
     * floor) against the CURRENT `projection` closure value, with no
     * network fetch — `setProjection`'s per-frame reprojection hook
     * (MAPS.md §13 slice 4). `update()` itself can't be reused for this:
     * its provider branch deliberately SKIPS remounting a tile whose key is
     * already mounted (the ordinary "nothing changed" fast path), which is
     * exactly the common case mid-transition — the visible tile SET doesn't
     * change, only what each tile's geometry projects to.
     */
    reproject(): void;
    /**
     * The GROUND elevation in metres under `(lon, lat)`, read from the tiles
     * this layer currently has MOUNTED — `NaN` where none covers the point.
     *
     * Finest tier first (`activeHandles`, then `fallbackHandles`, then the
     * permanent floor, then a static tile): the finest is the tier that
     * actually wins the depth test, and a backstop tier is sunk
     * {@link GLYPH_MAP_RELIEF_BACKSTOP_SINK_M} below it anyway. This is the
     * mounted set, not the cache — a tile fetched but no longer on screen
     * describes ground nothing is rendering.
     *
     * Its consumers PLANT things on it: a `fill-extrusion`'s base and a
     * `line` layer's draped vertices are both projected at this elevation,
     * so a structure and the road beside it stand on the same ground and
     * move together under the tilt's parallax. It was once read only to
     * FORGIVE that offset in a stroke's depth test — see `stroke.ts` for why
     * that allowance no longer exists.
     */
    groundElevationAt(lon: number, lat: number): number;
    dispose(): void;
  }

  /**
   * Never-black raster coverage (see AGENTS.md's "never a blank/black hole
   * while panning or zooming"): a provider-backed raster layer keeps THREE
   * tiers of mounted geometry instead of one.
   *
   * - `activeHandles` — the target-LOD "desired" tiles, exactly as before.
   * - `fallbackHandles` — the CURRENT view's own tiles at the nearest
   *   AVAILABLE zoom level strictly coarser than the target LOD, mounted
   *   from cache immediately (zero fetch latency for the common "you just
   *   zoomed in from here" case) and evicted the instant the fine `desired`
   *   set finishes mounting. This is what makes a zoom-in read as
   *   "sharpens" rather than "blanks then appears."
   * - `floorHandles` — EVERY tile of the provider's shallowest zoom level,
   *   fetched once and never evicted. This is the actual "never black"
   *   guarantee: `fallbackHandles`/`activeHandles` both change with the
   *   view and can momentarily cover nothing (a pan far enough that neither
   *   the old fine nor the old fallback tiles overlap the new viewport,
   *   with tile churn itself frozen mid-gesture — see `scheduleTileUpdate`),
   *   but the floor covers the WHOLE domain unconditionally.
   *
   * Skipped when the provider has only one zoom level (nothing coarser
   * exists to sit beneath) — `provider.zooms.length <= 1`. Otherwise, every
   * tile identity the floor's own grid already covers (`floorKeys`,
   * computed synchronously from its shape) is subtracted from BOTH
   * `desired` and `fallbackDesired` on every update, so nothing is ever
   * mounted twice at the identical depth — covers both "the target LOD
   * already equals the floor's own level" (every `desired` key would
   * resolve to a floor key, leaving `activeHandles` empty for that view)
   * and a degrading provider whose ancestor resolution for a fine/fallback
   * tile happens to land exactly on a floor tile's own identity.
   */
  function createRasterLayerRuntime(layer: GlyphMapRasterLayer, layerId: string): RasterLayerRuntime {
    const color = colorForLayer(layer);
    let staticHandles: GlyphMeshHandle[] = [];
    const tileCache = new Map<string, GlyphMapGeoTile>();
    const activeHandles = new Map<string, GlyphMeshHandle[]>();
    const fallbackHandles = new Map<string, GlyphMeshHandle[]>();
    let floorHandles: GlyphMeshHandle[] = [];
    // The floor's own source tiles, kept alongside its handles so
    // `reproject()` can rebuild geometry from `glyphMapPolygons` against the
    // NEW projection — re-adding a mounted handle's already-projected
    // `polygons` would just re-mount the same stale (old-projection) shape.
    let floorTiles: readonly GlyphMapGeoTile[] = [];
    let floorPromise: Promise<void> | null = null;
    let updateInFlight = false;
    let updateQueued = false;
    /**
     * Every mount in this runtime happens AFTER an `await provider.loadTile
     * (...)` — the floor's own `Promise.all`, the fallback tier's fetch
     * phase, the fine tier's, and the queued-update tail. A layer removed
     * (or a widget destroyed) mid-fetch disposes every handle it holds, and
     * without this flag the already-in-flight continuation then calls
     * `scene.add(...)` again: those meshes are ORPHANS — no runtime holds
     * their handles any more, so nothing can ever dispose them. That is the
     * reported "I unticked ALL the layers but I still see the world", and
     * re-ticking mounts a second copy over the orphan ("layers get
     * duplicated, they do not offload"). Same mechanism, same discipline as
     * `createFeatureLayerRuntime`'s own `disposed` guard below.
     *
     * The `updateProvider` ENTRY check is what stops the queued-update tail
     * (`finally`'s `if (updateQueued) await updateProvider(...)`) restarting
     * a whole update after dispose — deliberately one guard rather than
     * also clearing `updateQueued` in `dispose()`, which would be a second
     * mechanism covering the same case and would mask this one.
     */
    let disposed = false;

    /**
     * The mesh resolution each tier is currently MOUNTED at, as a fraction
     * of the tile's own baked grid (`reliefFractionForLevel`). Held per
     * tier rather than recomputed at each use so `updateProvider` can spot
     * a change and rebuild that tier's already-mounted tiles: a level whose
     * mounted tiles disagreed about their fraction would crack along the
     * seams between the old and new ones. `null` = nothing mounted yet.
     */
    let activeFraction: ReliefFraction | null = null;
    let fallbackFraction: ReliefFraction | null = null;
    let floorFraction: ReliefFraction | null = null;

    /**
     * Whether the permanent floor level is itself the current target LOD.
     * Held alongside `floorFraction` for the same reason: it is an input to
     * the floor's mounted GEOMETRY (through
     * {@link GLYPH_MAP_RELIEF_BACKSTOP_SINK_M}), so a change has to trigger
     * the same remount a fraction change does — and it can flip WITHOUT the
     * fraction changing, whenever `reliefFractionForLevel` already wanted
     * something no coarser than the backstop cap.
     */
    let floorIsTarget = false;

    /**
     * A tier that is not the target LOD is a BACKSTOP — mounted so a pan or
     * a zoom never opens a blank hole — and must never occlude the target
     * tier. See {@link GLYPH_MAP_RELIEF_BACKSTOP_SINK_M}.
     */
    function tierElevationBias(tier: "fine" | "fallback" | "floor"): number {
      if (tier === "fine") return 0;
      if (tier === "floor" && floorIsTarget) return 0;
      return -GLYPH_MAP_RELIEF_BACKSTOP_SINK_M;
    }

    /**
     * `fraction` applies per SPLIT PART, not to the pre-split tile: both
     * halves of an antimeridian-straddling tile keep the tile's own `rows`,
     * so `round(rows * fraction)` is identical on both sides of the seam
     * and the shared seam edge stays exactly shared (`gridLineIndices`).
     * Scaling one resolution computed from the whole tile would instead
     * give the two halves different row counts and tear along the seam.
     *
     * `elevationBias` is per TIER, never per tile, for that same reason: two
     * tiles of one level sunk by different amounts would tear along their
     * shared edge.
     */
    function mountTile(tile: GlyphMapGeoTile, fraction: ReliefFraction, tier: "fine" | "fallback" | "floor"): GlyphMeshHandle[] {
      const transform = meshTransform(layer, layer.density, glyphMapRasterDetailGroup(layerId, tier));
      const elevationBias = tierElevationBias(tier);
      return splitGlyphMapGeoTileAtAntimeridian(tile).map((part) =>
        scene.add(
          glyphMapPolygons(
            part,
            projection,
            fraction >= 1 ? { color, elevationBias } : { color, elevationBias, resolution: reliefResolution(part.cols, part.rows, fraction) },
          ),
          transform,
        ),
      );
    }

    /**
     * Rebuilds every mounted tile of one tier at `fraction`, disposing and
     * re-adding each in the same synchronous turn so no render can observe
     * the tier with a hole in it.
     */
    function remountTier(map: Map<string, GlyphMeshHandle[]>, fraction: ReliefFraction, tier: "fine" | "fallback"): void {
      for (const [key, handles] of map) {
        const tile = tileCache.get(key);
        if (!tile) continue;
        for (const h of handles) h.dispose();
        map.set(key, mountTile(tile, fraction, tier));
      }
    }

    function disposeAll(map: Map<string, GlyphMeshHandle[]>): void {
      for (const handles of map.values()) for (const h of handles) h.dispose();
      map.clear();
    }

    function disposeMeshes(): void {
      for (const h of staticHandles) h.dispose();
      staticHandles = [];
      disposeAll(activeHandles);
      disposeAll(fallbackHandles);
      for (const h of floorHandles) h.dispose();
      floorHandles = [];
      floorTiles = [];
      floorPromise = null;
    }

    /**
     * Fetches and mounts EVERY tile of `provider`'s shallowest zoom level,
     * once. Idempotent (`floorPromise` caches the in-flight/settled
     * promise) — every `updateProvider` call awaits it, so the very first
     * settle (before any pan/zoom) already guarantees the floor is up.
     */
    function ensureFloorMounted(provider: GlyphMapProvider): Promise<void> {
      if (floorPromise) return floorPromise;
      if (provider.zooms.length <= 1) { floorPromise = Promise.resolve(); return floorPromise; }
      const floorZ = Math.min(...provider.zooms.map((z) => z.z));
      const level = provider.zooms.find((z) => z.z === floorZ)!;
      const coords: { readonly x: number; readonly y: number }[] = [];
      for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) coords.push({ x, y });
      floorPromise = Promise.all(coords.map(({ x, y }) => provider.loadTile(floorZ, x, y))).then((tiles) => {
        if (disposed) return;
        floorTiles = tiles;
        floorHandles = tiles.flatMap((tile) => mountTile(tile, floorFraction ?? 1, "floor"));
        scene.rerender();
      });
      return floorPromise;
    }

    /** The nearest AVAILABLE zoom level strictly coarser than `lod` (`undefined` if `lod` is already the shallowest). */
    function pickFallbackLevel(provider: GlyphMapProvider, lod: number): GlyphMapProviderZoomLevel | undefined {
      let best: GlyphMapProviderZoomLevel | undefined;
      for (const z of provider.zooms) if (z.z < lod && (!best || z.z > best.z)) best = z;
      return best;
    }

    async function updateProvider(provider: GlyphMapProvider): Promise<void> {
      if (disposed) return;
      if (updateInFlight) { updateQueued = true; return; }
      updateInFlight = true;
      try {
        // `getView()`, NOT the raw `view` closure — `view.cols`/`.rows` are
        // frozen wherever `setView` last left them (AGENTS.md's root-cause
        // doc), so a live `cols` change (autoSize, or a caller poking
        // `scene.setOptions({ cols, rows })` directly, e.g. a density
        // slider) never reached `glyphMapDegreesPerCell` through the raw
        // field — LOD silently stayed pinned to whatever resolution was
        // requested at construction, regardless of a later density raise.
        // The mesh RESOLUTION question is still the view's own
        // degrees-per-cell — `reliefFractionForLevel` asks how many quads a
        // cell deserves, not which level exists — so only the LOD moved.
        const degPerCell = glyphMapDegreesPerCell(getView());
        const lod = sweepLOD(provider);
        const floorZ = Math.min(...provider.zooms.map((z) => z.z));

        // The floor tier's own mesh resolution, resolved BEFORE
        // `ensureFloorMounted` so its one-and-only mount already uses it.
        // Capped to a glimpse-only backstop resolution unless the floor IS
        // the target LOD, in which case it is the visible surface and gets
        // the same one-quad-per-cell treatment as any other tier.
        const floorLevel = provider.zooms.find((z) => z.z === floorZ);
        if (floorLevel) {
          const nextIsTarget = lod === floorZ;
          const needed = reliefFractionForLevel(floorLevel, degPerCell);
          const next = nextIsTarget ? needed : Math.min(needed, GLYPH_MAP_RELIEF_FLOOR_BACKSTOP_COLS / floorLevel.tileCols);
          // `floorIsTarget` is an input to the mounted geometry too (the
          // backstop sink), and it can flip while `next` stays put, so both
          // are compared before deciding the floor is already correct.
          if (next !== floorFraction || nextIsTarget !== floorIsTarget) {
            floorFraction = next;
            floorIsTarget = nextIsTarget;
            if (floorHandles.length > 0) {
              const tiles = floorTiles;
              for (const h of floorHandles) h.dispose();
              floorHandles = tiles.flatMap((tile) => mountTile(tile, next, "floor"));
            }
          }
        }

        const floor = ensureFloorMounted(provider);
        const level = provider.zooms.find((z) => z.z === lod);
        if (!level) { await floor; return; }
        const padCells = layer.padCells ?? GLYPH_MAP_RASTER_PAD_CELLS_DEFAULT;

        // Every tile identity the permanent floor ALREADY covers (empty
        // when there's no separate floor — a single-zoom provider, where
        // `ensureFloorMounted` above is itself a no-op) — computed
        // synchronously from the floor level's own grid shape, no fetch
        // needed. Filtered out of `desired`/`fallbackDesired` below so
        // nothing is ever mounted twice at the identical depth: NOT just
        // the "target LOD already equals the floor" case, but also a
        // degrading provider (`glyphMapCuratedProvider`) whose ancestor
        // resolution for a fine/fallback tile happens to land exactly on a
        // floor tile's own identity.
        const floorKeys = new Set<string>();
        if (provider.zooms.length > 1) {
          const floorLevel = provider.zooms.find((z) => z.z === floorZ)!;
          for (let y = 0; y < floorLevel.rows; y++) {
            for (let x = 0; x < floorLevel.cols; x++) floorKeys.add(`${floorZ}/${x}_${y}`);
          }
        }

        // `resolveKey` maps a requested tile to what `loadTile` will
        // ACTUALLY return — for a plain provider that's itself, but a
        // degrading provider (`glyphMapCuratedProvider`) can send several
        // requested addresses to the SAME ancestor tile. Keying `desired`
        // (and therefore `tileCache`/`activeHandles`) by that resolved
        // identity instead of the requested address means two siblings that
        // both miss curated coverage fetch and mount that ancestor ONCE,
        // not once per sibling.
        const resolveKey = (z: number, x: number, y: number): string => {
          const r = provider.resolveTile ? provider.resolveTile(z, x, y) : { z, x, y };
          return `${r.z}/${r.x}_${r.y}`;
        };
        const grid = projectionGrid();
        const geoSamples = viewportGeoSamples(padCells, grid);
        const sweepDesired = (lvl: GlyphMapProviderZoomLevel): Set<string> => {
          const desired = new Set<string>();
          const { x0, x1, y0, y1 } = candidateTileRange(lvl, padCells);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              if (isBoundsVisible(provider.bounds(lvl.z, x, y), padCells, grid, geoSamples)) desired.add(resolveKey(lvl.z, x, y));
            }
          }
          return desired;
        };

        const desired = sweepDesired(level);
        // Failsafe: never blank the layer entirely — before the floor
        // filter below, so a resolved (0,0) that itself turns out to be a
        // floor tile is still correctly dropped (the floor already shows
        // it; "never blank" holds via that mesh instead).
        if (desired.size === 0 && level.cols > 0 && level.rows > 0) desired.add(resolveKey(lod, 0, 0));
        for (const key of floorKeys) desired.delete(key);

        // One level coarser than target — skip when it WOULD be the floor
        // (already permanently mounted, mounting it again as "fallback"
        // too would just duplicate it).
        const fallbackLevel = pickFallbackLevel(provider, lod);
        const fallbackDesired = fallbackLevel && fallbackLevel.z !== floorZ ? sweepDesired(fallbackLevel) : new Set<string>();
        for (const key of floorKeys) fallbackDesired.delete(key);

        // Resolve both remaining tiers' mesh resolutions, and rebuild
        // whatever is already mounted whose resolution just changed — a
        // level with two different resolutions mounted at once would crack
        // along the seam between an old tile and a new one. Both rebuilds
        // are synchronous (dispose + re-add in this same turn), so no
        // render observes the tier mid-swap.
        const nextActive = reliefFractionForLevel(level, degPerCell);
        if (nextActive !== activeFraction) {
          activeFraction = nextActive;
          remountTier(activeHandles, nextActive, "fine");
        }
        const nextFallback = fallbackLevel ? reliefFractionForLevel(fallbackLevel, degPerCell, GLYPH_MAP_RELIEF_FALLBACK_COARSEN) : 1;
        if (nextFallback !== fallbackFraction) {
          fallbackFraction = nextFallback;
          remountTier(fallbackHandles, nextFallback, "fallback");
        }

        // Mount whatever's already cached for BOTH tiers immediately —
        // zero-latency coverage upgrade for the common "you just zoomed
        // in/out from here" case, shown even before this call's own
        // network fetch resolves.
        let mountedNow = false;
        for (const key of fallbackDesired) {
          if (!fallbackHandles.has(key)) {
            const tile = tileCache.get(key);
            if (tile) { fallbackHandles.set(key, mountTile(tile, fallbackFraction, "fallback")); mountedNow = true; }
          }
        }
        for (const key of desired) {
          if (!activeHandles.has(key)) {
            const tile = tileCache.get(key);
            if (tile) { activeHandles.set(key, mountTile(tile, activeFraction, "fine")); mountedNow = true; }
          }
        }
        if (mountedNow) { scene.rerender(); notifyGroundChanged(); }

        // Fallback is fetched and mounted as its OWN phase, awaited BEFORE
        // the fine tier's own fetch — not merged into one `Promise.all`
        // with it. A single combined batch would let a slow/stuck fine
        // fetch (a genuinely new region's own tile, the common case this
        // whole mechanism exists for) hold up mounting the ALREADY-ARRIVED
        // fallback tiles too, since `Promise.all` only resolves once every
        // member does — defeating the "coarser cover appears immediately,
        // fine sharpens in after" story this tier is for.
        const missingFallback = [...fallbackDesired].filter((key) => !tileCache.has(key));
        if (missingFallback.length > 0) {
          await Promise.all(missingFallback.map(async (key) => {
            const [zStr, xy] = key.split("/");
            const [xStr, yStr] = xy.split("_");
            tileCache.set(key, await provider.loadTile(Number(zStr), Number(xStr), Number(yStr)));
          }));
          if (disposed) return;
          for (const key of fallbackDesired) {
            if (!fallbackHandles.has(key)) {
              const tile = tileCache.get(key);
              if (tile) fallbackHandles.set(key, mountTile(tile, fallbackFraction, "fallback"));
            }
          }
          scene.rerender();
          notifyGroundChanged();
        }

        const missingFine = [...desired].filter((key) => !tileCache.has(key));
        if (missingFine.length > 0) {
          await Promise.all(missingFine.map(async (key) => {
            const [zStr, xy] = key.split("/");
            const [xStr, yStr] = xy.split("_");
            tileCache.set(key, await provider.loadTile(Number(zStr), Number(xStr), Number(yStr)));
          }));
        }
        await floor;
        if (disposed) return;

        for (const [key, handles] of activeHandles) {
          if (!desired.has(key)) {
            for (const h of handles) h.dispose();
            activeHandles.delete(key);
          }
        }
        for (const key of desired) {
          if (!activeHandles.has(key)) {
            const tile = tileCache.get(key);
            if (tile) activeHandles.set(key, mountTile(tile, activeFraction, "fine"));
          }
        }

        // Off-screen fallback tiles are always dropped. On-screen ones stay
        // only until the fine `desired` set is FULLY mounted for this
        // update (a still-missing fine tile — e.g. a rejected fetch — keeps
        // its fallback rather than leaving a hole).
        const fineFullyCovered = [...desired].every((key) => activeHandles.has(key));
        for (const [key, handles] of fallbackHandles) {
          if (!fallbackDesired.has(key) || fineFullyCovered) {
            for (const h of handles) h.dispose();
            fallbackHandles.delete(key);
          }
        }

        scene.rerender();
        // The mounted tile set is final for this update — anything standing
        // ON this terrain re-reads the ground it is planted on.
        notifyGroundChanged();
      } finally {
        updateInFlight = false;
        if (updateQueued) {
          updateQueued = false;
          await updateProvider(provider);
        }
      }
    }

    async function update(): Promise<void> {
      if (isGlyphMapProvider(layer.source)) {
        await updateProvider(layer.source);
      } else {
        disposeMeshes();
        staticHandles = mountTile(layer.source, 1, "fine");
        scene.rerender();
        notifyGroundChanged();
      }
    }

    function reproject(): void {
      if (isGlyphMapProvider(layer.source)) {
        for (const [key, handles] of activeHandles) {
          for (const h of handles) h.dispose();
          const tile = tileCache.get(key);
          activeHandles.set(key, tile ? mountTile(tile, activeFraction ?? 1, "fine") : []);
        }
        for (const [key, handles] of fallbackHandles) {
          for (const h of handles) h.dispose();
          const tile = tileCache.get(key);
          fallbackHandles.set(key, tile ? mountTile(tile, fallbackFraction ?? 1, "fallback") : []);
        }
        if (floorTiles.length > 0) {
          for (const h of floorHandles) h.dispose();
          floorHandles = floorTiles.flatMap((tile) => mountTile(tile, floorFraction ?? 1, "floor"));
        }
      } else {
        for (const h of staticHandles) h.dispose();
        staticHandles = mountTile(layer.source, 1, "fine");
      }
    }

    /** @see RasterLayerRuntime.groundElevationAt */
    function groundElevationAt(lon: number, lat: number): number {
      if (!isGlyphMapProvider(layer.source)) {
        return staticHandles.length > 0 ? glyphMapGeoTileElevationAt(layer.source, lon, lat) : NaN;
      }
      for (const tiles of [activeHandles, fallbackHandles]) {
        for (const key of tiles.keys()) {
          const tile = tileCache.get(key);
          if (!tile) continue;
          const value = glyphMapGeoTileElevationAt(tile, lon, lat);
          if (Number.isFinite(value)) return value;
        }
      }
      if (floorHandles.length > 0) {
        for (const tile of floorTiles) {
          const value = glyphMapGeoTileElevationAt(tile, lon, lat);
          if (Number.isFinite(value)) return value;
        }
      }
      return NaN;
    }

    return {
      update,
      disposeMeshes,
      reproject,
      groundElevationAt,
      dispose(): void {
        disposed = true;
        disposeMeshes();
        tileCache.clear();
      },
    };
  }

  /**
   * One vector tile, or `null` if it could not be loaded.
   *
   * A frame's sweep awaits a `Promise.all` over EVERY missing tile in the
   * visible set, so a single rejection would reject the whole batch: the
   * tiles that arrived fine are dropped on the floor, `activeFeatures` is
   * never assigned, and — because `addLayer`/`scheduleTileUpdate` fire these
   * updates without a `catch` — the rejection escapes as an unhandled one.
   * That is one region with no data this frame turning into a blank layer
   * plus a console error, which is exactly what "degrade quietly" forbids.
   *
   * A local network is not the only way in: the shipped
   * {@link import("./vector/openfreemap").glyphMapOpenFreeMapProvider}
   * resolves empty rather than rejecting, but a provider is a public
   * interface and a caller's own (the website's baked-tile reader among
   * them) may well throw on a 404.
   */
  async function loadVectorTileSafely(
    provider: GlyphMapVectorProvider,
    z: number,
    x: number,
    y: number,
  ): Promise<import("./vector/types").GlyphMapVectorTile | null> {
    try {
      return await provider.loadTile(z, x, y);
    } catch (err) {
      console.warn(`[glyphcss/maps] vector tile ${z}/${x}/${y} from '${provider.id}' failed to load; rendering without it:`, err);
      return null;
    }
  }

  // ── Stroke layers (`line`/`contour`) — post-raster CellGrid stamping,
  // composed into ONE `transformCells` hook rather than mesh mounting. See
  // `stroke.ts`'s doc for the mechanism and the depth contract. ───────────

  /**
   * The ground elevation in metres under `(lon, lat)`, across every MOUNTED
   * `raster` layer — `null` when no raster layer is mounted at all, which is
   * the signal to skip the whole ground-offset pass and keep a terrain-free
   * map byte-identical (and free) rather than sampling a field that does not
   * exist.
   *
   * Layer order, topmost first: the raster layer drawn last is the surface a
   * stroke sits on where two overlap. First finite answer wins — the same
   * "first mounted piece that covers the point" rule the contour mosaic uses,
   * and for the same reason (a tile's bounds are inclusive on both edges, so
   * neighbours agree on their shared edge and which one answers is
   * unobservable).
   */
  function groundElevationSampler(): ((lon: number, lat: number) => number) | null {
    const runtimes: RasterLayerRuntime[] = [];
    for (let i = layerOrder.length - 1; i >= 0; i--) {
      const state = layerStates.get(layerOrder[i]);
      if (state?.kind === "raster") runtimes.push(state.runtime);
    }
    if (runtimes.length === 0) return null;
    return (lon, lat) => {
      for (const runtime of runtimes) {
        const value = runtime.groundElevationAt(lon, lat);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    };
  }

  function createLineLayerRuntime(layer: GlyphMapLineLayer): StrokeLayerRuntime {
    const color = layer.color;
    const isProvider = isGlyphMapVectorProvider(layer.source);
    let staticFeatures: readonly GlyphMapVectorFeature[] = isProvider ? [] : layer.source.features;
    const tileCache = new Map<string, import("./vector/types").GlyphMapVectorTile>();
    let activeFeatures: readonly GlyphMapVectorFeature[] = [];
    let updateInFlight = false;
    let updateQueued = false;
    /** Same post-dispose re-entry guard the raster runtime documents above. */
    let disposed = false;

    async function updateProvider(provider: GlyphMapVectorProvider): Promise<void> {
      if (disposed) return;
      if (updateInFlight) { updateQueued = true; return; }
      updateInFlight = true;
      try {
        // `getView()`, not raw `view` — see the raster runtime's own
        // `updateProvider` doc for why.
        // The mesh RESOLUTION question is still the view's own
        // degrees-per-cell — `reliefFractionForLevel` asks how many quads a
        // cell deserves, not which level exists — so only the LOD moved.
        const degPerCell = glyphMapDegreesPerCell(getView());
        const lod = sweepLOD(provider);
        const level = provider.zooms.find((z) => z.z === lod);
        if (!level) return;
        const padCells = layer.padCells ?? 2;
        const desired = new Set<string>();
        const grid = projectionGrid();
        const geoSamples = viewportGeoSamples(padCells, grid);
        // The PROVIDER's addressing — Mercator for a hosted OSM pyramid,
        // this package's equal-angle grid for a baked one. See
        // `candidateTileRange`'s `toRange` parameter.
        const { x0, x1, y0, y1 } = candidateTileRange(level, padCells, provider.tileRange);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (isBoundsVisible(provider.bounds(lod, x, y), padCells, grid, geoSamples)) desired.add(`${lod}/${x}_${y}`);
          }
        }
        if (desired.size === 0 && level.cols > 0 && level.rows > 0) desired.add(`${lod}/0_0`);
        const missing = [...desired].filter((key) => !tileCache.has(key));
        if (missing.length > 0) {
          await Promise.all(missing.map(async (key) => {
            const [zStr, xy] = key.split("/");
            const [xStr, yStr] = xy.split("_");
            const tile = await loadVectorTileSafely(provider, Number(zStr), Number(xStr), Number(yStr));
            if (tile) tileCache.set(key, tile);
          }));
          if (disposed) return;
        }
        const feats: GlyphMapVectorFeature[] = [];
        for (const key of desired) {
          const tile = tileCache.get(key);
          if (!tile) continue;
          for (const [name, list] of Object.entries(tile.layers)) if (!layer.sourceLayer || name === layer.sourceLayer) feats.push(...(layer.filter ? list.filter(layer.filter) : list));
        }
        activeFeatures = feats;
        scene.rerender();
      } finally {
        updateInFlight = false;
        if (updateQueued) {
          updateQueued = false;
          await updateProvider(provider);
        }
      }
    }

    async function update(): Promise<void> {
      if (isGlyphMapVectorProvider(layer.source)) {
        await updateProvider(layer.source);
      } else {
        staticFeatures = layer.filter ? layer.source.features.filter(layer.filter) : layer.source.features;
        scene.rerender();
      }
    }

    function stamp(grid: CellGrid, cellToSceneGrid: GlyphMapCellAffine, baseGrid: ProjectionGrid): void {
      const feats = isGlyphMapVectorProvider(layer.source) ? activeFeatures : staticFeatures;
      // Resolved ONCE per stamp, not per vertex: it walks the mounted layer
      // list, and a world view hands this loop tens of thousands of vertices.
      // `null` = no raster layer mounted, so the ground IS the datum and the
      // whole drape reduces to `projection.project(lon, lat, 0)` — the
      // pre-drape expression, byte for byte, with no lookup at all.
      const groundElevationAt = groundElevationSampler();
      for (const feature of feats) {
        for (const ring of feature.rings) {
          // Clip to the projection's visible side FIRST — see
          // `visibleStrokeRuns`. A flat projection returns the ring by
          // identity, so its stamped output is byte-identical to before.
          for (const run of visibleStrokeRuns(ring, baseGrid)) {
          const verts: GlyphMapStrokeVertex[] = run.map(([lon, lat]) => {
            // DRAPED: the vertex is projected at the ground elevation under
            // its own lon/lat, so it is drawn where the terrain it belongs to
            // is drawn. Everything else in the scene already stands on the
            // exaggerated relief (the terrain mesh by construction, a
            // `fill-extrusion` through this same sampler), and under a tilt
            // that relief has PARALLAX — a stroke left at the datum lands
            // somewhere its own ground is not (measured: 16 rows at
            // `/maps`' 24x over 10 m of terrain, 2,000 rows over 400 m).
            //
            // A non-finite sample (no mounted tile covers this vertex, e.g.
            // a border running off the edge of the loaded pyramid) falls back
            // to the datum rather than poisoning the vertex with NaN — the
            // same "the honest base is the datum" rule `groundElevationSampler`
            // states for a map with no raster layer at all.
            const groundElev = groundElevationAt ? groundElevationAt(lon, lat) : 0;
            const world = projection.project(lon, lat, Number.isFinite(groundElev) ? groundElev : 0);
            // `baseGrid` (NOT the live `projectionGrid()`) is what makes this
            // a SCENE/base-grid col/row — see `StrokeLayerRuntime`'s doc.
            // `composedTransformCells` restores `camera`'s zoom/center/
            // fovScale to their base-call values for the duration of a
            // detail call's stamping, so `camera.project` here reads the
            // scene's true base framing even while stamping into a detail
            // grid. Convert the resulting SCENE col/row into THIS grid's own
            // local coordinates before stamping (see `GlyphMapCellAffine`'s
            // doc) — the affine is the missing step that let ink land at
            // scene-scale coordinates on a detail grid many times smaller,
            // silently out of bounds. Depth is unaffected by the affine:
            // `project()`'s cssZ/1-over-denom terms never depend on the
            // cellWidth/centerCol metrics that vary between grids.
            const p = camera.project(world, baseGrid.cols, baseGrid.rows, baseGrid.cellAspect, baseGrid);
            const local = glyphMapSceneToLocalCell(p[0], p[1], cellToSceneGrid);
            // ONE projection per vertex. The second one this used to run —
            // the same lon/lat taken at the ground, to forgive that offset in
            // the depth test — was the workaround for projecting here at the
            // datum, and it is exactly the projection this line now IS.
            return { col: local.col, row: local.row, depth: p[3] ?? p[2] };
          });
          stampGlyphMapPolyline(grid, verts, { color });
          }
        }
      }
    }

    return {
      update,
      stamp,
      dispose(): void {
        disposed = true;
        activeFeatures = [];
        tileCache.clear();
      },
    };
  }

  function createContourLayerRuntime(layer: GlyphMapContourLayer): ContourLayerRuntime {
    const isProvider = isGlyphMapFieldProvider(layer.source);
    /**
     * A provider-backed contour holds a tile MOSAIC — every tile the view
     * currently covers — not the single tile containing `view.center`.
     *
     * The single-tile form was a real defect: a field only answers inside
     * its own `bounds` (`glyphMapFieldValueAt` returns NaN outside them), so
     * a contour could only ever ink one tile's geographic box and silently
     * skipped every cell beyond it. Which SHAPE that box read as depended
     * purely on the LOD the view resolved to (a z0 tile is the whole world
     * and hides the bug entirely; z1 is a hemisphere, z2 a quadrant), and
     * `view.center` `[0, 0]` sits exactly on a tile corner at every z >= 1,
     * so the resolved box lay wholly east and south of the screen centre.
     *
     * The visible-set sweep here is deliberately the SAME machinery the
     * raster runtime uses a few hundred lines above — `candidateTileRange` +
     * `isBoundsVisible` against one hoisted `projectionGrid()`, keyed by
     * `provider.resolveTile`'s resolved identity so a degrading provider
     * (`glyphMapCuratedProvider`) that sends several sibling addresses to
     * one ancestor tile derives that ancestor's field once — plus the same
     * in-flight guard, and the same `scheduleTileUpdate` debounce driving
     * it. Nothing about tile selection is re-derived here.
     *
     * `stamp` degrades to "draw nothing" (not "draw everywhere") until the
     * first `update()` resolves, the same discipline `line`'s
     * `activeFeatures` starts empty under.
     */
    const fieldCache = new Map<string, GlyphMapElevationPiece>();
    let mosaic: readonly GlyphMapElevationPiece[] = isProvider ? [] : [elevationPieceFromField(layer.source as GlyphMapField)];
    let updateInFlight = false;
    let updateQueued = false;
    /**
     * Same post-dispose re-entry guard the raster runtime documents above.
     * A contour mounts no mesh, so a late continuation cannot orphan
     * geometry — but it WOULD repopulate the `mosaic` that `dispose()` just
     * cleared, and keep refetching for a layer that is gone.
     */
    let disposed = false;

    /**
     * The elevation range across the WHOLE mounted mosaic, not one tile's —
     * `levels` as a count or an `{ interval }` is documented to be resolved
     * against "whichever field is CURRENTLY resolved", and with a mosaic
     * that is the union. A per-tile range would give neighbouring tiles
     * different level sets and tear every contour at the seams.
     */
    function fieldRange(): { readonly min: number; readonly max: number } | null {
      let min = Infinity;
      let max = -Infinity;
      for (const f of mosaic) {
        if (f.min < min) min = f.min;
        if (f.max > max) max = f.max;
      }
      return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
    }

    /**
     * The elevation WINDOW (`GlyphMapContourLayer.minElevation`/
     * `maxElevation`), resolved once per layer. Absent = unbounded, which is
     * what keeps every level expression below identical to the pre-window
     * behaviour by construction rather than by a special case.
     */
    const windowMin = layer.minElevation ?? -Infinity;
    const windowMax = layer.maxElevation ?? Infinity;
    const inWindow = (level: number): boolean => level >= windowMin && level <= windowMax;

    function levelsFor(range: { readonly min: number; readonly max: number }): readonly number[] {
      if (typeof layer.levels === "number") {
        // A COUNT is DISTRIBUTED within the window (the crowding fix): the
        // same "evenly spaced, neither extreme" rule, applied to the window
        // ∩ the field's own range. An empty intersection yields no levels
        // rather than a degenerate or reversed spread — an empty window is
        // "draw nothing", never an error.
        const min = Math.max(range.min, windowMin);
        const max = Math.min(range.max, windowMax);
        if (!(min <= max)) return [];
        return Array.from({ length: layer.levels }, (_, i) => min + (max - min) * ((i + 1) / ((layer.levels as number) + 1)));
      }
      // An explicit array and an `{ interval }`'s absolute multiples are
      // CLIPPED, not renumbered — an interval's lines must stay at the same
      // fixed elevations regardless of the window, exactly as they stay
      // fixed regardless of the visible range.
      if (Array.isArray(layer.levels)) return layer.levels.filter(inWindow);
      return glyphMapContourIntervalLevels((layer.levels as { readonly interval: number }).interval, range.min, range.max).filter(inWindow);
    }

    /**
     * The level list's own nominal spacing — the ladder rung
     * {@link glyphMapContourIndexLevels} measures a level's ordinal against.
     * Each `levels` shape knows its own: an `{ interval }` IS the spacing, a
     * count's is the even step it distributes across the window, and an
     * explicit array's is its smallest positive gap (`0` for a single level,
     * which makes every level an index level — the right answer when there
     * is no ladder to count along).
     */
    function levelStepFor(range: { readonly min: number; readonly max: number }, levels: readonly number[]): number {
      if (typeof layer.levels === "number") {
        const min = Math.max(range.min, windowMin);
        const max = Math.min(range.max, windowMax);
        return min <= max ? (max - min) / (layer.levels + 1) : 0;
      }
      if (!Array.isArray(layer.levels)) return (layer.levels as { readonly interval: number }).interval;
      const sorted = [...levels].sort((a, b) => a - b);
      let step = Infinity;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap > 0 && gap < step) step = gap;
      }
      return Number.isFinite(step) ? step : 0;
    }

    /**
     * First mounted piece whose bounds contain `(lon, lat)` wins. Tile bounds
     * are inclusive on both edges, so adjacent tiles overlap on their shared
     * edge — but with vertex sampling the tie no longer MATTERS: both sides
     * interpolate the same shared edge values and return the same number, so
     * which one answers is unobservable. It stays first-wins (stable key
     * order) so it is deterministic rather than render-order dependent. NaN
     * only when NO mounted piece covers the point, which is what keeps an
     * uncovered cell skipped instead of smeared with a clamped edge value.
     */
    function elevationAtLonLat(lon: number, lat: number): number {
      for (const f of mosaic) {
        const value = f.valueAt(lon, lat);
        if (Number.isFinite(value)) return value;
      }
      return NaN;
    }

    async function updateProvider(provider: GlyphMapProvider): Promise<void> {
      if (disposed) return;
      if (updateInFlight) { updateQueued = true; return; }
      updateInFlight = true;
      try {
        // `getView()`, not raw `view` — see the raster runtime's own
        // `updateProvider` doc for why.
        // The mesh RESOLUTION question is still the view's own
        // degrees-per-cell — `reliefFractionForLevel` asks how many quads a
        // cell deserves, not which level exists — so only the LOD moved.
        const degPerCell = glyphMapDegreesPerCell(getView());
        const lod = sweepLOD(provider);
        const level = provider.zooms.find((z) => z.z === lod);
        if (!level) return;
        const padCells = GLYPH_MAP_CONTOUR_PAD_CELLS;
        const grid = projectionGrid();
        const geoSamples = viewportGeoSamples(padCells, grid);
        const resolveKey = (z: number, x: number, y: number): string => {
          const r = provider.resolveTile ? provider.resolveTile(z, x, y) : { z, x, y };
          return `${r.z}/${r.x}_${r.y}`;
        };
        const desired = new Set<string>();
        const { x0, x1, y0, y1 } = candidateTileRange(level, padCells);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (isBoundsVisible(provider.bounds(lod, x, y), padCells, grid, geoSamples)) desired.add(resolveKey(lod, x, y));
          }
        }
        // Same "never blank the layer entirely" failsafe the raster and
        // vector sweeps use — a view whose every sample misses still gets
        // one field rather than nothing.
        if (desired.size === 0 && level.cols > 0 && level.rows > 0) desired.add(resolveKey(lod, 0, 0));

        const missing = [...desired].filter((key) => !fieldCache.has(key));
        if (missing.length > 0) {
          await Promise.all(missing.map(async (key) => {
            const [zStr, xy] = key.split("/");
            const [xStr, yStr] = xy.split("_");
            fieldCache.set(key, await loadGlyphMapElevationPiece(provider, Number(zStr), Number(xStr), Number(yStr)));
          }));
          if (disposed) return;
        }

        const next = [...desired].map((key) => fieldCache.get(key)).filter((f): f is GlyphMapElevationPiece => f !== undefined);
        const changed = next.length !== mosaic.length || next.some((f, i) => f !== mosaic[i]);
        mosaic = next;
        if (changed) scene.rerender();
      } finally {
        updateInFlight = false;
        if (updateQueued) {
          updateQueued = false;
          await updateProvider(provider);
        }
      }
    }

    function stamp(grid: CellGrid, cellToSceneGrid: GlyphMapCellAffine, baseGrid: ProjectionGrid): void {
      const range = fieldRange();
      if (!range) return;
      // `hasOpaqueSurface` stays a SCENE-level check (does ANY raster layer
      // exist, anywhere — base or a detail grid, regardless of density) —
      // deliberately not per-grid. `stampGlyphMapContour`'s own gate
      // (`Number.isFinite(grid.depth[idx])`) already reads whichever grid IS
      // passed to it, so it already answers "does a surface exist HERE" per
      // grid on its own; this flag only decides whether that question is
      // meaningful at all. With a raster layer mounted at density > 1, its
      // geometry lives ENTIRELY in its own detail grid (AGENTS.md's per-mesh
      // detail layers): the base grid's own `grid.depth` then reads
      // non-finite everywhere, so `requireSurface: true` correctly blanks
      // the contour on the base (nothing there to annotate) while the SAME
      // flag, passed to the detail grid's own `stamp()` call, correctly
      // gates on that grid's real terrain coverage instead. No raster layer
      // mounted anywhere degrades every grid to "draw wherever the field
      // itself is defined" (open sky reads uniformly non-finite too, and the
      // per-grid gate can't tell that apart from "no surface exists to
      // annotate" — see `stroke.ts`'s `GlyphMapContourOptions.requireSurface`
      // doc).
      const hasOpaqueSurface = [...layerStates.values()].some((s) => s.kind === "raster");
      const levels = levelsFor(range);
      const plan = stampGlyphMapContour(
        grid,
        (col, row) => {
          // `col`/`row` are THIS grid's own local cell coordinates — sample
          // at the cell CENTER in LOCAL units first (a local half-cell is
          // 1/density of a scene cell; adding 0.5 after the affine would
          // sample the wrong offset), then convert forward through the
          // affine into scene/base coordinates (the mirror of `line`'s own
          // inverse conversion above) and unproject through the public
          // `unproject()` wrapper — safe here because `composedTransformCells`
          // restores `camera`'s zoom/center/fovScale to their base-call
          // values for the duration of a detail call's stamping (see
          // `StrokeLayerRuntime`'s doc), so `unproject()`'s own live
          // `projectionGrid()`/`camera.project` reads answer with the
          // scene's true base framing even mid-detail-render.
          const scenePt = glyphMapLocalCellToScene(col + 0.5, row + 0.5, cellToSceneGrid);
          const ll = unproject([scenePt.col, scenePt.row]);
          if (!ll) return NaN;
          return elevationAtLonLat(ll[0], ll[1]);
        },
        {
          levels,
          color: layer.color,
          requireSurface: hasOpaqueSurface,
          minElevation: layer.minElevation,
          maxElevation: layer.maxElevation,
          labels: layer.labels === true
            ? { levels: glyphMapContourIndexLevels(levels, levelStepFor(range, levels), layer.labelEvery ?? GLYPH_MAP_CONTOUR_LABEL_EVERY) }
            : undefined,
        },
      );
      if (!plan) return;
      // ONE greedy declutter over this grid's whole candidate set, the same
      // stable "priority descending, then input order" arbitration the symbol
      // layer uses — not a second mechanism. `padX` is doing double duty as
      // the repetition spacing along a single contour (see
      // `glyphMapDeclutterLabels`), which is why it is much wider than the
      // labels themselves.
      const placed = glyphMapDeclutterLabels(
        plan.candidates.map((candidate, index) => ({ id: String(index), col: candidate.col, row: candidate.row, label: candidate.text, priority: candidate.priority })),
        1,
        1,
        GLYPH_MAP_CONTOUR_LABEL_PAD_X,
        GLYPH_MAP_CONTOUR_LABEL_PAD_Y,
      );
      stampGlyphMapContourLabels(grid, placed.map((p) => plan.candidates[Number(p.id)]), plan, layer.color);
    }

    return {
      async update(): Promise<void> {
        if (isGlyphMapFieldProvider(layer.source)) await updateProvider(layer.source);
        else scene.rerender();
      },
      stamp,
      dispose(): void {
        disposed = true;
        fieldCache.clear();
        mosaic = [];
      },
      getFieldRange(): { readonly min: number; readonly max: number } | null {
        return fieldRange();
      },
    };
  }

  interface FeatureLayerRuntime { update(): Promise<void>; dispose(): void }

  function createFeatureLayerRuntime(
    source: GlyphMapVectorSource,
    rebuild: (features: readonly GlyphMapVectorFeature[]) => void,
    padCells = 2,
    sourceLayer?: string,
    filter?: GlyphMapFeatureFilter,
  ): FeatureLayerRuntime {
    const cache = new Map<string, import("./vector/types").GlyphMapVectorTile>();
    let disposed = false;
    async function update(): Promise<void> {
      if (!isGlyphMapVectorProvider(source)) { rebuild(filter ? source.features.filter(filter) : source.features); return; }
      // `getView()`, not raw `view` — see the raster runtime's own
      // `updateProvider` doc for why.
      const lod = sweepLOD(source);
      const level = source.zooms.find((z) => z.z === lod);
      if (!level) return;
      const desired: string[] = [];
      const grid = projectionGrid();
      const geoSamples = viewportGeoSamples(padCells, grid);
      // The provider's OWN addressing — a Mercator-addressed hosted pyramid
      // indexes `y` through a `log(tan)`, not through latitude directly.
      // Everything else in this sweep is already addressing-agnostic:
      // `isBoundsVisible` asks `source.bounds`, and the cache key, the
      // in-flight guard and the debounce treat `z/x_y` as opaque.
      const { x0, x1, y0, y1 } = candidateTileRange(level, padCells, source.tileRange);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (isBoundsVisible(source.bounds(lod, x, y), padCells, grid, geoSamples)) desired.push(`${lod}/${x}_${y}`);
      }
      if (!desired.length) desired.push(`${lod}/0_0`);
      await Promise.all(desired.filter((key) => !cache.has(key)).map(async (key) => {
        const [z, xy] = key.split("/"), [x, y] = xy.split("_");
        const tile = await loadVectorTileSafely(source, +z, +x, +y);
        if (tile) cache.set(key, tile);
      }));
      if (disposed) return;
      const selected = desired.flatMap((key) => Object.entries(cache.get(key)?.layers ?? {}).filter(([name]) => !sourceLayer || name === sourceLayer).flatMap(([, features]) => features));
      rebuild(filter ? selected.filter(filter) : selected);
    }
    return { update, dispose() { disposed = true; cache.clear(); rebuild([]); } };
  }

  /**
   * `glyphMapVectorPolygons`'s `visible` option — the near-hemisphere test
   * an extrusion WALL needs, since a wall's normal is tangential and no
   * winding can make a far-side one back-facing (`layers.ts`'s "Far
   * hemisphere" section; a cap needs nothing here, its own outward normal
   * plus the rasterizer's backface cull already answer it, view-independently).
   *
   * `null` for a projection with no `visible` capability, which is every flat
   * one — `project()` returning NaN is already their exclusion — so the flat
   * path stays byte-identical.
   *
   * The grid is captured ONCE per mesh rebuild rather than per vertex, the
   * same `projectionGrid()`-hoisting `isBoundsVisible`'s callers do: a rebuild
   * runs this for every ring vertex of every feature, and `projectionGrid()`
   * costs two `getBoundingClientRect()` calls.
   */
  /**
   * WALK MODE reaches this through {@link nearSideVisible} like every other
   * point consumer, and it is the site the reported blank was seen at: an
   * extrusion wall's normal is TANGENTIAL, so this predicate is the only
   * thing standing between a wall and the frame, and when it started
   * answering "far side" for the whole world a tenth of a degree above the
   * horizontal, the buildings went with it.
   *
   * It was previously argued to need no branch, on a measurement taken at
   * LEVEL pitch only — where the cylinder test happens to cut a
   * `fill-extrusion`'s far walls at roughly street scale (a 300 m block on
   * the view axis painted 4,590 cells at 80 m, 480 at 400 m and zero from
   * 800 m out) and so looked like a working far-field cull. It is not one:
   * the same expression answers "visible" for EVERY distance the moment the
   * lens tips down (a block six horizons away painted 24 cells at 10 degrees
   * of down pitch), and "invisible" for every distance the moment it tips up.
   * The local horizon is the cull, at every pitch and by construction.
   */
  function nearSidePredicate(): ((lon: number, lat: number, elev: number) => boolean) | undefined {
    const isVisible = projection.visible;
    if (!isVisible) return undefined;
    const grid = projectionGrid();
    return (lon, lat, elev) => {
      const world = projection.project(lon, lat, elev);
      return Number.isFinite(world[0]) && Number.isFinite(world[1]) && Number.isFinite(world[2])
        && nearSideVisible(lon, lat, world, grid);
    };
  }

  /**
   * The live camera state a `fill-extrusion`'s wall cull depends on, as one
   * comparable value. ONE definition because two copies that drift apart make
   * the memo below silently miss a camera change.
   */
  function cameraCullKey(): string {
    // `bearing` is part of the camera as far as a wall cull is concerned:
    // it is a real rotation, and it is the only one that does not show up in
    // `rotX`/`rotY` at all (it lives in `camera.mat`).
    return `${camera.rotX},${camera.rotY},${camera.zoom},${camera.target.join(",")},${bearing}`;
  }

  /**
   * Decoded pixels this map supplies to its own scene, built lazily. A map with
   * no `facade` layer never generates the tile and never calls
   * `setTextureSamplers` at all, so it is byte-identical to before this existed.
   */
  let ownSamplers: Map<string, TextureSampler> | null = null;
  function ensureFacadeSampler(): void {
    if (ownSamplers?.has(GLYPH_MAP_FACADE_TEXTURE)) return;
    ownSamplers = new Map(ownSamplers ?? []);
    ownSamplers.set(GLYPH_MAP_FACADE_TEXTURE, glyphMapFacadeTexture());
    scene.setTextureSamplers(ownSamplers);
  }
  /** `facade: true` means "the built-in tile"; an object is taken as authored. */
  function resolveFacade(option: boolean | GlyphMapFacadeOptions | undefined): GlyphMapFacadeOptions | undefined {
    if (!option) return undefined;
    return option === true ? { texture: GLYPH_MAP_FACADE_TEXTURE } : option;
  }

  function createMeshFeatureRuntime(layer: GlyphMapFillLayer | GlyphMapFillExtrusionLayer): FeatureLayerRuntime {
    let handles: GlyphMeshHandle[] = [];
    let mesh: GlyphMapVectorMesh | null = null;
    /**
     * The camera state the mounted polygons were last culled against. The
     * wall cull is idempotent, so a repeated sync with an unmoved camera —
     * `applyDrag` fires per pointer EVENT and the motion loop fires again per
     * FRAME — costs one string compare instead of a re-cull. `""` forces the
     * next sync to do the work (a fresh mesh, or a fresh mount).
     *
     * The camera alone is the whole key: the verdict is `projection.visible`,
     * which asks only whether a point's `camera.project(...)` DEPTH beats the
     * projection's own anchor's, and the grid dimensions the projection call
     * also takes scale screen x/y without reordering depth. A `resize()`
     * therefore cannot change which walls survive, and this need not pay
     * `projectionGrid()`'s two `getBoundingClientRect` calls to find that out.
     */
    let culledAt = "";
    /**
     * Re-cull the mesh's walls against the LIVE camera and hand the survivors
     * to the existing mesh handle. Nothing here re-triangulates: `mesh` is
     * camera-independent (see `glyphMapVectorMesh`) and only which of its
     * wall faces survive depends on where the camera is.
     *
     * O(1) for a `fill` layer (no walls) and for every flat projection (no
     * `visible` capability), so registering this unconditionally costs a
     * mounted-layer-count loop and nothing else.
     */
    function syncWalls(): void {
      if (!mesh || !mesh.walls.length || !projection.visible) return;
      const key = cameraCullKey();
      if (key === culledAt) return;
      culledAt = key;
      const nearSide = nearSidePredicate();
      const polygons = nearSide ? glyphMapVectorCullWalls(mesh, nearSide) : [...mesh.polygons];
      if (handles.length) handles[0].setPolygons(polygons);
      else if (polygons.length) handles.push(scene.add(polygons, meshTransform(layer, layer.density)));
    }
    /**
     * The features this layer last built from, and the ground probe answers
     * that build used — `{lon, lat, ground}` per polygon GROUP, in build
     * order, recorded by the `groundElevation` callback itself so nothing here
     * has to know how `glyphMapVectorMesh` groups rings.
     *
     * Together they are what `syncGround` needs to notice that the terrain
     * under a mounted extrusion has moved (a finer tier arrived, a raster
     * layer was added or removed) and rebuild it — a `fill-extrusion` on a
     * STATIC source is otherwise never rebuilt at all, so without this a
     * building mounted before its terrain landed would stay at the datum for
     * the life of the map.
     */
    let lastFeatures: readonly GlyphMapVectorFeature[] = [];
    let groundProbes: { lon: number; lat: number; ground: number }[] = [];
    /** Whether the last build had any terrain to read at all — a raster layer arriving or leaving is itself a ground change, and no probe can report it. */
    let builtOnTerrain = false;
    function build(features: readonly GlyphMapVectorFeature[]): void {
      lastFeatures = features;
      // The mounted tile set moved: the walk collision index describes the
      // OLD buildings and has to be thrown away. Rebuilt lazily on the next
      // step, so a map that is not walking pays one assignment.
      if (layer.type === "fill-extrusion") invalidateWalkCollision();
      for (const handle of handles) handle.dispose();
      handles = [];
      culledAt = "";
      const variation = layer.type === "fill-extrusion" ? layer.colorVariation ?? 0 : 0;
      // `part` is the polygon GROUP's own anchor, and the variation is seeded
      // from it rather than from the feature: a real OSM pyramid emits every
      // attribute-identical building as ONE multipolygon (50 features carrying
      // 1,991 footprints in the vendored `14/8579/5736`), so a per-feature seed
      // paints a whole neighbourhood one tone — see `glyphMapFeatureSeed`. A
      // colour-by-attribute is a property of the feature and ignores it.
      const color = (feature: GlyphMapVectorFeature, part: readonly [number, number]) => {
        if (layer.type === "fill" && layer.colorProperty && layer.colors) return layer.colors[String(feature.properties?.[layer.colorProperty])] ?? layer.color;
        if (variation > 0 && layer.color) return glyphMapVaryColor(layer.color, glyphMapFeatureSeed(feature, part), variation);
        return layer.color;
      };
      // Registered on the SCENE, not fetched: the tile is generated in plain JS
      // (see `glyphMapFacadeTexture`) and handed straight to the rasterizer.
      const facade = layer.type === "fill-extrusion" ? resolveFacade(layer.facade) : undefined;
      if (facade?.texture === GLYPH_MAP_FACADE_TEXTURE) ensureFacadeSampler();
      // Resolved ONCE per build, like `line`'s own per-stamp resolution: it
      // walks the mounted layer list. `null` = no `raster` layer mounted, and
      // then no `groundElevation` option is passed at all — the datum, and
      // byte-identical to before extrusions were planted on terrain.
      //
      // A `fill` is deliberately NOT planted: it is a flat overlay drawn on
      // the datum (a shaded country, a lake), not a structure standing on the
      // ground, and its own mesh carries no walls to stand on.
      const groundAt = layer.type === "fill-extrusion" ? groundElevationSampler() : null;
      groundProbes = [];
      builtOnTerrain = groundAt !== null;
      mesh = glyphMapVectorMesh(features.filter((f) => f.geometryType !== "point" && f.geometryType !== "line"), projection, {
        color,
        // Both callbacks read the SAME two numbers, so they are resolved by
        // one helper: `heightProperty` and `baseOffsetProperty` are both
        // measured from the ground (see `baseOffsetProperty`'s own doc), and
        // the mesh primitive wants a thickness measured up from the offset.
        height: layer.type === "fill-extrusion"
          ? (f) => Math.max(0, extrusionTopMetres(layer, f) - extrusionBaseMetres(layer, f))
          : undefined,
        groundElevation: groundAt ? (_f, lon, lat) => {
          const ground = groundAt(lon, lat);
          groundProbes.push({ lon, lat, ground });
          return ground;
        } : undefined,
        // TRUE metres above that ground — a structure offset, not an
        // elevation. See `GlyphMapFillExtrusionLayer.baseOffsetProperty`.
        // Unparseable (OSM tags carry "20 m" and worse) reads as no offset,
        // exactly as an unparseable height reads as the flat fallback, rather
        // than NaN-ing the whole feature out of the render.
        baseOffset: layer.type === "fill-extrusion" ? (f) => extrusionBaseMetres(layer, f) : undefined,
        facade,
      });
      const nearSide = mesh.walls.length ? nearSidePredicate() : undefined;
      const polygons = nearSide ? glyphMapVectorCullWalls(mesh, nearSide) : [...mesh.polygons];
      if (polygons.length) handles.push(scene.add(polygons, meshTransform(layer, layer.density)));
      if (nearSide) culledAt = cameraCullKey();
      scene.rerender();
    }
    /**
     * Re-plant this layer when — and only when — the ground actually moved.
     * Re-probing the recorded points costs one tile lookup per group and
     * nothing else; a rebuild (measured 13.7ms on the real z0 admin_0 tile)
     * runs only on a real difference, so the steady state of a map whose
     * terrain is settled is free.
     */
    function syncGround(): void {
      if (layer.type !== "fill-extrusion") return;
      const groundAt = groundElevationSampler();
      const moved = (groundAt !== null) !== builtOnTerrain
        || (groundAt !== null && groundProbes.some((p) => groundAt(p.lon, p.lat) !== p.ground));
      if (moved) build(lastFeatures);
    }
    const runtime = createFeatureLayerRuntime(layer.source, build, 2, layer.sourceLayer, layer.filter);
    nearSideGeometrySyncs.add(syncWalls);
    if (layer.type === "fill-extrusion") groundChangeSyncs.add(syncGround);
    // WALK collision: an extrusion's footprints are the only solid things in
    // the scene. A CALLBACK over the layer's live feature list rather than a
    // snapshot, so a tile arriving needs no re-registration — and the index
    // itself is invalidated by `build` alone, since every path that gives a
    // layer features (the first `update()`, a tile landing, and `dispose`'s
    // own `rebuild([])`) goes through it. One invalidation site, not three.
    const collisionSource = (): readonly GlyphMapVectorFeature[] => lastFeatures;
    if (layer.type === "fill-extrusion") walkCollisionSources.add(collisionSource);
    return {
      update: runtime.update,
      dispose() {
        nearSideGeometrySyncs.delete(syncWalls);
        groundChangeSyncs.delete(syncGround);
        // `runtime.dispose()` below re-runs `build([])`, which invalidates.
        walkCollisionSources.delete(collisionSource);
        runtime.dispose();
        mesh = null;
        for (const h of handles) h.dispose();
        handles = [];
      },
    };
  }

  function createPointFeatureRuntime(layer: GlyphMapSymbolLayer | GlyphMapCircleLayer): FeatureLayerRuntime {
    let hotspots: GlyphHotspotHandle[] = [];
    let sync: (() => void) | null = null;
    const runtime = createFeatureLayerRuntime(layer.source, (features) => {
      if (sync) nearSideSyncs.delete(sync);
      for (const h of hotspots) h.remove();
      hotspots = [];
      const records: { handle: GlyphHotspotHandle; feature: GlyphMapVectorFeature; lon: number; lat: number; label: string; priority: number }[] = [];
      for (const feature of features.filter((f) => f.geometryType === "point" || f.rings.every((r) => r.length === 1))) for (const ring of feature.rings) {
        const point = ring[0]; if (!point) continue;
        const priority = Number(feature.properties?.[layer.type === "symbol" ? layer.priorityProperty ?? "population_rank" : "population"] ?? 0);
        if (layer.type === "symbol" && priority < (layer.minPriority ?? -Infinity)) continue;
        const handle = scene.addHotspot({ id: `glyph-map-layer-point-${nextMarkerId++}`, at: projection.project(point[0], point[1], 0) });
        const label = layer.type === "symbol" ? String(feature.properties?.[layer.textProperty ?? "name"] ?? "") : "";
        handle.el.classList.add(layer.type === "symbol" ? "glyph-map-symbol" : "glyph-map-circle");
        handle.el.textContent = label;
        handle.el.style.color = layer.color ?? "";
        if (layer.type === "circle") {
          const scaled = layer.radiusProperty ? Number(feature.properties?.[layer.radiusProperty]) * (layer.radiusScale ?? 1) : NaN;
          const radius = Number.isFinite(scaled) ? scaled : layer.radius ?? 2;
          handle.el.style.width = handle.el.style.height = `${Math.max(1, radius) * 2}px`;
          handle.el.style.borderRadius = "50%";
          handle.el.style.backgroundColor = layer.color ?? "currentColor";
        }
        hotspots.push(handle);
        records.push({ handle, feature, lon: point[0], lat: point[1], label, priority });
      }
      sync = () => {
        if (layer.type === "circle") {
          records.forEach((r) => {
            const world = projection.project(r.lon, r.lat, 0);
            const grid = projectionGrid();
            const visible = Number.isFinite(world[0]) && Number.isFinite(world[1]) && Number.isFinite(world[2])
              && nearSideVisible(r.lon, r.lat, world, grid);
            setHotspotNearSide(r.handle.el, visible);
          });
          return;
        }
        const candidates = records.map((r, i) => { const p = project([r.lon, r.lat]); return { id: String(i), col: p.col, row: p.row, label: r.label, priority: r.priority, visible: p.visible }; }).filter((c) => c.visible);
        const visible = new Set(glyphMapDeclutterLabels(candidates).map((c) => c.id));
        records.forEach((r, i) => { r.handle.el.style.opacity = visible.has(String(i)) ? "1" : "0"; });
      };
      nearSideSyncs.add(sync); sync();
    }, 2, layer.sourceLayer, layer.filter);
    return { update: runtime.update, dispose() { runtime.dispose(); if (sync) nearSideSyncs.delete(sync); for (const h of hotspots) h.remove(); hotspots = []; } };
  }

  /**
   * A small, self-contained elevation MOSAIC reader over whichever `raster`
   * layer is currently mounted — the terrain source `createHeatmapRuntime`
   * needs so its relief hugs the real surface instead of floating at the
   * datum (the reported "doesn't begin glued to the planet" defect).
   *
   * Deliberately reuses the CONTOUR runtime's own machinery rather than
   * writing a third elevation lookup: `loadGlyphMapElevationPiece` and
   * `GlyphMapElevationPiece.valueAt` are the exact functions
   * `createContourLayerRuntime` above already uses for the identical
   * "elevation at an arbitrary lon/lat across the currently visible tile
   * set" problem — including its vertex-grid sampling, so a heatmap's
   * ground-hugging relief reads the same continuous terrain a contour does. This is a
   * SEPARATE instance (a heatmap layer's own source is independent of any
   * contour layer's, and either may be mounted without the other) built
   * the same way, not a shared mutable cache — sharing one would couple two
   * independently-addable/removable layers' lifecycles together for no
   * reason.
   *
   * There is no terrain source of its own on `GlyphMapHeatmapLayer` — it is
   * whichever `raster` layer happens to be mounted, found by kind in
   * `layerStates` at the moment this resolves (mirroring the contour
   * runtime's own `hasOpaqueSurface` lookup a few hundred lines above). No
   * mounted raster, or a raster whose `source` is a static (non-provider)
   * `GlyphMapGeoTile` rather than a `GlyphMapProvider` tile pyramid, both
   * resolve to an EMPTY mosaic — elevation 0 (the datum) is then the
   * honest answer, not a bug, exactly as a flat, terrain-less map should
   * render a heatmap sitting on the ground plane.
   */
  function createHeatmapTerrainReader() {
    const fieldCache = new Map<string, GlyphMapElevationPiece>();
    let mosaic: readonly GlyphMapElevationPiece[] = [];

    async function resolve(): Promise<void> {
      const rasterLayer = [...layerStates.values()]
        .map((s) => (s.kind === "raster" ? s.layer : null))
        .find((l): l is GlyphMapRasterLayer => l !== null);
      const source = rasterLayer?.source;
      if (!source || !isGlyphMapProvider(source)) { mosaic = []; return; }
      const lod = sweepLOD(source);
      const level = source.zooms.find((z) => z.z === lod);
      if (!level) { mosaic = []; return; }
      const padCells = GLYPH_MAP_CONTOUR_PAD_CELLS;
      const grid = projectionGrid();
      const geoSamples = viewportGeoSamples(padCells, grid);
      const desired = new Set<string>();
      const { x0, x1, y0, y1 } = candidateTileRange(level, padCells);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (isBoundsVisible(source.bounds(lod, x, y), padCells, grid, geoSamples)) desired.add(`${lod}/${x}_${y}`);
      }
      if (desired.size === 0 && level.cols > 0 && level.rows > 0) desired.add(`${lod}/0_0`);
      const missing = [...desired].filter((key) => !fieldCache.has(key));
      if (missing.length > 0) {
        await Promise.all(missing.map(async (key) => {
          const [zStr, xy] = key.split("/");
          const [xStr, yStr] = xy.split("_");
          fieldCache.set(key, await loadGlyphMapElevationPiece(source, Number(zStr), Number(xStr), Number(yStr)));
        }));
      }
      mosaic = [...desired].map((key) => fieldCache.get(key)).filter((f): f is GlyphMapElevationPiece => f !== undefined);
    }

    function elevationAt(lon: number, lat: number): number {
      for (const f of mosaic) {
        const value = f.valueAt(lon, lat);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    }

    // Whether there is any real terrain mesh for the heatmap to potentially
    // z-fight against — `elevationAt` returning exactly 0 is not itself
    // proof of "no terrain" (a raster's own real elevation is legitimately
    // 0 at sea level), so this is its own explicit signal, not inferred
    // from a value.
    function hasTerrain(): boolean {
      return mosaic.length > 0;
    }

    return { resolve, elevationAt, hasTerrain };
  }

  function createHeatmapRuntime(layer: GlyphMapHeatmapLayer): FeatureLayerRuntime {
    let handle: GlyphMeshHandle | null = null;
    const terrain = createHeatmapTerrainReader();
    const runtime = createFeatureLayerRuntime(layer.source, (features) => {
      handle?.dispose(); handle = null;
      const bounds = layer.bounds ?? projection.domain;
      const cols = Math.max(4, Math.round(view.cols * (layer.density ?? 1)));
      const rows = Math.max(2, Math.round(view.rows * (layer.density ?? 1)));
      const field = glyphMapPointHeatmap(features, bounds, cols, rows, layer.radius ?? 2, layer.weightProperty);
      const elevation = new Float32Array((cols + 1) * (rows + 1));
      const densityScale = 1 / Math.max(field.max, Number.EPSILON);
      const reliefHeight = layer.height ?? GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M;
      // A grid VERTEX samples the cell up-and-left of it (`Math.min` clamps
      // the outer ring back onto the last real cell), so `threshold` has to
      // ask about every cell INCIDENT to the vertex, not just that one —
      // see `GlyphMapHeatmapLayer.threshold`'s doc for the dilate-then-erode
      // consequence this deliberately accepts.
      const threshold = layer.threshold ?? 0;
      const densityAt = (x: number, y: number) => field.values[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))] * densityScale;
      // The lift only exists to keep two independently-meshed surfaces
      // (terrain's own relief mesh and this one) from z-fighting where they
      // coincide — with no mounted raster there is no second surface to
      // fight, so a flat, terrain-less heatmap keeps its pre-existing
      // bounded-relief contract (`[0, reliefHeight]`) exactly.
      const lift = terrain.hasTerrain() ? GLYPH_MAP_HEATMAP_SURFACE_LIFT_M : 0;
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
        const own = densityAt(x, y);
        const keep = threshold <= 0
          || own >= threshold || densityAt(x - 1, y) >= threshold || densityAt(x, y - 1) >= threshold || densityAt(x - 1, y - 1) >= threshold;
        // Terrain elevation is looked up at THIS vertex's own lon/lat (the
        // same mapping `glyphMapGeoTileVertexLonLat` uses inside
        // `glyphMapPolygons` itself, reused here rather than re-derived) so
        // the relief mesh's base tracks the ground beneath it exactly, not
        // an average or a per-tile constant. Raw metres, pre-exaggeration —
        // `glyphMapPolygons` feeds this straight into `projection.project`,
        // which applies `exaggeration` uniformly to terrain and heatmap
        // relief alike (AGENTS.md: "every projection treats elevation the
        // same way"), so this function must never itself multiply by it.
        const [lon, lat] = glyphMapGeoTileVertexLonLat({ bounds, cols, rows } as GlyphMapGeoTile, x, y);
        const base = terrain.elevationAt(lon, lat) + lift;
        elevation[y * (cols + 1) + x] = keep ? base + own * reliefHeight : NaN;
      }
      const colors = layer.colors ?? ["#111827", "#2563eb", "#22c55e", "#f59e0b", "#ef4444"];
      const tile: GlyphMapGeoTile = { bounds, cols, rows, elevation, source: "heatmap", sampler: "density" };
      // The color ramp reads DENSITY, not absolute elevation — `elevation[]`
      // now carries terrain + lift + relief, so `glyphMapPolygons`'s own
      // `elevCenter` (the average of a quad's 4 corner elevations, passed to
      // `color`) is no longer proportional to density alone. `colorByCenter`
      // maps that SAME combined-elevation average (computed here identically
      // — same 4 corners, same order, same division, so the float value is
      // bit-exact and safe to use as a lookup key) back to the density-only
      // relief average that drove it, so the ramp still reads density
      // regardless of what terrain sits underneath.
      const colorByCenter = new Map<number, number>();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const nw = elevation[r * (cols + 1) + c];
        const sw = elevation[(r + 1) * (cols + 1) + c];
        const se = elevation[(r + 1) * (cols + 1) + c + 1];
        const ne = elevation[r * (cols + 1) + c + 1];
        if (![nw, sw, se, ne].every(Number.isFinite)) continue;
        const combined = (nw + sw + se + ne) / 4;
        const ownNW = densityAt(c, r), ownSW = densityAt(c, r + 1), ownSE = densityAt(c + 1, r + 1), ownNE = densityAt(c + 1, r);
        colorByCenter.set(combined, ((ownNW + ownSW + ownSE + ownNE) / 4) * reliefHeight);
      }
      // `heatmap`'s own `density` sizes its relief GRID (above), not a
      // per-mesh detail layer, so only the render mode is forwarded here.
      handle = scene.add(
        // `colorSample: "corner-mean"` is REQUIRED here, not a preference:
        // `colorByCenter` above is keyed on the 4-corner mean, so the
        // default `"median"` (which reads terrain, not the drawn surface —
        // see `glyphMapPolygons`' own doc) would miss every lookup and flatten
        // the ramp to `colors[0]`. A median could not be substituted on both
        // sides either: it IS one of the corner values, and adjacent quads
        // share corners, so two quads with different densities collide on one key.
        glyphMapPolygons(tile, projection, { colorSample: "corner-mean", color: (v) => colors[Math.min(colors.length - 1, Math.floor(((colorByCenter.get(v) ?? 0) / reliefHeight) * colors.length))] }),
        meshTransform(layer),
      );
      scene.rerender();
    }, 2, layer.sourceLayer, layer.filter);
    return {
      async update(): Promise<void> { await terrain.resolve(); await runtime.update(); },
      dispose() { runtime.dispose(); handle?.dispose(); handle = null; },
    };
  }

  type LayerState =
    | { readonly kind: "background"; readonly layer: GlyphMapBackgroundLayer }
    | { readonly kind: "raster"; readonly layer: GlyphMapRasterLayer; readonly runtime: RasterLayerRuntime }
    | { readonly kind: "line"; readonly layer: GlyphMapLineLayer; readonly runtime: StrokeLayerRuntime }
    | { readonly kind: "contour"; readonly layer: GlyphMapContourLayer; readonly runtime: ContourLayerRuntime }
    | { readonly kind: "feature"; readonly layer: GlyphMapFillLayer | GlyphMapFillExtrusionLayer | GlyphMapSymbolLayer | GlyphMapCircleLayer | GlyphMapHeatmapLayer; readonly runtime: FeatureLayerRuntime }
    | { readonly kind: "model"; readonly layer: GlyphMapModelLayer; readonly handle: GlyphMeshHandle };

  const layerOrder: string[] = [];
  const layerStates = new Map<string, LayerState>();
  let nextLayerId = 0;

  function applyBackground(): void {
    let color: string | undefined;
    for (const id of layerOrder) {
      const state = layerStates.get(id);
      if (state?.kind === "background") color = state.layer.color;
    }
    scene.output.style.backgroundColor = color ?? "";
  }

  // ── Real-sun lighting ─────────────────────────────────────────────────
  // Two mechanisms, one concept, selected by projection CAPABILITY (see
  // `GlyphMapSunOptions` and `sun.ts`'s header): an ORBIT projection gets a
  // real directional light (Lambert draws the terminator), a SHEET gets a
  // per-cell day/night term stamped through the shared `transformCells`
  // hook. Nothing here branches on `projection.id`.

  let sunMode: GlyphMapSunMode = opts.sun?.mode ?? "off";
  let sunManualAt: number = opts.sun?.date !== undefined
    ? (typeof opts.sun.date === "number" ? opts.sun.date : opts.sun.date.getTime())
    : Date.now();
  let sunTickMs: number = opts.sun?.tickMs ?? GLYPH_MAP_SUN_TICK_MS;
  let sunTwilightDeg: number = opts.sun?.twilightDeg ?? GLYPH_MAP_SUN_TWILIGHT_DEG;
  let sunNightOpacity: number = opts.sun?.nightOpacity ?? GLYPH_MAP_NIGHT_OPACITY;
  let sunNightColor: string = opts.sun?.nightColor ?? "#000000";
  let sunNightLevels: number = opts.sun?.nightLevels ?? GLYPH_MAP_NIGHT_LEVELS;
  let sunTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * The instant the sun is resolved at. `"realtime"` reads the wall clock
   * on every call — that, plus the timer below, is the whole of "the
   * terminator advances"; nothing caches a subsolar point.
   */
  function sunAt(): number {
    return sunMode === "manual" ? sunManualAt : Date.now();
  }

  function sunDirection(): Vec3 | null {
    return sunMode === "off" ? null : glyphMapSunDirection(projection, sunAt());
  }

  /**
   * The direction the widget owns for the key light right now, or `null`
   * when it owns none.
   *
   * PRECEDENCE, stated once: the sun wins. Both write the same field, and a
   * real sun is a statement about the world while a headlight is a statement
   * about the viewer — a map showing a genuine terminator must not have it
   * washed out by the camera. The page never has both on at once (its "Full"
   * button is sun-off + headlight-on), but the library has to answer anyway.
   */
  /**
   * The headlight direction for the camera AS POSED, bearing included.
   *
   * {@link glyphMapHeadlightDirection} answers from `rotX`/`rotY` alone, and
   * a bearing lives in `camera.mat` where those two cannot see it — a turn
   * about the pivot's normal genuinely MOVES the view axis (unlike the
   * view-axis roll bearing was first mistaken for, which by definition does
   * not), so reading the Euler pair while a matrix is installed would light
   * the map from where the camera used to be.
   *
   * The matrix answer is the same functional, read off the rows: projected
   * depth is `row3(mat) . c(v)`, so its world gradient is that row
   * un-swapped, `(mat[7], mat[6], mat[8])`. At bearing 0 that reduces
   * ALGEBRAICALLY to `(sin rotX cos rotY, sin rotX sin rotY, cos rotX)` —
   * `glyphMapHeadlightDirection` exactly — and it is already unit length,
   * being a row of a rotation. The Euler call is still the one that runs
   * there, so the default path is untouched.
   */
  function headlightDirection(): Vec3 {
    const m = camera.mat;
    if (!camera.useMat || !m) return glyphMapHeadlightDirection(camera.rotX, camera.rotY);
    return [m[7]!, m[6]!, m[8]!];
  }

  function keyLightDirection(): Vec3 | null {
    return sunDirection() ?? (keyLightMode === "headlight" ? headlightDirection() : null);
  }

  /**
   * Write the owned direction into the scene, and report whether it wrote.
   *
   * Two properties this has to hold, both load-bearing:
   *
   * 1. DIRECTION ONLY — `intensity`/`color` stay exactly as the consumer set
   *    them, so a widget-owned light and a consumer-owned key light never
   *    fight over the same field.
   * 2. NO WRITE WHEN NOTHING MOVED. `scene.setOptions` invalidates glyphcss's
   *    per-triangle shading cache and schedules a render; a headlight is
   *    called on every camera-moving frame, and a pan or a wheel-zoom does
   *    not rotate the camera at all (nor does ANY gesture on a sheet, whose
   *    `rotX`/`rotY` are `tilt`/`0`). The equality check turns those into one
   *    three-number compare instead of a full re-shade.
   *
   * Every caller invokes this IMMEDIATELY BEFORE a synchronous
   * `scene.rerender()`, which supersedes the microtask `setOptions` queued —
   * so a headlight costs zero extra renders per frame. Calling it anywhere
   * else would buy a whole extra grid render per pointer event, which is
   * exactly the discarded work the motion loop above exists to remove.
   */
  function applyKeyLight(): boolean {
    if (destroyed) return false;
    const direction = keyLightDirection();
    if (!direction) return false;
    const current = scene.getOptions().directionalLight;
    const d = current?.direction;
    if (d && d[0] === direction[0] && d[1] === direction[1] && d[2] === direction[2]) return false;
    scene.setOptions({ directionalLight: { ...current, direction } });
    return true;
  }

  /**
   * Push the sun into the scene. On a sheet there is no light to write, so
   * this only re-renders: the night term is stamped from `sunAt()` inside
   * the hook, which re-reads the clock itself.
   */
  function applySun(): void {
    if (destroyed) return;
    if (!applyKeyLight()) scene.rerender();
  }

  function emitSun(): void {
    if (sunMode === "off") return;
    const at = sunAt();
    emit({ type: "sun", at, subsolar: glyphMapSubsolarPoint(at), direction: sunDirection() });
  }

  function syncSunTimer(): void {
    if (sunTimer !== null) { clearInterval(sunTimer); sunTimer = null; }
    if (destroyed || sunMode !== "realtime" || !(sunTickMs > 0)) return;
    sunTimer = setInterval(() => {
      applySun();
      emitSun();
    }, sunTickMs);
  }

  /**
   * The SHEET terminator. Skipped outright on an orbit projection (its
   * directional light already IS the terminator — stamping as well would
   * double-darken the night side, the same "don't run both" rule
   * `GlyphMapPresentation.hillshade` follows under a relief mesh) and on a
   * viewport overlay grid (which owns no lit surface of its own; strokes
   * stamp into it afterwards and stay legible at full colour).
   */
  function stampSunNight(g: CellGrid, cellToSceneGrid: GlyphMapCellAffine, baseGrid: ProjectionGrid, viewport: boolean): void {
    if (sunMode === "off" || viewport || isOrbitProjection()) return;
    const solve = sheetUnprojector(baseGrid);
    if (!solve) return;
    const sun = glyphMapSubsolarPoint(sunAt());
    stampGlyphMapNight(
      g,
      (col, row) => {
        // Sample at the cell CENTER in this grid's own LOCAL units before
        // converting forward into scene/base coordinates — the same order
        // the contour layer's own field probe uses, and for the same reason
        // (a local half-cell is 1/density of a scene cell).
        const scenePt = glyphMapLocalCellToScene(col + 0.5, row + 0.5, cellToSceneGrid);
        return solve(scenePt.col, scenePt.row);
      },
      sun,
      { twilightDeg: sunTwilightDeg, nightOpacity: sunNightOpacity, nightColor: sunNightColor, levels: sunNightLevels },
    );
  }

  function setSun(next: GlyphMapSunOptions): void {
    const previousMode = sunMode;
    if (next.mode !== undefined) sunMode = next.mode;
    if (next.date !== undefined) sunManualAt = typeof next.date === "number" ? next.date : next.date.getTime();
    if (next.tickMs !== undefined) sunTickMs = next.tickMs;
    if (next.twilightDeg !== undefined) sunTwilightDeg = next.twilightDeg;
    if (next.nightOpacity !== undefined) sunNightOpacity = next.nightOpacity;
    if (next.nightColor !== undefined) sunNightColor = next.nightColor;
    if (next.nightLevels !== undefined) sunNightLevels = next.nightLevels;
    // Whether the shared cell hook is needed at all can flip with the mode.
    syncStrokeHookInstalled();
    syncSunTimer();
    // Snap to the true current sun NOW rather than waiting up to a whole
    // tick — entering "realtime" must not show a stale (or absent) sun for
    // 30 s. Turning the sun OFF still re-renders, so a sheet's night term
    // disappears in the same frame.
    if (sunMode !== "off" || previousMode !== "off") applySun();
    emitSun();
  }

  /**
   * Turning the headlight ON writes it and renders in this same call.
   * Turning it OFF only re-renders: the direction the widget last wrote
   * stays, exactly as leaving the sun leaves the sun's last direction — the
   * consumer owns that field and re-applies its own.
   */
  function setKeyLight(mode: GlyphMapKeyLightMode): void {
    if (mode === keyLightMode) return;
    keyLightMode = mode;
    if (!applyKeyLight()) scene.rerender();
  }

  /**
   * ONE scene option, then a synchronous render — the same write-then-render
   * discipline `applyKeyLight` follows, and for the same reason (a bare
   * `setOptions` only schedules a microtask render). Nothing is re-mounted:
   * every mesh already carries its cast/receive flag.
   */
  function setShadow(next: GlyphMapShadowOptions | null): void {
    if (destroyed) return;
    shadow = next;
    scene.setOptions({ shadow: resolvedShadow() });
    scene.rerender();
  }

  // ── Stroke layers (`line`/`contour`) composed into ONE `transformCells`
  // hook (glyphcss allows exactly one). Installed lazily — a map with zero
  // line/contour layers never touches `transformCells` at all, keeping the
  // "byte-identical with no hook" default true for the common raster-only
  // case (AGENTS.md's transformCells doc). Reads `layerOrder`/`layerStates`
  // live on every invocation, so no rebuild is needed when a stroke layer's
  // async tile fetch resolves or the layer order changes — only whether the
  // hook is installed AT ALL needs tracking (`strokeLayerCount`). ─────────

  const baseTransformCells = sceneOverrides.transformCells;
  let strokeLayerCount = 0;

  // Snapshot of `projectionGrid()` taken at the BASE grid's own hook call —
  // see `StrokeLayerRuntime`'s doc. glyphcss ALWAYS rasterizes the base grid
  // (and so calls this hook for it) before any detail layer in a given
  // render, so capturing here on the base call and reusing it for every
  // detail call in the SAME render is safe; a render with no base meshes at
  // all still calls this hook for the base grid (an empty one), so the
  // snapshot is never stale by the time a detail call needs it.
  let cachedBaseGrid: ProjectionGrid | null = null;

  // The camera fields glyphcss temporarily mutates while fitting EACH detail
  // mesh's own `<pre>` (`camera.zoom`/`center`/`fovScale` — see
  // `createGlyphScene.ts`'s per-mesh detail-layer loop; `rotX`/`rotY`/
  // `target`/`stretch`/`mat` never change across a render's detail meshes).
  // Snapshotting just these three at the base call and restoring them for
  // the DURATION of a detail call's stamping is what makes `camera.project`/
  // `unproject()` (and this file's own `projectionGrid()`, which reads
  // `camera.center`) answer with the scene's true BASE framing while a
  // stroke layer stamps into a detail grid — passing `baseGrid` as the
  // METRICS argument alone is not sufficient, because both camera
  // implementations (`createGlyphCamera.ts`) scale by the LIVE
  // `state.zoom` directly (`screenPxX = r[0] * state.zoom`), not by
  // anything `metrics` can override.
  let cachedBaseCamera: { readonly zoom: number; readonly center: readonly [number, number]; readonly fovScale: number } | null = null;

  /**
   * Whether a stroke layer stamps into the grid `layerInfo` describes.
   *
   * A stroke layer's own `density` (`GlyphMapLineLayer.density`/
   * `GlyphMapContourLayer.density`) now has two distinct meanings:
   * - `undefined`/`1` (the pre-existing default): the layer has no
   *   resolution preference of its own, so it stamps into EVERY grid this
   *   scene produces — base and every per-mesh detail grid — following
   *   whichever surface it happens to cross, exactly the pre-existing
   *   behavior. It never stamps into a viewport OVERLAY grid, since it
   *   never asked `syncViewportOverlayDensities` to create one.
   * - a genuine value (`!== 1`): the layer wants an INDEPENDENT resolution
   *   of its own, decoupled from any mesh. It stamps ONLY into the single
   *   viewport overlay grid whose `density` matches its own — never into
   *   the base grid or any mesh's detail grid, which would otherwise
   *   duplicate the same stroke at a coarser resolution alongside its own
   *   sharper overlay.
   */
  function strokeLayerStampsIntoGrid(layer: GlyphMapLineLayer | GlyphMapContourLayer, layerInfo?: Parameters<TransformCells>[1]): boolean {
    const density = layer.density;
    if (density === undefined || density === 1) return layerInfo?.viewport !== true;
    return layerInfo?.viewport === true && layerInfo.density === density;
  }

  /**
   * The set of densities `line`/`contour` layers currently ask for
   * (`layer.density`, excluding `undefined`/`1`) — routed straight to
   * `scene.setViewportOverlayDensities`, which itself dedupes and ignores
   * `1`. Recomputed on every stroke-layer add/remove; a layer's own
   * `density` cannot change after `addLayer` (there is no per-layer setter),
   * so no other event needs to trigger this.
   */
  function syncViewportOverlayDensities(): void {
    const densities: number[] = [];
    for (const state of layerStates.values()) {
      if (state.kind !== "line" && state.kind !== "contour") continue;
      const d = state.layer.density;
      if (d !== undefined && d !== 1 && !densities.includes(d)) densities.push(d);
    }
    scene.setViewportOverlayDensities(densities);
  }

  function composedTransformCells(grid: CellGrid, layerInfo?: Parameters<TransformCells>[1]): CellGrid {
    let g = grid;
    if (baseTransformCells) g = baseTransformCells(g, layerInfo) ?? g;
    const isDetail = !!layerInfo?.detail;
    if (!isDetail) {
      cachedBaseGrid = projectionGrid();
      cachedBaseCamera = { zoom: camera.zoom, center: camera.center, fovScale: camera.fovScale };
    }
    // Stamp into EVERY output grid the scene produces — the base grid AND
    // each per-mesh detail grid — each in its own coordinate frame and
    // depth-tested against its own depth buffer (glyphcss renders the base
    // grid before any detail layer is fit, so a "stamp base cells outside
    // each detail footprint" partition can't work: this frame's detail
    // footprints don't exist yet at base-hook time). `layerInfo` is
    // `undefined` only for a render routed through the effects pipeline's
    // own cell hook (AGENTS.md's transformCells doc: "a hook must tolerate
    // `undefined`") — that path only ever hands this hook the shared base
    // grid, so identity is the correct affine there, not a guess.
    const cellToSceneGrid = layerInfo?.cellToSceneGrid ?? GLYPH_MAP_IDENTITY_CELL_AFFINE;
    const liveZoom = camera.zoom, liveCenter = camera.center, liveFovScale = camera.fovScale;
    if (isDetail && cachedBaseCamera) {
      camera.zoom = cachedBaseCamera.zoom;
      camera.center = cachedBaseCamera.center as [number, number];
      camera.fovScale = cachedBaseCamera.fovScale;
    }
    try {
      // Night first, strokes after: a border/contour is an ANNOTATION, not a
      // lit surface, so it stays at full colour on the dark side instead of
      // being dimmed into illegibility along with the terrain under it.
      if (cachedBaseGrid) stampSunNight(g, cellToSceneGrid, cachedBaseGrid, layerInfo?.viewport === true);
      for (const id of layerOrder) {
        const state = layerStates.get(id);
        if ((state?.kind === "line" || state?.kind === "contour") && strokeLayerStampsIntoGrid(state.layer, layerInfo)) {
          state.runtime.stamp(g, cellToSceneGrid, cachedBaseGrid!);
        }
      }
    } finally {
      if (isDetail && cachedBaseCamera) {
        camera.zoom = liveZoom;
        camera.center = liveCenter;
        camera.fovScale = liveFovScale;
      }
    }
    return g;
  }

  function syncStrokeHookInstalled(): void {
    // The sun's SHEET terminator rides the same single hook — but ONLY a
    // sheet has one: an orbit projection's terminator is a real directional
    // light, so holding the hook there would buy nothing and cost the
    // encoder's slower hook-safe path (measured 0.9 ms per render on a
    // 160x64 globe, ~35%). The live projection decides, and every site that
    // can change it re-syncs (`applyProjectionFrame`, `setSun`).
    const shouldInstall = strokeLayerCount > 0 || (sunMode !== "off" && !isOrbitProjection());
    const current = scene.getOptions().transformCells;
    if (shouldInstall && current !== composedTransformCells) {
      scene.setOptions({ transformCells: composedTransformCells });
    } else if (!shouldInstall && current === composedTransformCells) {
      scene.setOptions({ transformCells: baseTransformCells });
    }
  }

  const initialLoadPromises: Promise<unknown>[] = [];
  let mapLoaded = false;

  function addLayer(layer: GlyphMapLayer, beforeId?: string): string {
    const id = layer.id ?? `glyph-map-layer-${nextLayerId++}`;
    if (layerStates.has(id)) throw new RangeError(`glyphcss/maps: createGlyphMap.addLayer — layer id "${id}" is already mounted.`);
    if (beforeId !== undefined && !layerStates.has(beforeId)) {
      throw new RangeError(`glyphcss/maps: createGlyphMap.addLayer — beforeId "${beforeId}" is not a mounted layer.`);
    }
    const insertAt = beforeId !== undefined ? layerOrder.indexOf(beforeId) : -1;
    if (insertAt === -1) layerOrder.push(id); else layerOrder.splice(insertAt, 0, id);

    if (layer.type === "background") {
      layerStates.set(id, { kind: "background", layer });
      applyBackground();
    } else if (layer.type === "raster") {
      const runtime = createRasterLayerRuntime(layer, id);
      layerStates.set(id, { kind: "raster", layer, runtime });
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    } else if (layer.type === "line") {
      const runtime = createLineLayerRuntime(layer);
      layerStates.set(id, { kind: "line", layer, runtime });
      strokeLayerCount++;
      syncStrokeHookInstalled(); // BEFORE update() so its rerender already carries this layer's stamps
      syncViewportOverlayDensities();
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    } else if (layer.type === "contour") {
      const runtime = createContourLayerRuntime(layer);
      layerStates.set(id, { kind: "contour", layer, runtime });
      strokeLayerCount++;
      syncStrokeHookInstalled();
      syncViewportOverlayDensities();
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    } else if (layer.type === "model") {
      const handle = scene.add([...layer.polygons], meshTransform(layer, layer.density));
      layerStates.set(id, { kind: "model", layer, handle });
    } else {
      const runtime = layer.type === "fill" || layer.type === "fill-extrusion"
        ? createMeshFeatureRuntime(layer)
        : layer.type === "heatmap" ? createHeatmapRuntime(layer) : createPointFeatureRuntime(layer);
      layerStates.set(id, { kind: "feature", layer, runtime });
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    }
    return id;
  }

  function removeLayer(id: string): void {
    const state = layerStates.get(id);
    if (!state) return;
    if (state.kind === "raster") {
      state.runtime.dispose();
      // Its tiles were the ground under every mounted extrusion; with them
      // gone the honest base is the datum again.
      notifyGroundChanged();
    }
    else if (state.kind === "feature") state.runtime.dispose();
    else if (state.kind === "model") state.handle.dispose();
    else if (state.kind === "line" || state.kind === "contour") {
      state.runtime.dispose();
      strokeLayerCount--;
    }
    layerStates.delete(id);
    const idx = layerOrder.indexOf(id);
    if (idx >= 0) layerOrder.splice(idx, 1);
    if (state.kind === "background") applyBackground();
    if (state.kind === "line" || state.kind === "contour") {
      syncStrokeHookInstalled();
      syncViewportOverlayDensities();
    }
    scene.rerender();
  }

  function moveLayer(id: string, beforeId?: string): void {
    if (!layerStates.has(id)) throw new RangeError(`glyphcss/maps: createGlyphMap.moveLayer — layer id "${id}" is not mounted.`);
    if (beforeId !== undefined && !layerStates.has(beforeId)) {
      throw new RangeError(`glyphcss/maps: createGlyphMap.moveLayer — beforeId "${beforeId}" is not a mounted layer.`);
    }
    const idx = layerOrder.indexOf(id);
    layerOrder.splice(idx, 1);
    const insertAt = beforeId !== undefined ? layerOrder.indexOf(beforeId) : -1;
    if (insertAt === -1) layerOrder.push(id); else layerOrder.splice(insertAt, 0, id);

    const state = layerStates.get(id);
    if (state?.kind === "background") {
      applyBackground();
      return;
    }
    if (state?.kind === "line" || state?.kind === "contour" || state?.kind === "feature" || state?.kind === "model") {
      // The composed hook reads `layerOrder` live — no runtime action beyond a repaint.
      scene.rerender();
      return;
    }
    // Best-effort repaint order for raster layers: re-mount every raster
    // layer's ALREADY-CACHED tiles (no refetch) in the new sequence, so a
    // later layer's mesh is added after (paints over, on a depth tie) an
    // earlier one's — the same dispose+recreate precedent
    // `flatmap.astro`'s `remountActive()` already established.
    for (const layerId of layerOrder) {
      const s = layerStates.get(layerId);
      if (s?.kind === "raster") s.runtime.disposeMeshes();
    }
    for (const layerId of layerOrder) {
      const s = layerStates.get(layerId);
      if (s?.kind === "raster") void s.runtime.update();
    }
  }

  /** Provenance of every currently-mounted layer's data source — MAPS.md's "derived from mounted layers" attribution requirement (`attribution.ts`). */
  function getAttributions(): readonly GlyphMapAttribution[] {
    const lists: (readonly GlyphMapAttribution[] | undefined)[] = [];
    for (const id of layerOrder) {
      const state = layerStates.get(id);
      if (state?.kind === "raster") lists.push(state.layer.source.attribution);
      else if (state?.kind === "line") lists.push(state.layer.source.attribution);
      else if (state?.kind === "contour" && isGlyphMapFieldProvider(state.layer.source)) lists.push(state.layer.source.attribution);
      else if (state?.kind === "feature") lists.push(state.layer.source.attribution);
      else if (state?.kind === "model") lists.push(state.layer.attribution);
    }
    return glyphMapDedupeAttributions(lists);
  }

  function getContourFieldRange(id: string): { readonly min: number; readonly max: number } | null {
    const state = layerStates.get(id);
    return state?.kind === "contour" ? state.runtime.getFieldRange() : null;
  }

  // ── Projection transitions (MAPS.md §13 slice 4) ────────────────────────

  /**
   * Camera framing projection `proj` alone would use for view `v` — mirrors
   * `syncCameraToView`'s own two branches (capability, not identity: an
   * orbit endpoint is one with `cameraForCenter`), but takes `proj` as an
   * explicit argument instead of reading the live closure `projection`.
   * `syncCameraToView` can only ever answer "what framing does the CURRENT
   * projection want" — `setProjection` needs to ask that question of BOTH
   * transition endpoints independently, every animation frame, while
   * `projection` itself holds a THIRD, blended value with neither
   * `cameraForCenter` nor a meaningful `project(lon,lat,0)` "this is home"
   * anchor of its own.
   */
  function framingFor(proj: GlyphMapProjection, v: GlyphMapView): CameraFraming {
    const [lon, lat] = v.center;
    const grid = projectionGrid();
    const zoom = computeZoomForSpan(v, proj, grid);
    // The ENDPOINT's own ceiling, not the live projection's: a globe and a
    // sheet at the same view have completely different limbs (the sheet has
    // none), so asking `proj` is the same capability discipline every other
    // branch in this file follows.
    const pitch = tiltFor(proj, v, zoom, grid);
    if (proj.cameraForCenter) {
      // `orbitRotationFor`, not `proj.cameraForCenter` directly — same
      // 2-to-1-inverse reason `syncCameraToView` uses it (J8): re-deriving
      // the canonical branch for an endpoint that the held branch already
      // frames would make a transition's very first frame lerp toward a
      // 180deg roll flip the camera never asked for.
      const { rotX, rotY } = orbitRotationFor(proj, lon, lat);
      return { rotX: rotX + pitch, rotY, target: proj.project(lon, lat, 0), zoom, tilt: pitch };
    }
    return { rotX: pitch, rotY: 0, target: proj.project(lon, lat, 0), zoom, tilt: pitch };
  }

  /**
   * Reprojects every mesh whose geometry was baked against the (now stale)
   * `projection` closure value. `raster` tiles rebuild via `RasterLayerRuntime
   * .reproject()` (dispose + remount from cache, no refetch); `fill`/
   * `fill-extrusion`/`symbol`/`circle`/`heatmap` (`kind: "feature"`) rebuild
   * via their existing `runtime.update()`, which already rebuilds from
   * cached tiles against whatever `projection` is live when it resolves.
   * `line`/`contour` need no action here — `StrokeLayerRuntime.stamp()`
   * reads `projection.project` FRESH on every render already (never
   * cached — see its own doc), so they reproject for free on the
   * `scene.rerender()` `applyProjectionFrame` ends with. `model` layers
   * carry raw, already-world-space polygons with no projection dependency
   * at all, and `background` is a flat CSS color.
   */
  function reprojectGeometry(): void {
    for (const state of layerStates.values()) {
      if (state.kind === "raster") state.runtime.reproject();
      else if (state.kind === "feature") void state.runtime.update();
    }
  }

  /** Plain-tuple camera framing — see {@link applyProjectionFrame}'s doc for why this, not a re-derived {@link framingFor} result, is what a transition's `from` side is captured as. */
  interface CameraFraming {
    readonly rotX: number;
    readonly rotY: number;
    readonly target: Vec3;
    readonly zoom: number;
    /**
     * The pitch component OF `rotX` — carried alongside it because a
     * transition poses the camera at a lerp of two endpoints' pitches, and
     * `applyDragState` must subtract back out exactly what was added. There
     * is no way to recover it from `rotX` alone: on an orbit endpoint `rotX`
     * is `cameraForCenter(...).rotX + tilt` and both terms are live.
     */
    readonly tilt: number;
  }

  /**
   * Applies transition fraction `t` between endpoint projection `to` and a
   * `from` camera framing, for the CURRENT `view`: reassigns the closure
   * `projection` (an exact endpoint reference at `t<=0`/`t>=1`,
   * `glyphMapProjectionTransition`'s blend strictly between), blends camera
   * framing between `fromFraming` and `to`'s OWN `framingFor` result,
   * reprojects mesh geometry, and repaints.
   *
   * `fromFraming` is a caller-supplied PLAIN TUPLE — captured ONCE by
   * `setProjection`, from the LIVE camera at the moment a transition starts
   * — rather than re-derived here via `framingFor(from, view)` on every
   * frame. Interrupting an in-flight transition with a second
   * `setProjection` call means `from` (the closure `projection` at that
   * moment) can ITSELF be a `glyphMapProjectionTransition` blend, which
   * deliberately exposes neither `cameraForCenter` nor a meaningful
   * `project(lon,lat,0)` "home" anchor of its own (`transition.ts`'s doc) —
   * `framingFor` would then silently take the SHEET branch and compute a
   * framing that has nothing to do with where the camera is actually
   * pointing (measured: a -35.4deg pitch / -50.5deg yaw / x0.0637 zoom snap
   * in the very next frame after an interrupt — J4, AGENTS.md-adjacent bug
   * list, "worst single jump"). The camera itself never lies about where it
   * currently is, interrupted or not, so `setProjection` reads it directly
   * instead of asking a projection object to reconstruct it.
   *
   * This also fixes a second, independently-reported jump (J5): even a
   * NON-interrupted `setProjection`'s first frame used to set `camera.zoom`
   * from `computeZoomForSpan(view, from)` — a fresh recomputation — rather
   * than the camera's actual live `zoom`, which can already have drifted
   * from what that recomputation gives (e.g. after a drag shifts
   * `view.center`'s latitude — the same "view/camera round-trip is not the
   * identity" root cause `applyDrag` never re-syncing `camera.zoom` also
   * produces elsewhere). Reading the live camera directly is correct in
   * BOTH cases: settled OR interrupted, it is always the true starting
   * pose.
   *
   * `rotX`/`rotY`/`zoom` are lerped as plain numbers (a globe endpoint's
   * `rotY` wrapping through ±180° near the antimeridian is a known, accepted
   * simplification — out of scope for this slice); `target` is lerped
   * component-wise since it's always either `[0,0,0]` (orbit) or a finite
   * world point (sheet), never `NaN`.
   */
  /**
   * World units per DEGREE of longitude at the view centre — `null` if the
   * projection has no position there, or a degenerate one.
   *
   * `alongParallel` picks the axis, and INTERPOLATES between them (log
   * space) rather than switching: `1` samples along the parallel, `0` along
   * the meridian, anything between is the geometric mean weighted toward
   * one. That is what a transition needs, because the two endpoints can
   * disagree about which axis their own `camera.zoom` frames — an orbit
   * projection fits the meridian, every sheet fits the parallel — and the
   * two differ by `1 / cos(lat)`.
   *
   * Deliberately NOT `computeZoomForSpan` itself: that function BRANCHES on
   * the orbit capability, and a transition blend exposes no such capability,
   * so the same surface would be measured one way at `t=0` (the endpoint
   * object) and the other way one frame later (the blend) — measured as a
   * 1.88x zoom snap on the first frame after a drag to 61N. Here the axis
   * weight is a continuous function of `t` supplied by the caller, so the
   * measure never jumps.
   */
  function centerDegreeScale(proj: GlyphMapProjection, alongParallel: number): number | null {
    const [lon, lat] = view.center;
    const eps = 1e-4;
    const rate = (dLon: number, dLat: number): number | null => {
      const a = proj.project(lon - dLon, lat - dLat, 0);
      const b = proj.project(lon + dLon, lat + dLat, 0);
      for (let i = 0; i < 3; i++) if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return null;
      const s = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (2 * eps);
      return Number.isFinite(s) && s > 0 ? s : null;
    };
    const parallel = rate(eps, 0);
    if (parallel === null) return null;
    if (alongParallel >= 1) return parallel;
    const meridian = rate(0, eps);
    if (meridian === null) return null;
    if (alongParallel <= 0) return meridian;
    return Math.exp(Math.log(meridian) + (Math.log(parallel) - Math.log(meridian)) * alongParallel);
  }

  /**
   * WHICH axis `computeZoomForSpan` frames `view.span` along, as a 0..1
   * number so a transition can interpolate between two projections that
   * disagree: `1` = the parallel (every sheet), `0` = the meridian (an orbit
   * projection — the globe, whose meridian chord is the only
   * latitude-invariant one, see `computeZoomForSpan`'s own doc).
   */
  function fitAxisOf(proj: GlyphMapProjection): number {
    return proj.cameraForCenter && proj.centerForCamera ? 0 : 1;
  }

  /**
   * `camera.zoom` for transition fraction `t`, scheduled so that APPARENT
   * SIZE — `worldScale x zoom`, here read at the view centre as screen units
   * per degree of longitude — moves log-linearly from the flight's start
   * value to its end value.
   *
   * Lerping the two endpoints' zooms linearly (what this used to do) is only
   * right when the two endpoints share a world scale, because no blend's
   * world scale is linear in `t`: the plain lerp path's is `lerp(sFrom, sTo,
   * t)`, the unwrap's is reciprocal. Multiply a linear zoom ramp by either
   * and the product is not paced by `t` at all — it sits near one end for
   * almost the whole flight and resolves over the last few percent. Measured
   * on the `/maps` defaults: globe -> equirectangular put 91% of its
   * wide-shape travel into the final tenth of the flight (the reported "it
   * unwraps and makes a zoom jump at the end"), and equirectangular <->
   * orthographic — 57x apart in world scale — inflated apparent size 15.7x
   * mid-flight before collapsing again ("change between Mercator and the
   * other flat ones and they zoom in and zoom out").
   *
   * Dividing a paced apparent size by the live surface's own measured scale
   * cancels ANY schedule, including a future projection pair's, instead of
   * asking every blend path to pre-cancel a linear ramp.
   *
   * Both endpoints stay EXACT — `t<=0` is the live camera's own zoom (J5's
   * whole point: the camera never lies about where it is) and `t>=1` is
   * `to`'s own framing, byte-identical to a `durationMs: 0` call — and they
   * are returned directly rather than via the formula so that exactness is
   * structural rather than a floating-point coincidence. An unmeasurable
   * scale anywhere (a cropped centre) degrades to the old linear lerp.
   */
  function transitionZoom(
    from: GlyphMapProjection,
    to: GlyphMapProjection,
    t: number,
    fromFraming: CameraFraming,
    toFraming: CameraFraming,
  ): number {
    if (t <= 0) return fromFraming.zoom;
    if (t >= 1) return toFraming.zoom;
    const axisFrom = fitAxisOf(from);
    const axisTo = fitAxisOf(to);
    const scaleFrom = centerDegreeScale(from, axisFrom);
    const scaleTo = centerDegreeScale(to, axisTo);
    const scaleNow = centerDegreeScale(projection, axisFrom + (axisTo - axisFrom) * t);
    if (scaleFrom === null || scaleTo === null || scaleNow === null) return lerp(fromFraming.zoom, toFraming.zoom, t);
    const apparentFrom = scaleFrom * fromFraming.zoom;
    const apparentTo = scaleTo * toFraming.zoom;
    if (!(apparentFrom > 0) || !(apparentTo > 0)) return lerp(fromFraming.zoom, toFraming.zoom, t);
    // Log-linear, not linear: apparent size is a multiplicative quantity (the
    // same reason `flyTo` interpolates `span` in log space), so a linear ramp
    // between two values an order of magnitude apart spends almost the whole
    // flight at the larger one.
    const apparent = Math.exp(lerp(Math.log(apparentFrom), Math.log(apparentTo), t));
    return apparent / scaleNow;
  }

  function applyProjectionFrame(from: GlyphMapProjection, to: GlyphMapProjection, t: number, fromFraming: CameraFraming): void {
    // `anchor` is what ENGAGES the globe<->sheet UNWRAP path (transition.ts's
    // `GlyphMapProjectionTransitionOptions.anchor` doc): the surface is
    // anchored ON the view centre, which is exactly where the linearly-lerped
    // `camera.target` below already points. Only a caller knows that, so the
    // unwrap deliberately does not default to `[0, 0]` — passing this is the
    // switch-on, and without it an orbit<->sheet pair silently keeps the plain
    // lerp (measured to bulge apparent size 49.6x at t=0.5).
    projection = t >= 1 ? to : t <= 0 ? from : glyphMapProjectionTransition(from, to, t, { anchor: view.center });
    // Whether the SHEET night term applies is a property of the live
    // projection, so a projection swap can add or remove the sun's only
    // reason to hold the shared cell hook (see `syncStrokeHookInstalled`).
    syncStrokeHookInstalled();
    const toFraming = framingFor(to, view);
    // The endpoints are assigned VERBATIM rather than through the lerp, so a
    // flight settles bit-for-bit on the framing a plain construction at the
    // same view would have produced (the "settles EXACTLY on the target"
    // parity gate in `widget.test.ts`). `a + (b - a) * 1` is not `b` in
    // floating point: it was within an ulp while an orbit endpoint's target
    // was the exact `[0, 0, 0]`, and is no longer once the target is a real
    // surface point.
    const framing = t >= 1 ? toFraming : t <= 0 ? fromFraming : null;
    camera.rotX = framing ? framing.rotX : lerp(fromFraming.rotX, toFraming.rotX, t);
    camera.rotY = framing ? framing.rotY : lerp(fromFraming.rotY, toFraming.rotY, t);
    camera.target = framing ? ([...framing.target] as Vec3) : lerp3(fromFraming.target, toFraming.target, t);
    camera.zoom = framing ? framing.zoom : transitionZoom(from, to, t, fromFraming, toFraming);
    // `rotX` above is a lerp of two endpoint poses, so the pitch baked into
    // it is the lerp of their pitches — recorded, not re-derived, so a drag
    // landing mid-flight subtracts back out exactly what was added.
    appliedTilt = framing ? framing.tilt : lerp(fromFraming.tilt, toFraming.tilt, t);
    // Rebuilt from the pose this frame just installed, and about the pivot
    // the BLENDED projection puts the view centre at — the heading is
    // carried through a projection change unchanged, which is what a reader
    // who turned the map and then switched projection asked for.
    syncCameraBearing();
    reprojectGeometry();
    applyKeyLight();
    syncNearSide();
    scene.rerender();
  }

  // ── ONE camera-motion loop ────────────────────────────────────────────
  //
  // Every kind of continuous camera motion this widget has — inertial drag
  // glide, `flyTo`, and `setProjection`'s blend — advances here, and the loop
  // issues AT MOST ONE `scene.rerender()` per displayed frame. Two competing
  // animation loops would be a worse bug than the one this fixes.
  //
  // The rule it enforces is the point: INPUT EVENTS ONLY ACCUMULATE STATE;
  // THE FRAME RENDERS. A trackpad emits 60-120 pointer/wheel events per
  // second, each arriving in its OWN task, and glyphcss coalesces renders on
  // a MICROTASK — which drains at the end of EVERY task. So before this loop
  // N pointer events inside one displayed frame bought N complete grid
  // renders, all but the last of them thrown away unpainted. Measured on this
  // package's own bench (`bench/maps-render/mapsBench.mjs`, continuous drag,
  // two synthesized pointer events per displayed frame): 1.96 renders per
  // displayed frame and 42.1 ms of main-thread time per frame.
  //
  // Camera/view STATE still updates synchronously inside each input handler.
  // It is cheap pure math, `getView()`/`camera.zoom` must not lag the gesture
  // for a caller reading them between events (the rule `applyWheel` already
  // followed), and the view<->camera round-trip invariants are asserted
  // immediately after firing 30 synchronous `pointermove`s with no frame in
  // between. Only the RENDER is deferred to the frame.
  //
  // The loop STOPS when nothing is moving — a static map runs no frames.

  interface FlyState {
    readonly fromLon: number; readonly fromLat: number; readonly fromSpan: number;
    readonly toLon: number; readonly toLat: number; readonly toSpan: number;
    readonly bow: number;
    readonly duration: number;
    startTime: number | null;
    readonly settle: () => void;
  }

  interface ProjectionAnimState {
    readonly from: GlyphMapProjection;
    readonly to: GlyphMapProjection;
    readonly fromFraming: CameraFraming;
    readonly duration: number;
    startTime: number | null;
    readonly settle: () => void;
  }

  let destroyed = false;
  let motionRafId: number | null = null;
  let motionLastTime = 0;
  /** An input handler mutated camera/view and the frame has not rendered it yet. */
  let motionDirty = false;
  let glideVx = 0, glideVy = 0, gliding = false;
  let flight: FlyState | null = null;
  let projectionAnim: ProjectionAnimState | null = null;

  function motionActive(): boolean {
    // A held movement key is motion in exactly the sense this loop means:
    // state that keeps changing until the reader stops it. It rides the ONE
    // rAF loop rather than starting a second one, so a walk still issues at
    // most one render per displayed frame.
    return motionDirty || gliding || flight !== null || projectionAnim !== null
      || (walk !== null && walkHeldKeys.size > 0);
  }

  function requestMotionFrame(): void {
    // No rAF (SSR, a bare jsdom): stay exactly as synchronous as this widget
    // was before the loop existed rather than silently never rendering.
    if (typeof requestAnimationFrame === "undefined") { motionStep(motionLastTime + 16, true); return; }
    if (motionRafId !== null) return;
    motionRafId = requestAnimationFrame((now) => { motionRafId = null; motionStep(now, false); });
  }

  function markMotionDirty(): void {
    motionDirty = true;
    requestMotionFrame();
  }

  function cancelMotionFrame(): void {
    if (motionRafId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(motionRafId);
      motionRafId = null;
    }
  }

  /**
   * Stops the inertial glide and any flight IN PLACE. Nothing is re-derived
   * and nothing snaps: both only ever write `view`/`camera` per frame, so
   * whatever the camera holds at this instant simply becomes the new
   * starting point for whatever takes over. This is the hand-over rule for
   * a drag, a wheel, a `setView`/`fitBounds`, or a second `flyTo`.
   */
  function cancelCameraGlide(): void {
    gliding = false;
    glideVx = 0; glideVy = 0;
    if (flight) { const f = flight; flight = null; f.settle(); }
  }

  const easeInOutQuad = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

  function advanceFlight(now: number): void {
    const f = flight!;
    if (f.startTime === null) f.startTime = now;
    const u = f.duration <= 0 ? 1 : Math.min(1, (now - f.startTime) / f.duration);
    const e = easeInOutQuad(u);
    // Span in LOG space — a zoom is multiplicative, so a linear lerp spends
    // almost the whole flight at the wide end — times a mid-arc bow that
    // pulls the camera OUT and back IN, so a cross-globe flight never skims
    // the surface at final detail (see `flyTo`'s doc).
    const span = Math.exp(Math.log(f.fromSpan) + (Math.log(f.toSpan) - Math.log(f.fromSpan)) * e)
      * (1 + (f.bow - 1) * Math.sin(Math.PI * e));
    applyViewState({
      center: [f.fromLon + (f.toLon - f.fromLon) * e, f.fromLat + (f.toLat - f.fromLat) * e],
      span,
    });
    emitViewChange("move");
    if (u >= 1) { flight = null; f.settle(); }
  }

  function advanceProjectionAnim(now: number): void {
    const a = projectionAnim!;
    if (a.startTime === null) a.startTime = now;
    const t = a.duration <= 0 ? 1 : Math.min(1, (now - a.startTime) / a.duration);
    applyProjectionFrame(a.from, a.to, t, a.fromFraming);
    if (t >= 1) { projectionAnim = null; a.settle(); }
  }

  function motionStep(now: number, synchronous: boolean): void {
    if (destroyed) return;
    const dt = synchronous ? 16 : Math.min(64, Math.max(1, motionLastTime > 0 ? now - motionLastTime : 16));
    motionLastTime = now;
    let moved = motionDirty;
    motionDirty = false;

    // Before the flight/glide branch, and never alongside one: a `flyTo` is
    // cancelled on entering walk mode and a walk has no inertia, so the two
    // cannot both own the position in the same frame.
    if (walk && advanceWalk(dt)) moved = true;

    if (flight) {
      advanceFlight(now);
      moved = true;
    } else if (gliding) {
      // Exponential decay, frame-rate independent: a dropped frame decays by
      // exactly as much as the two frames it replaced would have.
      const dx = glideVx * dt, dy = glideVy * dt;
      const decay = Math.exp(-dt / GLYPH_MAP_GLIDE_TAU_MS);
      glideVx *= decay; glideVy *= decay;
      applyDragState(dx, dy);
      emitViewChange("move");
      if (Math.hypot(glideVx, glideVy) < GLYPH_MAP_GLIDE_MIN_PX_PER_MS) { gliding = false; glideVx = 0; glideVy = 0; }
      moved = true;
    }

    if (projectionAnim) {
      // Runs LAST and does its own repaint: it owns camera framing outright,
      // reading whatever `view` the flight/glide above just produced, so the
      // two compose instead of fighting over `camera`.
      advanceProjectionAnim(now);
      moved = true;
    } else if (moved) {
      // A drag/glide rotated the camera; a headlight has to follow it in the
      // SAME frame or it is just a dark side that moves one frame late.
      //
      // EVERYTHING THAT WRITES TO THE SCENE GOES BEFORE THE `rerender()`,
      // and that ordering is the whole reason this frame renders ONCE.
      // `rerender()` supersedes a queued microtask render (it bumps
      // `renderGeneration` and clears `pendingRender`), so a scene write
      // ahead of it is free and the same write AFTER it arms a second, full,
      // never-superseded render that lands on this task's own microtask
      // checkpoint. `applyKeyLight`'s `setOptions` was already on the right
      // side; `syncNearSide` was not, and a `fill-extrusion` layer's
      // `syncWalls` calls `setPolygons` — so every camera-moving frame with
      // buildings mounted rendered the whole scene twice and threw the first
      // one away. Measured at street level in Zurich (140x63, 1440x900,
      // headed, OpenStreetMap water/roads/boundaries/buildings): renders per
      // displayed frame 1.65 -> 1.00, 33.7 -> 49.6 fps. The PAINTED output is
      // unchanged, because the second render is the one that was painted and
      // it used exactly the cull this ordering now feeds the first.
      applyKeyLight();
      syncNearSide();
      scene.rerender();
    }

    // Detail settles when MOTION stops, not when the pointer goes up: every
    // moving frame re-arms the 180ms debounce, so a glide or a flight fetches
    // once at rest instead of at every waypoint.
    if (moved) scheduleTileUpdate();
    if (motionActive()) requestMotionFrame();
  }

  /**
   * One frame of walking: integrate the held keys into a geodesic step,
   * re-sample the ground under the new position, and re-pose the camera.
   * Returns whether anything moved, which is what tells `motionStep` to
   * repaint and to re-arm the tile debounce.
   *
   * The step is a real geodesic (`glyphMapWalkStep`), not a planar delta:
   * one frame's 27 mm hardly cares, but the INTEGRAL of a long walk does —
   * a planar step accumulates a heading error with latitude, so walking due
   * north for a kilometre would drift east.
   *
   * `view` is written directly rather than through `applyViewState`, which
   * would run `clampViewToCover` (a sheet-only "cover, not contain" clamp
   * that walk mode's orbit-only gate already excludes) and then
   * `syncCameraToView` — the same pose this calls itself, once.
   */
  function advanceWalk(dtMs: number): boolean {
    const axis = glyphMapWalkAxis(walkHeldKeys);
    if (!axis) return false;
    const w = walk!;
    const metres = w.speed * (walkRunning ? GLYPH_MAP_WALK_RUN_MULTIPLIER : 1) * (dtMs / 1000);
    const wanted = glyphMapWalkStep(view.center[0], view.center[1], bearing, axis.forward * metres, axis.strafe * metres);
    // The STEP is tested, not the position, and a blocked one SLIDES —
    // `walkCollision.ts` owns the whole model. With no `fill-extrusion`
    // mounted, with `collision: false`, or with the ghost key held, this is
    // one branch and the geodesic step is used verbatim.
    const center = w.collision && !walkGhost
      ? glyphMapWalkResolveStep({ index: walkCollisionIndexNow(), from: view.center, to: wanted })
      : wanted;
    // A walker pressed into a wall has not moved, so the frame has nothing to
    // repaint and the tile debounce has nothing to re-arm — returning `true`
    // here would render the identical picture for as long as the key is held.
    if (center[0] === view.center[0] && center[1] === view.center[1]) return false;
    view = { ...view, center, bounds: undefined };
    refreshWalkGround();
    syncCameraToView(view);
    emitViewChange("move");
    return true;
  }

  /** Re-read the terrain under the walker from the mounted raster layers (finest tier first); `0` with none mounted, which is the datum every other layer already uses. */
  function refreshWalkGround(): void {
    const sample = groundElevationSampler();
    const elevation = sample ? sample(view.center[0], view.center[1]) : 0;
    walkGroundElevation = Number.isFinite(elevation) ? elevation : 0;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!walk) return;
    if (e.key === "Shift") { walkRunning = true; return; }
    // The collision defeat key. Held, not toggled — see `walkGhost`.
    if (e.key.toLowerCase() === "g") { walkGhost = true; return; }
    if (!glyphMapWalkAxisForKey(e.key)) return;
    // Claimed only while walking, so the page keeps every one of these keys
    // (arrows scroll, `d`/`s` reach whatever the host bound them to) at all
    // other times.
    e.preventDefault();
    const key = e.key.toLowerCase();
    if (walkHeldKeys.has(key)) return;
    walkHeldKeys.add(key);
    markMotionDirty();
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === "Shift") { walkRunning = false; return; }
    if (e.key.toLowerCase() === "g") { walkGhost = false; return; }
    walkHeldKeys.delete(e.key.toLowerCase());
  }

  /**
   * A window BLUR drops every held key. Without it, tabbing away mid-stride
   * leaves the key in the set with no `keyup` ever coming, and the walker
   * strides on forever into whatever the reader comes back to.
   */
  function onWalkBlur(): void {
    walkHeldKeys.clear();
    walkRunning = false;
    walkGhost = false;
  }

  // ── WALK MODE: mouselook ──────────────────────────────────────────────
  //
  // Reproduced from `website/src/pages/examples/parthenon.astro`, which is
  // the shipped, known-good FPV in this repo. Three things are taken from
  // it verbatim, each for its own stated reason:
  //
  //  1. **Pointer lock, acquired from `pointerdown`, never from `click`.**
  //     That page found the failure and named it: a per-frame effect layer
  //     rewrites the `<pre>`'s coloured spans, so a mousedown that lands on
  //     a glyph has its target detached before mouseup and the browser then
  //     never fires `click` — reproducing as "clicking the background works,
  //     clicking the temple doesn't". EVERY render in this package rewrites
  //     the same `<pre>`, so walk mode inherits the fragility exactly and
  //     takes the same way out. (`createGlyphFirstPersonControls` still
  //     binds `click` internally; the parthenon calls that a good candidate
  //     for an upstream fix, and this is the second consumer to route
  //     around it.)
  //  2. **A separate, slower look RATE.** Pointer lock hands the pointer a
  //     desk's worth of travel; the map's own drag rates are tuned for a
  //     hand that is holding onto the ground.
  //  3. **Drag-to-look for pointers that cannot lock** — touch, and any
  //     mouse whose lock request is refused. The parthenon's other half.
  //
  // Escape needs no handling: the browser releases the lock itself and the
  // `pointerlockchange` below is what the widget learns it from.
  let walkPointerLocked = false;

  /**
   * One look input, both axes, ONE re-pose.
   *
   * The heading and the pitch are written as STATE and then the camera is
   * posed once from both, rather than each axis posing on its own — a
   * `poseWalkCamera` re-solves the lens, re-derives the eye and rebuilds the
   * heading matrix, so doing it twice per mouse event is pure waste and the
   * intermediate pose is never seen.
   *
   * Mouse RIGHT turns the head right (facing north, the new heading is east
   * of north) and mouse DOWN looks down — the same signs the parthenon's
   * `applyLook` produces from `rotY - dx * sens` / `rotX - dy * sens`, and
   * the same signs this widget's own orient drag already had.
   */
  function applyWalkLook(dxPx: number, dyPx: number, degPerPx: number): void {
    if (!walk) return;
    const [lo, hi] = walkTiltRange();
    tiltRequest = clamp(appliedTilt - dyPx * degPerPx, lo, hi);
    bearing = glyphMapNormalizeBearing(bearing + dxPx * degPerPx);
    syncCameraToView(view);
    markMotionDirty();
    emitViewChange("move");
  }

  function onWalkPointerLockChange(): void {
    const doc = host.ownerDocument;
    walkPointerLocked = walk !== null && doc?.pointerLockElement === host;
  }

  function onWalkMouseMove(e: MouseEvent): void {
    if (!walk || !walkPointerLocked) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    if (dx === 0 && dy === 0) return;
    applyWalkLook(dx, dy, GLYPH_MAP_WALK_LOOK_DEG_PER_PX);
  }

  /**
   * The lens is solved against the RENDERED WIDTH (`glyphMapWalkLens`'
   * `viewportWidthPx`), so a host that changes size while walking needs the
   * pose re-run or the field of view is left cut for the old one — measured
   * at a third of the width, 26.3 degrees where 70 was asked for.
   *
   * It has to live HERE rather than in the consumer, and the consumer is the
   * proof: `/maps` never calls `map.resize()` at all — the scene's own
   * `autoSize` observer re-fits the grid underneath the widget — so a
   * lens-follows-the-width guarantee that depended on the host noticing is a
   * guarantee nothing was keeping. This is the parthenon's own
   * `window.addEventListener("resize", ...)` clause, scoped the same way it
   * is there (`if (mode !== "fpv") return;`): the observer exists only while
   * walking, so a map that never walks constructs nothing and observes
   * nothing.
   */
  let walkResizeObserver: ResizeObserver | null = null;

  function attachWalkInput(): void {
    const doc = host.ownerDocument;
    doc?.addEventListener("pointerlockchange", onWalkPointerLockChange);
    doc?.addEventListener("mousemove", onWalkMouseMove);
    if (!walkResizeObserver && typeof ResizeObserver !== "undefined") {
      walkResizeObserver = new ResizeObserver(() => {
        if (!walk) return;
        syncCameraToView(view);
        applyKeyLight();
        scene.rerender();
      });
      walkResizeObserver.observe(host);
    }
  }

  function detachWalkInput(): void {
    const doc = host.ownerDocument;
    doc?.removeEventListener("pointerlockchange", onWalkPointerLockChange);
    doc?.removeEventListener("mousemove", onWalkMouseMove);
    if (walkPointerLocked) { try { doc?.exitPointerLock(); } catch { /* ignore */ } }
    walkPointerLocked = false;
    walkResizeObserver?.disconnect();
    walkResizeObserver = null;
  }

  function setProjection(target: GlyphMapProjection, setOpts: GlyphMapSetProjectionOptions = {}): Promise<void> {
    // A projection change LEAVES walk mode rather than blending through it:
    // a transition's intermediate projections are not generally invertible
    // and a sheet endpoint cannot express a walker's world at all (see
    // {@link setWalk}). Leaving restores the pre-walk view, which is then
    // the view the transition flies from — the same hand-over rule a
    // glide/flight takes.
    if (walk) setWalk(null);
    // Hand over in place from whatever is currently moving the camera.
    if (projectionAnim) { const prev = projectionAnim; projectionAnim = null; prev.settle(); }
    cancelCameraGlide();
    const from = projection;
    // The DESTINATION's cover limit decides this flight's end span, applied
    // ONCE here, before the flight starts, and never re-applied mid-flight
    // (`limitProjection` returns `target` for its whole duration, so a
    // mid-flight wheel clamps to the same ceiling). Two endpoints can have
    // very different limits — a globe has none at all — and clamping at the
    // END instead would snap exactly at `t = 1`. Clamping here cannot snap:
    // `fromFraming` below is the LIVE camera, untouched by this, so `t = 0`
    // is unchanged and `transitionZoom` paces the whole change across the
    // flight as ordinary apparent-size travel.
    view = clampViewToCover(view, target);
    // Captured ONCE, from the LIVE camera, right here — see
    // `applyProjectionFrame`'s doc (J4/J5) for why this must never be
    // re-derived from `from` (a projection reference, possibly mid-blend)
    // on every animation frame.
    const fromFraming: CameraFraming = {
      rotX: camera.rotX,
      rotY: camera.rotY,
      target: [...camera.target] as Vec3,
      zoom: camera.zoom,
      tilt: appliedTilt,
    };
    const duration = Math.max(0, setOpts.durationMs ?? GLYPH_MAP_PROJECTION_TRANSITION_DEFAULT_MS);
    if (from === target || duration === 0 || typeof requestAnimationFrame === "undefined") {
      applyProjectionFrame(from, target, 1, fromFraming);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      projectionAnim = { from, to: target, fromFraming, duration, startTime: null, settle: resolve };
      requestMotionFrame();
    });
  }

  function flyTo(target: GlyphMapFlyToTarget, flyOpts: GlyphMapFlyToOptions = {}): Promise<void> {
    // Live state is the start — never the previous flight's origin, and never
    // anything re-derived. An interrupted flight therefore cannot snap.
    cancelCameraGlide();
    const fromLon = view.center[0], fromLat = view.center[1], fromSpan = view.span;
    let toLon = fromLon, toLat = fromLat, toSpan = fromSpan;
    if (target.bounds) {
      const framed = framingForBounds(target.bounds);
      toLon = framed.center[0]; toLat = framed.center[1]; toSpan = framed.span;
    } else {
      if (target.center) { toLon = target.center[0]; toLat = target.center[1]; }
      if (target.span !== undefined) toSpan = target.span;
    }
    // Shorter longitude arc: flying from 170 to -170 is 20 degrees east, not
    // 340 degrees west.
    let dLon = toLon - fromLon;
    while (dLon > 180) dLon -= 360;
    while (dLon < -180) dLon += 360;
    toLon = fromLon + dLon;
    const duration = Math.max(0, flyOpts.durationMs ?? GLYPH_MAP_FLY_TO_DEFAULT_MS);
    const bow = Math.max(1, flyOpts.bow ?? GLYPH_MAP_FLY_TO_MAX_BOW);
    if (duration === 0 || typeof requestAnimationFrame === "undefined"
      || !(fromSpan > 0) || !(toSpan > 0)) {
      setView({ center: [toLon, toLat], span: toSpan });
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      flight = { fromLon, fromLat, fromSpan, toLon, toLat, toSpan, bow, duration, startTime: null, settle: resolve };
      requestMotionFrame();
    });
  }

  // ── View mutation ────────────────────────────────────────────────────

  let tileUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleTileUpdate(): void {
    if (tileUpdateTimer !== null) clearTimeout(tileUpdateTimer);
    tileUpdateTimer = setTimeout(() => {
      tileUpdateTimer = null;
      for (const state of layerStates.values()) {
        if (state.kind === "raster" && isGlyphMapProvider(state.layer.source)) void state.runtime.update();
        else if (state.kind === "line" && isGlyphMapVectorProvider(state.layer.source)) void state.runtime.update();
        // A static (non-provider) `line`/`contour` source has nothing to
        // re-fetch — `stamp()` already re-samples live off the CURRENT
        // camera on every render (every view-changing gesture already calls
        // `scene.rerender()` directly, see `applyDrag`/`applyWheel`/`setView`
        // below), so gating this on the provider check, not the layer kind
        // alone, is intentional and mirrors `line`'s own gate exactly — not
        // an oversight to "fix" by dropping the condition.
        else if (state.kind === "contour" && isGlyphMapFieldProvider(state.layer.source)) void state.runtime.update();
        // A `fill-extrusion`'s mesh is camera-INDEPENDENT: its far-side wall
        // cull is re-applied per rendered frame from `nearSideSyncs`, not
        // baked in at build time, so a static source has nothing to redo as
        // the globe turns and this stays the plain provider-only condition
        // every other layer kind uses. Rebuilding it on the view change too
        // would cost a full re-triangulation (measured 13.7ms on the real z0
        // admin_0 tile) for a picture the cull has already produced.
        else if (state.kind === "feature" && isGlyphMapVectorProvider(state.layer.source)) {
          void state.runtime.update();
        }
      }
    }, 180);
  }

  function getView(): GlyphMapView {
    const o = scene.getOptions();
    return { ...view, cols: o.cols ?? view.cols, rows: o.rows ?? view.rows };
  }

  /**
   * The view/camera half of `setView` with no repaint and no event — the
   * shared state mutation an input handler, an animation frame, and the
   * public `setView` all need, so none of them can drift from the others.
   * Returns whether the span changed (which decides `"zoom"` vs `"move"`).
   */
  function applyViewState(partial: Partial<GlyphMapView>): boolean {
    const spanChanged = partial.span !== undefined && partial.span !== view.span;
    // Clamped here rather than in `setView` alone so every caller of the
    // shared mutation gets it: `setView`, `fitBounds`, a `flyTo` frame, and
    // the URL-hydrated constructor view all land covered instead of
    // letterboxed (`clampViewToCover`).
    view = clampViewToCover({ ...view, ...partial, bounds: partial.bounds });
    syncCameraToView(view);
    return spanChanged;
  }

  /**
   * A programmatic move WINS IMMEDIATELY: it cancels any inertial glide or
   * flight in place (nothing snaps — see `cancelCameraGlide`) and renders
   * synchronously, so a caller that sets a view and then reads the output
   * gets that view, never a frame of some earlier gesture still finishing.
   * Deliberately NOT queued behind, blended with, or ignored during a
   * gesture: an explicit "go here" has no useful notion of "later".
   */
  function setView(partial: Partial<GlyphMapView>): void {
    cancelCameraGlide();
    const spanChanged = applyViewState(partial);
    applyKeyLight();
    syncNearSide();
    scene.rerender();
    scheduleTileUpdate();
    emitViewChange(spanChanged ? "zoom" : "move");
  }

  /**
   * The STATE half of a pitch change: `tiltRequest`/`appliedTilt` and the
   * camera pose, no repaint and no event. Returns `true` when the projection
   * has a view-driven base orientation, i.e. when the caller still owes a
   * `syncNearSide()`.
   *
   * Split out of {@link setTilt} for the same reason `applyDragState` is
   * split out of `applyDrag`: the tilt GESTURE has to update state
   * synchronously per `pointermove` (a caller reading `getTilt()` between
   * events must not see a stale value) while the REPAINT is coalesced onto
   * the one motion loop. Two entry points, one model.
   */
  function applyTiltState(t: number): boolean {
    tiltRequest = t;
    if (!isOrbitProjection()) {
      appliedTilt = clamp(tiltRequest, -GLYPH_MAP_MAX_TILT, GLYPH_MAP_MAX_TILT);
      camera.rotX = appliedTilt;
      syncCameraBearing();
      return false;
    }
    // Re-derive rotX AND the pivot from the CURRENT view center (not the drag
    // delta path) so a tilt change composes correctly with wherever the
    // camera already is, exactly like `syncCameraToView` does on
    // `setView`/`fitBounds`.
    syncCameraToView(view);
    return true;
  }

  function setTilt(t: number): void {
    const orbit = applyTiltState(t);
    applyKeyLight();
    if (orbit) syncNearSide();
    scene.rerender();
  }

  function getTilt(): number {
    return appliedTilt;
  }

  /**
   * The STATE half of a heading change — camera matrix only, no repaint and
   * no event, so the gesture can call it per `pointermove` while the render
   * stays coalesced onto the one motion loop. Same split as
   * {@link applyTiltState}, for the same reason.
   *
   * Unlike pitch there is nothing to clamp: a heading has no ceiling, and
   * the normalization is the whole of its domain handling.
   */
  function applyBearingState(b: number): void {
    bearing = glyphMapNormalizeBearing(b);
    // WALKING, a heading is not a matrix change — it is a POSE change, and
    // this is the whole of the "it cannot be steered" defect.
    //
    // A walker's eye sits `perspective / BASE_TILE` world units BEHIND
    // `camera.target` (that is what a CSS-perspective camera IS), which at
    // the default lens is 50 metres. Installing a bearing matrix turns the
    // view axis about a target that stays put, so the EYE orbits it on a
    // 50 m circle: measured at Zurich, a 4 degree turn slid the walker
    // 3.49 m sideways through the world and a quarter turn slid them 70.7 m,
    // while `view.center` — where the map believes they are standing, and
    // where `refreshWalkGround` samples the terrain under their feet — did
    // not move at all. The next step then re-posed and snapped the eye back.
    //
    // `poseWalkCamera` derives the eye from `view.center` and puts the
    // target ahead of it, and calls `syncCameraBearing()` itself, so
    // re-posing is both the fix and the whole of it. (The orthographic
    // branch genuinely is matrix-only: it has no eye to move.)
    if (walk) { syncCameraToView(view); return; }
    syncCameraBearing();
  }

  function setBearing(b: number): void {
    applyBearingState(b);
    applyKeyLight();
    syncNearSide();
    scene.rerender();
    scheduleTileUpdate();
    emitViewChange("move");
  }

  function getBearing(): number {
    return bearing;
  }

  /**
   * Enter, reconfigure, or leave street-level WALK mode.
   *
   * `null` leaves. An options object enters (or re-resolves the options of a
   * walk already under way). Entering is REFUSED — a `RangeError` naming the
   * reason, not a silent degrade — on a projection with no
   * `cameraForCenter`/`centerForCamera`, i.e. on a flat sheet. That is not a
   * preference: a sheet puts X/Y in DEGREES and Z in Earth radii, so a 20 m
   * building on `/maps`' equirectangular sheet is drawn 85x too short
   * relative to its own footprint and is invisible from the ground. Only an
   * orbit projection is metrically isotropic, and the capability check is
   * how this file has always said "orbit" (never `projection.id`).
   *
   * Entering CAPTURES `view`, `tiltRequest`, `appliedTilt`, `bearing` and
   * `orbitRotation` verbatim and leaving puts them back — nothing is
   * recomputed. The orthographic camera is not part of that capture because
   * it does not need to be: walk mode swaps a separate perspective camera in
   * and never writes the orthographic one, so it still holds the exact pose
   * it was left at and leaving is one assignment.
   */
  function setWalk(next: GlyphMapWalkOptions | null): void {
    if (next === null) {
      if (!walk) return;
      const restore = walkRestore!;
      walk = null;
      walkRestore = null;
      walkHeldKeys.clear();
      walkRunning = false;
      walkGhost = false;
      detachWalkInput();
      view = restore.view;
      tiltRequest = restore.tiltRequest;
      appliedTilt = restore.appliedTilt;
      bearing = restore.bearing;
      orbitRotation = restore.orbitRotation;
      camera = orthographicCamera;
      scene.setOptions({ camera });
      applyKeyLight();
      syncNearSide();
      scene.rerender();
      scheduleTileUpdate();
      emitViewChange("zoom");
      return;
    }
    if (!projection.cameraForCenter || !projection.centerForCamera) {
      throw new RangeError(
        `createGlyphMap: walk mode needs a projection navigated by orbiting the camera (one declaring cameraForCenter/centerForCamera); "${projection.id}" is a flat sheet, where a metre of height and a metre of ground are different world units.`,
      );
    }
    const resolved = resolveGlyphMapWalkOptions(next);
    if (walk) {
      walk = resolved;
      view = { ...view, span: glyphMapWalkSpan(resolved.far), bounds: undefined };
      // A narrower neck can leave the live pitch outside it; `tiltFor`
      // clamps the REQUEST, so re-running the pose is the whole correction.
      appliedTilt = tiltFor(projection, view, camera.zoom, projectionGrid());
      syncCameraToView(view);
      applyKeyLight();
      syncNearSide();
      scene.rerender();
      scheduleTileUpdate();
      emitViewChange("zoom");
      return;
    }
    // A flight or a glide owns the position; a walker owns it from here.
    cancelCameraGlide();
    walkRestore = { view, tiltRequest, appliedTilt, bearing, orbitRotation };
    walk = resolved;
    if (!walkCamera) walkCamera = createGlyphPerspectiveCamera({});
    camera = walkCamera;
    scene.setOptions({ camera });
    // The walker starts looking at the horizon, facing whichever way the map
    // was already oriented — `bearing` carries over untouched, because it
    // already means the compass direction that points up the screen.
    tiltRequest = GLYPH_MAP_WALK_HORIZON_TILT_DEG;
    appliedTilt = GLYPH_MAP_WALK_HORIZON_TILT_DEG;
    attachWalkInput();
    view = { ...view, span: glyphMapWalkSpan(resolved.far), bounds: undefined };
    refreshWalkGround();
    syncCameraToView(view);
    applyKeyLight();
    syncNearSide();
    scene.rerender();
    scheduleTileUpdate();
    emitViewChange("zoom");
  }

  function getWalk(): GlyphMapWalkState | null {
    if (!walk) return null;
    return {
      ...walk,
      center: view.center,
      heading: bearing,
      pitch: appliedTilt - GLYPH_MAP_WALK_HORIZON_TILT_DEG,
      groundElevation: walkGroundElevation,
    };
  }

  /**
   * The bearing half of the orient gesture: `dxPx` pixels of HORIZONTAL
   * travel become heading, at MapLibre's own rate
   * ({@link GLYPH_MAP_BEARING_DRAG_DEG_PER_PX}) — drag right, the picture
   * turns ANTI-clockwise, so the near ground the hand is on follows the hand.
   *
   * No inertia, for the same reason the pitch half has none: there is
   * nothing physical about an angle to justify momentum, and a heading that
   * kept spinning after the hand stopped would have to be caught again.
   */

  function getMaxTilt(): number {
    // Walking, the ceiling is the neck's, and it is what `setTilt` and the
    // orient gesture both clamp to — so a UI reading this gets the bound
    // that is actually applied rather than a horizon angle nothing uses.
    if (walk) return walkTiltRange()[1];
    const grid = projectionGrid();
    return maxTiltFor(projection, view, computeZoomForSpan(view, projection, grid), grid);
  }

  /** The centre/span that frames `bounds` — shared by `fitBounds` and `flyTo({ bounds })` so the two can never frame the same box differently. */
  function framingForBounds(bounds: GlyphMapBounds): { readonly center: readonly [number, number]; readonly span: number } {
    const spanFromWidth = bounds.east - bounds.west;
    // `getView()`'s live `cols`/`rows` — the raw `view.cols`/`.rows` are
    // frozen wherever `setView` last left them (AGENTS.md's root-cause doc),
    // so this aspect ratio silently used a stale grid shape once cols/rows
    // changed live (autoSize, or a caller poking `scene.setOptions` directly).
    const { cols: liveCols, rows: liveRows } = getView();
    const spanFromHeight = (bounds.north - bounds.south) * (liveCols / liveRows);
    return {
      center: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2],
      span: Math.max(spanFromWidth, spanFromHeight),
    };
  }

  function fitBounds(bounds: GlyphMapBounds): void {
    const framed = framingForBounds(bounds);
    setView({ center: framed.center, span: framed.span });
  }

  // ── Controls: pan/orbit drag + wheel zoom ───────────────────────────

  function screenToWorldDelta(dxPx: number, dyPx: number, grid: ProjectionGrid): readonly [number, number] | null {
    const t = camera.target;
    const o = camera.project(t, grid.cols, grid.rows, grid.cellAspect, grid);
    const x = camera.project([t[0] + 1, t[1], t[2]], grid.cols, grid.rows, grid.cellAspect, grid);
    const y = camera.project([t[0], t[1] + 1, t[2]], grid.cols, grid.rows, grid.cellAspect, grid);
    const ax = (x[0] - o[0]) * grid.cellWidth, ay = (x[1] - o[1]) * grid.cellHeight;
    const bx = (y[0] - o[0]) * grid.cellWidth, by = (y[1] - o[1]) * grid.cellHeight;
    const det = ax * by - ay * bx;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;
    return [(dxPx * by - dyPx * bx) / det, (-dxPx * ay + dyPx * ax) / det];
  }

  /**
   * CSS px per world unit, PERPENDICULAR to the view (screen-plane
   * movement) — for an orthographic camera this is exactly `camera.zoom`
   * (AGENTS.md's numeric conventions: `screenPxX = worldX * zoom`,
   * isotropic in the screen plane), a constant independent of camera
   * orientation.
   *
   * The prior implementation instead measured the on-screen PROJECTED
   * LENGTH of the hard-coded WORLD Z AXIS (`camera.project([0,0,1]) -
   * camera.project([0,0,0])`) — a basis vector with no relationship to the
   * screen-plane direction actually being dragged. That length is
   * `zoom * |sin(camera.rotX)|` under `createGlyphOrthographicCamera`, which
   * goes to ZERO exactly when the view axis aligns with world Z
   * (`camera.rotX = 0 | 180`), giving `applyDrag`'s orbit branch a
   * `1 / |sin(rotX)|` sensitivity that diverges at `lat = tilt - 90` (J1,
   * AGENTS.md-adjacent bug list) — measured 140deg of latitude jump from a
   * single 5px drag at the page's default tilt. Reading `camera.zoom`
   * directly has no such singularity: it never depends on the camera's
   * current orientation at all.
   */
  function pixelsPerWorldUnit(): number {
    return camera.zoom || 1;
  }

  /**
   * A screen pixel delta, expressed in the camera's NAVIGATION frame — the
   * frame `camera.rotX`/`rotY` move in, which the heading sits on top of.
   *
   * `bearingMatrix` composes `M = RotX(tilt) * RotZ(-bearing) * E0`, and
   * `RotZ` acts on exactly the two components that become col and row, so
   * undoing it is one 2x2 rotation by `+bearing` in screen coordinates
   * (`y` DOWN, hence the plain, unmirrored matrix). Check it at 90 degrees,
   * where east is up: dragging RIGHT there has to move the centre NORTH, and
   * `(1, 0)` maps to `(0, 1)` — drag DOWN in the navigation frame, which is
   * exactly what the orbit branch already turns into a northward step.
   *
   * At bearing 0 the delta is returned UNTOUCHED rather than multiplied by a
   * `cos 0`/`sin 0` matrix: `dx * 1 - dy * 0` is only bit-identical to `dx`
   * while `dy` is finite, and more to the point the default map must not
   * take a different code path at all.
   */
  function bearingDragDelta(dxPx: number, dyPx: number): readonly [number, number] {
    if (bearing === 0) return [dxPx, dyPx];
    const t = (bearing * Math.PI) / 180;
    const c = Math.cos(t), sn = Math.sin(t);
    return [dxPx * c - dyPx * sn, dxPx * sn + dyPx * c];
  }

  /**
   * The state half of a drag: view + camera only, no repaint, no event.
   * Called synchronously per `pointermove` (state must not lag the gesture)
   * and once per frame by the inertial glide.
   */
  function applyDragState(dxPx: number, dyPx: number): void {
    const grid = projectionGrid();
    if (isOrbitProjection() && projection.cameraForCenter && projection.centerForCamera) {
      // Grab-and-drag semantics (verified against `centerForCamera`): drag
      // RIGHT must decrease centre longitude and drag DOWN must increase
      // centre latitude, so the world follows the cursor, matching the
      // sheet branch below and every other map library. `centerForCamera`
      // measures `rotY +10 -> lon +10` and `rotX +10 -> lat -10`, so both
      // increments are negated relative to the raw pixel delta.
      const degPerPx = (1 / pixelsPerWorldUnit()) * (180 / Math.PI);
      // `rotY`/`rotX` are the NAVIGATION rotation, which the heading sits on
      // top of (`bearingMatrix`: `M = RotX(tilt) * RotZ(-bearing) * E0`), so
      // the pixels have to come back through that `RotZ(-bearing)` before
      // they can be read as navigation. Without this, turning the map 90
      // degrees and dragging right pans the view NORTH: the delta would be
      // spent on the axis the screen no longer shows it on.
      const [dx, dy] = bearingDragDelta(dxPx, dyPx);
      camera.rotY -= dx * degPerPx;
      camera.rotX -= dy * degPerPx;
      // UNCLAMPED (was `clamp(trueRotX, 90 - 89.999, 90 + 89.999)`): that
      // clamp existed only to keep `centerForCamera`'s latitude away from
      // exactly ±90, where `computeZoomForSpan`'s OLD ±90-clamped meridian
      // sample degenerated to a near-zero chord (measured `camera.zoom` in
      // the millions at lat 89.99) — the J2a/J7 fix above (removing that
      // SAMPLE clamp so `computeZoomForSpan` reads a genuine, unclamped,
      // always-finite chord through and past a pole) already eliminated
      // that degeneracy (verified: `camera.zoom` is bit-stable across lat
      // 89..130 on a fixed span/tilt). With no zoom hazard left to guard
      // against, clamping `trueRotX` at the pole is a SHEET-map convention
      // with no reason to apply to an orbit projection: `centerForCamera`'s
      // own `n = (sinRotX*cosRotY, sinRotX*sinRotY, cosRotX)` parametrization
      // is exactly periodic and well-defined for ANY real `trueRotX` — going
      // PAST the pole (`trueRotX` crossing 0 or 180) is not an edge case to
      // special-case, it is the SAME rotation continuing, and it correctly
      // reflects `centerForCamera`'s returned longitude by 180deg while
      // latitude turns back down from the pole (verified:
      // `cos` is even, so `nz` — and so `lat` — is identical at `trueRotX`
      // and `-trueRotX`, while `nx`/`ny` — and so `lon` — both flip sign).
      // Clamping it froze `view.center.lat` at 89.999 and silently ate every
      // further "drag north" pixel once reached — the reported "capped at
      // zoom 0 near the pole" bug: not a zoom issue at all, an unclamp-need
      // orbit issue. `camera.rotY` (longitude) was ALREADY unclamped and
      // already periodic the same way; this makes `rotX` consistent with it
      // instead of a special case. No epsilon guard is needed in its place:
      // `centerForCamera` already clamps its OWN `asin` input to `[-1, 1]`
      // for float noise, and `Math.atan2(0, 0)` (exactly at a pole) is `0`,
      // not `NaN` — there is no live division or trig domain error here.
      const trueRotX = camera.rotX - appliedTilt;
      // The drag is the ONLY thing that can put the camera on the
      // non-canonical preimage branch (`trueRotX` outside `[0, 180]`, i.e.
      // past a pole), so it is also what has to record which branch that is
      // — `view.center` below is a 2-to-1 collapse and cannot carry it. See
      // `orbitRotation`'s own doc (J8) for what re-deriving it instead costs.
      orbitRotation = { rotX: trueRotX, rotY: camera.rotY };
      // Subtract the APPLIED pitch back out before inverting — see
      // `setTilt`'s doc: `camera.rotX` here is `trueRotX + appliedTilt`, and
      // `centerForCamera` must see `trueRotX` alone or a nonzero tilt would
      // drift `view.center`'s latitude by that many degrees on every drag.
      const center = projection.centerForCamera(trueRotX, camera.rotY);
      view = { ...view, center, bounds: undefined };
      // Re-anchor the PIVOT on the new centre, so the point the drag just
      // brought to screen centre STAYS at screen centre (`setTilt`'s model).
      // Without this the pitch would keep swinging about the surface point
      // the gesture started on, and `view.center` would walk off the grid
      // again — the same displacement, one gesture at a time.
      camera.target = projection.project(center[0], center[1], 0);
      // The pivot moved, so the axis the heading turns about moved with it.
      syncCameraBearing();
    } else {
      // NOT `bearingDragDelta` — deliberately. `screenToWorldDelta` solves
      // its basis from three probes of the LIVE `camera.project`, which
      // already carries `camera.mat`, so the sheet pan is bearing-correct
      // for free and rotating the delta first would apply the turn twice.
      const delta = screenToWorldDelta(dxPx, dyPx, grid);
      if (!delta) return;
      const t = camera.target;
      // COVER, not contain: the proposed centre is clamped in WORLD space so
      // the VISIBLE WINDOW stays inside the map's own projected extent —
      // clamping the centre into `projection.domain` (what this used to do,
      // and what the `d.west`/`d.south` clamp below is now only a backstop
      // for) stops the centre leaving the map but still lets the map's EDGE
      // come inside the viewport, showing background beyond it.
      const box = coverApplies(projection) ? projectedDomainBox(projection) : null;
      const proposed = box
        ? clampWorldToCover(t[0] - delta[0], t[1] - delta[1], box, camera.zoom, grid)
        : ([t[0] - delta[0], t[1] - delta[1]] as const);
      const result = tryUnproject(projection, [proposed[0], proposed[1], t[2]]);
      if (!result) return;
      const [lonRaw, latRaw] = result;
      const d = projection.domain;
      const lon = clamp(lonRaw, d.west, d.east);
      const lat = clamp(latRaw, d.south, d.north);
      view = { ...view, center: [lon, lat], bounds: undefined };
      camera.target = projection.project(lon, lat, 0);
      syncCameraBearing();
    }
  }

  function applyDrag(dxPx: number, dyPx: number): void {
    applyDragState(dxPx, dyPx);
    // Keep hotspot hemisphere-visibility synced to the camera THE INSTANT it
    // moves, not only once the widget's own deferred motion frame gets
    // around to it. `syncNearSide()` was previously reachable only from
    // inside `motionStep`/`setView`/etc — every one of THIS widget's own
    // render call sites. But `map.scene` is a documented escape hatch
    // (AGENTS.md) any caller may reach into directly, and `/maps` does
    // exactly that: `MapsWorkbench.tsx`'s own `pointerup` handler calls
    // `map.scene.rerender()` synchronously (to settle an `interactiveDownscale`
    // font-size change) immediately after this widget's OWN `pointerup`
    // handler has already applied the final drag delta but BEFORE the
    // deferred motion frame that would otherwise call `syncNearSide()` has
    // run. That raw `rerender()` re-stages glyphcss's own `display` from the
    // fresh camera (so an on-grid-but-far-side symbol becomes `display: ""`)
    // but never touches `opacity`/`visibility` — the channels `syncNearSide()`
    // owns — so a symbol crossed to the far side by THIS drag increment
    // stayed visibly shown at its stale near-side opacity until the next
    // motion frame corrected it: a one-frame flicker on every release into
    // an inertial glide. Calling it here, synchronously, closes that window
    // for ANY external caller, not just this one — the DOM is never more
    // than one drag increment stale.
    //
    // The DOM half ONLY: a scene write from an input handler arms a render
    // that the deferred frame cannot supersede, which is one full grid render
    // per pointer event (see `nearSideGeometrySyncs`). The wall cull rides the
    // frame, where it is free.
    syncNearSideDom();
    markMotionDirty();
    emitViewChange("move");
  }

  /**
   * The orient gesture's per-`pointermove` step. VERTICAL travel becomes
   * pitch — drag UP and the camera lifts off the surface — and HORIZONTAL
   * travel becomes heading — drag RIGHT and the picture turns ANTI-clockwise.
   * Both halves obey the same rule: the NEAR ground, the part of the picture
   * the hand is actually on under a pitch, follows the hand
   * ({@link GLYPH_MAP_BEARING_DRAG_DEG_PER_PX} carries the full argument).
   *
   * Both axes in ONE call, not two, so a diagonal stroke costs one
   * `syncNearSide()` sweep and emits one `move` per pointer event rather than
   * two of each. The heading is applied second on purpose: `applyTiltState`'s
   * orbit branch re-poses the whole camera through `syncCameraToView`, so a
   * heading written first would simply be rebuilt from that new pose anyway.
   *
   * The PITCH delta accumulates from `appliedTilt`, NOT from `tiltRequest`. The two
   * differ only where the request is above the view's own ceiling, and
   * accumulating from the request there would give the gesture DEAD TRAVEL:
   * at a whole-world span (ceiling ~21) a request left at 85 by a close-in
   * gesture would need 128px of downward drag before the picture moved at
   * all. Reading the applied pitch makes the gesture relative to what the
   * reader can actually see, which is what a direct-manipulation control has
   * to be. The remembered-request behaviour is untouched everywhere it is
   * observable — a zoom out never rewrites `tiltRequest`, so a pitch asked
   * for close in still survives the trip out and back
   * (`widget.tiltGesture.test.ts`). The HEADING has no such split: there is
   * no ceiling to clamp it against, so the request and the applied value are
   * the same number.
   */
  function applyOrientDrag(dxPx: number, dyPx: number): void {
    // An explicit orientation change takes over from a glide or a flight in
    // place, exactly as a pan or a wheel notch does.
    cancelCameraGlide();
    // WALKING, a drag is a LOOK and takes the first-person path: both axes
    // at the first-person rate, one re-pose, and — the part the orbit
    // branch below cannot give — an eye that does not move. This is the
    // fallback look model, for the pointers pointer lock cannot serve
    // (touch, and any mouse whose lock request was refused); a locked mouse
    // never reaches here, because `onPointerMove` stands down while the
    // lock is held.
    if (walk) { applyWalkLook(dxPx, dyPx, GLYPH_MAP_WALK_DRAG_DEG_PER_PX); return; }
    let orbit = false;
    if (dyPx !== 0) {
      orbit = applyTiltState(clamp(appliedTilt - dyPx * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, -GLYPH_MAP_MAX_TILT, GLYPH_MAP_MAX_TILT));
    }
    // The heading is applied AFTER the pitch, on the pose the pitch installed
    // — `applyTiltState`'s orbit branch re-derives the whole camera through
    // `syncCameraToView`, which would otherwise rebuild the matrix and then
    // have it rebuilt again from a heading that had already changed.
    if (dxPx !== 0) {
      applyBearingState(bearing + dxPx * GLYPH_MAP_BEARING_DRAG_DEG_PER_PX);
      orbit = true;
    }
    if (!orbit && dxPx === 0 && dyPx === 0) return;
    // The camera turned, so the near/far hemisphere verdict every marker and
    // symbol carries is now one increment stale — the same window `applyDrag`
    // closes here rather than at the deferred motion frame, and for the same
    // reason (`map.scene` is a documented escape hatch a host may repaint
    // through at any time). ONE sweep and ONE event for the whole stroke
    // increment, not one per axis. DOM channels only, for the reason
    // `applyDrag` states — an input handler must never write to the scene.
    if (orbit) syncNearSideDom();
    markMotionDirty();
    emitViewChange("move");
  }

  /**
   * A macOS trackpad emits 60-120 wheel events/s including the inertial
   * tail, so a flick can queue far more render work than one animation frame
   * can retire. The span still moves synchronously per event — `getView()`
   * must not lag the gesture, and the wheel-step tests read it immediately —
   * while the REPAINT is coalesced onto the shared motion loop, so a burst
   * of wheel events inside one displayed frame costs exactly one render.
   *
   * The span is applied outright rather than eased toward a target: an eased
   * `view.span` would make `getView().span` disagree with the gesture the
   * caller just made and would feed tile LOD a value the user never asked
   * for. The smoothness comes from frame coalescing, not from lag.
   */
  function applyWheel(deltaY: number, deltaMode: number): void {
    // Walking, `view.span` DESCRIBES the horizon footprint rather than
    // controlling the framing (the lens does that), so a wheel notch would
    // silently resize the tile budget and change nothing on screen. It is a
    // no-op, not a re-purposed FOV control: a walker's field of view is not
    // a thing a scroll wheel should be able to distort.
    if (walk) return;
    const normalized = glyphMapNormalizeWheelDelta(deltaY, deltaMode);
    // An explicit zoom takes over from a glide or a flight in place.
    cancelCameraGlide();
    view = clampViewToCover({ ...view, span: clamp(view.span * Math.exp(GLYPH_MAP_WHEEL_ZOOM_K * normalized), minSpan, maxViewSpan()), bounds: undefined });
    syncCameraToView(view);
    markMotionDirty();
    emitViewChange("zoom");
  }

  let activePointerId: number | null = null;
  let lastClientX = 0, lastClientY = 0;
  let lastMoveTime = 0;
  let dragTotalPx = 0;
  let didDrag = false;
  /**
   * Which gesture the live pointer is driving. Decided ONCE at
   * `pointerdown` from the modifier/button then held for the whole gesture:
   * a reader who releases Ctrl mid-drag is still pitching, not suddenly
   * panning the map out from under the stroke.
   */
  let gestureMode: "pan" | "tilt" = "pan";

  /**
   * Ctrl+drag and right-button drag pitch the camera. This is the binding
   * Google Maps, Mapbox and MapLibre all converged on, so it is the one
   * hands already have. On macOS Ctrl+click IS the secondary click, so the
   * two conditions are the same gesture arriving under two names and both
   * have to be accepted.
   */
  function isTiltGesture(e: PointerEvent): boolean {
    return controlsTilt && (e.ctrlKey || e.button === 2);
  }

  function onPointerDown(e: PointerEvent): void {
    if (activePointerId !== null) return;
    const tilting = isTiltGesture(e);
    if (!tilting && !controlsDrag) return;
    // Walking, there is no pan: dragging the ground out from under a walker
    // is not a thing a first-person view can mean. Every drag is a LOOK, so
    // it takes the orient path the Ctrl/right-drag gesture already uses.
    gestureMode = (tilting || walk !== null) ? "tilt" : "pan";
    // Mouselook, from `pointerdown` rather than `click` — see the walk
    // mouselook block for the parthenon's own account of why `click` never
    // arrives on a `<pre>` that is rewritten every render. The drag path is
    // still armed below on purpose: it is what steers when the lock request
    // is refused, and it costs nothing when the lock is granted (a locked
    // pointer's moves are stood down in `onPointerMove`).
    if (walk && e.pointerType === "mouse" && !walkPointerLocked) {
      try { host.requestPointerLock(); } catch { /* a refused lock leaves drag-to-look */ }
    }
    // Suppress the compatibility mousedown a tilt gesture would otherwise
    // produce, which starts a text selection over the <pre> and (with the
    // right button) primes a native drag. The pan path is left alone: it has
    // never needed this, and `.glyph-output`'s own `user-select: none`
    // already covers it.
    if (tilting) e.preventDefault();
    // Grabbing the map stops it dead, from wherever it currently is.
    cancelCameraGlide();
    activePointerId = e.pointerId;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    lastMoveTime = 0;
    dragTotalPx = 0;
    didDrag = false;
    // Capture on the stable host, NOT e.target — colored output rewrites
    // the <pre> innerHTML each render, destroying a captured child and
    // dropping the gesture mid-drag (absorbed from both example pages).
    try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(e: PointerEvent): void {
    // Under pointer lock the browser keeps dispatching pointermove alongside
    // the mousemove mouselook reads, so without this a locked mouse would
    // steer twice per event — once at the locked rate and once at the drag
    // rate.
    if (walkPointerLocked) return;
    if (activePointerId !== e.pointerId) return;
    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    dragTotalPx += Math.abs(dx) + Math.abs(dy);
    if (dragTotalPx > 3) didDrag = true;
    if (gestureMode === "tilt") {
      // No fling velocity is accumulated: neither angle has inertia. A camera
      // that kept pitching after the hand stopped would coast straight into
      // the horizon ceiling and sit there, and there is nothing physical
      // about an angle to justify the momentum in the first place.
      //
      // BOTH axes of the stroke are live at once — vertical pitches,
      // horizontal turns — rather than the gesture committing to one of them
      // at `pointerdown`. That is what every map with this binding does, and
      // it is the only way a reader can compose "look across it and turn it"
      // in one movement; an axis lock would make a slightly-off-vertical
      // pitch silently refuse to turn.
      applyOrientDrag(dx, dy);
      scheduleTileUpdate();
      return;
    }
    // Fling velocity, exponentially smoothed in px/ms so one jittery sample
    // can't launch the camera. `now - lastMoveTime` is floored at one frame:
    // two pointer events in the same millisecond would otherwise divide by
    // ~0 and report an enormous velocity.
    const now = nowMs();
    if (lastMoveTime > 0) {
      const dt = Math.max(4, now - lastMoveTime);
      const mix = GLYPH_MAP_GLIDE_VELOCITY_MIX;
      glideVx = glideVx * (1 - mix) + (dx / dt) * mix;
      glideVy = glideVy * (1 - mix) + (dy / dt) * mix;
    }
    lastMoveTime = now;
    applyDrag(dx, dy);
    // Same self-healing debounce `onWheel` already relies on: each call
    // re-arms `scheduleTileUpdate`'s 180ms timer, so a live drag never
    // churns tiles (every move defers the fetch again) but genuinely
    // settles 180ms after the LAST move — including a drag that never
    // sees `pointerup`/`pointercancel` (lost capture, an interrupted
    // gesture) since it no longer depends on that event firing at all.
    // With inertia the glide keeps re-arming it too, so "settled" means
    // motion actually stopped, not "the pointer went up".
    scheduleTileUpdate();
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    try { host.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (gestureMode === "tilt") {
      // A secondary/modified press is not a map click and never flings: both
      // of the branches below belong to the pan gesture only.
      gestureMode = "pan";
      didDrag = false;
      glideVx = 0; glideVy = 0;
      scheduleTileUpdate();
      return;
    }
    if (!didDrag) {
      const outputRect = scene.output.getBoundingClientRect();
      const grid = projectionGrid();
      let lngLat: readonly [number, number] | null = null;
      if (outputRect.width > 0 && outputRect.height > 0) {
        const col = (e.clientX - outputRect.left) / grid.cellWidth;
        const row = (e.clientY - outputRect.top) / grid.cellHeight;
        lngLat = unproject([col, row]);
      }
      emit({ type: "click", lngLat, originalEvent: e });
    }
    // Release into an inertial glide when the gesture was actually moving.
    // A stale velocity from a drag that PAUSED before release must not fling:
    // if the last move is older than a couple of frames, there is no throw.
    const sinceLastMove = lastMoveTime > 0 ? nowMs() - lastMoveTime : Infinity;
    const speed = Math.hypot(glideVx, glideVy);
    if (didDrag && controlsDrag && sinceLastMove <= 60 && speed > GLYPH_MAP_GLIDE_MIN_PX_PER_MS
      && typeof requestAnimationFrame !== "undefined") {
      const cap = Math.min(1, GLYPH_MAP_GLIDE_MAX_PX_PER_MS / speed);
      glideVx *= cap; glideVy *= cap;
      gliding = true;
      requestMotionFrame();
    } else {
      glideVx = 0; glideVy = 0;
    }
    didDrag = false;
    scheduleTileUpdate();
  }

  // THE WIDGET OWNS THE GESTURE (P1 "a1" fix): the widget never called
  // `scene.setInteracting()` for any gesture, so a wheel-zoom render never
  // engaged glyphcss's own `interactiveDownscale` mechanism regardless of
  // whether the host page configured it. `onWheel` now drives it directly,
  // settling back to full detail on a short timer — the SAME 180ms
  // `scheduleTileUpdate` already debounces on, kept as its own timer (not
  // reused) so a concurrent drag gesture's own `setInteracting` calls can't
  // race this one into settling early.
  let wheelInteractingTimer: ReturnType<typeof setTimeout> | null = null;
  function onWheel(e: WheelEvent): void {
    if (!controlsWheel) return;
    e.preventDefault();
    scene.setInteracting(true);
    if (wheelInteractingTimer !== null) clearTimeout(wheelInteractingTimer);
    wheelInteractingTimer = setTimeout(() => {
      wheelInteractingTimer = null;
      scene.setInteracting(false);
    }, 180);
    applyWheel(e.deltaY, e.deltaMode);
    scheduleTileUpdate();
  }

  /**
   * The right button drives the pitch gesture, so the native menu it would
   * otherwise raise has to go — it appears on `mousedown` on some platforms,
   * i.e. before the drag has moved a single pixel, which would make the
   * gesture unusable rather than merely untidy. Suppressed for the whole
   * host whenever the gesture is enabled (Mapbox and MapLibre both do
   * exactly this on their canvas); `controls: { tilt: false }` gives the
   * menu back along with the gesture.
   */
  function onContextMenu(e: Event): void {
    if (!controlsTilt) return;
    e.preventDefault();
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("contextmenu", onContextMenu);
  // On the OWNER DOCUMENT, not the host: a `<div>` takes no keyboard focus
  // without a `tabindex` this widget has no business adding to a caller's
  // element, and a walker who has just clicked the map to look around should
  // not then have to click it again to walk. Both handlers no-op outright
  // while `walk` is null, so a map that never walks pays two dead listeners
  // and nothing else.
  const keyTarget: EventTarget = host.ownerDocument ?? host;
  keyTarget.addEventListener("keydown", onKeyDown as EventListener);
  keyTarget.addEventListener("keyup", onKeyUp as EventListener);
  const blurTarget: EventTarget | null = host.ownerDocument?.defaultView ?? null;
  blurTarget?.addEventListener("blur", onWalkBlur);

  // ── Initial mount ─────────────────────────────────────────────────────

  // A view can arrive from anywhere — a shared link's URL state, a saved
  // preset, a caller's own arithmetic — so the constructor's own view is
  // clamped on READ exactly like every later mutation, rather than rendering
  // one letterboxed frame that only a first gesture would correct.
  view = clampViewToCover(view);
  syncCameraToView(view);
  // `"fixed"` (the default) writes nothing here, so a map that never asks
  // for a headlight is byte-identical to before this option existed.
  applyKeyLight();
  scene.rerender();
  for (const layer of opts.layers ?? []) addLayer(layer);
  // A sun requested at construction installs its hook, starts its timer and
  // resolves its first position now — never one tick late. `"off"` (the
  // default) touches nothing at all, which is what keeps a sun-less map
  // byte-identical to before this option existed.
  if (sunMode !== "off") {
    syncStrokeHookInstalled();
    syncSunTimer();
    applySun();
  }
  void Promise.allSettled(initialLoadPromises).then(() => {
    mapLoaded = true;
    emit({ type: "load" });
  });

  /**
   * `map.scene` is a documented escape hatch: a host may repaint through it at
   * ANY time, including between two `pointermove`s of a drag this widget has
   * only deferred the render for. `syncNearSideGeometry` — a `fill-extrusion`'s
   * far-side wall cull — is the one near-side verdict baked into scene
   * GEOMETRY rather than into a DOM channel, so an out-of-band repaint has to
   * see the cull for the camera it is repainting, not the one from the last
   * frame (`widget.extrusionWalls.test.ts` pins exactly that: one
   * `pointermove` across the limb, no frame awaited, then a raw
   * `scene.rerender()`).
   *
   * Running that sweep from the pointer handler instead is what this proxy
   * replaces, and it was expensive out of all proportion: a scene write arms a
   * microtask render, that checkpoint drains at the end of EVERY task, and a
   * trackpad delivers 60-120 pointer events a second — so a drag over a city
   * with buildings mounted rasterized the whole scene once per EVENT (measured
   * on /maps at street level: 2.98 renders per displayed frame, 11.8 fps).
   * Here the sweep runs immediately before `doRender()`, where `rerender()`
   * supersedes whatever it armed and it therefore costs nothing.
   *
   * A host that repaints through `setOptions` rather than `rerender` still
   * gets the previous frame's cull; that is one drag increment of a
   * conservative visibility test, and it is not what any caller here does.
   */
  const publicScene = new Proxy(scene, {
    get(target, key, receiver) {
      if (key === "rerender") {
        return () => { syncNearSideGeometry(); target.rerender(); };
      }
      return Reflect.get(target, key, receiver);
    },
  });

  return {
    host,
    scene: publicScene,
    setView,
    getView,
    fitBounds,
    setTilt,
    getTilt,
    getMaxTilt,
    setBearing,
    getBearing,
    setWalk,
    getWalk,
    setSun,
    getSun: () => ({
      mode: sunMode,
      date: sunManualAt,
      tickMs: sunTickMs,
      twilightDeg: sunTwilightDeg,
      nightOpacity: sunNightOpacity,
      nightColor: sunNightColor,
      nightLevels: sunNightLevels,
    }),
    getSunDirection: () => sunDirection(),
    setKeyLight,
    getKeyLight: () => keyLightMode,
    getKeyLightDirection: () => keyLightDirection(),
    setShadow,
    getShadow: () => shadow,
    getSubsolarPoint: () => (sunMode === "off" ? null : glyphMapSubsolarPoint(sunAt())),
    setProjection,
    flyTo,
    project,
    unproject,
    addLayer,
    removeLayer,
    moveLayer,
    getAttributions,
    getContourFieldRange,
    addMarker,
    on(type, handler) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(handler as GlyphMapEventHandler<GlyphMapEvent>);
    },
    off(type, handler) {
      listeners.get(type)?.delete(handler as GlyphMapEventHandler<GlyphMapEvent>);
    },
    getMaxSpan: () => maxViewSpan(),
    resize(): void {
      scene.fit();
      // The host's SHAPE decides which axis binds the cover limit, so a
      // resize can make the current span (or centre) illegal — re-clamp
      // before re-syncing rather than waiting for the next gesture.
      view = clampViewToCover(view);
      syncCameraToView(view);
      applyKeyLight();
      syncNearSide();
      scene.rerender();
      scheduleTileUpdate();
    },
    destroy(): void {
      destroyed = true;
      // Every in-flight animation resolves rather than hanging a caller
      // awaiting `flyTo`/`setProjection` on a widget that is going away.
      cancelCameraGlide();
      if (projectionAnim) { const prev = projectionAnim; projectionAnim = null; prev.settle(); }
      cancelMotionFrame();
      if (sunTimer !== null) { clearInterval(sunTimer); sunTimer = null; }
      if (tileUpdateTimer !== null) clearTimeout(tileUpdateTimer);
      if (wheelInteractingTimer !== null) clearTimeout(wheelInteractingTimer);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("contextmenu", onContextMenu);
      keyTarget.removeEventListener("keydown", onKeyDown as EventListener);
      keyTarget.removeEventListener("keyup", onKeyUp as EventListener);
      blurTarget?.removeEventListener("blur", onWalkBlur);
      detachWalkInput();
      for (const state of layerStates.values()) {
        if (state.kind === "raster" || state.kind === "line" || state.kind === "contour") state.runtime.dispose();
      }
      layerStates.clear();
      layerOrder.length = 0;
      nearSideSyncs.clear();
      listeners.clear();
      scene.destroy();
    },
  };
}
