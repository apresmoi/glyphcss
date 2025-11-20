import type { VoxelGrid, ProjectionMode } from "../core";
import type { SceneBindingOptions } from "./createSceneBinding";
import type { SceneController } from "./createSceneController";

export interface SceneComponentProps {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export const SCENE_HOST_CLASS = "voxcss-scene-host";

export function ensureSceneController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
  }
  return controller;
}

export function createSceneBindingProps(
  controller: SceneController | null,
  props: SceneComponentProps
): Omit<SceneBindingOptions, "element"> {
  const ensured = ensureSceneController(controller);
  return {
    controller: ensured,
    voxels: props.voxels,
    rows: props.rows,
    cols: props.cols,
    depth: props.depth,
    showWalls: props.showWalls,
    showFloor: props.showFloor,
    projection: props.projection
  };
}
