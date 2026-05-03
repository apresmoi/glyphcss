import { useMemo } from "react";
import type { ProjectionMode, VoxelGrid, InputVoxelGrid, Voxel, FaceAppearanceOverride, DirectionalLight } from "@layoutit/voxcss-core";
import type { SceneContextBuildResult } from "@layoutit/voxcss-core";
import { buildSceneContext, normalizeVoxels } from "@layoutit/voxcss-core";
import { mergeVoxels as mergeVoxelsGrid, mergePolygons } from "@layoutit/voxcss-core";
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
  lighting?: (voxel: Voxel, face: string) => FaceAppearanceOverride | undefined;
  resolveTexture?: (name: string, face: string) => string | undefined;
  debugShowOccluded?: boolean;
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
  directionalLight?: DirectionalLight;
}

export function useSceneContext(
  voxels: VoxelGrid | InputVoxelGrid,
  options: UseSceneContextOptions
): SceneContextBuildResult {
  // For 3d merge mode, use NO_WALLS so the scene context is stable
  // and doesn't rebuild when camera rotates. The imperative brush
  // renderer handles wall mask filtering directly.
  const effectiveWalls = options.mergeVoxels === "3d" ? NO_WALLS : (options.wallMask ?? NO_WALLS);

  return useMemo(() => {
    // Normalize input first so the merge passes (and downstream code) see
    // strict Voxels with x/y/z populated. Triangle/polygon voxels that ship
    // only `vertices` get their bbox derived here.
    let grid: VoxelGrid = normalizeVoxels(voxels);
    if (options.mergeVoxels === "2d") {
      grid = mergeVoxelsGrid(grid);
    } else if (options.mergeVoxels === "poly") {
      grid = mergePolygons(grid);
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
        lighting: options.lighting,
        resolveTexture: options.resolveTexture,
        debugShowOccluded: options.debugShowOccluded,
        debugShowLabels: options.debugShowLabels,
        debugShowBackfaces: options.debugShowBackfaces,
        directionalLight: options.directionalLight,
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
    options.lighting,
    options.resolveTexture,
    options.debugShowOccluded,
    options.debugShowLabels,
    options.debugShowBackfaces,
    options.directionalLight,
  ]);
}
