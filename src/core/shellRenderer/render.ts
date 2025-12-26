import type { GridContext, WallsMask } from "../types";
import { DEFAULT_WALLS } from "../types";
import type { FacePlan, HostPlan, PlaneShellAxis, PlaneShellDomState, PlaneShellSnapshot } from "./types";
import {
  COMBO_MIN_AREA,
  MAX_MERGE_AREA,
  MAX_MERGE_SPAN,
  MAX_OVERLAP_CANDIDATES_PER_BRUSH,
  MAX_OVERLAP_COLORS,
  MAX_OVERLAP_GAP,
  MAX_OVERLAP_MERGES_PER_PASS,
  MAX_OVERLAP_PASSES,
  PLANE_SHELL_DEV_VERIFY,
  STAMP_BUCKET_SIZE,
  STAMP_FACE_Z_OFFSET,
  STAMP_MAX_BLEED_AREA,
  STAMP_MAX_BLEED_AREA_RELAXED,
  STAMP_MAX_OFFSET,
  STAMP_MAX_OFFSET_RELAXED,
  STAMP_MAX_PSEUDO_SPAN,
  STAMP_MAX_PSEUDO_SPAN_RELAXED,
  SVG_NS,
  clearCssVar,
  clearPlaneDetailVars,
  formatZOffset,
  getDetailRects,
  makeRectEngine,
  setAttrIfDiff,
  setCssVarIfDiff,
  setStyleIfDiff
} from "./types";

const applyBrush = (
  brush: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void => {
  const state = brush as { __voxcssNewBrushState?: { className?: string; gridArea?: string; backgroundColor?: string } };
  const brushState = state.__voxcssNewBrushState ?? (state.__voxcssNewBrushState = {});
  const className = "voxcss-plane-brush";
  if (brushState.className !== className) {
    brush.className = className;
    brushState.className = className;
  }
  if (brushState.gridArea !== gridArea) {
    brush.style.gridArea = gridArea;
    brushState.gridArea = gridArea;
  }
  if (brushState.backgroundColor !== backgroundColor) {
    brush.style.backgroundColor = backgroundColor;
    brushState.backgroundColor = backgroundColor;
  }
  setCssVarIfDiff(brush, "--vox-z", zOffset);
  setStyleIfDiff(brush, "position", "relative");
  setStyleIfDiff(brush, "overflow", "visible");
  setStyleIfDiff(brush, "left", "");
  setStyleIfDiff(brush, "top", "");
  setStyleIfDiff(brush, "width", "");
  setStyleIfDiff(brush, "height", "");
};

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
  mode: "BASE" | "STAMP" | "COMBO";
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  baseColor: string;
  before?: BrushRect;
  after?: BrushRect;
};

type FaceSvgHost = { host: HostPlan; gridArea: string; hostWidth: number; hostHeight: number };
export type BrushPairing = { absorbed: Map<number, AbsorbPlan[]>; nested: Map<number, number>; children: Set<number> };
type FaceBrushCacheEntry = {
  signatureHash: number;
  brushes: PackedBrush[];
  svgHosts: FaceSvgHost[];
  pairing?: BrushPairing;
  paintedCells?: number[];
};

const cloneBrushRect = (rect?: BrushRect): BrushRect | undefined => rect ? { ...rect } : undefined;
const clonePackedBrush = (brush: PackedBrush): PackedBrush => ({
  mode: brush.mode,
  r0: brush.r0,
  c0: brush.c0,
  r1: brush.r1,
  c1: brush.c1,
  baseColor: brush.baseColor,
  before: cloneBrushRect(brush.before),
  after: cloneBrushRect(brush.after)
});
const clonePackedBrushes = (brushes: PackedBrush[]): PackedBrush[] => brushes.map(clonePackedBrush);
const cloneFaceSvgHosts = (hosts: FaceSvgHost[]): FaceSvgHost[] =>
  hosts.map((entry) => ({ host: entry.host, gridArea: entry.gridArea, hostWidth: entry.hostWidth, hostHeight: entry.hostHeight }));

type StampConstraints = {
  maxOffset: number;
  maxPseudoSpan: number;
  maxBleedArea: number;
};

const compareColor = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const rectContains = (outer: BrushRect, inner: BrushRect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const compareRectStable = (a: BrushRect, b: BrushRect): number => {
  const colorDiff = compareColor(a.color, b.color);
  if (colorDiff) return colorDiff;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  if (a.area !== b.area) return b.area - a.area;
  return a.id - b.id;
};

const compareStampTie = (a: BrushRect, b: BrushRect): number => {
  if (a.area !== b.area) return b.area - a.area;
  const colorDiff = compareColor(a.color, b.color);
  if (colorDiff) return colorDiff;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id - b.id;
};

const compareComboBase = (a: BrushRect, b: BrushRect): number => {
  if (a.area !== b.area) return b.area - a.area;
  const colorDiff = compareColor(a.color, b.color);
  if (colorDiff) return colorDiff;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id - b.id;
};

const compareInnerRect = (a: BrushRect, b: BrushRect): number => {
  if (a.area !== b.area) return b.area - a.area;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  const colorDiff = compareColor(a.color, b.color);
  if (colorDiff) return colorDiff;
  return a.id - b.id;
};

const isBetterInner = (a: BrushRect, b: BrushRect): boolean => compareInnerRect(a, b) < 0;

export type PaintRect = { r0: number; c0: number; r1: number; c1: number; color: string };
type BrushLayers = { base: PaintRect | null; before: PaintRect | null; after: PaintRect | null };
export type AbsorbPlan = { slot: "before" | "after"; rect: PaintRect };

const normalizePaintColor = (value?: string): string | null => {
  const raw = (value ?? "").trim();
  if (!raw || raw === "transparent") return null;
  const rgbaMatch = raw.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i);
  if (rgbaMatch) {
    const alpha = Number(rgbaMatch[1]);
    if (Number.isFinite(alpha) && alpha <= 0) return null;
  }
  return raw;
};

const rectContainsPacked = (outer: PackedBrush, inner: PackedBrush): boolean =>
  inner.r0 >= outer.r0 && inner.c0 >= outer.c0 && inner.r1 <= outer.r1 && inner.c1 <= outer.c1;

const rectContainsRect = (outer: PackedBrush, rect: PaintRect): boolean =>
  rect.r0 >= outer.r0 && rect.c0 >= outer.c0 && rect.r1 <= outer.r1 && rect.c1 <= outer.c1;

const getBrushLayers = (brush: PackedBrush): BrushLayers => {
  const baseColor = normalizePaintColor(brush.baseColor);
  const base = baseColor
    ? { r0: brush.r0, c0: brush.c0, r1: brush.r1, c1: brush.c1, color: baseColor }
    : null;
  const beforeColor = brush.before ? normalizePaintColor(brush.before.color) : null;
  const before = brush.before && beforeColor
    ? {
      r0: brush.before.y,
      c0: brush.before.x,
      r1: brush.before.y + brush.before.h,
      c1: brush.before.x + brush.before.w,
      color: beforeColor
    }
    : null;
  const afterColor = brush.after ? normalizePaintColor(brush.after.color) : null;
  const after = brush.after && afterColor
    ? {
      r0: brush.after.y,
      c0: brush.after.x,
      r1: brush.after.y + brush.after.h,
      c1: brush.after.x + brush.after.w,
      color: afterColor
    }
    : null;
  return { base, before, after };
};

const paintRectToBrushRect = (rect: PaintRect): BrushRect => ({
  x: rect.c0,
  y: rect.r0,
  w: rect.c1 - rect.c0,
  h: rect.r1 - rect.r0,
  color: rect.color,
  area: Math.max(0, rect.c1 - rect.c0) * Math.max(0, rect.r1 - rect.r0),
  id: -1
});

