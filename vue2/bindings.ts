// @ts-nocheck
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import { createBindingLifecycle, type BindingLifecycleAdapterHooks } from "@voxcss/controller/bindingLifecycle";
import { createCameraBindingView } from "@voxcss/controller/cameraBindingView";

export function createSceneBindingManager(_vm: any, resolveOptions: () => any) {
  return createElementBindingManager(resolveOptions, (hooks) =>
    createSceneBindingAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    })
  );
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

function createElementBindingManager<TOptions, TAdapter extends { sync(): void; destroy(): void }>(
  resolveOptions: () => TOptions,
  factory: (hooks: BindingLifecycleAdapterHooks<TOptions | null>) => TAdapter
) {
  const lifecycle = createBindingLifecycle(factory);
  return {
    mount(element: HTMLElement) {
      lifecycle.setOptions(resolveOptions());
      lifecycle.setElement(element);
    },
    update() {
      lifecycle.setOptions(resolveOptions());
    },
    destroy() {
      lifecycle.destroy();
    }
  };
}
