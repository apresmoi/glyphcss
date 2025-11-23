import type { SceneController } from "@voxcss/controller/sceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  buildCameraSlotProps,
  createCameraBinding,
  createCameraBindingProps,
  type CameraBindingHandle,
  type CameraComponentProps,
  type CameraRenderSnapshot,
  type CameraSlotProps
} from "@voxcss/controller/cameraBindings";

export interface SvelteCameraComponentConfig {
  onControllerReady(controller: SceneController): void;
}

export interface SvelteCameraComponentInstance {
  className: string;
  setElement(element: HTMLElement | null): void;
  setProps(props: CameraComponentProps): void;
  getSlotProps(): CameraSlotProps | null;
  getCursor(): string;
  startAutoRotate(config?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
  destroy(): void;
}

export function createCameraComponent(config: SvelteCameraComponentConfig): SvelteCameraComponentInstance {
  let slotProps: CameraSlotProps | null = null;
  let cursor = "default";
  let element: HTMLElement | null = null;
  let binding: CameraBindingHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let normalizedOptions = createCameraBindingProps({});
  let pendingAnimate: AutoRotateOption | false | undefined = normalizedOptions.animate;

  const applySnapshot = (snapshot: CameraRenderSnapshot) => {
    slotProps = buildCameraSlotProps(binding?.controller ?? null, snapshot);
    cursor = snapshot.cursor ?? "default";
    if (slotProps?.controller) {
      config.onControllerReady(slotProps.controller);
    }
  };

  const destroyBinding = () => {
    unsubscribe?.();
    unsubscribe = null;
    binding?.destroy();
    binding = null;
    slotProps = null;
    cursor = "default";
  };

  const mountBinding = () => {
    if (!element) return;
    destroyBinding();
    binding = createCameraBinding({
      ...normalizedOptions,
      element
    });
    if (pendingAnimate !== undefined && pendingAnimate !== normalizedOptions.animate) {
      binding.setAnimate(pendingAnimate);
    }
    applySnapshot(binding.getSnapshot());
    unsubscribe = binding.subscribe(applySnapshot);
  };

  return {
    className: CAMERA_HOST_CLASS,
    setElement(next) {
      if (element === next) return;
      element = next;
      if (!element) {
        destroyBinding();
        return;
      }
      mountBinding();
    },
    setProps(props) {
      normalizedOptions = createCameraBindingProps(props);
      pendingAnimate = normalizedOptions.animate;
      if (binding) {
        binding.setOptions(normalizedOptions);
      }
    },
    getSlotProps() {
      return slotProps;
    },
    getCursor() {
      return cursor;
    },
    startAutoRotate(config?: AutoRotateOption | false) {
      const next = config ?? pendingAnimate;
      pendingAnimate = next;
      binding?.setAnimate(next);
    },
    stopAutoRotate() {
      pendingAnimate = false;
      binding?.setAnimate(false);
    },
    destroy() {
      destroyBinding();
      element = null;
    }
  };
}

export type { CameraComponentProps, CameraSlotProps };
