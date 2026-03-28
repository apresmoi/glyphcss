import { computed } from "vue";
import type { Ref } from "vue";
import type { ProjectionMode, VoxelGrid } from "@layoutit/voxcss-core";
import type { SceneContextBuildResult } from "@layoutit/voxcss-core";
import { buildSceneContext } from "@layoutit/voxcss-core";
import { mergeVoxels as mergeVoxelsGrid } from "@layoutit/voxcss-core";
import type { MergeVoxelsOption, WallsMask } from "@layoutit/voxcss-core";

/** All-false wall mask — topology only for 3d merge mode. */
const NO_WALLS = { t: false, b: false, bl: false, br: false, fl: false, fr: false } as const;

export interface UseSceneContextOptions {
  rows?: number;
  cols?: number;
  depth?: number;
  projection?: ProjectionMode;
  showFloor?: boolean;
  showWalls?: boolean;
  wallColor?: string;
  wallMask?: WallsMask;
  mergeVoxels?: MergeVoxelsOption;
}

export function useSceneContext(
  voxels: Ref<VoxelGrid>,
  options: Ref<UseSceneContextOptions>
): Ref<SceneContextBuildResult> {
  return computed(() => {
    const opts = options.value;
    // For 3d merge mode, use NO_WALLS so the scene context is stable
    // and doesn't rebuild when camera rotates. The imperative brush
    // renderer handles wall mask filtering directly.
    const effectiveWalls = opts.mergeVoxels === "3d" ? NO_WALLS : (opts.wallMask ?? NO_WALLS);

    let grid = voxels.value;
    if (opts.mergeVoxels === "2d") {
      grid = mergeVoxelsGrid(grid);
    }
    return buildSceneContext({
      grid,
      context: {
        rows: opts.rows,
        cols: opts.cols,
        depth: opts.depth,
        projection: opts.projection,
        showFloor: opts.showFloor,
        showWalls: opts.showWalls,
        wallColor: opts.wallColor,
        walls: effectiveWalls,
      },
      dimensions: {
        rows: opts.rows,
        cols: opts.cols,
        depth: opts.depth,
      },
    });
  });
}
