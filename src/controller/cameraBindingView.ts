import type { AutoRotateOption } from "../core/camera";
import {
  createCameraBinding,
  type CameraBindingOptions,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "./createCameraBinding";
import type { SceneController } from "./createSceneController";
import { resolveCameraSlotProps, type CameraSlotProps } from "./createCameraComponentCore";
import { createBindingLifecycle } from "./bindingLifecycle";
import { createElementBindingAdapter } from "./bindingAdapters";

export interface CameraBindingSnapshot {
  controller: SceneController | null;
  slotProps: CameraSlotProps | null;
}

interface CameraBindingAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<CameraBindingOptions, "element"> | null;
  onSnapshot?(snapshot: CameraRenderSnapshot): void;
  onController?(controller: SceneController | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onDestroy?(): void;
}

interface CameraBindingAdapter {
  sync(): void;
  destroy(): void;
}

interface CameraHostAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<CameraBindingOptions, "element"> | null;
  onSlotProps?(props: CameraSlotProps | null): void;
  onController?(controller: SceneController | null): void;
  onSnapshot?(snapshot: CameraRenderSnapshot | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onDestroy?(): void;
}

interface CameraHostAdapter extends CameraBindingAdapter {
  getSlotProps(): CameraSlotProps | null;
}

function createCameraBindingAdapter(hooks: CameraBindingAdapterHooks): CameraBindingAdapter {
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

function createCameraHostAdapter(hooks: CameraHostAdapterHooks): CameraHostAdapter {
  let currentController: SceneController | null = null;
  let currentSnapshot: CameraRenderSnapshot | null = null;
  let slotProps: CameraSlotProps | null = null;

  const emitSlotProps = () => {
    slotProps = resolveCameraSlotProps(currentController, currentSnapshot);
    hooks.onSlotProps?.(slotProps);
  };

  const adapter = createCameraBindingAdapter({
    getElement: hooks.getElement,
    getOptions: hooks.getOptions,
    onController(next) {
      currentController = next;
      hooks.onController?.(next);
      emitSlotProps();
    },
    onSnapshot(next) {
      currentSnapshot = next;
      hooks.onSnapshot?.(next);
      emitSlotProps();
    },
    onHandle: hooks.onHandle,
    onDestroy() {
      slotProps = null;
      currentController = null;
      currentSnapshot = null;
      hooks.onSlotProps?.(null);
      hooks.onDestroy?.();
    }
  });

  return {
    ...adapter,
    getSlotProps: () => slotProps
  };
}

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
  let currentOptions = initialOptions;
  let controller: SceneController | null = null;
  let slotProps: CameraSlotProps | null = null;
  let handle: CameraBindingHandle | null = null;
  let animateRef: AutoRotateOption | false | undefined = initialOptions.animate;
  const stateListeners = new Set<(snapshot: CameraBindingSnapshot) => void>();

  const emitSnapshot = () => {
    const snapshot: CameraBindingSnapshot = {
      controller,
      slotProps
    };
    stateListeners.forEach((listener) => listener(snapshot));
  };

  const lifecycle = createBindingLifecycle((hooks) =>
    createCameraHostAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions() ?? currentOptions,
      onController: (next) => {
        controller = next;
        emitSnapshot();
      },
      onSlotProps: (next) => {
        slotProps = next;
        emitSnapshot();
      },
      onHandle: (next) => {
        handle = next;
        if (next && animateRef !== undefined) {
          next.setAnimate(animateRef);
        }
      },
      onDestroy: () => {
        slotProps = null;
        handle = null;
        emitSnapshot();
      }
    })
  );

  lifecycle.setOptions(initialOptions);

  return {
    setElement(element) {
      lifecycle.setElement(element);
    },
    setOptions(options) {
      currentOptions = options;
      animateRef = options.animate;
      lifecycle.setOptions(options);
    },
    getSnapshot() {
      return {
        controller,
        slotProps
      };
    },
    subscribe(listener) {
      stateListeners.add(listener);
      listener({
        controller,
        slotProps
      });
      return () => {
        stateListeners.delete(listener);
      };
    },
    startAutoRotate(option) {
      const next = option ?? animateRef;
      animateRef = next;
      handle?.setAnimate(next);
    },
    stopAutoRotate() {
      animateRef = false;
      handle?.setAnimate(false);
    },
    destroy() {
      lifecycle.destroy();
      stateListeners.clear();
      controller = null;
      slotProps = null;
      handle = null;
    }
  };
}
