// @ts-nocheck
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";
import type { SceneController } from "@voxcss/controller/createSceneController";
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
};

export function createSceneHostManager(vm: Vue & VoxSceneProps, controller: SceneController) {
  let binding: SceneBindingHandle | null = null;
  let mounted = false;
  const unsubscribeBox = controller.subscribeBoxStyle((style) => {
    vm.boxStyleSnapshot = style;
  });

  const unwatchers: Array<() => void> = [];
  unwatchers.push(
    vm.$watch(
      () => vm.voxels,
      () => {
        if (!mounted) return;
        binding?.setVoxels(vm.voxels as VoxelGrid);
      }
    ),
    vm.$watch(
      () => [vm.rows, vm.cols, vm.depth, vm.showWalls, vm.showFloor, vm.projection],
      () => {
        if (!mounted) return;
        binding?.update({
          rows: vm.rows,
          cols: vm.cols,
          depth: vm.depth,
          showWalls: vm.showWalls,
          showFloor: vm.showFloor,
          projection: vm.projection
        });
      }
    )
  );

  return {
    mount(element: HTMLElement) {
      mounted = true;
      binding = createSceneBinding({
        controller,
        element,
        voxels: vm.voxels as VoxelGrid,
        rows: vm.rows,
        cols: vm.cols,
        depth: vm.depth,
        showWalls: vm.showWalls,
        showFloor: vm.showFloor,
        projection: vm.projection
      });
      binding.mount();
    },
    destroy() {
      mounted = false;
      binding?.destroy();
      binding = null;
      unsubscribeBox?.();
      unwatchers.forEach((stop) => stop());
    }
  };
}
