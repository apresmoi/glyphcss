import type { GridContext, Voxel, CubeFace, WallsMask } from "../types";
import { CUBE_FACES } from "../types";
import { getVoxelBounds } from "../context";
import { computeCubeFaceAppearance } from "../faceAppearance";

type PlaneAxis = "x" | "y" | "z";
export interface FaceKey { axis: "x" | "y" | "z"; plane: number; face: CubeFace; }
export interface FaceBuffer {
  width: number;
  height: number;
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  ids: Uint32Array;
  mask: Uint8Array;
  palette: string[];
}
export interface FaceData { key: FaceKey; buffer: FaceBuffer; signatureHash: number; fillCells: number; }
export interface HostRect { r0: number; c0: number; r1: number; c1: number; transparent?: boolean; }
export interface DetailPlan {
  rects: HostRect[];
  fill: string;
}
export interface HostPlan { r0: number; c0: number; r1: number; c1: number; baseColorId: number; details: DetailPlan[]; }

type VoxcssTune = Partial<{
  baseCoverMin: number;
  fragmentationLimit: number;
  detailColorLimit: number;
  minHostArea: number;
  hostCap: number;
  maxSplitDepth: number;
  maxSplitsPerHost: number;
  splitCandidateLimit: number;
  maxSplitsPerFace: number;
  maxHostsPerFace: number;
}>;

const voxcssTune: VoxcssTune | null = (() => {
  if (typeof globalThis === "undefined") return null;
  const raw = (globalThis as { __voxcssTune?: unknown }).__voxcssTune;
  if (!raw || typeof raw !== "object") return null;
  return raw as VoxcssTune;
})();

const tuneNumber = (key: keyof VoxcssTune, fallback: number): number => {
  const value = voxcssTune?.[key];
  return Number.isFinite(value) ? Number(value) : fallback;
};

const FACE_PLAN_VERSION = 1;
const HOST_CAP = tuneNumber("hostCap", 1500);
const BASE_COVER_MIN = tuneNumber("baseCoverMin", 0.3);
const HOST_FILL_RATIO_MIN = 0.6;
const HOST_GAP_MAX = 64;
const DETAIL_COLOR_LIMIT = tuneNumber("detailColorLimit", 4);
const DETAIL_COLOR_LIMIT_TRANSPARENT = 8;
const MAX_SPLIT_DEPTH = tuneNumber("maxSplitDepth", 2);
const MAX_SPLITS_PER_HOST = tuneNumber("maxSplitsPerHost", 2);
const MAX_SPLITS_PER_FACE = tuneNumber("maxSplitsPerFace", 400);
const MAX_HOSTS_PER_FACE = tuneNumber("maxHostsPerFace", 8000);
const MIN_HOST_AREA = tuneNumber("minHostArea", 8);
const FRAGMENTATION_LIMIT = tuneNumber("fragmentationLimit", 400);
const SPLIT_CANDIDATE_LIMIT = tuneNumber("splitCandidateLimit", 4);
export const wallsToSig = (walls: WallsMask): number =>
  (walls.t ? 1 : 0) |
  (walls.b ? 2 : 0) |
  (walls.bl ? 4 : 0) |
  (walls.br ? 8 : 0) |
  (walls.fl ? 16 : 0) |
  (walls.fr ? 32 : 0);

const HASH_SEED = 2166136261;
const HASH_PRIME = 16777619;
const hashUpdate = (hash: number, value: number): number => Math.imul(hash ^ value, HASH_PRIME) >>> 0;
const hashNumber = (hash: number, value: number): number => {
  let v = value >>> 0;
  hash = hashUpdate(hash, v & 0xff);
  hash = hashUpdate(hash, (v >>> 8) & 0xff);
  hash = hashUpdate(hash, (v >>> 16) & 0xff);
  hash = hashUpdate(hash, (v >>> 24) & 0xff);
  return hash;
};
const hashString = (hash: number, value: string): number => {
  for (let i = 0; i < value.length; i += 1) hash = hashUpdate(hash, value.charCodeAt(i));
  return hash;
};

let __colorParserStyle: CSSStyleDeclaration | null = null;
const __colorCache = new Map<string, { r: number; g: number; b: number } | null>();

const getColorParserStyle = (): CSSStyleDeclaration | null => {
  if (typeof document === "undefined") return null;
  if (__colorParserStyle) return __colorParserStyle;
  const style = new Option().style;
  __colorParserStyle = style;
  return style;
};

