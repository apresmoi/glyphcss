import { useMemo } from "react";
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
  voxels: VoxelGrid,
  options: UseSceneContextOptions
): SceneContextBuildResult {
  // For 3d merge mode, use NO_WALLS so the scene context is stable
  // and doesn't rebuild when camera rotates. The imperative brush
  // renderer handles wall mask filtering directly.
  const effectiveWalls = options.mergeVoxels === "3d" ? NO_WALLS : (options.wallMask ?? NO_WALLS);

  return useMemo(() => {
    let grid = voxels;
    if (options.mergeVoxels === "2d") {
      grid = mergeVoxelsGrid(grid);
    }
    return buildSceneContext({
      grid,
      context: {
        rows: options.rows,
        cols: options.cols,
        depth: options.depth,
        projection: options.projection,
        showFloor: options.showFloor,
        showWalls: options.showWalls,
        wallColor: options.wallColor,
        walls: effectiveWalls,
      },
      dimensions: {
        rows: options.rows,
        cols: options.cols,
        depth: options.depth,
      },
    });
  }, [
    voxels,
    options.rows,
    options.cols,
    options.depth,
    options.projection,
    options.showFloor,
    options.showWalls,
    options.wallColor,
    effectiveWalls,
    options.mergeVoxels,
  ]);
}
