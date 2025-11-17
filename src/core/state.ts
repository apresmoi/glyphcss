import type { GridContext, SceneDimensions, Voxel, VoxelGrid } from "./types";
import type { VoxelLookup } from "./context";
import { buildContext, buildVoxelLookups } from "./context";

export interface SceneSnapshot {
  grid: VoxelGrid;
  layers: Voxel[][];
  lookups: VoxelLookup[];
  context: GridContext;
  dimensions: Required<SceneDimensions>;
  userContext: Partial<GridContext>;
}

export interface SceneSnapshotArgs {
  grid: VoxelGrid;
  userContext?: Partial<GridContext>;
  previous?: SceneSnapshot | null;
}

function buildLayerBuckets(grid: VoxelGrid, depth: number): Voxel[][] {
  const layerCount = Math.max(depth, 0);
  if (!layerCount) return [];
  const buckets: Voxel[][] = Array.from({ length: layerCount }, () => []);
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const layerIndex = Math.max(0, Math.floor(voxel.z ?? 0));
    if (!buckets[layerIndex]) continue;
    buckets[layerIndex].push(voxel);
  }
  return buckets;
}

export function deriveSceneSnapshot(args: SceneSnapshotArgs): SceneSnapshot {
  const grid = args.grid ?? [];
  const previousUserContext = args.previous?.userContext ?? {};
  const userContext = {
    ...previousUserContext,
    ...(args.userContext ?? {})
  };

  const gridChanged = !args.previous || args.previous.grid !== grid;

  const lookups =
    gridChanged || !args.previous
      ? buildVoxelLookups(grid, userContext.rows, userContext.cols)
      : args.previous.lookups;

  const context = buildContext(userContext, grid, lookups);

  const dimensions: Required<SceneDimensions> = {
    rows: context.rows,
    cols: context.cols,
    depth: context.depth
  };

  const layers =
    gridChanged || !args.previous || args.previous.context.depth !== context.depth
      ? buildLayerBuckets(grid, context.depth)
      : args.previous.layers;

  return {
    grid,
    layers,
    lookups,
    context,
    dimensions,
    userContext
  };
}
