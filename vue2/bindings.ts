// @ts-nocheck
import type { CameraBindingHandle } from "@voxcss/controller/createCameraBinding";
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
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
  onSlotProps: (props: CameraSlotProps | null) => void,
  onReady: (handle: CameraBindingHandle | null) => void
) {
  const state = createCameraBindingState(resolveOptions());
  const unsubscribeState = state.subscribe((snapshot) => {
    onSlotProps(snapshot.slotProps);
  });
  const unsubscribeHandle = state.subscribeHandle((handle) => {
    onReady(handle);
  });
  return {
    mount(element: HTMLElement) {
      state.setElement(element);
    },
    update() {
      state.setOptions(resolveOptions());
    },
    destroy() {
      unsubscribeState();
      unsubscribeHandle();
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
