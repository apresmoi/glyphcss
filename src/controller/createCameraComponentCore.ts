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

export interface CameraViewState {
  slotProps: CameraSlotProps | null;
  controller: SceneController | null;
  cursor: string;
  ready: boolean;
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

export function resolveCameraView(slotProps: CameraSlotProps | null): CameraViewState {
  const controller = slotProps?.controller ?? null;
  return {
    slotProps,
    controller,
    cursor: slotProps?.cursor ?? "default",
    ready: Boolean(slotProps && controller)
  };
}

export function ensureCameraController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: controller is not ready yet.");
  }
  return controller;
}
