/* Context building + voxel lookup helpers used by renderers and controllers. */
import type { GridContext, InputVoxel, InputVoxelGrid, OffsetMap, ProjectionMode, SceneDimensions, Voxel, VoxelGrid, WallsMask } from "../types";
import { BASE_TILE, DEFAULT_OFFSETS, DEFAULT_PROJECTION, DEFAULT_WALLS, DEFAULT_WALL_COLOR } from "../types";
import { precomputeOcclusion } from "./occlusion";

export interface SceneContextBuildArgs {
  /**
   * Public-facing input — accepts both strict `Voxel` and loose `InputVoxel`
   * (where x/y/z are optional for triangle/polygon shapes). Normalized to
   * strict `Voxel[]` at ingress; everything downstream sees populated
   * x/y/z fields.
   */
  grid: InputVoxelGrid | VoxelGrid;
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

/**
 * Convert public InputVoxel → strict Voxel by populating x/y/z (and the
 * optional bbox extent fields) where the input omits them.
 *
 *   - For shape: "triangle" / "polygon" with `vertices` set: derive the
 *     bbox from min/max of the vertices.
 *   - For everything else: default missing axis values to 0. Cubes/ramps/
 *     wedges/spikes really should pass x/y/z explicitly (they ARE the
 *     geometry origin), but this keeps the function total.
 *
 * Runs once at the entry to buildSceneContext so all downstream code can
 * rely on `voxel.x / .y / .z` being defined numbers, no `?? 0` patches
 * scattered through the codebase.
 */
export function normalizeVoxels(grid: InputVoxelGrid | VoxelGrid): VoxelGrid {
  const out: Voxel[] = [];
  for (const v of grid ?? []) {
    if (!v) continue;
    const shape = v.shape;
    if ((shape === "triangle" || shape === "polygon") && v.vertices && v.vertices.length >= 3) {
      let xMin = Infinity, yMin = Infinity, zMin = Infinity;
      let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
      for (const p of v.vertices) {
        if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
        if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1];
        if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2];
      }
      out.push({
        ...v,
        x: v.x ?? Math.floor(xMin),
        y: v.y ?? Math.floor(yMin),
        z: v.z ?? Math.floor(zMin),
        x2: v.x2 ?? Math.ceil(xMax),
        y2: v.y2 ?? Math.ceil(yMax),
        z2: v.z2 ?? Math.ceil(zMax),
      });
      continue;
    }
    // Generic path — fill in missing x/y/z as 0 so downstream is safe.
    if (v.x !== undefined && v.y !== undefined && v.z !== undefined) {
      out.push(v as Voxel);
    } else {
      out.push({ ...v, x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 });
    }
  }
  return out;
}

export function buildSceneContext(args: SceneContextBuildArgs): SceneContextBuildResult {
  const grid = normalizeVoxels(args.grid ?? []);
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
    lighting: partial.lighting,
    debugShowOccluded: partial.debugShowOccluded,
    debugShowLabels: partial.debugShowLabels,
    debugShowBackfaces: partial.debugShowBackfaces,
    directionalLight: partial.directionalLight,
    occlusionMap: precomputeOcclusion(grid).byKey
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

    // All voxels with z2 > z+1 (cubes and shapes alike) render once on their
    // base layer (zStart) and populate the lookup at every covered z level.
    // This is the "layer-as-anchor" model described in Design §2.7.
    if (hasZSpan) {
      // Add to the base layer once, preserving z2 for geometry calculation.
      const baseLayer = layers[zStart];
      if (baseLayer) {
        baseLayer.push(voxel);
      }
      // Populate lookup at every z' ∈ [zStart, zEnd).
      const { x2, y2 } = getVoxelBounds(voxel);
      for (let zi = zStart; zi < zEnd; zi += 1) {
        const lookup = lookups[zi];
        if (!lookup) continue;
        for (let x = voxel.x; x < x2; x += 1) {
          if (x < 0 || x >= rows) continue;
          for (let y = voxel.y; y < y2; y += 1) {
            if (y < 0 || y >= cols) continue;
            lookup[x * cols + y] = voxel;
          }
        }
      }
      continue;
    }

    // Single-layer voxel (no z2 span): place in its layer as before.
    const layer = layers[zStart];
    const lookup = lookups[zStart];
    if (!layer || !lookup) continue;
    const normalizedVoxel = voxel.z === zStart ? voxel : { ...voxel, z: zStart, z2: undefined };
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
