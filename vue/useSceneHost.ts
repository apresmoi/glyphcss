import { ref, onMounted, onBeforeUnmount, watch, type Ref } from "vue";
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import { buildSceneContext } from "@voxcss/core";
import type { SceneController, VoxelGrid, ProjectionMode, SceneDimensions } from "@voxcss/core";

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
    const projectionMode: ProjectionMode | undefined = dimetric.value ? "dimetric" : projection.value;
    controller.setProjection?.(projectionMode);
    return buildSceneContext({
      grid: voxels.value,
      context: {
        rows: rows.value,
        cols: cols.value,
        depth: depth.value,
        showWalls: showWalls.value,
        showFloor: showFloor.value,
        projection: projectionMode,
        walls: controller.getWalls()
      }
    });
  };

  onMounted(() => {
    const node = hostElement.value;
    if (!node) return;
    const analysis = buildAnalysis();
    hostRef.value.mount(node, voxels.value, analysis.snapshot);
    applyDimensions(analysis.dimensions);
    hostRef.value.syncController(controller, () => buildAnalysis().snapshot);
  });

  onBeforeUnmount(() => {
    hostRef.value.destroy();
    stopBoxStyle?.();
  });

  watch(
    () => voxels.value,
    () => {
      const analysis = buildAnalysis();
      hostRef.value.setState({ voxels: voxels.value, context: analysis.snapshot });
      hostRef.value.flush();
      applyDimensions(analysis.dimensions);
    }
  );

  watch(
    () => [rows.value, cols.value, depth.value, showWalls.value, showFloor.value, projection.value, dimetric.value],
    () => {
      const analysis = buildAnalysis();
      hostRef.value.setState({ context: analysis.snapshot });
      hostRef.value.flush();
      hostRef.value.syncController(controller, () => buildAnalysis().snapshot);
      applyDimensions(analysis.dimensions);
    }
  );

  return { boxStyle };
}
