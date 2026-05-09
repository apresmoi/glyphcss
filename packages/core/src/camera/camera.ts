/* Isometric camera state + helpers used by scene controllers and UIs. */
import type { Vec3 } from "../types";

/**
 * Base tile size in CSS pixels. One polycss world unit = BASE_TILE CSS
 * pixels (pre-scale). Used to convert world-coordinate target values to
 * CSS translations in the transform string.
 */
export const BASE_TILE = 50;

export interface AutoRotateConfig {
  axis?: "x" | "y";
  speed?: number;
  pauseOnInteraction?: boolean;
}

export type AutoRotateOption = boolean | number | AutoRotateConfig;

/**
 * World-coordinate camera state (Three.js-style).
 *
 * `target` is the world point that should appear at the viewport centre.
 * Polycss world axes: [0]=X (rows/south), [1]=Y (cols/east), [2]=Z (up).
 *
 * `pan`, `tilt`, and `depthOffset` are gone. Translations now live inside
 * `target` so they happen BEFORE rotations — enabling correct world-space
 * pan at any tilt angle.
 */
export interface CameraState {
  target: Vec3;
  rotX: number;
  rotY: number;
  zoom: number;
}

export interface CameraStyleInput {
  rows?: number;
  cols?: number;
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
  target: [0, 0, 0],
  rotX: 65,
  rotY: 45,
  zoom: 0.65,
};

const CAMERA_PRECISION = 100;

const quantize = (value: number): number =>
  Math.round(value * CAMERA_PRECISION) / CAMERA_PRECISION;

export function createIsometricCamera(initial: Partial<CameraState> = {}): CameraHandle {
  const state: CameraState = {
    target: initial.target ?? [...DEFAULT_CAMERA_STATE.target] as Vec3,
    rotX: initial.rotX ?? DEFAULT_CAMERA_STATE.rotX,
    rotY: initial.rotY ?? DEFAULT_CAMERA_STATE.rotY,
    zoom: initial.zoom ?? DEFAULT_CAMERA_STATE.zoom,
  };

  function update(next: Partial<CameraState>): void {
    if (next.target !== undefined) {
      state.target = [
        quantize(next.target[0]),
        quantize(next.target[1]),
        quantize(next.target[2]),
      ];
    }
    if (next.rotX !== undefined) state.rotX = quantize(next.rotX);
    if (next.rotY !== undefined) state.rotY = quantize(next.rotY);
    if (next.zoom !== undefined) state.zoom = quantize(next.zoom);
  }

  function getStyle(input: CameraStyleInput = {}) {
    const tileSize = BASE_TILE;
    const width = (input.cols ?? 0) * tileSize;
    const height = (input.rows ?? 0) * tileSize;

    // Convert world target to CSS-space translation.
    // Polycss world→CSS mapping: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z.
    // Negate so that the world moves such that `target` ends up at scene origin.
    const [tx, ty, tz] = state.target;
    const cssX = ty * tileSize;  // world Y → CSS X
    const cssY = tx * tileSize;  // world X → CSS Y
    const cssZ = tz * tileSize;  // world Z → CSS Z

    return {
      // translate3d is innermost (applied first) → happens in pre-rotation
      // scene-local frame → world-space pan regardless of tilt/orbit.
      transform: `scale(${state.zoom}) rotateX(${state.rotX}deg) rotate(${state.rotY}deg) translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`,
      width: `${width}px`,
      height: `${height}px`
    };
  }

  return { state, update, getStyle };
}
