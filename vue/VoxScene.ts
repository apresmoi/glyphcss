import { defineComponent, h } from "vue";
import { SCENE_HOST_CLASS, type SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { scenePropOptions } from "./propOptions";
import { useSceneBinding } from "./bindings";

export default defineComponent({
  name: "VoxScene",
  props: scenePropOptions,
  setup(props) {
    const bindingProps = () => {
      const controller = props.controller;
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
