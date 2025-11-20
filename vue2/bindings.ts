// @ts-nocheck
import type { CameraBindingHandle, CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import { createCameraBindingAdapter } from "@voxcss/controller/createCameraBindingAdapter";

export function createSceneBindingManager(vm: any, resolveOptions: () => any) {
  let hostElement: HTMLElement | null = null;
  const adapter = createSceneBindingAdapter({
    getElement: () => hostElement,
    getOptions: () => resolveOptions()
  });
  return {
    mount(element: HTMLElement) {
      hostElement = element;
      adapter.sync();
    },
    update() {
      adapter.sync();
    },
    destroy() {
      hostElement = null;
      adapter.destroy();
    }
  };
}

export function createCameraBindingManager(
  vm: any,
  resolveOptions: () => any,
  onSnapshot: (snapshot: CameraRenderSnapshot) => void,
  onReady: (handle: CameraBindingHandle | null) => void
) {
  let hostElement: HTMLElement | null = null;
  const adapter = createCameraBindingAdapter({
    getElement: () => hostElement,
    getOptions: () => resolveOptions(),
    onSnapshot: (snapshot) => onSnapshot(snapshot),
    onHandle: (handle) => onReady(handle)
  });
  return {
    mount(element: HTMLElement) {
      hostElement = element;
      adapter.sync();
    },
    update() {
      adapter.sync();
    },
    destroy() {
      hostElement = null;
      adapter.destroy();
    }
  };
}