const normalizeCssColor = (rawColor: string, brightness: number): { r: number; g: number; b: number } | null => {
  const parser = getColorParserStyle();
  if (!parser) return null;
  parser.color = rawColor;
  const computed = parser.color;
  if (!computed) return null;
  const match = computed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+)\s*)?\)$/i);
  if (!match) return null;
  const rRaw = Number(match[1]);
  const gRaw = Number(match[2]);
  const bRaw = Number(match[3]);
  const aRaw = match[4] !== undefined ? Number(match[4]) : 1;
  if (!Number.isFinite(rRaw) || !Number.isFinite(gRaw) || !Number.isFinite(bRaw) || !Number.isFinite(aRaw)) return null;
  if (aRaw < 1) return null;
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  const r = clamp(rRaw * brightness);
  const g = clamp(gRaw * brightness);
  const b = clamp(bRaw * brightness);
  return { r, g, b };
};

function getAppearanceColorKey(
  voxel: Voxel,
  face: CubeFace,
  context: GridContext
): { r: number; g: number; b: number } | null {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  if (appearance.backgroundImage) return null;
  const rawFilter = appearance.filter.trim();
  let brightness = 1;
  if (rawFilter) {
    const match = rawFilter.match(/^brightness\(\s*([^)]+)\s*\)$/i);
    if (!match) return null;
    const body = (match[1] ?? "").trim();
    if (!body) return null;
    if (body.endsWith("%")) {
      const pct = Number(body.slice(0, -1));
      if (!Number.isFinite(pct)) return null;
      brightness = Math.max(0, pct / 100);
    } else {
      const scalar = Number(body);
      if (!Number.isFinite(scalar)) return null;
      brightness = Math.max(0, scalar);
    }
  }
  const rawColor = appearance.backgroundColor.trim();
  if (!rawColor) return null;
  const cacheKey = `${rawColor}||${brightness}`;
  if (__colorCache.has(cacheKey)) {
    const cached = __colorCache.get(cacheKey);
    return cached ? { r: cached.r, g: cached.g, b: cached.b } : null;
  }
  const normalized = normalizeCssColor(rawColor, brightness);
  __colorCache.set(cacheKey, normalized);
  if (!normalized) return null;
  return { r: normalized.r, g: normalized.g, b: normalized.b };
}

function buildFaceBufferFromCells(
  cells: { row: number; col: number; voxel: Voxel }[],
  minRow: number,
  minCol: number,
  maxRow: number,
  maxCol: number,
  face: CubeFace,
  context: GridContext
): { buffer: FaceBuffer; signatureHash: number; fillCells: number } | null {
  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  if (width <= 0 || height <= 0) return null;

  const ids = new Uint32Array(width * height);
  const palette: string[] = [""];
  const colorIndex = new Map<string, number>();
  let fillCells = 0;
  let hash = HASH_SEED;

  for (const cell of cells) {
    const rowOffset = cell.row - minRow;
    const colOffset = cell.col - minCol;
    if (rowOffset < 0 || colOffset < 0 || rowOffset >= height || colOffset >= width) continue;
    const index = rowOffset * width + colOffset;

    const colorInfo = getAppearanceColorKey(cell.voxel, face, context);
    if (!colorInfo) continue;
    const colorKey = `${colorInfo.r},${colorInfo.g},${colorInfo.b},255`;
    let colorId = colorIndex.get(colorKey);
    if (colorId === undefined) {
      colorId = palette.length;
      colorIndex.set(colorKey, colorId);
      palette.push(`rgb(${colorInfo.r}, ${colorInfo.g}, ${colorInfo.b})`);
    }
    if (!ids[index]) fillCells += 1;
    ids[index] = colorId;
    hash = hashString(hashNumber(hashNumber(hash, cell.row), cell.col), colorKey);
  }

  if (!fillCells) return null;
  const mask = new Uint8Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) mask[i] = ids[i] ? 1 : 0;

  return {
    buffer: {
      width,
      height,
      minRow,
      minCol,
      maxRow,
      maxCol,
      ids,
      mask,
      palette
    },
    signatureHash: hash,
    fillCells
  };
}

