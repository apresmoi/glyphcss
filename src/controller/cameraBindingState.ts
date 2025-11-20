import type { AutoRotateOption } from "../core/camera";
import type { CameraBindingOptions, CameraBindingHandle, CameraRenderSnapshot } from "./createCameraBinding";
import type { CameraSlotProps } from "./createCameraComponentCore";
import type { SceneController } from "./createSceneController";
import { createBindingLifecycle } from "./bindingLifecycle";
import { createCameraHostAdapter } from "./createCameraHostAdapter";

export interface CameraBindingSnapshot {
  controller: SceneController | null;
  slotProps: CameraSlotProps | null;
}

export interface CameraBindingState {
  setElement(element: HTMLElement | null): void;
  setOptions(options: Omit<CameraBindingOptions, "element">): void;
  getSnapshot(): CameraBindingSnapshot;
  subscribe(listener: (snapshot: CameraBindingSnapshot) => void): () => void;
  subscribeRender(listener: (snapshot: CameraRenderSnapshot | null) => void): () => void;
  subscribeHandle(listener: (handle: CameraBindingHandle | null) => void): () => void;
  startAutoRotate(option?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
  destroy(): void;
}

export function createCameraBindingState(initialOptions: Omit<CameraBindingOptions, "element">): CameraBindingState {
  let currentOptions = initialOptions;
  let controller: SceneController | null = null;
  let slotProps: CameraSlotProps | null = null;
  let renderSnapshot: CameraRenderSnapshot | null = null;
  let handle: CameraBindingHandle | null = null;
  let animateRef: AutoRotateOption | false | undefined = initialOptions.animate;

  const stateListeners = new Set<(snapshot: CameraBindingSnapshot) => void>();
  const renderListeners = new Set<(snapshot: CameraRenderSnapshot | null) => void>();
  const handleListeners = new Set<(binding: CameraBindingHandle | null) => void>();

  const emitSnapshot = () => {
    const snapshot: CameraBindingSnapshot = {
      controller,
      slotProps
    };
    stateListeners.forEach((listener) => listener(snapshot));
  };

  const emitRenderSnapshot = () => {
    renderListeners.forEach((listener) => listener(renderSnapshot));
  };

  const emitHandle = () => {
    handleListeners.forEach((listener) => listener(handle));
  };

  const lifecycle = createBindingLifecycle((hooks) =>
    createCameraHostAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => currentOptions,
      onController: (next) => {
        controller = next;
        emitSnapshot();
      },
      onSlotProps: (next) => {
        slotProps = next;
        emitSnapshot();
      },
      onSnapshot: (next) => {
        renderSnapshot = next;
        emitRenderSnapshot();
      },
      onHandle: (next) => {
        handle = next;
        emitHandle();
        if (next && animateRef !== undefined) {
          next.setAnimate(animateRef);
        }
      },
      onDestroy: () => {
        renderSnapshot = null;
        slotProps = null;
        handle = null;
        emitSnapshot();
        emitRenderSnapshot();
        emitHandle();
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
    subscribeRender(listener) {
      renderListeners.add(listener);
      listener(renderSnapshot);
      return () => {
        renderListeners.delete(listener);
      };
    },
    subscribeHandle(listener) {
      handleListeners.add(listener);
      listener(handle);
      return () => {
        handleListeners.delete(listener);
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
      renderListeners.clear();
      handleListeners.clear();
      controller = null;
      slotProps = null;
      renderSnapshot = null;
      handle = null;
    }
  };
}
