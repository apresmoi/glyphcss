import type { GridContext, SceneDimensions, SceneAnalysisPayload, Voxel, VoxelGrid, VoxelLookup } from "./types";
import { buildSceneContext, getLookupData, inferGridDimensions, type LookupDataCacheEntry } from "./context";

export interface SceneSnapshot {
  grid: VoxelGrid;
  layers: Voxel[][];
  lookups: VoxelLookup[];
  context: GridContext;
  dimensions: Required<SceneDimensions>;
  userContext: Partial<GridContext>;
  gridChecksum: number;
}

export interface SceneSnapshotArgs {
  grid: VoxelGrid;
  userContext?: Partial<GridContext>;
  previous?: SceneSnapshot | null;
  analysis?: SceneAnalysisPayload | null;
}

export function deriveSceneSnapshot(args: SceneSnapshotArgs): SceneSnapshot {
  const grid = args.grid ?? [];
  const previousUserContext = args.previous?.userContext ?? {};
  const userContext = {
    ...previousUserContext,
    ...(args.userContext ?? {})
  };

  const inferred = inferGridDimensions(grid);
  const targetRows = Math.max(userContext.rows ?? inferred.rows, 1);
  const targetCols = Math.max(userContext.cols ?? inferred.cols, 1);
  const targetDepth = Math.max(userContext.depth ?? inferred.depth, 0);
  const resolvedDimensions: Required<SceneDimensions> = {
    rows: targetRows,
    cols: targetCols,
    depth: targetDepth
  };

  const providedAnalysis = args.analysis ?? null;
  const previous = args.previous ?? null;
  const previousCache: LookupDataCacheEntry | null = previous
    ? {
        grid: previous.grid,
        dimensions: previous.dimensions,
        lookups: previous.lookups,
        layers: previous.layers,
        checksum: previous.gridChecksum
      }
    : null;

  const lookupData = getLookupData({
    grid,
    rows: targetRows,
    cols: targetCols,
    depth: targetDepth,
    analysis: providedAnalysis,
    previous: previousCache
  });

  const built = buildSceneContext({
    grid,
    context: userContext,
    lookupData,
    dimensions: resolvedDimensions
  });

  return {
    grid,
    layers: lookupData.layers,
    lookups: lookupData.lookups,
    context: built.context,
    dimensions: built.dimensions,
    userContext,
    gridChecksum: lookupData.checksum
  };
}
