import type { ProjectionMode, VoxelGrid } from "../core";

const DEFAULT_SCENE_FLAGS = {
  showWalls: false,
  showFloor: false,
  projection: "cubic" as ProjectionMode
};
export interface SceneStateInput {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export interface NormalizedSceneState extends SceneStateInput {
  voxels: VoxelGrid;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
}

const EMPTY_VOXELS: VoxelGrid = [];

export function normalizeSceneState(
  input: SceneStateInput = {},
  fallback?: NormalizedSceneState
): NormalizedSceneState {
  return {
    voxels: input.voxels ?? fallback?.voxels ?? EMPTY_VOXELS,
    rows: input.rows ?? fallback?.rows,
    cols: input.cols ?? fallback?.cols,
    depth: input.depth ?? fallback?.depth,
    showWalls: input.showWalls ?? fallback?.showWalls ?? DEFAULT_SCENE_FLAGS.showWalls,
    showFloor: input.showFloor ?? fallback?.showFloor ?? DEFAULT_SCENE_FLAGS.showFloor,
    projection: input.projection ?? fallback?.projection ?? DEFAULT_SCENE_FLAGS.projection
  };
}

export type SceneStateShape = Pick<
  NormalizedSceneState,
  "voxels" | "rows" | "cols" | "depth" | "showWalls" | "showFloor" | "projection"
>;

export function extractSceneState(
  input: SceneStateInput = {},
  fallback?: SceneStateShape
): SceneStateShape {
  return {
    voxels: input.voxels ?? fallback?.voxels ?? EMPTY_VOXELS,
    rows: input.rows ?? fallback?.rows,
    cols: input.cols ?? fallback?.cols,
    depth: input.depth ?? fallback?.depth,
    showWalls: input.showWalls ?? fallback?.showWalls ?? DEFAULT_SCENE_FLAGS.showWalls,
    showFloor: input.showFloor ?? fallback?.showFloor ?? DEFAULT_SCENE_FLAGS.showFloor,
    projection: input.projection ?? fallback?.projection ?? DEFAULT_SCENE_FLAGS.projection
  };
}
