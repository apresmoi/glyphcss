import type { SceneController } from "./sceneController";
import type {
  ProjectionMode,
  SceneOptions,
  VoxelGrid,
  VoxIllustrationHandle,
  WallsMask,
  GridContext
} from "../core";
import { buildSceneContext } from "../core/context";
import { createVoxScene } from "../core/scene";
import { normalizeSceneState, type NormalizedSceneState, extractSceneState, type SceneStateInput } from "./sceneOptions";

export interface ElementBindingHooks<TOptions> {
  getElement(): HTMLElement | null;
  getOptions(): TOptions | null;
}

export interface ElementBindingDriver<THandle, TOptions> {
  mount(element: HTMLElement, options: TOptions): THandle;
  update(handle: THandle, options: TOptions): void;
  destroy(handle: THandle, reason: "teardown" | "remount"): void;
  shouldRemount?(
    previous: { element: HTMLElement; options: TOptions; handle: THandle },
    next: { element: HTMLElement; options: TOptions }
  ): boolean;
}

export interface ElementBindingAdapter<THandle> {
  sync(): void;
  destroy(): void;
}

export function createElementBindingAdapter<THandle, TOptions>(
  hooks: ElementBindingHooks<TOptions>,
  driver: ElementBindingDriver<THandle, TOptions>
): ElementBindingAdapter<THandle> {
  let handle: THandle | null = null;
  let mountedElement: HTMLElement | null = null;
  let mountedOptions: TOptions | null = null;

  const teardown = (reason: "teardown" | "remount") => {
    if (!handle) return;
    driver.destroy(handle, reason);
    handle = null;
    mountedElement = null;
    mountedOptions = null;
  };

  const mount = (element: HTMLElement, options: TOptions) => {
    teardown("remount");
    handle = driver.mount(element, options);
    mountedElement = element;
    mountedOptions = options;
  };

  const sync = () => {
    const element = hooks.getElement();
    const options = hooks.getOptions();
    if (!element || !options) {
      teardown("teardown");
      return;
    }
    if (
      !handle ||
      mountedElement !== element ||
      (driver.shouldRemount &&
        driver.shouldRemount(
          { element: mountedElement, options: mountedOptions as TOptions, handle: handle },
          { element, options }
        ))
    ) {
      mount(element, options);
      return;
    }
    mountedOptions = options;
    driver.update(handle, options);
  };

  return {
    sync,
    destroy: () => {
      teardown("teardown");
    }
  };
}

export interface BindingLifecycleAdapterHooks<TOptions> extends ElementBindingHooks<TOptions> {}

export interface BindingLifecycle<TAdapter extends { sync(): void; destroy(): void }, TOptions> {
  setElement(element: HTMLElement | null): void;
  setOptions(options: TOptions | null): void;
  sync(): void;
  destroy(): void;
}

export function createBindingLifecycle<TAdapter extends { sync(): void; destroy(): void }, TOptions>(
  factory: (hooks: BindingLifecycleAdapterHooks<TOptions | null>) => TAdapter
): BindingLifecycle<TAdapter, TOptions> {
  let destroyed = false;
  let element: HTMLElement | null = null;
  let options: TOptions | null = null;

  const adapter = factory({
    getElement: () => element,
    getOptions: () => options
  });

  const sync = () => {
    if (!destroyed) {
      adapter.sync();
    }
  };

  return {
    setElement(next) {
      element = next;
      sync();
    },
    setOptions(next) {
      options = next;
      sync();
    },
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      adapter.destroy();
      element = null;
      options = null;
    }
  };
}
export interface SceneHostOptions extends Pick<SceneOptions, "document" | "context"> {
  voxels?: VoxelGrid;
}

export interface SceneHostStateUpdate {
  voxels?: VoxelGrid;
  context?: Partial<GridContext>;
}

export interface SceneHost {
  mount(target: HTMLElement, voxels?: VoxelGrid, context?: Partial<GridContext>): void;
  setState(state: SceneHostStateUpdate): void;
  syncController(controller: { subscribeWalls(listener: (walls: WallsMask) => void): () => void }, buildContext: () => Partial<GridContext>): void;
  destroy(): void;
}

