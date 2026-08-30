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
  GlyphCamera,
  GlyphHotspotHandle,
  GlyphMeshHandle,
  GlyphSceneHandle,
  GlyphSceneOptions,
  Vec3,
} from "glyphcss";
import type { GlyphMapBounds, GlyphMapClassifier, GlyphMapView } from "./types";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import { splitGlyphMapGeoTileAtAntimeridian } from "./tile";
import { glyphMapPolygons } from "./mesh";
import type { GlyphMapProvider } from "./provider";
import { glyphMapDegreesPerCell, glyphMapTargetLOD } from "./provider";

// ── Layers (MAPS.md §14 — `background`/`raster` only; `fill`/`line`/
// `contour`/`symbol`/`circle`/`heatmap`/`fill-extrusion`/`model` are later
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
}

export type GlyphMapLayer = GlyphMapBackgroundLayer | GlyphMapRasterLayer;

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
  /** Initial `camera.rotX` (degrees) for a SHEET projection (one with no `cameraForCenter`) — the iso tilt. Default `40`. No effect on a projection navigated by orbit (the globe), whose orientation comes entirely from `view.center`. */
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
  project(lngLat: readonly [number, number]): GlyphMapProjectResult;
  unproject(cell: readonly [number, number]): readonly [number, number] | null;
  addLayer(layer: GlyphMapLayer, beforeId?: string): string;
  removeLayer(id: string): void;
  moveLayer(id: string, beforeId?: string): void;
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

  const camera: GlyphCamera = createGlyphOrthographicCamera({ zoom: 1 });
  if (!isOrbitProjection) {
    camera.rotX = opts.tilt ?? 40;
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
      camera.rotX = rotX;
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
      return splitGlyphMapGeoTileAtAntimeridian(tile).map((part) => scene.add(glyphMapPolygons(part, projection, { color })));
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

  type LayerState =
    | { readonly kind: "background"; readonly layer: GlyphMapBackgroundLayer }
    | { readonly kind: "raster"; readonly layer: GlyphMapRasterLayer; readonly runtime: RasterLayerRuntime };

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
    } else {
      const runtime = createRasterLayerRuntime(layer);
      layerStates.set(id, { kind: "raster", layer, runtime });
      const p = runtime.update();
      if (!mapLoaded) initialLoadPromises.push(p);
    }
    return id;
  }

  function removeLayer(id: string): void {
    const state = layerStates.get(id);
    if (!state) return;
    if (state.kind === "raster") state.runtime.dispose();
    layerStates.delete(id);
    const idx = layerOrder.indexOf(id);
    if (idx >= 0) layerOrder.splice(idx, 1);
    if (state.kind === "background") applyBackground();
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

  // ── View mutation ────────────────────────────────────────────────────

  let tileUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleTileUpdate(): void {
    if (tileUpdateTimer !== null) clearTimeout(tileUpdateTimer);
    tileUpdateTimer = setTimeout(() => {
      tileUpdateTimer = null;
      for (const state of layerStates.values()) {
        if (state.kind === "raster" && isGlyphMapProvider(state.layer.source)) void state.runtime.update();
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
      view = { ...view, center: projection.centerForCamera(camera.rotX, camera.rotY), bounds: undefined };
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
    project,
    unproject,
    addLayer,
    removeLayer,
    moveLayer,
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
        if (state.kind === "raster") state.runtime.dispose();
      }
      layerStates.clear();
      layerOrder.length = 0;
      markerSyncs.clear();
      listeners.clear();
      scene.destroy();
    },
  };
}
