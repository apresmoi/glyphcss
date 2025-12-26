import type { GridContext, RenderState, Voxel, CubeFace, WallsMask } from "./types";
import { DEFAULT_WALLS, CUBE_FACES } from "./types";
import { getVoxelBounds } from "./context";
import { computeCubeFaceAppearance } from "./faceAppearance";

type PlaneAxis = "x" | "y" | "z";
interface FaceKey { axis: "x" | "y" | "z"; plane: number; face: CubeFace; }
interface FaceBuffer {
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
interface FaceData { key: FaceKey; buffer: FaceBuffer; signatureHash: number; fillCells: number; }
interface HostRect { r0: number; c0: number; r1: number; c1: number; transparent?: boolean; }

const FACE_PLAN_VERSION = 1;
const HOST_CAP = 1500;
const BASE_COVER_MIN = 0.3;
const HOST_FILL_RATIO_MIN = 0.6;
const HOST_GAP_MAX = 64;
const DETAIL_COLOR_LIMIT = 4;
const DETAIL_COLOR_LIMIT_TRANSPARENT = 8;
const MAX_SPLIT_DEPTH = 2;
const MAX_SPLITS_PER_HOST = 2;
const MAX_SPLITS_PER_FACE = 400;
const MAX_HOSTS_PER_FACE = 8000;
const MIN_HOST_AREA = 8;
const FRAGMENTATION_LIMIT = 400;
const SPLIT_CANDIDATE_LIMIT = 4;
const SLICE_RENDERER_VERSION = 1;

const wallsToSig = (walls: WallsMask): number =>
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

const makeRectEngine = (width: number, height: number) => {
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
): { baseColorId: number; uniqueColors: number; baseCoverage: number; colorCounts: { colorId: number; count: number }[]; invalid: boolean } => {
  const { ids, width } = buffer;
  const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
  if (!area) {
    return { baseColorId: 0, uniqueColors: 0, baseCoverage: 0, colorCounts: [], invalid: true };
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
  resetHistogram(scratch);
  return { baseColorId, uniqueColors, baseCoverage, colorCounts, invalid };
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
    const limit = Math.max(0, Math.min(SPLIT_CANDIDATE_LIMIT, vertScores.length));
    const top: Array<{ idx: number; score: number }> = [];
    for (let idx = 0; idx < vertScores.length; idx += 1) {
      const score = vertScores[idx];
      let pos = top.length;
      for (let i = 0; i < top.length; i += 1) {
        const entry = top[i];
        if (score > entry.score || (score === entry.score && idx < entry.idx)) {
          pos = i;
          break;
        }
      }
      if (pos === top.length && top.length >= limit) continue;
      top.splice(pos, 0, { idx, score });
      if (top.length > limit) top.length = limit;
    }
    for (const entry of top) candidates.push({ axis: "v", line: rect.c0 + 1 + entry.idx });
    const mid = rect.c0 + Math.floor(width / 2);
    if (mid > rect.c0 && mid < rect.c1 && !candidates.some((c) => c.axis === "v" && c.line === mid)) {
      candidates.push({ axis: "v", line: mid });
    }
  }
  if (horizScores && horizScores.length) {
    const limit = Math.max(0, Math.min(SPLIT_CANDIDATE_LIMIT, horizScores.length));
    const top: Array<{ idx: number; score: number }> = [];
    for (let idx = 0; idx < horizScores.length; idx += 1) {
      const score = horizScores[idx];
      let pos = top.length;
      for (let i = 0; i < top.length; i += 1) {
        const entry = top[i];
        if (score > entry.score || (score === entry.score && idx < entry.idx)) {
          pos = i;
          break;
        }
      }
      if (pos === top.length && top.length >= limit) continue;
      top.splice(pos, 0, { idx, score });
      if (top.length > limit) top.length = limit;
    }
    for (const entry of top) candidates.push({ axis: "h", line: rect.r0 + 1 + entry.idx });
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
    const tie = Math.max(1 - leftStats.baseCoverage, 1 - rightStats.baseCoverage);
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

const appendBaseBrush = (
  brushes: Brush[],
  palette: string[],
  region: HostRect,
  baseColorId: number
): boolean => {
  if (baseColorId < 0) return true;
  const color = normalizePaintColor(palette[baseColorId]);
  if (!color) return false;
  const w = region.c1 - region.c0;
  const h = region.r1 - region.r0;
  if (w > 0 && h > 0) {
    brushes.push({
      r0: region.r0,
      c0: region.c0,
      r1: region.r1,
      c1: region.c1,
      baseColor: color
    });
  }
  return true;
};

const appendDetailBrushes = (
  brushes: Brush[],
  region: HostRect,
  details: Array<{ rects: HostRect[]; fill: string }>
): boolean => {
  if (!details.length) return true;
  const byColor = new Map<string, Array<{ x: number; y: number; w: number; h: number }>>();
  for (const detail of details) {
    const rectRuns = detail.rects;
    if (!rectRuns.length) return false;
    const fill = normalizePaintColor(detail.fill);
    if (!fill) return false;
    let list = byColor.get(fill);
    if (!list) {
      list = [];
      byColor.set(fill, list);
    }
    for (const rect of rectRuns) {
      const width = rect.c1 - rect.c0;
      const height = rect.r1 - rect.r0;
      if (width <= 0 || height <= 0) continue;
      list.push({ x: rect.c0, y: rect.r0, w: width, h: height });
    }
  }
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
        brushes.push({
          r0: region.r0 + rect.r0,
          c0: region.c0 + rect.c0,
          r1: region.r0 + rect.r1,
          c1: region.c0 + rect.c1,
          baseColor: color
        });
      }
      continue;
    }
    for (const rect of runs) {
      brushes.push({
        r0: region.r0 + rect.y,
        c0: region.c0 + rect.x,
        r1: region.r0 + rect.y + rect.h,
        c1: region.c0 + rect.x + rect.w,
        baseColor: color
      });
    }
  }
  return true;
};

