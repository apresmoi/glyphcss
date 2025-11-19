/* Context building + voxel lookup helpers used by renderers and controllers. */
import type {
  GridContext,
  OffsetMap,
  ProjectionMode,
  SceneContextSnapshot,
  SceneDimensions,
  Voxel,
  VoxelGrid,
  WallsMask
} from "./types";
import { BASE_TILE, DEFAULT_OFFSETS, DEFAULT_PROJECTION, DEFAULT_WALLS, DEFAULT_WALL_COLOR } from "./types";

export interface VoxelLookup {
  rows: number;
  cols: number;
  voxels: (Voxel | null)[];
}

export function buildContext(
  partial: Partial<GridContext>,
  grid: VoxelGrid,
  lookups?: VoxelLookup[]
): GridContext {
  const tileSize = BASE_TILE;
  const projection = partial.projection ?? DEFAULT_PROJECTION;
  const inferred = inferGridDimensions(grid);
  const rows = Math.max(partial.rows ?? inferred.rows, 1);
  const cols = Math.max(partial.cols ?? inferred.cols, 1);
  const depth = Math.max(partial.depth ?? inferred.depth, 0);
  const lookupSource = lookups ?? buildVoxelLookups(grid, rows, cols);

  const hasAngles = partial.rotX !== undefined || partial.rotY !== undefined;
  const baseWalls = hasAngles
    ? computeWallMask(partial.rotX, partial.rotY)
    : DEFAULT_WALLS;
  const walls: WallsMask = {
    ...baseWalls,
    ...(partial.walls ?? {})
  };

  const offsets: OffsetMap = {
    ...DEFAULT_OFFSETS,
    ...(partial.offsets ?? {})
  };

  const defaultLayerElevation = projection === "dimetric" ? tileSize / 2 : tileSize;
  const layerElevation = partial.layerElevation ?? defaultLayerElevation;

  return {
    rows,
    cols,
    depth,
    tileSize,
    layerElevation,
    projection,
    walls,
    offsets,
    showWalls: partial.showWalls ?? false,
    showFloor: partial.showFloor ?? false,
    rotX: partial.rotX,
    rotY: partial.rotY,
    wallColor: partial.wallColor ?? DEFAULT_WALL_COLOR,
    getVoxel: (x: number, y: number, z: number) => getVoxelFromLookup(lookupSource, x, y, z),
    resolveTexture: partial.resolveTexture,
    lighting: partial.lighting
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

export function buildVoxelLookups(grid: VoxelGrid, rows?: number, cols?: number): VoxelLookup[] {
  const inferred = inferGridDimensions(grid);
  const targetRows = Math.max(rows ?? inferred.rows, 1);
  const targetCols = Math.max(cols ?? inferred.cols, 1);
  const depth = Math.max(inferred.depth, 0);
  if (!depth) return [];
  const lookups: VoxelLookup[] = Array.from({ length: depth }, () => ({
    rows: targetRows,
    cols: targetCols,
    voxels: new Array<Voxel | null>(targetRows * targetCols).fill(null)
  }));
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const layerIndex = Math.max(0, Math.floor(voxel.z ?? 0));
    const lookup = lookups[layerIndex];
    if (!lookup) continue;
    const { x2, y2 } = getVoxelBounds(voxel);
    for (let row = voxel.x; row < x2; row += 1) {
      if (row < 0 || row >= targetRows) continue;
      for (let col = voxel.y; col < y2; col += 1) {
        if (col < 0 || col >= targetCols) continue;
        lookup.voxels[row * targetCols + col] = voxel;
      }
    }
  }
  return lookups;
}

const FALLBACK_ROWS_COLS = 16;
const FALLBACK_DEPTH = 12;

export function inferGridDimensions(grid: VoxelGrid): { rows: number; cols: number; depth: number } {
  let maxRow = 0;
  let maxCol = 0;
  let maxDepth = 0;
  for (const voxel of grid ?? []) {
    if (typeof voxel?.x !== "number" || typeof voxel?.y !== "number") continue;
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

export function makeVoxelKey(voxel: Voxel): string {
  const { x2, y2 } = getVoxelBounds(voxel);
  return `${voxel.x}/${voxel.y}/${x2}/${y2}/${voxel.z}`;
}

export function makeCellKey(x: number, y: number): string {
  return `${x}/${y}`;
}

export interface SceneContextInput {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
  walls?: WallsMask;
  resolveTexture?: GridContext["resolveTexture"];
  dimensions?: SceneDimensions;
}

export function buildSceneContextSnapshot(input: SceneContextInput): SceneContextSnapshot {
  const inferred = inferGridDimensions(input.voxels);
  const baseDimensions = input.dimensions ?? {};
  const rows = Math.max(input.rows ?? baseDimensions.rows ?? inferred.rows, 1);
  const cols = Math.max(input.cols ?? baseDimensions.cols ?? inferred.cols, 1);
  const depth = Math.max(input.depth ?? baseDimensions.depth ?? inferred.depth, 0);
  const projection = input.projection ?? DEFAULT_PROJECTION;
  const walls = input.walls ? { ...input.walls } : { ...DEFAULT_WALLS };
  return {
    rows,
    cols,
    depth,
    showWalls: Boolean(input.showWalls),
    showFloor: Boolean(input.showFloor),
    projection,
    walls,
    resolveTexture: input.resolveTexture
  };
}

export interface ControllerDimensionInput {
  controller: { setDimensions(dimensions: Required<SceneDimensions>): void; getDimensions(): Required<SceneDimensions> };
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
}

export function syncControllerDimensions({
  controller,
  voxels,
  rows,
  cols,
  depth
}: ControllerDimensionInput): void {
  const inferred = inferGridDimensions(voxels);
  const current = controller.getDimensions();
  const next = {
    rows: rows ?? inferred.rows ?? current.rows,
    cols: cols ?? inferred.cols ?? current.cols,
    depth: depth ?? inferred.depth ?? current.depth
  };
  if (
    next.rows !== current.rows ||
    next.cols !== current.cols ||
    next.depth !== current.depth
  ) {
    controller.setDimensions(next);
  }
}
