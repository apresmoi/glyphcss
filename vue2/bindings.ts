// @ts-nocheck
import { createCamera } from "@voxcss/core/headless";
import {
  normalizeCameraOptions,
  syncCameraOptions,
  type CameraComponentProps,
  type CameraSlotProps,
  type NormalizedCameraOptions
} from "@voxcss/controller/cameraBindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";

export function createSceneBindingManager(_vm: any, resolveOptions: () => any) {
  let binding: SceneBindingHandle | null = null;
  let element: HTMLElement | null = null;
  let latestOptions: ReturnType<typeof resolveOptions> | null = null;

  const cleanup = () => {
    binding?.destroy();
    binding = null;
  };

  const tryCreateBinding = () => {
    if (!element || !latestOptions?.controller) {
      return;
    }
    binding = createSceneBinding({ ...latestOptions, element });
  };

  return {
    mount(target: HTMLElement) {
      element = target;
      cleanup();
      latestOptions = resolveOptions();
      if (!latestOptions.controller) {
        return;
      }
      binding = createSceneBinding({ ...latestOptions, element: target });
    },
    update() {
      latestOptions = resolveOptions();
      if (!latestOptions?.controller) {
        return;
      }
      if (!binding) {
        tryCreateBinding();
        return;
      }
      binding.update(latestOptions);
    },
    destroy() {
      cleanup();
      element = null;
      latestOptions = null;
    }
  };
}

export function createCameraBindingManager(
  _vm: any,
  resolveOptions: () => CameraComponentProps,
  hooks: {
    onSlotProps: (props: CameraSlotProps | null) => void;
    onController: (controller: SceneController | null) => void;
    onCursor?: (cursor: string) => void;
  }
) {
  let handle: ReturnType<typeof createCamera> | null = null;
  let unsubscribe: Array<() => void> = [];
  let normalizedOptions: NormalizedCameraOptions = normalizeCameraOptions();
  let animateValue: any = resolveOptions().animate;

  const applySnapshot = () => {
    if (!handle) return;
    const controller = handle.controller;
    const cursor = handle.interactive ? controller.getCursor() : "default";
    const slotProps: CameraSlotProps = {
      boxStyle: controller.getBoxStyle(),
      cursor,
      walls: controller.getWalls(),
      camera: controller.getCameraState(),
      controller
    };
    hooks.onCursor?.(cursor);
    hooks.onSlotProps(slotProps);
    hooks.onController(controller);
  };

  const cleanup = () => {
    unsubscribe.forEach((dispose) => dispose());
    unsubscribe = [];
    handle?.destroy();
    handle = null;
    hooks.onSlotProps(null);
    hooks.onController(null);
    hooks.onCursor?.("default");
  };

  const updateOptions = (input: CameraComponentProps) => {
    if (!handle) {
      normalizedOptions = normalizeCameraOptions({ ...normalizedOptions, ...input });
      return;
    }
    normalizedOptions = syncCameraOptions(handle, normalizedOptions, input);
    applySnapshot();
  };

  return {
    mount(target: HTMLElement) {
      cleanup();
      const options = resolveOptions();
      animateValue = options.animate;
      normalizedOptions = normalizeCameraOptions({ ...normalizedOptions, ...options });
      handle = createCamera({ ...normalizedOptions, element: target });
      const controller = handle.controller;
      unsubscribe = [
        controller.subscribeBoxStyle(applySnapshot),
        controller.subscribeCamera(applySnapshot),
        controller.subscribeWalls(applySnapshot),
        controller.subscribeCursor(applySnapshot)
      ];
      applySnapshot();
    },
    update() {
      const options = resolveOptions();
      animateValue = options.animate;
      updateOptions(options);
    },
    startAutoRotate(config?: any) {
      const next = config ?? animateValue;
      animateValue = next;
      updateOptions({ animate: next });
    },
    stopAutoRotate() {
      animateValue = false;
      updateOptions({ animate: false });
    },
    destroy() {
      cleanup();
    }
  };
}
