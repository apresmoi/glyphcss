import { createVoxScene } from "../core/scene";
import type { GridContext, SceneOptions, VoxIllustrationHandle, VoxelGrid, WallsMask } from "../core";

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
  getHandle(): VoxIllustrationHandle | null;
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

  function getHandle() {
    return handle;
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
    destroy,
    getHandle
  };
}