const brushHasOverflow = (brush: PackedBrush): boolean => {
  const layers = getBrushLayers(brush);
  if (!layers.base) return true;
  if (layers.before && !rectContainsRect(brush, layers.before)) return true;
  if (layers.after && !rectContainsRect(brush, layers.after)) return true;
  return false;
};

const applyPaintRect = (
  target: (string | null)[],
  bbox: { r0: number; c0: number; r1: number; c1: number },
  rect: PaintRect | null
): void => {
  if (!rect) return;
  const r0 = Math.max(rect.r0, bbox.r0);
  const c0 = Math.max(rect.c0, bbox.c0);
  const r1 = Math.min(rect.r1, bbox.r1);
  const c1 = Math.min(rect.c1, bbox.c1);
  if (r1 <= r0 || c1 <= c0) return;
  const width = bbox.c1 - bbox.c0;
  for (let r = r0; r < r1; r += 1) {
    const rowBase = (r - bbox.r0) * width;
    for (let c = c0; c < c1; c += 1) {
      target[rowBase + (c - bbox.c0)] = rect.color;
    }
  }
};

const paintBrushLayers = (
  target: (string | null)[],
  bbox: { r0: number; c0: number; r1: number; c1: number },
  layers: BrushLayers
): void => {
  applyPaintRect(target, bbox, layers.base);
  applyPaintRect(target, bbox, layers.before);
  applyPaintRect(target, bbox, layers.after);
};

const buildAbsorbedLayers = (parent: BrushLayers, absorb: AbsorbPlan): BrushLayers => ({
  base: parent.base,
  before: absorb.slot === "before" ? absorb.rect : parent.before,
  after: absorb.slot === "after" ? absorb.rect : parent.after
});

const brushIntersectsRect = (brush: PackedBrush, rect: { r0: number; c0: number; r1: number; c1: number }): boolean =>
  brush.r0 < rect.r1 && brush.r1 > rect.r0 && brush.c0 < rect.c1 && brush.c1 > rect.c0;

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

const paintBrushList = (
  target: (string | null)[],
  bbox: { r0: number; c0: number; r1: number; c1: number },
  brushes: PackedBrush[],
  override?: { index: number; brush: PackedBrush },
  skipIndex?: number
): void => {
  const entries: Array<{ index: number; area: number; brush: PackedBrush }> = [];
  for (let i = 0; i < brushes.length; i += 1) {
    if (i === skipIndex) continue;
    const brush = override && i === override.index ? override.brush : brushes[i];
    if (!brush || !brushIntersectsRect(brush, bbox)) continue;
    entries.push({ index: i, area: getBrushPaintedCells(brush), brush });
  }
  entries.sort((a, b) => {
    if (a.area !== b.area) return b.area - a.area;
    return a.index - b.index;
  });
  for (const entry of entries) {
    paintPackedBrush(target, bbox, entry.brush);
  }
};

const paintPackedBrush = (
  target: (string | null)[],
  bbox: { r0: number; c0: number; r1: number; c1: number },
  brush: PackedBrush
): void => {
  if (!brushIntersectsRect(brush, bbox)) return;
  const layers = getBrushLayers(brush);
  paintBrushLayers(target, bbox, layers);
};

const paintBrushRects = (
  target: (string | null)[],
  bbox: { r0: number; c0: number; r1: number; c1: number },
  rects: BrushRect[]
): void => {
  const width = bbox.c1 - bbox.c0;
  for (const rect of rects) {
    const r0 = rect.y;
    const c0 = rect.x;
    const r1 = rect.y + rect.h;
    const c1 = rect.x + rect.w;
    if (r1 <= bbox.r0 || r0 >= bbox.r1 || c1 <= bbox.c0 || c0 >= bbox.c1) continue;
    const rr0 = Math.max(r0, bbox.r0);
    const cc0 = Math.max(c0, bbox.c0);
    const rr1 = Math.min(r1, bbox.r1);
    const cc1 = Math.min(c1, bbox.c1);
    for (let r = rr0; r < rr1; r += 1) {
      const rowBase = (r - bbox.r0) * width;
      for (let c = cc0; c < cc1; c += 1) {
        target[rowBase + (c - bbox.c0)] = rect.color;
      }
    }
  }
};

const getMergedBrushMode = (rectCount: number): PackedBrush["mode"] =>
  rectCount >= 2 ? "COMBO" : rectCount === 1 ? "STAMP" : "BASE";

const findLargestRectForColor = (
  rectEngine: ReturnType<typeof makeRectEngine>,
  diff: (string | null)[],
  width: number,
  height: number,
  color: string,
  mask: Uint8Array
): HostRect | null => {
  let fillCells = 0;
  const size = width * height;
  mask.fill(0, 0, size);
  for (let i = 0; i < size; i += 1) {
    if (diff[i] !== color) continue;
    mask[i] = 1;
    fillCells += 1;
  }
  if (!fillCells) return null;
  const result = rectEngine.maxRects(mask, 1, fillCells);
  return result.rects[0] ?? null;
};

