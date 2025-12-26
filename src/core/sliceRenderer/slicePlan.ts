import type { GridContext, RenderState, Voxel } from "../types";
import type { DetailPlan, FaceBuffer, FaceData, FaceKey, FacePlan, HostPlan } from "./sliceCore";
import {
  buildCacheKey as buildFaceCacheKey,
  buildFaceDataFromSnapshot,
  buildFacePlan,
  getDetailRects,
  makeRectEngine
} from "./sliceCore";

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
  kind: "BASE";
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor: string;
};

export type SliceMetrics = {
  domEstimate: number;
  detailRects: number;
  idealCells: number;
  paintedCells: number;
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

export const scorePlan = (metrics: SliceMetrics, fallback: boolean): number => {
  const domPerCell = getDomPerCell(metrics);
  const paintOverdraw = Math.max(0, getOverdrawRatio(metrics) - 1);
  const detailCount = metrics.detailRects;
  const fragCount = metrics.detailRects;
  const fragPerCell = fragCount / Math.max(1, metrics.idealCells);

  const domNorm = clamp(domPerCell / 0.25, 0, 1);
  const fragNorm = clamp(fragPerCell / 0.2, 0, 1);
  const detailNorm = clamp(detailCount / 200, 0, 1);
  const paintNorm = clamp(paintOverdraw / 0.5, 0, 1);
  const fallbackNorm = fallback ? 1 : 0;

  const weights = { dom: 0.495, frag: 0.225, detail: 0.135, paint: 0.1, fallback: 0.045 };

  const score =
    100 *
    (weights.dom * domNorm +
      weights.frag * fragNorm +
      weights.detail * detailNorm +
      weights.paint * paintNorm +
      weights.fallback * fallbackNorm);

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

type PassResult = {
  brushes: Brush[];
  packed: PackedBrush[];
  metrics: SliceMetrics;
  scoreTotal: number;
  verified: boolean;
};

type RectBuildResult = {
  rects: BrushRect[];
  detailRects: number;
  detailsValid: boolean;
};

type BrushCounts = { base: number };
const DETAIL_MERGE_MAX_RECTS = 256;

const buildSliceCacheKey = (face: FaceData): string =>
  `slice:${SLICE_RENDERER_VERSION}:${buildFaceCacheKey(face)}`;

const computeUniqueColors = (ids: Uint32Array, paletteSize: number): number => {
  if (paletteSize <= 1) return 0;
  const seen = new Uint8Array(paletteSize);
  let count = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (id <= 0 || id >= paletteSize) continue;
    if (seen[id]) continue;
    seen[id] = 1;
    count += 1;
    if (count >= paletteSize - 1) break;
  }
  return count;
};

const normalizePaintColor = (value?: string): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "transparent") return null;
  const rgbaMatch = raw.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i);
  if (rgbaMatch) {
    const alpha = Number(rgbaMatch[1]);
    if (Number.isFinite(alpha) && alpha <= 0) return null;
  }
  return raw;
};

const buildRegionsFromHosts = (hosts: HostPlan[]): RegionPlan[] =>
  hosts.map((host) => ({
    r0: host.r0,
    c0: host.c0,
    r1: host.r1,
    c1: host.c1,
    baseColorId: host.baseColorId,
    details: host.details
  }));

