import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createSceneBinding,
  type SceneBindingHandle,
  type SceneBindingOptions
} from "@voxcss/controller/createSceneBinding";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraBindingOptions,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";
import type { SceneController } from "@voxcss/controller/createSceneController";

export function useSceneBinding(props: () => Omit<SceneBindingOptions, "element">) {
  const hostElement = ref<HTMLElement | null>(null);
  const binding = ref<SceneBindingHandle | null>(null);

  const mountBinding = () => {
    const element = hostElement.value;
    if (!element) return;
    const options = props();
    const handle = createSceneBinding({ ...options, element });
    handle.mount();
    binding.value = handle;
  };

  const destroyBinding = () => {
    binding.value?.destroy();
    binding.value = null;
  };

  onMounted(mountBinding);
  onBeforeUnmount(destroyBinding);

  watch(
    () => props(),
    (next, previous) => {
      if (!binding.value) {
        mountBinding();
        return;
      }
      if (next.controller !== previous?.controller) {
        destroyBinding();
        mountBinding();
      } else {
        binding.value.update({
          voxels: next.voxels,
          rows: next.rows,
          cols: next.cols,
          depth: next.depth,
          showWalls: next.showWalls,
          showFloor: next.showFloor,
          projection: next.projection
        });
      }
    },
    { deep: true }
  );

  return {
    hostElement
  };
}

export function useCameraBinding(props: () => Omit<CameraBindingOptions, "element">) {
  const elementRef = ref<HTMLElement | null>(null);
  const binding = ref<CameraBindingHandle | null>(null);
  const controller = ref<SceneController | null>(null);
  const snapshot = ref<CameraRenderSnapshot | null>(null);

  const mountBinding = () => {
    const element = elementRef.value;
    if (!element) return;
    const options = props();
    const handle = createCameraBinding({ ...options, element });
    binding.value = handle;
    controller.value = handle.controller;
    snapshot.value = handle.getSnapshot();
    const unsubscribe = handle.subscribe((next) => {
      snapshot.value = next;
    });
    cleanup.value = () => {
      unsubscribe();
      handle.destroy();
    };
  };

  const cleanup = ref<(() => void) | null>(null);

  const destroyBinding = () => {
    cleanup.value?.();
    cleanup.value = null;
    binding.value = null;
    controller.value = null;
    snapshot.value = null;
  };

  onMounted(mountBinding);
  onBeforeUnmount(destroyBinding);

  watch(
    () => props(),
    (next, previous) => {
      if (!binding.value) {
        mountBinding();
        return;
      }
      if (next.controller !== previous?.controller) {
        destroyBinding();
        mountBinding();
      } else {
        binding.value.setOptions({
          zoom: next.zoom,
          pan: next.pan,
          tilt: next.tilt,
          rotX: next.rotX,
          rotY: next.rotY,
          invert: next.invert,
          interactive: next.interactive,
          perspective: next.perspective,
          animate: next.animate
        });
      }
    },
    { deep: true }
  );

  const startAutoRotate = (config?: CameraBindingOptions["animate"]) => {
    binding.value?.setAnimate(config ?? props().animate);
  };

  const stopAutoRotate = () => {
    binding.value?.setAnimate(false);
  };

  return {
    elementRef,
    controller,
    snapshot,
    startAutoRotate,
    stopAutoRotate
  };
}
