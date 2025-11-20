import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import type { CameraBindingOptions, CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import { createCameraBindingAdapter } from "@voxcss/controller/createCameraBindingAdapter";
import type { SceneController } from "@voxcss/controller/createSceneController";

export function useSceneBinding(props: () => Omit<SceneBindingOptions, "element"> | null) {
  const hostElement = ref<HTMLElement | null>(null);
  const adapter = createSceneBindingAdapter({
    getElement: () => hostElement.value,
    getOptions: () => props()
  });

  const sync = () => {
    adapter.sync();
  };

  onMounted(sync);
  onBeforeUnmount(() => adapter.destroy());

  watch(
    () => props(),
    () => {
      sync();
    },
    { deep: true }
  );

  watch(hostElement, () => {
    sync();
  });

  return {
    hostElement
  };
}

export function useCameraBinding(props: () => Omit<CameraBindingOptions, "element">) {
  const elementRef = ref<HTMLElement | null>(null);
  const controller = ref<SceneController | null>(null);
  const snapshot = ref<CameraRenderSnapshot | null>(null);
  const adapter = createCameraBindingAdapter({
    getElement: () => elementRef.value,
    getOptions: () => props(),
    onController: (next) => {
      controller.value = next;
    },
    onSnapshot: (next) => {
      snapshot.value = next;
    },
    onDestroy: () => {
      snapshot.value = null;
    }
  });

  const sync = () => {
    adapter.sync();
  };

  onMounted(sync);
  onBeforeUnmount(() => adapter.destroy());

  watch(
    () => props(),
    () => {
      sync();
    },
    { deep: true }
  );

  watch(elementRef, () => {
    sync();
  });

  const startAutoRotate = (config?: CameraBindingOptions["animate"]) => {
    adapter.setAnimate(config ?? props().animate);
  };

  const stopAutoRotate = () => {
    adapter.setAnimate(false);
  };

  return {
    elementRef,
    controller,
    snapshot,
    startAutoRotate,
    stopAutoRotate
  };
}
