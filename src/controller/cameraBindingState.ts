import type { AutoRotateOption } from "../core/camera";
import type { CameraBindingOptions, CameraBindingHandle } from "./createCameraBinding";
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
  startAutoRotate(option?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
  destroy(): void;
}

export function createCameraBindingState(initialOptions: Omit<CameraBindingOptions, "element">): CameraBindingState {
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
      getOptions: () => currentOptions,
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
