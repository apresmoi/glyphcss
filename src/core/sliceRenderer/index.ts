import type { RenderState } from "../types";
import { DEFAULT_WALLS } from "../types";
import type { SliceRendererDomState, SliceRendererSnapshot } from "./slicePlan";
import { ensureSliceRendererHosts, clearSliceRenderer } from "./slicePlan";
import { wallsToSig } from "./sliceCore";
import { buildFaceDataFromSnapshot, buildSliceCacheKey, buildSlicePlan } from "./slicePlan";
import { renderSlicePlans } from "./sliceRender";

export { clearSliceRenderer } from "./slicePlan";
export type { SliceRendererDomState, SliceRendererSnapshot } from "./slicePlan";

export function updateSliceRendererGeometry(
  renderState: RenderState,
  sliceRenderer: SliceRendererDomState | null,
  snapshot: SliceRendererSnapshot,
  documentRef: Document
): SliceRendererDomState {
  const hosts = ensureSliceRendererHosts(renderState, sliceRenderer, documentRef);
  const context = snapshot.context;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);
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
    hosts.cacheOffsets !== offsets ||
    hosts.cacheTileSize !== tileSize ||
    hosts.cacheLayerElevation !== layerElevation ||
    hosts.cacheRows !== rows ||
    hosts.cacheCols !== cols ||
    hosts.cacheDepth !== depth;

  const layersRefChanged = hosts.cacheLayersRef !== snapshot.layers;
  const layersChanged = hasRenderVersion ? renderVersionChanged : layersRefChanged;

  if (depsChanged) {
    hosts.faceCache.clear();
    hosts.cacheOffsets = offsets;
    hosts.cacheTileSize = tileSize;
    hosts.cacheLayerElevation = layerElevation;
    hosts.cacheRows = rows;
    hosts.cacheCols = cols;
    hosts.cacheDepth = depth;
    hosts.cacheWallsSig = wallsSig;
    hosts.cacheRenderVersion = renderVersion;
    hosts.cacheLayersRef = snapshot.layers;
    hosts.lastSlices = null;
  } else {
    if (layersChanged) {
      hosts.cacheRenderVersion = renderVersion;
      hosts.cacheLayersRef = snapshot.layers;
      hosts.lastSlices = null;
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
    ] as [HTMLElement, number, number][]) {
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
    }
    for (const [host, gridCols, gridRows, colPx, rowPx] of [
      [hosts.zHost, cols, rows, tileSize, tileSize],
      [hosts.xHost, cols, depth, tileSize, layerElevation],
      [hosts.yHost, depth, rows, layerElevation, tileSize]
    ] as [HTMLElement, number, number, number, number][]) {
      host.style.display = "grid";
      host.style.gridTemplateColumns = `repeat(${gridCols}, ${colPx}px)`;
      host.style.gridTemplateRows = `repeat(${gridRows}, ${rowPx}px)`;
      host.style.setProperty("--voxcss-grid-x", `${colPx}px`);
      host.style.setProperty("--voxcss-grid-y", `${rowPx}px`);
    }
  }

  let plans: SliceRendererDomState["lastSlices"] | null;
  let usedKeys: Set<string> | null = null;
  if (!depsChanged && hosts.lastSlices) {
    plans = hosts.lastSlices;
  } else {
    const faces = buildFaceDataFromSnapshot(snapshot);
    const nextPlans = [];
    usedKeys = new Set();
    for (const face of faces) {
      const cacheKey = buildSliceCacheKey(face);
      let plan = hosts.faceCache.get(cacheKey);
      if (!plan) {
        plan = buildSlicePlan(face);
        hosts.faceCache.set(cacheKey, plan);
      }
      nextPlans.push(plan);
      usedKeys.add(cacheKey);
    }
    plans = nextPlans;
    hosts.lastSlices = nextPlans;
  }

  if (usedKeys) {
    for (const key of Array.from(hosts.faceCache.keys())) {
      if (usedKeys.has(key)) continue;
      hosts.faceCache.delete(key);
    }
  }

  renderSlicePlans(hosts, snapshot, documentRef, plans ?? []);

  return hosts;
}

export function updateSliceRendererCamera(_renderState: RenderState): void {
  // Camera transforms are owned by the scene controller; sliceRenderer does no per-frame DOM work.
}
