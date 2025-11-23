/* Context building + voxel lookup helpers used by renderers and controllers. */
import type {
  GridContext,
  OffsetMap,
  ProjectionMode,
  SceneAnalysisPayload,
  SceneDimensions,
  Voxel,
  VoxelGrid,
  VoxelLookup,
  VoxelLookupBuildResult,
  WallsMask
} from "./types";
import { BASE_TILE, DEFAULT_OFFSETS, DEFAULT_PROJECTION, DEFAULT_WALLS, DEFAULT_WALL_COLOR } from "./types";

export interface SceneContextBuildArgs {
  grid: VoxelGrid;
  context?: Partial<GridContext>;
  dimensions?: SceneDimensions;
}

export interface SceneContextBuildResult {
  context: GridContext;
  dimensions: Required<SceneDimensions>;
  lookupData: VoxelLookupBuildResult;
  analysis: SceneAnalysisPayload;
}

const FALLBACK_ROWS_COLS = 16;
const FALLBACK_DEPTH = 12;

export function inferGridDimensions(grid: VoxelGrid): { rows: number; cols: number; depth: number } {
  let maxRow = 0;
  let maxCol = 0;
  let maxDepth = 0;
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const rowEnd = typeof voxel.x2 === "number" ? voxel.x2 : voxel.x + 1;
    const colEnd = typeof voxel.y2 === "number" ? voxel.y2 : voxel.y + 1;
    if (rowEnd > maxRow) maxRow = rowEnd;
    if (colEnd > maxCol) maxCol = colEnd;
    const depthIndex = Math.max(0, Math.floor(voxel.z ?? 0)) + 1;
    if (depthIndex > maxDepth) maxDepth = depthIndex;
  }
  return {
    rows: maxRow > 0 ? maxRow : FALLBACK_ROWS_COLS,
    cols: maxCol > 0 ? maxCol : FALLBACK_ROWS_COLS,
    depth: maxDepth > 0 ? maxDepth : FALLBACK_DEPTH
  };
}

export function buildSceneContext(args: SceneContextBuildArgs): SceneContextBuildResult {
  const grid = args.grid ?? [];
  const partial = args.context ?? {};
  const dimensionOverrides = args.dimensions ?? {};
  const hasFullOverride =
    typeof dimensionOverrides.rows === "number" &&
    typeof dimensionOverrides.cols === "number" &&
    typeof dimensionOverrides.depth === "number";
  const inferred = hasFullOverride ? (dimensionOverrides as Required<SceneDimensions>) : inferGridDimensions(grid);
  const tileSize = BASE_TILE;
  const projection = partial.projection ?? DEFAULT_PROJECTION;
  const rows = Math.max(partial.rows ?? dimensionOverrides.rows ?? inferred.rows, 1);
  const cols = Math.max(partial.cols ?? dimensionOverrides.cols ?? inferred.cols, 1);
  const depth = Math.max(partial.depth ?? dimensionOverrides.depth ?? inferred.depth, 0);

  const hasAngles = partial.rotX !== undefined || partial.rotY !== undefined;
  const resolvedWalls = partial.walls
    ? { ...DEFAULT_WALLS, ...partial.walls }
    : hasAngles
      ? computeWallMask(partial.rotX, partial.rotY)
      : { ...DEFAULT_WALLS };

  const offsets: OffsetMap = {
    ...DEFAULT_OFFSETS,
    ...(partial.offsets ?? {})
  };

  const defaultLayerElevation = projection === "dimetric" ? tileSize / 2 : tileSize;
  const layerElevation = partial.layerElevation ?? defaultLayerElevation;
  const lookupData = buildVoxelLookups(grid, rows, cols, depth);

  const context: GridContext = {
    rows,
    cols,
    depth,
    tileSize,
    layerElevation,
    projection,
    walls: resolvedWalls,
    offsets,
    showWalls: partial.showWalls ?? false,
    showFloor: partial.showFloor ?? false,
    rotX: partial.rotX,
    rotY: partial.rotY,
    wallColor: partial.wallColor ?? DEFAULT_WALL_COLOR,
    getVoxel: (x: number, y: number, z: number) => getVoxelFromLookup(lookupData!.lookups, x, y, z),
    resolveTexture: partial.resolveTexture,
    lighting: partial.lighting
  };

  const analysisPayload: SceneAnalysisPayload = {
    lookupData: lookupData!,
    dimensions: {
      rows,
      cols,
      depth
    },
    checksum: lookupData!.checksum
  };

  return {
    context,
    dimensions: {
      rows,
      cols,
      depth
    },
    lookupData: lookupData!,
    analysis: analysisPayload
  };
}

