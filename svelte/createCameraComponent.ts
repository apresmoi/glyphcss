import type { SceneController } from "@voxcss/controller/createSceneController";
import type { CameraBindingHandle, CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  resolveCameraSlotProps,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
import type { CameraBindingActionOptions } from "./bindings";

interface CameraComponentState {
  controller: SceneController | null;
  handle: CameraBindingHandle | null;
  snapshot: CameraRenderSnapshot | null;
  animate?: AutoRotateOption | false;
}

export interface SvelteCameraComponentConfig {
  onControllerReady(controller: SceneController): void;
}

export interface SvelteCameraComponentInstance {
  className: string;
  buildBindingOptions(props: CameraComponentProps): CameraBindingActionOptions;
  getSlotProps(): CameraSlotProps | null;
  getCursor(): string;
  startAutoRotate(config?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
}

export function createCameraComponent(config: SvelteCameraComponentConfig): SvelteCameraComponentInstance {
  const state: CameraComponentState = {
    controller: null,
    handle: null,
    snapshot: null
  };

  const buildBindingOptions = (props: CameraComponentProps): CameraBindingActionOptions => {
    state.animate = props.animate;
    const options = createCameraBindingProps(props);
    return {
      ...options,
      onSnapshot(next) {
        state.snapshot = next;
      },
      onController(next) {
        state.controller = next;
        if (next) {
          config.onControllerReady(next);
        }
      },
      onHandle(next) {
        state.handle = next;
      }
    };
  };

  const getSlotProps = () => resolveCameraSlotProps(state.controller, state.snapshot);

  return {
    className: CAMERA_HOST_CLASS,
    buildBindingOptions,
    getSlotProps,
    getCursor() {
      return getSlotProps()?.cursor ?? "default";
    },
    startAutoRotate(config?: AutoRotateOption | false) {
      const option = config ?? state.animate;
      state.handle?.setAnimate(option);
    },
    stopAutoRotate() {
      state.handle?.setAnimate(false);
    }
  };
}

export type { CameraComponentProps, CameraSlotProps };
