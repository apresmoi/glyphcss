import type { FaceData, FacePlan, HostPlan } from "../shellRenderer/types";
import type { AxisSlices, Brush, RegionPlan, SliceMetrics, SlicePlan } from "./types";
import { scorePlan, SLICE_RENDERER_VERSION } from "./types";
import { buildCacheKey as buildShellCacheKey, buildFaceDataFromSnapshot, buildFacePlan } from "../shellRenderer/plan";
import { getDetailRects } from "../shellRenderer/types";
import {
  buildBrushPairing,
  optimizeBrushOverlaps,
  packRectsToBrushes,
  type AbsorbPlan,
  type BrushPairing,
  type BrushRect,
  type PackedBrush
} from "../shellRenderer/render";

type PassKind = "raw" | "packed" | "merge" | "svg" | "gradient" | "hybrid" | "fallback";

type PassResult = {
  kind: PassKind;
  brushes: Brush[];
  packed: PackedBrush[];
  pairing: BrushPairing;
  compositeEstimate: number;
  metrics: SliceMetrics;
  scoreTotal: number;
  verified: boolean;
};

type RectBuildResult = {
  rects: BrushRect[];
  baseRects: BrushRect[];
  detailRectsList: BrushRect[];
  baseOnlyRects: number;
  detailRects: number;
  detailsValid: boolean;
};

type BrushCounts = { base: number; stamp: number; combo: number; svg: number; gradient: number };

const sliceToggle = (key: string, fallback: boolean): boolean => {
  if (typeof globalThis === "undefined") return fallback;
  const value = (globalThis as Record<string, unknown>)[key];
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
};

const SLICE_ENABLE_BRUSH = sliceToggle("__voxcssSliceEnableBrush", true);
const SLICE_ENABLE_STAMP = sliceToggle("__voxcssSliceEnableStamp", false);
const SLICE_ENABLE_SVG = sliceToggle("__voxcssSliceEnableSvg", false);
const SLICE_ENABLE_GRADIENT = sliceToggle("__voxcssSliceEnableGradient", true);
const SLICE_ENABLE_PSEUDOS = sliceToggle("__voxcssSliceEnablePseudos", false);
type GradientStop = { start: number; end: number; color: string };

const MAX_GRADIENT_STOPS = 12;
const MAX_SIMPLE_GRADIENT_STOPS = 8;
const GRADIENT_MAX_DETAIL_RECTS = 64;
const GRADIENT_MAX_DETAIL_AREA_RATIO = 0.85;
const GRADIENT_MAX_DETAIL_COLORS = 6;
const GRADIENT_MAX_NON_BASE_STOPS = 4;
const GRADIENT_ALLOW_STRIPE_OVERDRAW = true;
const GRADIENT_MAX_STRIPE_AREA_RATIO = 0.5;
const GRADIENT_FORCE_SIMPLE = true;
const SVG_DETAIL_RECTS_MIN = 24;
const SVG_DETAIL_AREA_RATIO_MIN = 0.4;
const SVG_DETAIL_COLORS_MIN = 4;
const SVG_DETAIL_COLORS_RECTS_MIN = 8;

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

const buildSliceCacheKey = (face: FaceData): string =>
  `slice:${SLICE_RENDERER_VERSION}:${buildShellCacheKey(face)}`;

const buildRegionsFromHosts = (hosts: HostPlan[]): RegionPlan[] =>
  hosts.map((host) => ({
    r0: host.r0,
    c0: host.c0,
    r1: host.r1,
    c1: host.c1,
    baseColorId: host.baseColorId,
    details: host.details
  }));

const buildBrushRects = (regions: RegionPlan[], palette: string[]): RectBuildResult => {
  const rects: BrushRect[] = [];
  const baseRects: BrushRect[] = [];
  const detailRectsList: BrushRect[] = [];
  let baseOnlyRects = 0;
  let detailRects = 0;
  let detailsValid = true;
  let rectId = 0;
  let baseRectId = 0;
  let detailRectId = 0;
  for (const region of regions) {
    const hasDetails = region.details.length > 0;
    if (!hasDetails && region.baseColorId >= 0) baseOnlyRects += 1;
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
        baseRects.push({ ...rect, id: baseRectId++ });
      }
    }
    if (!hasDetails) continue;
    for (const detail of region.details) {
      const rectRuns = getDetailRects(detail);
      if (!rectRuns.length) {
        detailsValid = false;
        break;
      }
      const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
      if (!fill) {
        detailsValid = false;
        break;
      }
      detailRects += rectRuns.length;
      for (const rect of rectRuns) {
        const w = rect.width;
        const h = rect.height;
        if (w <= 0 || h <= 0) continue;
        const detailRect = {
          x: region.c0 + rect.x,
          y: region.r0 + rect.y,
          w,
          h,
          color: fill,
          area: w * h,
          id: rectId++
        };
        rects.push(detailRect);
        detailRectsList.push({ ...detailRect, id: detailRectId++ });
      }
    }
    if (!detailsValid) break;
  }
  return { rects, baseRects, detailRectsList, baseOnlyRects, detailRects, detailsValid };
};

const buildGradientStops = (
  size: number,
  baseColor: string,
  segments: Array<{ start: number; end: number; color: string }>
): GradientStop[] | null => {
  if (size <= 0) return null;
  const colors = new Array<string>(size).fill(baseColor);
  for (const segment of segments) {
    const start = Math.max(0, segment.start);
    const end = Math.min(size, segment.end);
    if (end <= start) continue;
    for (let i = start; i < end; i += 1) {
      const existing = colors[i];
      if (existing !== baseColor && existing !== segment.color) return null;
      colors[i] = segment.color;
    }
  }
  const stops: GradientStop[] = [];
  let current = colors[0];
  let start = 0;
  for (let i = 1; i < size; i += 1) {
    if (colors[i] === current) continue;
    stops.push({ start, end: i, color: current });
    if (stops.length > MAX_GRADIENT_STOPS) return null;
    start = i;
    current = colors[i];
  }
  stops.push({ start, end: size, color: current });
  if (stops.length > MAX_GRADIENT_STOPS || stops.length <= 1) return null;
  return stops;
};

