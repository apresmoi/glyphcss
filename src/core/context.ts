/* Context building + voxel lookup helpers used by renderers and controllers. */
import type { GridContext, OffsetMap, ProjectionMode, SceneDimensions, Voxel, VoxelGrid, WallsMask } from "./types";
import { BASE_TILE, DEFAULT_OFFSETS, DEFAULT_PROJECTION, DEFAULT_WALLS, DEFAULT_WALL_COLOR } from "./types";

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
    const layerIndex = Math.max(0, Math.floor(voxel.z ?? 0));
    const layer = layers[layerIndex];
    const lookup = lookups[layerIndex];
    if (!layer || !lookup) continue;
    layer.push(voxel);
    const { x2, y2 } = getVoxelBounds(voxel);
    for (let x = voxel.x; x < x2; x += 1) {
      if (x < 0 || x >= rows) continue;
      for (let y = voxel.y; y < y2; y += 1) {
        if (y < 0 || y >= cols) continue;
        lookup[x * cols + y] = voxel;
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
