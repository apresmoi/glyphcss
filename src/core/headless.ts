import {
  createSceneController,
  type ControllerControls,
  type SceneController,
  type SceneControllerOptions
} from "../controller/createSceneController";
import { createSceneHost, type SceneHost, type SceneHostOptions } from "../controller/createSceneHost";
import { createAutoRotateHandle, type AutoRotateHandle } from "../controller/autoRotate";
import { inferGridDimensions } from "./context";
import type { AutoRotateOption } from "./camera";
import type { SceneDimensions, VoxelGrid } from "./types";
import { SCENE_CLASS } from "./types";

const DEFAULT_PERSPECTIVE = 8000;

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
  dragSpeed?: number;
  animate?: AutoRotateOption;
}

export interface HeadlessCameraHandle {
  element: HTMLElement;
  controller: SceneController;
  interactive: boolean;
  autoRotate?: AutoRotateHandle | null;
  destroy(): void;
}

export interface HeadlessSceneOptions {
  element: HTMLElement;
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  host?: SceneHostOptions;
}

export interface HeadlessSceneHandle {
  element: HTMLElement;
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls: boolean;
  showFloor: boolean;
  host: SceneHost;
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
  const interactive = options.interactive !== false;
  const controllerConfig = mergeControllerOptions(options);
  const controller = createSceneController(controllerConfig);
  const autoRotate = createAutoRotateHandle(controller, options.animate);
  element.classList.add(SCENE_CLASS);
  applyPerspective(element, options.perspective);
  const detachPointer = interactive
    ? attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction())
    : null;
  autoRotate?.start();
  return {
    element,
    controller,
    interactive,
    autoRotate,
    destroy() {
      detachPointer?.();
      autoRotate?.stop();
    }
  };
}

export function createScene(options: HeadlessSceneOptions): HeadlessSceneHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessScene requires an element.");
  }
  const host = createSceneHost(options.host);
  return {
    element,
    voxels: options.voxels ?? [],
    rows: options.rows,
    cols: options.cols,
    depth: options.depth,
    showWalls: options.showWalls ?? false,
    showFloor: options.showFloor ?? false,
    host,
    destroy() {
      host.destroy();
    }
  };
}

export function renderScene({ camera, scene }: HeadlessRenderOptions): HeadlessRenderHandle {
  if (scene.element.parentElement !== camera.element) {
    camera.element.appendChild(scene.element);
  }

  let currentVoxels = scene.voxels;
  const controller = camera.controller;

  const applyExplicitDimensions = scene.rows !== undefined || scene.cols !== undefined || scene.depth !== undefined;
  if (applyExplicitDimensions) {
    controller.setDimensions({
      rows: scene.rows ?? controller.getDimensions().rows,
      cols: scene.cols ?? controller.getDimensions().cols,
      depth: scene.depth ?? controller.getDimensions().depth
    });
  } else if (currentVoxels.length) {
    controller.setDimensions(inferGridDimensions(currentVoxels));
  }

  const buildContext = () => {
    const dims = controller.getDimensions();
    const cameraState = controller.getCameraState();
    return {
      rows: scene.rows ?? dims.rows,
      cols: scene.cols ?? dims.cols,
      depth: scene.depth ?? dims.depth,
      rotX: cameraState.rotX,
      rotY: cameraState.rotY,
      showWalls: scene.showWalls,
      showFloor: scene.showFloor,
      walls: controller.getWalls()
    };
  };

  scene.host.mount(scene.element, currentVoxels, buildContext());

  const unsubscribeBox = controller.subscribeBoxStyle((style) => Object.assign(scene.element.style, style));
  const syncContext = () => {
    scene.host.updateContext(buildContext());
    if (camera.interactive) {
      camera.element.style.cursor = controller.getCursor();
    }
  };
  const unsubscribeCamera = controller.subscribeCamera(syncContext);
  const unsubscribeDimensions = controller.subscribeDimensions(syncContext);
  syncContext();

  return {
    setVoxels(voxels: VoxelGrid) {
      currentVoxels = voxels;
      if (!applyExplicitDimensions) {
        controller.setDimensions(inferGridDimensions(voxels));
      }
      scene.host.update(voxels, buildContext());
    },
    destroy() {
      unsubscribeBox();
      unsubscribeCamera();
      unsubscribeDimensions();
      scene.host.destroy();
      camera.destroy();
    }
  };
}

function mergeControllerOptions(options: HeadlessCameraOptions): SceneControllerOptions {
  const base = options.controller ?? {};
  const cameraOverrides = filterUndefined({
    zoom: options.zoom,
    pan: options.pan,
    tilt: options.tilt,
    rotX: options.rotX,
    rotY: options.rotY
  });
  const controlsOverrides = filterUndefined<Partial<ControllerControls>>({
    invert: normalizeInvert(options.invert),
    dragSpeed: options.dragSpeed
  });
  return {
    ...base,
    camera: { ...(base.camera ?? {}), ...cameraOverrides },
    controls: { ...(base.controls ?? {}), ...controlsOverrides }
  };
}

function applyPerspective(element: HTMLElement, perspective: number | false | undefined) {
  if (perspective === false) {
    element.style.perspective = "none";
    return;
  }
  const value = typeof perspective === "number" ? perspective : DEFAULT_PERSPECTIVE;
  element.style.perspective = `${value}px`;
}

function attachPointerEvents(
  element: HTMLElement,
  controller: SceneController,
  onInteraction?: () => void
) {
  const handlePointerDown = (event: PointerEvent) => {
    onInteraction?.();
    controller.handlePointerDown(event);
    element.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => controller.handlePointerMove(event);
  const handlePointerUp = (event: PointerEvent) => {
    controller.handlePointerUp();
    element.releasePointerCapture?.(event.pointerId);
  };
  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handlePointerMove);
  element.addEventListener("pointerup", handlePointerUp);
  element.addEventListener("pointerleave", handlePointerUp);
  return () => {
    element.removeEventListener("pointerdown", handlePointerDown);
    element.removeEventListener("pointermove", handlePointerMove);
    element.removeEventListener("pointerup", handlePointerUp);
    element.removeEventListener("pointerleave", handlePointerUp);
  };
}

function normalizeInvert(value?: boolean | number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (value === 0) return undefined;
    return value < 0 ? -1 : 1;
  }
  return value ? -1 : 1;
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
