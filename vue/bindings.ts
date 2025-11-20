import { onBeforeUnmount, ref, watch } from "vue";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import type { CameraBindingOptions } from "@voxcss/controller/createCameraBinding";
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { useElementBindingAdapter } from "./bindingAdapters";
import { createCameraBindingState } from "@voxcss/controller/cameraBindingState";

export function useSceneBinding(props: () => Omit<SceneBindingOptions, "element"> | null) {
  const { elementRef: hostElement } = useElementBindingAdapter(
    () => props(),
    (hooks) =>
      createSceneBindingAdapter({
        getElement: () => hooks.getElement(),
        getOptions: () => hooks.getOptions()
      })
  );
  return {
    hostElement
  };
}

export function useCameraBinding(props: () => Omit<CameraBindingOptions, "element">) {
  const controller = ref<SceneController | null>(null);
  const slotProps = ref<CameraSlotProps | null>(null);
  const elementRef = ref<HTMLElement | null>(null);
  const bindingState = createCameraBindingState(props());

  watch(
    () => props(),
    (next) => {
      bindingState.setOptions(next);
    },
    { deep: true }
  );

  watch(
    elementRef,
    (element) => {
      bindingState.setElement(element);
    },
    { immediate: true }
  );

  const unsubscribe = bindingState.subscribe((snapshot) => {
    controller.value = snapshot.controller;
    slotProps.value = snapshot.slotProps;
  });

  onBeforeUnmount(() => {
    unsubscribe();
    bindingState.destroy();
  });

  const startAutoRotate = (config?: CameraBindingOptions["animate"]) => {
    bindingState.startAutoRotate(config);
  };

  const stopAutoRotate = () => {
    bindingState.stopAutoRotate();
  };

  return {
    elementRef,
    controller,
    slotProps,
    startAutoRotate,
    stopAutoRotate
  };
}
