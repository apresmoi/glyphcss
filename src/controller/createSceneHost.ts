import { createVoxScene } from "../core/scene";
import { wallMasksEqual } from "../core/context";
import type { GridContext, SceneOptions, VoxIllustrationHandle, VoxelGrid, WallsMask } from "../core";

export interface SceneHostOptions extends Pick<SceneOptions, "document" | "context"> {
  voxels?: VoxelGrid;
}

export interface SceneHost {
  mount(target: HTMLElement, voxels?: VoxelGrid, context?: Partial<GridContext>): void;
  update(voxels?: VoxelGrid, context?: Partial<GridContext>): void;
  updateContext(context?: Partial<GridContext>): void;
  setVoxels(voxels: VoxelGrid): void;
  setContext(context: Partial<GridContext>): void;
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
  }

  function update(voxels?: VoxelGrid, context?: Partial<GridContext>) {
    if (voxels && voxels !== currentVoxelGrid) {
      currentVoxelGrid = voxels;
    }
    if (context) {
      currentContext = context;
    }
    if (!handle) return;
    handle.update(currentVoxelGrid, currentContext);
  }

  function updateContext(context?: Partial<GridContext>) {
    if (context) {
      currentContext = context;
    }
    if (!handle) return;
    handle.update(currentVoxelGrid, currentContext);
  }

  function setVoxels(voxels: VoxelGrid) {
    update(voxels, undefined);
  }

  function setContext(context: Partial<GridContext>) {
    updateContext(context);
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
    update,
    updateContext,
    setVoxels,
    setContext,
    syncController(controller, buildContext) {
      unsubscribeCamera?.();
      lastWalls = controller.getWalls();
      unsubscribeCamera = controller.subscribeCamera(() => {
        const nextWalls = controller.getWalls();
        if (lastWalls && wallMasksEqual(lastWalls, nextWalls)) {
          return;
        }
        lastWalls = nextWalls;
        updateContext(buildContext());
      });
    },
    destroy,
    getHandle
  };
}
