import type { WallsMask } from "../core";
import type { AutoRotateOption } from "../core/camera";
import type { CameraBindingOptions, CameraRenderSnapshot } from "./createCameraBinding";
import type { SceneController } from "./createSceneController";

export interface CameraComponentProps {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  invert?: boolean | number;
  perspective?: number | boolean;
  interactive?: boolean;
  animate?: AutoRotateOption | false;
}

export interface CameraSlotProps {
  boxStyle: Record<string, string>;
  cursor: string;
  walls: WallsMask;
  camera: CameraRenderSnapshot["camera"];
  controller: SceneController;
}

export const CAMERA_HOST_CLASS = "voxcss-camera";

export function createCameraBindingProps(props: CameraComponentProps): Omit<CameraBindingOptions, "element"> {
  return {
    zoom: props.zoom,
    pan: props.pan,
    tilt: props.tilt,
    rotX: props.rotX,
    rotY: props.rotY,
    invert: props.invert,
    perspective: props.perspective,
    interactive: props.interactive,
    animate: props.animate
  };
}

export function resolveCameraSlotProps(
  controller: SceneController | null,
  snapshot: CameraRenderSnapshot | null
): CameraSlotProps | null {
  if (!controller || !snapshot) {
    return null;
  }
  return {
    boxStyle: snapshot.boxStyle,
    cursor: snapshot.cursor,
    walls: snapshot.walls,
    camera: snapshot.camera,
    controller
  };
}