const buildMergedBrush = (
  baseColor: string,
  bbox: { r0: number; c0: number; r1: number; c1: number },
  target: (string | null)[]
): PackedBrush | null => {
  const normalizedBase = normalizePaintColor(baseColor);
  if (!normalizedBase) return null;
  const width = bbox.c1 - bbox.c0;
  const height = bbox.r1 - bbox.r0;
  if (width <= 0 || height <= 0) return null;
  const size = width * height;
  const diff = new Array<string | null>(size);
  const colors = new Map<string, number>();
  for (let i = 0; i < size; i += 1) {
    const color = target[i];
    if (!color) return null;
    if (color === normalizedBase) {
      diff[i] = null;
      continue;
    }
    diff[i] = color;
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  if (!colors.size) {
    return {
      mode: "BASE",
      r0: bbox.r0,
      c0: bbox.c0,
      r1: bbox.r1,
      c1: bbox.c1,
      baseColor
    };
  }
  if (colors.size > MAX_OVERLAP_COLORS) return null;
  const rectEngine = makeRectEngine(width, height);
  const mask = new Uint8Array(size);
  const rects: PaintRect[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    if (!colors.size) break;
    let bestRect: HostRect | null = null;
    let bestColor: string | null = null;
    let bestArea = 0;
    for (const [color] of colors) {
      const rect = findLargestRectForColor(rectEngine, diff, width, height, color, mask);
      if (!rect) continue;
      const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
      if (
        area > bestArea ||
        (area === bestArea && bestColor !== null && color < bestColor)
      ) {
        bestArea = area;
        bestRect = rect;
        bestColor = color;
      }
    }
    if (!bestRect || !bestColor || !bestArea) break;
    rects.push({
      r0: bbox.r0 + bestRect.r0,
      c0: bbox.c0 + bestRect.c0,
      r1: bbox.r0 + bestRect.r1,
      c1: bbox.c0 + bestRect.c1,
      color: bestColor
    });
    let remaining = 0;
    for (let r = bestRect.r0; r < bestRect.r1; r += 1) {
      const rowBase = r * width;
      for (let c = bestRect.c0; c < bestRect.c1; c += 1) {
        const idx = rowBase + c;
        if (diff[idx] === bestColor) diff[idx] = null;
      }
    }
    for (let i = 0; i < size; i += 1) if (diff[i]) remaining += 1;
    if (!remaining) {
      colors.clear();
      break;
    }
    colors.clear();
    for (let i = 0; i < size; i += 1) {
      const color = diff[i];
      if (!color) continue;
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }
  }
  for (let i = 0; i < size; i += 1) if (diff[i]) return null;
  const before = rects[0];
  const after = rects[1];
  const mode = getMergedBrushMode(rects.length);
  return {
    mode,
    r0: bbox.r0,
    c0: bbox.c0,
    r1: bbox.r1,
    c1: bbox.c1,
    baseColor,
    before: before ? paintRectToBrushRect(before) : undefined,
    after: after ? paintRectToBrushRect(after) : undefined
  };
};

const optimizeBrushOverlaps = (
  currentBrushes: PackedBrush[],
  baselineBrushes: PackedBrush[]
): { brushes: PackedBrush[]; attempted: number; accepted: number; before: number; after: number } => {
  let current = currentBrushes.slice();
  let attempted = 0;
  let accepted = 0;
  const overlapGap = MAX_OVERLAP_GAP * 2;
  const relaxedMergeSpan = MAX_MERGE_SPAN * 2;
  const relaxedMergeArea = MAX_MERGE_AREA * 4;
  for (let pass = 0; pass < MAX_OVERLAP_PASSES; pass += 1) {
    if (current.length < 2) break;
    const bucketKey = (bx: number, by: number): number => (bx << 16) ^ (by & 0xffff);
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < current.length; i += 1) {
      const brush = current[i];
      const bx0 = Math.floor((brush.c0 - overlapGap) / STAMP_BUCKET_SIZE);
      const bx1 = Math.floor((brush.c1 + overlapGap - 1) / STAMP_BUCKET_SIZE);
      const by0 = Math.floor((brush.r0 - overlapGap) / STAMP_BUCKET_SIZE);
      const by1 = Math.floor((brush.r1 + overlapGap - 1) / STAMP_BUCKET_SIZE);
      for (let bx = bx0; bx <= bx1; bx += 1) {
        for (let by = by0; by <= by1; by += 1) {
          const key = bucketKey(bx, by);
          const bucket = buckets.get(key);
          if (bucket) bucket.push(i);
          else buckets.set(key, [i]);
        }
      }
    }

    const mergedParents = new Map<number, PackedBrush>();
    const mergedChildren = new Set<number>();
    const visit = new Int32Array(current.length);
    let visitValue = 1;
    let mergesThisPass = 0;
    const candidateIndices: number[] = [];

    const isNearby = (a: PackedBrush, b: PackedBrush): boolean => {
      const gapX = a.c1 <= b.c0 ? b.c0 - a.c1 : b.c1 <= a.c0 ? a.c0 - b.c1 : 0;
      const gapY = a.r1 <= b.r0 ? b.r0 - a.r1 : b.r1 <= a.r0 ? a.r0 - b.r1 : 0;
      return gapX <= overlapGap && gapY <= overlapGap;
    };

    for (let i = 0; i < current.length; i += 1) {
      if (mergedParents.has(i) || mergedChildren.has(i)) continue;
      if (mergesThisPass >= MAX_OVERLAP_MERGES_PER_PASS) break;
      const parent = current[i];
      const bx0 = Math.floor((parent.c0 - overlapGap) / STAMP_BUCKET_SIZE);
      const bx1 = Math.floor((parent.c1 + overlapGap - 1) / STAMP_BUCKET_SIZE);
      const by0 = Math.floor((parent.r0 - overlapGap) / STAMP_BUCKET_SIZE);
      const by1 = Math.floor((parent.r1 + overlapGap - 1) / STAMP_BUCKET_SIZE);
      candidateIndices.length = 0;
      visitValue += 1;
      for (let bx = bx0; bx <= bx1; bx += 1) {
        for (let by = by0; by <= by1; by += 1) {
          const bucket = buckets.get(bucketKey(bx, by));
          if (!bucket) continue;
          for (const idx of bucket) {
            if (idx <= i) continue;
            if (mergedParents.has(idx) || mergedChildren.has(idx)) continue;
            if (visit[idx] === visitValue) continue;
            visit[idx] = visitValue;
            candidateIndices.push(idx);
            if (candidateIndices.length >= MAX_OVERLAP_CANDIDATES_PER_BRUSH) break;
          }
          if (candidateIndices.length >= MAX_OVERLAP_CANDIDATES_PER_BRUSH) break;
        }
        if (candidateIndices.length >= MAX_OVERLAP_CANDIDATES_PER_BRUSH) break;
      }

      let bestChild = -1;
      let bestMerged: PackedBrush | null = null;
      let bestMergedArea = 0;
      for (const j of candidateIndices) {
        const child = current[j];
        if (!isNearby(parent, child)) continue;
        const parentBaseColor = normalizePaintColor(parent.baseColor);
        const childBaseColor = normalizePaintColor(child.baseColor);
        const sameBaseOnly = !!parentBaseColor &&
          parentBaseColor === childBaseColor &&
          !parent.before && !parent.after &&
          !child.before && !child.after;
        const r0 = Math.min(parent.r0, child.r0);
        const c0 = Math.min(parent.c0, child.c0);
        const r1 = Math.max(parent.r1, child.r1);
        const c1 = Math.max(parent.c1, child.c1);
        const width = c1 - c0;
        const height = r1 - r0;
        if (width <= 0 || height <= 0) continue;
        const spanLimit = sameBaseOnly ? relaxedMergeSpan : MAX_MERGE_SPAN;
        if (width > spanLimit || height > spanLimit) continue;
        const area = width * height;
        const areaLimit = sameBaseOnly ? relaxedMergeArea : MAX_MERGE_AREA;
        if (area > areaLimit) continue;
        attempted += 1;
        const bbox = { r0, c0, r1, c1 };
        const size = area;
        const target = new Array<string | null>(size).fill(null);
        paintBrushList(target, bbox, baselineBrushes);
        let hasAir = false;
        for (let k = 0; k < size; k += 1) {
          if (target[k] === null) {
            hasAir = true;
            break;
          }
        }
        if (hasAir) continue;
        const candidateMatches = (merged: PackedBrush): boolean => {
          const candidate = new Array<string | null>(size).fill(null);
          paintBrushList(candidate, bbox, current, { index: i, brush: merged }, j);
          for (let k = 0; k < size; k += 1) {
            if (target[k] !== candidate[k]) return false;
          }
          return true;
        };

        let merged: PackedBrush | null = null;
        if (sameBaseOnly) {
          const baseMerged: PackedBrush = {
            mode: "BASE",
            r0: bbox.r0,
            c0: bbox.c0,
            r1: bbox.r1,
            c1: bbox.c1,
            baseColor: parent.baseColor
          };
          if (candidateMatches(baseMerged)) merged = baseMerged;
        }
        if (!merged) {
          const mergedBrush = buildMergedBrush(parent.baseColor, bbox, target);
          if (mergedBrush && candidateMatches(mergedBrush)) merged = mergedBrush;
        }
        if (!merged) continue;
        if (!bestMerged || area < bestMergedArea || (area === bestMergedArea && j < bestChild)) {
          bestChild = j;
          bestMerged = merged;
          bestMergedArea = area;
        }
      }
      if (bestChild >= 0 && bestMerged) {
        mergedParents.set(i, bestMerged);
        mergedChildren.add(bestChild);
        mergesThisPass += 1;
        accepted += 1;
      }
    }

    if (!mergedParents.size) break;
    const next: PackedBrush[] = [];
    for (let i = 0; i < current.length; i += 1) {
      if (mergedChildren.has(i)) continue;
      const merged = mergedParents.get(i);
      if (merged) next.push(merged);
      else next.push(current[i]);
    }
    current = next;
  }
  return { brushes: current, attempted, accepted, before: currentBrushes.length, after: current.length };
};


