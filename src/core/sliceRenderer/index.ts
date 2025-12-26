import { DEFAULT_WALLS, type CubeFace, type RenderState } from "../types";
import type { SliceRendererDomState, SliceRendererSnapshot } from "./slicePlan";
import { ensureSliceRendererHosts, clearSliceRenderer, normalizePaintColor } from "./slicePlan";
import { wallsToSig } from "./sliceCore";
import { buildFaceDataFromSnapshot, buildSliceCacheKey, buildSlicePlan } from "./slicePlan";

const STAMP_FACE_Z_OFFSET: Record<CubeFace, number> = {
  t: 0.12,
  b: 0.12,
  fr: -0.12,
  fl: -0.12,
  br: 0.12,
  bl: 0.12
};

type BrushState = {
  className?: string;
  gridArea?: string;
  backgroundColor?: string;
  zOffset?: string;
  initialized?: boolean;
};

const applyBrush = (
  brush: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void => {
  const state = brush as { __voxcssNewBrushState?: BrushState };
  const brushState = state.__voxcssNewBrushState ?? (state.__voxcssNewBrushState = {});
  const className = "voxcss-plane-brush";
  if (brushState.className !== className) {
    brush.className = className;
    brushState.className = className;
  }
  if (!brushState.initialized) {
    brush.style.position = "relative";
    brush.style.overflow = "visible";
    brush.style.backgroundImage = "";
    brush.style.backgroundRepeat = "";
    brush.style.backgroundSize = "";
    brush.style.backgroundPosition = "";
    brush.style.left = "";
    brush.style.top = "";
    brush.style.width = "";
    brush.style.height = "";
    brushState.initialized = true;
  }
  if (brushState.gridArea !== gridArea) {
    brush.style.gridArea = gridArea;
    brushState.gridArea = gridArea;
  }
  if (brushState.backgroundColor !== backgroundColor) {
    brush.style.backgroundColor = backgroundColor;
    brushState.backgroundColor = backgroundColor;
  }
  if (brushState.zOffset !== zOffset) {
    brush.style.setProperty("--vox-z", zOffset);
    brushState.zOffset = zOffset;
  }
};

const renderSlicePlans = (
  hosts: SliceRendererDomState,
  snapshot: SliceRendererSnapshot,
  documentRef: Document,
  plans: SliceRendererDomState["lastSlices"] | null
): void => {
  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const walls = context.walls ?? DEFAULT_WALLS;

  const axisState = {
    z: { host: hosts.zHost, pool: hosts.zPool, index: 0 },
    x: { host: hosts.xHost, pool: hosts.xPool, index: 0 },
    y: { host: hosts.yHost, pool: hosts.yPool, index: 0 }
  } as const;

  const nextBrush = (axis: "x" | "y" | "z"): HTMLElement => {
    const bucket = axisState[axis];
    const i = bucket.index++;
    let el = bucket.pool[i] as HTMLElement | undefined;
    if (!el || el.tagName.toLowerCase() !== "b") {
      if (el) el.remove();
      el = documentRef.createElement("b");
      bucket.pool[i] = el;
      bucket.host.appendChild(el);
    } else if (el.parentElement !== bucket.host) {
      bucket.host.appendChild(el);
    }
    if (el.style.display === "none") el.style.display = "";
    return el;
  };

  const planList = plans ?? [];
  for (const plan of planList) {
    const { axis, plane, face } = plan.key;
    if (walls[face]) continue;
    const planeOffset = axis === "z" ? plane * layerElevation : -1 * (plane - 1) * tileSize;
    const stampOffset = STAMP_FACE_Z_OFFSET[face] ?? 0.12;
    const brushZ = `${(planeOffset + stampOffset).toFixed(3)}px`;
    const originRow = plan.buffer.minRow;
    const originCol = plan.buffer.minCol;
    for (const brush of plan.brushes) {
      const color = normalizePaintColor(brush.baseColor);
      if (!color) continue;
      const gridArea = `${originRow + brush.r0} / ${originCol + brush.c0} / ${originRow + brush.r1} / ${originCol + brush.c1}`;
      const el = nextBrush(axis);
      applyBrush(el, gridArea, color, brushZ);
    }
  }

  for (const axis of Object.keys(axisState) as Array<keyof typeof axisState>) {
    const bucket = axisState[axis];
    for (let i = bucket.index; i < bucket.pool.length; i += 1) bucket.pool[i]?.remove();
  }
};

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
