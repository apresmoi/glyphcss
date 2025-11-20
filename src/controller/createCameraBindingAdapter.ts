import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraBindingOptions,
  type CameraRenderSnapshot
} from "./createCameraBinding";
import type { SceneController } from "./createSceneController";
import { createElementBindingAdapter } from "./bindingAdapters";

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
}

export function createCameraBindingAdapter(hooks: CameraBindingAdapterHooks): CameraBindingAdapter {
  let currentSnapshot: CameraRenderSnapshot | null = null;
  let currentController: SceneController | null = null;
  let unsubscribe: (() => void) | null = null;

  const notifySnapshot = (snapshot: CameraRenderSnapshot) => {
    currentSnapshot = snapshot;
    hooks.onSnapshot?.(snapshot);
  };

  const adapter = createElementBindingAdapter<CameraBindingHandle, Omit<CameraBindingOptions, "element">>(
    {
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    },
    {
      mount(element, options) {
        const binding = createCameraBinding({ ...options, element });
        currentController = binding.controller;
        hooks.onHandle?.(binding);
        hooks.onController?.(currentController);
        notifySnapshot(binding.getSnapshot());
        unsubscribe = binding.subscribe((snapshot) => notifySnapshot(snapshot));
        return binding;
      },
      update(binding, options) {
        binding.setOptions(options);
      },
      destroy(binding, reason) {
        unsubscribe?.();
        unsubscribe = null;
        binding.destroy();
        hooks.onHandle?.(null);
        hooks.onController?.(null);
        currentController = null;
        currentSnapshot = null;
        if (reason === "teardown") {
          hooks.onDestroy?.();
        }
      }
    }
  );

  return {
    sync: () => adapter.sync(),
    destroy: () => adapter.destroy()
  };
}
