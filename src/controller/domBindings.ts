import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "./sceneBindings";
import type { SceneController } from "./sceneController";
import { createCamera, type HeadlessCameraHandle } from "../core/headless";
import { DEFAULT_CAMERA_STATE, normalizeInvertMultiplier, type AutoRotateOption } from "../core/camera";
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

interface NormalizedCameraOptions {
  zoom: number;
  pan: number;
  tilt: number;
  rotX: number;
  rotY: number;
  invert?: boolean | number;
  perspective: number | false;
  interactive: boolean;
  animate?: AutoRotateOption | false;
}

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
  let options = normalizeCameraOptions(props);
  let animate = options.animate;

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
    const current = options;
    options = normalizeCameraOptions({ ...current, ...next });
    const controller = handle.controller;
    const cameraUpdate: Partial<ReturnType<typeof controller.getCameraState>> = {};
    if (options.zoom !== current.zoom) cameraUpdate.zoom = options.zoom;
    if (options.pan !== current.pan) cameraUpdate.pan = options.pan;
    if (options.tilt !== current.tilt) cameraUpdate.tilt = options.tilt;
    if (options.rotX !== current.rotX) cameraUpdate.rotX = options.rotX;
    if (options.rotY !== current.rotY) cameraUpdate.rotY = options.rotY;
    if (Object.keys(cameraUpdate).length) {
      controller.updateCamera(cameraUpdate);
    }
    if (options.invert !== current.invert) {
      const invertOverride = normalizeInvertMultiplier(options.invert);
      controller.setPointerInvert(invertOverride ?? normalizeInvertMultiplier(false) ?? 1);
    }
    if (options.interactive !== current.interactive) {
      handle.setInteractive(options.interactive ?? false);
    }
    if (options.perspective !== current.perspective) {
      handle.setPerspective(options.perspective);
    }
    if (options.animate !== current.animate) {
      handle.setAnimate(options.animate);
    }
    animate = options.animate;
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

const DEFAULT_INTERACTIVE = false;
const DEFAULT_INVERT = normalizeInvertMultiplier(false) ?? 1;

function normalizeCameraOptions(options: CameraComponentProps = {}): NormalizedCameraOptions {
  return {
    zoom: options.zoom ?? DEFAULT_CAMERA_STATE.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_STATE.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_STATE.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_STATE.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_STATE.rotY,
    invert: options.invert,
    perspective: options.perspective === false ? false : typeof options.perspective === "number" ? options.perspective : DEFAULT_PERSPECTIVE_FALLBACK,
    interactive: options.interactive ?? DEFAULT_INTERACTIVE,
    animate: options.animate
  };
}

const DEFAULT_PERSPECTIVE_FALLBACK = 8000;
