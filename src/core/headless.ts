import { sceneController, type SceneController } from "../controller/sceneController";
import {
  createSceneBinding,
  normalizeSceneState,
  SCENE_HOST_CLASS,
  type SceneStateInput
} from "../controller/sceneBindings";
import type { VoxelGrid } from "./types";
import { SCENE_CLASS } from "./types";
import type { AutoRotateOption } from "./camera";
import { normalizeInvertMultiplier, DEFAULT_CAMERA_STATE } from "./camera";
import type { SceneControllerOptions } from "../controller/sceneController";
import type { CameraComponentProps } from "../controller/domBindings";

export interface HeadlessCameraOptions extends CameraComponentProps {
  controller?: SceneControllerOptions;
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

export type HeadlessSceneOptions = SceneStateInput & { element: HTMLElement };

export interface HeadlessRenderOptions {
  camera: HeadlessCameraHandle;
  scene: HeadlessSceneOptions;
}

export interface HeadlessRenderHandle {
  setVoxels(voxels: VoxelGrid): void;
  setScene(options: SceneStateInput): void;
  destroy(): void;
}

const DEFAULT_PERSPECTIVE = 8000;
const DEFAULT_INTERACTIVE = false;
const DEFAULT_INVERT = normalizeInvertMultiplier(false) ?? 1;

export function createScene(options: HeadlessSceneOptions): HeadlessSceneOptions {
  const { element, ...state } = options;
  if (!element) {
    throw new Error("voxcss: createScene requires an element.");
  }
  element.classList.add(SCENE_HOST_CLASS);
  const normalized = normalizeSceneState(state);
  return { element, ...normalized };
}

export function createCamera(options: HeadlessCameraOptions): HeadlessCameraHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessCamera requires an element.");
  }
  const normalized = normalizeCameraOptions(options);
  const controllerConfig = mergeControllerOptions(normalized);
  const controller = sceneController(controllerConfig);
  element.classList.add(SCENE_CLASS);
  applyPerspective(element, normalized.perspective);
  let interactive = normalized.interactive;
  let autoRotate = createAutoRotateHandle(controller, normalized.animate);
  let detachPointer = interactive ? attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction()) : null;
  autoRotate?.start();

  const handle: HeadlessCameraHandle = {
    element,
    controller,
    interactive,
    setInteractive(value: boolean) {
      if (interactive === value) return;
      interactive = value;
      if (interactive) {
        if (!detachPointer) {
          detachPointer = attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction());
        }
      } else {
        detachPointer?.();
        detachPointer = null;
        element.style.cursor = "default";
      }
      handle.interactive = interactive;
    },
    setAnimate(option: AutoRotateOption | false | undefined) {
      autoRotate?.stop();
      autoRotate = option === false ? null : createAutoRotateHandle(controller, option);
      autoRotate?.start();
    },
    setPerspective(value: number | boolean | undefined) {
      applyPerspective(element, value);
    },
    destroy() {
      detachPointer?.();
      detachPointer = null;
      autoRotate?.stop();
      autoRotate = null;
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

function applyPerspective(element: HTMLElement, perspective: number | boolean | undefined) {
  element.style.perspective = formatPerspectiveStyle(perspective, DEFAULT_PERSPECTIVE);
}

function mergeControllerOptions(options: HeadlessCameraOptions): SceneControllerOptions {
  const base = options.controller ?? {};
  const cameraOverrides: Record<string, number> = {};
  if (options.zoom !== undefined) cameraOverrides.zoom = options.zoom;
  if (options.pan !== undefined) cameraOverrides.pan = options.pan;
  if (options.tilt !== undefined) cameraOverrides.tilt = options.tilt;
  if (options.rotX !== undefined) cameraOverrides.rotX = options.rotX;
  if (options.rotY !== undefined) cameraOverrides.rotY = options.rotY;

  const next: SceneControllerOptions = { ...base };
  if (Object.keys(cameraOverrides).length) {
    next.camera = { ...(base.camera ?? {}), ...cameraOverrides };
  }
  const invertOverride = normalizeInvertMultiplier(options.invert);
  if (invertOverride !== undefined) {
    next.pointerInvert = invertOverride;
  }
  return next;
}

function formatPerspectiveStyle(value: number | boolean | undefined, fallback = DEFAULT_PERSPECTIVE): string {
  if (value === false) {
    return "none";
  }
  const resolved = typeof value === "number" ? value : fallback;
  return `${resolved}px`;
}

function normalizeCameraOptions(options: HeadlessCameraOptions): HeadlessCameraOptions & {
  interactive: boolean;
  perspective: number | false;
} {
  return {
    ...options,
    zoom: options.zoom ?? DEFAULT_CAMERA_STATE.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_STATE.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_STATE.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_STATE.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_STATE.rotY,
    interactive: options.interactive ?? DEFAULT_INTERACTIVE,
    perspective: options.perspective === false ? false : typeof options.perspective === "number" ? options.perspective : DEFAULT_PERSPECTIVE
  };
}

function attachPointerEvents(
  element: HTMLElement,
  controller: SceneController,
  onInteraction?: () => void
): () => void {
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

interface NormalizedAutoRotateConfig {
  axis: "x" | "y";
  speed: number;
  pauseOnInteraction: boolean;
}

const DEFAULT_AUTO_ROTATE_SPEED = 0.3;

const AUTO_ROTATE_SCOPE: typeof globalThis | undefined =
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : undefined;

const REQUEST_FRAME =
  typeof AUTO_ROTATE_SCOPE?.requestAnimationFrame === "function"
    ? AUTO_ROTATE_SCOPE.requestAnimationFrame.bind(AUTO_ROTATE_SCOPE)
    : null;

const CANCEL_FRAME =
  typeof AUTO_ROTATE_SCOPE?.cancelAnimationFrame === "function"
    ? AUTO_ROTATE_SCOPE.cancelAnimationFrame.bind(AUTO_ROTATE_SCOPE)
    : null;

function createAutoRotateHandle(
  controller: SceneController,
  option?: AutoRotateOption
): { start(): void; stop(): void; notifyInteraction(): void } | null {
  const config = normalizeAutoRotateOption(option);
  if (!config || !REQUEST_FRAME || !CANCEL_FRAME) {
    return null;
  }

  let frameId: number | null = null;
  let disabledByInteraction = false;

  const applyRotation = () => {
    const state = controller.getCameraState();
    if (config.axis === "x") {
      const nextRotX = normalizeAngle(state.rotX + config.speed);
      controller.updateCamera({ rotX: nextRotX });
    } else {
      const nextRotY = normalizeAngle(state.rotY + config.speed);
      controller.updateCamera({ rotY: nextRotY });
    }
  };

  const tick = () => {
    frameId = REQUEST_FRAME(tick);
    if (!disabledByInteraction) {
      applyRotation();
    }
  };

  return {
    start() {
      if (frameId !== null || disabledByInteraction) return;
      frameId = REQUEST_FRAME(tick);
    },
    stop() {
      if (frameId === null) return;
      CANCEL_FRAME(frameId);
      frameId = null;
    },
    notifyInteraction() {
      if (!config.pauseOnInteraction || disabledByInteraction) return;
      disabledByInteraction = true;
      if (frameId !== null) {
        CANCEL_FRAME(frameId);
        frameId = null;
      }
    }
  };
}

function normalizeAutoRotateOption(option?: AutoRotateOption): NormalizedAutoRotateConfig | null {
  if (!option) return null;
  if (option === true) {
    return { axis: "y", speed: DEFAULT_AUTO_ROTATE_SPEED, pauseOnInteraction: true };
  }
  if (typeof option === "number") {
    if (!Number.isFinite(option) || option === 0) return null;
    return { axis: "y", speed: option, pauseOnInteraction: true };
  }
  const speedValue =
    typeof option.speed === "number" && Number.isFinite(option.speed) ? option.speed : DEFAULT_AUTO_ROTATE_SPEED;
  if (!speedValue) return null;
  const axis = option.axis === "x" ? "x" : "y";
  const pauseOnInteraction = option.pauseOnInteraction !== false;
  return { axis, speed: speedValue, pauseOnInteraction };
}

function normalizeAngle(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}