const canAbsorbBrushPair = (
  parent: PackedBrush,
  child: PackedBrush,
  maxArea: number,
  slots?: { before: boolean; after: boolean }
): AbsorbPlan | null => {
  if (!rectContainsPacked(parent, child)) return null;
  if (brushHasOverflow(parent) || brushHasOverflow(child)) return null;

  const parentLayers = getBrushLayers(parent);
  const childLayers = getBrushLayers(child);

  if (!parentLayers.base) return null;

  const allowBefore = (slots?.before ?? true) && !parentLayers.before;
  const allowAfter = (slots?.after ?? true) && !parentLayers.after;
  const slot = allowBefore ? "before" : (allowAfter ? "after" : null);
  if (!slot) return null;

  const bbox = { r0: parent.r0, c0: parent.c0, r1: parent.r1, c1: parent.c1 };
  const width = bbox.c1 - bbox.c0;
  const height = bbox.r1 - bbox.r0;
  if (width <= 0 || height <= 0) return null;
  const area = width * height;
  if (area > maxArea) return null;

  // Paint parent once (this is what is already on the canvas before child).
  const parentOnly = new Array<string | null>(area).fill(null);
  paintBrushLayers(parentOnly, bbox, parentLayers);

  const rectAllEquals = (buffer: (string | null)[], rect: PaintRect, color: string): boolean => {
    const rr0 = Math.max(rect.r0, bbox.r0);
    const cc0 = Math.max(rect.c0, bbox.c0);
    const rr1 = Math.min(rect.r1, bbox.r1);
    const cc1 = Math.min(rect.c1, bbox.c1);
    if (rr1 <= rr0 || cc1 <= cc0) return false;
    for (let r = rr0; r < rr1; r += 1) {
      const rowBase = (r - bbox.r0) * width;
      for (let c = cc0; c < cc1; c += 1) {
        if (buffer[rowBase + (c - bbox.c0)] !== color) return false;
      }
    }
    return true;
  };

  // Candidates: we primarily want to absorb a child pseudo rect (common STAMP case).
  const candidates: { rect: PaintRect; prefer: number }[] = [];
  if (childLayers.before) candidates.push({ rect: childLayers.before, prefer: 0 });
  if (childLayers.after) candidates.push({ rect: childLayers.after, prefer: 1 });
  if (childLayers.base) candidates.push({ rect: childLayers.base, prefer: 2 });
  candidates.sort((a, b) => a.prefer - b.prefer);

  for (const entry of candidates) {
    const candidateRect = entry.rect;
    if (!rectContainsRect(parent, candidateRect)) continue;

    // Build an "effective child paint" that may ignore child base if it's redundant.
    // If child has base AND candidate is a pseudo rect, allow dropping base only when:
    // - parent already paints the child's base color everywhere in child's base rect.
    const effectiveChild: BrushLayers = { base: childLayers.base, before: childLayers.before, after: childLayers.after };
    if (childLayers.base && (candidateRect === childLayers.before || candidateRect === childLayers.after)) {
      const baseColor = childLayers.base.color;
      if (baseColor && rectAllEquals(parentOnly, childLayers.base, baseColor)) {
        effectiveChild.base = null; // child base is a no-op; ignore it for equivalence
      }
    }

    // Ground truth = parent + effective child.
    const original = parentOnly.slice();
    paintBrushLayers(original, bbox, effectiveChild);

    // Absorbed = parent with candidateRect placed into the chosen slot.
    const absorbed = new Array<string | null>(area).fill(null);
    const absorbedLayers = buildAbsorbedLayers(parentLayers, { slot, rect: candidateRect });
    paintBrushLayers(absorbed, bbox, absorbedLayers);

    let ok = true;
    for (let i = 0; i < area; i += 1) {
      if (original[i] !== absorbed[i]) { ok = false; break; }
    }
    if (!ok) continue;

    return { slot, rect: candidateRect };
  }

  return null;
};



const canNestBrushPair = (parent: PackedBrush, child: PackedBrush): boolean => {
  if (!rectContainsPacked(parent, child)) return false;
  if (brushHasOverflow(parent) || brushHasOverflow(child)) return false;
  return true;
};

const buildBrushPairing = (
  brushes: PackedBrush[]
): { absorbed: Map<number, AbsorbPlan[]>; nested: Map<number, number>; children: Set<number> } => {
  const absorbed = new Map<number, AbsorbPlan[]>();
  const nested = new Map<number, number>();
  const children = new Set<number>();
  if (brushes.length < 2) return { absorbed, nested, children };

  const bucketKey = (bx: number, by: number): number => (bx << 16) ^ (by & 0xffff);
  const buckets = new Map<number, number[]>();
  const areas = new Int32Array(brushes.length);
  for (let i = 0; i < brushes.length; i += 1) {
    const brush = brushes[i];
    areas[i] = (brush.c1 - brush.c0) * (brush.r1 - brush.r0);
    const bx0 = Math.floor(brush.c0 / STAMP_BUCKET_SIZE);
    const bx1 = Math.floor((brush.c1 - 1) / STAMP_BUCKET_SIZE);
    const by0 = Math.floor(brush.r0 / STAMP_BUCKET_SIZE);
    const by1 = Math.floor((brush.r1 - 1) / STAMP_BUCKET_SIZE);
    for (let bx = bx0; bx <= bx1; bx += 1) {
      for (let by = by0; by <= by1; by += 1) {
        const key = bucketKey(bx, by);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(i);
        else buckets.set(key, [i]);
      }
    }
  }

  const visit = new Int32Array(brushes.length);
  let visitValue = 1;
  const candidateIndices: number[] = [];

  const parents = Array.from(brushes.keys());
  parents.sort((a, b) => areas[b] - areas[a] || a - b);

  const assertAbsorbPlan = (
    parent: PackedBrush,
    child: PackedBrush,
    plan: AbsorbPlan
  ): void => {
    if (!PLANE_SHELL_DEV_VERIFY) return;
    const forced = { before: plan.slot === "before", after: plan.slot === "after" };
    const verified = canAbsorbBrushPair(parent, child, 4096, forced);
    if (!verified || verified.slot !== plan.slot) {
      throw new Error("[VoxCSS] Absorb plan mismatch");
    }
  };

  for (const parentIndex of parents) {
    if (children.has(parentIndex)) continue;
    const parent = brushes[parentIndex];
    const bx0 = Math.floor(parent.c0 / STAMP_BUCKET_SIZE);
    const bx1 = Math.floor((parent.c1 - 1) / STAMP_BUCKET_SIZE);
    const by0 = Math.floor(parent.r0 / STAMP_BUCKET_SIZE);
    const by1 = Math.floor((parent.r1 - 1) / STAMP_BUCKET_SIZE);
    candidateIndices.length = 0;
    visitValue += 1;
    const visitMark = visitValue;

    for (let bx = bx0; bx <= bx1; bx += 1) {
      for (let by = by0; by <= by1; by += 1) {
        const bucket = buckets.get(bucketKey(bx, by));
        if (!bucket) continue;
        for (const idx of bucket) {
          if (idx === parentIndex || children.has(idx)) continue;
          if (visit[idx] === visitMark) continue;
          visit[idx] = visitMark;
          candidateIndices.push(idx);
        }
      }
    }

    if (!candidateIndices.length) continue;
    candidateIndices.sort((a, b) => {
      if (areas[a] !== areas[b]) return areas[a] - areas[b];
      const brushA = brushes[a];
      const brushB = brushes[b];
      if (brushA.r0 !== brushB.r0) return brushA.r0 - brushB.r0;
      if (brushA.c0 !== brushB.c0) return brushA.c0 - brushB.c0;
      return a - b;
    });

    const absorbPlans: AbsorbPlan[] = [];
    const usedSlots = { before: false, after: false };

    for (const j of candidateIndices) {
      if (children.has(j)) continue;
      if (absorbPlans.length >= 2) break;
      const child = brushes[j];
      if (!rectContainsPacked(parent, child)) continue;
      const slots = { before: !usedSlots.before, after: !usedSlots.after };
      let absorbPlan: AbsorbPlan | null = null;
      if (slots.before) absorbPlan = canAbsorbBrushPair(parent, child, 4096, { before: true, after: false });
      if (!absorbPlan && slots.after) absorbPlan = canAbsorbBrushPair(parent, child, 4096, { before: false, after: true });
      if (!absorbPlan || usedSlots[absorbPlan.slot]) continue;
      absorbPlans.push(absorbPlan);
      usedSlots[absorbPlan.slot] = true;
      children.add(j);
      assertAbsorbPlan(parent, child, absorbPlan);
    }

    if (absorbPlans.length) absorbed.set(parentIndex, absorbPlans);

  }

  return { absorbed, nested, children };
};