export function computeWallMask(rotX: number = 65, rotY: number = 45): WallsMask {
  const normalizedRotY = ((rotY % 360) + 360) % 360;
  const topHidden = Math.round(rotX) >= 90;
  const bottomHidden = !topHidden;

  return {
    t: topHidden,
    b: bottomHidden,
    bl: normalizedRotY <= 180,
    fr: normalizedRotY > 180,
    br: normalizedRotY < 90 || normalizedRotY >= 270,
    fl: normalizedRotY >= 90 && normalizedRotY < 270
  };
}

export function wallMasksEqual(a?: WallsMask | null, b?: WallsMask | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.t === b.t &&
    a.b === b.b &&
    a.bl === b.bl &&
    a.br === b.br &&
    a.fl === b.fl &&
    a.fr === b.fr
  );
}

export function buildVoxelLookups(
  grid: VoxelGrid,
  rows?: number,
  cols?: number,
  depthOverride?: number
): VoxelLookupBuildResult {
  const inferred = rows === undefined || cols === undefined || depthOverride === undefined ? inferGridDimensions(grid) : null;
  const targetRows = Math.max(rows ?? inferred?.rows ?? 1, 1);
  const targetCols = Math.max(cols ?? inferred?.cols ?? 1, 1);
  const depth = Math.max(depthOverride ?? inferred?.depth ?? 0, 0);
  if (!depth) {
    return { lookups: [], layers: [], checksum: hashFinalize(hashInit(0)) };
  }
  const lookups: VoxelLookup[] = Array.from({ length: depth }, () => ({
    rows: targetRows,
    cols: targetCols,
    voxels: new Array<Voxel | null>(targetRows * targetCols).fill(null)
  }));
  const layers: Voxel[][] = Array.from({ length: depth }, () => []);
  let checksum = hashInit(grid.length);
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const layerIndex = Math.max(0, Math.floor(voxel.z ?? 0));
    const lookup = lookups[layerIndex];
    const layer = layers[layerIndex];
    if (!lookup || !layer) {
      checksum = hashVoxel(checksum, voxel);
      continue;
    }
    layer.push(voxel);
    const { x2, y2 } = getVoxelBounds(voxel);
    for (let row = voxel.x; row < x2; row += 1) {
      if (row < 0 || row >= targetRows) continue;
      for (let col = voxel.y; col < y2; col += 1) {
        if (col < 0 || col >= targetCols) continue;
        lookup.voxels[row * targetCols + col] = voxel;
      }
    }
    checksum = hashVoxel(checksum, voxel);
  }
  return { lookups, layers, checksum: hashFinalize(checksum) };
}

export function getVoxelFromLookup(
  lookups: VoxelLookup[],
  x: number,
  y: number,
  z: number
): Voxel | null {
  const layer = lookups[z];
  if (!layer) return null;
  if (x < 0 || y < 0 || x >= layer.rows || y >= layer.cols) return null;
  return layer.voxels[x * layer.cols + y] ?? null;
}

export function getVoxelBounds(voxel: Voxel): { x2: number; y2: number } {
  return {
    x2: voxel.x2 ?? voxel.x + 1,
    y2: voxel.y2 ?? voxel.y + 1
  };
}

const HASH_SEED = 2166136261;

function hashInit(seed: number): number {
  return Math.imul(HASH_SEED, seed + 1);
}

function hashNumber(hash: number, value: number | undefined): number {
  const mixed = value ?? 0;
  hash ^= mixed + 0x9e3779b9 + (hash << 6) + (hash >> 2);
  return hash | 0;
}

function hashStringValue(hash: number, value?: string): number {
  if (!value) return hash;
  let result = hash;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i) + 0x9e3779b9 + (result << 6) + (result >> 2);
  }
  return result | 0;
}

function hashObject(hash: number, value: unknown): number {
  if (!value) return hash;
  try {
    const serialized = JSON.stringify(value);
    return hashStringValue(hash, serialized ?? "");
  } catch {
    return hash;
  }
}

function hashVoxel(hash: number, voxel: Voxel): number {
  let result = hash;
  result = hashNumber(result, voxel.x);
  result = hashNumber(result, voxel.y);
  result = hashNumber(result, voxel.z);
  result = hashNumber(result, voxel.x2);
  result = hashNumber(result, voxel.y2);
  result = hashStringValue(result, voxel.color);
  result = hashStringValue(result, voxel.texture);
  result = hashStringValue(result, voxel.shape);
  result = hashNumber(result, voxel.rot);
  result = hashObject(result, voxel.data);
  return result;
}

function hashFinalize(hash: number): number {
  return hash >>> 0;
}

export function makeVoxelKey(voxel: Voxel): string {
  const { x2, y2 } = getVoxelBounds(voxel);
  return `${voxel.x}/${voxel.y}/${x2}/${y2}/${voxel.z}`;
}
