import type { SceneControllerOptions } from "./createSceneController";
import type { CameraBindingOptions } from "./createCameraBinding";
import type { HeadlessCameraOptions } from "../core/headless";
import { DEFAULT_CAMERA_PROPS } from "./defaults";
import { normalizePerspectiveValue, resolveInvertMultiplier } from "./cameraUtils";

export interface NormalizedCameraOptions {
  zoom: number;
  pan: number;
  tilt: number;
  rotX: number;
  rotY: number;
  invert?: boolean | number;
  perspective?: number | boolean;
  interactive: boolean;
  animate?: CameraBindingOptions["animate"];
}

export function normalizeCameraOptions(
  options: Partial<Omit<CameraBindingOptions, "element">>
): NormalizedCameraOptions {
  return {
    zoom: options.zoom ?? DEFAULT_CAMERA_PROPS.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_PROPS.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_PROPS.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_PROPS.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_PROPS.rotY,
    invert: options.invert,
    perspective: options.perspective ?? DEFAULT_CAMERA_PROPS.perspective,
    interactive: options.interactive ?? DEFAULT_CAMERA_PROPS.interactive,
    animate: options.animate ?? DEFAULT_CAMERA_PROPS.animate
  };
}

export function mergeControllerOptions(options: HeadlessCameraOptions): SceneControllerOptions {
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