export const makeRectEngine = (width: number, height: number) => {
  const hist = new Int32Array(width);
  const stack = new Int32Array(width + 1);

  const forEachRectRuns = (
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    isOn: (idx: number) => boolean,
    onRect: (rr0: number, rc0: number, rr1: number, rc1: number) => void
  ): void => {
    const openStore: number[] = [];
    const open = new Map<number, number>();
    const keyFor = (runC0: number, runC1: number): number =>
      runC0 * (width + 1) + runC1;
    const closeRectAt = (index: number): void => {
      onRect(openStore[index], openStore[index + 1], openStore[index + 2], openStore[index + 3]);
    };

    for (let r = r0; r < r1; r += 1) {
      const nextOpen = new Map<number, number>();
      const rowBase = r * width;
      let c = c0;
      while (c < c1) {
        while (c < c1 && !isOn(rowBase + c)) c += 1;
        if (c >= c1) break;
        const runC0 = c;
        while (c < c1 && isOn(rowBase + c)) c += 1;
        const runC1 = c;
        const key = keyFor(runC0, runC1);
        const prevIndex = open.get(key);
        if (prevIndex !== undefined && openStore[prevIndex + 2] === r) {
          openStore[prevIndex + 2] = r + 1;
          nextOpen.set(key, prevIndex);
        } else {
          const index = openStore.length;
          openStore.push(r, runC0, r + 1, runC1);
          nextOpen.set(key, index);
        }
      }

      for (const [key, index] of open) {
        if (!nextOpen.has(key)) closeRectAt(index);
      }

      open.clear();
      for (const [key, index] of nextOpen) open.set(key, index);
    }

    for (const index of open.values()) closeRectAt(index);
  };

  const maxRectInMask = (mask: Uint8Array): [number, number, number, number, number] => {
    hist.fill(0);
    let bestArea = 0;
    let bestR0 = 0;
    let bestC0 = 0;
    let bestR1 = 0;
    let bestC1 = 0;

    for (let r = 0; r < height; r += 1) {
      const rowBase = r * width;
      for (let c = 0; c < width; c += 1) {
        hist[c] = mask[rowBase + c] ? hist[c] + 1 : 0;
      }

      let stackTop = 0;
      for (let c = 0; c <= width; c += 1) {
        const h = c === width ? 0 : hist[c];
        while (stackTop > 0 && h < hist[stack[stackTop - 1]]) {
          const heightValue = hist[stack[stackTop - 1]];
          stackTop -= 1;
          const leftIndex = stackTop > 0 ? stack[stackTop - 1] : -1;
          const area = heightValue * (c - leftIndex - 1);
          if (area > bestArea) {
            bestArea = area;
            bestR1 = r + 1;
            bestR0 = bestR1 - heightValue;
            bestC1 = c;
            bestC0 = leftIndex + 1;
          }
        }
        stack[stackTop] = c;
        stackTop += 1;
      }
    }

    return [bestR0, bestC0, bestR1, bestC1, bestArea];
  };

  const maxRects = (mask: Uint8Array, limit: number, fillCells: number): { rects: HostRect[]; coveredAll: boolean } => {
    const rects: HostRect[] = [];
    const working = mask.slice();
    let remaining = fillCells;
    const clearRect = (r0: number, c0: number, r1: number, c1: number): void => {
      for (let r = r0; r < r1; r += 1) {
        const rowBase = r * width;
        for (let c = c0; c < c1; c += 1) working[rowBase + c] = 0;
      }
    };
    while (rects.length < limit) {
      const [r0, c0, r1, c1, area] = maxRectInMask(working);
      if (!area) break;
      rects.push({ r0, c0, r1, c1 });
      clearRect(r0, c0, r1, c1);
      remaining -= area;
      if (remaining > 0) {
        const minRects = Math.ceil(remaining / area);
        if (rects.length + minRects > limit) return { rects, coveredAll: false };
      }
    }
    return { rects, coveredAll: remaining <= 0 };
  };

  return { forEachRectRuns, maxRects };
};

const buildMaskPsum = (mask: Uint8Array, width: number, height: number): Uint32Array => {
  const psum = new Uint32Array((width + 1) * (height + 1));
  for (let r = 1; r <= height; r += 1) {
    const rowBase = (r - 1) * width;
    const psumRow = r * (width + 1);
    const psumPrev = (r - 1) * (width + 1);
    for (let c = 1; c <= width; c += 1) {
      const idx = rowBase + (c - 1);
      const value = mask[idx] ? 1 : 0;
      psum[psumRow + c] = psum[psumPrev + c] + psum[psumRow + c - 1] - psum[psumPrev + c - 1] + value;
    }
  }
  return psum;
};

const sumRectFromPsum = (psum: Uint32Array, width: number, r0: number, c0: number, r1: number, c1: number): number => {
  const stride = width + 1;
  return psum[r1 * stride + c1] - psum[r0 * stride + c1] - psum[r1 * stride + c0] + psum[r0 * stride + c0];
};