const buildFallbackHostBrushes = (
  buffer: FaceBuffer,
  rectEngine: ReturnType<typeof makeRectEngine>
): Brush[] | null => {
  const { ids, palette, width, height } = buffer;
  const colorCounts = new Int32Array(palette.length);
  for (let i = 0; i < ids.length; i += 1) if (ids[i]) colorCounts[ids[i]] += 1;
  const paletteColors: string[] = new Array(palette.length).fill("");
  const items: Array<{ r0: number; c0: number; r1: number; c1: number; colorId: number }> = [];
  const mask = new Uint8Array(ids.length);
  for (let colorId = 1; colorId < colorCounts.length; colorId += 1) {
    if (!colorCounts[colorId]) continue;
    const color = normalizePaintColor(palette[colorId]);
    if (!color) return null;
    paletteColors[colorId] = color;
    mask.fill(0);
    for (let i = 0; i < ids.length; i += 1) mask[i] = ids[i] === colorId ? 1 : 0;
    const { rects } = rectEngine.maxRects(mask, colorCounts[colorId], colorCounts[colorId]);
    for (const rect of rects) {
      if (rect.r1 <= rect.r0 || rect.c1 <= rect.c0) continue;
      items.push({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, colorId });
    }
  }
  items.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
  const brushes: Brush[] = [];
  for (const item of items) {
    const color = paletteColors[item.colorId];
    if (!color) return null;
    brushes.push({
      r0: item.r0,
      c0: item.c0,
      r1: item.r1,
      c1: item.c1,
      baseColor: color
    });
  }
  return brushes;
};

const buildPlannedBrushes = (
  faceData: FaceData,
  rectEngine: ReturnType<typeof makeRectEngine>
): { brushes: Brush[]; fallbackToHosts: boolean; invalidColor: boolean } => {
  const { buffer, fillCells } = faceData;
  const { palette } = buffer;
  const { rects } = rectEngine.maxRects(buffer.mask, HOST_CAP, fillCells);
  const psum = buildMaskPsum(buffer.mask, buffer.width, buffer.height);
  const mergedRects = mergeHostRects(rects, psum, buffer.width, buffer.height);
  let coveredCells = 0;
  for (const rect of mergedRects) coveredCells += sumRectFromPsum(psum, buffer.width, rect.r0, rect.c0, rect.r1, rect.c1);
  const brushes: Brush[] = [];
  let splitCount = 0;
  let hostCount = 0;
  let fallback = coveredCells !== fillCells;
  let invalidColor = false;
  const scratch: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };

  const addHostBrushes = (rect: HostRect, baseColorId: number, details: Array<{ rects: HostRect[]; fill: string }>): boolean => {
    if (!appendBaseBrush(brushes, palette, rect, baseColorId)) return false;
    if (!appendDetailBrushes(brushes, rect, details)) return false;
    hostCount += 1;
    return true;
  };

  const processHost = (rect: HostRect, depth: number, splitsRemaining: number): boolean => {
    if (fallback || invalidColor) return false;
    const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
    if (!area) return true;
    const transparentHost = rect.transparent === true;
    const analysis = analyzeHostColors(buffer, rect, scratch, transparentHost);
    if (analysis.invalid) {
      fallback = true;
      return false;
    }
    const detailLimit = transparentHost ? DETAIL_COLOR_LIMIT_TRANSPARENT : DETAIL_COLOR_LIMIT;
    const needsSplit = transparentHost
      ? analysis.uniqueColors > detailLimit
      : analysis.uniqueColors > detailLimit + 1 || analysis.baseCoverage < BASE_COVER_MIN;
    const baseColorId = transparentHost ? -1 : analysis.baseColorId;
    if (!needsSplit) {
      const detailColors = transparentHost
        ? analysis.colorCounts.map((entry) => entry.colorId)
        : analysis.colorCounts
          .filter((entry) => entry.colorId !== analysis.baseColorId)
          .slice(0, detailLimit)
          .map((entry) => entry.colorId);
      if (!detailColors.length) {
        if (!addHostBrushes(rect, baseColorId, [])) invalidColor = true;
        return !invalidColor;
      }
      const detailPlans = detailColors.map((colorId) => {
        let rects = extractColorRects(buffer, rect, colorId, rectEngine);
        rects = mergeAdjacentRectsExact(rects);
        rects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
        const fill = buffer.palette[colorId] ?? "";
        return { rects, fill };
      });
      const rectRunCount = detailPlans.reduce((sum, entry) => sum + entry.rects.length, 0);
      if (rectRunCount <= FRAGMENTATION_LIMIT) {
        if (!addHostBrushes(rect, baseColorId, detailPlans)) invalidColor = true;
        return !invalidColor;
      }
    }

    if (depth < MAX_SPLIT_DEPTH && splitsRemaining > 0 && area >= MIN_HOST_AREA) {
      const split = chooseSplitLine(buffer, rect, analysis.uniqueColors, 1 - analysis.baseCoverage, transparentHost);
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
    mergedRects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
    for (const rect of mergedRects) {
      if (hostCount > MAX_HOSTS_PER_FACE) {
        fallback = true;
        break;
      }
      if (!processHost(rect, 0, MAX_SPLITS_PER_HOST)) break;
      if (splitCount > MAX_SPLITS_PER_FACE) {
        fallback = true;
        break;
      }
      if (invalidColor) break;
    }
  }

  return { brushes, fallbackToHosts: fallback, invalidColor };
};

