import { defineComponent, h, onBeforeUnmount, ref, watch } from "vue";
import { mountScene, normalizeSceneState, SCENE_HOST_CLASS, type SceneState } from "@voxcss/controller/sceneBindings";
import type { SceneController } from "@voxcss/controller/sceneController";

const scenePropOptions = {
  controller: { type: Object as import("vue").PropType<SceneController>, required: true },
  voxels: { type: Array as import("vue").PropType<import("@voxcss/core/types").VoxelGrid | undefined> },
  rows: { type: Number },
  cols: { type: Number },
  depth: { type: Number },
  showWalls: { type: Boolean as import("vue").PropType<boolean | undefined> },
  showFloor: { type: Boolean as import("vue").PropType<boolean | undefined> },
  projection: { type: String as import("vue").PropType<import("@voxcss/core/types").ProjectionMode | undefined> }
} as const;

export default defineComponent({
  name: "VoxScene",
  props: scenePropOptions,
  setup(props) {
    const hostElement = ref<HTMLElement | null>(null);
    let binding: ReturnType<typeof mountScene> | null = null;

    const mountBinding = () => {
      binding?.destroy();
      binding = null;
      const element = hostElement.value;
      const controller = props.controller;
      if (!element || !controller) return;
      const options: SceneState & { controller: SceneController } = {
        controller,
        ...normalizeSceneState({
          voxels: props.voxels,
          rows: props.rows,
          cols: props.cols,
          depth: props.depth,
          showWalls: props.showWalls,
          showFloor: props.showFloor,
          projection: props.projection
        })
      };
      binding = mountScene({ ...options, element });
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
        binding.update(
          normalizeSceneState({
            voxels: props.voxels,
            rows: props.rows,
            cols: props.cols,
            depth: props.depth,
            showWalls: props.showWalls,
            showFloor: props.showFloor,
            projection: props.projection
          })
        );
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