const mergeHostRects = (
  rects: HostRect[],
  psum: Uint32Array,
  width: number,
  height: number
): HostRect[] => {
  const getRectFillStats = (r0: number, c0: number, r1: number, c1: number): { area: number; filled: number; fillRatio: number; emptyCells: number } | null => {
    const area = Math.max(0, r1 - r0) * Math.max(0, c1 - c0);
    if (!area) return null;
    if (r0 < 0 || c0 < 0 || r1 > height || c1 > width) return null;
    const filled = sumRectFromPsum(psum, width, r0, c0, r1, c1);
    const emptyCells = area - filled;
    const fillRatio = area ? filled / area : 0;
    return { area, filled, fillRatio, emptyCells };
  };
  const canMerge = (r0: number, c0: number, r1: number, c1: number): { transparent: boolean } | null => {
    const stats = getRectFillStats(r0, c0, r1, c1);
    if (!stats) return null;
    if (stats.fillRatio >= HOST_FILL_RATIO_MIN || stats.emptyCells <= HOST_GAP_MAX) {
      return { transparent: stats.filled < stats.area };
    }
    return null;
  };
  let current = rects.slice();
  for (let iter = 0; iter < 3; iter += 1) {
    if (current.length < 2) break;
    current.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.r1 - b.r1 || a.c0 - b.c0 || a.c1 - b.c1));
    const horiz: HostRect[] = [];
    for (const rect of current) {
      const last = horiz[horiz.length - 1];
      if (last && rect.r0 === last.r0 && rect.r1 === last.r1 && rect.c0 === last.c1) {
        const r0 = last.r0;
        const c0 = last.c0;
        const r1 = last.r1;
        const c1 = rect.c1;
        const merged = canMerge(r0, c0, r1, c1);
        if (merged) {
          last.c1 = c1;
          last.transparent = merged.transparent;
          continue;
        }
      }
      horiz.push({ ...rect });
    }
    horiz.sort((a, b) => (a.c0 !== b.c0 ? a.c0 - b.c0 : a.c1 - b.c1 || a.r0 - b.r0 || a.r1 - b.r1));
    const vert: HostRect[] = [];
    for (const rect of horiz) {
      const last = vert[vert.length - 1];
      if (last && rect.c0 === last.c0 && rect.c1 === last.c1 && rect.r0 === last.r1) {
        const r0 = last.r0;
        const c0 = last.c0;
        const r1 = rect.r1;
        const c1 = last.c1;
        const merged = canMerge(r0, c0, r1, c1);
        if (merged) {
          last.r1 = r1;
          last.transparent = merged.transparent;
          continue;
        }
      }
      vert.push({ ...rect });
    }
    current = vert;
  }
  return current;
};