const buildGradientBrush = (
  region: RegionPlan,
  palette: string[]
): { brush: Brush; stopCount: number; detailRects: number } | null => {
  if (!region.details.length || region.baseColorId < 0) return null;
  const baseColor = normalizePaintColor(palette[region.baseColorId]);
  if (!baseColor) return null;
  const width = region.c1 - region.c0;
  const height = region.r1 - region.r0;
  if (width <= 0 || height <= 0) return null;

  const rects: Array<{ x: number; y: number; w: number; h: number; color: string }> = [];
  let detailRects = 0;
  let detailArea = 0;
  const detailColors = new Set<string>();
  for (const detail of region.details) {
    const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
    if (!fill) return null;
    const rectRuns = getDetailRects(detail);
    if (!rectRuns.length) return null;
    detailColors.add(fill);
    detailRects += rectRuns.length;
    for (const rect of rectRuns) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      detailArea += rect.width * rect.height;
      rects.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, color: fill });
    }
  }
  if (!detailRects || !rects.length) return null;
  const hostArea = width * height;
  const detailAreaRatio = hostArea ? detailArea / hostArea : 0;
  if (
    detailRects > GRADIENT_MAX_DETAIL_RECTS ||
    detailAreaRatio > GRADIENT_MAX_DETAIL_AREA_RATIO ||
    detailColors.size > GRADIENT_MAX_DETAIL_COLORS
  ) {
    return null;
  }

  const coversAxisSpan = (intervals: Array<[number, number]>, span: number): boolean => {
    if (span <= 0 || !intervals.length) return false;
    const sorted = intervals
      .map(([start, end]) => [Math.max(0, start), Math.min(span, end)] as [number, number])
      .filter(([start, end]) => end > start)
      .sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
    if (!sorted.length) return false;
    let covered = 0;
    let [currentStart, currentEnd] = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      const [start, end] = sorted[i];
      if (end <= currentEnd) continue;
      if (start > currentEnd) {
        covered += currentEnd - currentStart;
        currentStart = start;
        currentEnd = end;
        continue;
      }
      currentEnd = end;
    }
    covered += currentEnd - currentStart;
    return covered >= span;
  };

  const canRepresentAxis = (axis: "x" | "y"): boolean => {
    const stripeGroups = new Map<string, { color: string; spans: Array<[number, number]> }>();
    const span = axis === "y" ? width : height;
    for (const rect of rects) {
      if (rect.color === baseColor) continue;
      const start = axis === "y" ? rect.y : rect.x;
      const end = axis === "y" ? rect.y + rect.h : rect.x + rect.w;
      const crossStart = axis === "y" ? rect.x : rect.y;
      const crossEnd = axis === "y" ? rect.x + rect.w : rect.y + rect.h;
      const key = `${start}:${end}`;
      const existing = stripeGroups.get(key);
      if (!existing) {
        stripeGroups.set(key, { color: rect.color, spans: [[crossStart, crossEnd]] });
        continue;
      }
      if (existing.color !== rect.color) return false;
      existing.spans.push([crossStart, crossEnd]);
    }
    let needsOverdraw = false;
    for (const group of stripeGroups.values()) {
      if (coversAxisSpan(group.spans, span)) continue;
      needsOverdraw = true;
    }
    if (!needsOverdraw) return true;
    if (!GRADIENT_ALLOW_STRIPE_OVERDRAW) return false;
    if (stripeGroups.size !== 1) return false;
    if (detailAreaRatio > GRADIENT_MAX_STRIPE_AREA_RATIO) return false;
    return true;
  };

  let canY = canRepresentAxis("y");
  let canX = canRepresentAxis("x");
  if (!canY && !canX) return null;

  const buildStopsForAxis = (axis: "x" | "y"): GradientStop[] | null => {
    if (axis === "y") {
      const segments = rects.map((rect) => ({
        start: rect.y,
        end: rect.y + rect.h,
        color: rect.color
      }));
      return buildGradientStops(height, baseColor, segments);
    }
    const segments = rects.map((rect) => ({
      start: rect.x,
      end: rect.x + rect.w,
      color: rect.color
    }));
    return buildGradientStops(width, baseColor, segments);
  };

  let stopsY = canY ? buildStopsForAxis("y") : null;
  let stopsX = canX ? buildStopsForAxis("x") : null;
  if (!canY && !canX && GRADIENT_FORCE_SIMPLE && detailColors.size === 1) {
    stopsY = buildStopsForAxis("y");
    stopsX = buildStopsForAxis("x");
    canY = !!stopsY;
    canX = !!stopsX;
  }
  if (!canY && !canX) return null;
  let axis: "x" | "y" | null = null;
  let stops: GradientStop[] | null = null;
  if (stopsY && stopsX) {
    axis = stopsY.length <= stopsX.length ? "y" : "x";
    stops = axis === "y" ? stopsY : stopsX;
  } else if (stopsY) {
    axis = "y";
    stops = stopsY;
  } else if (stopsX) {
    axis = "x";
    stops = stopsX;
  }
  if (!axis || !stops) return null;
  if (stops.length > MAX_GRADIENT_STOPS) return null;
  const nonBaseStops = stops.reduce((sum, stop) => sum + (stop.color === baseColor ? 0 : 1), 0);
  if (nonBaseStops > GRADIENT_MAX_NON_BASE_STOPS) return null;

  return {
    brush: {
      kind: "GRADIENT",
      r0: region.r0,
      c0: region.c0,
      r1: region.r1,
      c1: region.c1,
      baseColor,
      gradientAxis: axis,
      gradientStops: stops
    },
    stopCount: stops.length,
    detailRects
  };
};

