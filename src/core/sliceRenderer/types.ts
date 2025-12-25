import type { GridContext, RenderState, Voxel } from "../types";
import type { DetailPlan, FaceBuffer, FaceKey } from "../shellRenderer/types";

export type SliceAxis = "x" | "y" | "z";

export type AxisSlices = {
  x: SlicePlan[];
  y: SlicePlan[];
  z: SlicePlan[];
};

export type SlicePlanStatus = "ok" | "refined" | "no-gain" | "degraded";

export type RegionPlan = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColorId: number;
  details: DetailPlan[];
};

export type Brush = {
  kind: "BASE" | "STAMP" | "COMBO" | "SVG" | "GRADIENT";
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor?: string;
  before?: { x: number; y: number; w: number; h: number; color: string };
  after?: { x: number; y: number; w: number; h: number; color: string };
  svgPaths?: { path: string; color: string }[];
  svgViewBox?: string;
  svgPaintArea?: number;
  gradientAxis?: "x" | "y";
  gradientStops?: { start: number; end: number; color: string }[];
};

export type SliceMetrics = {
  domEstimate: number;
  baseOnlyRects: number;
  detailRects: number;
  svgPaths: number;
  gradientStops: number;
  splitCount: number;
  idealCells: number;
  paintedCells: number;
  paintCells: number;
  pseudoArea: number;
  paintCost: number;
  uniqueColors: number;
};

export type SlicePlan = {
  key: FaceKey;
  buffer: FaceBuffer;
  regions: RegionPlan[];
  brushes: Brush[];
  brushCounts: {
    base: number;
    stamp: number;
    combo: number;
    svg: number;
    gradient: number;
  };
  metrics: SliceMetrics;
  scoreTotal: number;
  status?: SlicePlanStatus;
  fallback: boolean;
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
  faceCache: Map<string, SlicePlan>;
  faceBrushCache: Map<string, unknown>;
  cacheLighting: GridContext["lighting"] | null;
  cacheResolveTexture: GridContext["resolveTexture"] | null;
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
  lastDebugSig: number;
  warnedUnstableLayers?: boolean;
}

export const SLICE_RENDERER_VERSION = 1;
export const SLICE_RENDERER_DEV_VERIFY = (() => {
  if (typeof globalThis === "undefined") return false;
  return (globalThis as { __voxcssSliceVerify?: boolean }).__voxcssSliceVerify === true;
})();

export const getDomPerCell = (metrics: SliceMetrics): number =>
  metrics.domEstimate / Math.max(1, metrics.idealCells);

export const getFragPerCell = (metrics: SliceMetrics): number =>
  metrics.detailRects / Math.max(1, metrics.idealCells);

export const getOverdrawRatio = (metrics: SliceMetrics): number =>
  metrics.paintCost / Math.max(1, metrics.idealCells);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const scorePlan = (
  metrics: SliceMetrics,
  fallback: boolean,
  options?: { detailCount?: number; fragCount?: number }
): number => {
  const domPerCell = getDomPerCell(metrics);
  const paintOverdraw = Math.max(0, getOverdrawRatio(metrics) - 1);
  const detailCount = options?.detailCount ?? metrics.detailRects;
  const fragCount = options?.fragCount ?? metrics.detailRects;
  const fragPerCell = fragCount / Math.max(1, metrics.idealCells);

  const domNorm = clamp(domPerCell / 0.25, 0, 1);
  const fragNorm = clamp(fragPerCell / 0.2, 0, 1);
  const detailNorm = clamp(detailCount / 200, 0, 1);
  const paintNorm = clamp(paintOverdraw / 0.5, 0, 1);
  const fallbackNorm = fallback ? 1 : 0;

  const score =
    100 *
    (0.495 * domNorm +
      0.225 * fragNorm +
      0.135 * detailNorm +
      0.1 * paintNorm +
      0.045 * fallbackNorm);

  return clamp(score, 0, 100);
};

export const ensureSliceRendererHosts = (
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
    faceBrushCache: new Map(),
    cacheLighting: null,
    cacheResolveTexture: null,
    cacheOffsets: null,
    cacheTileSize: 0,
    cacheLayerElevation: 0,
    cacheRows: 0,
    cacheCols: 0,
    cacheDepth: 0,
    cacheWallsSig: 0,
    cacheRenderVersion: null,
    cacheLayersRef: null,
    lastSlices: null,
    lastDebugSig: -1,
    warnedUnstableLayers: false
  };
};

export function clearSliceRenderer(sliceRenderer: SliceRendererDomState | null): void {
  if (!sliceRenderer) return;
  sliceRenderer.faceBrushCache.clear();
  sliceRenderer.faceCache.clear();
  sliceRenderer.lastSlices = null;
  sliceRenderer.cacheLayersRef = null;
  sliceRenderer.cacheResolveTexture = null;
  sliceRenderer.cacheOffsets = null;
  for (const pool of [sliceRenderer.zPool, sliceRenderer.xPool, sliceRenderer.yPool]) pool.length = 0;
  const zHost = sliceRenderer.zHost;
  zHost.innerHTML = "";
  for (const prop of ["display", "grid-template-columns", "grid-template-rows"]) zHost.style.removeProperty(prop);
  sliceRenderer.xHost.remove();
  sliceRenderer.yHost.remove();
}