const buildDetailRectsForRegion = (
  region: RegionPlan,
  palette: string[],
  rectIdStart: number
): { rects: BrushRect[]; detailRects: number; nextId: number; detailsValid: boolean } => {
  if (!region.details.length) {
    return { rects: [], detailRects: 0, nextId: rectIdStart, detailsValid: true };
  }
  const byColor = new Map<string, Array<{ x: number; y: number; w: number; h: number }>>();
  for (const detail of region.details) {
    const rectRuns = getDetailRects(detail);
    if (!rectRuns.length) return { rects: [], detailRects: 0, nextId: rectIdStart, detailsValid: false };
    const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
    if (!fill) return { rects: [], detailRects: 0, nextId: rectIdStart, detailsValid: false };
    let list = byColor.get(fill);
    if (!list) {
      list = [];
      byColor.set(fill, list);
    }
    for (const rect of rectRuns) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      list.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
    }
  }
  const rects: BrushRect[] = [];
  let rectId = rectIdStart;
  let detailRects = 0;
  const width = Math.max(0, region.c1 - region.c0);
  const height = Math.max(0, region.r1 - region.r0);
  const rectEngine = width > 0 && height > 0 ? makeRectEngine(width, height) : null;
  const mask = rectEngine ? new Uint8Array(width * height) : null;
  for (const [color, runs] of byColor) {
    if (!runs.length) continue;
    let mergedRects: Array<{ r0: number; c0: number; r1: number; c1: number }> | null = null;
    if (rectEngine && mask) {
      mask.fill(0);
      let fillCells = 0;
      for (const run of runs) {
        const r0 = Math.max(0, run.y);
        const c0 = Math.max(0, run.x);
        const r1 = Math.min(height, run.y + run.h);
        const c1 = Math.min(width, run.x + run.w);
        if (r1 <= r0 || c1 <= c0) continue;
        for (let r = r0; r < r1; r += 1) {
          const rowBase = r * width;
          for (let c = c0; c < c1; c += 1) {
            if (!mask[rowBase + c]) {
              mask[rowBase + c] = 1;
              fillCells += 1;
            }
          }
        }
      }
      if (fillCells) {
        const limit = Math.max(runs.length, Math.min(DETAIL_MERGE_MAX_RECTS, fillCells));
        const merged = rectEngine.maxRects(mask, limit, fillCells);
        if (merged.coveredAll) {
          mergedRects = merged.rects.map((rect) => ({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 }));
        }
      }
    }
    if (mergedRects) {
      for (const rect of mergedRects) {
        const w = rect.c1 - rect.c0;
        const h = rect.r1 - rect.r0;
        if (w <= 0 || h <= 0) continue;
        rects.push({
          x: region.c0 + rect.c0,
          y: region.r0 + rect.r0,
          w,
          h,
          color,
          area: w * h,
          id: rectId++
        });
      }
      detailRects += mergedRects.length;
      continue;
    }
    for (const rect of runs) {
      rects.push({
        x: region.c0 + rect.x,
        y: region.r0 + rect.y,
        w: rect.w,
        h: rect.h,
        color,
        area: rect.w * rect.h,
        id: rectId++
      });
      detailRects += 1;
    }
  }
  return { rects, detailRects, nextId: rectId, detailsValid: true };
};

const buildBrushRects = (regions: RegionPlan[], palette: string[]): RectBuildResult => {
  const rects: BrushRect[] = [];
  let detailRects = 0;
  let detailsValid = true;
  let rectId = 0;
  for (const region of regions) {
    const hasDetails = region.details.length > 0;
    if (region.baseColorId >= 0) {
      const color = normalizePaintColor(palette[region.baseColorId]);
      if (!color) {
        detailsValid = false;
        break;
      }
      const w = region.c1 - region.c0;
      const h = region.r1 - region.r0;
      if (w > 0 && h > 0) {
        const rect = {
          x: region.c0,
          y: region.r0,
          w,
          h,
          color,
          area: w * h,
          id: rectId++
        };
        rects.push(rect);
      }
    }
    if (!hasDetails) continue;
    const detailResult = buildDetailRectsForRegion(region, palette, rectId);
    if (!detailResult.detailsValid) {
      detailsValid = false;
      break;
    }
    rectId = detailResult.nextId;
    detailRects += detailResult.detailRects;
    for (const detailRect of detailResult.rects) {
      rects.push(detailRect);
    }
    if (!detailsValid) break;
  }
  return { rects, detailRects, detailsValid };
};

