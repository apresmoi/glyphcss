import { onBeforeUnmount, ref, watch } from "vue";
import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";
import type { CameraBindingOptions } from "@voxcss/controller/cameraBindings";
import type { CameraSlotProps } from "@voxcss/controller/cameraBindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import {
  buildCameraSlotProps,
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
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

export function useCameraBinding(props: () => Omit<CameraBindingOptions, "element">) {
  const controller = ref<SceneController | null>(null);
  const slotProps = ref<CameraSlotProps | null>(null);
  const cursor = ref("default");
  const elementRef = ref<HTMLElement | null>(null);
  const animateRef = ref<CameraBindingOptions["animate"] | false | undefined>(props().animate);
  let binding: CameraBindingHandle | null = null;
  let unsubscribe: (() => void) | null = null;

  const applySnapshot = (snapshot: CameraRenderSnapshot) => {
    if (!binding) return;
    controller.value = binding.controller;
    slotProps.value = buildCameraSlotProps(binding.controller, snapshot);
    cursor.value = snapshot.cursor ?? "default";
  };

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    binding?.destroy();
    binding = null;
    controller.value = null;
    slotProps.value = null;
    cursor.value = "default";
  };

  const mountBinding = () => {
    cleanup();
    const element = elementRef.value;
    const options = props();
    if (!element) return;
    binding = createCameraBinding({ ...options, element });
    if (animateRef.value !== undefined && animateRef.value !== options.animate) {
      binding.setAnimate(animateRef.value);
    }
    applySnapshot(binding.getSnapshot());
    unsubscribe = binding.subscribe(applySnapshot);
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
      binding?.setOptions(next);
    },
    { deep: true }
  );

  onBeforeUnmount(() => {
    cleanup();
  });

  const startAutoRotate = (config?: CameraBindingOptions["animate"]) => {
    const next = config ?? animateRef.value;
    animateRef.value = next;
    binding?.setAnimate(next);
  };

  const stopAutoRotate = () => {
    animateRef.value = false;
    binding?.setAnimate(false);
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
