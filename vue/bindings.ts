import { onBeforeUnmount, ref, watch } from "vue";
import { attachSceneBinding, type AttachSceneBindingOptions } from "@voxcss/controller/sharedBindings";
import { mountCameraBinding } from "@voxcss/controller/sharedCamera";
import type { CameraComponentProps, CameraSlotProps } from "@voxcss/controller/cameraBindings";
import type { SceneController } from "@voxcss/controller/sceneController";

export function useSceneBinding(props: () => Omit<AttachSceneBindingOptions, "element"> | null) {
  const hostElement = ref<HTMLElement | null>(null);
  let binding: ReturnType<typeof attachSceneBinding> = null;
  let currentController: SceneController | null = null;

  const cleanup = () => {
    binding?.destroy();
    binding = null;
    currentController = null;
  };

  const mountBinding = () => {
    cleanup();
    const element = hostElement.value;
    const next = props();
    if (!element || !next || !next.controller) return;
    currentController = next.controller;
    binding = attachSceneBinding({ ...next, element });
  };

  watch(
    hostElement,
    () => {
      mountBinding();
    },
    { immediate: true }
  );

  watch(
    () => props(),
    (next) => {
      const controllerChanged = next?.controller !== currentController;
      if (!next || !binding || controllerChanged) {
        mountBinding();
        return;
      }
      binding.update(next);
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
  let teardown: ReturnType<typeof mountCameraBinding> | null = null;

  const cleanup = () => {
    teardown?.destroy();
    teardown = null;
    controller.value = null;
    slotProps.value = null;
    cursor.value = "default";
  };

  const mountBinding = () => {
    cleanup();
    const element = elementRef.value;
    const next = props();
    if (!element) return;
    teardown = mountCameraBinding(
      element,
      next,
      (snapshot) => {
        if (!snapshot) {
          controller.value = null;
          slotProps.value = null;
          cursor.value = "default";
          return;
        }
        controller.value = snapshot.controller;
        slotProps.value = {
          boxStyle: snapshot.boxStyle,
          cursor: snapshot.cursor,
          walls: snapshot.walls,
          camera: snapshot.camera,
          controller: snapshot.controller
        };
        cursor.value = snapshot.cursor;
      },
      (nextCursor) => {
        cursor.value = nextCursor;
      }
    );
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
      teardown?.update(next);
    },
    { deep: true }
  );

  onBeforeUnmount(() => {
    cleanup();
  });

  const startAutoRotate = (config?: CameraComponentProps["animate"]) => {
    const next = config ?? animateRef.value;
    animateRef.value = next;
    teardown?.startAutoRotate(next);
  };

  const stopAutoRotate = () => {
    animateRef.value = false;
    teardown?.stopAutoRotate();
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
