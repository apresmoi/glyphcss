import { onBeforeUnmount, ref, watch } from "vue";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import type { CameraBindingOptions } from "@voxcss/controller/createCameraBinding";
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { useElementBindingAdapter } from "./bindingAdapters";
import {
  createCameraBindingView,
  type CameraBindingSnapshot
} from "@voxcss/controller/cameraBindingView";

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
  const bindingView = createCameraBindingView(props());

  watch(
    () => props(),
    (next) => {
      bindingView.setOptions(next);
    },
    { deep: true }
  );

  watch(
    elementRef,
    (element) => {
      bindingView.setElement(element);
    },
    { immediate: true }
  );

  const unsubscribe = bindingView.subscribe((snapshot: CameraBindingSnapshot) => {
    controller.value = snapshot.controller;
    slotProps.value = snapshot.slotProps;
  });

  onBeforeUnmount(() => {
    unsubscribe();
    bindingView.destroy();
  });

  const startAutoRotate = (config?: CameraBindingOptions["animate"]) => {
    bindingView.startAutoRotate(config);
  };

  const stopAutoRotate = () => {
    bindingView.stopAutoRotate();
  };

  return {
    elementRef,
    controller,
    slotProps,
    startAutoRotate,
    stopAutoRotate
  };
}