export function createSceneHost(options: SceneHostOptions = {}): SceneHost {
  let targetElement: HTMLElement | null = null;
  let handle: VoxIllustrationHandle | null = null;
  let unsubscribeWalls: (() => void) | null = null;

  let currentVoxelGrid: VoxelGrid = options.voxels ?? [];
  let currentContext: Partial<GridContext> = { ...(options.context ?? {}) };
  let dirty = false;
  let flushScheduled = false;

  const enqueue = (() => {
    if (typeof queueMicrotask === "function") {
      return queueMicrotask;
    }
    return (fn: () => void) => Promise.resolve().then(fn);
  })();

  function mount(target: HTMLElement, voxels?: VoxelGrid, context?: Partial<GridContext>) {
    targetElement = target;
    if (voxels && voxels !== currentVoxelGrid) {
      currentVoxelGrid = voxels;
    }
    if (context) {
      currentContext = context;
    }
    destroyHandle();
    handle = createVoxScene({
      element: target,
      voxels: currentVoxelGrid,
      context: currentContext,
      document: options.document
    });
    dirty = false;
  }

  function setState(state: SceneHostStateUpdate) {
    if (state.voxels && state.voxels !== currentVoxelGrid) {
      currentVoxelGrid = state.voxels;
      dirty = true;
    }
    if (state.context) {
      currentContext = state.context;
      dirty = true;
    }
    scheduleFlush();
  }

  function flush() {
    if (!dirty || !handle) return;
    handle.update(currentVoxelGrid, currentContext);
    dirty = false;
  }

  function scheduleFlush() {
    if (!dirty || flushScheduled) return;
    flushScheduled = true;
    enqueue(() => {
      flushScheduled = false;
      flush();
    });
  }

  function destroy() {
    destroyHandle();
    unsubscribeWalls?.();
    unsubscribeWalls = null;
    targetElement = null;
  }

  function destroyHandle() {
    handle?.destroy();
    handle = null;
  }

  return {
    mount,
    setState,
    syncController(controller, buildContext) {
      unsubscribeWalls?.();
      unsubscribeWalls = controller.subscribeWalls(() => {
        setState({ context: buildContext() });
      });
    },
    destroy
  };
}

export interface SceneSessionState extends SceneStateInput {}

export interface SceneSessionOptions extends SceneSessionState {
  controller: SceneController;
  element: HTMLElement;
  host?: SceneHost;
}

export interface SceneSessionHandle {
  mount(): void;
  setState(next: Partial<SceneSessionState>): void;
  destroy(): void;
}

export function createSceneSession(options: SceneSessionOptions): SceneSessionHandle {
  const controller = options.controller;
  const element = options.element;
  const host = options.host ?? createSceneHost();

  let state: NormalizedSceneState = normalizeSceneState(options);
  let mounted = false;
  let isSyncingDimensions = false;

  const applyBoxStyle = (style: Record<string, string>) => {
    for (const [key, value] of Object.entries(style)) {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    }
  };

  applyBoxStyle(controller.getBoxStyle());
  const unsubscribeBox = controller.subscribeBoxStyle(applyBoxStyle);
  const unsubscribeDimensions = controller.subscribeDimensions(() => {
    if (!mounted || isSyncingDimensions) return;
    host.setState({ context: buildContextSnapshot() });
  });

  const buildContextSnapshot = () => {
    const projection = state.projection;
    controller.setProjection?.(projection);
    const cameraState = controller.getCameraState?.();
    const baseContext: Partial<GridContext> = {
      rows: state.rows,
      cols: state.cols,
      depth: state.depth,
      showWalls: state.showWalls,
      showFloor: state.showFloor,
      projection,
      walls: controller.getWalls(),
      rotX: cameraState?.rotX,
      rotY: cameraState?.rotY
    };
    const scene = buildSceneContext({
      grid: state.voxels,
      context: baseContext
    });
    const nextDimensions = scene.dimensions;
    const currentDimensions = controller.getDimensions();
    if (
      nextDimensions.rows !== currentDimensions.rows ||
      nextDimensions.cols !== currentDimensions.cols ||
      nextDimensions.depth !== currentDimensions.depth
    ) {
      isSyncingDimensions = true;
      controller.setDimensions(nextDimensions);
      isSyncingDimensions = false;
    }
    return scene.snapshot;
  };

  const mount = () => {
    if (mounted) return;
    const context = buildContextSnapshot();
    host.mount(element, state.voxels, context);
    host.syncController(controller, () => buildContextSnapshot());
    mounted = true;
  };

  const setState = (next: Partial<SceneSessionState>) => {
    state = {
      ...state,
      ...next,
      ...normalizeSceneState(next, state)
    };
    if (!mounted) return;
    host.setState({ voxels: state.voxels, context: buildContextSnapshot() });
  };

  const destroy = () => {
    unsubscribeBox();
    unsubscribeDimensions();
    host.destroy();
    mounted = false;
  };

  return {
    mount,
    setState,
    destroy
  };
}

