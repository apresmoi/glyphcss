import { defineComponent, h, inject, toRefs, type PropType, type Ref } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createSceneBindingProps,
  SCENE_HOST_CLASS,
  type SceneComponentProps
} from "@voxcss/controller/createSceneComponentCore";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { CONTROLLER_KEY } from "./controllerKey";
import { useSceneBinding } from "./bindings";

export function createSceneComponent() {
  return defineComponent({
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
      const controller = inject<Ref<SceneController | null> | null>(CONTROLLER_KEY, null);
      if (!controller) {
        throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
      }
      const { voxels, rows, cols, depth, showWalls, showFloor, projection } = toRefs(props);
      const resolveProps = () => {
        const current = controller.value;
        if (!current) return null;
        return createSceneBindingProps(current, {
          voxels: voxels.value,
          rows: rows.value,
          cols: cols.value,
          depth: depth.value,
          showWalls: showWalls.value,
          showFloor: showFloor.value,
          projection: projection.value
        });
      };
      const { hostElement } = useSceneBinding(resolveProps);

      return () =>
        h("div", {
          ref: hostElement,
          class: SCENE_HOST_CLASS
        });
    }
  });
}

export type { SceneComponentProps };