const buildFaceDataFromSnapshot = (snapshot: { layers: Voxel[][]; context: GridContext }): FaceData[] => {
  const context = snapshot.context;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);
  const strideXY = rows * cols;
  const occupancy = new Array<Voxel | null>(strideXY * depth).fill(null);
  const occupiedIndices: number[] = [];

  for (let z = 0; z < snapshot.layers.length; z += 1) {
    const layer = snapshot.layers[z];
    if (!layer?.length) continue;
    for (const voxel of layer) {
      if (!voxel) continue;
      const { x2, y2 } = getVoxelBounds(voxel);
      for (let x = voxel.x; x < x2; x += 1) {
        if (x < 0 || x >= rows) continue;
        for (let y = voxel.y; y < y2; y += 1) {
          if (y < 0 || y >= cols) continue;
          const idx = z * strideXY + x * cols + y;
          if (occupancy[idx]) continue;
          occupancy[idx] = voxel;
          occupiedIndices.push(idx);
        }
      }
    }
  }

  const offsets = context.offsets;
  const builders = new Map<string, { key: FaceKey; minRow: number; minCol: number; maxRow: number; maxCol: number; cells: { row: number; col: number; voxel: Voxel }[] }>();
  const addCell = (axis: PlaneAxis, plane: number, face: CubeFace, voxel: Voxel, row: number, col: number): void => {
    const keyStr = `${axis}:${plane}:${face}`;
    let builder = builders.get(keyStr);
    if (!builder) {
      builder = { key: { axis, plane, face }, minRow: row, minCol: col, maxRow: row, maxCol: col, cells: [] };
      builders.set(keyStr, builder);
    }
    builder.cells.push({ row, col, voxel });
    if (row < builder.minRow) builder.minRow = row;
    if (col < builder.minCol) builder.minCol = col;
    if (row > builder.maxRow) builder.maxRow = row;
    if (col > builder.maxCol) builder.maxCol = col;
  };

  for (const idx of occupiedIndices) {
    const z = Math.floor(idx / strideXY);
    const rem = idx - z * strideXY;
    const x = Math.floor(rem / cols);
    const y = rem - x * cols;
    const voxel = occupancy[idx];
    if (!voxel) continue;

    for (const face of CUBE_FACES) {
      const delta = offsets[face];
      if (!delta) continue;
      const [dx, dy, dz] = delta;
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const hasNeighbor =
        nx >= 0 && nx < rows && ny >= 0 && ny < cols && nz >= 0 && nz < depth && occupancy[nz * strideXY + nx * cols + ny];
      if (hasNeighbor) continue;

      if (face === "t" || face === "b") addCell("z", face === "b" ? z : z + 1, face, voxel, x, y);
      else if (face === "bl" || face === "fr") addCell("y", face === "bl" ? y : y + 1, face, voxel, x, z + 1);
      else addCell("x", face === "br" ? x : x + 1, face, voxel, z + 1, y);
    }
  }

  const axisOrder: Record<PlaneAxis, number> = { x: 0, y: 1, z: 2 };
  const faceOrder = new Map<CubeFace, number>();
  CUBE_FACES.forEach((face, index) => faceOrder.set(face, index));

  const buildersList = Array.from(builders.values());
  buildersList.sort((a, b) => {
    const axisDiff = axisOrder[a.key.axis] - axisOrder[b.key.axis];
    if (axisDiff) return axisDiff;
    if (a.key.plane !== b.key.plane) return a.key.plane - b.key.plane;
    return (faceOrder.get(a.key.face) ?? 0) - (faceOrder.get(b.key.face) ?? 0);
  });
  for (const builder of buildersList) {
    if (builder.cells.length > 1) {
      builder.cells.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
    }
  }

  const faces: FaceData[] = [];
  for (const builder of buildersList) {
    if (!builder.cells.length) continue;
    const built = buildFaceBufferFromCells(
      builder.cells,
      builder.minRow,
      builder.minCol,
      builder.maxRow,
      builder.maxCol,
      builder.key.face,
      context
    );
    if (!built) continue;
    const { buffer, signatureHash, fillCells } = built;
    if (!fillCells) continue;
    faces.push({ key: builder.key, buffer, signatureHash, fillCells });
  }

  return faces;
};

type HistogramScratch = { counts: Int32Array; touched: number[]; };
const resetHistogram = (scratch: HistogramScratch): void => {
  for (const id of scratch.touched) scratch.counts[id] = 0;
  scratch.touched.length = 0;
};

const analyzeHostColors = (
  buffer: FaceBuffer,
  rect: HostRect,
  scratch: HistogramScratch,
  allowEmpty: boolean
): { baseColorId: number; baseCount: number; uniqueColors: number; baseCoverage: number; nonBaseCoverage: number; area: number; colorCounts: { colorId: number; count: number }[]; invalid: boolean } => {
  const { ids, width } = buffer;
  const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
  if (!area) {
    return { baseColorId: 0, baseCount: 0, uniqueColors: 0, baseCoverage: 0, nonBaseCoverage: 0, area, colorCounts: [], invalid: true };
  }
  let baseColorId = 0;
  let baseCount = 0;
  let uniqueColors = 0;
  let invalid = false;
  for (let r = rect.r0; r < rect.r1; r += 1) {
    const rowBase = r * width;
    for (let c = rect.c0; c < rect.c1; c += 1) {
      const id = ids[rowBase + c];
      if (!id) {
        if (!allowEmpty) invalid = true;
        continue;
      }
      const prev = scratch.counts[id];
      if (!prev) scratch.touched.push(id), uniqueColors += 1;
      const next = prev + 1;
      scratch.counts[id] = next;
      if (next > baseCount) {
        baseCount = next;
        baseColorId = id;
      }
    }
  }
  const colorCounts = scratch.touched.map((id) => ({ colorId: id, count: scratch.counts[id] }));
  colorCounts.sort((a, b) => b.count - a.count || a.colorId - b.colorId);
  const baseCoverage = area ? baseCount / area : 0;
  const nonBaseCoverage = 1 - baseCoverage;
  resetHistogram(scratch);
  return { baseColorId, baseCount, uniqueColors, baseCoverage, nonBaseCoverage, area, colorCounts, invalid };
};