export interface SceneBindingOptions {
  controller: SceneController;
  element: HTMLElement | null;
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

interface InternalSceneBindingOptions extends SceneBindingOptions {
  host?: SceneHost;
  onSessionChange?(session: SceneSessionHandle | null): void;
}

export interface SceneBindingHandle {
  mount(): void;
  update(options: Partial<Omit<SceneBindingOptions, "controller" | "element">>): void;
  destroy(): void;
}

type BindingState = Omit<InternalSceneBindingOptions, keyof NormalizedSceneState> & NormalizedSceneState;

function createSceneBindingInternal(initial: InternalSceneBindingOptions): SceneBindingHandle {
  let current: BindingState = {
    ...initial,
    ...normalizeSceneState(initial)
  };
  let session: SceneSessionHandle | null = null;
  let mounted = false;

  const mount = () => {
    if (mounted) return;
    const element = current.element;
    if (!element) return;
    session = createSceneSession({
      controller: current.controller,
      element,
      host: current.host,
      ...extractSceneState(current)
    });
    session.mount();
    current.onSessionChange?.(session);
    mounted = true;
  };

  const update = (next: Partial<Omit<SceneBindingOptions, "controller" | "element">>) => {
    current = {
      ...current,
      ...next,
      ...normalizeSceneState(next, current)
    };
    if (!mounted || !session) return;
    session.setState(extractSceneState(current));
  };

  const destroy = () => {
    session?.destroy();
    current.onSessionChange?.(null);
    session = null;
    mounted = false;
  };

  return {
    mount,
    update,
    destroy
  };
}

export function createSceneBinding(initial: SceneBindingOptions): SceneBindingHandle {
  return createSceneBindingInternal(initial);
}

interface SceneBindingAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<SceneBindingOptions, "element"> | null;
}

interface SceneBindingAdapter {
  sync(): void;
  destroy(): void;
}

function createSceneBindingAdapter(hooks: SceneBindingAdapterHooks): SceneBindingAdapter {
  const adapter = createElementBindingAdapter<SceneBindingHandle, Omit<SceneBindingOptions, "element">>(
    {
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    },
    {
      mount(element, options) {
        const binding = createSceneBinding({ ...options, element });
        binding.mount();
        return binding;
      },
      update(binding, options) {
        binding.update(extractSceneState(options));
      },
      destroy(binding) {
        binding.destroy();
      },
      shouldRemount(previous, next) {
        return previous.options.controller !== next.options.controller;
      }
    }
  );

  return {
    sync: () => adapter.sync(),
    destroy: () => adapter.destroy()
  };
}

export interface SceneBindingManagerInit<TOptions> {
  getElement(): HTMLElement | null;
  getOptions(): TOptions | null;
}

export interface SceneBindingManager<TOptions> {
  mount(element: HTMLElement): void;
  update(options?: TOptions): void;
  destroy(): void;
}

export function createSceneBindingManager<TOptions extends Omit<SceneBindingOptions, "element">>(
  init: SceneBindingManagerInit<TOptions>
): SceneBindingManager<TOptions> {
  const lifecycle = createBindingLifecycle<SceneBindingAdapter, TOptions | null>((hooks) =>
    createSceneBindingAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    })
  );

  return {
    mount(element: HTMLElement) {
      lifecycle.setOptions(init.getOptions() ?? null);
      lifecycle.setElement(element);
    },
    update(options?: TOptions) {
      const next = options ?? init.getOptions();
      lifecycle.setOptions(next ?? null);
    },
    destroy() {
      lifecycle.destroy();
    }
  };
}

export interface SceneComponentProps {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export const SCENE_HOST_CLASS = "voxcss-scene-host";

export function ensureSceneController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
  }
  return controller;
}

export function createSceneBindingProps(
  controller: SceneController | null,
  props: SceneComponentProps
): Omit<SceneBindingOptions, "element"> {
  const ensured = ensureSceneController(controller);
  return {
    controller: ensured,
    voxels: props.voxels,
    rows: props.rows,
    cols: props.cols,
    depth: props.depth,
    showWalls: props.showWalls,
    showFloor: props.showFloor,
    projection: props.projection
  };
}
