import { createCamera } from "../core/headless";
import type { AutoRotateOption, CameraState } from "../core/camera";
import type { WallsMask } from "../core";
import type { HeadlessCameraHandle } from "../core/headless";
import type { SceneController } from "./createSceneController";
import { resolveInvertMultiplier, normalizePerspectiveValue } from "./cameraUtils";
import { DEFAULT_CAMERA_PROPS } from "./defaults";
import { normalizeCameraOptions } from "./cameraOptions";

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
  animate?: AutoRotateOption | false;
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
  setAnimate(option: AutoRotateOption | false | undefined): void;
  destroy(): void;
}

const DEFAULT_INVERT = resolveInvertMultiplier(DEFAULT_CAMERA_PROPS.invert) ?? 1;

export function createCameraBinding(options: CameraBindingOptions): CameraBindingHandle {
  const { element, ...rest } = options;
  if (!element) {
    throw new Error("voxcss: createCameraBinding requires an element.");
  }
  let current = normalizeCameraOptions(rest);
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
  const initialInvert = resolveInvertMultiplier(current.invert);
  if (initialInvert !== undefined) {
    controller.setControls({ invert: initialInvert });
  }

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
    const nextState = normalizeCameraOptions({ ...current, ...next });
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
      const invertOverride = resolveInvertMultiplier(nextState.invert);
      controller.setControls({ invert: invertOverride ?? DEFAULT_INVERT });
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
