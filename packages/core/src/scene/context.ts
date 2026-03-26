/* Context building + voxel lookup helpers used by renderers and controllers. */
import type { GridContext, OffsetMap, ProjectionMode, SceneDimensions, Voxel, VoxelGrid, WallsMask } from "../types";
import { BASE_TILE, DEFAULT_OFFSETS, DEFAULT_PROJECTION, DEFAULT_WALLS, DEFAULT_WALL_COLOR } from "../types";

export interface SceneContextBuildArgs {
  grid: VoxelGrid;
  context?: Partial<GridContext>;
  dimensions?: SceneDimensions;
}

export interface SceneContextBuildResult {
  context: GridContext;
  dimensions: Required<SceneDimensions>;
  layers: Voxel[][];
}

const FALLBACK_ROWS_COLS = 16;
const FALLBACK_DEPTH = 12;

function computeGridExtents(grid: VoxelGrid): { rows: number; cols: number; depth: number } {
  let maxRow = 0;
  let maxCol = 0;
  let maxDepth = 0;
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const rowEnd = typeof voxel.x2 === "number" ? voxel.x2 : voxel.x + 1;
    const colEnd = typeof voxel.y2 === "number" ? voxel.y2 : voxel.y + 1;
    if (rowEnd > maxRow) maxRow = rowEnd;
    if (colEnd > maxCol) maxCol = colEnd;
    const { z2 } = getVoxelZBounds(voxel);
    if (z2 > maxDepth) maxDepth = z2;
  }
  return { rows: maxRow, cols: maxCol, depth: maxDepth };
}

export function inferGridDimensions(grid: VoxelGrid): { rows: number; cols: number; depth: number } {
  const { rows: maxRow, cols: maxCol, depth: maxDepth } = computeGridExtents(grid);
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
  const inferred = computeGridExtents(grid);
  const tileSize = BASE_TILE;
  const projection = partial.projection ?? DEFAULT_PROJECTION;
  const rowsOverride =
    typeof partial.rows === "number"
      ? partial.rows
      : typeof dimensionOverrides.rows === "number"
        ? dimensionOverrides.rows
        : undefined;
  const colsOverride =
    typeof partial.cols === "number"
      ? partial.cols
      : typeof dimensionOverrides.cols === "number"
        ? dimensionOverrides.cols
        : undefined;
  const depthOverride =
    typeof partial.depth === "number"
      ? partial.depth
      : typeof dimensionOverrides.depth === "number"
        ? dimensionOverrides.depth
        : undefined;

  const rowsBase = Math.max(rowsOverride ?? 0, inferred.rows);
  const colsBase = Math.max(colsOverride ?? 0, inferred.cols);
  const depthBase = Math.max(depthOverride ?? 0, inferred.depth);

  const rows = Math.max(rowsOverride === undefined && inferred.rows === 0 ? FALLBACK_ROWS_COLS : rowsBase, 1);
  const cols = Math.max(colsOverride === undefined && inferred.cols === 0 ? FALLBACK_ROWS_COLS : colsBase, 1);
  const depth =
    depthOverride === undefined && inferred.depth === 0 ? FALLBACK_DEPTH : Math.max(depthBase, 0);

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
  const { layers, lookups } = buildVoxelLayers(grid, rows, cols, depth);

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
    getVoxel: (x: number, y: number, z: number) => findVoxelInLayers(lookups, x, y, z, cols),
    resolveTexture: partial.resolveTexture,
    lighting: partial.lighting
  };

  return {
    context,
    dimensions: {
      rows,
      cols,
      depth
    },
    layers
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

function buildVoxelLayers(
  grid: VoxelGrid,
  rows: number,
  cols: number,
  depth: number
): { layers: Voxel[][]; lookups: Array<(Voxel | null)[]> } {
  if (depth <= 0) {
    return { layers: [], lookups: [] };
  }
  const layers: Voxel[][] = Array.from({ length: depth }, () => []);
  const lookups: Array<(Voxel | null)[]> = Array.from({ length: depth }, () => new Array<Voxel | null>(rows * cols).fill(null));
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const { z: zStart, z2 } = getVoxelZBounds(voxel);
    const hasZSpan = typeof voxel.z2 === "number" && Number.isFinite(voxel.z2) && Math.floor(voxel.z2) > zStart + 1;
    const zEnd = Math.min(z2, depth);
    for (let layerIndex = zStart; layerIndex < zEnd; layerIndex += 1) {
      const layer = layers[layerIndex];
      const lookup = lookups[layerIndex];
      if (!layer || !lookup) continue;
      const normalizedVoxel =
        !hasZSpan && layerIndex === zStart && voxel.z === zStart
          ? voxel
          : { ...voxel, z: layerIndex, z2: undefined };
      layer.push(normalizedVoxel);
      const { x2, y2 } = getVoxelBounds(normalizedVoxel);
      for (let x = normalizedVoxel.x; x < x2; x += 1) {
        if (x < 0 || x >= rows) continue;
        for (let y = normalizedVoxel.y; y < y2; y += 1) {
          if (y < 0 || y >= cols) continue;
          lookup[x * cols + y] = normalizedVoxel;
        }
      }
    }
  }
  return { layers, lookups };
}

export function getVoxelBounds(voxel: Voxel): { x2: number; y2: number } {
  return {
    x2: voxel.x2 ?? voxel.x + 1,
    y2: voxel.y2 ?? voxel.y + 1
  };
}

export function getVoxelZBounds(voxel: Voxel): { z: number; z2: number } {
  const rawZ = Number.isFinite(voxel.z) ? voxel.z : 0;
  const z = Math.max(0, Math.floor(rawZ));
  const rawZ2 = typeof voxel.z2 === "number" && Number.isFinite(voxel.z2) ? voxel.z2 : z + 1;
  return { z, z2: Math.max(z + 1, Math.floor(rawZ2)) };
}

function findVoxelInLayers(
  lookups: Array<(Voxel | null)[]>,
  x: number,
  y: number,
  z: number,
  cols: number
): Voxel | null {
  const layer = lookups[z];
  if (!layer || x < 0 || y < 0) return null;
  if (cols <= 0 || y >= cols) return null;
  const rows = Math.floor(layer.length / cols);
  if (x >= rows) return null;
  const idx = x * cols + y;
  if (idx < 0 || idx >= layer.length) return null;
  const voxel = layer[idx];
  if (!voxel) return null;
  const { x2, y2 } = getVoxelBounds(voxel);
  if (x >= voxel.x && x < x2 && y >= voxel.y && y < y2) {
    return voxel;
  }
  return null;
}
