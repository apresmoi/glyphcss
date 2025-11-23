import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "./sceneBindings";
import type { SceneController } from "./sceneController";
import { createCamera, type HeadlessCameraHandle } from "../core/headless";
import { normalizeInvertMultiplier, type AutoRotateOption, type CameraState } from "../core/camera";
import { SCENE_CLASS } from "../core/types";

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

export type AttachSceneBindingOptions = Omit<SceneBindingOptions, "element" | "controller"> & {
  controller: SceneController | null;
  element: HTMLElement | null;
};

export function attachSceneBinding(options: AttachSceneBindingOptions): SceneBindingHandle | null {
  const { controller, element, ...rest } = options;
  if (!controller || !element) return null;
  return createSceneBinding({ controller, element, ...rest });
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
  let currentProps: CameraComponentProps = { ...props };
  let animate = currentProps.animate;

  const applySnapshot = () => {
    const controller = handle.controller;
    const cursor = handle.interactive ? controller.getCursor() : "default";
    onSnapshot({
      controller,
      cursor,
      boxStyle: controller.getBoxStyle(),
      walls: controller.getWalls(),
      camera: controller.getCameraState()
    });
    onCursor?.(cursor);
  };

  const unsubscribers = [
    handle.controller.subscribeBoxStyle(applySnapshot),
    handle.controller.subscribeCamera(applySnapshot),
    handle.controller.subscribeWalls(applySnapshot),
    handle.controller.subscribeCursor(applySnapshot)
  ];

  applySnapshot();

  const update = (next: CameraComponentProps) => {
    const merged: CameraComponentProps = { ...currentProps, ...next };
    const controller = handle.controller;
    const cameraUpdate: Partial<CameraState> = {};
    if (merged.zoom !== undefined && merged.zoom !== currentProps.zoom) cameraUpdate.zoom = merged.zoom;
    if (merged.pan !== undefined && merged.pan !== currentProps.pan) cameraUpdate.pan = merged.pan;
    if (merged.tilt !== undefined && merged.tilt !== currentProps.tilt) cameraUpdate.tilt = merged.tilt;
    if (merged.rotX !== undefined && merged.rotX !== currentProps.rotX) cameraUpdate.rotX = merged.rotX;
    if (merged.rotY !== undefined && merged.rotY !== currentProps.rotY) cameraUpdate.rotY = merged.rotY;
    if (Object.keys(cameraUpdate).length) {
      controller.updateCamera(cameraUpdate);
    }
    if (merged.invert !== currentProps.invert) {
      const invertOverride = normalizeInvertMultiplier(merged.invert);
      controller.setPointerInvert(invertOverride ?? normalizeInvertMultiplier(false) ?? 1);
    }
    if (merged.interactive !== undefined && merged.interactive !== handle.interactive) {
      handle.setInteractive(!!merged.interactive);
    }
    if (merged.perspective !== undefined && merged.perspective !== currentProps.perspective) {
      handle.setPerspective(merged.perspective);
    }
    if (merged.animate !== undefined && merged.animate !== currentProps.animate) {
      handle.setAnimate(merged.animate);
    }
    currentProps = merged;
    animate = merged.animate;
    applySnapshot();
  };

  const startAutoRotate = (config?: AutoRotateOption) => {
    const next = config ?? animate;
    update({ animate: next });
  };

  const stopAutoRotate = () => {
    update({ animate: false });
  };

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

const DEFAULT_INVERT = normalizeInvertMultiplier(false) ?? 1;
