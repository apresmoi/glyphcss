import { createCameraComponent } from "./createCameraComponent";
import { useCameraBinding } from "./useBindings";

export const VoxCamera = createCameraComponent({
  useBinding: useCameraBinding
});

export type {
  ReactCameraComponentProps as VoxCameraProps,
  VoxCameraHandle,
  CameraRenderContext
} from "./createCameraComponent";
