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

export type RegionPlan = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColorId: number;
  details: DetailPlan[];
};

export type Brush = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor: string;
};

export type SlicePlan = {
  key: FaceKey;
  buffer: FaceBuffer;
  regions: RegionPlan[];
  brushes: Brush[];
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
  warnedUnstableLayers?: boolean;
}

export const SLICE_RENDERER_VERSION = 1;

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
    warnedUnstableLayers: false
  };
};

export function clearSliceRenderer(sliceRenderer: SliceRendererDomState | null): void {
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
}

type PassResult = {
  brushes: Brush[];
  verified: boolean;
};

type RectBuildResult = {
  rects: BrushRect[];
  detailsValid: boolean;
};

const DETAIL_MERGE_MAX_RECTS = 256;

const buildSliceCacheKey = (face: FaceData): string =>
  `slice:${SLICE_RENDERER_VERSION}:${buildFaceCacheKey(face)}`;

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
  palette: string[]
): { rects: BrushRect[]; detailsValid: boolean } => {
  if (!region.details.length) {
    return { rects: [], detailsValid: true };
  }
  const byColor = new Map<string, Array<{ x: number; y: number; w: number; h: number }>>();
  for (const detail of region.details) {
    const rectRuns = getDetailRects(detail);
    if (!rectRuns.length) return { rects: [], detailsValid: false };
    const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
    if (!fill) return { rects: [], detailsValid: false };
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
          color
        });
      }
      continue;
    }
    for (const rect of runs) {
      rects.push({
        x: region.c0 + rect.x,
        y: region.r0 + rect.y,
        w: rect.w,
        h: rect.h,
        color
      });
    }
  }
  return { rects, detailsValid: true };
};

const buildBrushRects = (regions: RegionPlan[], palette: string[]): RectBuildResult => {
  const rects: BrushRect[] = [];
  let detailsValid = true;
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
        rects.push({
          x: region.c0,
          y: region.r0,
          w,
          h,
          color
        });
      }
    }
    if (!hasDetails) continue;
    const detailResult = buildDetailRectsForRegion(region, palette);
    if (!detailResult.detailsValid) {
      detailsValid = false;
      break;
    }
    for (const detailRect of detailResult.rects) {
      rects.push(detailRect);
    }
    if (!detailsValid) break;
  }
  return { rects, detailsValid };
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
  r0: brush.r0,
  c0: brush.c0,
  r1: brush.r1,
  c1: brush.c1,
  baseColor: brush.baseColor
});

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
): boolean => {
  scratch.fill(0);
  if (!paintPackedBrushes(buffer, brushes, paletteIds, scratch)) return false;
  for (let i = 0; i < scratch.length; i += 1) {
    const value = scratch[i];
    if (value !== buffer.ids[i]) return false;
  }
  return true;
};

const evaluatePackedPass = (
  packed: PackedBrush[],
  buffer: FaceData["buffer"],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): PassResult => {
  if (!verifyPackedBrushes(buffer, packed, paletteIds, scratch)) {
    return { brushes: [], verified: false };
  }
  return { brushes: packed.map(packedToBrush), verified: true };
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

export const buildSlicePlan = (faceData: FaceData): SlicePlan => {
  const facePlan: FacePlan = buildFacePlan(faceData);
  const buffer = faceData.buffer;
  const regions = buildRegionsFromHosts(facePlan.hosts);
  const palette = buffer.palette;
  const rectResult = buildBrushRects(regions, palette);
  const paletteIds = new Map<string, number>();
  for (let i = 1; i < palette.length; i += 1) paletteIds.set(palette[i], i);
  const scratch = new Uint32Array(buffer.width * buffer.height);
  let best: PassResult | null = null;
  if (rectResult.detailsValid) {
    const passARaw = evaluatePackedPass(
      buildBasePackedBrushes(rectResult.rects),
      buffer,
      paletteIds,
      scratch
    );
    if (passARaw.verified) best = passARaw;
  }
  if (!best) {
    const fallbackBrushes = buildFallbackCellBrushes(buffer);
    const fallbackPass = evaluatePackedPass(
      fallbackBrushes,
      buffer,
      paletteIds,
      scratch
    );
    if (fallbackPass.verified) {
      best = fallbackPass;
    } else {
      best = {
        brushes: [],
        verified: false
      };
    }
  }

  return {
    key: faceData.key,
    buffer,
    regions,
    brushes: best.brushes
  };
};

export { buildSliceCacheKey, buildFaceDataFromSnapshot };

export type BrushRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

export type PackedBrush = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor: string;
};

export type PaintRect = { r0: number; c0: number; r1: number; c1: number; color: string };
