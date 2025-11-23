import type { WallsMask } from "../core";
import type { HeadlessCameraHandle } from "../core/headless";
import { DEFAULT_CAMERA_STATE, normalizeInvertMultiplier } from "../core/camera";
import type { AutoRotateOption, CameraState } from "../core/camera";
import type { SceneController, SceneControllerOptions } from "./sceneController";

export const DEFAULT_CAMERA_PROPS = {
  ...DEFAULT_CAMERA_STATE,
  invert: false as boolean | number,
  perspective: 8000,
  interactive: false,
  animate: undefined as AutoRotateOption | false | undefined
};

export interface CameraOptionsInput {
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

export interface CameraControllerInput extends CameraOptionsInput {
  controller?: SceneControllerOptions;
}

export interface NormalizedCameraOptions {
  zoom: number;
  pan: number;
  tilt: number;
  rotX: number;
  rotY: number;
  invert?: boolean | number;
  perspective: number | false | undefined;
  interactive: boolean;
  animate?: AutoRotateOption | false;
}

export function normalizePerspectiveValue(value: number | boolean | undefined): number | false | undefined {
  if (value === false) return false;
  if (typeof value === "number") return value;
  if (value === true) return DEFAULT_CAMERA_PROPS.perspective as number;
  return undefined;
}

export function formatPerspectiveStyle(value: number | boolean | undefined, fallback = 8000): string {
  const normalized = normalizePerspectiveValue(value);
  if (normalized === false) {
    return "none";
  }
  const resolved = typeof normalized === "number" ? normalized : fallback;
  return `${resolved}px`;
}

export function normalizeCameraOptions(options: CameraOptionsInput = {}): NormalizedCameraOptions {
  const perspectiveInput =
    options.perspective === undefined ? DEFAULT_CAMERA_PROPS.perspective : options.perspective;
  return {
    zoom: options.zoom ?? DEFAULT_CAMERA_STATE.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_STATE.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_STATE.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_STATE.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_STATE.rotY,
    invert: options.invert,
    perspective: normalizePerspectiveValue(perspectiveInput),
    interactive: options.interactive ?? DEFAULT_CAMERA_PROPS.interactive,
    animate: options.animate ?? DEFAULT_CAMERA_PROPS.animate
  };
}

export function mergeControllerOptions(options: CameraControllerInput): SceneControllerOptions {
  const base = options.controller ?? {};
  const cameraOverrides = filterUndefined({
    zoom: options.zoom,
    pan: options.pan,
    tilt: options.tilt,
    rotX: options.rotX,
    rotY: options.rotY
  });
  const invertOverride = normalizeInvertMultiplier(options.invert);
  const next: SceneControllerOptions = {
    ...base,
    camera: { ...(base.camera ?? {}), ...cameraOverrides }
  };
  if (invertOverride !== undefined) {
    next.pointerInvert = invertOverride;
  }
  return next;
}

function filterUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(input) as [keyof T, T[keyof T]][]) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

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
  camera: CameraState;
  controller: SceneController;
}

export const CAMERA_HOST_CLASS = "voxcss-camera";

const DEFAULT_INVERT = normalizeInvertMultiplier(DEFAULT_CAMERA_PROPS.invert) ?? 1;

export function syncCameraOptions(
  handle: HeadlessCameraHandle,
  current: NormalizedCameraOptions,
  next: CameraOptionsInput
): NormalizedCameraOptions {
  const controller = handle.controller;
  const nextState = normalizeCameraOptions({ ...current, ...next });
  const cameraUpdate: Partial<CameraState> = {};
  if (nextState.zoom !== current.zoom) cameraUpdate.zoom = nextState.zoom;
  if (nextState.pan !== current.pan) cameraUpdate.pan = nextState.pan;
  if (nextState.tilt !== current.tilt) cameraUpdate.tilt = nextState.tilt;
  if (nextState.rotX !== current.rotX) cameraUpdate.rotX = nextState.rotX;
  if (nextState.rotY !== current.rotY) cameraUpdate.rotY = nextState.rotY;
  if (Object.keys(cameraUpdate).length) {
    controller.updateCamera(cameraUpdate);
  }
  if (nextState.invert !== current.invert) {
    const invertOverride = normalizeInvertMultiplier(nextState.invert);
    controller.setPointerInvert(invertOverride ?? DEFAULT_INVERT);
  }
  if (nextState.interactive !== current.interactive) {
    handle.setInteractive(nextState.interactive);
  }
  if (nextState.perspective !== current.perspective) {
    handle.setPerspective(nextState.perspective);
  }
  if (nextState.animate !== current.animate) {
    handle.setAnimate(nextState.animate);
  }
  return nextState;
}

export function ensureCameraController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: controller is not ready yet.");
  }
  return controller;
}