const buildGradientBrushes = (
  regions: RegionPlan[],
  palette: string[],
  skipRegions?: Set<number>
): { brushes: Brush[]; skipRegions: Set<number>; gradientStops: number; gradientDetailRects: number } => {
  const brushes: Brush[] = [];
  const gradientRegions = new Set<number>();
  let gradientStops = 0;
  let gradientDetailRects = 0;
  for (let i = 0; i < regions.length; i += 1) {
    if (skipRegions?.has(i)) continue;
    const region = regions[i];
    const result = buildGradientBrush(region, palette);
    if (!result) continue;
    brushes.push(result.brush);
    gradientRegions.add(i);
    gradientStops += result.stopCount;
    gradientDetailRects += result.detailRects;
  }
  return { brushes, skipRegions: gradientRegions, gradientStops, gradientDetailRects };
};

type RegionDetailStats = {
  detailRects: number;
  detailArea: number;
  detailColors: number;
  detailAreaRatio: number;
};

const getRegionDetailStats = (region: RegionPlan, palette: string[]): RegionDetailStats | null => {
  if (!region.details.length) return null;
  let detailRects = 0;
  let detailArea = 0;
  const detailColors = new Set<string>();
  for (const detail of region.details) {
    const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
    if (!fill) return null;
    const rectRuns = getDetailRects(detail);
    if (!rectRuns.length) return null;
    detailColors.add(fill);
    detailRects += rectRuns.length;
    for (const rect of rectRuns) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      detailArea += rect.width * rect.height;
    }
  }
  if (!detailRects) return null;
  const hostArea = Math.max(0, region.c1 - region.c0) * Math.max(0, region.r1 - region.r0);
  const detailAreaRatio = hostArea ? detailArea / hostArea : 0;
  return { detailRects, detailArea, detailColors: detailColors.size, detailAreaRatio };
};

const selectSvgRegions = (regions: RegionPlan[], palette: string[]): { svgRegions: Set<number>; svgDetailRects: number } => {
  const svgRegions = new Set<number>();
  let svgDetailRects = 0;
  for (let i = 0; i < regions.length; i += 1) {
    const stats = getRegionDetailStats(regions[i], palette);
    if (!stats) continue;
    const isSvg =
      stats.detailRects >= SVG_DETAIL_RECTS_MIN ||
      stats.detailAreaRatio >= SVG_DETAIL_AREA_RATIO_MIN ||
      (stats.detailColors >= SVG_DETAIL_COLORS_MIN && stats.detailRects >= SVG_DETAIL_COLORS_RECTS_MIN);
    if (!isSvg) continue;
    svgRegions.add(i);
    svgDetailRects += stats.detailRects;
  }
  return { svgRegions, svgDetailRects };
};

const buildRectListForRegions = (
  regions: RegionPlan[],
  palette: string[],
  options?: Set<number> | { skipRegions?: Set<number>; skipBaseRegions?: Set<number>; skipDetailRegions?: Set<number> }
): BrushRect[] => {
  const resolved = options instanceof Set ? { skipRegions: options } : options ?? {};
  const skipRegions = resolved.skipRegions ?? new Set<number>();
  const skipBaseRegions = resolved.skipBaseRegions ?? skipRegions;
  const skipDetailRegions = resolved.skipDetailRegions ?? skipRegions;
  const rects: BrushRect[] = [];
  let rectId = 0;
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    if (region.baseColorId >= 0 && !skipBaseRegions.has(i)) {
      const color = normalizePaintColor(palette[region.baseColorId]);
      if (!color) continue;
      const w = region.c1 - region.c0;
      const h = region.r1 - region.r0;
      if (w > 0 && h > 0) {
        rects.push({
          x: region.c0,
          y: region.r0,
          w,
          h,
          color,
          area: w * h,
          id: rectId++
        });
      }
    }
    if (skipDetailRegions.has(i)) continue;
    if (!region.details.length) continue;
    for (const detail of region.details) {
      const rectRuns = getDetailRects(detail);
      if (!rectRuns.length) continue;
      const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
      if (!fill) continue;
      for (const rect of rectRuns) {
        const w = rect.width;
        const h = rect.height;
        if (w <= 0 || h <= 0) continue;
        rects.push({
          x: region.c0 + rect.x,
          y: region.r0 + rect.y,
          w,
          h,
          color: fill,
          area: w * h,
          id: rectId++
        });
      }
    }
  }
  return rects;
};

const buildBasePackedBrushes = (rects: BrushRect[]): PackedBrush[] =>
  rects.map((rect) => ({
    mode: "BASE",
    r0: rect.y,
    c0: rect.x,
    r1: rect.y + rect.h,
    c1: rect.x + rect.w,
    baseColor: rect.color
  }));

const packedToBrush = (brush: PackedBrush): Brush => ({
  kind: brush.mode,
  r0: brush.r0,
  c0: brush.c0,
  r1: brush.r1,
  c1: brush.c1,
  baseColor: brush.baseColor,
  before: brush.before ? { x: brush.before.x, y: brush.before.y, w: brush.before.w, h: brush.before.h, color: brush.before.color } : undefined,
  after: brush.after ? { x: brush.after.x, y: brush.after.y, w: brush.after.w, h: brush.after.h, color: brush.after.color } : undefined
});

const countTopLevelBrushes = (brushes: PackedBrush[], pairing: BrushPairing): number => {
  let count = 0;
  for (let i = 0; i < brushes.length; i += 1) {
    if (pairing.children.has(i)) continue;
    count += 1;
  }
  return count;
};