const buildBasePackedBrushes = (rects: BrushRect[]): PackedBrush[] =>
  rects.map((rect) => ({
    r0: rect.y,
    c0: rect.x,
    r1: rect.y + rect.h,
    c1: rect.x + rect.w,
    baseColor: rect.color
  }));

const packedToBrush = (brush: PackedBrush): Brush => ({
  kind: "BASE",
  r0: brush.r0,
  c0: brush.c0,
  r1: brush.r1,
  c1: brush.c1,
  baseColor: brush.baseColor
});

const countTopLevelBrushes = (brushes: PackedBrush[]): number => brushes.length;

const getBrushBaseArea = (brush: PackedBrush): number => {
  const baseColor = normalizePaintColor(brush.baseColor);
  if (!baseColor) return 0;
  const baseW = brush.c1 - brush.c0;
  const baseH = brush.r1 - brush.r0;
  return baseW > 0 && baseH > 0 ? baseW * baseH : 0;
};

const getPackedPaintCells = (packed: PackedBrush[]): number => {
  let paintCells = 0;
  for (const brush of packed) {
    if (!brush) continue;
    paintCells += getBrushBaseArea(brush);
  }
  return paintCells;
};

const paintRectIds = (
  target: Uint32Array,
  width: number,
  height: number,
  rect: PaintRect | null,
  paletteIds: Map<string, number>
): boolean => {
  if (!rect) return true;
  const colorId = paletteIds.get(rect.color);
  if (!colorId) return false;
  const r0 = Math.max(0, rect.r0);
  const c0 = Math.max(0, rect.c0);
  const r1 = Math.min(height, rect.r1);
  const c1 = Math.min(width, rect.c1);
  if (r1 <= r0 || c1 <= c0) return true;
  for (let r = r0; r < r1; r += 1) {
    const rowBase = r * width;
    for (let c = c0; c < c1; c += 1) {
      target[rowBase + c] = colorId;
    }
  }
  return true;
};

const paintPackedBrushes = (
  buffer: FaceData["buffer"],
  brushes: PackedBrush[],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): boolean => {
  for (const brush of brushes) {
    if (!brush) continue;
    const rect: PaintRect = {
      r0: brush.r0,
      c0: brush.c0,
      r1: brush.r1,
      c1: brush.c1,
      color: brush.baseColor
    };
    if (!paintRectIds(scratch, buffer.width, buffer.height, rect, paletteIds)) return false;
  }
  return true;
};

const verifyPackedBrushes = (
  buffer: FaceData["buffer"],
  brushes: PackedBrush[],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): { ok: boolean; paintedCells: number } => {
  scratch.fill(0);
  if (!paintPackedBrushes(buffer, brushes, paletteIds, scratch)) {
    return { ok: false, paintedCells: 0 };
  }
  let paintedCells = 0;
  for (let i = 0; i < scratch.length; i += 1) {
    const value = scratch[i];
    if (value !== buffer.ids[i]) return { ok: false, paintedCells: 0 };
    if (value) paintedCells += 1;
  }
  return { ok: true, paintedCells };
};

const evaluatePackedPass = (
  packed: PackedBrush[],
  detailRects: number,
  uniqueColors: number,
  idealCells: number,
  buffer: FaceData["buffer"],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): PassResult => {
  const domEstimate = countTopLevelBrushes(packed);
  const verifyResult = verifyPackedBrushes(buffer, packed, paletteIds, scratch);
  if (!verifyResult.ok) {
    return {
      brushes: [],
      packed,
      metrics: {
        domEstimate: 0,
        detailRects,
        idealCells,
        paintedCells: 0,
        paintCost: 0,
        uniqueColors
      },
      scoreTotal: Number.POSITIVE_INFINITY,
      verified: false
    };
  }
  const paintCells = getPackedPaintCells(packed);
  const paintCost = paintCells;
  const metrics: SliceMetrics = {
    domEstimate,
    detailRects,
    idealCells,
    paintedCells: verifyResult.paintedCells,
    paintCost,
    uniqueColors
  };
  return {
    brushes: packed.map(packedToBrush),
    packed,
    metrics,
    scoreTotal: scorePlan(metrics, false),
    verified: true
  };
};

