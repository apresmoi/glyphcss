import { onBeforeUnmount, ref, watch } from "vue";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingManager } from "@voxcss/controller/createSceneBinding";
import type { CameraBindingOptions } from "@voxcss/controller/cameraBindingView";
import type { CameraSlotProps } from "@voxcss/controller/cameraBindingView";
import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createCameraBindingManager,
  type CameraBindingSnapshot
} from "@voxcss/controller/cameraBindingView";

export function useSceneBinding(props: () => Omit<SceneBindingOptions, "element"> | null) {
  const hostElement = ref<HTMLElement | null>(null);
  const manager = createSceneBindingManager({
    getElement: () => hostElement.value,
    getOptions: () => props() ?? undefined
  });

  watch(
    hostElement,
    (element) => {
      if (element) {
        manager.mount(element);
      }
    },
    { immediate: true }
  );

  watch(
    () => props(),
    (next) => {
      manager.update(next ?? undefined);
    },
    { deep: true, immediate: true }
  );

  onBeforeUnmount(() => {
    manager.destroy();
  });

  return {
    hostElement
  };
}

export function useCameraBinding(props: () => Omit<CameraBindingOptions, "element">) {
  const controller = ref<SceneController | null>(null);
  const slotProps = ref<CameraSlotProps | null>(null);
  const elementRef = ref<HTMLElement | null>(null);
  const bindingManager = createCameraBindingManager(props());

  watch(
    () => props(),
    (next) => {
      bindingManager.update(next);
    },
    { deep: true }
  );

  watch(
    elementRef,
    (element) => {
      bindingManager.setElement(element);
    },
    { immediate: true }
  );

  const unsubscribe = bindingManager.subscribe((snapshot: CameraBindingSnapshot) => {
    controller.value = snapshot.controller;
    slotProps.value = snapshot.slotProps;
  });

  onBeforeUnmount(() => {
    unsubscribe();
    bindingManager.setElement(null);
    bindingManager.destroy();
  });

  const startAutoRotate = (config?: CameraBindingOptions["animate"]) => {
    bindingManager.startAutoRotate(config);
  };

  const stopAutoRotate = () => {
    bindingManager.stopAutoRotate();
  };

  return {
    elementRef,
    controller,
    slotProps,
    startAutoRotate,
    stopAutoRotate
  };
}
