import type { CameraBindingOptions } from "./createCameraBinding";
import { createCameraBindingState, type CameraBindingSnapshot } from "./cameraBindingState";
import type { AutoRotateOption } from "../core/camera";

export interface CameraBindingView {
  setElement(element: HTMLElement | null): void;
  setOptions(options: Omit<CameraBindingOptions, "element">): void;
  getSnapshot(): CameraBindingSnapshot;
  subscribe(listener: (snapshot: CameraBindingSnapshot) => void): () => void;
  startAutoRotate(option?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
  destroy(): void;
}

export function createCameraBindingView(initialOptions: Omit<CameraBindingOptions, "element">): CameraBindingView {
  const state = createCameraBindingState(initialOptions);
  return {
    setElement(element) {
      state.setElement(element);
    },
    setOptions(options) {
      state.setOptions(options);
    },
    getSnapshot() {
      return state.getSnapshot();
    },
    subscribe(listener) {
      return state.subscribe(listener);
    },
    startAutoRotate(option) {
      state.startAutoRotate(option);
    },
    stopAutoRotate() {
      state.stopAutoRotate();
    },
    destroy() {
      state.destroy();
    }
  };
}

export type { CameraBindingSnapshot } from "./cameraBindingState";