const buildFallbackCellBrushes = (buffer: FaceData["buffer"]): PackedBrush[] => {
  const brushes: PackedBrush[] = [];
  const { width, height, ids, palette } = buffer;
  for (let r = 0; r < height; r += 1) {
    const rowBase = r * width;
    for (let c = 0; c < width; c += 1) {
      const id = ids[rowBase + c];
      if (!id) continue;
      const baseColor = palette[id] ?? "";
      brushes.push({
        r0: r,
        c0: c,
        r1: r + 1,
        c1: c + 1,
        baseColor
      });
    }
  }
  return brushes;
};

const countTopLevelBrushKinds = (packed: PackedBrush[]): BrushCounts => ({
  base: packed.length
});

export const buildSlicePlan = (faceData: FaceData): SlicePlan => {
  const facePlan: FacePlan = buildFacePlan(faceData);
  const buffer = faceData.buffer;
  const regions = buildRegionsFromHosts(facePlan.hosts);
  const palette = buffer.palette;
  const rectResult = buildBrushRects(regions, palette);
  const paletteIds = new Map<string, number>();
  for (let i = 1; i < palette.length; i += 1) paletteIds.set(palette[i], i);
  const uniqueColors = computeUniqueColors(buffer.ids, palette.length);
  const idealCells = faceData.fillCells;
  const scratch = new Uint32Array(buffer.width * buffer.height);
  let best: PassResult | null = null;
  if (rectResult.detailsValid) {
    const passARaw = evaluatePackedPass(
      buildBasePackedBrushes(rectResult.rects),
      rectResult.detailRects,
      uniqueColors,
      idealCells,
      buffer,
      paletteIds,
      scratch
    );
    if (passARaw.verified) best = passARaw;
  }
  let fallback = false;
  if (!best) {
    fallback = true;
    const fallbackBrushes = buildFallbackCellBrushes(buffer);
    const fallbackPass = evaluatePackedPass(
      fallbackBrushes,
      rectResult.detailRects,
      uniqueColors,
      idealCells,
      buffer,
      paletteIds,
      scratch
    );
    if (fallbackPass.verified) {
      const metrics = { ...fallbackPass.metrics };
      const scoreTotal = scorePlan(metrics, true);
      best = { ...fallbackPass, metrics, scoreTotal, verified: true };
    } else {
      best = {
        kind: "fallback",
        brushes: [],
        packed: [],
        metrics: {
          domEstimate: 0,
          detailRects: rectResult.detailRects,
          idealCells,
          paintedCells: 0,
          paintCost: 0,
          uniqueColors
        },
        scoreTotal: Number.POSITIVE_INFINITY,
        verified: false
      };
    }
  }

  const metrics = best.metrics;
  const brushCounts = countTopLevelBrushKinds(best.packed);
  return {
    key: faceData.key,
    buffer,
    regions,
    brushes: best.brushes,
    brushCounts,
    metrics,
    scoreTotal: best.scoreTotal,
    status: fallback ? "degraded" : "ok",
    fallback
  };
};

export const buildAxisSlices = (plans: SlicePlan[]): AxisSlices => ({
  x: plans.filter((plan) => plan.key.axis === "x"),
  y: plans.filter((plan) => plan.key.axis === "y"),
  z: plans.filter((plan) => plan.key.axis === "z")
});

export { buildSliceCacheKey, buildFaceDataFromSnapshot };

export type BrushRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  area: number;
  id: number;
};

export type PackedBrush = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor: string;
};

export type PaintRect = { r0: number; c0: number; r1: number; c1: number; color: string };
