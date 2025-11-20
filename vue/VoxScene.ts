import { defineComponent, h, inject, ref, toRefs, watch, onMounted, onBeforeUnmount, type PropType } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { CONTROLLER_KEY } from "./VoxCamera";
import { createSceneSession, type SceneSessionHandle } from "@voxcss/controller/createSceneSession";
import { DEFAULT_SCENE_FLAGS } from "@voxcss/controller/defaults";

export default defineComponent({
  name: "VoxScene",
  props: {
    voxels: { type: Array, default: () => [] },
    rows: { type: Number, default: undefined },
    cols: { type: Number, default: undefined },
    depth: { type: Number, default: undefined },
    showWalls: { type: Boolean, default: DEFAULT_SCENE_FLAGS.showWalls },
    showFloor: { type: Boolean, default: DEFAULT_SCENE_FLAGS.showFloor },
    projection: { type: String as PropType<ProjectionMode | undefined>, default: DEFAULT_SCENE_FLAGS.projection }
  },
  setup(props) {
    const controller = inject<SceneController | null>(CONTROLLER_KEY, null);
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }

    const hostElement = ref<HTMLElement | null>(null);
    const session = ref<SceneSessionHandle | null>(null);
    const { voxels, rows, cols, depth, showWalls, showFloor, projection } = toRefs(props);

    const mountSession = () => {
      const element = hostElement.value;
      if (!element) return;
      const handle = createSceneSession({
        controller,
        element,
        voxels: voxels.value as VoxelGrid,
        rows: rows.value,
        cols: cols.value,
        depth: depth.value,
        showWalls: showWalls.value,
        showFloor: showFloor.value,
        projection: projection.value
      });
      handle.mount();
      session.value = handle;
    };

    onMounted(() => {
      mountSession();
    });

    onBeforeUnmount(() => {
      session.value?.destroy();
      session.value = null;
    });

    watch([voxels, rows, cols, depth, showWalls, showFloor, projection], () => {
      session.value?.setState({
        voxels: voxels.value as VoxelGrid,
        rows: rows.value,
        cols: cols.value,
        depth: depth.value,
        showWalls: showWalls.value,
        showFloor: showFloor.value,
        projection: projection.value
      });
    });

    return () =>
      h("div", {
        ref: hostElement,
        class: "voxcss-scene-host"
      });
  }
});
