import { defineComponent, h, inject, toRefs, type PropType } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { CONTROLLER_KEY } from "./VoxCamera";
import { useSceneBinding } from "./bindings";

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

    const { voxels, rows, cols, depth, showWalls, showFloor, projection } = toRefs(props);
    const { hostElement } = useSceneBinding(() => ({
      controller,
      voxels: voxels.value as VoxelGrid,
      rows: rows.value,
      cols: cols.value,
      depth: depth.value,
      showWalls: showWalls.value,
      showFloor: showFloor.value,
      projection: projection.value
    }));

    return () =>
      h("div", {
        ref: hostElement,
        class: "voxcss-scene-host"
      });
  }
});
