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
 * to pick orbit-drag over pan-drag; zoom range is derived from
 * `projection.domain`'s own width. Every one of these is a capability check
 * on the interface, never an `if (projection.id === "glyph-map-globe")`.
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

import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import type {
  CellGrid,
  GlyphCamera,
  GlyphHotspotHandle,
  GlyphMeshHandle,
  GlyphSceneHandle,
  GlyphSceneOptions,
  TransformCells,
  Vec3,
} from "glyphcss";
import type { GlyphMapAttribution, GlyphMapBounds, GlyphMapClassifier, GlyphMapField, GlyphMapView } from "./types";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import { splitGlyphMapGeoTileAtAntimeridian } from "./tile";
import { glyphMapPolygons } from "./mesh";
import type { GlyphMapProvider } from "./provider";
import { glyphMapDegreesPerCell, glyphMapTargetLOD } from "./provider";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorSource } from "./vector/types";
import { glyphMapFieldValueAt } from "./sample";
import { stampGlyphMapContour, stampGlyphMapPolyline, type GlyphMapStrokeVertex } from "./stroke";
import { glyphMapDedupeAttributions } from "./attribution";

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
  /** Screen-space padding (output cells) a provider tile's bounds must be within to stay mounted — absorbed from both pages' "pad by a tile diagonal so tiles straddling the edge load before they pop in". Default `2`. Ignored for a static (non-provider) source. */
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
}

function isGlyphMapVectorProvider(source: GlyphMapVectorSource): source is GlyphMapVectorProvider {
  return typeof (source as GlyphMapVectorProvider).loadTile === "function";
}

/**
 * A stroke layer (MAPS.md §13 slice 5): country/subdivision borders, roads,
 * rivers, routes. `source` mirrors `GlyphMapRasterLayer.source`'s
 * static-vs-provider split — a single in-memory `GlyphMapVectorFeatureCollection`
 * or a tiled `GlyphMapVectorProvider` (`vector/types.ts`), mounted/unmounted
 * per visible LOD tile exactly like a raster layer's own tile loop.
 * Rendered by post-raster stamping (`stroke.ts`'s `stampGlyphMapPolyline`)
 * into the scene's `transformCells` hook — see `stroke.ts`'s doc for why
 * that mechanism was chosen over `compileScene`.
 */
