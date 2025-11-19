import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";
import type { SceneController, VoxelGrid, ProjectionMode } from "@voxcss/core";

interface SceneHostActionOptions {
  controller: SceneController;
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export function sceneHost(node: HTMLElement, options: SceneHostActionOptions) {
  let current = options;
  let binding: SceneBindingHandle | null = createSceneBinding({
    controller: current.controller,
    element: node,
    voxels: current.voxels,
    rows: current.rows,
    cols: current.cols,
    depth: current.depth,
    showWalls: current.showWalls,
    showFloor: current.showFloor,
    projection: current.projection
  });
  const applyBoxStyle = (style: Record<string, string>) => {
    for (const [key, value] of Object.entries(style)) {
      (node.style as any)[key] = value ?? "";
    }
  };
  applyBoxStyle(current.controller.getBoxStyle());
  const unsubscribeBox = current.controller.subscribeBoxStyle(applyBoxStyle);

  binding?.mount();

  function update(next: SceneHostActionOptions) {
    current = next;
    binding?.setVoxels(current.voxels);
    binding?.update({
      rows: current.rows,
      cols: current.cols,
      depth: current.depth,
      showWalls: current.showWalls,
      showFloor: current.showFloor,
      projection: current.projection
    });
  }

  return {
    update,
    destroy() {
      unsubscribeBox();
      binding?.destroy();
      binding = null;
    }
  };
}
