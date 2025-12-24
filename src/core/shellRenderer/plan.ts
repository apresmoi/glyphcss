import type { CubeFace, Voxel } from "../types";
import { CUBE_FACES } from "../types";
import { getVoxelBounds } from "../context";
import type { FaceData, FacePlan, HostPlan, HostRect, PlaneShellAxis, PlaneShellSnapshot } from "./types";
import {
  BASE_COVER_MIN,
  buildFaceBufferFromCells,
  buildSolidSvgPath,
  buildMaskPsum,
  DETAIL_COLOR_LIMIT,
  DETAIL_COLOR_LIMIT_TRANSPARENT,
  FRAGMENTATION_LIMIT,
  HASH_SEED,
  HOST_CAP,
  HOST_FILL_RATIO_MIN,
  HOST_GAP_MAX,
  hashNumber,
  hashString,
  makeRectEngine,
  MAX_HOSTS_PER_FACE,
  MAX_SPLIT_DEPTH,
  MAX_SPLITS_PER_FACE,
  MAX_SPLITS_PER_HOST,
  mergeHostRects,
  MIN_HOST_AREA,
  NEW_SHELL_VERSION,
  SPLIT_CANDIDATE_LIMIT,
  sumRectFromPsum
} from "./types";

const buildFaceDataFromSnapshot = (snapshot: PlaneShellSnapshot): FaceData[] => {
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
  const addCell = (axis: PlaneShellAxis, plane: number, face: CubeFace, voxel: Voxel, row: number, col: number): void => {
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

  const axisOrder: Record<PlaneShellAxis, number> = { x: 0, y: 1, z: 2 };
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

const ensureMask = (maskRef: { mask: Uint8Array }, size: number): Uint8Array => {
  if (maskRef.mask.length < size) {
    maskRef.mask = new Uint8Array(size);
    return maskRef.mask;
  }
  maskRef.mask.fill(0, 0, size);
  return maskRef.mask;
};

const verifyHostDetails = (
  buffer: FaceBuffer,
  host: HostRect,
  baseColorId: number,
  details: { colorId: number; rects: HostRect[] }[],
  maskRef: { mask: Uint8Array }
): boolean => {
  const hostWidth = host.c1 - host.c0;
  const hostHeight = host.r1 - host.r0;
  if (hostWidth <= 0 || hostHeight <= 0) return false;
  const mask = ensureMask(maskRef, hostWidth * hostHeight);
  const colorMap = new Map<number, number>();
  for (let i = 0; i < details.length; i += 1) {
    const colorId = details[i]?.colorId ?? 0;
    if (!colorId) continue;
    colorMap.set(colorId, i + 1);
  }
  const fillMask = (rects: HostRect[], value: number): boolean => {
    for (const rect of rects) {
      for (let r = rect.r0; r < rect.r1; r += 1) {
        const rowBase = r * hostWidth;
        for (let c = rect.c0; c < rect.c1; c += 1) {
          const idx = rowBase + c;
          const prev = mask[idx];
          if (prev && prev !== value) return false;
          mask[idx] = value;
        }
      }
    }
    return true;
  };
  for (let i = 0; i < details.length; i += 1) {
    const value = i + 1;
    if (!fillMask(details[i].rects, value)) return false;
  }
  const ids = buffer.ids;
  const width = buffer.width;
  for (let r = 0; r < hostHeight; r += 1) {
    const rowBase = (host.r0 + r) * width;
    const maskRow = r * hostWidth;
    for (let c = 0; c < hostWidth; c += 1) {
      const id = ids[rowBase + host.c0 + c];
      const m = mask[maskRow + c];
      if (!id) {
        if (m) return false;
        continue;
      }
      if (id === baseColorId) {
        if (m) return false;
        continue;
      }
      const value = colorMap.get(id);
      if (!value || m !== value) return false;
    }
  }
  return true;
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

const buildFacePlan = (faceData: FaceData): FacePlan => {
  const { buffer, fillCells } = faceData;
  const rectEngine = makeRectEngine(buffer.width, buffer.height);
  const { rects, coveredAll } = rectEngine.maxRects(buffer.mask, HOST_CAP, fillCells);
  const hostsBeforeMerge = rects.length;
  const psum = buildMaskPsum(buffer.mask, buffer.width, buffer.height);
  const mergedRects = mergeHostRects(rects, psum, buffer.width, buffer.height);
  const hostRects = mergedRects;
  const hostsAfterMerge = hostRects.length;
  let coveredCells = 0;
  for (const rect of hostRects) coveredCells += sumRectFromPsum(psum, buffer.width, rect.r0, rect.c0, rect.r1, rect.c1);
  const chosenCoveredAll = coveredCells === fillCells;
  // Coverage must reflect the rects we actually render.
  const hosts: HostPlan[] = [];
  let splitCount = 0;
  let fallback = !chosenCoveredAll;
  const maskRef = { mask: new Uint8Array(0) };
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
      const detailRects = detailColors.map((colorId) => {
        let rects = extractColorRects(buffer, rect, colorId, rectEngine);
        rects = mergeAdjacentRectsExact(rects);
        rects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
        return { colorId, rects };
      });
      const rectRunCount = detailRects.reduce((sum, entry) => sum + entry.rects.length, 0);
      if (rectRunCount <= FRAGMENTATION_LIMIT) {
        const ok = verifyHostDetails(buffer, rect, baseColorId, detailRects, maskRef);
        if (ok) {
          const hostArea = area;
          const detailArea = detailRects.reduce((sum, entry) => {
            for (const detailRect of entry.rects) {
              const rectHeight = Math.max(0, detailRect.r1 - detailRect.r0);
              const rectWidth = Math.max(0, detailRect.c1 - detailRect.c0);
              sum += rectHeight * rectWidth;
            }
            return sum;
          }, 0);
          const details: DetailPlan[] = [];
          for (const entry of detailRects) {
            const path = buildSolidSvgPath(entry.rects);
            if (!path) continue;
            const fill = buffer.palette[entry.colorId] ?? "";
            const rects = entry.rects.map((rect) => ({ ...rect }));
            details.push({ colorId: entry.colorId, path, rects, fill });
          }
          const hostWidth = rect.c1 - rect.c0;
          const hostHeight = rect.r1 - rect.r0;
          let detailSig = `${hostWidth}x${hostHeight}`;
          for (const detail of details) detailSig += `|${detail.fill}:${detail.path}`;
          addHost({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId, details, detailSig });
          return true;
        }
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


  return {
    key: faceData.key,
    originRow: buffer.minRow,
    originCol: buffer.minCol,
    palette: buffer.palette,
    signatureHash: faceData.signatureHash,
    hosts,
    fallback
  };
};

const buildCacheKey = (face: FaceData): string => {
  let hash = HASH_SEED;
  hash = hashNumber(hash, NEW_SHELL_VERSION);
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
