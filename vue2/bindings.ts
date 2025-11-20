// @ts-nocheck
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";

export function createSceneBindingManager(vm: any, resolveOptions: () => any) {
  let binding: SceneBindingHandle | null = null;
  return {
    mount(element: HTMLElement) {
      const options = resolveOptions();
      binding = createSceneBinding({ ...options, element });
      binding.mount();
    },
    update() {
      if (!binding) return;
      const options = resolveOptions();
      binding.update(options);
    },
    destroy() {
      binding?.destroy();
      binding = null;
    }
  };
}

export function createCameraBindingManager(
  vm: any,
  resolveOptions: () => any,
  onSnapshot: (snapshot: CameraRenderSnapshot) => void,
  onReady: (handle: CameraBindingHandle | null) => void
) {
  let binding: CameraBindingHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  return {
    mount(element: HTMLElement) {
      const options = resolveOptions();
      binding = createCameraBinding({ ...options, element });
      onReady(binding);
      onSnapshot(binding.getSnapshot());
      unsubscribe = binding.subscribe((snapshot) => onSnapshot(snapshot));
    },
    update() {
      if (!binding) return;
      const options = resolveOptions();
      binding.setOptions(options);
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      binding?.destroy();
      binding = null;
      onReady(null);
    }
  };
}
