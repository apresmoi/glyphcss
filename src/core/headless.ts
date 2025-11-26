import { sceneController, type SceneController } from "../controller/sceneController";
import { mountScene, normalizeSceneState, SCENE_HOST_CLASS, type SceneState } from "../controller/sceneBindings";
import { SCENE_CLASS } from "./types";
import type { AutoRotateOption } from "./camera";
import { createIsometricCamera, normalizeInvertMultiplier } from "./camera";
import type { SceneControllerOptions } from "../controller/sceneController";
import type { CameraComponentProps } from "../controller/domBindings";

export interface HeadlessCameraOptions extends CameraComponentProps {
  controller?: SceneControllerOptions;
  element: HTMLElement;
}

export interface HeadlessCameraHandle {
  element: HTMLElement;
  controller: SceneController;
  get interactive(): boolean;
  setInteractive(value: boolean): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  setPerspective(value: number | boolean | undefined): void;
  update(next: CameraComponentProps): void;
  destroy(): void;
}

export type HeadlessSceneOptions = SceneState & { element: HTMLElement };

export interface HeadlessRenderOptions {
  camera: HeadlessCameraHandle;
  scene: HeadlessSceneOptions;
}

export interface HeadlessRenderHandle {
  setVoxels(voxels: SceneState["voxels"]): void;
  setScene(options: SceneState): void;
  destroy(): void;
}

const DEFAULT_PERSPECTIVE = 8000;

export function createScene(options: HeadlessSceneOptions): HeadlessSceneOptions {
  const { element, ...state } = options;
  if (!element) {
    throw new Error("voxcss: createScene requires an element.");
  }
  element.classList.add(SCENE_HOST_CLASS);
  return { element, ...normalizeSceneState(state) };
}

export function createCamera(options: HeadlessCameraOptions): HeadlessCameraHandle {
  const element = options.element;
  if (!element) {
    throw new Error("voxcss: createHeadlessCamera requires an element.");
  }
  const { normalized, controllerOptions } = normalizeCameraOptions(options);
  const controller = sceneController(controllerOptions);
  element.classList.add(SCENE_CLASS);
  applyPerspective(element, normalized.perspective);
  let interactive = normalized.interactive;
  let autoRotate = createAutoRotateHandle(controller, normalized.animate);
  let currentAnimate = normalized.animate;
  let currentPerspective = normalized.perspective;
  let detachPointer = interactive ? attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction()) : null;
  autoRotate?.start();

  const handle: HeadlessCameraHandle = {
    element,
    controller,
    get interactive() {
      return interactive;
    },
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
    },
    setAnimate(option: AutoRotateOption | false | undefined) {
      if (option === currentAnimate) return;
      autoRotate?.stop();
      autoRotate = option === false ? null : createAutoRotateHandle(controller, option);
      autoRotate?.start();
      currentAnimate = option;
    },
    setPerspective(value: number | boolean | undefined) {
      const resolved = value === false ? false : typeof value === "number" ? value : DEFAULT_PERSPECTIVE;
      if (resolved === currentPerspective) return;
      applyPerspective(element, resolved);
      currentPerspective = resolved;
    },
    update(next: CameraComponentProps) {
      if (next.zoom !== undefined || next.pan !== undefined || next.tilt !== undefined || next.rotX !== undefined || next.rotY !== undefined) {
        controller.updateCamera({
          ...(next.zoom !== undefined ? { zoom: next.zoom } : {}),
          ...(next.pan !== undefined ? { pan: next.pan } : {}),
          ...(next.tilt !== undefined ? { tilt: next.tilt } : {}),
          ...(next.rotX !== undefined ? { rotX: next.rotX } : {}),
          ...(next.rotY !== undefined ? { rotY: next.rotY } : {})
        });
      }
      if (next.invert !== undefined) {
        const invertOverride = normalizeInvertMultiplier(next.invert);
        controller.setPointerInvert(invertOverride ?? normalizeInvertMultiplier(false) ?? 1);
      }
      if (next.interactive !== undefined) {
        handle.setInteractive(!!next.interactive);
      }
      if (next.perspective !== undefined) {
        handle.setPerspective(next.perspective);
      }
      if (next.animate !== undefined) {
        handle.setAnimate(next.animate);
      }
    },
    destroy() {
      detachPointer?.();
      detachPointer = null;
      autoRotate?.stop();
      autoRotate = null;
      interactive = false;
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
  let currentState: SceneState = normalizeSceneState(state);
  const binding = mountScene({
    controller,
    element,
    ...currentState
  });

  if (camera.interactive) {
    camera.element.style.cursor = controller.getCursor();
  }

  return {
    setVoxels(voxels: SceneState["voxels"]) {
      currentState = normalizeSceneState({ ...currentState, voxels });
      binding.update(currentState);
    },
    setScene(options: SceneState) {
      // Merge so partial updates (e.g., toggling walls) preserve the existing scene state.
      currentState = normalizeSceneState({ ...currentState, ...options });
      binding.update(currentState);
    },
    destroy() {
      binding.destroy();
      camera.destroy();
    }
  };
}