const buildSvgBrushes = (
  regions: RegionPlan[],
  palette: string[],
  includeRegions?: Set<number>
): Brush[] => {
  const brushes: Brush[] = [];
  for (let i = 0; i < regions.length; i += 1) {
    if (includeRegions && !includeRegions.has(i)) continue;
    const region = regions[i];
    if (!region.details.length) continue;
    const svgPaths: Array<{ path: string; color: string }> = [];
    let paintArea = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const detail of region.details) {
      const fill = normalizePaintColor(detail.fill || palette[detail.colorId]);
      if (!fill || !detail.path) continue;
      const rectRuns = getDetailRects(detail);
      if (!rectRuns.length) continue;
      for (const rect of rectRuns) {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
        paintArea += rect.width * rect.height;
      }
      svgPaths.push({ path: detail.path, color: fill });
    }
    if (!svgPaths.length) continue;
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue;
    const boxW = maxX - minX;
    const boxH = maxY - minY;
    if (boxW <= 0 || boxH <= 0) continue;
    brushes.push({
      kind: "SVG",
      r0: region.r0 + minY,
      c0: region.c0 + minX,
      r1: region.r0 + maxY,
      c1: region.c0 + maxX,
      svgPaths,
      svgViewBox: `${minX} ${minY} ${boxW} ${boxH}`,
      svgPaintArea: paintArea
    });
  }
  return brushes;
};

const getBrushPaintedCells = (brush: PackedBrush): number => {
  const baseColor = normalizePaintColor(brush.baseColor);
  const baseW = brush.c1 - brush.c0;
  const baseH = brush.r1 - brush.r0;
  const baseArea = baseColor && baseW > 0 && baseH > 0 ? baseW * baseH : 0;
  if (baseArea) return baseArea;
  const before = brush.before && normalizePaintColor(brush.before.color) ? brush.before : null;
  const after = brush.after && normalizePaintColor(brush.after.color) ? brush.after : null;
  const beforeArea = before && before.w > 0 && before.h > 0 ? before.w * before.h : 0;
  const afterArea = after && after.w > 0 && after.h > 0 ? after.w * after.h : 0;
  if (!beforeArea) return afterArea;
  if (!afterArea) return beforeArea;
  const ix0 = Math.max(before.x, after.x);
  const iy0 = Math.max(before.y, after.y);
  const ix1 = Math.min(before.x + before.w, after.x + after.w);
  const iy1 = Math.min(before.y + before.h, after.y + after.h);
  const overlap = ix1 > ix0 && iy1 > iy0 ? (ix1 - ix0) * (iy1 - iy0) : 0;
  return beforeArea + afterArea - overlap;
};

const paintRectToBrushRect = (rect: { r0: number; c0: number; r1: number; c1: number; color: string }): BrushRect => ({
  x: rect.c0,
  y: rect.r0,
  w: rect.c1 - rect.c0,
  h: rect.r1 - rect.r0,
  color: rect.color,
  area: Math.max(0, rect.c1 - rect.c0) * Math.max(0, rect.r1 - rect.r0),
  id: -1
});

const getBrushBaseArea = (brush: PackedBrush): number => {
  const baseColor = normalizePaintColor(brush.baseColor);
  if (!baseColor) return 0;
  const baseW = brush.c1 - brush.c0;
  const baseH = brush.r1 - brush.r0;
  return baseW > 0 && baseH > 0 ? baseW * baseH : 0;
};

const getBrushPseudoArea = (brush: PackedBrush, absorbPlans?: AbsorbPlan[]): number => {
  if (!SLICE_ENABLE_PSEUDOS) return 0;
  let beforeRect = brush.before;
  let afterRect = brush.after;
  if (absorbPlans) {
    for (const absorb of absorbPlans) {
      if (absorb.slot === "before") beforeRect = paintRectToBrushRect(absorb.rect);
      else if (absorb.slot === "after") afterRect = paintRectToBrushRect(absorb.rect);
    }
  }
  let area = 0;
  if (beforeRect && normalizePaintColor(beforeRect.color)) {
    area += Math.max(0, beforeRect.w) * Math.max(0, beforeRect.h);
  }
  if (afterRect && normalizePaintColor(afterRect.color)) {
    area += Math.max(0, afterRect.w) * Math.max(0, afterRect.h);
  }
  return area;
};

const getPackedPaintStats = (
  packed: PackedBrush[],
  pairing: BrushPairing
): { paintCells: number; pseudoArea: number } => {
  let paintCells = 0;
  let pseudoArea = 0;
  for (let i = 0; i < packed.length; i += 1) {
    if (pairing.children.has(i)) continue;
    const brush = packed[i];
    if (!brush) continue;
    paintCells += getBrushBaseArea(brush);
    const absorbPlans = pairing.absorbed.get(i);
    pseudoArea += getBrushPseudoArea(brush, absorbPlans);
  }
  return { paintCells, pseudoArea };
};

type PaintRect = { r0: number; c0: number; r1: number; c1: number; color: string };

const resolveLayers = (
  brush: PackedBrush,
  absorbPlans?: AbsorbPlan[]
): { base: PaintRect | null; before: PaintRect | null; after: PaintRect | null } => {
  const baseColor = normalizePaintColor(brush.baseColor);
  const base = baseColor
    ? { r0: brush.r0, c0: brush.c0, r1: brush.r1, c1: brush.c1, color: baseColor }
    : null;
  let beforeRect = brush.before;
  let afterRect = brush.after;
  if (absorbPlans) {
    for (const absorb of absorbPlans) {
      if (absorb.slot === "before") beforeRect = paintRectToBrushRect(absorb.rect);
      else if (absorb.slot === "after") afterRect = paintRectToBrushRect(absorb.rect);
    }
  }
  if (beforeRect && afterRect) {
    const beforeArea = beforeRect.w * beforeRect.h;
    const afterArea = afterRect.w * afterRect.h;
    if (beforeArea <= afterArea) {
      const swap = afterRect;
      afterRect = beforeRect;
      beforeRect = swap;
    }
  }
  if (!afterRect && beforeRect) {
    afterRect = beforeRect;
    beforeRect = undefined;
  }
  const beforeColor = beforeRect ? normalizePaintColor(beforeRect.color) : null;
  const afterColor = afterRect ? normalizePaintColor(afterRect.color) : null;
  const before = beforeRect && beforeColor
    ? { r0: beforeRect.y, c0: beforeRect.x, r1: beforeRect.y + beforeRect.h, c1: beforeRect.x + beforeRect.w, color: beforeColor }
    : null;
  const after = afterRect && afterColor
    ? { r0: afterRect.y, c0: afterRect.x, r1: afterRect.y + afterRect.h, c1: afterRect.x + afterRect.w, color: afterColor }
    : null;
  return { base, before, after };
};

