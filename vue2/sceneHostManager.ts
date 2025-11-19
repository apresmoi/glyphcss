// @ts-nocheck
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { buildSceneContext } from "@voxcss/core";
import type { VoxelGrid, ProjectionMode, SceneDimensions } from "@voxcss/core";
import Vue from "vue";

type VoxSceneProps = {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls: boolean;
  showFloor: boolean;
  projection?: ProjectionMode;
  dimetric: boolean;
};

export function createSceneHostManager(vm: Vue & VoxSceneProps, controller: SceneController) {
  const host: SceneHost = createSceneHost();
  let mounted = false;
  const unsubscribeBox = controller.subscribeBoxStyle((style) => {
    vm.boxStyleSnapshot = style;
  });

  const applyDimensions = (next: Required<SceneDimensions>) => {
    const current = controller.getDimensions();
    if (
      next.rows !== current.rows ||
      next.cols !== current.cols ||
      next.depth !== current.depth
    ) {
      controller.setDimensions(next);
    }
  };

  const buildAnalysis = () => {
    const projectionMode = vm.dimetric ? "dimetric" : vm.projection;
    controller.setProjection?.(projectionMode);
    return buildSceneContext({
      grid: vm.voxels as VoxelGrid,
      context: {
        rows: vm.rows,
        cols: vm.cols,
        depth: vm.depth,
        showWalls: vm.showWalls,
        showFloor: vm.showFloor,
        projection: projectionMode,
        walls: controller.getWalls()
      }
    });
  };

  const unwatchers: Array<() => void> = [];
  unwatchers.push(
    vm.$watch(
      () => vm.voxels,
      () => {
        if (!mounted) return;
      const analysis = buildAnalysis();
      host.setState({ voxels: vm.voxels as VoxelGrid, context: analysis.snapshot });
      host.flush();
      applyDimensions(analysis.dimensions);
      }
    ),
    vm.$watch(
      () => [vm.rows, vm.cols, vm.depth, vm.showWalls, vm.showFloor, vm.projection, vm.dimetric],
      () => {
        if (!mounted) return;
        const analysis = buildAnalysis();
        host.setState({ context: analysis.snapshot });
        host.flush();
        host.syncController(controller, () => buildAnalysis().snapshot);
        applyDimensions(analysis.dimensions);
      }
    )
  );

  return {
    host,
    mount(element: HTMLElement) {
      mounted = true;
      const analysis = buildAnalysis();
      host.mount(element, vm.voxels as VoxelGrid, analysis.snapshot);
      applyDimensions(analysis.dimensions);
      host.syncController(controller, () => buildAnalysis().snapshot);
    },
    destroy() {
      mounted = false;
      host.destroy();
      unsubscribeBox?.();
      unwatchers.forEach((stop) => stop());
    }
  };
}
