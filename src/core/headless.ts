import { sceneController, type SceneController } from "../controller/sceneController";
import { createSceneBinding, type SceneStateInput } from "../controller/sceneBindings";
import type { VoxelGrid, ProjectionMode } from "./types";
import { SCENE_CLASS } from "./types";
import {
  DEFAULT_CAMERA_PROPS,
  formatPerspectiveStyle,
  mergeControllerOptions,
  normalizeCameraOptions,
  type CameraControllerInput
} from "../controller/cameraBindings";
import { createInteractiveController } from "./interactiveController";
import type { AutoRotateOption } from "./camera";
export interface HeadlessCameraOptions extends CameraControllerInput {
  element: HTMLElement;
}

export interface HeadlessCameraHandle {
  element: HTMLElement;
  controller: SceneController;
  interactive: boolean;
  setInteractive(value: boolean): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  setPerspective(value: number | boolean | undefined): void;
  destroy(): void;
}

export interface HeadlessSceneOptions extends SceneStateInput {
  element: HTMLElement;
}

export interface HeadlessRenderOptions {
  camera: HeadlessCameraHandle;
  scene: HeadlessSceneOptions;
}

export interface HeadlessRenderHandle {
  setVoxels(voxels: VoxelGrid): void;
  setScene(options: SceneStateInput): void;
  destroy(): void;
}

export function createCamera(options: HeadlessCameraOptions): HeadlessCameraHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessCamera requires an element.");
  }
  const normalized = normalizeCameraOptions(options);
  const controllerConfig = mergeControllerOptions(options);
  const controller = sceneController(controllerConfig);
  element.classList.add(SCENE_CLASS);
  applyPerspective(element, normalized.perspective);
  const interactions = createInteractiveController({
    element,
    controller,
    interactive: normalized.interactive,
    animate: normalized.animate
  });
  const handle: HeadlessCameraHandle = {
    element,
    controller,
    interactive: interactions.interactive,
    setInteractive(value: boolean) {
      interactions.setInteractive(value);
      handle.interactive = interactions.interactive;
    },
    setAnimate(option: AutoRotateOption | false | undefined) {
      interactions.setAnimate(option);
    },
    setPerspective(value: number | boolean | undefined) {
      applyPerspective(element, value);
    },
    destroy() {
      interactions.destroy();
      handle.interactive = false;
    }
  };
  return handle;
}

export function renderScene({ camera, scene }: HeadlessRenderOptions): HeadlessRenderHandle {
  if (scene.element.parentElement !== camera.element) {
    camera.element.appendChild(scene.element);
  }

  const controller = camera.controller;
  const { element, ...state } = scene;
  const binding = createSceneBinding({
    controller,
    element,
    ...state
  });

  const updateCursor = () => {
    if (camera.interactive) {
      camera.element.style.cursor = controller.getCursor();
    }
  };
  const unsubscribeCursor = controller.subscribeCursor(updateCursor);
  updateCursor();

  return {
    setVoxels(voxels: VoxelGrid) {
      binding.update({ voxels });
    },
    setScene(options: SceneStateInput) {
      binding.update(options);
    },
    destroy() {
      unsubscribeCursor();
      binding.destroy();
      camera.destroy();
    }
  };
}

export function createScene(options: HeadlessSceneOptions): HeadlessSceneOptions {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessScene requires an element.");
  }
  return { ...options, element };
}

function applyPerspective(element: HTMLElement, perspective: number | boolean | undefined) {
  const fallback = (DEFAULT_CAMERA_PROPS.perspective as number | undefined) ?? 8000;
  element.style.perspective = formatPerspectiveStyle(perspective, fallback);
}
