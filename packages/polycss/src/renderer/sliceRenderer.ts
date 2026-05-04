import type { GridContext, Voxel, PlaneAxis, FaceBuffer, FaceData, SlicePlan, Brush } from "@layoutit/voxcss-core";
import type { RenderState } from "../types";
import {
  DEFAULT_WALLS,
  wallsToSig,
  buildSliceCacheKey,
  buffersEqual,
  buildSlicePlan,
  buildFaceDataFromSnapshot,
  NEXT_LAYER_STEP
} from "@layoutit/voxcss-core";

export type { Brush, SlicePlan };

type CachedSlicePlan = {
  plan: SlicePlan;
  nextBuffer: FaceBuffer | null;
};

export interface SliceRendererSnapshot {
  layers: Voxel[][];
  context: GridContext;
}

export interface SliceRendererDomState {
  zHost: HTMLElement;
  xHost: HTMLElement;
  yHost: HTMLElement;
  zPool: Element[];
  xPool: Element[];
  yPool: Element[];
  faceCache: Map<string, CachedSlicePlan>;
  cacheOffsets: GridContext["offsets"] | null;
  cacheTileSize: number;
  cacheLayerElevation: number;
  cacheRows: number;
  cacheCols: number;
  cacheDepth: number;
  cacheWallsSig: number;
  cacheRenderVersion: number | null;
  cacheLayersRef: Voxel[][] | null;
  lastSlices: SlicePlan[] | null;
}

const BRUSH_CLASS = "voxcss-brush";

