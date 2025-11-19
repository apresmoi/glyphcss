import React, { useRef } from "react";
import type { CSSProperties } from "react";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { useSceneControllerContext } from "./context";
import { useSceneHost } from "./useSceneHost";

const DEFAULT_VOXELS: VoxelGrid = [];

export interface VoxSceneProps {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
  dimetric?: boolean;
}

export function VoxScene({
  voxels = DEFAULT_VOXELS,
  rows,
  cols,
  depth,
  showWalls = false,
  showFloor = false,
  projection,
  dimetric = false
}: VoxSceneProps) {
  const controller = useSceneControllerContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const boxStyle = useSceneHost({
    containerRef,
    controller,
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection,
    dimetric
  });

  return <div ref={containerRef} style={boxStyle as CSSProperties} />;
}
