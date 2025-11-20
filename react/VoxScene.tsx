import React from "react";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { useSceneControllerContext } from "./context";
import { useSceneBinding } from "./useBindings";

export interface VoxSceneProps {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export function VoxScene({ voxels, rows, cols, depth, showWalls, showFloor, projection }: VoxSceneProps) {
  const controller = useSceneControllerContext();
  const containerRef = useSceneBinding({
    controller,
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  });

  return <div ref={containerRef} className="voxcss-scene-host" />;
}
