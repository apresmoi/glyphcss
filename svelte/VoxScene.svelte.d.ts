import type { SvelteComponentTyped } from "svelte";
import type { ProjectionMode, SceneController, VoxelGrid } from "@layoutit/voxcss";

export default class VoxScene extends SvelteComponentTyped<
  {
    voxels?: VoxelGrid;
    rows?: number;
    cols?: number;
    depth?: number;
    showWalls?: boolean;
    showFloor?: boolean;
    projection?: ProjectionMode;
    controller?: SceneController;
  },
  { destroy: CustomEvent<void> },
  Record<string, never>
> {}
