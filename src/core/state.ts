import type { GridContext, SceneDimensions, SceneAnalysisPayload, Voxel, VoxelGrid, VoxelLookup, VoxelLookupBuildResult } from "./types";
import {
  buildSceneContext,
  buildVoxelLookups,
  computeGridChecksum,
  inferGridDimensions
} from "./context";

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

  const previous = args.previous ?? null;
  const gridChanged = !previous || previous.grid !== grid;
  const dimensionsChanged =
    !previous ||
    previous.dimensions.rows !== targetRows ||
    previous.dimensions.cols !== targetCols ||
    previous.dimensions.depth !== targetDepth;

  const providedAnalysis = args.analysis;
  let checksum: number | null = null;
  const ensureChecksum = () => {
    if (checksum === null) {
      checksum = computeGridChecksum(grid);
    }
    return checksum;
  };

  let lookupData: VoxelLookupBuildResult | null = null;

  if (
    providedAnalysis &&
    providedAnalysis.dimensions.rows === targetRows &&
    providedAnalysis.dimensions.cols === targetCols &&
    providedAnalysis.dimensions.depth === targetDepth &&
    providedAnalysis.checksum === ensureChecksum()
  ) {
    lookupData = providedAnalysis.lookupData;
    checksum = providedAnalysis.checksum;
  }

  if (!lookupData && previous && !gridChanged && !dimensionsChanged) {
    if (previous.gridChecksum === ensureChecksum()) {
      lookupData = {
        lookups: previous.lookups,
        layers: previous.layers,
        checksum: previous.gridChecksum
      };
      checksum = previous.gridChecksum;
    }
  }

  if (!lookupData) {
    lookupData = buildVoxelLookups(grid, targetRows, targetCols, targetDepth);
    checksum = lookupData.checksum;
  }

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
    gridChecksum: checksum ?? lookupData.checksum
  };
}