const applyBrush = (
  brush: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void => {
  const brushState = ((brush as { __voxcssNewBrushState?: Record<string, string | undefined> }).__voxcssNewBrushState ??= {});
  if (brushState.className !== BRUSH_CLASS) {
    brush.className = BRUSH_CLASS;
    brushState.className = BRUSH_CLASS;
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
  plans: SlicePlan[]
): void => {
  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50, layerElevation = context.layerElevation ?? tileSize;
  const walls = context.walls ?? DEFAULT_WALLS;

  const axisState: Record<PlaneAxis, { host: HTMLElement; pool: Element[]; index: number }> = {
    z: { host: hosts.zHost, pool: hosts.zPool, index: 0 },
    x: { host: hosts.xHost, pool: hosts.xPool, index: 0 },
    y: { host: hosts.yHost, pool: hosts.yPool, index: 0 }
  };

  const nextBrush = (axis: PlaneAxis): HTMLElement => {
    const bucket = axisState[axis];
    const i = bucket.index++;
    let el = bucket.pool[i] as HTMLElement | undefined;
    if (!el) {
      el = documentRef.createElement("b");
      bucket.pool[i] = el;
      bucket.host.appendChild(el);
    } else if (el.parentElement !== bucket.host) {
      bucket.host.appendChild(el);
    }
    return el;
  };

  for (const plan of plans) {
    const { axis, plane, face } = plan.key;
    if (walls[face]) continue;
    const planeOffset = axis === "z" ? plane * layerElevation : -1 * (plane - 1) * tileSize;
    const brushZ = `${planeOffset}px`;
    const originRow = plan.buffer.minRow;
    const originCol = plan.buffer.minCol;
    for (const brush of plan.brushes) {
      const gridArea = `${originRow + brush.r0} / ${originCol + brush.c0} / ${originRow + brush.r1} / ${originCol + brush.c1}`;
      const el = nextBrush(axis);
      applyBrush(el, gridArea, brush.baseColor, brushZ);
    }
  }

  for (const axis of Object.keys(axisState) as PlaneAxis[]) {
    const bucket = axisState[axis];
    for (let i = bucket.index; i < bucket.pool.length; i += 1) bucket.pool[i]?.remove();
  }
};

const ensureSliceRendererHosts = (
  renderState: RenderState,
  existing: SliceRendererDomState | null,
  documentRef: Document
): SliceRendererDomState => {
  const root = renderState.root;
  const floor = renderState.floor;
  if (existing) {
    for (const host of [existing.xHost, existing.yHost]) {
      if (host.parentElement !== root) root.appendChild(host);
    }
    if (existing.zHost !== floor) existing.zHost = floor;
    return existing;
  }

  const xHost = documentRef.createElement("div");
  const yHost = documentRef.createElement("div");
  xHost.className = "voxcss-floor-x";
  yHost.className = "voxcss-floor-y";
  root.appendChild(xHost);
  root.appendChild(yHost);

  return {
    zHost: floor,
    xHost,
    yHost,
    zPool: [],
    xPool: [],
    yPool: [],
    faceCache: new Map(),
    cacheOffsets: null,
    cacheTileSize: 0,
    cacheLayerElevation: 0,
    cacheRows: 0,
    cacheCols: 0,
    cacheDepth: 0,
    cacheWallsSig: 0,
    cacheRenderVersion: null,
    cacheLayersRef: null,
    lastSlices: null
  };
};

const clearSliceRenderer = (sliceRenderer: SliceRendererDomState | null): void => {
  if (!sliceRenderer) return;
  sliceRenderer.faceCache.clear();
  sliceRenderer.lastSlices = null;
  sliceRenderer.cacheLayersRef = null;
  sliceRenderer.cacheOffsets = null;
  for (const pool of [sliceRenderer.zPool, sliceRenderer.xPool, sliceRenderer.yPool]) pool.length = 0;
  const zHost = sliceRenderer.zHost;
  zHost.innerHTML = "";
  for (const prop of ["display", "grid-template-columns", "grid-template-rows"]) zHost.style.removeProperty(prop);
  sliceRenderer.xHost.remove();
  sliceRenderer.yHost.remove();
};

export { clearSliceRenderer };

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
  const depth = snapshot.layers.length;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const wallsSig = wallsToSig(context.walls ?? DEFAULT_WALLS);
  const wallsSigChanged = hosts.cacheWallsSig !== wallsSig;
  const renderVersion = typeof context.renderVersion === "number" ? context.renderVersion : null;
  const invalidateLayers = (): void => {
    hosts.cacheRenderVersion = renderVersion;
    hosts.cacheLayersRef = snapshot.layers;
    hosts.lastSlices = null;
  };

  const depsChanged =
    hosts.cacheOffsets !== context.offsets ||
    hosts.cacheTileSize !== tileSize ||
    hosts.cacheLayerElevation !== layerElevation ||
    hosts.cacheRows !== rows ||
    hosts.cacheCols !== cols ||
    hosts.cacheDepth !== depth;

  const layersChanged = renderVersion !== null ? hosts.cacheRenderVersion !== renderVersion : hosts.cacheLayersRef !== snapshot.layers;

  if (depsChanged) {
    hosts.cacheOffsets = context.offsets;
    hosts.cacheTileSize = tileSize;
    hosts.cacheLayerElevation = layerElevation;
    hosts.cacheRows = rows;
    hosts.cacheCols = cols;
    hosts.cacheDepth = depth;
    hosts.cacheWallsSig = wallsSig;
    invalidateLayers();
  } else {
    if (layersChanged) {
      invalidateLayers();
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

  let plans: SlicePlan[];
  let usedKeys: Set<string> | null = null;
  if (!depsChanged && hosts.lastSlices) {
    plans = hosts.lastSlices;
  } else {
    const faces = buildFaceDataFromSnapshot(snapshot);
    const faceIndex = new Map<string, FaceData>();
    for (const face of faces) {
      faceIndex.set(`${face.key.axis}:${face.key.plane}:${face.key.face}`, face);
    }
    const nextPlans: SlicePlan[] = [];
    usedKeys = new Set();
    for (const face of faces) {
      const cacheKey = buildSliceCacheKey(face);
      const nextPlane = face.key.plane + NEXT_LAYER_STEP[face.key.face];
      const nextKey = `${face.key.axis}:${nextPlane}:${face.key.face}`;
      const nextFace = faceIndex.get(nextKey);
      const nextBuffer = nextFace?.buffer ?? null;
      const cached = hosts.faceCache.get(cacheKey);
      let plan: SlicePlan;
      if (cached && buffersEqual(cached.plan.buffer, face.buffer) && buffersEqual(cached.nextBuffer, nextBuffer)) {
        plan = cached.plan;
      } else {
        plan = buildSlicePlan(face, nextBuffer);
        hosts.faceCache.set(cacheKey, { plan, nextBuffer });
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

  renderSlicePlans(hosts, snapshot, documentRef, plans);

  return hosts;
}
