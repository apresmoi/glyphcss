import type { ProjectionMode } from "../core";
import type { AutoRotateOption } from "../core/camera";

export const DEFAULT_CAMERA_PROPS = {
  zoom: 0.65,
  pan: 0,
  tilt: 0,
  rotX: 65,
  rotY: 45,
  invert: false as boolean | number,
  perspective: 8000,
  interactive: false,
  animate: undefined as AutoRotateOption | undefined
};

export const DEFAULT_SCENE_FLAGS = {
  showWalls: false,
  showFloor: false,
  projection: "cubic" as ProjectionMode
};
