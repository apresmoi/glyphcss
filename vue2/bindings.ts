// @ts-nocheck
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import { createBindingLifecycle, type BindingLifecycleAdapterHooks } from "@voxcss/controller/bindingLifecycle";
import { createCameraBindingState } from "@voxcss/controller/cameraBindingState";

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
  const state = createCameraBindingState(resolveOptions());
  const unsubscribe = state.subscribe((snapshot) => {
    hooks.onSlotProps(snapshot.slotProps);
    hooks.onController(snapshot.controller);
  });
  return {
    mount(element: HTMLElement) {
      state.setOptions(resolveOptions());
      state.setElement(element);
    },
    update() {
      state.setOptions(resolveOptions());
    },
    startAutoRotate(config?: any) {
      state.startAutoRotate(config);
    },
    stopAutoRotate() {
      state.stopAutoRotate();
    },
    destroy() {
      unsubscribe();
      state.destroy();
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
