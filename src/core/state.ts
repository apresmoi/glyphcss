import type { GridContext, SceneDimensions, Voxel, VoxelGrid, VoxelLookup } from "./types";

export interface SceneSnapshot {
  grid: VoxelGrid;
  layers: Voxel[][];
  lookups: VoxelLookup[];
  context: GridContext;
  dimensions: Required<SceneDimensions>;
}
