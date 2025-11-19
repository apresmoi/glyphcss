import { ref, onMounted, onBeforeUnmount, watch, type Ref } from "vue";
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import { buildSceneContextSnapshot, syncControllerDimensions } from "@voxcss/core";
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
  dimetric: Ref<boolean>;
}

export function useSceneHost(params: SceneHostParams) {
  const { controller, hostElement, voxels, rows, cols, depth, showWalls, showFloor, projection, dimetric } = params;
  const boxStyle = ref<Record<string, string>>(controller.getBoxStyle());
  const hostRef = ref(createSceneHost());

  const stopBoxStyle = controller.subscribeBoxStyle((style) => {
    boxStyle.value = style;
  });

  const buildContext = () => {
    const projectionMode: ProjectionMode | undefined = dimetric.value ? "dimetric" : projection.value;
    controller.setProjection?.(projectionMode);
    return buildSceneContextSnapshot({
      voxels: voxels.value,
      rows: rows.value,
      cols: cols.value,
      depth: depth.value,
      showWalls: showWalls.value,
      showFloor: showFloor.value,
      projection: projectionMode,
      walls: controller.getWalls()
    });
  };

  const syncDimensions = () =>
    syncControllerDimensions({
      controller,
      voxels: voxels.value,
      rows: rows.value,
      cols: cols.value,
      depth: depth.value
    });

  onMounted(() => {
    const node = hostElement.value;
    if (!node) return;
    hostRef.value.mount(node, voxels.value, buildContext());
    syncDimensions();
    hostRef.value.syncController(controller, buildContext);
  });

  onBeforeUnmount(() => {
    hostRef.value.destroy();
    stopBoxStyle?.();
  });

  watch(
    () => voxels.value,
    () => {
      hostRef.value.update(voxels.value, buildContext());
      syncDimensions();
    }
  );

  watch(
    () => [rows.value, cols.value, depth.value, showWalls.value, showFloor.value, projection.value, dimetric.value],
    () => {
      hostRef.value.updateContext(buildContext());
      hostRef.value.syncController(controller, buildContext);
      syncDimensions();
    }
  );

  return { boxStyle };
}
