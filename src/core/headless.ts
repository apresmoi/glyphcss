import { createSceneController, type ControllerControls, type SceneController } from "../controller/createSceneController";
import { createSceneHost, type SceneHost } from "../controller/createSceneHost";
import type { SceneSessionHandle, SceneSessionState } from "../controller/createSceneSession";
import { createAutoRotateHandle, type AutoRotateHandle } from "../controller/autoRotate";
import { attachPointerEvents } from "./pointerEvents";
import type { AutoRotateOption } from "./camera";
import type { VoxelGrid, ProjectionMode, SceneOptions } from "./types";
import { SCENE_CLASS } from "./types";
import { DEFAULT_CAMERA_PROPS } from "../controller/defaults";
import { formatPerspectiveStyle } from "../controller/cameraUtils";
import { createSceneBinding, type SceneBindingHandle } from "../controller/createSceneBinding";
import { mergeControllerOptions, normalizeCameraOptions } from "../controller/cameraOptions";
import { normalizeSceneState, type NormalizedSceneState, extractSceneState } from "../controller/sceneOptions";
import type { CameraControllerInput } from "../controller/cameraOptions";

export interface HeadlessCameraOptions extends CameraControllerInput {
  element: HTMLElement;
}

export interface HeadlessCameraHandle {
  element: HTMLElement;
  controller: SceneController;
  interactive: boolean;
  autoRotate?: AutoRotateHandle | null;
  setInteractive(value: boolean): void;
  setPerspective(value: number | boolean | undefined): void;
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

interface InternalSceneState {
  session: SceneSessionHandle | null;
  binding: SceneBindingHandle | null;
}

const SCENE_STATE = new WeakMap<HeadlessSceneHandle, InternalSceneState>();

function getInternalSceneState(scene: HeadlessSceneHandle): InternalSceneState {
  const state = SCENE_STATE.get(scene);
  if (!state) {
    throw new Error("voxcss: unknown headless scene handle.");
  }
  return state;
}

export function createCamera(options: HeadlessCameraOptions): HeadlessCameraHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessCamera requires an element.");
  }
  const normalized = normalizeCameraOptions(options);
  let interactive = normalized.interactive;
  const controllerConfig = mergeControllerOptions(options);
  const controller = createSceneController(controllerConfig);
  let autoRotate = createAutoRotateHandle(controller, normalized.animate);
  element.classList.add(SCENE_CLASS);
  applyPerspective(element, normalized.perspective);
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
    setPerspective(value: number | boolean | undefined) {
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
  let state: NormalizedSceneState = normalizeSceneState(options);
  const internalState: InternalSceneState = {
    session: null,
    binding: null
  };

  const syncBinding = () => {
    internalState.binding?.update(extractSceneState(state));
  };

  const handle: HeadlessSceneHandle = {
    element,
    host,
    getState() {
      return { ...state };
    },
    setOptions(next) {
      state = {
        ...state,
        ...next,
        ...normalizeSceneState(next, state)
      };
      syncBinding();
    },
    setVoxels(voxels: VoxelGrid) {
      state = { ...state, voxels };
      internalState.binding?.update({ voxels });
    },
    destroy() {
      internalState.binding?.destroy();
      internalState.binding = null;
      internalState.session = null;
      host.destroy();
      SCENE_STATE.delete(handle);
    }
  };

  SCENE_STATE.set(handle, internalState);
  return handle;
}

export function renderScene({ camera, scene }: HeadlessRenderOptions): HeadlessRenderHandle {
  if (scene.element.parentElement !== camera.element) {
    camera.element.appendChild(scene.element);
  }

  const controller = camera.controller;
  const sceneState = scene.getState();
  const internalSceneState = getInternalSceneState(scene);

  const binding = createSceneBinding({
    controller,
    element: scene.element,
    host: scene.host,
    ...extractSceneState(sceneState),
    onSessionChange: (next) => {
      internalSceneState.session = next;
    }
  });
  internalSceneState.binding = binding;
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

function applyPerspective(element: HTMLElement, perspective: number | boolean | undefined) {
  const fallback = (DEFAULT_CAMERA_PROPS.perspective as number | undefined) ?? 8000;
  element.style.perspective = formatPerspectiveStyle(perspective, fallback);
}