const packRectsToBrushes = (
  rects: BrushRect[],
  output: PackedBrush[]
): PackedBrush[] => {
  const bucketKey = (bx: number, by: number): number => (bx << 16) ^ (by & 0xffff);
  output.length = 0;
  if (!rects.length) return output;

  const used = new Array(rects.length).fill(false);
  const rectsSorted = rects.slice().sort(compareRectStable);
  const comboOrder = rects.slice().sort(compareComboBase);
  const buckets = new Map<number, number[]>();
  const visitStamp = new Int32Array(rects.length);
  const visitCombo = new Int32Array(rects.length);
  let visitStampValue = 1;
  let visitComboValue = 1;

  for (const rect of rects) {
    const minBx = Math.floor(rect.x / STAMP_BUCKET_SIZE);
    const maxBx = Math.floor((rect.x + rect.w - 1) / STAMP_BUCKET_SIZE);
    const minBy = Math.floor(rect.y / STAMP_BUCKET_SIZE);
    const maxBy = Math.floor((rect.y + rect.h - 1) / STAMP_BUCKET_SIZE);
    for (let bx = minBx; bx <= maxBx; bx += 1) {
      for (let by = minBy; by <= maxBy; by += 1) {
        const key = bucketKey(bx, by);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(rect.id);
        else buckets.set(key, [rect.id]);
      }
    }
  }

  for (const base of comboOrder) {
    if (used[base.id]) continue;
    const minBx = Math.floor(base.x / STAMP_BUCKET_SIZE);
    const maxBx = Math.floor((base.x + base.w - 1) / STAMP_BUCKET_SIZE);
    const minBy = Math.floor(base.y / STAMP_BUCKET_SIZE);
    const maxBy = Math.floor((base.y + base.h - 1) / STAMP_BUCKET_SIZE);
    let bestA: BrushRect | null = null;
    let bestB: BrushRect | null = null;
    visitComboValue += 1;

    for (let bx = minBx; bx <= maxBx; bx += 1) {
      for (let by = minBy; by <= maxBy; by += 1) {
        const bucket = buckets.get(bucketKey(bx, by));
        if (!bucket) continue;
        for (const id of bucket) {
          if (id === base.id || used[id]) continue;
          if (visitCombo[id] === visitComboValue) continue;
          visitCombo[id] = visitComboValue;
          const candidate = rects[id];
          if (!rectContains(base, candidate)) continue;
          if (!bestA || isBetterInner(candidate, bestA)) {
            bestB = bestA;
            bestA = candidate;
            continue;
          }
          if (!bestB || isBetterInner(candidate, bestB)) bestB = candidate;
        }
      }
    }

    if (!bestA) continue;
    if (base.area < COMBO_MIN_AREA && !bestB) continue;
    output.push({
      mode: "COMBO",
      r0: base.y,
      c0: base.x,
      r1: base.y + base.h,
      c1: base.x + base.w,
      baseColor: base.color,
      before: bestA,
      after: bestB ?? undefined
    });
    used[base.id] = true;
    used[bestA.id] = true;
    if (bestB) used[bestB.id] = true;
  }

  const findBestStampPartner = (
    rect: BrushRect,
    constraints: StampConstraints,
    isStrict: boolean
  ): { base: BrushRect; partner: BrushRect } | null => {
    const minX = rect.x - constraints.maxOffset;
    const maxX = rect.x + constraints.maxOffset;
    const minY = rect.y - constraints.maxOffset;
    const maxY = rect.y + constraints.maxOffset;
    let bxMin = Math.floor(minX / STAMP_BUCKET_SIZE);
    let bxMax = Math.floor(maxX / STAMP_BUCKET_SIZE);
    let byMin = Math.floor(minY / STAMP_BUCKET_SIZE);
    let byMax = Math.floor(maxY / STAMP_BUCKET_SIZE);
    if (!isStrict) {
      bxMin -= 1;
      bxMax += 1;
      byMin -= 1;
      byMax += 1;
    }
    let bestBase: BrushRect | null = null;
    let bestPartner: BrushRect | null = null;
    let bestPaintCost = Number.POSITIVE_INFINITY;
    let bestPartnerArea = Number.POSITIVE_INFINITY;
    let bestBleedArea = Number.POSITIVE_INFINITY;
    let bestMaxAbsOffset = Number.POSITIVE_INFINITY;
    let bestOffsetSum = Number.POSITIVE_INFINITY;
    const pseudoWeight = 1.5;
    visitStampValue += 1;
    const visitValue = visitStampValue;

    for (let bx = bxMin; bx <= bxMax; bx += 1) {
      for (let by = byMin; by <= byMax; by += 1) {
        const bucket = buckets.get(bucketKey(bx, by));
        if (!bucket) continue;
        for (const id of bucket) {
          if (id === rect.id || used[id]) continue;
          if (visitStamp[id] === visitValue) continue;
          visitStamp[id] = visitValue;
          const candidate = rects[id];
          let absDxA = Math.abs(candidate.x - rect.x);
          let absDyA = Math.abs(candidate.y - rect.y);
          if (absDxA > constraints.maxOffset || absDyA > constraints.maxOffset) continue;
          let reasonA = 0;
          let bleedA = 0;
          const spanWA = Math.max(rect.w, absDxA + candidate.w);
          const spanHA = Math.max(rect.h, absDyA + candidate.h);
          if (spanWA > constraints.maxPseudoSpan || spanHA > constraints.maxPseudoSpan) {
            reasonA = 1;
          } else {
            bleedA = (absDxA + candidate.w) * (absDyA + candidate.h);
            if (bleedA > constraints.maxBleedArea) reasonA = 2;
          }

          let reasonB = 0;
          let absDxB = Math.abs(rect.x - candidate.x);
          let absDyB = Math.abs(rect.y - candidate.y);
          let bleedB = 0;
          const spanWB = Math.max(candidate.w, absDxB + rect.w);
          const spanHB = Math.max(candidate.h, absDyB + rect.h);
          if (spanWB > constraints.maxPseudoSpan || spanHB > constraints.maxPseudoSpan) {
            reasonB = 1;
          } else {
            bleedB = (absDxB + rect.w) * (absDyB + rect.h);
            if (bleedB > constraints.maxBleedArea) reasonB = 2;
          }

          const validA = reasonA === 0;
          const validB = reasonB === 0;
          if (!validA && !validB) continue;
          const baseAreaA = Math.max(0, rect.w) * Math.max(0, rect.h);
          const partnerAreaA = Math.max(0, candidate.w) * Math.max(0, candidate.h);
          const baseAreaB = Math.max(0, candidate.w) * Math.max(0, candidate.h);
          const partnerAreaB = Math.max(0, rect.w) * Math.max(0, rect.h);
          const costA = baseAreaA + partnerAreaA * pseudoWeight;
          const costB = baseAreaB + partnerAreaB * pseudoWeight;
          let base = rect;
          let partner = candidate;
          let absDx = absDxA;
          let absDy = absDyA;
          let bleedArea = bleedA;
          let paintCost = costA;
          if (validB) {
            const maxOffsetA = Math.max(absDxA, absDyA);
            const maxOffsetB = Math.max(absDxB, absDyB);
            const sumOffsetA = absDxA + absDyA;
            const sumOffsetB = absDxB + absDyB;
            const preferB =
              !validA ||
              costB < paintCost ||
              (costB === paintCost && (
                bleedB < bleedArea ||
                (bleedB === bleedArea && (
                  maxOffsetB < maxOffsetA ||
                  (maxOffsetB === maxOffsetA && (
                    sumOffsetB < sumOffsetA ||
                    (sumOffsetB === sumOffsetA && compareStampTie(candidate, rect) < 0)
                  ))
                ))
              ));
            if (preferB) {
              base = candidate;
              partner = rect;
              absDx = absDxB;
              absDy = absDyB;
              bleedArea = bleedB;
              paintCost = costB;
            }
          }
          const maxAbsOffset = Math.max(absDx, absDy);
          const offsetSum = absDx + absDy;
          const partnerArea = Math.max(0, partner.w) * Math.max(0, partner.h);
          if (
            paintCost < bestPaintCost ||
            (paintCost === bestPaintCost && (
              partnerArea < bestPartnerArea ||
              (partnerArea === bestPartnerArea && (
                bleedArea < bestBleedArea ||
                (bleedArea === bestBleedArea && (
                  maxAbsOffset < bestMaxAbsOffset ||
                  (maxAbsOffset === bestMaxAbsOffset && (
                    offsetSum < bestOffsetSum ||
                    (offsetSum === bestOffsetSum && (
                      !bestPartner ||
                      compareStampTie(base, bestBase ?? base) < 0 ||
                      (bestBase && compareStampTie(base, bestBase) === 0 && compareStampTie(partner, bestPartner) < 0)
                    ))
                  ))
                ))
              ))
            ))
          ) {
            bestBase = base;
            bestPartner = partner;
            bestPaintCost = paintCost;
            bestPartnerArea = partnerArea;
            bestBleedArea = bleedArea;
            bestMaxAbsOffset = maxAbsOffset;
            bestOffsetSum = offsetSum;
          }
        }
      }
    }

    if (!bestBase || !bestPartner) return null;
    return { base: bestBase, partner: bestPartner };
  };

  const strictConstraints: StampConstraints = {
    maxOffset: STAMP_MAX_OFFSET,
    maxPseudoSpan: STAMP_MAX_PSEUDO_SPAN,
    maxBleedArea: STAMP_MAX_BLEED_AREA
  };
  const relaxedConstraints: StampConstraints = {
    maxOffset: STAMP_MAX_OFFSET_RELAXED,
    maxPseudoSpan: STAMP_MAX_PSEUDO_SPAN_RELAXED,
    maxBleedArea: STAMP_MAX_BLEED_AREA_RELAXED
  };

  const emitStamp = (base: BrushRect, partner: BrushRect): void => {
    output.push({
      mode: "STAMP",
      r0: base.y,
      c0: base.x,
      r1: base.y + base.h,
      c1: base.x + base.w,
      baseColor: base.color,
      before: partner
    });
    used[base.id] = true;
    used[partner.id] = true;
  };

  const emitBase = (rect: BrushRect): void => {
    output.push({
      mode: "BASE",
      r0: rect.y,
      c0: rect.x,
      r1: rect.y + rect.h,
      c1: rect.x + rect.w,
      baseColor: rect.color
    });
    used[rect.id] = true;
  };

  const leftovers: BrushRect[] = [];
  for (const rect of rectsSorted) {
    if (used[rect.id]) continue;
    const pair = findBestStampPartner(rect, strictConstraints, true);
    if (pair) {
      emitStamp(pair.base, pair.partner);
      continue;
    }
    leftovers.push(rect);
  }

  for (const rect of leftovers) {
    if (used[rect.id]) continue;
    const pair = findBestStampPartner(rect, relaxedConstraints, false);
    if (pair) {
      emitStamp(pair.base, pair.partner);
      continue;
    }
    emitBase(rect);
  }

  return output;
};

