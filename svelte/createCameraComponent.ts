import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  createCameraViewController,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/cameraBindingView";
import {
  createCameraBindingManager,
  type CameraBindingSnapshot
} from "@voxcss/controller/cameraBindingView";

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
  const bindingManager = createCameraBindingManager(createCameraBindingProps({}));

  const applySnapshot = (snapshot: CameraBindingSnapshot) => {
    slotProps = snapshot.slotProps;
    if (snapshot.controller) {
      config.onControllerReady(snapshot.controller);
    }
  };
  applySnapshot(bindingManager.getSnapshot());
  const unsubscribe = bindingManager.subscribe(applySnapshot);

  return {
    className: CAMERA_HOST_CLASS,
    setElement(element) {
      bindingManager.setElement(element);
    },
    setProps(props) {
      bindingManager.update(createCameraBindingProps(props));
    },
    getSlotProps() {
      return createCameraViewController(slotProps).getRenderableProps();
    },
    getCursor() {
      return createCameraViewController(slotProps).cursor;
    },
    startAutoRotate(config?: AutoRotateOption | false) {
      bindingManager.startAutoRotate(config);
    },
    stopAutoRotate() {
      bindingManager.stopAutoRotate();
    },
    destroy() {
      unsubscribe();
      bindingManager.setElement(null);
      bindingManager.destroy();
    }
  };
}

export type { CameraComponentProps, CameraSlotProps };
