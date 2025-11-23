import { defineComponent, h, onBeforeUnmount, ref, watch } from "vue";
import { attachSceneBinding } from "@voxcss/controller/domBindings";
import { SCENE_HOST_CLASS, type SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { scenePropOptions } from "./propOptions";

export default defineComponent({
  name: "VoxScene",
  props: scenePropOptions,
  setup(props) {
    const hostElement = ref<HTMLElement | null>(null);
    let binding: ReturnType<typeof attachSceneBinding> | null = null;

    const mountBinding = () => {
      binding?.destroy();
      binding = null;
      const element = hostElement.value;
      const controller = props.controller;
      if (!element || !controller) return;
      const options: Omit<SceneBindingOptions, "element"> = {
        controller,
        voxels: props.voxels,
        rows: props.rows,
        cols: props.cols,
        depth: props.depth,
        showWalls: props.showWalls,
        showFloor: props.showFloor,
        projection: props.projection
      };
      binding = attachSceneBinding({ ...options, element });
    };

    watch(hostElement, () => mountBinding(), { immediate: true });
    watch(
      () => [
        props.controller,
        props.voxels,
        props.rows,
        props.cols,
        props.depth,
        props.showWalls,
        props.showFloor,
        props.projection
      ],
      () => {
        if (!binding) {
          mountBinding();
          return;
        }
        if (!props.controller) {
          binding?.destroy();
          binding = null;
          return;
        }
        binding.update({
          voxels: props.voxels,
          rows: props.rows,
          cols: props.cols,
          depth: props.depth,
          showWalls: props.showWalls,
          showFloor: props.showFloor,
          projection: props.projection
        });
      },
      { deep: true }
    );

    onBeforeUnmount(() => {
      binding?.destroy();
      binding = null;
    });

    return () =>
      h("div", {
        class: SCENE_HOST_CLASS,
        ref: hostElement
      });
  }
});
