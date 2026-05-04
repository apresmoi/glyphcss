import type { SceneController, SceneControllerOptions, AutoRotateOption, MergeVoxelsOption } from "@layoutit/voxcss-core";
import { sceneController, SCENE_CLASS, createIsometricCamera, normalizeInvertMultiplier } from "@layoutit/voxcss-core";
import { mountScene, normalizeSceneState, SCENE_HOST_CLASS, type SceneState } from "./bindings/sceneBindings";
import type { CameraComponentProps } from "./bindings/domBindings";

export type { MergeVoxelsOption } from "@layoutit/voxcss-core";

export interface HeadlessCameraOptions extends CameraComponentProps {
  controller?: SceneControllerOptions;
  element: HTMLElement;
}

export interface HeadlessCameraConfig extends CameraComponentProps {
  controller?: SceneControllerOptions;
  element?: HTMLElement;
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

export type HeadlessSceneOptions = Partial<SceneState> & { element: HTMLElement };
export type HeadlessSceneConfig = Partial<SceneState> & { element?: HTMLElement };
type NormalizedHeadlessSceneOptions = SceneState & { element: HTMLElement };

export interface HeadlessRenderOptions {
  element: HTMLElement;
  camera?: HeadlessCameraConfig | HeadlessCameraHandle;
  scene?: HeadlessSceneConfig;
  mergeVoxels?: MergeVoxelsOption;
}

export interface HeadlessRenderHandle {
  setVoxels(voxels: SceneState["voxels"]): void;
  setScene(options: SceneState): void;
  destroy(): void;
}

const DEFAULT_PERSPECTIVE = 8000;

export function createScene(options: HeadlessSceneOptions): NormalizedHeadlessSceneOptions {
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

export function renderScene({
  element: root,
  camera,
  scene,
  mergeVoxels: mergeOption
}: HeadlessRenderOptions): HeadlessRenderHandle {
  if (!root) {
    throw new Error("voxcss: renderScene requires a root element.");
  }

  const doc = root.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) {
    throw new Error("voxcss: renderScene requires a document to create DOM nodes.");
  }

  const cameraElement = resolveCameraElement(camera, doc);
  const cameraElementWasCreated = !isCameraHandle(camera) && !camera?.element;
  if (cameraElement.parentElement !== root) {
    root.appendChild(cameraElement);
  }

  const cameraHandle = isCameraHandle(camera)
    ? camera
    : createCamera({
        ...(camera ?? {}),
        element: cameraElement
      });

  const sceneElement = resolveSceneElement(scene, doc);
  const sceneElementWasCreated = !scene?.element;
  if (sceneElement.parentElement !== cameraHandle.element) {
    cameraHandle.element.appendChild(sceneElement);
  }

  const initialMergeOption = scene?.mergeVoxels ?? mergeOption;

  const sceneState = createScene({
    ...(scene ?? {}),
    mergeVoxels: initialMergeOption,
    voxels: scene?.voxels ?? [],
    element: sceneElement
  });

  const controller = cameraHandle.controller;
  const { element, ...state } = sceneState;
  let currentState: SceneState = normalizeSceneState(state);
  const binding = mountScene({
    controller,
    element,
    ...currentState
  });

  if (cameraHandle.interactive) {
    cameraHandle.element.style.cursor = controller.getCursor();
  }

  return {
    setVoxels(voxels: SceneState["voxels"]) {
      currentState = normalizeSceneState({ ...currentState, voxels });
      binding.update(currentState);
    },
    setScene(options: SceneState) {
      // Merge so partial updates (e.g., toggling walls) preserve the existing scene state.
      const nextVoxels = options.voxels !== undefined ? options.voxels : currentState.voxels;
      currentState = normalizeSceneState({ ...currentState, ...options, voxels: nextVoxels });
      binding.update(currentState);
    },
    destroy() {
      binding.destroy();
      cameraHandle.destroy();
      if (sceneElementWasCreated) {
        sceneElement.remove();
      }
      if (cameraElementWasCreated) {
        cameraElement.remove();
      }
    }
  };
}

function resolveCameraElement(camera: HeadlessRenderOptions["camera"], doc: Document): HTMLElement {
  if (isCameraHandle(camera)) {
    return camera.element;
  }
  if (camera?.element) {
    return camera.element;
  }
  return doc.createElement("div");
}

function resolveSceneElement(scene: HeadlessSceneConfig | undefined, doc: Document): HTMLElement {
  if (scene?.element) {
    return scene.element;
  }
  return doc.createElement("div");
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
  const prevTouchAction = element.style.touchAction;
  const prevUserSelect = element.style.userSelect;
  element.style.touchAction = "none";
  element.style.userSelect = "none";

  const nonPassive: AddEventListenerOptions = { passive: false };

  let activePointerId: number | null = null;
  let detachWindowListeners: (() => void) | null = null;
  const win = element.ownerDocument?.defaultView ?? null;

  const detachActiveWindowListeners = () => {
    detachWindowListeners?.();
    detachWindowListeners = null;
  };

  const attachWindowListeners = () => {
    if (!win || detachWindowListeners) return;
    const handleWinPointerMove = (event: PointerEvent) => {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      if (event.cancelable) event.preventDefault();
      controller.handlePointerMove(event);
    };
    const handleWinPointerUp = (event: PointerEvent) => {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      controller.handlePointerUp();
      activePointerId = null;
      detachActiveWindowListeners();
    };
    const handleWinPointerCancel = (event: PointerEvent) => {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      controller.handlePointerUp();
      activePointerId = null;
      detachActiveWindowListeners();
    };
    win.addEventListener("pointermove", handleWinPointerMove, nonPassive);
    win.addEventListener("pointerup", handleWinPointerUp);
    win.addEventListener("pointercancel", handleWinPointerCancel);
    detachWindowListeners = () => {
      win.removeEventListener("pointermove", handleWinPointerMove, nonPassive);
      win.removeEventListener("pointerup", handleWinPointerUp);
      win.removeEventListener("pointercancel", handleWinPointerCancel);
    };
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (activePointerId !== null) return;
    if (event.isPrimary === false) return;
    onInteraction?.();
    if (event.cancelable) event.preventDefault();
    controller.handlePointerDown(event);
    activePointerId = event.pointerId;
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore (e.g., unsupported or invalid capture scenarios).
    }
    // Safari/iOS can fail to deliver pointerup/pointermove if the pointer leaves the element
    // and capture isn't active, so fall back to window-level listeners.
    if (typeof element.hasPointerCapture === "function") {
      if (!element.hasPointerCapture(event.pointerId)) attachWindowListeners();
    } else if (typeof element.setPointerCapture !== "function") {
      attachWindowListeners();
    }
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    if (event.cancelable) event.preventDefault();
    controller.handlePointerMove(event);
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    controller.handlePointerUp();
    activePointerId = null;
    detachActiveWindowListeners();
    try {
      element.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore (e.g., capture may not have been set).
    }
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    controller.handlePointerUp();
    activePointerId = null;
    detachActiveWindowListeners();
    try {
      element.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore (e.g., capture may not have been set).
    }
  };
  element.addEventListener("pointerdown", handlePointerDown, nonPassive);
  element.addEventListener("pointermove", handlePointerMove, nonPassive);
  element.addEventListener("pointerup", handlePointerUp);
  element.addEventListener("pointercancel", handlePointerCancel);
  return () => {
    element.removeEventListener("pointerdown", handlePointerDown, nonPassive);
    element.removeEventListener("pointermove", handlePointerMove, nonPassive);
    element.removeEventListener("pointerup", handlePointerUp);
    element.removeEventListener("pointercancel", handlePointerCancel);
    detachActiveWindowListeners();
    element.style.touchAction = prevTouchAction;
    element.style.userSelect = prevUserSelect;
  };
}

function isCameraHandle(value: unknown): value is HeadlessCameraHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HeadlessCameraHandle).setInteractive === "function" &&
    typeof (value as HeadlessCameraHandle).destroy === "function"
  );
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
