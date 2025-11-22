// @ts-nocheck
import type { CameraSlotProps } from "@voxcss/controller/cameraBindingView";
import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createSceneBindingManager as createControllerSceneBindingManager,
  type SceneBindingManager
} from "@voxcss/controller/createSceneBinding";
import { createCameraBindingManager as createControllerCameraBindingManager } from "@voxcss/controller/cameraBindingView";

export function createSceneBindingManager(_vm: any, resolveOptions: () => any) {
  let currentElement: HTMLElement | null = null;
  const manager: SceneBindingManager<ReturnType<typeof resolveOptions>> = createControllerSceneBindingManager({
    getElement: () => currentElement,
    getOptions: () => resolveOptions()
  });
  return {
    mount(element: HTMLElement) {
      currentElement = element;
      manager.mount(element);
    },
    update() {
      manager.update(resolveOptions());
    },
    destroy() {
      manager.destroy();
      currentElement = null;
    }
  };
}

export function createCameraBindingManager(
  _vm: any,
  resolveOptions: () => any,
  hooks: {
    onSlotProps: (props: CameraSlotProps | null) => void;
    onController: (controller: SceneController | null) => void;
  }
) {
  const manager = createControllerCameraBindingManager(resolveOptions());
  const unsubscribe = manager.subscribe((snapshot) => {
    hooks.onSlotProps(snapshot.slotProps);
    hooks.onController(snapshot.controller);
  });
  return {
    mount(element: HTMLElement) {
      manager.update(resolveOptions());
      manager.setElement(element);
    },
    update() {
      manager.update(resolveOptions());
    },
    startAutoRotate(config?: any) {
      manager.startAutoRotate(config);
    },
    stopAutoRotate() {
      manager.stopAutoRotate();
    },
    destroy() {
      unsubscribe();
      manager.setElement(null);
      manager.destroy();
    }
  };
}
