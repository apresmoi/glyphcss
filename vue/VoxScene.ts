import { defineComponent, h, inject, ref, toRefs, type PropType, type Ref } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { CONTROLLER_KEY } from "./VoxCamera";
import { useSceneHost } from "./useSceneHost";

export default defineComponent({
  name: "VoxScene",
  props: {
    voxels: { type: Array, default: () => [] },
    rows: { type: Number, default: undefined },
    cols: { type: Number, default: undefined },
    depth: { type: Number, default: undefined },
    showWalls: { type: Boolean, default: false },
    showFloor: { type: Boolean, default: false },
    projection: { type: String as PropType<ProjectionMode | undefined>, default: undefined },
    dimetric: { type: Boolean, default: false }
  },
  setup(props) {
    const controller = inject<SceneController | null>(CONTROLLER_KEY, null);
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }

    const hostElement = ref<HTMLElement | null>(null);
    const { voxels, rows, cols, depth, showWalls, showFloor, projection, dimetric } = toRefs(props);

    const { boxStyle } = useSceneHost({
      controller,
      hostElement,
      voxels: voxels as unknown as Ref<VoxelGrid>,
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection,
      dimetric
    });

    return () =>
      h("div", {
        ref: hostElement,
        style: boxStyle.value
      });
  }
});