type PlaneShellRenderStats = {
  paintCells: number;
  brushNodes: number;
  pseudoLayers: number;
  pseudoArea: number;
  svgNodes: number;
  svgPaths: number;
  compositeNodes: number;
};

const renderFacePlans = (
  hosts: PlaneShellDomState,
  snapshot: PlaneShellSnapshot,
  documentRef: Document,
  plans: FacePlan[]
): PlaneShellRenderStats => {
  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const walls = context.walls ?? DEFAULT_WALLS;
  const brushRects: BrushRect[] = [];
  const packedBrushes: PackedBrush[] = [];
  const svgHosts: FaceSvgHost[] = [];
  let totalPaintCells = 0;
  let totalBrushNodes = 0;
  let totalPseudoLayers = 0;
  let totalPseudoArea = 0;
  let totalSvgNodes = 0;
  let totalSvgPaths = 0;
  const axisState: Record<PlaneShellAxis, { host: HTMLElement; pool: Element[]; index: number }> = {
    z: { host: hosts.zHost, pool: hosts.zPool, index: 0 },
    x: { host: hosts.xHost, pool: hosts.xPool, index: 0 },
    y: { host: hosts.yHost, pool: hosts.yPool, index: 0 }
  };
  const brushCache = hosts.faceBrushCache as Map<string, FaceBrushCacheEntry>;
  const nextElement = (axis: PlaneShellAxis, tag: "b" | "svg"): Element => {
    const bucket = axisState[axis];
    const i = bucket.index++;
    let el = bucket.pool[i];
    const wantsSvg = tag === "svg";
    if (el) {
      const tagName = el.tagName.toLowerCase();
      if ((wantsSvg && tagName !== "svg") || (!wantsSvg && tagName !== "b")) {
        el.remove();
        el = undefined;
      }
    }
    if (!el) {
      el = wantsSvg ? documentRef.createElementNS(SVG_NS, "svg") : documentRef.createElement("b");
      bucket.pool[i] = el;
      bucket.host.appendChild(el);
    } else if (el.parentElement !== bucket.host) {
      bucket.host.appendChild(el);
    }
    if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement && el.style.display === "none") el.style.display = "";
    return el;
  };
  const nextBrush = (axis: PlaneShellAxis): HTMLElement => nextElement(axis, "b") as HTMLElement;
  const nextSvg = (axis: PlaneShellAxis): SVGSVGElement => nextElement(axis, "svg") as SVGSVGElement;
  const getPlaneOffset = (axis: PlaneShellAxis, plane: number): number =>
    axis === "z"
      ? plane * layerElevation
      : -1 * (plane - 1) * tileSize;
    const gridAreaFor = (row0: number, col0: number, row1: number, col1: number): string =>
      `${row0} / ${col0} / ${row1} / ${col1}`;

    const countPseudoLayers = (brush: PackedBrush, absorbPlans?: AbsorbPlan[]): number => {
      let hasBefore = !!brush.before;
      let hasAfter = !!brush.after;
      if (absorbPlans) {
        for (const plan of absorbPlans) {
          if (plan.slot === "before") hasBefore = true;
          else if (plan.slot === "after") hasAfter = true;
        }
      }
      return (hasBefore ? 1 : 0) + (hasAfter ? 1 : 0);
    };

    const getPseudoArea = (brush: PackedBrush, absorbPlans?: AbsorbPlan[]): number => {
      let beforeRect = brush.before;
      let afterRect = brush.after;
      if (absorbPlans) {
        for (const plan of absorbPlans) {
          if (plan.slot === "before") beforeRect = paintRectToBrushRect(plan.rect);
          else if (plan.slot === "after") afterRect = paintRectToBrushRect(plan.rect);
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

    for (const plan of plans) {
      const { axis, plane, face } = plan.key;
      if (walls[face]) continue;
      const planeOffset = getPlaneOffset(axis, plane);
    const stampOffset = STAMP_FACE_Z_OFFSET[face] ?? 0.12;
    const brushZ = formatZOffset(planeOffset + stampOffset);
    const cellWidthPx = axis === "y" ? layerElevation : tileSize;
    const cellHeightPx = axis === "x" ? layerElevation : tileSize;
    const pseudoEpsilonPx = 0;
    const applyPseudoRect = (
      target: HTMLElement,
      contentVar: "before" | "after",
      rect: BrushRect,
      bbox: PackedBrush
    ): void => {
      const prefix = contentVar === "before" ? "--vox-b" : "--vox-a";
      const leftPx = (rect.x - bbox.c0) * cellWidthPx - pseudoEpsilonPx;
      const topPx = (rect.y - bbox.r0) * cellHeightPx - pseudoEpsilonPx;
      const widthPx = rect.w * cellWidthPx + pseudoEpsilonPx * 2;
      const heightPx = rect.h * cellHeightPx + pseudoEpsilonPx * 2;
      setCssVarIfDiff(target, `${prefix}c`, "''");
      setCssVarIfDiff(target, `${prefix}l`, `${leftPx}px`);
      setCssVarIfDiff(target, `${prefix}t`, `${topPx}px`);
      setCssVarIfDiff(target, `${prefix}w`, `${widthPx}px`);
      setCssVarIfDiff(target, `${prefix}h`, `${heightPx}px`);
      setCssVarIfDiff(target, `${prefix}col`, rect.color);
      setCssVarIfDiff(target, "--vox-z", brushZ);
    };

    const disablePseudo = (target: HTMLElement, contentVar: "before" | "after"): void => {
      const varName = contentVar === "before" ? "--vox-bc" : "--vox-ac";
      setCssVarIfDiff(target, varName, "none");
    };

    const applyBrushWithPlacement = (
      target: HTMLElement,
      brush: PackedBrush,
      gridArea: string,
      placement: "grid" | "nested",
      parentBrush?: PackedBrush,
      absorbPlans?: AbsorbPlan[]
    ): void => {
      let beforeRect = brush.before;
      let afterRect = brush.after;
      if (absorbPlans) {
        for (const absorbPlan of absorbPlans) {
          if (absorbPlan.slot === "before") beforeRect = paintRectToBrushRect(absorbPlan.rect);
          else if (absorbPlan.slot === "after") afterRect = paintRectToBrushRect(absorbPlan.rect);
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
      clearPlaneDetailVars(target);
      const areaValue = placement === "grid" ? gridArea : "";
      applyBrush(target, areaValue, brush.baseColor, brushZ);
      if (placement === "nested") {
        setStyleIfDiff(target, "transform", "none");
        clearCssVar(target, "--vox-z");
      } else {
        setStyleIfDiff(target, "transform", "");
      }
      if (beforeRect) applyPseudoRect(target, "before", beforeRect, brush);
      else disablePseudo(target, "before");
      if (afterRect) applyPseudoRect(target, "after", afterRect, brush);
      else disablePseudo(target, "after");
      if (placement === "nested") clearCssVar(target, "--vox-z");
      if (placement === "nested" && parentBrush) {
        const leftPx = (brush.c0 - parentBrush.c0) * cellWidthPx;
        const topPx = (brush.r0 - parentBrush.r0) * cellHeightPx;
        const widthPx = (brush.c1 - brush.c0) * cellWidthPx;
        const heightPx = (brush.r1 - brush.r0) * cellHeightPx;
        setStyleIfDiff(target, "position", "absolute");
        setStyleIfDiff(target, "left", `${leftPx}px`);
        setStyleIfDiff(target, "top", `${topPx}px`);
        setStyleIfDiff(target, "width", `${widthPx}px`);
        setStyleIfDiff(target, "height", `${heightPx}px`);
        setStyleIfDiff(target, "gridArea", "");
      }
    };

    const getBrushPaintedCells = (brush: PackedBrush): number => {
      const baseColor = normalizePaintColor(brush.baseColor);
      const baseW = brush.c1 - brush.c0;
      const baseH = brush.r1 - brush.r0;
      const baseArea = baseColor && baseW > 0 && baseH > 0 ? baseW * baseH : 0;
      if (baseArea) {
        return baseArea;
      }
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
    const faceCacheKey = `${axis}:${plane}:${face}`;
    const cacheEntry = brushCache.get(faceCacheKey);
    const canReuseBrushes = cacheEntry && cacheEntry.signatureHash === plan.signatureHash;
    let brushesToRender: PackedBrush[];
    let svgHostsForFace: FaceSvgHost[] = [];
    let pairing: BrushPairing;
    let paintedCells: number[];
    if (canReuseBrushes && cacheEntry) {
      brushesToRender = cacheEntry.brushes;
      svgHostsForFace = cacheEntry.svgHosts;
      pairing = cacheEntry.pairing ?? buildBrushPairing(brushesToRender);
      paintedCells = cacheEntry.paintedCells ?? brushesToRender.map(getBrushPaintedCells);
      if (!cacheEntry.pairing) cacheEntry.pairing = pairing;
      if (!cacheEntry.paintedCells) cacheEntry.paintedCells = paintedCells;
    } else {
      brushRects.length = 0;
      packedBrushes.length = 0;
      svgHosts.length = 0;
      let rectId = 0;
      const safeColorOrNull = (value?: string): string | null => normalizePaintColor(value);
      for (const host of plan.hosts) {
        const hostRow0 = plan.originRow + host.r0;
        const hostCol0 = plan.originCol + host.c0;
        const hostRow1 = plan.originRow + host.r1;
        const hostCol1 = plan.originCol + host.c1;
        const hostWidth = host.c1 - host.c0;
        const hostHeight = host.r1 - host.r0;
        const gridArea = gridAreaFor(hostRow0, hostCol0, hostRow1, hostCol1);

        if (host.baseColorId >= 0) {
          const baseColor = safeColorOrNull(plan.palette[host.baseColorId]);
          const area = hostWidth * hostHeight;
          if (baseColor && area > 0) {
            brushRects.push({
              x: hostCol0,
              y: hostRow0,
              w: hostWidth,
              h: hostHeight,
              color: baseColor,
              area,
              id: rectId++
            });
          }
        }

        if (!host.details.length) continue;

        const detailStart = brushRects.length;
        let detailsValid = true;
        for (const detail of host.details) {
          const rects = getDetailRects(detail);
          if (!rects.length) {
            detailsValid = false;
            break;
          }
          const fill = safeColorOrNull(detail.fill || plan.palette[detail.colorId]);
          if (!fill) {
            detailsValid = false;
            break;
          }
          for (const rect of rects) {
            const width = rect.width;
            const height = rect.height;
            if (width <= 0 || height <= 0) continue;
            brushRects.push({
              x: hostCol0 + rect.x,
              y: hostRow0 + rect.y,
              w: width,
              h: height,
              color: fill,
              area: width * height,
              id: rectId++
            });
          }
        }

        if (!detailsValid) {
          brushRects.length = detailStart;
          svgHosts.push({ host, gridArea, hostWidth, hostHeight });
        }
      }

      const processedBrushes = packRectsToBrushes(brushRects, packedBrushes);
      brushesToRender = processedBrushes;
      svgHostsForFace = svgHosts;
      pairing = buildBrushPairing(brushesToRender);
      paintedCells = brushesToRender.map(getBrushPaintedCells);
      brushCache.set(faceCacheKey, {
        signatureHash: plan.signatureHash,
        brushes: clonePackedBrushes(brushesToRender),
        svgHosts: cloneFaceSvgHosts(svgHostsForFace),
        pairing,
        paintedCells
      });
    }

    let planPaintedCells = 0;
    const brushOrder: number[] = [];
    for (let i = 0; i < brushesToRender.length; i += 1) {
      if (pairing.children.has(i)) continue;
      brushOrder.push(i);
    }
    brushOrder.sort((a, b) => {
      const areaA = paintedCells[a] ?? getBrushPaintedCells(brushesToRender[a]);
      const areaB = paintedCells[b] ?? getBrushPaintedCells(brushesToRender[b]);
      if (areaA !== areaB) return areaB - areaA;
      return a - b;
    });

    for (const i of brushOrder) {
      const packed = brushesToRender[i];
      if (!packed) continue;
      const gridArea = gridAreaFor(packed.r0, packed.c0, packed.r1, packed.c1);
      const brushWidth = packed.c1 - packed.c0;
      const brushHeight = packed.r1 - packed.r0;
      const brushPaintedCells = paintedCells[i] ?? getBrushPaintedCells(packed);
      if (brushWidth <= 0 || brushHeight <= 0 || brushPaintedCells <= 0) continue;
      const brush = nextBrush(axis);
      const absorbPlans = pairing.absorbed.get(i);
      applyBrushWithPlacement(brush, packed, gridArea, "grid", undefined, absorbPlans);
      if (absorbPlans?.length) {
        /* absorb plans captured for rendering only */
      }
      totalBrushNodes += 1;
      totalPseudoLayers += countPseudoLayers(packed, absorbPlans);
      totalPseudoArea += getPseudoArea(packed, absorbPlans);

      planPaintedCells += brushPaintedCells;
    }

    for (const svgHost of svgHostsForFace) {
      const host = svgHost.host;
      if (svgHost.hostWidth <= 0 || svgHost.hostHeight <= 0) continue;
      const svgDetailA = host.details[0];
      const svgDetailB = host.details[1];
      const svgDetailC = host.details[2];
      const svgDetailD = host.details[3];
      const svgPathCount =
        (svgDetailA ? 1 : 0) +
        (svgDetailB ? 1 : 0) +
        (svgDetailC ? 1 : 0) +
        (svgDetailD ? 1 : 0);
      if (!svgPathCount) continue;
      totalSvgNodes += 1;
      totalSvgPaths += svgPathCount;
      const svg = nextSvg(axis);
      svg.setAttribute("preserveAspectRatio", "none");
      setAttrIfDiff(svg, "shape-rendering", "geometricPrecision");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      setStyleIfDiff(svg, "position", "relative");
      setStyleIfDiff(svg, "width", "100%");
      setStyleIfDiff(svg, "height", "100%");
      setStyleIfDiff(svg, "display", "block");
      setStyleIfDiff(svg, "pointerEvents", "none");
      setStyleIfDiff(svg, "transformOrigin", "0 0");
      setStyleIfDiff(svg, "willChange", "transform");
      setStyleIfDiff(svg, "gridArea", svgHost.gridArea);
      setStyleIfDiff(svg, "transform", `translateZ(${brushZ})`);
      setAttrIfDiff(svg, "viewBox", `0 0 ${svgHost.hostWidth} ${svgHost.hostHeight}`);
      const svgState = svg as {
        __voxcssNewStampPathA?: SVGPathElement;
        __voxcssNewStampPathB?: SVGPathElement;
        __voxcssNewStampPathC?: SVGPathElement;
        __voxcssNewStampPathD?: SVGPathElement;
      };
      const ensurePath = (key: "A" | "B" | "C" | "D"): SVGPathElement => {
        const pathKey =
          key === "A" ? "__voxcssNewStampPathA" :
            key === "B" ? "__voxcssNewStampPathB" :
              key === "C" ? "__voxcssNewStampPathC" : "__voxcssNewStampPathD";
        let path = svgState[pathKey];
        if (!path) {
          path = documentRef.createElementNS(SVG_NS, "path");
          svg.appendChild(path);
          svgState[pathKey] = path;
        }
        return path;
      };
      if (svgDetailA) {
        const pathA = ensurePath("A");
        setAttrIfDiff(pathA, "d", svgDetailA.path);
        setAttrIfDiff(pathA, "fill", plan.palette[svgDetailA.colorId] ?? "");
      } else if (svgState.__voxcssNewStampPathA) {
        svgState.__voxcssNewStampPathA.remove();
        svgState.__voxcssNewStampPathA = undefined;
      }
      if (svgDetailB) {
        const pathB = ensurePath("B");
        setAttrIfDiff(pathB, "d", svgDetailB.path);
        setAttrIfDiff(pathB, "fill", plan.palette[svgDetailB.colorId] ?? "");
      } else if (svgState.__voxcssNewStampPathB) {
        svgState.__voxcssNewStampPathB.remove();
        svgState.__voxcssNewStampPathB = undefined;
      }
      if (svgDetailC) {
        const pathC = ensurePath("C");
        setAttrIfDiff(pathC, "d", svgDetailC.path);
        setAttrIfDiff(pathC, "fill", plan.palette[svgDetailC.colorId] ?? "");
      } else if (svgState.__voxcssNewStampPathC) {
        svgState.__voxcssNewStampPathC.remove();
        svgState.__voxcssNewStampPathC = undefined;
      }
      if (svgDetailD) {
        const pathD = ensurePath("D");
        setAttrIfDiff(pathD, "d", svgDetailD.path);
        setAttrIfDiff(pathD, "fill", plan.palette[svgDetailD.colorId] ?? "");
      } else if (svgState.__voxcssNewStampPathD) {
        svgState.__voxcssNewStampPathD.remove();
        svgState.__voxcssNewStampPathD = undefined;
      }
      planPaintedCells += svgHost.hostWidth * svgHost.hostHeight;
    }

    if (PLANE_SHELL_DEV_VERIFY && planPaintedCells === 0) {
      const elements = plan.stats.renderedBrushNodes + plan.stats.svgHosts + plan.stats.svgPaths;
      if (elements !== 0) {
        throw new Error("[VoxCSS] PlaneShell emitted elements for an empty plan");
      }
    }
    totalPaintCells += planPaintedCells;
  }
  for (const axis of Object.keys(axisState) as PlaneShellAxis[]) {
    const bucket = axisState[axis];
    for (let i = bucket.index; i < bucket.pool.length; i += 1) bucket.pool[i]?.remove();
  }
  return {
    paintCells: totalPaintCells,
    brushNodes: totalBrushNodes,
    pseudoLayers: totalPseudoLayers,
    pseudoArea: totalPseudoArea,
    svgNodes: totalSvgNodes,
    svgPaths: totalSvgPaths,
    compositeNodes: totalBrushNodes + totalSvgNodes
  };
};


export { renderFacePlans, packRectsToBrushes, buildBrushPairing, optimizeBrushOverlaps };
