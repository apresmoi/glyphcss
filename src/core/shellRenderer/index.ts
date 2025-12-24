import type { RenderState } from "../types";
import { DEFAULT_WALLS } from "../types";
import type { PlaneShellDomState, PlaneShellSnapshot } from "./types";
import { ensurePlaneShellHosts, wallsToSig } from "./types";
import { buildFaceDataFromSnapshot, buildFacePlan, buildCacheKey } from "./plan";
import { renderFacePlans } from "./render";

export { clearPlaneShell } from "./types";
export type { PlaneShellDomState, PlaneShellSnapshot } from "./types";
export function updatePlaneShellGeometry(
  renderState: RenderState,
  planeShell: PlaneShellDomState | null,
  snapshot: PlaneShellSnapshot,
  documentRef: Document
): PlaneShellDomState {
  const hosts = ensurePlaneShellHosts(renderState, planeShell, documentRef);
  const context = snapshot.context;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);
  const lighting = context.lighting ?? null;
  const resolveTexture = context.resolveTexture ?? null;
  const offsets = context.offsets;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const walls = context.walls ?? DEFAULT_WALLS;
  const wallsSig = wallsToSig(walls);
  const wallsSigChanged = hosts.cacheWallsSig !== wallsSig;
  const renderVersion = typeof context.renderVersion === "number" ? context.renderVersion : null;
  const hasRenderVersion = renderVersion !== null;
  const renderVersionChanged = hasRenderVersion && hosts.cacheRenderVersion !== renderVersion;

  const depsChanged =
    hosts.cacheLighting !== lighting ||
    hosts.cacheResolveTexture !== resolveTexture ||
    hosts.cacheOffsets !== offsets ||
    hosts.cacheTileSize !== tileSize ||
    hosts.cacheLayerElevation !== layerElevation ||
    hosts.cacheRows !== rows ||
    hosts.cacheCols !== cols ||
    hosts.cacheDepth !== depth;

  const layersRefChanged = hosts.cacheLayersRef !== snapshot.layers;
  const layersChanged = hasRenderVersion ? renderVersionChanged : layersRefChanged;

  if (!hasRenderVersion && layersRefChanged && hosts.cacheLayersRef && !hosts.warnedUnstableLayers) {
    console.warn("[VoxCSS] PlaneShell called with unstable snapshot.layers; this will force rebuilds. Provide renderVersion or reuse layers array.");
    hosts.warnedUnstableLayers = true;
  }

  if (depsChanged) {
    hosts.faceCache.clear();
    hosts.cacheLighting = lighting;
    hosts.cacheResolveTexture = resolveTexture;
    hosts.cacheOffsets = offsets;
    hosts.cacheTileSize = tileSize;
    hosts.cacheLayerElevation = layerElevation;
    hosts.cacheRows = rows;
    hosts.cacheCols = cols;
    hosts.cacheDepth = depth;
    hosts.cacheWallsSig = wallsSig;
    hosts.cacheRenderVersion = renderVersion;
    hosts.cacheLayersRef = snapshot.layers;
    hosts.lastFaces = null;
  } else {
    if (layersChanged) {
      hosts.cacheRenderVersion = renderVersion;
      hosts.cacheLayersRef = snapshot.layers;
      hosts.lastFaces = null;
    }
    if (wallsSigChanged) {
      hosts.cacheWallsSig = wallsSig;
    }
  }
  if (!depsChanged && !layersChanged && !wallsSigChanged) {
    return hosts;
  }

  if (depsChanged) {
    for (const [host, w, h] of [
      [hosts.xHost, cols * tileSize, depth * layerElevation],
      [hosts.yHost, depth * layerElevation, rows * tileSize]
    ] as [HTMLElement, number, number][]) host.style.width = `${w}px`, host.style.height = `${h}px`;
    for (const [host, gridCols, gridRows, colPx, rowPx] of [
      [hosts.zHost, cols, rows, tileSize, tileSize],
      [hosts.xHost, cols, depth, tileSize, layerElevation],
      [hosts.yHost, depth, rows, layerElevation, tileSize]
    ] as [HTMLElement, number, number, number, number][]) {
      host.style.display = "grid";
      host.style.gridTemplateColumns = `repeat(${gridCols}, ${colPx}px)`;
      host.style.gridTemplateRows = `repeat(${gridRows}, ${rowPx}px)`;
    }
  }

  let plans: FacePlan[];
  let usedKeys: Set<string> | null = null;
  if (!depsChanged && hosts.lastFaces) {
    plans = hosts.lastFaces;
  } else {
    const faces = buildFaceDataFromSnapshot(snapshot);
    plans = [];
    usedKeys = new Set();
    for (const face of faces) {
      const cacheKey = buildCacheKey(face);
      let plan = hosts.faceCache.get(cacheKey);
      if (!plan) {
        plan = buildFacePlan(face);
        hosts.faceCache.set(cacheKey, plan);
      }
      plans.push(plan);
      usedKeys.add(cacheKey);
    }
    hosts.lastFaces = plans;
  }

  if (usedKeys) {
    for (const key of Array.from(hosts.faceCache.keys())) {
      if (usedKeys.has(key)) continue;
      hosts.faceCache.delete(key);
    }
  }

  const stats = renderFacePlans(hosts, snapshot, documentRef, plans);
  if (layersChanged || depsChanged) {
    console.log(
      `[VoxCSS] PlaneShell stats paintCells=${stats.paintCells} pseudoLayers=${stats.pseudoLayers} ` +
      `pseudoArea=${stats.pseudoArea} brushNodes=${stats.brushNodes} svgNodes=${stats.svgNodes} ` +
      `svgPaths=${stats.svgPaths} compositeNodes=${stats.compositeNodes}`
    );
  }
  return hosts;
}

export function updatePlaneShellCamera(_renderState: RenderState): void {
  // Camera transforms are owned by the scene controller; PlaneShell does no per-frame DOM work.
}
