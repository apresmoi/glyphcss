import type { SceneController } from "./sceneController";
import { createCamera, type HeadlessCameraHandle } from "../core/headless";
import { normalizeInvertMultiplier, type AutoRotateOption, type CameraState } from "../core/camera";
import { SCENE_CLASS } from "../core/types";
import type { ControllerSnapshot } from "./sceneController";

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
  walls: ReturnType<SceneController["getWalls"]>;
  camera: ReturnType<SceneController["getCameraState"]>;
  controller: SceneController;
}

export const CAMERA_HOST_CLASS = SCENE_CLASS;

export function ensureCameraController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: controller is not ready yet.");
  }
  return controller;
}

export type CameraBindingSnapshot = CameraSlotProps;

export function mountCameraBinding(
  element: HTMLElement,
  props: CameraComponentProps,
  onSnapshot: (snapshot: CameraBindingSnapshot | null) => void,
  onCursor?: (cursor: string) => void
): {
  destroy(): void;
  update(next: CameraComponentProps): void;
  startAutoRotate(config?: AutoRotateOption): void;
  stopAutoRotate(): void;
} {
  const handle = createCamera({ ...props, element });
  const currentProps: CameraComponentProps = { ...props };
  const applySnapshot = (snapshot: ControllerSnapshot) => {
    const controller = handle.controller;
    const cursor = handle.interactive ? snapshot.cursor : "default";
    onSnapshot({
      controller,
      cursor,
      boxStyle: snapshot.style,
      walls: snapshot.walls,
      camera: snapshot.camera
    });
    onCursor?.(cursor);
  };

  const unsubscribers = [handle.controller.subscribeSnapshot(applySnapshot)];

  const update = (next: CameraComponentProps) => {
    const prevProps = { ...currentProps };
    Object.assign(currentProps, next);
    const cameraUpdate: Partial<CameraState> = {};
    if (next.zoom !== undefined && next.zoom !== prevProps.zoom) cameraUpdate.zoom = next.zoom;
    if (next.pan !== undefined && next.pan !== prevProps.pan) cameraUpdate.pan = next.pan;
    if (next.tilt !== undefined && next.tilt !== prevProps.tilt) cameraUpdate.tilt = next.tilt;
    if (next.rotX !== undefined && next.rotX !== prevProps.rotX) cameraUpdate.rotX = next.rotX;
    if (next.rotY !== undefined && next.rotY !== prevProps.rotY) cameraUpdate.rotY = next.rotY;
    if (Object.keys(cameraUpdate).length) handle.controller.updateCamera(cameraUpdate);
    if (next.invert !== undefined && next.invert !== prevProps.invert) {
      const invertOverride = normalizeInvertMultiplier(next.invert);
      handle.controller.setPointerInvert(invertOverride ?? normalizeInvertMultiplier(false) ?? 1);
    }
    if (next.interactive !== undefined && next.interactive !== prevProps.interactive) {
      handle.setInteractive(!!next.interactive);
    }
    if (next.perspective !== undefined && next.perspective !== prevProps.perspective) {
      handle.setPerspective(next.perspective);
    }
    if (next.animate !== undefined && next.animate !== prevProps.animate) {
      handle.setAnimate(next.animate);
    }
  };

  const startAutoRotate = (config?: AutoRotateOption) => update({ animate: config ?? currentProps.animate });
  const stopAutoRotate = () => update({ animate: false });

  const destroy = () => {
    unsubscribers.forEach((dispose) => dispose());
    onSnapshot(null);
    onCursor?.("default");
    handle.destroy();
  };

  return {
    destroy,
    update,
    startAutoRotate,
    stopAutoRotate
  };
}
