import React, { useEffect, useRef } from "react";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { useSceneControllerContext } from "./context";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<SceneBindingHandle | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const binding = createSceneBinding({
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
    binding.mount();
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [controller]);

  useEffect(() => {
    bindingRef.current?.update({
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
