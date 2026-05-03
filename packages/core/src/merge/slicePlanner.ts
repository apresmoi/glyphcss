/* Pure slice planning — zero DOM dependencies.
 * Computes face buffers and brush plans from voxel snapshots.
 * The DOM rendering of these plans lives in sliceRenderer.ts.
 */
import type { CubeFace, GridContext, Voxel, WallsMask } from "../types";
import { CUBE_FACES } from "../types";
import { getVoxelBounds, getVoxelZBounds } from "../scene/context";
import { computeCubeFaceAppearance } from "../color/faceAppearance";
import { parsePureColor, clampChannel } from "../color/color";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaneAxis = "x" | "y" | "z";

export interface FaceKey { axis: PlaneAxis; plane: number; face: CubeFace; }

export interface FaceBuffer {
  width: number;
  height: number;
  minRow: number;
  minCol: number;
  ids: Uint32Array;
  mask: Uint8Array;
  palette: string[];
}

export interface FaceData { key: FaceKey; buffer: FaceBuffer; }

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

/** Half-open bounds: [r0, r1) x [c0, c1) */
interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

type HoleFill = {
  mask: Uint8Array;
  allowMask: Uint8Array | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLICE_RENDERER_VERSION = 1;
export const AXIS_ORDER: Record<PlaneAxis, number> = { x: 0, y: 1, z: 2 };
export const FACE_ORDER = new Map<CubeFace, number>(CUBE_FACES.map((face, index) => [face, index] as const));
export const NEXT_LAYER_STEP: Record<CubeFace, number> = {
  t: 1, fr: 1, fl: 1,
  b: -1, bl: -1, br: -1
};

export const wallsToSig = (walls: WallsMask): number =>
  (walls.t ? 1 : 0) |
  (walls.b ? 2 : 0) |
  (walls.bl ? 4 : 0) |
  (walls.br ? 8 : 0) |
  (walls.fl ? 16 : 0) |
  (walls.fr ? 32 : 0);

export const buildSliceCacheKey = (face: FaceData): string => {
  const { axis, plane, face: faceKey } = face.key;
  return `slice:${SLICE_RENDERER_VERSION}:${axis}:${plane}:${faceKey}`;
};

export const buffersEqual = (a: FaceBuffer | null, b: FaceBuffer | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.minRow !== b.minRow || a.minCol !== b.minCol) return false;
  const paletteA = a.palette;
  const paletteB = b.palette;
  if (paletteA.length !== paletteB.length) return false;
  for (let i = 0; i < paletteA.length; i += 1) {
    if (paletteA[i] !== paletteB[i]) return false;
  }
  const idsA = a.ids;
  const idsB = b.ids;
  if (idsA.length !== idsB.length) return false;
  for (let i = 0; i < idsA.length; i += 1) {
    if (idsA[i] !== idsB[i]) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Rectangle decomposition
// ---------------------------------------------------------------------------

export const holeFillVariants = (buffer: FaceBuffer, nextLayer: FaceBuffer | null): HoleFill[] => {
  const out: HoleFill[] = [{ mask: buffer.mask, allowMask: null }];
  if (!nextLayer) return out;

  const { width, height } = buffer;
  const allowMask = new Uint8Array(width * height);

  const rowOffset = nextLayer.minRow - buffer.minRow;
  const colOffset = nextLayer.minCol - buffer.minCol;

  for (let nr = 0; nr < nextLayer.height; nr += 1) {
    const r = nr + rowOffset;
    if (r < 0 || r >= height) continue;
    const rowBase = r * width;
    const nextRowBase = nr * nextLayer.width;
    for (let nc = 0; nc < nextLayer.width; nc += 1) {
      if (!nextLayer.mask[nextRowBase + nc]) continue;
      const c = nc + colOffset;
      if (c < 0 || c >= width) continue;
      const idx = rowBase + c;
      if (!buffer.mask[idx]) allowMask[idx] = 1;
    }
  }

  let added = 0;
  for (let i = 0; i < allowMask.length; i += 1) added += allowMask[i] ? 1 : 0;
  if (!added) return out;

  const filledMask = buffer.mask.slice();
  for (let i = 0; i < allowMask.length; i += 1) if (allowMask[i]) filledMask[i] = 1;

  out.push({ mask: filledMask, allowMask });
  return out;
};

export const runRects = (mask: Uint8Array, width: number, bounds: Rect, byColumn: boolean): Rect[] => {
  const { r0, c0, r1, c1 } = bounds;
  if (r1 <= r0 || c1 <= c0) return [];

  const rects: Rect[] = [];

  if (!byColumn) {
    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      let c = c0;
      while (c < c1) {
        while (c < c1 && !mask[rowBase + c]) c += 1;
        if (c >= c1) break;
        const start = c;
        while (c < c1 && mask[rowBase + c]) c += 1;
        rects.push({ r0: r, c0: start, r1: r + 1, c1: c });
      }
    }
    return rects;
  }

  for (let c = c0; c < c1; c += 1) {
    let r = r0;
    while (r < r1) {
      while (r < r1 && !mask[r * width + c]) r += 1;
      if (r >= r1) break;
      const start = r;
      while (r < r1 && mask[r * width + c]) r += 1;
      rects.push({ r0: start, c0: c, r1: r, c1: c + 1 });
    }
  }
  return rects;
};

export const mergeAlignedRects = <T extends Rect>(rects: T[]): T[] => {
  if (rects.length < 2) return rects;

  rects.sort((a, b) => a.r0 - b.r0 || a.r1 - b.r1 || a.c0 - b.c0 || a.c1 - b.c1);
  const horiz: T[] = [];
  for (const rect of rects) {
    const last = horiz[horiz.length - 1];
    if (last && rect.r0 === last.r0 && rect.r1 === last.r1 && rect.c0 === last.c1) {
      last.c1 = rect.c1;
      continue;
    }
    horiz.push(rect);
  }

  horiz.sort((a, b) => a.c0 - b.c0 || a.c1 - b.c1 || a.r0 - b.r0 || a.r1 - b.r1);
  const vert: T[] = [];
  for (const rect of horiz) {
    const last = vert[vert.length - 1];
    if (last && rect.c0 === last.c0 && rect.c1 === last.c1 && rect.r0 === last.r1) {
      last.r1 = rect.r1;
      continue;
    }
    vert.push(rect);
  }

  return vert;
};

const pickRectsForMask = (mask: Uint8Array, width: number, height: number): Rect[] => {
  const bounds = { r0: 0, c0: 0, r1: height, c1: width };

  const row = mergeAlignedRects(runRects(mask, width, bounds, false));
  const col = mergeAlignedRects(runRects(mask, width, bounds, true));

  if (!row.length) return col;
  if (col.length && col.length < row.length) return col;
  return row;
};

const emitHost = (host: Rect, buffer: FaceBuffer): Brush[] => {
  const { width, ids, palette } = buffer;

  let baseId = 0;
  let baseCount = -1;
  const counts = new Map<number, number>();

  for (let r = host.r0; r < host.r1; r += 1) {
    const rowBase = r * width;
    for (let c = host.c0; c < host.c1; c += 1) {
      const id = ids[rowBase + c];
      if (!id) continue;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
      if (next > baseCount || (next === baseCount && id < baseId)) {
        baseId = id;
        baseCount = next;
      }
    }
  }

  if (!counts.size) return [];

  const baseFill = palette[baseId] ?? "";
  if (!baseFill) return [];

  const out: Brush[] = [{ ...host, baseColor: baseFill }];

  const colorIds = Array.from(counts.keys()).sort((a, b) => a - b);
  const localW = host.c1 - host.c0;
  const localH = host.r1 - host.r0;
  const localMask = new Uint8Array(localW * localH);

  for (const colorId of colorIds) {
    if (colorId === baseId) continue;
    localMask.fill(0);

    for (let r = host.r0; r < host.r1; r += 1) {
      const rowBase = r * width;
      const localRow = (r - host.r0) * localW;
      for (let c = host.c0; c < host.c1; c += 1) {
        if (ids[rowBase + c] === colorId) localMask[localRow + (c - host.c0)] = 1;
      }
    }

    const rects = pickRectsForMask(localMask, localW, localH);
    if (!rects.length) continue;

    const fill = palette[colorId] ?? "";
    if (!fill) continue;

    for (const r of rects) {
      out.push({
        r0: r.r0 + host.r0,
        c0: r.c0 + host.c0,
        r1: r.r1 + host.r0,
        c1: r.c1 + host.c0,
        baseColor: fill
      });
    }
  }

  return out;
};

export const verify = (brushes: Brush[], buffer: FaceBuffer, allowMask: Uint8Array | null, paletteIds: Map<string, number>): boolean => {
  const { width, height } = buffer;
  const scratch = new Uint32Array(width * height);

  for (const brush of brushes) {
    const colorId = paletteIds.get(brush.baseColor);
    if (!colorId) return false;

    const r0 = Math.max(0, brush.r0);
    const c0 = Math.max(0, brush.c0);
    const r1 = Math.min(height, brush.r1);
    const c1 = Math.min(width, brush.c1);

    for (let r = r0; r < r1; r += 1) {
      const rowBase = r * width;
      for (let c = c0; c < c1; c += 1) scratch[rowBase + c] = colorId;
    }
  }

  const expected = buffer.ids;
  for (let i = 0; i < scratch.length; i += 1) {
    if (scratch[i] === expected[i]) continue;
    if (allowMask && !expected[i] && allowMask[i]) continue;
    return false;
  }
  return true;
};

const mergeAligned = (brushes: Brush[]): Brush[] => {
  if (brushes.length < 2) return brushes;

  const byColor = new Map<string, Brush[]>();
  for (const b of brushes) {
    const list = byColor.get(b.baseColor);
    if (list) list.push(b);
    else byColor.set(b.baseColor, [b]);
  }

  const out: Brush[] = [];
  for (const [, list] of byColor) {
    out.push(...mergeAlignedRects(list.map((b) => ({ ...b }))));
  }
  return out;
};

const evaluateVariant = (buffer: FaceBuffer, holeFill: HoleFill, paletteIds: Map<string, number>): Brush[] | null => {
  const bounds = { r0: 0, c0: 0, r1: buffer.height, c1: buffer.width };

  let best: Brush[] | null = null;

  for (const byColumn of [false, true]) {
    const rects = mergeAlignedRects(runRects(holeFill.mask, buffer.width, bounds, byColumn));

    const brushes: Brush[] = [];
    for (const host of rects) brushes.push(...emitHost(host, buffer));

    if (!verify(brushes, buffer, holeFill.allowMask, paletteIds)) continue;

    let bestHere = brushes;
    const aligned = mergeAligned(brushes);
    if (aligned.length < bestHere.length && verify(aligned, buffer, holeFill.allowMask, paletteIds)) bestHere = aligned;

    if (!best || bestHere.length < best.length) best = bestHere;
  }

  return best;
};

export const buildSlicePlan = (faceData: FaceData, nextLayer: FaceBuffer | null): SlicePlan => {
  const buffer = faceData.buffer;
  const paletteIds = new Map<string, number>();
  for (let i = 1; i < buffer.palette.length; i += 1) paletteIds.set(buffer.palette[i], i);

  let best: Brush[] | null = null;
  for (const holeFill of holeFillVariants(buffer, nextLayer)) {
    const candidate = evaluateVariant(buffer, holeFill, paletteIds);
    if (!candidate) continue;
    if (!best || candidate.length < best.length) best = candidate;
  }

  return { key: faceData.key, buffer, brushes: best ?? [] };
};

// ---------------------------------------------------------------------------
// Face data extraction from snapshot (pure — no DOM)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw CSS color string to rgb() format using pure parsing.
 * Replaces the previous `new Option().style` DOM-based approach.
 */
function normalizeColor(rawColor: string): { r: number; g: number; b: number; a: number } | null {
  const parsed = parsePureColor(rawColor);
  if (!parsed) return null;
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2], a: parsed.alpha };
}

