import { createSceneHost } from "@voxcss/controller/createSceneHost";
import { buildSceneContextSnapshot, syncControllerDimensions } from "@voxcss/core";
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
  dimetric?: boolean;
}

export function sceneHost(node: HTMLElement, options: SceneHostActionOptions) {
  let current = options;
  const host = createSceneHost();
  const applyBoxStyle = (style: Record<string, string>) => {
    for (const [key, value] of Object.entries(style)) {
      (node.style as any)[key] = value ?? "";
    }
  };
  applyBoxStyle(current.controller.getBoxStyle());
  const unsubscribeBox = current.controller.subscribeBoxStyle(applyBoxStyle);

  const buildContext = () => {
    const projectionMode = current.dimetric ? "dimetric" : current.projection;
    current.controller.setProjection?.(projectionMode);
    return buildSceneContextSnapshot({
      voxels: current.voxels,
      rows: current.rows,
      cols: current.cols,
      depth: current.depth,
      showWalls: current.showWalls,
      showFloor: current.showFloor,
      projection: projectionMode,
      walls: current.controller.getWalls()
    });
  };

  host.mount(node, current.voxels, buildContext());
  host.syncController(current.controller, buildContext);
  syncControllerDimensions({
    controller: current.controller,
    voxels: current.voxels,
    rows: current.rows,
    cols: current.cols,
    depth: current.depth
  });

  function update(next: SceneHostActionOptions) {
    current = next;
    const context = buildContext();
    host.update(current.voxels, context);
    syncControllerDimensions({
      controller: current.controller,
      voxels: current.voxels,
      rows: current.rows,
      cols: current.cols,
      depth: current.depth
    });
  }

  return {
    update,
    destroy() {
      unsubscribeBox();
      host.destroy();
    }
  };
}
