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
  setOptions(options: Partial<Omit<CameraBindingOptions, "element">>): void;
  updateCamera(next: Partial<CameraState>): void;
  setControls(next: Partial<ControllerControls>): void;
  setInteractive(value: boolean): void;
  setPerspective(value: number | boolean | undefined): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  destroy(): void;
}

type CameraBindingConfig = Omit<CameraBindingOptions, "element">;

interface CameraBindingState {
  zoom: number;
  pan: number;
  tilt: number;
  rotX: number;
  rotY: number;
  invert: boolean | number | undefined;
  perspective: number | boolean | undefined;
  interactive: boolean;
  animate: AutoRotateOption | false | undefined;
}

function normalizeOptions(options: CameraBindingConfig): CameraBindingState {
  return {
    zoom: options.zoom ?? DEFAULT_CAMERA_PROPS.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_PROPS.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_PROPS.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_PROPS.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_PROPS.rotY,
    invert: options.invert ?? DEFAULT_CAMERA_PROPS.invert,
    perspective: options.perspective ?? DEFAULT_CAMERA_PROPS.perspective,
    interactive: options.interactive ?? DEFAULT_CAMERA_PROPS.interactive,
    animate: options.animate ?? DEFAULT_CAMERA_PROPS.animate
  };
}

export function createCameraBinding(options: CameraBindingOptions): CameraBindingHandle {
  const { element, ...rest } = options;
  if (!element) {
    throw new Error("voxcss: createCameraBinding requires an element.");
  }
  let current = normalizeOptions(rest);
  const cameraHandle: HeadlessCameraHandle = createCamera({
    element,
    interactive: current.interactive,
    perspective: normalizePerspectiveValue(current.perspective),
    zoom: current.zoom,
    pan: current.pan,
    tilt: current.tilt,
    rotX: current.rotX,
    rotY: current.rotY,
    invert: current.invert,
    animate: current.animate
  });
  const controller = cameraHandle.controller;
  controller.setControls({ invert: resolveInvertMultiplier(current.invert) });

  let interactiveState = current.interactive;
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

  function setOptions(next: Partial<Omit<CameraBindingOptions, "element">>) {
    const nextState = normalizeOptions({ ...current, ...next });
    const cameraUpdate: Partial<CameraState> = {};
    if (nextState.zoom !== current.zoom) cameraUpdate.zoom = nextState.zoom;
    if (nextState.pan !== current.pan) cameraUpdate.pan = nextState.pan;
    if (nextState.tilt !== current.tilt) cameraUpdate.tilt = nextState.tilt;
    if (nextState.rotX !== current.rotX) cameraUpdate.rotX = nextState.rotX;
    if (nextState.rotY !== current.rotY) cameraUpdate.rotY = nextState.rotY;
    if (Object.keys(cameraUpdate).length) {
      controller.updateCamera(cameraUpdate);
    }
    if (nextState.invert !== current.invert) {
      controller.setControls({ invert: resolveInvertMultiplier(nextState.invert) });
    }
    if (nextState.interactive !== current.interactive) {
      interactiveState = nextState.interactive;
      cameraHandle.setInteractive(nextState.interactive);
      notify();
    }
    if (nextState.perspective !== current.perspective) {
      cameraHandle.setPerspective(normalizePerspectiveValue(nextState.perspective));
    }
    if (nextState.animate !== current.animate) {
      cameraHandle.setAnimate(nextState.animate);
    }
    current = nextState;
  }

  function updateCamera(next: Partial<CameraState>) {
    setOptions(next);
  }

  function setControls(next: Partial<ControllerControls>) {
    if (next.invert !== undefined) {
      setOptions({ invert: next.invert });
    }
  }

  function setInteractive(value: boolean) {
    setOptions({ interactive: value });
  }

  function setPerspective(value: number | boolean | undefined) {
    setOptions({ perspective: value });
  }

  function setAnimate(option: AutoRotateOption | false | undefined) {
    setOptions({ animate: option });
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
    setOptions,
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
