/* Isometric camera state + helpers used by scene controllers and UIs. */
import { BASE_TILE } from "./types";

export interface AutoRotateConfig {
  axis?: "x" | "y";
  speed?: number;
  pauseOnInteraction?: boolean;
}

export type AutoRotateOption = boolean | number | AutoRotateConfig;

export interface CameraState {
  zoom: number;
  pan: number;
  tilt: number;
  rotX: number;
  rotY: number;
  depthOffset: number;
}

export interface CameraStyleInput {
  depth?: number;
  rows?: number;
  cols?: number;
  dimetric?: boolean;
}

export interface CameraHandle {
  state: CameraState;
  update(next: Partial<CameraState>): void;
  getStyle(input?: CameraStyleInput): {
    transform: string;
    width: string;
    height: string;
  };
}

export function normalizeInvertMultiplier(value: number | boolean | undefined): number | undefined {
  if (typeof value === "number") {
    if (value === 0) return undefined;
    return value < 0 ? -1 : 1;
  }
  if (typeof value === "boolean") {
    return value ? -1 : 1;
  }
  return undefined;
}

export const DEFAULT_CAMERA_STATE: CameraState = {
  zoom: 0.65,
  pan: 0,
  tilt: 0,
  rotX: 65,
  rotY: 45,
  depthOffset: 20
};

export function createIsometricCamera(initial: Partial<CameraState> = {}): CameraHandle {
  const state: CameraState = {
    zoom: initial.zoom ?? DEFAULT_CAMERA_STATE.zoom,
    pan: initial.pan ?? DEFAULT_CAMERA_STATE.pan,
    tilt: initial.tilt ?? DEFAULT_CAMERA_STATE.tilt,
    rotX: initial.rotX ?? DEFAULT_CAMERA_STATE.rotX,
    rotY: initial.rotY ?? DEFAULT_CAMERA_STATE.rotY,
    depthOffset: initial.depthOffset ?? DEFAULT_CAMERA_STATE.depthOffset
  };

  function update(next: Partial<CameraState>): void {
    Object.assign(state, next);
  }

  function getStyle(input: CameraStyleInput = {}) {
    const depth = input.depth ?? 0;
    const depthMultiplier = input.dimetric ? 0.5 : 1;
    const depthOffset = depth * state.depthOffset * depthMultiplier;
    const tileSize = BASE_TILE;
    const width = (input.cols ?? 0) * tileSize;
    const height = (input.rows ?? 0) * tileSize;

    return {
      transform: `scale(${state.zoom}) translateY(${depthOffset}px) translateY(${state.tilt}px) translateX(${state.pan}px) rotateX(${state.rotX}deg) rotate(${state.rotY}deg)`,
      width: `${width}px`,
      height: `${height}px`
    };
  }

  return { state, update, getStyle };
}