export const buildFaceDataFromSnapshot = (snapshot: { layers: Voxel[][]; context: GridContext }): FaceData[] => {
  const context = snapshot.context;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = snapshot.layers.length;
  const strideXY = rows * cols;
  const occupancy = new Array<Voxel | null>(strideXY * depth).fill(null);
  const occupiedIndices: number[] = [];

  for (let z = 0; z < snapshot.layers.length; z += 1) {
    const layer = snapshot.layers[z];
    if (!layer?.length) continue;
    for (const voxel of layer) {
      if (!voxel) continue;
      const { x2, y2 } = getVoxelBounds(voxel);
      const { z2 } = getVoxelZBounds(voxel);
      for (let x = voxel.x; x < x2; x += 1) {
        if (x < 0 || x >= rows) continue;
        for (let y = voxel.y; y < y2; y += 1) {
          if (y < 0 || y >= cols) continue;
          for (let zi = voxel.z; zi < z2; zi += 1) {
            if (zi < 0 || zi >= depth) continue;
            const idx = zi * strideXY + x * cols + y;
            if (occupancy[idx]) continue;
            occupancy[idx] = voxel;
            occupiedIndices.push(idx);
          }
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

  const buildersList = Array.from(builders.values()).sort((a, b) =>
    AXIS_ORDER[a.key.axis] - AXIS_ORDER[b.key.axis]
    || a.key.plane - b.key.plane
    || (FACE_ORDER.get(a.key.face) ?? 0) - (FACE_ORDER.get(b.key.face) ?? 0)
  );

  const faces: FaceData[] = [];
  for (const builder of buildersList) {
    if (builder.cells.length > 1) {
      builder.cells.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
    }
    const width = builder.maxCol - builder.minCol + 1;
    const height = builder.maxRow - builder.minRow + 1;
    if (width <= 0 || height <= 0) continue;
    const ids = new Uint32Array(width * height);
    const palette: string[] = [""];
    const colorIndex = new Map<string, number>();
    let hasFill = false;

    for (const cell of builder.cells) {
      const rowOffset = cell.row - builder.minRow;
      const colOffset = cell.col - builder.minCol;
      if (rowOffset < 0 || colOffset < 0 || rowOffset >= height || colOffset >= width) continue;
      const index = rowOffset * width + colOffset;

      const appearance = computeCubeFaceAppearance(cell.voxel, builder.key.face, context);
      if (appearance.backgroundImage) continue;
      let brightness = 1;
      const rawFilter = appearance.filter.trim();
      if (rawFilter) {
        const match = rawFilter.match(/^brightness\(\s*([^)]+)\s*\)$/i);
        if (!match) continue;
        const body = (match[1] ?? "").trim();
        if (!body) continue;
        if (body.endsWith("%")) {
          const pct = Number(body.slice(0, -1));
          if (!Number.isFinite(pct)) continue;
          brightness = Math.max(0, pct / 100);
        } else {
          const scalar = Number(body);
          if (!Number.isFinite(scalar)) continue;
          brightness = Math.max(0, scalar);
        }
      }
      const rawColor = appearance.backgroundColor.trim();
      if (!rawColor) continue;

      // Pure color normalization — no DOM needed
      const color = normalizeColor(rawColor);
      if (!color) continue;
      if (color.a < 1) continue;

      const r = clampChannel(color.r * brightness);
      const g = clampChannel(color.g * brightness);
      const b = clampChannel(color.b * brightness);
      const colorKey = `${r},${g},${b},255`;
      let colorId = colorIndex.get(colorKey);
      if (colorId === undefined) {
        colorId = palette.length;
        colorIndex.set(colorKey, colorId);
        palette.push(`rgb(${r}, ${g}, ${b})`);
      }
      if (!ids[index]) hasFill = true;
      ids[index] = colorId;
    }

    if (!hasFill) continue;
    const mask = new Uint8Array(ids.length);
    for (let i = 0; i < ids.length; i += 1) mask[i] = ids[i] ? 1 : 0;

    faces.push({
      key: builder.key,
      buffer: {
        width,
        height,
        minRow: builder.minRow,
        minCol: builder.minCol,
        ids,
        mask,
        palette
      }
    });
  }

  return faces;
};
