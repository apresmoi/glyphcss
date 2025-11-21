import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  createCameraViewController,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
import { createCameraBindingView } from "@voxcss/controller/cameraBindingView";

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
  const bindingView = createCameraBindingView(createCameraBindingProps({}));
  let slotProps: CameraSlotProps | null = null;
  const unsubscribe = bindingView.subscribe((snapshot) => {
      slotProps = snapshot.slotProps;
      if (snapshot.controller) {
        config.onControllerReady(snapshot.controller);
      }
    });

  return {
    className: CAMERA_HOST_CLASS,
    setElement(element) {
      bindingView.setElement(element);
    },
    setProps(props) {
      bindingView.setOptions(createCameraBindingProps(props));
    },
    getSlotProps() {
      return createCameraViewController(slotProps).getRenderableProps();
    },
    getCursor() {
      return createCameraViewController(slotProps).cursor;
    },
    startAutoRotate(config?: AutoRotateOption | false) {
      bindingView.startAutoRotate(config);
    },
    stopAutoRotate() {
      bindingView.stopAutoRotate();
    },
    destroy() {
      unsubscribe();
      bindingView.destroy();
    }
  };
}

export type { CameraComponentProps, CameraSlotProps };
