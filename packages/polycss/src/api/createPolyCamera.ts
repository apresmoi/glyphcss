/**
 * createPolyPerspectiveCamera / createPolyOrthographicCamera —
 * vanilla camera factories for polycss.
 *
 * These are thin wrappers around `createIsometricCamera` (core) that
 * tag the camera type and provide CSS perspective information. They mirror
 * the React/Vue `PolyPerspectiveCamera` / `PolyOrthographicCamera` components.
 *
 * The returned handle extends `CameraHandle` with a `perspectiveStyle`
 * getter so callers can apply it to the container element without
 * reaching into the internals.
 */
import { createIsometricCamera } from "@layoutit/polycss-core";
import type { CameraHandle, CameraState, CameraStyleInput, Vec3 } from "@layoutit/polycss-core";

const DEFAULT_PERSPECTIVE = 8000;

export interface PolyCameraOptions {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
}

export interface PolyPerspectiveCameraOptions extends PolyCameraOptions {
  /** CSS perspective distance in pixels. Default 8000. */
  perspective?: number;
}

export interface PolyOrthographicCameraOptions extends PolyCameraOptions {}

/** Extends CameraHandle with projection info for the container element. */
export interface PolyPerspectiveCameraHandle extends CameraHandle {
  readonly type: "perspective";
  /** CSS `perspective` value to set on the camera container element. */
  readonly perspectiveStyle: string;
}

export interface PolyOrthographicCameraHandle extends CameraHandle {
  readonly type: "orthographic";
  /** CSS `perspective` value to set on the camera container element ("none"). */
  readonly perspectiveStyle: "none";
}

/**
 * Creates a perspective camera handle. The `perspectiveStyle` property
 * returns the CSS value to apply to the camera container's `perspective`
 * property (default `"8000px"`).
 */
export function createPolyPerspectiveCamera(
  options: PolyPerspectiveCameraOptions = {},
): PolyPerspectiveCameraHandle {
  const initial: Partial<CameraState> = {};
  if (options.zoom !== undefined) initial.zoom = options.zoom;
  if (options.target !== undefined) initial.target = options.target;
  if (options.rotX !== undefined) initial.rotX = options.rotX;
  if (options.rotY !== undefined) initial.rotY = options.rotY;
  if (options.distance !== undefined) initial.distance = options.distance;

  const inner: CameraHandle = createIsometricCamera(initial);
  const perspectiveValue = `${options.perspective ?? DEFAULT_PERSPECTIVE}px`;

  return {
    get state() { return inner.state; },
    update(next: Partial<CameraState>): void { inner.update(next); },
    getStyle(input?: CameraStyleInput) { return inner.getStyle(input); },
    type: "perspective" as const,
    perspectiveStyle: perspectiveValue,
  };
}

/**
 * Creates an orthographic camera handle. The `perspectiveStyle` property
 * returns `"none"` — pass it to the container element's CSS `perspective`
 * to disable perspective projection.
 */
export function createPolyOrthographicCamera(
  options: PolyOrthographicCameraOptions = {},
): PolyOrthographicCameraHandle {
  const initial: Partial<CameraState> = {};
  if (options.zoom !== undefined) initial.zoom = options.zoom;
  if (options.target !== undefined) initial.target = options.target;
  if (options.rotX !== undefined) initial.rotX = options.rotX;
  if (options.rotY !== undefined) initial.rotY = options.rotY;
  if (options.distance !== undefined) initial.distance = options.distance;

  const inner: CameraHandle = createIsometricCamera(initial);

  return {
    get state() { return inner.state; },
    update(next: Partial<CameraState>): void { inner.update(next); },
    getStyle(input?: CameraStyleInput) { return inner.getStyle(input); },
    type: "orthographic" as const,
    perspectiveStyle: "none" as const,
  };
}