export interface GlyphMapLineLayer {
  readonly type: "line";
  readonly id?: string;
  readonly source: GlyphMapVectorSource;
  readonly color?: string;
  /** Screen-space padding (output cells) a provider tile's bounds must be within to stay mounted. Default `2`. Ignored for a static (non-provider) source. */
  readonly padCells?: number;
  /**
   * NOT YET IMPLEMENTED — reserved so a future implementation is additive,
   * not a breaking rename (AGENTS.md's no-BC-shims rule cuts the other way
   * once a name ships). A stroke layer is stamped into the SHARED base
   * `CellGrid` post-raster (`stroke.ts`'s doc); giving it its own resolution
   * needs its own detail `<pre>` with its own projected geometry and its
   * own occlusion sampling against the base grid — real work, not a
   * passthrough like {@link GlyphMapRasterLayer.density}'s mesh-transform
   * wiring. `createGlyphMap` THROWS at `addLayer` time for any value other
   * than `1`/`undefined`, rather than silently ignoring it.
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
 * Converts a provider's elevation tile (vertex-centered, `(cols+1)x(rows+1)`)
 * into a cell-centered `GlyphMapField` by averaging each quad's 4 corners —
 * absorbed from the website's own `loadContourField` (MapsWorkbench), moved
 * here so `scheduleTileUpdate`'s existing provider-refresh mechanism can
 * drive it directly instead of every consumer re-deriving fields by hand.
 */
/** The `z/x/y` a view resolves to — exposed so a caller can skip a re-fetch when panning hasn't actually crossed into a new tile. */
function glyphMapContourTileKey(provider: GlyphMapProvider, v: GlyphMapView): { readonly z: number; readonly x: number; readonly y: number; readonly key: string } {
  const degPerCell = glyphMapDegreesPerCell(v);
  const z = glyphMapTargetLOD(provider, degPerCell);
  const level = provider.zooms.find((lvl) => lvl.z === z)!;
  const x = Math.min(level.cols - 1, Math.max(0, Math.floor((v.center[0] + 180) / level.tileLonSpan)));
  const y = Math.min(level.rows - 1, Math.max(0, Math.floor((90 - v.center[1]) / level.tileLatSpan)));
  return { z, x, y, key: `${z}/${x}_${y}` };
}

async function loadGlyphMapContourField(provider: GlyphMapProvider, z: number, x: number, y: number): Promise<GlyphMapField> {
  const tile = await provider.loadTile(z, x, y);
  const cols = tile.cols;
  const rows = tile.rows;
  const values = new Float32Array(cols * rows);
  const vcols = cols + 1;
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = tile.elevation[row * vcols + col];
      const b = tile.elevation[row * vcols + col + 1];
      const c = tile.elevation[(row + 1) * vcols + col];
      const d = tile.elevation[(row + 1) * vcols + col + 1];
      const value = (a + b + c + d) / 4;
      values[row * cols + col] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return { bounds: tile.bounds, cols, rows, values, noData: new Uint8Array(cols * rows), kind: "continuous", min, max };
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
  readonly color?: string;
  /** NOT YET IMPLEMENTED — see {@link GlyphMapLineLayer.density}'s doc; the same stamped-into-the-shared-grid constraint applies here. Throws at `addLayer` time for any value other than `1`/`undefined`. */
  readonly density?: number;
}

/** Every multiple of `interval` strictly between `min` and `max` (both exclusive, matching the `N`-count variant's own "never a line along the field's own edge" convention). Exported so a caller (e.g. a UI readout) can preview the level COUNT an `{ interval }` value will produce without re-deriving this math. */
export function glyphMapContourIntervalLevels(interval: number, min: number, max: number): readonly number[] {
  if (!(interval > 0)) throw new RangeError(`glyphcss/maps: contour "levels.interval" must be > 0 (got ${interval}).`);
  const first = Math.floor(min / interval) * interval + interval;
  const out: number[] = [];
  for (let v = first; v < max; v += interval) out.push(v);
  return out;
}

export type GlyphMapLayer = GlyphMapBackgroundLayer | GlyphMapRasterLayer | GlyphMapLineLayer | GlyphMapContourLayer;

/** A layer kind whose rendering is post-raster CellGrid stamping rather than mesh mounting — composed into ONE `transformCells` hook (see `createGlyphMap`'s "stroke layers" section). */
interface StrokeLayerRuntime {
  update(): Promise<void>;
  stamp(grid: CellGrid): void;
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

export type GlyphMapEvent = GlyphMapClickEvent | GlyphMapViewEvent | GlyphMapLoadEvent;
export type GlyphMapEventHandler<E extends GlyphMapEvent = GlyphMapEvent> = (event: E) => void;

// ── project()/unproject() ─────────────────────────────────────────────

export interface GlyphMapProjectResult {
  readonly col: number;
  readonly row: number;
  /** Front-hemisphere per `projection.visible` (always `true` for a flat projection, which excludes an invisible point via `project()` returning `NaN`), AND within the output grid. */
  readonly visible: boolean;
}

// ── Options / handle ───────────────────────────────────────────────────

export interface GlyphMapOptions {
  readonly view: GlyphMapView;
  readonly projection: GlyphMapProjection;
  readonly layers?: readonly GlyphMapLayer[];
  readonly controls?: { readonly drag?: boolean; readonly wheel?: boolean };
  /** Forwarded to the underlying `createGlyphScene` as-is. Default `false` — `view.cols`/`view.rows` are the authoritative grid (MAPS.md §3b: the view, not host pixels, owns the grid shape); `true` lets host resize drive `cols`/`rows` the way both example pages did. */
  readonly autoSize?: boolean;
  /** Smallest `view.span` (degrees) reachable by wheel-zoom or `setView`. Default `0.001`. */
  readonly minSpan?: number;
  /**
   * Camera pitch, degrees. Meaning is unified across both navigation modes
   * as "additional rotation on top of whatever the projection's own base
   * orientation is" — a SHEET projection (no `cameraForCenter`) has no
   * view-driven base orientation, so `tilt` there IS the total `camera.rotX`
   * (default `40`, unchanged from before this option applied to orbit too).
   * An ORBIT projection (the globe) has a view-driven base orientation —
   * `cameraForCenter(lon, lat)` — that `tilt` now ADDS to (default `0`,
   * i.e. head-on, byte-identical to every render before this option applied
   * here): see {@link GlyphMapHandle.setTilt} for why this is coherent
   * rather than aliasing `view.center` (drag/pan subtracts `tilt` back out
   * before calling `centerForCamera`, so the reported center is unaffected
   * by a nonzero tilt).
   */
  readonly tilt?: number;
  /** Forwarded to `createGlyphScene`, merged UNDER the widget's own `camera`/`cols`/`rows`/`autoSize` — this is how shading, `colorEncoding`, shadows, etc. compose (MAPS.md §9: "no new scene concepts"). */
  readonly scene?: Partial<GlyphSceneOptions>;
}

export interface GlyphMapHandle {
  readonly host: HTMLElement;
  /** The underlying scene this widget owns. Escape hatch for anything not modeled above (mesh finders, effect layers, direct camera reads). */
  readonly scene: GlyphSceneHandle;
  setView(view: Partial<GlyphMapView>): void;
  getView(): GlyphMapView;
  fitBounds(bounds: GlyphMapBounds): void;
  /**
   * Live camera pitch — see {@link GlyphMapOptions.tilt} for the unified
   * meaning. Works for both sheet and orbit (globe) projections: for a
   * sheet this sets `camera.rotX` directly (the same escape hatch the
   * website used before this existed); for the globe it stores an offset
   * added on top of `cameraForCenter(lon, lat)` every time the camera is
   * re-synced (`setView`/`fitBounds`/`resize`), and `applyDrag`'s orbit
   * branch subtracts it back out before calling `centerForCamera` — so
   * `view.center` (and anything derived from it: markers, `fitBounds`,
   * tile LOD) is never contaminated by a nonzero tilt. There is no third
   * rotational degree of freedom being invented here: composing an extra
   * `rotateX(tilt)` after `cameraForCenter`'s own rotation is mathematically
   * identical to shifting `rotX` by `tilt` (both rotations share the same
   * post-`rotY` local X axis, and rotations about one axis commute/add —
   * `rotateVec3Voxcss` in glyphcss's camera, `packages/glyphcss/src/api/
   * createGlyphCamera.ts`). What makes this a GENUINE "pitch independent of
   * `view.center`" rather than just "silently re-centering at a different
   * latitude" is bookkeeping: the widget keeps `tilt` and the true
   * view-driven `rotX` separate and only ever composes them at the render
   * boundary, so every public read of `view.center` stays exactly what the
   * caller asked for.
   */
  setTilt(tilt: number): void;
  getTilt(): number;
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

export function createGlyphMap(host: HTMLElement, opts: GlyphMapOptions): GlyphMapHandle {
  const projection = opts.projection;
  const minSpan = opts.minSpan ?? 0.001;
  const controlsDrag = opts.controls?.drag ?? true;
  const controlsWheel = opts.controls?.wheel ?? true;
  const isOrbitProjection = !!(projection.cameraForCenter && projection.centerForCamera);

  let view: GlyphMapView = opts.view;
  let tilt = opts.tilt ?? (isOrbitProjection ? 0 : 40);

  const camera: GlyphCamera = createGlyphOrthographicCamera({ zoom: 1 });
  if (!isOrbitProjection) {
    camera.rotX = tilt;
    camera.rotY = 0;
  }

  const sceneOverrides = opts.scene ?? {};
  const scene: GlyphSceneHandle = createGlyphScene(host, {
    mode: "solid",
    useColors: true,
    ...sceneOverrides,
    camera,
    cols: view.cols,
    rows: view.rows,
    autoSize: opts.autoSize ?? false,
  });

  // ── Screen-space geometry (absorbed from both pages' identical helper) ──

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
   * is), and rendered nothing when `0_0` wasn't it. The fix is a cheap,
   * projection-agnostic complement: the view's own geographic CENTRE always
   * projects to dead-centre of the viewport by construction, so a tile
   * containing it is trivially visible with no projection call at all.
   * `±360` on the longitude covers a view centred just past the
   * antimeridian against an "unwrapped" tile bounds box (the convention
   * `splitGlyphMapGeoTileAtAntimeridian` documents).
   */
  function isBoundsVisible(bounds: GlyphMapBounds, padCells: number): boolean {
    const [centerLon, centerLat] = view.center;
    if (centerLat >= bounds.south && centerLat <= bounds.north) {
      for (const lon of [centerLon, centerLon + 360, centerLon - 360]) {
        if (lon >= bounds.west && lon <= bounds.east) return true;
      }
    }
    const grid = projectionGrid();
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

  function computeZoomForSpan(v: GlyphMapView): number {
    const [lon, lat] = v.center;
    const domainWidth = Math.min(360, projection.domain.east - projection.domain.west) || 360;
    const halfSpanDeg = clamp(v.span, 1e-6, domainWidth) / 2;
    const centerWorld = projection.project(lon, lat, 0);
    const worldSpanOf = (edgeLon: number): number => {
      const edge = projection.project(edgeLon, lat, 0);
      if (!Number.isFinite(edge[0])) return 0;
      return Math.hypot(edge[0] - centerWorld[0], edge[1] - centerWorld[1], edge[2] - centerWorld[2]);
    };
    let halfWorldSpan = worldSpanOf(lon + halfSpanDeg);
    if (!(halfWorldSpan > 1e-9)) halfWorldSpan = worldSpanOf(lon - halfSpanDeg);
    if (!(halfWorldSpan > 1e-9)) halfWorldSpan = 1e-6;
    const grid = projectionGrid();
    return (v.cols * grid.cellWidth) / (halfWorldSpan * 2);
  }

  function syncCameraToView(v: GlyphMapView): void {
    const [lon, lat] = v.center;
    if (projection.cameraForCenter) {
      const { rotX, rotY } = projection.cameraForCenter(lon, lat);
      camera.rotX = rotX + tilt;
      camera.rotY = rotY;
      camera.target = [0, 0, 0];
    } else {
      camera.target = projection.project(lon, lat, 0);
    }
    camera.zoom = computeZoomForSpan(v);
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
      && (!projection.visible || projection.visible(world, (w) => depthOf(w, grid)))
      && col >= 0 && col <= grid.cols && row >= 0 && row <= grid.rows;
    return { col, row, visible };
  }

  function unprojectSheet(col: number, row: number, grid: ProjectionGrid): readonly [number, number] | null {
    const o = camera.project([0, 0, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const ux = camera.project([1, 0, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const uy = camera.project([0, 1, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const ax = ux[0] - o[0], ay = ux[1] - o[1];
    const bx = uy[0] - o[0], by = uy[1] - o[1];
    const det = ax * by - ay * bx;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
    const dc = col - o[0], dr = row - o[1];
    const wx = (by * dc - bx * dr) / det;
    const wy = (-ay * dc + ax * dr) / det;
    const [lon, lat] = projection.unproject([wx, wy, 0]);
    const d = projection.domain;
    if (lon < d.west - 1e-6 || lon > d.east + 1e-6 || lat < d.south - 1e-6 || lat > d.north + 1e-6) return null;
    return [lon, lat];
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
      lat = clamp(lat + dLat, -89.999, 89.999);
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
    if (projection.visible && !projection.visible(world, (w) => depthOf(w, grid))) return null;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return [lon, lat];
  }

  function unproject(cell: readonly [number, number]): readonly [number, number] | null {
    const grid = projectionGrid();
    return isOrbitProjection ? unprojectSphere(cell[0], cell[1], grid) : unprojectSheet(cell[0], cell[1], grid);
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

  const markerSyncs = new Set<() => void>();
  function syncMarkers(): void {
    for (const sync of markerSyncs) sync();
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
        && (!projection.visible || projection.visible(world, (w) => depthOf(w, grid)));
      hotspot.el.style.display = visible ? "" : "none";
    }
    sync();
    markerSyncs.add(sync);
    return {
      el: hotspot.el,
      remove(): void {
        markerSyncs.delete(sync);
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
    dispose(): void;
  }

  function createRasterLayerRuntime(layer: GlyphMapRasterLayer): RasterLayerRuntime {
    const color = colorForLayer(layer);
    let staticHandles: GlyphMeshHandle[] = [];
    const tileCache = new Map<string, GlyphMapGeoTile>();
    const activeHandles = new Map<string, GlyphMeshHandle[]>();
    let updateInFlight = false;
    let updateQueued = false;

    function mountTile(tile: GlyphMapGeoTile): GlyphMeshHandle[] {
      return splitGlyphMapGeoTileAtAntimeridian(tile).map((part) =>
        scene.add(glyphMapPolygons(part, projection, { color }), layer.density !== undefined ? { density: layer.density } : {}),
      );
    }

    function disposeMeshes(): void {
      for (const h of staticHandles) h.dispose();
      staticHandles = [];
      for (const handles of activeHandles.values()) for (const h of handles) h.dispose();
      activeHandles.clear();
    }

    async function updateProvider(provider: GlyphMapProvider): Promise<void> {
      if (updateInFlight) { updateQueued = true; return; }
      updateInFlight = true;
      try {
        const degPerCell = glyphMapDegreesPerCell(view);
        const lod = glyphMapTargetLOD(provider, degPerCell);
        const level = provider.zooms.find((z) => z.z === lod);
        if (!level) return;
        const padCells = layer.padCells ?? 2;
        const desired = new Set<string>();
        for (let y = 0; y < level.rows; y++) {
          for (let x = 0; x < level.cols; x++) {
            if (isBoundsVisible(provider.bounds(lod, x, y), padCells)) desired.add(`${lod}/${x}_${y}`);
          }
        }
        // Failsafe: never blank the layer entirely.
        if (desired.size === 0 && level.cols > 0 && level.rows > 0) desired.add(`${lod}/0_0`);

        const missing = [...desired].filter((key) => !tileCache.has(key));
        if (missing.length > 0) {
          await Promise.all(missing.map(async (key) => {
            const [zStr, xy] = key.split("/");
            const [xStr, yStr] = xy.split("_");
            tileCache.set(key, await provider.loadTile(Number(zStr), Number(xStr), Number(yStr)));
          }));
        }

        for (const [key, handles] of activeHandles) {
          if (!desired.has(key)) {
            for (const h of handles) h.dispose();
            activeHandles.delete(key);
          }
        }
        for (const key of desired) {
          if (!activeHandles.has(key)) {
            const tile = tileCache.get(key);
            if (tile) activeHandles.set(key, mountTile(tile));
          }
        }
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
      if (isGlyphMapProvider(layer.source)) {
        await updateProvider(layer.source);
      } else {
        disposeMeshes();
        staticHandles = mountTile(layer.source);
        scene.rerender();
      }
    }

    return {
      update,
      disposeMeshes,
      dispose(): void {
        disposeMeshes();
        tileCache.clear();
      },
    };
  }

  // ── Stroke layers (`line`/`contour`) — post-raster CellGrid stamping,
  // composed into ONE `transformCells` hook rather than mesh mounting. See
  // `stroke.ts`'s doc for the mechanism and the depth contract. ───────────

  /** `GlyphMapLineLayer.density`/`GlyphMapContourLayer.density` are reserved, not implemented — see either type's own doc. Reject explicitly rather than silently ignoring, the same "reject explicitly" precedent AGENTS.md's static exporters use for a genuine, not-yet-built capability gap. */
  function assertStrokeDensitySupported(layer: GlyphMapLineLayer | GlyphMapContourLayer): void {
    if (layer.density !== undefined && layer.density !== 1) {
      throw new RangeError(
        `glyphcss/maps: createGlyphMap.addLayer — "${layer.type}" layer "density" is not implemented yet (got ${layer.density}). ` +
          `A stroke layer is stamped into the shared base CellGrid; per-layer resolution needs its own detail <pre> and its own occlusion sampling, which this slice does not build. Omit density or pass 1.`,
      );
    }
  }

  function createLineLayerRuntime(layer: GlyphMapLineLayer): StrokeLayerRuntime {
    const color = layer.color;
    const isProvider = isGlyphMapVectorProvider(layer.source);
    let staticFeatures: readonly GlyphMapVectorFeature[] = isProvider ? [] : layer.source.features;
    const tileCache = new Map<string, import("./vector/types").GlyphMapVectorTile>();
    let activeFeatures: readonly GlyphMapVectorFeature[] = [];
    let updateInFlight = false;
    let updateQueued = false;

    async function updateProvider(provider: GlyphMapVectorProvider): Promise<void> {
      if (updateInFlight) { updateQueued = true; return; }
      updateInFlight = true;
      try {
        const degPerCell = glyphMapDegreesPerCell(view);
        const lod = glyphMapTargetLOD(provider, degPerCell);
        const level = provider.zooms.find((z) => z.z === lod);
        if (!level) return;
        const padCells = layer.padCells ?? 2;
        const desired = new Set<string>();
        for (let y = 0; y < level.rows; y++) {
          for (let x = 0; x < level.cols; x++) {
            if (isBoundsVisible(provider.bounds(lod, x, y), padCells)) desired.add(`${lod}/${x}_${y}`);
          }
        }
        if (desired.size === 0 && level.cols > 0 && level.rows > 0) desired.add(`${lod}/0_0`);
        const missing = [...desired].filter((key) => !tileCache.has(key));
        if (missing.length > 0) {
          await Promise.all(missing.map(async (key) => {
            const [zStr, xy] = key.split("/");
            const [xStr, yStr] = xy.split("_");
            tileCache.set(key, await provider.loadTile(Number(zStr), Number(xStr), Number(yStr)));
          }));
        }
        const feats: GlyphMapVectorFeature[] = [];
        for (const key of desired) {
          const tile = tileCache.get(key);
          if (!tile) continue;
          for (const list of Object.values(tile.layers)) feats.push(...list);
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
        staticFeatures = layer.source.features;
        scene.rerender();
      }
    }

    function stamp(grid: CellGrid): void {
      const gridInfo = projectionGrid();
      const feats = isGlyphMapVectorProvider(layer.source) ? activeFeatures : staticFeatures;
      for (const feature of feats) {
        for (const ring of feature.rings) {
          const verts: GlyphMapStrokeVertex[] = ring.map(([lon, lat]) => {
            const world = projection.project(lon, lat, 0);
            const p = camera.project(world, gridInfo.cols, gridInfo.rows, gridInfo.cellAspect, gridInfo);
            return { col: p[0], row: p[1], depth: p[3] ?? p[2] };
          });
          stampGlyphMapPolyline(grid, verts, { color });
        }
      }
    }

    return {
      update,
      stamp,
      dispose(): void {
        tileCache.clear();
      },
    };
  }

  function createContourLayerRuntime(layer: GlyphMapContourLayer): ContourLayerRuntime {
    const isProvider = isGlyphMapFieldProvider(layer.source);
    // A provider-backed contour starts with no resolved field at all —
    // `stamp` degrades to "draw nothing" (not "draw everywhere") until the
    // first `update()` resolves, same discipline `line`'s `activeFeatures`
    // starts empty under.
    let field: GlyphMapField | null = isProvider ? null : layer.source;
    let lastTileKey: string | null = null;
    let updateInFlight = false;
    let updateQueued = false;

    function levelsFor(f: GlyphMapField): readonly number[] {
      if (typeof layer.levels === "number") {
        return Array.from({ length: layer.levels }, (_, i) => f.min + (f.max - f.min) * ((i + 1) / ((layer.levels as number) + 1)));
      }
      if (Array.isArray(layer.levels)) return layer.levels;
      return glyphMapContourIntervalLevels((layer.levels as { readonly interval: number }).interval, f.min, f.max);
    }

    async function updateProvider(provider: GlyphMapProvider): Promise<void> {
      if (updateInFlight) { updateQueued = true; return; }
      updateInFlight = true;
      try {
        const { z, x, y, key } = glyphMapContourTileKey(provider, view);
        if (key !== lastTileKey) {
          field = await loadGlyphMapContourField(provider, z, x, y);
          lastTileKey = key;
          scene.rerender();
        }
      } finally {
        updateInFlight = false;
        if (updateQueued) {
          updateQueued = false;
          await updateProvider(provider);
        }
      }
    }

    function stamp(grid: CellGrid): void {
      const f = field;
      if (!f) return;
      // With no opaque base layer mounted, every cell reads non-finite
      // depth uniformly — degrade to "draw everywhere the field is
      // defined" rather than reading that as "off the map" (the
      // coordinator's explicit hidden-terrain gate; see stroke.ts's
      // `GlyphMapContourOptions.requireSurface` doc for why this can't be
      // decided from inside the per-cell stamping function).
      const hasOpaqueSurface = [...layerStates.values()].some((s) => s.kind === "raster");
      stampGlyphMapContour(
        grid,
        (col, row) => {
          const ll = unproject([col + 0.5, row + 0.5]);
          if (!ll) return NaN;
          return glyphMapFieldValueAt(f, ll[0], ll[1]);
        },
        { levels: levelsFor(f), color: layer.color, requireSurface: hasOpaqueSurface },
      );
    }

    return {
      async update(): Promise<void> {
        if (isGlyphMapFieldProvider(layer.source)) await updateProvider(layer.source);
        else scene.rerender();
      },
      stamp,
      dispose(): void {},
      getFieldRange(): { readonly min: number; readonly max: number } | null {
        return field ? { min: field.min, max: field.max } : null;
      },
    };
  }

  type LayerState =
    | { readonly kind: "background"; readonly layer: GlyphMapBackgroundLayer }
    | { readonly kind: "raster"; readonly layer: GlyphMapRasterLayer; readonly runtime: RasterLayerRuntime }
    | { readonly kind: "line"; readonly layer: GlyphMapLineLayer; readonly runtime: StrokeLayerRuntime }
    | { readonly kind: "contour"; readonly layer: GlyphMapContourLayer; readonly runtime: ContourLayerRuntime };

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

  function composedTransformCells(grid: CellGrid, layerInfo?: Parameters<TransformCells>[1]): CellGrid {
    let g = grid;
    if (baseTransformCells) g = baseTransformCells(g, layerInfo) ?? g;
    if (layerInfo?.detail) return g; // strokes are base-grid-only (geographic features, not per-mesh detail)
    for (const id of layerOrder) {
      const state = layerStates.get(id);
      if (state?.kind === "line" || state?.kind === "contour") state.runtime.stamp(g);
    }
    return g;
  }

  function syncStrokeHookInstalled(): void {
    const shouldInstall = strokeLayerCount > 0;
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
      const runtime = createRasterLayerRuntime(layer);
      layerStates.set(id, { kind: "raster", layer, runtime });
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    } else if (layer.type === "line") {
      assertStrokeDensitySupported(layer);
      const runtime = createLineLayerRuntime(layer);
      layerStates.set(id, { kind: "line", layer, runtime });
      strokeLayerCount++;
      syncStrokeHookInstalled(); // BEFORE update() so its rerender already carries this layer's stamps
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    } else {
      assertStrokeDensitySupported(layer);
      const runtime = createContourLayerRuntime(layer);
      layerStates.set(id, { kind: "contour", layer, runtime });
      strokeLayerCount++;
      syncStrokeHookInstalled();
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    }
    return id;
  }

  function removeLayer(id: string): void {
    const state = layerStates.get(id);
    if (!state) return;
    if (state.kind === "raster") state.runtime.dispose();
    else if (state.kind === "line" || state.kind === "contour") {
      state.runtime.dispose();
      strokeLayerCount--;
    }
    layerStates.delete(id);
    const idx = layerOrder.indexOf(id);
    if (idx >= 0) layerOrder.splice(idx, 1);
    if (state.kind === "background") applyBackground();
    if (state.kind === "line" || state.kind === "contour") syncStrokeHookInstalled();
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
    if (state?.kind === "line" || state?.kind === "contour") {
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
    }
    return glyphMapDedupeAttributions(lists);
  }

  function getContourFieldRange(id: string): { readonly min: number; readonly max: number } | null {
    const state = layerStates.get(id);
    return state?.kind === "contour" ? state.runtime.getFieldRange() : null;
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
      }
    }, 180);
  }

  function getView(): GlyphMapView {
    const o = scene.getOptions();
    return { ...view, cols: o.cols ?? view.cols, rows: o.rows ?? view.rows };
  }

  function setView(partial: Partial<GlyphMapView>): void {
    const spanChanged = partial.span !== undefined && partial.span !== view.span;
    view = { ...view, ...partial, bounds: partial.bounds };
    syncCameraToView(view);
    scene.rerender();
    scheduleTileUpdate();
    syncMarkers();
    emitViewChange(spanChanged ? "zoom" : "move");
  }

  function setTilt(t: number): void {
    tilt = t;
    if (!isOrbitProjection) {
      camera.rotX = tilt;
      scene.rerender();
      return;
    }
    // Re-derive rotX from the CURRENT view center (not the drag delta path)
    // so a tilt change composes correctly with wherever the camera already
    // is, exactly like `syncCameraToView` does on `setView`/`fitBounds`.
    syncCameraToView(view);
    scene.rerender();
    syncMarkers();
  }

  function getTilt(): number {
    return tilt;
  }

  function fitBounds(bounds: GlyphMapBounds): void {
    const spanFromWidth = bounds.east - bounds.west;
    const spanFromHeight = (bounds.north - bounds.south) * (view.cols / view.rows);
    setView({
      center: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2],
      span: Math.max(spanFromWidth, spanFromHeight),
    });
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

  function pixelsPerWorldUnit(grid: ProjectionGrid): number {
    const a = camera.project([0, 0, 0], grid.cols, grid.rows, grid.cellAspect, grid);
    const b = camera.project([0, 0, 1], grid.cols, grid.rows, grid.cellAspect, grid);
    return Math.hypot((b[0] - a[0]) * grid.cellWidth, (b[1] - a[1]) * grid.cellHeight) || 1;
  }

  function applyDrag(dxPx: number, dyPx: number): void {
    const grid = projectionGrid();
    if (isOrbitProjection && projection.cameraForCenter && projection.centerForCamera) {
      // Grab-and-drag semantics (verified against `centerForCamera`): drag
      // RIGHT must decrease centre longitude and drag DOWN must increase
      // centre latitude, so the world follows the cursor, matching the
      // sheet branch below and every other map library. `centerForCamera`
      // measures `rotY +10 -> lon +10` and `rotX +10 -> lat -10`, so both
      // increments are negated relative to the raw pixel delta.
      const degPerPx = (1 / pixelsPerWorldUnit(grid)) * (180 / Math.PI);
      camera.rotY -= dxPx * degPerPx;
      camera.rotX -= dyPx * degPerPx;
      // Subtract `tilt` back out before inverting — see `setTilt`'s doc:
      // `camera.rotX` here is `trueRotX + tilt`, and `centerForCamera` must
      // see `trueRotX` alone or a nonzero tilt would drift `view.center`'s
      // latitude by `tilt` degrees on every drag.
      view = { ...view, center: projection.centerForCamera(camera.rotX - tilt, camera.rotY), bounds: undefined };
    } else {
      const delta = screenToWorldDelta(dxPx, dyPx, grid);
      if (!delta) return;
      const t = camera.target;
      const [lonRaw, latRaw] = projection.unproject([t[0] - delta[0], t[1] - delta[1], t[2]]);
      const d = projection.domain;
      const lon = clamp(lonRaw, d.west, d.east);
      const lat = clamp(latRaw, d.south, d.north);
      view = { ...view, center: [lon, lat], bounds: undefined };
      camera.target = projection.project(lon, lat, 0);
    }
    scene.rerender();
    syncMarkers();
    emitViewChange("move");
  }

  function applyWheel(deltaY: number): void {
    const domainWidth = Math.min(360, projection.domain.east - projection.domain.west) || 360;
    const delta = deltaY * 0.001;
    view = { ...view, span: clamp(view.span * (1 + delta), minSpan, domainWidth), bounds: undefined };
    syncCameraToView(view);
    scene.rerender();
    syncMarkers();
    emitViewChange("zoom");
  }

  let activePointerId: number | null = null;
  let lastClientX = 0, lastClientY = 0;
  let dragTotalPx = 0;
  let didDrag = false;

  function onPointerDown(e: PointerEvent): void {
    if (!controlsDrag || activePointerId !== null) return;
    activePointerId = e.pointerId;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    dragTotalPx = 0;
    didDrag = false;
    // Capture on the stable host, NOT e.target — colored output rewrites
    // the <pre> innerHTML each render, destroying a captured child and
    // dropping the gesture mid-drag (absorbed from both example pages).
    try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    dragTotalPx += Math.abs(dx) + Math.abs(dy);
    if (dragTotalPx > 3) didDrag = true;
    applyDrag(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    try { host.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
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
    didDrag = false;
    scheduleTileUpdate();
  }

  function onWheel(e: WheelEvent): void {
    if (!controlsWheel) return;
    e.preventDefault();
    applyWheel(e.deltaY);
    scheduleTileUpdate();
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("wheel", onWheel, { passive: false });

  // ── Initial mount ─────────────────────────────────────────────────────

  syncCameraToView(view);
  scene.rerender();
  for (const layer of opts.layers ?? []) addLayer(layer);
  void Promise.allSettled(initialLoadPromises).then(() => {
    mapLoaded = true;
    emit({ type: "load" });
  });

  return {
    host,
    scene,
    setView,
    getView,
    fitBounds,
    setTilt,
    getTilt,
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
    resize(): void {
      scene.fit();
      syncCameraToView(view);
      scene.rerender();
      scheduleTileUpdate();
      syncMarkers();
    },
    destroy(): void {
      if (tileUpdateTimer !== null) clearTimeout(tileUpdateTimer);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("wheel", onWheel);
      for (const state of layerStates.values()) {
        if (state.kind === "raster" || state.kind === "line" || state.kind === "contour") state.runtime.dispose();
      }
      layerStates.clear();
      layerOrder.length = 0;
      markerSyncs.clear();
      listeners.clear();
      scene.destroy();
    },
  };
}