const extractColorRects = (
  buffer: FaceBuffer,
  rect: HostRect,
  colorId: number,
  rectEngine: ReturnType<typeof makeRectEngine>
): HostRect[] => {
  const rects: HostRect[] = [];
  rectEngine.forEachRectRuns(
    rect.r0,
    rect.c0,
    rect.r1,
    rect.c1,
    (idx) => buffer.ids[idx] === colorId,
    (r0, c0, r1, c1) => {
      rects.push({ r0: r0 - rect.r0, c0: c0 - rect.c0, r1: r1 - rect.r0, c1: c1 - rect.c0 });
    }
  );
  return rects;
};

const mergeAdjacentRectsExact = (rects: HostRect[]): HostRect[] => {
  if (rects.length < 2) return rects;
  rects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
  const horiz: HostRect[] = [];
  for (const rect of rects) {
    const last = horiz[horiz.length - 1];
    if (last && rect.r0 === last.r0 && rect.r1 === last.r1 && rect.c0 === last.c1) {
      last.c1 = rect.c1;
      continue;
    }
    horiz.push({ ...rect });
  }
  horiz.sort((a, b) => (a.c0 !== b.c0 ? a.c0 - b.c0 : a.r0 - b.r0 || a.c1 - b.c1 || a.r1 - b.r1));
  const merged: HostRect[] = [];
  for (const rect of horiz) {
    const last = merged[merged.length - 1];
    if (last && rect.c0 === last.c0 && rect.c1 === last.c1 && rect.r0 === last.r1) {
      last.r1 = rect.r1;
      continue;
    }
    merged.push({ ...rect });
  }
  return merged;
};

const pickTopK = (scores: Int32Array, k: number): number[] => {
  const indices = Array.from(scores.keys());
  indices.sort((a, b) => scores[b] - scores[a] || a - b);
  return indices.slice(0, Math.max(0, Math.min(k, indices.length)));
};

const chooseSplitLine = (
  buffer: FaceBuffer,
  rect: HostRect,
  parentUniqueColors: number,
  parentNonBaseCoverage: number,
  allowEmpty: boolean
): { axis: "v" | "h"; line: number } | null => {
  const width = rect.c1 - rect.c0;
  const height = rect.r1 - rect.r0;
  if (width < 2 && height < 2) return null;
  const ids = buffer.ids;
  const stride = buffer.width;

  const vertScores = width >= 2 ? new Int32Array(width - 1) : null;
  const horizScores = height >= 2 ? new Int32Array(height - 1) : null;
  if (vertScores) {
    for (let r = rect.r0; r < rect.r1; r += 1) {
      const rowBase = r * stride;
      for (let c = rect.c0 + 1; c < rect.c1; c += 1) {
        if (ids[rowBase + c] !== ids[rowBase + c - 1]) vertScores[c - rect.c0 - 1] += 1;
      }
    }
  }
  if (horizScores) {
    for (let r = rect.r0 + 1; r < rect.r1; r += 1) {
      const rowBase = r * stride;
      const prevBase = (r - 1) * stride;
      for (let c = rect.c0; c < rect.c1; c += 1) {
        if (ids[rowBase + c] !== ids[prevBase + c]) horizScores[r - rect.r0 - 1] += 1;
      }
    }
  }

  const candidates: { axis: "v" | "h"; line: number }[] = [];
  if (vertScores && vertScores.length) {
    const top = pickTopK(vertScores, SPLIT_CANDIDATE_LIMIT);
    for (const idx of top) candidates.push({ axis: "v", line: rect.c0 + 1 + idx });
    const mid = rect.c0 + Math.floor(width / 2);
    if (mid > rect.c0 && mid < rect.c1 && !candidates.some((c) => c.axis === "v" && c.line === mid)) {
      candidates.push({ axis: "v", line: mid });
    }
  }
  if (horizScores && horizScores.length) {
    const top = pickTopK(horizScores, SPLIT_CANDIDATE_LIMIT);
    for (const idx of top) candidates.push({ axis: "h", line: rect.r0 + 1 + idx });
    const mid = rect.r0 + Math.floor(height / 2);
    if (mid > rect.r0 && mid < rect.r1 && !candidates.some((c) => c.axis === "h" && c.line === mid)) {
      candidates.push({ axis: "h", line: mid });
    }
  }

  if (!candidates.length) return null;

  const scratchA: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };
  const scratchB: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };

  let best: { axis: "v" | "h"; line: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestTie = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const isVertical = candidate.axis === "v";
    const line = candidate.line;
    const leftArea = isVertical ? (line - rect.c0) * height : (line - rect.r0) * width;
    const rightArea = isVertical ? (rect.c1 - line) * height : (rect.r1 - line) * width;
    if (leftArea < MIN_HOST_AREA || rightArea < MIN_HOST_AREA) continue;
    resetHistogram(scratchA);
    resetHistogram(scratchB);
    const leftStats = analyzeHostColors(buffer, isVertical
      ? { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: line }
      : { r0: rect.r0, c0: rect.c0, r1: line, c1: rect.c1 }, scratchA, allowEmpty);
    const rightStats = analyzeHostColors(buffer, isVertical
      ? { r0: rect.r0, c0: line, r1: rect.r1, c1: rect.c1 }
      : { r0: line, c0: rect.c0, r1: rect.r1, c1: rect.c1 }, scratchB, allowEmpty);
    if (leftStats.invalid || rightStats.invalid) continue;
    const score = Math.max(leftStats.uniqueColors, rightStats.uniqueColors);
    const tie = Math.max(leftStats.nonBaseCoverage, rightStats.nonBaseCoverage);
    if (score < bestScore || (score === bestScore && tie < bestTie)) {
      bestScore = score;
      bestTie = tie;
      best = candidate;
    }
  }

  if (!best) return null;
  if (bestScore > parentUniqueColors) return null;
  if (bestScore === parentUniqueColors && bestTie >= parentNonBaseCoverage) return null;
  return best;
};