const paintRectIds = (
  target: Uint32Array,
  width: number,
  height: number,
  rect: PaintRect | null,
  paletteIds: Map<string, number>
): number | null => {
  if (!rect) return 0;
  const colorId = paletteIds.get(rect.color);
  if (!colorId) return null;
  const r0 = Math.max(0, rect.r0);
  const c0 = Math.max(0, rect.c0);
  const r1 = Math.min(height, rect.r1);
  const c1 = Math.min(width, rect.c1);
  if (r1 <= r0 || c1 <= c0) return 0;
  const area = (r1 - r0) * (c1 - c0);
  for (let r = r0; r < r1; r += 1) {
    const rowBase = r * width;
    for (let c = c0; c < c1; c += 1) {
      target[rowBase + c] = colorId;
    }
  }
  return area;
};

const paintPackedBrushes = (
  buffer: FaceData["buffer"],
  brushes: PackedBrush[],
  pairing: BrushPairing,
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): boolean => {
  const brushOrder: number[] = [];
  const paintedAreas: number[] = [];
  for (let i = 0; i < brushes.length; i += 1) {
    if (pairing.children.has(i)) continue;
    brushOrder.push(i);
  }
  for (let i = 0; i < brushes.length; i += 1) {
    paintedAreas[i] = getBrushPaintedCells(brushes[i]);
  }
  brushOrder.sort((a, b) => {
    const areaA = paintedAreas[a] ?? 0;
    const areaB = paintedAreas[b] ?? 0;
    if (areaA !== areaB) return areaB - areaA;
    return a - b;
  });
  for (const index of brushOrder) {
    const brush = brushes[index];
    if (!brush) continue;
    const absorbPlans = pairing.absorbed.get(index);
    const layers = resolveLayers(brush, absorbPlans);
    const basePainted = paintRectIds(scratch, buffer.width, buffer.height, layers.base, paletteIds);
    if (basePainted === null) return false;
    const beforePainted = paintRectIds(scratch, buffer.width, buffer.height, layers.before, paletteIds);
    if (beforePainted === null) return false;
    const afterPainted = paintRectIds(scratch, buffer.width, buffer.height, layers.after, paletteIds);
    if (afterPainted === null) return false;
  }
  return true;
};

const paintGradientBrushes = (
  buffer: FaceData["buffer"],
  brushes: Brush[],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): boolean => {
  for (const brush of brushes) {
    if (brush.kind !== "GRADIENT") continue;
    const axis = brush.gradientAxis;
    const stops = brush.gradientStops;
    if (!axis || !stops?.length) return false;
    if (axis === "y") {
      for (const stop of stops) {
        const rect: PaintRect = {
          r0: brush.r0 + stop.start,
          c0: brush.c0,
          r1: brush.r0 + stop.end,
          c1: brush.c1,
          color: stop.color
        };
        const painted = paintRectIds(scratch, buffer.width, buffer.height, rect, paletteIds);
        if (painted === null) return false;
      }
    } else {
      for (const stop of stops) {
        const rect: PaintRect = {
          r0: brush.r0,
          c0: brush.c0 + stop.start,
          r1: brush.r1,
          c1: brush.c0 + stop.end,
          color: stop.color
        };
        const painted = paintRectIds(scratch, buffer.width, buffer.height, rect, paletteIds);
        if (painted === null) return false;
      }
    }
  }
  return true;
};

