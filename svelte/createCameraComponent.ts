import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
import { createCameraBindingState } from "@voxcss/controller/cameraBindingState";

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
  const bindingState = createCameraBindingState(createCameraBindingProps({}));
  let slotProps: CameraSlotProps | null = null;
  const unsubscribe = bindingState.subscribe((snapshot) => {
    slotProps = snapshot.slotProps;
    if (snapshot.controller) {
      config.onControllerReady(snapshot.controller);
    }
  });

  return {
    className: CAMERA_HOST_CLASS,
    setElement(element) {
      bindingState.setElement(element);
    },
    setProps(props) {
      bindingState.setOptions(createCameraBindingProps(props));
    },
    getSlotProps() {
      return slotProps;
    },
    getCursor() {
      return slotProps?.cursor ?? "default";
    },
    startAutoRotate(config?: AutoRotateOption | false) {
      bindingState.startAutoRotate(config);
    },
    stopAutoRotate() {
      bindingState.stopAutoRotate();
    },
    destroy() {
      unsubscribe();
      bindingState.destroy();
    }
  };
}

export type { CameraComponentProps, CameraSlotProps };
