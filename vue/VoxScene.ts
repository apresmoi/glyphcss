import { defineComponent, h, inject } from "vue";
import { SCENE_HOST_CLASS, type SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { scenePropOptions } from "./propOptions";
import { useSceneBinding } from "./bindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import { CONTROLLER_KEY } from "./controllerKey";

export { CONTROLLER_KEY } from "./controllerKey";

export default defineComponent({
  name: "VoxScene",
  props: scenePropOptions,
  setup(props) {
    const controller = inject<SceneController | null>(CONTROLLER_KEY, null);
    const bindingProps = () => {
      if (!controller) return null;
      return {
        controller: controller,
        voxels: props.voxels,
        rows: props.rows,
        cols: props.cols,
        depth: props.depth,
        showWalls: props.showWalls,
        showFloor: props.showFloor,
        projection: props.projection
      } satisfies Omit<SceneBindingOptions, "element">;
    };

    const { hostElement } = useSceneBinding(bindingProps);

    return () =>
      h("div", {
        class: SCENE_HOST_CLASS,
        ref: hostElement
      });
  }
});
