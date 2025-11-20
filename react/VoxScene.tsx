import React, { useEffect, useRef } from "react";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { useSceneControllerContext } from "./context";
import { createSceneSession, type SceneSessionHandle } from "@voxcss/controller/createSceneSession";
import { DEFAULT_SCENE_FLAGS } from "@voxcss/controller/defaults";

const DEFAULT_VOXELS: VoxelGrid = [];

export interface VoxSceneProps {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export function VoxScene({
  voxels = DEFAULT_VOXELS,
  rows,
  cols,
  depth,
  showWalls = DEFAULT_SCENE_FLAGS.showWalls,
  showFloor = DEFAULT_SCENE_FLAGS.showFloor,
  projection = DEFAULT_SCENE_FLAGS.projection
}: VoxSceneProps) {
  const controller = useSceneControllerContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<SceneSessionHandle | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const session = createSceneSession({
      controller,
      element,
      voxels,
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection
    });
    session.mount();
    sessionRef.current = session;
    return () => {
      session.destroy();
      sessionRef.current = null;
    };
  }, [controller]);

  useEffect(() => {
    sessionRef.current?.setState({
      voxels,
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection
    });
  }, [voxels, rows, cols, depth, showWalls, showFloor, projection]);

  return <div ref={containerRef} className="voxcss-scene-host" />;
}
