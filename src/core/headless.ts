import { sceneController, type ControllerControls, type SceneController } from "../controller/sceneController";
import {
  createSceneHost,
  createSceneSession,
  type SceneSessionHandle
} from "../controller/sceneBindings";
import { attachPointerEvents } from "./pointerEvents";
import type { AutoRotateOption } from "./camera";
import type { VoxelGrid, ProjectionMode, SceneOptions } from "./types";
import { SCENE_CLASS } from "./types";
import {
  DEFAULT_CAMERA_PROPS,
  formatPerspectiveStyle,
  mergeControllerOptions,
  normalizeCameraOptions,
  type CameraControllerInput
} from "../controller/cameraBindings";
import {
  normalizeSceneState,
  type NormalizedSceneState,
  extractSceneState,
  type SceneStateInput
} from "../controller/sceneOptions";
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
  setVoxels(voxels: VoxelGrid): void;
  setOptions(options: SceneStateInput): void;
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

interface AutoRotateHandle {
  start(): void;
  stop(): void;
  notifyInteraction(): void;
}

interface HeadlessBindingHandle {
  mount(): void;
  update(state: Partial<NormalizedSceneState>): void;
  destroy(): void;
}

interface InternalSceneState {
  host: ReturnType<typeof createSceneHost>;
  session: SceneSessionHandle | null;
  binding: HeadlessBindingHandle | null;
  state: NormalizedSceneState;
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
  const controller = sceneController(controllerConfig);
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
    host,
    session: null,
    binding: null,
    state
  };

  const syncBinding = () => {
    internalState.binding?.update(state);
    internalState.state = state;
  };

  const handle: HeadlessSceneHandle = {
    element,
    setVoxels(voxels: VoxelGrid) {
      state = { ...state, voxels };
      internalState.state = state;
      internalState.binding?.update({ voxels });
    },
    setOptions(options: SceneStateInput) {
      state = normalizeSceneState(options, state);
      internalState.state = state;
      syncBinding();
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
  const internalSceneState = getInternalSceneState(scene);
  const sceneState = internalSceneState.state;

  const binding = createHeadlessBinding({
    controller,
    element: scene.element,
    host: internalSceneState.host,
    state: sceneState,
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

interface HeadlessBindingOptions {
  controller: SceneController;
  element: HTMLElement;
  host: ReturnType<typeof createSceneHost>;
  state: NormalizedSceneState;
  onSessionChange?(session: SceneSessionHandle | null): void;
}

function createHeadlessBinding(options: HeadlessBindingOptions): HeadlessBindingHandle {
  let currentState: NormalizedSceneState = options.state;
  let session: SceneSessionHandle | null = null;
  let mounted = false;

  const mount = () => {
    if (mounted || !options.element) return;
    session = createSceneSession({
      controller: options.controller,
      element: options.element,
      host: options.host,
      ...extractSceneState(currentState)
    });
    session.mount();
    options.onSessionChange?.(session);
    mounted = true;
  };

  const update = (next: Partial<NormalizedSceneState>) => {
    currentState = {
      ...currentState,
      ...next
    };
    if (!mounted || !session) return;
    const activeSession = session;
    activeSession.setState(extractSceneState(currentState));
  };

  const destroy = () => {
    session?.destroy();
    options.onSessionChange?.(null);
    session = null;
    mounted = false;
  };

  return {
    mount,
    update,
    destroy
  };
}

function applyPerspective(element: HTMLElement, perspective: number | boolean | undefined) {
  const fallback = (DEFAULT_CAMERA_PROPS.perspective as number | undefined) ?? 8000;
  element.style.perspective = formatPerspectiveStyle(perspective, fallback);
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
): AutoRotateHandle | null {
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
    typeof option.speed === "number" && Number.isFinite(option.speed)
      ? option.speed
      : DEFAULT_AUTO_ROTATE_SPEED;
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
