import { onBeforeUnmount, ref, watch } from "vue";
import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import { createCamera, type HeadlessCameraHandle } from "@voxcss/core/headless";
import {
  normalizeCameraOptions,
  syncCameraOptions,
  type CameraComponentProps,
  type CameraSlotProps,
  type NormalizedCameraOptions
} from "@voxcss/controller/cameraBindings";

export function useSceneBinding(props: () => Omit<SceneBindingOptions, "element"> | null) {
  const hostElement = ref<HTMLElement | null>(null);
  let binding: SceneBindingHandle | null = null;

  const cleanup = () => {
    binding?.destroy();
    binding = null;
  };

  watch(
    hostElement,
    (element) => {
      cleanup();
      const next = props();
      if (!element || !next) return;
      binding = createSceneBinding({ ...next, element });
    },
    { immediate: true }
  );

  watch(
    () => props(),
    (next) => {
      if (next && binding) {
        binding.update(next);
      }
    },
    { deep: true }
  );

  onBeforeUnmount(() => {
    cleanup();
  });

  return {
    hostElement
  };
}

export function useCameraBinding(props: () => CameraComponentProps) {
  const controller = ref<SceneController | null>(null);
  const slotProps = ref<CameraSlotProps | null>(null);
  const cursor = ref("default");
  const elementRef = ref<HTMLElement | null>(null);
  const animateRef = ref<CameraComponentProps["animate"] | false | undefined>(props().animate);
  let handle: HeadlessCameraHandle | null = null;
  let normalizedOptions: NormalizedCameraOptions = normalizeCameraOptions();
  let unsubscribe: Array<() => void> = [];

  const applySnapshot = () => {
    if (!handle) return;
    const currentController = handle.controller;
    const nextCursor = handle.interactive ? currentController.getCursor() : "default";
    controller.value = currentController;
    slotProps.value = {
      boxStyle: currentController.getBoxStyle(),
      cursor: nextCursor,
      walls: currentController.getWalls(),
      camera: currentController.getCameraState(),
      controller: currentController
    };
    cursor.value = nextCursor;
  };

  const cleanup = () => {
    unsubscribe.forEach((dispose) => dispose());
    unsubscribe = [];
    handle?.destroy();
    handle = null;
    controller.value = null;
    slotProps.value = null;
    cursor.value = "default";
  };

  const mountBinding = () => {
    cleanup();
    const element = elementRef.value;
    if (!element) return;
    const next = props();
    normalizedOptions = normalizeCameraOptions({ ...normalizedOptions, ...next });
    handle = createCamera({ ...normalizedOptions, element });
    const currentController = handle.controller;
    unsubscribe = [
      currentController.subscribeBoxStyle(applySnapshot),
      currentController.subscribeCamera(applySnapshot),
      currentController.subscribeWalls(applySnapshot),
      currentController.subscribeCursor(applySnapshot)
    ];
    applySnapshot();
  };

  const updateOptions = (next: CameraComponentProps) => {
    if (!handle) {
      normalizedOptions = normalizeCameraOptions({ ...normalizedOptions, ...next });
      return;
    }
    normalizedOptions = syncCameraOptions(handle, normalizedOptions, next);
    applySnapshot();
  };

  watch(
    elementRef,
    () => {
      mountBinding();
    },
    { immediate: true }
  );

  watch(
    () => props(),
    (next) => {
      animateRef.value = next.animate;
      updateOptions(next);
    },
    { deep: true }
  );

  onBeforeUnmount(() => {
    cleanup();
  });

  const startAutoRotate = (config?: CameraComponentProps["animate"]) => {
    const next = config ?? animateRef.value;
    animateRef.value = next;
    updateOptions({ animate: next });
  };

  const stopAutoRotate = () => {
    animateRef.value = false;
    updateOptions({ animate: false });
  };

  return {
    elementRef,
    controller,
    slotProps,
    cursor,
    startAutoRotate,
    stopAutoRotate
  };
}
