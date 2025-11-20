import {
  createSceneController,
  type ControllerControls,
  type SceneController,
  type SceneControllerOptions
} from "../controller/createSceneController";
import { createSceneHost, type SceneHost } from "../controller/createSceneHost";
import type { SceneSessionHandle, SceneSessionState } from "../controller/createSceneSession";
import { createAutoRotateHandle, type AutoRotateHandle } from "../controller/autoRotate";
import { attachPointerEvents } from "./pointerEvents";
import type { AutoRotateOption } from "./camera";
import type { VoxelGrid, ProjectionMode, SceneOptions } from "./types";
import { SCENE_CLASS } from "./types";
import { DEFAULT_CAMERA_PROPS } from "../controller/defaults";
import { normalizePerspectiveValue, resolveInvertMultiplier } from "../controller/cameraUtils";
import { createSceneBinding, type SceneBindingHandle } from "../controller/createSceneBinding";
import { mergeControllerOptions } from "../controller/cameraOptions";

export interface HeadlessCameraOptions {
  element: HTMLElement;
  controller?: SceneControllerOptions;
  perspective?: number | false;
  interactive?: boolean;
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  invert?: boolean | number;
  animate?: AutoRotateOption | false;
}

export interface HeadlessCameraHandle {
  element: HTMLElement;
  controller: SceneController;
  interactive: boolean;
  autoRotate?: AutoRotateHandle | null;
  setInteractive(value: boolean): void;
  setPerspective(value: number | false | undefined): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  destroy(): void;
}

export interface HeadlessSceneOptions extends SceneOptions {
  element: HTMLElement;
  voxels?: VoxelGrid;
}

export interface HeadlessSceneHandle {
  element: HTMLElement;
  host: SceneHost;
  getState(): SceneSessionState;
  setOptions(options: Partial<Omit<SceneSessionState, "voxels">>): void;
  setVoxels(voxels: VoxelGrid): void;
  _getSession(): SceneSessionHandle | null;
  _setSession(session: SceneSessionHandle | null): void;
  _attachBinding?(binding: SceneBindingHandle | null): void;
  destroy(): void;
}

export interface HeadlessRenderOptions {
  camera: HeadlessCameraHandle;
  scene: HeadlessSceneHandle;
}

export interface HeadlessRenderHandle {
  setVoxels(voxels: VoxelGrid): void;
  destroy(): void;
}

export function createCamera(options: HeadlessCameraOptions): HeadlessCameraHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessCamera requires an element.");
  }
  let interactive = options.interactive !== false;
  const controllerConfig = mergeControllerOptions(options);
  const controller = createSceneController(controllerConfig);
  let autoRotate = createAutoRotateHandle(controller, options.animate);
  element.classList.add(SCENE_CLASS);
  applyPerspective(element, options.perspective);
  let detachPointer = interactive
    ? attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction())
    : null;
  autoRotate?.start();
  const handle: HeadlessCameraHandle = {
    element,
    controller,
    interactive,
    autoRotate,
    setInteractive(value: boolean) {
      if (interactive === value) return;
      interactive = value;
      handle.interactive = interactive;
      if (interactive) {
        if (!detachPointer) {
          detachPointer = attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction());
        }
      } else {
        detachPointer?.();
        detachPointer = null;
        element.style.cursor = "default";
      }
    },
    setPerspective(value: number | false | undefined) {
      applyPerspective(element, value);
    },
    setAnimate(option: AutoRotateOption | false | undefined) {
      autoRotate?.stop();
      autoRotate = option === false ? null : createAutoRotateHandle(controller, option);
      handle.autoRotate = autoRotate;
      autoRotate?.start();
    },
    destroy() {
      detachPointer?.();
      autoRotate?.stop();
    }
  };
  return handle;
}

export function createScene(options: HeadlessSceneOptions): HeadlessSceneHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessScene requires an element.");
  }
  const host = createSceneHost();
  let state: SceneSessionState = {
    voxels: options.voxels ?? [],
    rows: options.rows,
    cols: options.cols,
    depth: options.depth,
    showWalls: options.showWalls ?? false,
    showFloor: options.showFloor ?? false,
    projection: options.projection
  };
  let session: SceneSessionHandle | null = null;
  let binding: SceneBindingHandle | null = null;

  const syncBinding = () => {
    binding?.update({
      voxels: state.voxels,
      rows: state.rows,
      cols: state.cols,
      depth: state.depth,
      showWalls: state.showWalls,
      showFloor: state.showFloor,
      projection: state.projection
    });
  };

  return {
    element,
    host,
    getState() {
      return { ...state };
    },
    setOptions(next) {
      state = { ...state, ...next };
      syncBinding();
    },
    setVoxels(voxels: VoxelGrid) {
      state = { ...state, voxels };
      binding?.update({ voxels });
    },
    _getSession() {
      return session;
    },
    _setSession(nextSession: SceneSessionHandle | null) {
      session = nextSession;
    },
    _attachBinding(nextBinding: SceneBindingHandle | null) {
      binding = nextBinding;
    },
    destroy() {
      binding?.destroy();
      binding = null;
      session = null;
      host.destroy();
    }
  };
}

export function renderScene({ camera, scene }: HeadlessRenderOptions): HeadlessRenderHandle {
  if (scene.element.parentElement !== camera.element) {
    camera.element.appendChild(scene.element);
  }

  const controller = camera.controller;
  const sceneState = scene.getState();

  const binding = createSceneBinding({
    controller,
    element: scene.element,
    host: scene.host,
    voxels: sceneState.voxels,
    rows: sceneState.rows,
    cols: sceneState.cols,
    depth: sceneState.depth,
    showWalls: sceneState.showWalls,
    showFloor: sceneState.showFloor,
    projection: sceneState.projection,
    onSessionChange: (next) => scene._setSession(next)
  });
  scene._attachBinding?.(binding);
  binding.mount();

  const updateCursor = () => {
    if (camera.interactive) {
      camera.element.style.cursor = controller.getCursor();
    }
  };
  const unsubscribeCursor = controller.subscribeCursor(updateCursor);
  updateCursor();

  return {
    setVoxels(voxels: VoxelGrid) {
      scene.setVoxels(voxels);
    },
    destroy() {
      unsubscribeCursor();
      scene.destroy();
      camera.destroy();
    }
  };
}

function applyPerspective(element: HTMLElement, perspective: number | false | undefined) {
  const normalized = normalizePerspectiveValue(perspective);
  if (normalized === false) {
    element.style.perspective = "none";
    return;
  }
  const resolved =
    typeof normalized === "number"
      ? normalized
      : (DEFAULT_CAMERA_PROPS.perspective as number | undefined) ?? 8000;
  element.style.perspective = `${resolved}px`;
}

function filterUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(input) as [keyof T, T[keyof T]][]) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}
