import { createCamera } from "../core/headless";
import type { AutoRotateOption, CameraState } from "../core/camera";
import type { WallsMask } from "../core";
import type { HeadlessCameraHandle } from "../core/headless";
import type { ControllerControls, SceneController } from "./createSceneController";
import { normalizePerspectiveValue, resolveInvertMultiplier } from "./cameraUtils";
import { DEFAULT_CAMERA_PROPS } from "./defaults";

export interface CameraBindingOptions {
  element: HTMLElement;
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  invert?: boolean | number;
  perspective?: number | boolean;
  interactive?: boolean;
  animate?: AutoRotateOption;
}

export interface CameraRenderSnapshot {
  boxStyle: Record<string, string>;
  camera: CameraState;
  walls: WallsMask;
  cursor: string;
}

type RenderListener = (snapshot: CameraRenderSnapshot) => void;

export interface CameraBindingHandle {
  controller: SceneController;
  subscribe(listener: RenderListener): () => void;
  getSnapshot(): CameraRenderSnapshot;
  updateCamera(next: Partial<CameraState>): void;
  setControls(next: Partial<ControllerControls>): void;
  setInteractive(value: boolean): void;
  setPerspective(value: number | boolean | undefined): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  destroy(): void;
}

export function createCameraBinding(options: CameraBindingOptions): CameraBindingHandle {
  const {
    element,
    zoom,
    pan,
    tilt,
    rotX,
    rotY,
    invert,
    perspective = DEFAULT_CAMERA_PROPS.perspective,
    interactive = DEFAULT_CAMERA_PROPS.interactive,
    animate = DEFAULT_CAMERA_PROPS.animate
  } = options;
  if (!element) {
    throw new Error("voxcss: createCameraBinding requires an element.");
  }
  const cameraHandle: HeadlessCameraHandle = createCamera({
    element,
    interactive,
    perspective: normalizePerspectiveValue(perspective),
    zoom,
    pan,
    tilt,
    rotX,
    rotY,
    invert,
    animate
  });
  const controller = cameraHandle.controller;
  if (invert !== undefined) {
    controller.setControls({ invert: resolveInvertMultiplier(invert) });
  }

  let interactiveState = interactive;
  const listeners = new Set<RenderListener>();
  let snapshot = buildSnapshot(controller, interactiveState);

  const notify = () => {
    snapshot = buildSnapshot(controller, interactiveState);
    listeners.forEach((listener) => listener(snapshot));
  };

  const unsubscribeBox = controller.subscribeBoxStyle(() => notify());
  const unsubscribeCamera = controller.subscribeCamera(() => notify());
  const unsubscribeWalls = controller.subscribeWalls(() => notify());
  const unsubscribeCursor = controller.subscribeCursor(() => notify());

  function subscribe(listener: RenderListener) {
    listeners.add(listener);
    listener(snapshot);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return snapshot;
  }

  function updateCamera(next: Partial<CameraState>) {
    controller.updateCamera(next);
  }

  function setControls(next: Partial<ControllerControls>) {
    controller.setControls(next);
  }

  function setInteractive(value: boolean) {
    interactiveState = value;
    cameraHandle.setInteractive(value);
    notify();
  }

  function setPerspective(value: number | boolean | undefined) {
    cameraHandle.setPerspective(normalizePerspectiveValue(value));
  }

  function setAnimate(option: AutoRotateOption | false | undefined) {
    cameraHandle.setAnimate(option);
  }

  function destroy() {
    unsubscribeBox();
    unsubscribeCamera();
    unsubscribeWalls();
    unsubscribeCursor();
    cameraHandle.destroy();
    listeners.clear();
  }

  return {
    controller,
    subscribe,
    getSnapshot,
    updateCamera,
    setControls,
    setInteractive,
    setPerspective,
    setAnimate,
    destroy
  };
}

function buildSnapshot(controller: SceneController, interactive: boolean): CameraRenderSnapshot {
  return {
    boxStyle: controller.getBoxStyle(),
    camera: controller.getCameraState(),
    walls: controller.getWalls(),
    cursor: interactive ? controller.getCursor() : "default"
  };
}
