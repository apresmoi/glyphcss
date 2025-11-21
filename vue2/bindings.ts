// @ts-nocheck
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createSceneBindingManager as createControllerSceneBindingManager,
  type SceneBindingManager
} from "@voxcss/controller/createSceneBindingAdapter";
import { createCameraBindingView } from "@voxcss/controller/cameraBindingView";

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
  const view = createCameraBindingView(resolveOptions());
  const unsubscribe = view.subscribe((snapshot) => {
    hooks.onSlotProps(snapshot.slotProps);
    hooks.onController(snapshot.controller);
  });
  return {
    mount(element: HTMLElement) {
      view.setOptions(resolveOptions());
      view.setElement(element);
    },
    update() {
      view.setOptions(resolveOptions());
    },
    startAutoRotate(config?: any) {
      view.startAutoRotate(config);
    },
    stopAutoRotate() {
      view.stopAutoRotate();
    },
    destroy() {
      unsubscribe();
      view.destroy();
    }
  };
}
