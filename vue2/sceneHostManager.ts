// @ts-nocheck
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { buildSceneContextSnapshot, syncControllerDimensions } from "@voxcss/core";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
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

  const buildContext = () => {
    const projectionMode = vm.dimetric ? "dimetric" : vm.projection;
    controller.setProjection?.(projectionMode);
    return buildSceneContextSnapshot({
      voxels: vm.voxels as VoxelGrid,
      rows: vm.rows,
      cols: vm.cols,
      depth: vm.depth,
      showWalls: vm.showWalls,
      showFloor: vm.showFloor,
      projection: projectionMode,
      walls: controller.getWalls()
    });
  };

  const syncDimensions = () => {
    syncControllerDimensions({
      controller,
      voxels: vm.voxels as VoxelGrid,
      rows: vm.rows,
      cols: vm.cols,
      depth: vm.depth
    });
  };

  const unwatchers: Array<() => void> = [];
  unwatchers.push(
    vm.$watch(
      () => vm.voxels,
      () => {
      if (!mounted) return;
      host.update(vm.voxels as VoxelGrid, buildContext());
      syncDimensions();
      }
    ),
    vm.$watch(
      () => [vm.rows, vm.cols, vm.depth, vm.showWalls, vm.showFloor, vm.projection, vm.dimetric],
      () => {
        if (!mounted) return;
        host.updateContext(buildContext());
        host.syncController(controller, buildContext);
        syncDimensions();
      }
    )
  );

  return {
    host,
    mount(element: HTMLElement) {
      mounted = true;
      host.mount(element, vm.voxels as VoxelGrid, buildContext());
      syncDimensions();
      host.syncController(controller, buildContext);
    },
    destroy() {
      mounted = false;
      host.destroy();
      unsubscribeBox?.();
      unwatchers.forEach((stop) => stop());
    }
  };
}
