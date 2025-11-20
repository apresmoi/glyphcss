import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraBindingOptions,
  type CameraRenderSnapshot
} from "./createCameraBinding";
import type { AutoRotateOption } from "../core/camera";
import type { SceneController } from "./createSceneController";

export interface CameraBindingAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<CameraBindingOptions, "element">;
  onSnapshot?(snapshot: CameraRenderSnapshot): void;
  onController?(controller: SceneController | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onDestroy?(): void;
}

export interface CameraBindingAdapter {
  sync(): void;
  destroy(): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  getSnapshot(): CameraRenderSnapshot | null;
  getController(): SceneController | null;
}

export function createCameraBindingAdapter(hooks: CameraBindingAdapterHooks): CameraBindingAdapter {
  let binding: CameraBindingHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let mountedElement: HTMLElement | null = null;
  let currentSnapshot: CameraRenderSnapshot | null = null;
  let currentController: SceneController | null = null;

  const notifySnapshot = (snapshot: CameraRenderSnapshot) => {
    currentSnapshot = snapshot;
    hooks.onSnapshot?.(snapshot);
  };

  const teardown = (shouldNotifyDestroy: boolean) => {
    if (!binding) {
      mountedElement = null;
      currentSnapshot = null;
      currentController = null;
      return;
    }
    unsubscribe?.();
    unsubscribe = null;
    binding.destroy();
    binding = null;
    mountedElement = null;
    currentSnapshot = null;
    currentController = null;
    hooks.onHandle?.(null);
    hooks.onController?.(null);
    if (shouldNotifyDestroy) {
      hooks.onDestroy?.();
    }
  };

  const mountBinding = (element: HTMLElement, options: Omit<CameraBindingOptions, "element">) => {
    teardown(false);
    binding = createCameraBinding({ ...options, element });
    mountedElement = element;
    currentController = binding.controller;
    hooks.onHandle?.(binding);
    hooks.onController?.(currentController);
    notifySnapshot(binding.getSnapshot());
    unsubscribe = binding.subscribe((snapshot) => {
      notifySnapshot(snapshot);
    });
  };

  const sync = () => {
    const element = hooks.getElement();
    if (!element) {
      teardown(true);
      return;
    }
    const options = hooks.getOptions();
    if (!binding || mountedElement !== element) {
      mountBinding(element, options);
      return;
    }
    binding.setOptions(options);
  };

  const destroy = () => {
    teardown(true);
  };

  const setAnimate = (option: AutoRotateOption | false | undefined) => {
    binding?.setAnimate(option);
  };

  return {
    sync,
    destroy,
    setAnimate,
    getSnapshot: () => currentSnapshot,
    getController: () => currentController
  };
}
