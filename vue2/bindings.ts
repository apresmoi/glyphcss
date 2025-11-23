// @ts-nocheck
import type { CameraSlotProps } from "@voxcss/controller/cameraBindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";
import {
  buildCameraSlotProps,
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "@voxcss/controller/cameraBindings";

export function createSceneBindingManager(_vm: any, resolveOptions: () => any) {
  let binding: SceneBindingHandle | null = null;
  let element: HTMLElement | null = null;

  const cleanup = () => {
    binding?.destroy();
    binding = null;
  };

  return {
    mount(target: HTMLElement) {
      element = target;
      cleanup();
      const options = resolveOptions();
      binding = createSceneBinding({ ...options, element: target });
    },
    update() {
      if (!binding) return;
      binding.update(resolveOptions());
    },
    destroy() {
      cleanup();
      element = null;
    }
  };
}

export function createCameraBindingManager(
  _vm: any,
  resolveOptions: () => any,
  hooks: {
    onSlotProps: (props: CameraSlotProps | null) => void;
    onController: (controller: SceneController | null) => void;
    onCursor?: (cursor: string) => void;
  }
) {
  let binding: CameraBindingHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let animateValue: any = resolveOptions().animate;

  const applySnapshot = (snapshot: CameraRenderSnapshot) => {
    if (!binding) return;
    const slotProps = buildCameraSlotProps(binding.controller, snapshot);
    hooks.onCursor?.(snapshot.cursor ?? "default");
    hooks.onSlotProps(slotProps);
    hooks.onController(slotProps?.controller ?? null);
  };

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    binding?.destroy();
    binding = null;
    hooks.onSlotProps(null);
    hooks.onController(null);
    hooks.onCursor?.("default");
  };

  return {
    mount(target: HTMLElement) {
      cleanup();
      const options = resolveOptions();
      animateValue = options.animate;
      binding = createCameraBinding({ ...options, element: target });
      if (animateValue !== undefined && animateValue !== options.animate) {
        binding.setAnimate(animateValue);
      }
      applySnapshot(binding.getSnapshot());
      unsubscribe = binding.subscribe((snapshot) => applySnapshot(snapshot));
    },
    update() {
      if (!binding) return;
      const options = resolveOptions();
      animateValue = options.animate;
      binding.setOptions(options);
    },
    startAutoRotate(config?: any) {
      const next = config ?? animateValue;
      animateValue = next;
      binding?.setAnimate(next);
    },
    stopAutoRotate() {
      animateValue = false;
      binding?.setAnimate(false);
    },
    destroy() {
      cleanup();
    }
  };
}