function applyPerspective(element: HTMLElement, perspective: number | boolean | undefined) {
  if (perspective === false) {
    element.style.perspective = "none";
    return;
  }
  const resolved = typeof perspective === "number" ? perspective : DEFAULT_PERSPECTIVE;
  element.style.perspective = `${resolved}px`;
}

function normalizeCameraOptions(options: HeadlessCameraOptions): {
  normalized: HeadlessCameraOptions & { interactive: boolean; perspective: number | false };
  controllerOptions: SceneControllerOptions;
} {
  const controllerBase = options.controller ?? {};
  const baseCamera = controllerBase.camera ?? {};
  const { zoom, pan, tilt, rotX, rotY } = createIsometricCamera({
    zoom: options.zoom ?? baseCamera.zoom,
    pan: options.pan ?? baseCamera.pan,
    tilt: options.tilt ?? baseCamera.tilt,
    rotX: options.rotX ?? baseCamera.rotX,
    rotY: options.rotY ?? baseCamera.rotY,
    depthOffset: baseCamera.depthOffset
  }).state;
  const interactive = options.interactive ?? false;
  const perspective =
    options.perspective === false
      ? false
      : typeof options.perspective === "number"
        ? options.perspective
        : DEFAULT_PERSPECTIVE;

  const controllerOptions: SceneControllerOptions = {
    ...controllerBase,
    camera: { ...baseCamera, zoom, pan, tilt, rotX, rotY }
  };

  const invertOverride = normalizeInvertMultiplier(options.invert);
  if (invertOverride !== undefined) {
    controllerOptions.pointerInvert = invertOverride;
  }

  return {
    normalized: { ...options, zoom, pan, tilt, rotX, rotY, interactive, perspective },
    controllerOptions
  };
}

function attachPointerEvents(
  element: HTMLElement,
  controller: SceneController,
  onInteraction?: () => void
): () => void {
  const handlePointerDown = (event: PointerEvent) => {
    onInteraction?.();
    event.preventDefault();
    controller.handlePointerDown(event);
    element.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => {
    event.preventDefault();
    controller.handlePointerMove(event);
  };
  const handlePointerUp = (event: PointerEvent) => {
    controller.handlePointerUp();
    element.releasePointerCapture?.(event.pointerId);
  };
  const handlePointerCancel = (event: PointerEvent) => {
    controller.handlePointerUp();
    element.releasePointerCapture?.(event.pointerId);
  };
  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handlePointerMove);
  element.addEventListener("pointerup", handlePointerUp);
  element.addEventListener("pointercancel", handlePointerCancel);
  return () => {
    element.removeEventListener("pointerdown", handlePointerDown);
    element.removeEventListener("pointermove", handlePointerMove);
    element.removeEventListener("pointerup", handlePointerUp);
    element.removeEventListener("pointercancel", handlePointerCancel);
  };
}

interface NormalizedAutoRotateConfig {
  axis: "x" | "y";
  speed: number;
  pauseOnInteraction: boolean;
}

const DEFAULT_AUTO_ROTATE_SPEED = 0.3;

function createAutoRotateHandle(
  controller: SceneController,
  option?: AutoRotateOption
): { start(): void; stop(): void; notifyInteraction(): void } | null {
  const config = normalizeAutoRotateOption(option);
  if (!config) {
    return null;
  }

  let frameId: number | null = null;
  let disabledByInteraction = false;
  let requestFrame: typeof requestAnimationFrame | null = null;
  let cancelFrame: typeof cancelAnimationFrame | null = null;

  const ensureFrameFns = () => {
    if (requestFrame && cancelFrame) return true;
    if (typeof globalThis === "undefined") return false;
    const raf =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null;
    const caf =
      typeof globalThis.cancelAnimationFrame === "function" ? globalThis.cancelAnimationFrame.bind(globalThis) : null;
    requestFrame = raf;
    cancelFrame = caf;
    return Boolean(requestFrame && cancelFrame);
  };

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
    if (!requestFrame) return;
    frameId = requestFrame(tick);
    if (!disabledByInteraction) {
      applyRotation();
    }
  };

  return {
    start() {
      if (frameId !== null || disabledByInteraction) return;
      if (!ensureFrameFns() || !requestFrame) return;
      frameId = requestFrame(tick);
    },
    stop() {
      if (frameId === null) return;
      if (!cancelFrame && !ensureFrameFns()) {
        frameId = null;
        return;
      }
      cancelFrame?.(frameId);
      frameId = null;
    },
    notifyInteraction() {
      if (!config.pauseOnInteraction || disabledByInteraction) return;
      disabledByInteraction = true;
      if (frameId !== null) {
        if (!cancelFrame && !ensureFrameFns()) {
          frameId = null;
          return;
        }
        cancelFrame?.(frameId);
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
