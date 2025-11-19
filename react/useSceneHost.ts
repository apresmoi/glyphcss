import { useEffect, useRef, useState, type RefObject } from "react";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";
import type { ProjectionMode, VoxelGrid } from "@voxcss/core";

interface SceneHostParams {
  containerRef: RefObject<HTMLDivElement>;
  controller: SceneController;
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export function useSceneHost(params: SceneHostParams): Record<string, string> {
  const { containerRef, controller, voxels, rows, cols, depth, showWalls, showFloor, projection } = params;
  const bindingRef = useRef<SceneBindingHandle | null>(null);
  const [boxStyle, setBoxStyle] = useState<Record<string, string>>(() => controller.getBoxStyle());

  useEffect(() => {
    const unsubscribe = controller.subscribeBoxStyle((style) => setBoxStyle(style));
    return () => unsubscribe();
  }, [controller]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const binding = createSceneBinding({
      controller,
      element: node,
      voxels,
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection
    });
    bindingRef.current = binding;
    binding.mount();
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [controller, containerRef]);

  useEffect(() => {
    bindingRef.current?.setVoxels(voxels);
  }, [voxels]);

  useEffect(() => {
    bindingRef.current?.update({
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection
    });
  }, [rows, cols, depth, showWalls, showFloor, projection]);

  return boxStyle;
}
