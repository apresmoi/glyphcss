import { defineComponent, h, onBeforeUnmount, ref, watch, computed, inject } from "vue";
import { mountScene, normalizeSceneState, SCENE_HOST_CLASS, type SceneState } from "@voxcss/controller/sceneBindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import { normalizeMergeVoxelsOption, type MergeVoxelsOption } from "@voxcss/utils/mergeVoxelsOption";
import { controllerKey } from "./context";

const scenePropOptions = {
  controller: { type: Object as import("vue").PropType<SceneController> },
  voxels: { type: Array as import("vue").PropType<import("@voxcss/core/types").VoxelGrid | undefined> },
  rows: { type: Number },
  cols: { type: Number },
  depth: { type: Number },
  showWalls: { type: Boolean as import("vue").PropType<boolean | undefined> },
  showFloor: { type: Boolean as import("vue").PropType<boolean | undefined> },
  projection: { type: String as import("vue").PropType<import("@voxcss/core/types").ProjectionMode | undefined> },
  mergeVoxels: {
    type: [String, Boolean] as import("vue").PropType<MergeVoxelsOption>,
    default: false,
    validator: (value: unknown) => value === false || value === "2d" || value === "3d"
  }
} as const;

export default defineComponent({
  name: "VoxScene",
  props: scenePropOptions,
  setup(props) {
    const hostElement = ref<HTMLElement | null>(null);
    let binding: ReturnType<typeof mountScene> | null = null;
    const injectedController = inject(controllerKey, null);
    const resolvedController = computed<SceneController | null>(() => props.controller ?? injectedController?.value ?? null);

    const mountBinding = () => {
      binding?.destroy();
      binding = null;
      const element = hostElement.value;
      const controller = resolvedController.value;
      if (!element || !controller) return;
      const rawVoxels = props.voxels ?? [];
      const mergeOption = normalizeMergeVoxelsOption(props.mergeVoxels);
      const options: SceneState & { controller: SceneController } = {
        controller,
        ...normalizeSceneState({
          voxels: rawVoxels,
          rows: props.rows,
          cols: props.cols,
          depth: props.depth,
          showWalls: props.showWalls,
          showFloor: props.showFloor,
          projection: props.projection,
          mergeVoxels: mergeOption
        })
      };
      binding = mountScene({ ...options, element });
    };

    watch(hostElement, () => mountBinding(), { immediate: true });
    watch(resolvedController, () => mountBinding());
    watch(
      () => props.controller,
      (next, prev) => {
        if (next === prev) return;
        binding?.destroy();
        binding = null;
        mountBinding();
      }
    );
    watch(
      () => [
        props.voxels,
        props.rows,
        props.cols,
        props.depth,
        props.showWalls,
        props.showFloor,
        props.projection,
        props.mergeVoxels
      ],
      () => {
        if (!binding) {
          mountBinding();
          return;
        }
        const rawVoxels = props.voxels ?? [];
        const mergeOption = normalizeMergeVoxelsOption(props.mergeVoxels);
        binding.update(
          normalizeSceneState({
            voxels: rawVoxels,
            rows: props.rows,
            cols: props.cols,
            depth: props.depth,
            showWalls: props.showWalls,
            showFloor: props.showFloor,
            projection: props.projection,
            mergeVoxels: mergeOption
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