const buildFallbackHostsForFace = (
  buffer: FaceBuffer,
  rectEngine: ReturnType<typeof makeRectEngine>
): HostPlan[] => {
  const { ids, palette, width, height } = buffer;
  const colorCounts = new Int32Array(palette.length);
  for (let i = 0; i < ids.length; i += 1) if (ids[i]) colorCounts[ids[i]] += 1;
  const fallbackHosts: HostPlan[] = [];
  const mask = new Uint8Array(ids.length);
  for (let colorId = 1; colorId < colorCounts.length; colorId += 1) {
    if (!colorCounts[colorId]) continue;
    mask.fill(0);
    for (let i = 0; i < ids.length; i += 1) mask[i] = ids[i] === colorId ? 1 : 0;
    const { rects } = rectEngine.maxRects(mask, colorCounts[colorId], colorCounts[colorId]);
    for (const rect of rects) {
      if (rect.r1 <= rect.r0 || rect.c1 <= rect.c0) continue;
      fallbackHosts.push({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId: colorId, details: [] });
    }
  }
  fallbackHosts.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
  return fallbackHosts;
};

const buildFacePlan = (faceData: FaceData): HostPlan[] => {
  const { buffer, fillCells } = faceData;
  const rectEngine = makeRectEngine(buffer.width, buffer.height);
  const { rects } = rectEngine.maxRects(buffer.mask, HOST_CAP, fillCells);
  const psum = buildMaskPsum(buffer.mask, buffer.width, buffer.height);
  const mergedRects = mergeHostRects(rects, psum, buffer.width, buffer.height);
  const hostRects = mergedRects;
  let coveredCells = 0;
  for (const rect of hostRects) coveredCells += sumRectFromPsum(psum, buffer.width, rect.r0, rect.c0, rect.r1, rect.c1);
  const chosenCoveredAll = coveredCells === fillCells;
  // Coverage must reflect the rects we actually render.
  const hosts: HostPlan[] = [];
  let splitCount = 0;
  let fallback = !chosenCoveredAll;
  const scratch: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };

  const addHost = (plan: HostPlan): void => {
    hosts.push(plan);
  };

  const processHost = (rect: HostRect, depth: number, splitsRemaining: number): boolean => {
    if (fallback) return false;
    const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
    if (!area) return true;
    const transparentHost = rect.transparent === true;
    const analysis = analyzeHostColors(buffer, rect, scratch, transparentHost);
    if (analysis.invalid || (!analysis.baseColorId && !transparentHost)) {
      fallback = true;
      return false;
    }
    const detailLimit = transparentHost ? DETAIL_COLOR_LIMIT_TRANSPARENT : DETAIL_COLOR_LIMIT;
    const needsSplit = transparentHost
      ? analysis.uniqueColors > detailLimit
      : analysis.uniqueColors > detailLimit + 1 || analysis.baseCoverage < BASE_COVER_MIN;
    const detailColors = transparentHost
      ? analysis.colorCounts.map((entry) => entry.colorId)
      : analysis.colorCounts
        .filter((entry) => entry.colorId !== analysis.baseColorId)
        .slice(0, detailLimit)
        .map((entry) => entry.colorId);
    const canStamp = transparentHost
      ? !needsSplit && analysis.uniqueColors <= detailLimit
      : !needsSplit && analysis.uniqueColors <= detailLimit + 1 && analysis.baseCoverage >= BASE_COVER_MIN;
    const baseColorId = transparentHost ? -1 : analysis.baseColorId;
    if (canStamp && !detailColors.length) {
      addHost({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId, details: [] });
      return true;
    }
    if (canStamp && detailColors.length) {
      const detailPlans = detailColors.map((colorId) => {
        let rects = extractColorRects(buffer, rect, colorId, rectEngine);
        rects = mergeAdjacentRectsExact(rects);
        rects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
        const fill = buffer.palette[colorId] ?? "";
        return { rects, fill };
      });
      const rectRunCount = detailPlans.reduce((sum, entry) => sum + entry.rects.length, 0);
      if (rectRunCount <= FRAGMENTATION_LIMIT) {
        addHost({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId, details: detailPlans });
        return true;
      }
    }

    if (depth < MAX_SPLIT_DEPTH && splitsRemaining > 0 && area >= MIN_HOST_AREA) {
      const split = chooseSplitLine(buffer, rect, analysis.uniqueColors, analysis.nonBaseCoverage, transparentHost);
      if (split) {
        splitCount += 1;
        const nextSplits = splitsRemaining - 1;
        const a = split.axis === "v"
          ? { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: split.line }
          : { r0: rect.r0, c0: rect.c0, r1: split.line, c1: rect.c1 };
        const b = split.axis === "v"
          ? { r0: rect.r0, c0: split.line, r1: rect.r1, c1: rect.c1 }
          : { r0: split.line, c0: rect.c0, r1: rect.r1, c1: rect.c1 };
        if (!processHost(a, depth + 1, nextSplits)) return false;
        if (!processHost(b, depth + 1, nextSplits)) return false;
        return true;
      }
    }
    fallback = true;
    return false;
  };

  if (!fallback) {
    const sorted = hostRects.slice().sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
    for (const rect of sorted) {
      if (hosts.length > MAX_HOSTS_PER_FACE) {
        fallback = true;
        break;
      }
      if (!processHost(rect, 0, MAX_SPLITS_PER_HOST)) break;
      if (splitCount > MAX_SPLITS_PER_FACE) {
        fallback = true;
        break;
      }
    }
  }

  if (fallback) {
    hosts.length = 0;
    const fallbackHosts = buildFallbackHostsForFace(buffer, rectEngine);
    for (const host of fallbackHosts) addHost(host);
  }


  return hosts;
};

