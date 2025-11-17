/* Isometric camera state + helpers used by scene controllers and UIs. */
import { BASE_TILE } from "./types";

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
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
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

export function createIsometricCamera(initial: Partial<CameraState> = {}): CameraHandle {
  const state: CameraState = {
    zoom: initial.zoom ?? 0.65,
    pan: initial.pan ?? 0,
    tilt: initial.tilt ?? 0,
    rotX: initial.rotX ?? 65,
    rotY: initial.rotY ?? 45,
    depthOffset: initial.depthOffset ?? 20
  };

  function update(next: Partial<CameraState>): void {
    Object.assign(state, next);
  }

  function getStyle(input: CameraStyleInput = {}) {
    const zoom = input.zoom ?? state.zoom;
    const pan = input.pan ?? state.pan;
    const tilt = input.tilt ?? state.tilt;
    const rotX = input.rotX ?? state.rotX;
    const rotY = input.rotY ?? state.rotY;
    const depth = input.depth ?? 0;
    const depthMultiplier = input.dimetric ? 0.5 : 1;
    const depthOffset = depth * state.depthOffset * depthMultiplier;
    const tileSize = BASE_TILE;
    const width = (input.cols ?? 0) * tileSize;
    const height = (input.rows ?? 0) * tileSize;

    return {
      transform: `scale(${zoom}) translateY(${depthOffset}px) translateY(${tilt}px) translateX(${pan}px) rotateX(${rotX}deg) rotate(${rotY}deg)`,
      width: `${width}px`,
      height: `${height}px`
    };
  }

  return { state, update, getStyle };
}
