import type { SceneControllerOptions } from "./createSceneController";
import type { AutoRotateOption } from "../core/camera";
import { DEFAULT_CAMERA_PROPS } from "./defaults";
import { normalizePerspectiveValue, resolveInvertMultiplier } from "./cameraUtils";

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

export function normalizeCameraOptions(
  options: CameraOptionsInput = {}
): NormalizedCameraOptions {
  const perspectiveInput =
    options.perspective === undefined ? DEFAULT_CAMERA_PROPS.perspective : options.perspective;
  return {
    zoom: options.zoom ?? DEFAULT_CAMERA_PROPS.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_PROPS.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_PROPS.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_PROPS.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_PROPS.rotY,
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
  const invertOverride = resolveInvertMultiplier(options.invert);
  const controlsOverrides = filterUndefined({
    invert: invertOverride
  });
  return {
    ...base,
    camera: { ...(base.camera ?? {}), ...cameraOverrides },
    controls: { ...(base.controls ?? {}), ...controlsOverrides }
  };
}

export function resolvePerspective(value: number | boolean | undefined) {
  const normalized = normalizePerspectiveValue(value);
  if (normalized === false) {
    return { css: "none", value: false } as const;
  }
  const resolved = typeof normalized === "number" ? normalized : (DEFAULT_CAMERA_PROPS.perspective as number | undefined) ?? 8000;
  return { css: `${resolved}px`, value: resolved } as const;
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