const buildCacheKey = (face: FaceData): string => {
  let hash = HASH_SEED;
  hash = hashNumber(hash, FACE_PLAN_VERSION);
  hash = hashNumber(hash, HOST_CAP);
  hash = hashNumber(hash, Math.round(BASE_COVER_MIN * 1000));
  hash = hashNumber(hash, Math.round(HOST_FILL_RATIO_MIN * 1000));
  hash = hashNumber(hash, HOST_GAP_MAX);
  hash = hashNumber(hash, DETAIL_COLOR_LIMIT);
  hash = hashNumber(hash, DETAIL_COLOR_LIMIT_TRANSPARENT);
  hash = hashNumber(hash, MAX_SPLIT_DEPTH);
  hash = hashNumber(hash, MAX_SPLITS_PER_HOST);
  hash = hashNumber(hash, MAX_SPLITS_PER_FACE);
  hash = hashNumber(hash, MAX_HOSTS_PER_FACE);
  hash = hashNumber(hash, MIN_HOST_AREA);
  hash = hashNumber(hash, FRAGMENTATION_LIMIT);
  for (const color of face.buffer.palette) hash = hashString(hash, color);
  const { axis, plane, face: faceKey } = face.key;
  return `${axis}:${plane}:${faceKey}:${face.buffer.minRow}:${face.buffer.minCol}:${face.buffer.maxRow}:${face.buffer.maxCol}:${face.fillCells}:${face.signatureHash}:${hash}`;
};

export { buildCacheKey, buildFaceDataFromSnapshot, buildFacePlan };
