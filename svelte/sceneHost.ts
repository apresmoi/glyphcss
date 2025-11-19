import { createSceneHost } from "@voxcss/controller/createSceneHost";
import { buildSceneContext } from "@voxcss/core";
import type { SceneController, VoxelGrid, ProjectionMode, SceneDimensions } from "@voxcss/core";

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

  const applyDimensions = (next: Required<SceneDimensions>) => {
    const currentDims = current.controller.getDimensions();
    if (
      next.rows !== currentDims.rows ||
      next.cols !== currentDims.cols ||
      next.depth !== currentDims.depth
    ) {
      current.controller.setDimensions(next);
    }
  };

  const buildAnalysis = () => {
    const projectionMode = current.dimetric ? "dimetric" : current.projection;
    current.controller.setProjection?.(projectionMode);
    return buildSceneContext({
      grid: current.voxels,
      context: {
        rows: current.rows,
        cols: current.cols,
        depth: current.depth,
        showWalls: current.showWalls,
        showFloor: current.showFloor,
        projection: projectionMode,
        walls: current.controller.getWalls()
      }
    });
  };

  const initialAnalysis = buildAnalysis();
  host.mount(node, current.voxels, initialAnalysis.snapshot);
  host.syncController(current.controller, () => buildAnalysis().snapshot);
  applyDimensions(initialAnalysis.dimensions);

  function update(next: SceneHostActionOptions) {
    current = next;
    const analysis = buildAnalysis();
    host.setState({ voxels: current.voxels, context: analysis.snapshot });
    host.flush();
    applyDimensions(analysis.dimensions);
  }

  return {
    update,
    destroy() {
      unsubscribeBox();
      host.destroy();
    }
  };
}
