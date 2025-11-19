import {
  createSceneController,
  type ControllerControls,
  type SceneController,
  type SceneControllerOptions
} from "../controller/createSceneController";
import { createSceneHost, type SceneHost } from "../controller/createSceneHost";
import { createAutoRotateHandle, type AutoRotateHandle } from "../controller/autoRotate";
import { buildSceneContext, inferGridDimensions } from "./context";
import { attachPointerEvents } from "./pointerEvents";
import type { AutoRotateOption } from "./camera";
import type { SceneDimensions, VoxelGrid, ProjectionMode, SceneOptions } from "./types";
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
  animate?: AutoRotateOption;
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
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
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
  return {
    element,
    voxels: options.voxels ?? [],
    rows: options.rows,
    cols: options.cols,
    depth: options.depth,
    showWalls: options.showWalls ?? false,
    showFloor: options.showFloor ?? false,
    projection: options.projection ?? "cubic",
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
    const projection = scene.projection ?? "cubic";
    controller.setProjection?.(projection);
    const analysis = buildSceneContext({
      grid: currentVoxels,
      context: {
        rows: dims.rows,
        cols: dims.cols,
        depth: dims.depth,
        showWalls: scene.showWalls,
        showFloor: scene.showFloor,
        projection,
        walls: controller.getWalls(),
        rotX: cameraState.rotX,
        rotY: cameraState.rotY
      },
      dimensions: dims
    });
    return analysis.snapshot;
  };

  scene.host.mount(scene.element, currentVoxels, buildContext());
  scene.host.syncController(controller, buildContext);
  patchSceneOptions(scene, (key) => {
    if (key === "projection") {
      controller.setProjection?.(scene.projection ?? "cubic");
    }
    scene.host.setState({ context: buildContext() });
    scene.host.flush();
  });

  const unsubscribeBox = controller.subscribeBoxStyle((style) => Object.assign(scene.element.style, style));
  const updateContextFromDimensions = () => {
    scene.host.setState({ context: buildContext() });
    scene.host.flush();
  };
  const unsubscribeDimensions = controller.subscribeDimensions(updateContextFromDimensions);
  const updateCursor = () => {
    if (camera.interactive) {
      camera.element.style.cursor = controller.getCursor();
    }
  };
  const unsubscribeCamera = controller.subscribeCamera(updateCursor);
  updateCursor();

  return {
    setVoxels(voxels: VoxelGrid) {
      currentVoxels = voxels;
      if (!applyExplicitDimensions) {
        controller.setDimensions(inferGridDimensions(voxels));
      }
      scene.host.setState({ voxels, context: buildContext() });
      scene.host.flush();
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

type ReactiveSceneOption = "showWalls" | "showFloor" | "projection";

function patchSceneOptions(scene: HeadlessSceneHandle, onChange: (key: ReactiveSceneOption) => void): void {
  const keys: ReactiveSceneOption[] = ["showWalls", "showFloor", "projection"];
  for (const key of keys) {
    let value = scene[key];
    Object.defineProperty(scene, key, {
      configurable: true,
      enumerable: true,
      get() {
        return value;
      },
      set(next) {
        if (value === next) return;
        value = next as typeof value;
        onChange(key);
      }
    });
  }
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
    invert: normalizeInvert(options.invert)
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
