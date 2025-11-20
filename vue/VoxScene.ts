import { defineComponent, h, inject, ref, toRefs, watch, onMounted, onBeforeUnmount, type PropType } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { CONTROLLER_KEY } from "./VoxCamera";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";

export default defineComponent({
  name: "VoxScene",
  props: {
    voxels: { type: Array as PropType<VoxelGrid | undefined> },
    rows: { type: Number },
    cols: { type: Number },
    depth: { type: Number },
    showWalls: { type: Boolean as PropType<boolean | undefined> },
    showFloor: { type: Boolean as PropType<boolean | undefined> },
    projection: { type: String as PropType<ProjectionMode | undefined> }
  },
  setup(props) {
    const controller = inject<SceneController | null>(CONTROLLER_KEY, null);
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }

    const hostElement = ref<HTMLElement | null>(null);
    const binding = ref<SceneBindingHandle | null>(null);
    const { voxels, rows, cols, depth, showWalls, showFloor, projection } = toRefs(props);

    const mountBinding = () => {
      const element = hostElement.value;
      if (!element) return;
      const handle = createSceneBinding({
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
      binding.value = handle;
    };

    onMounted(() => {
      mountBinding();
    });

    onBeforeUnmount(() => {
      binding.value?.destroy();
      binding.value = null;
    });

    watch([voxels, rows, cols, depth, showWalls, showFloor, projection], () => {
      binding.value?.update({
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
