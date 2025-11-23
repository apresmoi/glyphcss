import { defineComponent, h, inject, toRefs, type Ref } from "vue";
import type { SceneController } from "@voxcss/controller/sceneController";
import { SCENE_HOST_CLASS, ensureSceneController, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
import { CONTROLLER_KEY } from "./controllerKey";
import { useSceneBinding } from "./bindings";
import { scenePropOptions } from "./propOptions";

export function createSceneComponent() {
  return defineComponent({
    name: "VoxScene",
    props: scenePropOptions,
    setup(props) {
      const controller = inject<Ref<SceneController | null> | null>(CONTROLLER_KEY, null);
      const { voxels, rows, cols, depth, showWalls, showFloor, projection } = toRefs(props);
      const resolveProps = () => {
        return {
          controller: ensureSceneController(controller?.value ?? null),
          voxels: voxels.value,
          rows: rows.value,
          cols: cols.value,
          depth: depth.value,
          showWalls: showWalls.value,
          showFloor: showFloor.value,
          projection: projection.value
        };
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
