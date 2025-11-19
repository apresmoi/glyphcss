import { createVoxScene } from "../core/scene";
import { wallMasksEqual } from "../core/context";
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
  flush(): void;
  syncController(controller: { getWalls(): WallsMask; subscribeCamera(listener: () => void): () => void }, buildContext: () => Partial<GridContext>): void;
  destroy(): void;
  getHandle(): VoxIllustrationHandle | null;
}

export function createSceneHost(options: SceneHostOptions = {}): SceneHost {
  let targetElement: HTMLElement | null = null;
  let handle: VoxIllustrationHandle | null = null;
  let unsubscribeCamera: (() => void) | null = null;
  let lastWalls: WallsMask | null = null;

  let currentVoxelGrid: VoxelGrid = options.voxels ?? [];
  let currentContext: Partial<GridContext> = { ...(options.context ?? {}) };
  let dirty = false;

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
  }

  function flush() {
    if (!dirty || !handle) return;
    handle.update(currentVoxelGrid, currentContext);
    dirty = false;
  }

  function destroy() {
    destroyHandle();
    unsubscribeCamera?.();
    unsubscribeCamera = null;
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
    flush,
    syncController(controller, buildContext) {
      unsubscribeCamera?.();
      lastWalls = controller.getWalls();
      unsubscribeCamera = controller.subscribeCamera(() => {
        const nextWalls = controller.getWalls();
        if (lastWalls && wallMasksEqual(lastWalls, nextWalls)) {
          return;
        }
        lastWalls = nextWalls;
        setState({ context: buildContext() });
        flush();
      });
    },
    destroy,
    getHandle
  };
}