const verifyPackedBrushes = (
  buffer: FaceData["buffer"],
  brushes: PackedBrush[],
  pairing: BrushPairing,
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): { ok: boolean; paintedCells: number } => {
  scratch.fill(0);
  if (!paintPackedBrushes(buffer, brushes, pairing, paletteIds, scratch)) {
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

const verifyGradientBrushes = (
  buffer: FaceData["buffer"],
  packed: PackedBrush[],
  pairing: BrushPairing,
  gradientBrushes: Brush[],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): { ok: boolean; paintedCells: number } => {
  scratch.fill(0);
  if (!paintPackedBrushes(buffer, packed, pairing, paletteIds, scratch)) {
    return { ok: false, paintedCells: 0 };
  }
  if (!paintGradientBrushes(buffer, gradientBrushes, paletteIds, scratch)) {
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
  kind: PassKind,
  packed: PackedBrush[],
  baseOnlyRects: number,
  detailRects: number,
  uniqueColors: number,
  idealCells: number,
  buffer: FaceData["buffer"],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): PassResult => {
  const pairing = buildBrushPairing(packed);
  const domEstimate = countTopLevelBrushes(packed, pairing);
  const compositeEstimate = domEstimate;
  const verifyResult = verifyPackedBrushes(buffer, packed, pairing, paletteIds, scratch);
  if (!verifyResult.ok) {
    return {
      kind,
      brushes: [],
      packed,
      pairing,
      compositeEstimate,
      metrics: {
        domEstimate: 0,
        baseOnlyRects,
        detailRects,
        svgPaths: 0,
        gradientStops: 0,
        splitCount: 0,
        idealCells,
        paintedCells: 0,
        paintCells: 0,
        pseudoArea: 0,
        paintCost: 0,
        uniqueColors
      },
      scoreTotal: Number.POSITIVE_INFINITY,
      verified: false
    };
  }
  const { paintCells, pseudoArea } = getPackedPaintStats(packed, pairing);
  const paintCost = paintCells + pseudoArea;
  const metrics: SliceMetrics = {
    domEstimate,
    baseOnlyRects,
    detailRects,
    svgPaths: 0,
    gradientStops: 0,
    splitCount: 0,
    idealCells,
    paintedCells: verifyResult.paintedCells,
    paintCells,
    pseudoArea,
    paintCost,
    uniqueColors
  };
  return {
    kind,
    brushes: packed.map(packedToBrush),
    packed,
    pairing,
    compositeEstimate,
    metrics,
    scoreTotal: scorePlan(metrics, false),
    verified: true
  };
};

const evaluateSvgPass = (
  basePacked: PackedBrush[],
  svgBrushes: Brush[],
  baseOnlyRects: number,
  detailRects: number,
  uniqueColors: number,
  idealCells: number,
  buffer: FaceData["buffer"],
  paletteIds: Map<string, number>,
  scratch: Uint32Array,
  verifyPacked: PackedBrush[],
  verifyPairing: BrushPairing
): PassResult => {
  const pairing = buildBrushPairing(basePacked);
  const svgPathCount = svgBrushes.reduce((sum, brush) => sum + (brush.svgPaths?.length ?? 0), 0);
  const baseTopLevel = countTopLevelBrushes(basePacked, pairing);
  const domEstimate = baseTopLevel + svgBrushes.length * 2 + svgPathCount;
  const compositeEstimate = baseTopLevel + svgBrushes.length;
  const verifyResult = verifyPackedBrushes(buffer, verifyPacked, verifyPairing, paletteIds, scratch);
  if (!verifyResult.ok) {
    return {
      kind: "svg",
      brushes: [],
      packed: basePacked,
      pairing,
      compositeEstimate,
      metrics: {
        domEstimate: 0,
        baseOnlyRects,
        detailRects,
        svgPaths: 0,
        gradientStops: 0,
        splitCount: 0,
        idealCells,
        paintedCells: 0,
        paintCells: 0,
        pseudoArea: 0,
        paintCost: 0,
        uniqueColors
      },
      scoreTotal: Number.POSITIVE_INFINITY,
      verified: false
    };
  }
  const basePaintStats = getPackedPaintStats(basePacked, pairing);
  const svgArea = svgBrushes.reduce((sum, brush) => sum + (brush.svgPaintArea ?? 0), 0);
  const paintCells = basePaintStats.paintCells + svgArea;
  const pseudoArea = basePaintStats.pseudoArea;
  const paintCost = paintCells + pseudoArea;
  const metrics: SliceMetrics = {
    domEstimate,
    baseOnlyRects,
    detailRects,
    svgPaths: svgPathCount,
    gradientStops: 0,
    splitCount: 0,
    idealCells,
    paintedCells: verifyResult.paintedCells,
    paintCells,
    pseudoArea,
    paintCost,
    uniqueColors
  };
  return {
    kind: "svg",
    brushes: [...basePacked.map(packedToBrush), ...svgBrushes],
    packed: basePacked,
    pairing,
    compositeEstimate,
    metrics,
    scoreTotal: scorePlan(metrics, false, { detailCount: metrics.svgPaths, fragCount: metrics.svgPaths }),
    verified: true
  };
};

const evaluateGradientPass = (
  packed: PackedBrush[],
  gradientBrushes: Brush[],
  gradientStops: number,
  gradientDetailRects: number,
  baseOnlyRects: number,
  detailRects: number,
  uniqueColors: number,
  idealCells: number,
  buffer: FaceData["buffer"],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): PassResult => {
  const pairing = buildBrushPairing(packed);
  const domEstimate = countTopLevelBrushes(packed, pairing) + gradientBrushes.length;
  const compositeEstimate = domEstimate;
  const verifyResult = verifyGradientBrushes(buffer, packed, pairing, gradientBrushes, paletteIds, scratch);
  if (!verifyResult.ok) {
    return {
      kind: "gradient",
      brushes: [],
      packed,
      pairing,
      compositeEstimate,
      metrics: {
        domEstimate: 0,
        baseOnlyRects,
        detailRects,
        svgPaths: 0,
        gradientStops: 0,
        splitCount: 0,
        idealCells,
        paintedCells: 0,
        paintCells: 0,
        pseudoArea: 0,
        paintCost: 0,
        uniqueColors
      },
      scoreTotal: Number.POSITIVE_INFINITY,
      verified: false
    };
  }
  const basePaintStats = getPackedPaintStats(packed, pairing);
  const gradientArea = gradientBrushes.reduce((sum, brush) => {
    const width = brush.c1 - brush.c0;
    const height = brush.r1 - brush.r0;
    if (width <= 0 || height <= 0) return sum;
    return sum + width * height;
  }, 0);
  const paintCells = basePaintStats.paintCells + gradientArea;
  const pseudoArea = basePaintStats.pseudoArea;
  const paintCost = paintCells + pseudoArea;
  const metrics: SliceMetrics = {
    domEstimate,
    baseOnlyRects,
    detailRects,
    svgPaths: 0,
    gradientStops,
    splitCount: 0,
    idealCells,
    paintedCells: verifyResult.paintedCells,
    paintCells,
    pseudoArea,
    paintCost,
    uniqueColors
  };
  const detailCount = Math.max(0, detailRects - gradientDetailRects) + gradientStops;
  return {
    kind: "gradient",
    brushes: [...packed.map(packedToBrush), ...gradientBrushes],
    packed,
    pairing,
    compositeEstimate,
    metrics,
    scoreTotal: scorePlan(metrics, false, { detailCount, fragCount: detailCount }),
    verified: true
  };
};

const evaluateHybridPass = (
  packed: PackedBrush[],
  gradientBrushes: Brush[],
  gradientStops: number,
  gradientDetailRects: number,
  svgBrushes: Brush[],
  svgDetailRects: number,
  baseOnlyRects: number,
  detailRects: number,
  uniqueColors: number,
  idealCells: number,
  buffer: FaceData["buffer"],
  paletteIds: Map<string, number>,
  scratch: Uint32Array,
  verifyPacked: PackedBrush[],
  verifyPairing: BrushPairing
): PassResult => {
  const pairing = buildBrushPairing(packed);
  const svgPathCount = svgBrushes.reduce((sum, brush) => sum + (brush.svgPaths?.length ?? 0), 0);
  const baseTopLevel = countTopLevelBrushes(packed, pairing);
  const domEstimate = baseTopLevel + gradientBrushes.length + svgBrushes.length * 2 + svgPathCount;
  const compositeEstimate = baseTopLevel + svgBrushes.length;
  const verifyResult = verifyPackedBrushes(buffer, verifyPacked, verifyPairing, paletteIds, scratch);
  if (!verifyResult.ok) {
    return {
      kind: "hybrid",
      brushes: [],
      packed,
      pairing,
      compositeEstimate,
      metrics: {
        domEstimate: 0,
        baseOnlyRects,
        detailRects,
        svgPaths: 0,
        gradientStops: 0,
        splitCount: 0,
        idealCells,
        paintedCells: 0,
        paintCells: 0,
        pseudoArea: 0,
        paintCost: 0,
        uniqueColors
      },
      scoreTotal: Number.POSITIVE_INFINITY,
      verified: false
    };
  }
  const basePaintStats = getPackedPaintStats(packed, pairing);
  const gradientArea = gradientBrushes.reduce((sum, brush) => {
    const width = brush.c1 - brush.c0;
    const height = brush.r1 - brush.r0;
    if (width <= 0 || height <= 0) return sum;
    return sum + width * height;
  }, 0);
  const svgArea = svgBrushes.reduce((sum, brush) => sum + (brush.svgPaintArea ?? 0), 0);
  const paintCells = basePaintStats.paintCells + gradientArea + svgArea;
  const pseudoArea = basePaintStats.pseudoArea;
  const paintCost = paintCells + pseudoArea;
  const metrics: SliceMetrics = {
    domEstimate,
    baseOnlyRects,
    detailRects,
    svgPaths: svgPathCount,
    gradientStops,
    splitCount: 0,
    idealCells,
    paintedCells: verifyResult.paintedCells,
    paintCells,
    pseudoArea,
    paintCost,
    uniqueColors
  };
  const detailCount =
    Math.max(0, detailRects - gradientDetailRects - svgDetailRects) +
    gradientStops +
    svgPathCount;
  return {
    kind: "hybrid",
    brushes: [...packed.map(packedToBrush), ...gradientBrushes, ...svgBrushes],
    packed,
    pairing,
    compositeEstimate,
    metrics,
    scoreTotal: scorePlan(metrics, false, { detailCount, fragCount: detailCount }),
    verified: true
  };
};

const computeUniqueColors = (ids: Uint32Array, paletteSize: number): number => {
  if (!ids.length) return 0;
  const seen = new Uint8Array(Math.max(1, paletteSize));
  let count = 0;
  for (const id of ids) {
    if (!id) continue;
    if (!seen[id]) {
      seen[id] = 1;
      count += 1;
    }
  }
  return count;
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
        mode: "BASE",
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

const countTopLevelBrushKinds = (packed: PackedBrush[], pairing: BrushPairing): BrushCounts => {
  const counts: BrushCounts = { base: 0, stamp: 0, combo: 0, svg: 0, gradient: 0 };
  for (let i = 0; i < packed.length; i += 1) {
    if (pairing.children.has(i)) continue;
    const brush = packed[i];
    if (brush.mode === "BASE") counts.base += 1;
    else if (brush.mode === "STAMP") counts.stamp += 1;
    else if (brush.mode === "COMBO") counts.combo += 1;
  }
  return counts;
};

const isPassAllowed = (pass: PassResult): boolean => {
  const hasBrush = pass.brushes.some((brush) => brush.kind === "BASE" || brush.kind === "COMBO");
  const hasStamp = pass.brushes.some((brush) => brush.kind === "STAMP");
  const hasSvg = pass.brushes.some((brush) => brush.kind === "SVG");
  const hasGradient = pass.brushes.some((brush) => brush.kind === "GRADIENT");
  if (!SLICE_ENABLE_BRUSH && hasBrush) return false;
  if (!SLICE_ENABLE_STAMP && hasStamp) return false;
  if (!SLICE_ENABLE_SVG && hasSvg) return false;
  if (!SLICE_ENABLE_GRADIENT && hasGradient) return false;
  return true;
};

const chooseBestPass = (passes: PassResult[]): PassResult | null => {
  const verified = passes.filter((pass) => pass.verified);
  if (!verified.length) return null;

  const pickBest = (candidates: PassResult[]): PassResult | null => {
    let best: PassResult | null = null;
    for (const pass of candidates) {
      if (!best) {
        best = pass;
        continue;
      }
      if (pass.scoreTotal < best.scoreTotal) {
        best = pass;
        continue;
      }
      if (pass.scoreTotal === best.scoreTotal) {
        if (pass.metrics.domEstimate < best.metrics.domEstimate) {
          best = pass;
          continue;
        }
        if (pass.metrics.domEstimate === best.metrics.domEstimate && pass.metrics.paintCost < best.metrics.paintCost) {
          best = pass;
        }
      }
    }
    return best;
  };

  const nonSvg = verified.filter((pass) => pass.kind !== "svg");
  const bestNonSvg = pickBest(nonSvg);
  if (!bestNonSvg) return pickBest(verified);

  const domCap = bestNonSvg.metrics.domEstimate;
  const svgComplex = (pass: PassResult): boolean => {
    if (pass.kind !== "svg") return false;
    const detailRects = pass.metrics.detailRects;
    if (detailRects < 120) return false;
    return pass.metrics.svgPaths > 0 && pass.metrics.svgPaths <= detailRects * 0.6;
  };
  const guarded = verified.filter(
    (pass) => pass.kind !== "svg" || pass.metrics.domEstimate <= domCap || svgComplex(pass)
  );
  return pickBest(guarded) ?? bestNonSvg;
};

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
  const svgSelection = rectResult.detailsValid ? selectSvgRegions(regions, palette) : { svgRegions: new Set<number>(), svgDetailRects: 0 };
  const svgBrushesHybrid = rectResult.detailsValid && svgSelection.svgRegions.size
    ? buildSvgBrushes(regions, palette, svgSelection.svgRegions)
    : [];
  const svgBrushes = rectResult.detailsValid ? buildSvgBrushes(regions, palette) : [];

  const passes: PassResult[] = [];
  const pushPass = (pass: PassResult): void => {
    if (isPassAllowed(pass)) passes.push(pass);
  };
  if (rectResult.detailsValid) {
    const passARaw = evaluatePackedPass(
      "raw",
      buildBasePackedBrushes(rectResult.rects),
      rectResult.baseOnlyRects,
      rectResult.detailRects,
      uniqueColors,
      idealCells,
      buffer,
      paletteIds,
      scratch
    );
    pushPass(passARaw);

    const packed: PackedBrush[] = [];
    const passBPacked = evaluatePackedPass(
      "packed",
      packRectsToBrushes(rectResult.rects, packed),
      rectResult.baseOnlyRects,
      rectResult.detailRects,
      uniqueColors,
      idealCells,
      buffer,
      paletteIds,
      scratch
    );
    pushPass(passBPacked);

    const gradientPlan = buildGradientBrushes(regions, palette, svgSelection.svgRegions);
    if (gradientPlan.brushes.length) {
      const gradientRects = buildRectListForRegions(regions, palette, gradientPlan.skipRegions);
      const gradientPacked: PackedBrush[] = [];
      const passGradient = evaluateGradientPass(
        packRectsToBrushes(gradientRects, gradientPacked),
        gradientPlan.brushes,
        gradientPlan.gradientStops,
        gradientPlan.gradientDetailRects,
        rectResult.baseOnlyRects,
        rectResult.detailRects,
        uniqueColors,
        idealCells,
        buffer,
        paletteIds,
        scratch
      );
      pushPass(passGradient);
    }

    if (passBPacked.verified) {
      const hybridDetailSkip = new Set<number>([...gradientPlan.skipRegions, ...svgSelection.svgRegions]);
      const hybridRects = buildRectListForRegions(regions, palette, {
        skipBaseRegions: gradientPlan.skipRegions,
        skipDetailRegions: hybridDetailSkip
      });
      const hybridPacked: PackedBrush[] = SLICE_ENABLE_STAMP ? packRectsToBrushes(hybridRects, []) : buildBasePackedBrushes(hybridRects);
      if (gradientPlan.brushes.length || svgBrushesHybrid.length) {
        const passHybrid = evaluateHybridPass(
          hybridPacked,
          gradientPlan.brushes,
          gradientPlan.gradientStops,
          gradientPlan.gradientDetailRects,
          svgBrushesHybrid,
          svgSelection.svgDetailRects,
          rectResult.baseOnlyRects,
          rectResult.detailRects,
          uniqueColors,
          idealCells,
          buffer,
          paletteIds,
          scratch,
          passBPacked.packed,
          passBPacked.pairing
        );
        pushPass(passHybrid);
      }
      if (svgBrushes.length) {
        const basePacked: PackedBrush[] = [];
        packRectsToBrushes(rectResult.baseRects, basePacked);
        const passSvg = evaluateSvgPass(
          basePacked,
          svgBrushes,
          rectResult.baseOnlyRects,
          rectResult.detailRects,
          uniqueColors,
          idealCells,
          buffer,
          paletteIds,
          scratch,
          passBPacked.packed,
          passBPacked.pairing
        );
        pushPass(passSvg);
      }
      const baseline: PackedBrush[] = [];
      packRectsToBrushes(rectResult.rects, baseline);
      const optimized = optimizeBrushOverlaps(
        baseline.map((brush) => ({
          ...brush,
          before: brush.before ? { ...brush.before } : undefined,
          after: brush.after ? { ...brush.after } : undefined
        })),
        baseline
      );
      const passCMerge = evaluatePackedPass(
        "merge",
        optimized.brushes,
        rectResult.baseOnlyRects,
        rectResult.detailRects,
        uniqueColors,
        idealCells,
        buffer,
        paletteIds,
        scratch
      );
      if (passCMerge.verified) {
        const reducesDom = passCMerge.metrics.domEstimate < passBPacked.metrics.domEstimate;
        const paintOk = passCMerge.metrics.paintCost <= passBPacked.metrics.paintCost;
        if (reducesDom && paintOk) pushPass(passCMerge);
      }
    }
  }

  let best = chooseBestPass(passes);
  let fallback = false;
  if (!best) {
    fallback = true;
    const fallbackBrushes = buildFallbackCellBrushes(buffer);
    const fallbackPass = evaluatePackedPass(
      "fallback",
      fallbackBrushes,
      rectResult.baseOnlyRects,
      rectResult.detailRects,
      uniqueColors,
      idealCells,
      buffer,
      paletteIds,
      scratch
    );
    if (fallbackPass.verified && isPassAllowed(fallbackPass)) {
      const metrics = { ...fallbackPass.metrics };
      const scoreTotal = scorePlan(metrics, true);
      best = { ...fallbackPass, metrics, scoreTotal, verified: true };
    } else {
      best = {
        kind: "fallback",
        brushes: [],
        packed: [],
        pairing: buildBrushPairing([]),
        compositeEstimate: 0,
        metrics: {
          domEstimate: 0,
          baseOnlyRects: rectResult.baseOnlyRects,
          detailRects: rectResult.detailRects,
          svgPaths: 0,
          gradientStops: 0,
          splitCount: 0,
          idealCells,
          paintedCells: 0,
          paintCells: 0,
          pseudoArea: 0,
          paintCost: 0,
          uniqueColors
        },
        scoreTotal: Number.POSITIVE_INFINITY,
        verified: false
      };
    }
  }

  const metrics = best.metrics;
  const brushCounts = countTopLevelBrushKinds(best.packed, best.pairing);
  brushCounts.svg = best.brushes.reduce((sum, brush) => sum + (brush.kind === "SVG" ? 1 : 0), 0);
  brushCounts.gradient = best.brushes.reduce((sum, brush) => sum + (brush.kind === "GRADIENT" ? 1 : 0), 0);
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
