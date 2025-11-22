import type { WallsMask } from "../core";
import { createCamera } from "../core/headless";
import type { HeadlessCameraHandle } from "../core/headless";
import type { AutoRotateOption, CameraState } from "../core/camera";
import type { SceneController, SceneControllerOptions } from "./createSceneController";
import { createBindingLifecycle, createElementBindingAdapter } from "./createSceneBinding";

export const DEFAULT_CAMERA_PROPS = {
  zoom: 0.65,
  pan: 0,
  tilt: 0,
  rotX: 65,
  rotY: 45,
  invert: false as boolean | number,
  perspective: 8000,
  interactive: false,
  animate: undefined as AutoRotateOption | false | undefined
};

export interface CameraOptionsInput {
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

export interface CameraControllerInput extends CameraOptionsInput {
  controller?: SceneControllerOptions;
}

export interface NormalizedCameraOptions {
  zoom: number;
  pan: number;
  tilt: number;
  rotX: number;
  rotY: number;
  invert?: boolean | number;
  perspective: number | false | undefined;
  interactive: boolean;
  animate?: AutoRotateOption | false;
}

export function resolveInvertMultiplier(value: number | boolean | undefined): number | undefined {
  if (typeof value === "number") {
    if (value === 0) return undefined;
    return value < 0 ? -1 : 1;
  }
  if (typeof value === "boolean") {
    return value ? -1 : 1;
  }
  return undefined;
}

export function normalizePerspectiveValue(value: number | boolean | undefined): number | false | undefined {
  if (value === false) return false;
  if (typeof value === "number") return value;
  if (value === true) return DEFAULT_CAMERA_PROPS.perspective as number;
  return undefined;
}

export function formatPerspectiveStyle(value: number | boolean | undefined, fallback = 8000): string {
  const normalized = normalizePerspectiveValue(value);
  if (normalized === false) {
    return "none";
  }
  const resolved = typeof normalized === "number" ? normalized : fallback;
  return `${resolved}px`;
}

export function normalizeCameraOptions(options: CameraOptionsInput = {}): NormalizedCameraOptions {
  const perspectiveInput =
    options.perspective === undefined ? DEFAULT_CAMERA_PROPS.perspective : options.perspective;
  return {
    zoom: options.zoom ?? DEFAULT_CAMERA_PROPS.zoom,
    pan: options.pan ?? DEFAULT_CAMERA_PROPS.pan,
    tilt: options.tilt ?? DEFAULT_CAMERA_PROPS.tilt,
    rotX: options.rotX ?? DEFAULT_CAMERA_PROPS.rotX,
    rotY: options.rotY ?? DEFAULT_CAMERA_PROPS.rotY,
    invert: options.invert,
    perspective: normalizePerspectiveValue(perspectiveInput),
    interactive: options.interactive ?? DEFAULT_CAMERA_PROPS.interactive,
    animate: options.animate ?? DEFAULT_CAMERA_PROPS.animate
  };
}

export function mergeControllerOptions(options: CameraControllerInput): SceneControllerOptions {
  const base = options.controller ?? {};
  const cameraOverrides = filterUndefined({
    zoom: options.zoom,
    pan: options.pan,
    tilt: options.tilt,
    rotX: options.rotX,
    rotY: options.rotY
  });
  const invertOverride = resolveInvertMultiplier(options.invert);
  const controlsOverrides = filterUndefined({
    invert: invertOverride
  });
  return {
    ...base,
    camera: { ...(base.camera ?? {}), ...cameraOverrides },
    controls: { ...(base.controls ?? {}), ...controlsOverrides }
  };
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

export interface CameraComponentProps {
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

export interface CameraSlotProps {
  boxStyle: Record<string, string>;
  cursor: string;
  walls: WallsMask;
  camera: CameraRenderSnapshot["camera"];
  controller: SceneController;
}

export interface CameraViewState {
  slotProps: CameraSlotProps | null;
  controller: SceneController | null;
  cursor: string;
  ready: boolean;
}

export interface CameraViewController {
  slotProps: CameraSlotProps | null;
  controller: SceneController | null;
  cursor: string;
  ready: boolean;
  ensureController(): SceneController;
  getRenderableProps(): CameraSlotProps | null;
}

export const CAMERA_HOST_CLASS = "voxcss-camera";

export function createCameraBindingProps(props: CameraComponentProps): Omit<CameraBindingOptions, "element"> {
  return {
    zoom: props.zoom,
    pan: props.pan,
    tilt: props.tilt,
    rotX: props.rotX,
    rotY: props.rotY,
    invert: props.invert,
    perspective: props.perspective,
    interactive: props.interactive,
    animate: props.animate
  };
}

function resolveCameraSlotProps(
  controller: SceneController | null,
  snapshot: CameraRenderSnapshot | null
): CameraSlotProps | null {
  if (!controller || !snapshot) {
    return null;
  }
  return {
    boxStyle: snapshot.boxStyle,
    cursor: snapshot.cursor,
    walls: snapshot.walls,
    camera: snapshot.camera,
    controller
  };
}

function resolveCameraView(slotProps: CameraSlotProps | null): CameraViewState {
  const controller = slotProps?.controller ?? null;
  return {
    slotProps,
    controller,
    cursor: slotProps?.cursor ?? "default",
    ready: Boolean(slotProps && controller)
  };
}

export function ensureCameraController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: controller is not ready yet.");
  }
  return controller;
}

export function createCameraViewController(slotProps: CameraSlotProps | null): CameraViewController {
  const view = resolveCameraView(slotProps);
  return {
    ...view,
    ensureController() {
      return ensureCameraController(view.controller);
    },
    getRenderableProps() {
      if (view.ready && view.slotProps) {
        return view.slotProps;
      }
      return null;
    }
  };
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
    perspective: current.perspective,
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
      cameraHandle.setPerspective(nextState.perspective);
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

export interface CameraBindingSnapshot {
  controller: SceneController | null;
  slotProps: CameraSlotProps | null;
}

interface CameraBindingAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<CameraBindingOptions, "element"> | null;
  onSnapshot?(snapshot: CameraRenderSnapshot): void;
  onController?(controller: SceneController | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onDestroy?(): void;
}

interface CameraBindingAdapter {
  sync(): void;
  destroy(): void;
}

interface CameraHostAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<CameraBindingOptions, "element"> | null;
  onSlotProps?(props: CameraSlotProps | null): void;
  onController?(controller: SceneController | null): void;
  onSnapshot?(snapshot: CameraRenderSnapshot | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onDestroy?(): void;
}

interface CameraHostAdapter extends CameraBindingAdapter {
  getSlotProps(): CameraSlotProps | null;
}

function createCameraBindingAdapter(hooks: CameraBindingAdapterHooks): CameraBindingAdapter {
  let currentSnapshot: CameraRenderSnapshot | null = null;
  let currentController: SceneController | null = null;
  let unsubscribe: (() => void) | null = null;

  const notifySnapshot = (snapshot: CameraRenderSnapshot) => {
    currentSnapshot = snapshot;
    hooks.onSnapshot?.(snapshot);
  };

  const adapter = createElementBindingAdapter<CameraBindingHandle, Omit<CameraBindingOptions, "element">>(
    {
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    },
    {
      mount(element, options) {
        const binding = createCameraBinding({ ...options, element });
        currentController = binding.controller;
        hooks.onHandle?.(binding);
        hooks.onController?.(currentController);
        notifySnapshot(binding.getSnapshot());
        unsubscribe = binding.subscribe((snapshot) => notifySnapshot(snapshot));
        return binding;
      },
      update(binding, options) {
        binding.setOptions(options);
      },
      destroy(binding, reason) {
        unsubscribe?.();
        unsubscribe = null;
        binding.destroy();
        hooks.onHandle?.(null);
        hooks.onController?.(null);
        currentController = null;
        currentSnapshot = null;
        if (reason === "teardown") {
          hooks.onDestroy?.();
        }
      }
    }
  );

  return {
    sync: () => adapter.sync(),
    destroy: () => adapter.destroy()
  };
}

function createCameraHostAdapter(hooks: CameraHostAdapterHooks): CameraHostAdapter {
  let currentController: SceneController | null = null;
  let currentSnapshot: CameraRenderSnapshot | null = null;
  let slotProps: CameraSlotProps | null = null;

  const emitSlotProps = () => {
    slotProps = resolveCameraSlotProps(currentController, currentSnapshot);
    hooks.onSlotProps?.(slotProps);
  };

  const adapter = createCameraBindingAdapter({
    getElement: hooks.getElement,
    getOptions: hooks.getOptions,
    onController(next) {
      currentController = next;
      hooks.onController?.(next);
      emitSlotProps();
    },
    onSnapshot(next) {
      currentSnapshot = next;
      hooks.onSnapshot?.(next);
      emitSlotProps();
    },
    onHandle: hooks.onHandle,
    onDestroy() {
      slotProps = null;
      currentController = null;
      currentSnapshot = null;
      hooks.onSlotProps?.(null);
      hooks.onDestroy?.();
    }
  });

  return {
    ...adapter,
    getSlotProps: () => slotProps
  };
}

export interface CameraBindingView {
  setElement(element: HTMLElement | null): void;
  setOptions(options: Omit<CameraBindingOptions, "element">): void;
  getSnapshot(): CameraBindingSnapshot;
  subscribe(listener: (snapshot: CameraBindingSnapshot) => void): () => void;
  startAutoRotate(option?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
  destroy(): void;
}

export function createCameraBindingView(initialOptions: Omit<CameraBindingOptions, "element">): CameraBindingView {
  let currentOptions = initialOptions;
  let controller: SceneController | null = null;
  let slotProps: CameraSlotProps | null = null;
  let handle: CameraBindingHandle | null = null;
  let animateRef: AutoRotateOption | false | undefined = initialOptions.animate;
  const stateListeners = new Set<(snapshot: CameraBindingSnapshot) => void>();

  const emitSnapshot = () => {
    const snapshot: CameraBindingSnapshot = {
      controller,
      slotProps
    };
    stateListeners.forEach((listener) => listener(snapshot));
  };

  const lifecycle = createBindingLifecycle((hooks) =>
    createCameraHostAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions() ?? currentOptions,
      onController: (next) => {
        controller = next;
        emitSnapshot();
      },
      onSlotProps: (next) => {
        slotProps = next;
        emitSnapshot();
      },
      onHandle: (next) => {
        handle = next;
        if (next && animateRef !== undefined) {
          next.setAnimate(animateRef);
        }
      },
      onDestroy: () => {
        slotProps = null;
        handle = null;
        emitSnapshot();
      }
    })
  );

  lifecycle.setOptions(initialOptions);

  return {
    setElement(element) {
      lifecycle.setElement(element);
    },
    setOptions(options) {
      currentOptions = options;
      animateRef = options.animate;
      lifecycle.setOptions(options);
    },
    getSnapshot() {
      return {
        controller,
        slotProps
      };
    },
    subscribe(listener) {
      stateListeners.add(listener);
      listener({
        controller,
        slotProps
      });
      return () => {
        stateListeners.delete(listener);
      };
    },
    startAutoRotate(option) {
      const next = option ?? animateRef;
      animateRef = next;
      handle?.setAnimate(next);
    },
    stopAutoRotate() {
      animateRef = false;
      handle?.setAnimate(false);
    },
    destroy() {
      lifecycle.destroy();
      stateListeners.clear();
      controller = null;
      slotProps = null;
      handle = null;
    }
  };
}

export interface CameraBindingManager {
  setElement(element: HTMLElement | null): void;
  update(options?: Omit<CameraBindingOptions, "element">): void;
  getSnapshot(): CameraBindingSnapshot;
  subscribe(listener: (snapshot: CameraBindingSnapshot) => void): () => void;
  startAutoRotate(option?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
  destroy(): void;
}

export function createCameraBindingManager(
  initialOptions: Omit<CameraBindingOptions, "element">
): CameraBindingManager {
  let currentOptions = initialOptions;
  const bindingView = createCameraBindingView(currentOptions);

  return {
    setElement(element) {
      bindingView.setElement(element);
    },
    update(options) {
      if (options) {
        currentOptions = options;
      }
      bindingView.setOptions(currentOptions);
    },
    getSnapshot() {
      return bindingView.getSnapshot();
    },
    subscribe(listener) {
      return bindingView.subscribe(listener);
    },
    startAutoRotate(option) {
      bindingView.startAutoRotate(option);
    },
    stopAutoRotate() {
      bindingView.stopAutoRotate();
    },
    destroy() {
      bindingView.setElement(null);
      bindingView.destroy();
    }
  };
}
