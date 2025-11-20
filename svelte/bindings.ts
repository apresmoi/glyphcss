import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import { createCameraBindingAdapter } from "@voxcss/controller/createCameraBindingAdapter";
import type { CameraBindingHandle, CameraBindingOptions, CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import type { SceneController } from "@voxcss/controller/createSceneController";

export type SceneBindingActionOptions = Omit<SceneBindingOptions, "element">;

export interface CameraBindingActionOptions extends Omit<CameraBindingOptions, "element"> {
  onSnapshot?(snapshot: CameraRenderSnapshot): void;
  onController?(controller: SceneController | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
}

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  let currentOptions = options;
  const adapter = createSceneBindingAdapter({
    getElement: () => node,
    getOptions: () => currentOptions
  });

  adapter.sync();

  return {
    update(next: SceneBindingActionOptions) {
      currentOptions = next;
      adapter.sync();
    },
    destroy() {
      adapter.destroy();
    }
  };
}

function resolveCameraOptions(options: CameraBindingActionOptions): Omit<CameraBindingOptions, "element"> {
  const { onSnapshot, onController, onHandle, ...rest } = options;
  return rest;
}

export function cameraBinding(node: HTMLElement, options: CameraBindingActionOptions) {
  let currentOptions = options;
  const adapter = createCameraBindingAdapter({
    getElement: () => node,
    getOptions: () => resolveCameraOptions(currentOptions),
    onSnapshot: (snapshot) => currentOptions.onSnapshot?.(snapshot),
    onController: (controller) => currentOptions.onController?.(controller),
    onHandle: (handle) => currentOptions.onHandle?.(handle)
  });

  adapter.sync();

  return {
    update(next: CameraBindingActionOptions) {
      currentOptions = next;
      adapter.sync();
    },
    destroy() {
      adapter.destroy();
    }
  };
}
