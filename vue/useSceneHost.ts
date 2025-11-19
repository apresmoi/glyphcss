import { ref, onMounted, onBeforeUnmount, watch, type Ref } from "vue";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";
import type { SceneController, VoxelGrid, ProjectionMode } from "@voxcss/core";

interface SceneHostParams {
  controller: SceneController;
  hostElement: Ref<HTMLElement | null>;
  voxels: Ref<VoxelGrid>;
  rows: Ref<number | undefined>;
  cols: Ref<number | undefined>;
  depth: Ref<number | undefined>;
  showWalls: Ref<boolean>;
  showFloor: Ref<boolean>;
  projection: Ref<ProjectionMode | undefined>;
}

export function useSceneHost(params: SceneHostParams) {
  const { controller, hostElement, voxels, rows, cols, depth, showWalls, showFloor, projection } = params;
  const boxStyle = ref<Record<string, string>>(controller.getBoxStyle());
  const binding = ref<SceneBindingHandle | null>(null);

  const stopBoxStyle = controller.subscribeBoxStyle((style) => {
    boxStyle.value = style;
  });

  onMounted(() => {
    const node = hostElement.value;
    if (!node) return;
    const handle = createSceneBinding({
      controller,
      element: node,
      voxels: voxels.value,
      rows: rows.value,
      cols: cols.value,
      depth: depth.value,
      showWalls: showWalls.value,
      showFloor: showFloor.value,
      projection: projection.value
    });
    binding.value = handle;
    handle.mount();
  });

  onBeforeUnmount(() => {
    binding.value?.destroy();
    binding.value = null;
    stopBoxStyle?.();
  });

  watch(
    () => voxels.value,
    (value) => {
      binding.value?.setVoxels(value);
    }
  );

  watch(
    () => [rows.value, cols.value, depth.value, showWalls.value, showFloor.value, projection.value],
    () => {
      binding.value?.update({
        rows: rows.value,
        cols: cols.value,
        depth: depth.value,
        showWalls: showWalls.value,
        showFloor: showFloor.value,
        projection: projection.value
      });
    }
  );

  return { boxStyle };
}
