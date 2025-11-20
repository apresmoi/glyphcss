import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import type {
  CameraBindingHandle,
  CameraBindingOptions,
  CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createBindingLifecycle } from "@voxcss/controller/bindingLifecycle";
import { createCameraBindingState } from "@voxcss/controller/cameraBindingState";

export type SceneBindingActionOptions = Omit<SceneBindingOptions, "element">;

export interface CameraBindingActionOptions extends Omit<CameraBindingOptions, "element"> {
  onSnapshot?(snapshot: CameraRenderSnapshot): void;
  onController?(controller: SceneController | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onSlotProps?(props: CameraSlotProps | null): void;
}

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  const lifecycle = createBindingLifecycle((hooks) =>
    createSceneBindingAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    })
  );
  lifecycle.setOptions(options);
  lifecycle.setElement(node);
  return {
    update(next: SceneBindingActionOptions) {
      lifecycle.setOptions(next);
    },
    destroy() {
      lifecycle.destroy();
    }
  };
}

function resolveCameraOptions(options: CameraBindingActionOptions): Omit<CameraBindingOptions, "element"> {
  const { onSnapshot, onController, onHandle, ...rest } = options;
  return rest;
}

export function cameraBinding(node: HTMLElement, options: CameraBindingActionOptions) {
  let currentOptions = options;
  const state = createCameraBindingState(resolveCameraOptions(currentOptions));
  state.setElement(node);

  const unsubscribeSnapshot = state.subscribe((next) => {
    currentOptions.onController?.(next.controller);
    currentOptions.onSlotProps?.(next.slotProps);
  });
  const unsubscribeRender = state.subscribeRender((snapshot) => {
    if (snapshot) {
      currentOptions.onSnapshot?.(snapshot);
    }
  });
  const unsubscribeHandle = state.subscribeHandle((handle) => {
    currentOptions.onHandle?.(handle);
  });

  return {
    update(next: CameraBindingActionOptions) {
      currentOptions = next;
      state.setOptions(resolveCameraOptions(next));
    },
    destroy() {
      unsubscribeSnapshot();
      unsubscribeRender();
      unsubscribeHandle();
      state.destroy();
    }
  };
}