const CACHE_HASH_BASE = (() => {
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
  return hash;
})();

const buildCacheKey = (face: FaceData): string => {
  let hash = CACHE_HASH_BASE;
  for (const color of face.buffer.palette) hash = hashString(hash, color);
  const { axis, plane, face: faceKey } = face.key;
  return `${axis}:${plane}:${faceKey}:${face.buffer.minRow}:${face.buffer.minCol}:${face.buffer.maxRow}:${face.buffer.maxCol}:${face.fillCells}:${face.signatureHash}:${hash}`;
};

export type SliceAxis = "x" | "y" | "z";

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
}

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

const DETAIL_MERGE_MAX_RECTS = 256;

const buildSliceCacheKey = (face: FaceData): string =>
  `slice:${SLICE_RENDERER_VERSION}:${buildCacheKey(face)}`;

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


const paintPackedBrushes = (
  buffer: FaceData["buffer"],
  brushes: Brush[],
  paletteIds: Map<string, number>,
  scratch: Uint32Array
): boolean => {
  const { width, height } = buffer;
  for (const brush of brushes) {
    const colorId = paletteIds.get(brush.baseColor);
    if (!colorId) return false;
    const r0 = Math.max(0, brush.r0);
    const c0 = Math.max(0, brush.c0);
    const r1 = Math.min(height, brush.r1);
    const c1 = Math.min(width, brush.c1);
    if (r1 <= r0 || c1 <= c0) continue;
    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      for (let c = c0; c < c1; c += 1) {
        scratch[rowBase + c] = colorId;
      }
    }
  }
  return true;
};

const verifyPackedBrushes = (
  buffer: FaceData["buffer"],
  brushes: Brush[],
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

const buildFallbackCellBrushes = (buffer: FaceData["buffer"]): Brush[] => {
  const brushes: Brush[] = [];
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

const buildSlicePlan = (faceData: FaceData): SlicePlan => {
  const buffer = faceData.buffer;
  const palette = buffer.palette;
  const rectEngine = makeRectEngine(buffer.width, buffer.height);
  const paletteIds = new Map<string, number>();
  for (let i = 1; i < palette.length; i += 1) paletteIds.set(palette[i], i);
  const scratch = new Uint32Array(buffer.width * buffer.height);

  const planned = buildPlannedBrushes(faceData, rectEngine);
  let bestBrushes: Brush[] | null = null;
  if (!planned.invalidColor) {
    bestBrushes = planned.fallbackToHosts
      ? buildFallbackHostBrushes(buffer, rectEngine)
      : planned.brushes;
  }

  if (!bestBrushes || !verifyPackedBrushes(buffer, bestBrushes, paletteIds, scratch)) {
    const fallbackBrushes = buildFallbackCellBrushes(buffer);
    if (verifyPackedBrushes(buffer, fallbackBrushes, paletteIds, scratch)) {
      bestBrushes = fallbackBrushes;
    } else {
      bestBrushes = [];
    }
  }

  return {
    key: faceData.key,
    buffer,
    brushes: bestBrushes
  };
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
    const brushZ = `${planeOffset.toFixed(3)}px`;
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
