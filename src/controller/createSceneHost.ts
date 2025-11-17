import { createVoxScene } from "../core/scene";
import { dimetricShapes } from "../core/shapes";
import type {
  GridContext,
  ShapeRenderer,
  VoxIllustrationHandle,
  VoxcssHooks,
  VoxelGrid
} from "../core";

export interface SceneHostOptions {
  shapes?: Record<string, ShapeRenderer>;
  hooks?: VoxcssHooks;
  document?: Document;
  context?: Partial<GridContext>;
  voxels?: VoxelGrid;
}

export interface SceneHost {
  mount(target: HTMLElement, voxels?: VoxelGrid, context?: Partial<GridContext>): void;
  update(voxels?: VoxelGrid, context?: Partial<GridContext>): void;
  updateContext(context?: Partial<GridContext>): void;
  setVoxels(voxels: VoxelGrid): void;
  setContext(context: Partial<GridContext>): void;
  setShapes(shapes: Record<string, ShapeRenderer>): void;
  setHooks(hooks?: VoxcssHooks): void;
  destroy(): void;
  getHandle(): VoxIllustrationHandle | null;
}

export function createSceneHost(options: SceneHostOptions = {}): SceneHost {
  let targetElement: HTMLElement | null = null;
  let handle: VoxIllustrationHandle | null = null;

  let currentVoxelGrid: VoxelGrid = options.voxels ?? [];
  let currentContext: Partial<GridContext> = { ...(options.context ?? {}) };
  let currentShapes: Record<string, ShapeRenderer> = {
    ...dimetricShapes,
    ...(options.shapes ?? {})
  };
  let currentHooks: VoxcssHooks | undefined = options.hooks;

  function mount(target: HTMLElement, voxels?: VoxelGrid, context?: Partial<GridContext>) {
    targetElement = target;
    if (voxels && voxels !== currentVoxelGrid) {
      currentVoxelGrid = voxels;
    }
    if (context) currentContext = { ...currentContext, ...context };
    destroyHandle();
    handle = createVoxScene({
      element: target,
      voxels: currentVoxelGrid,
      shapes: currentShapes,
      hooks: currentHooks,
      context: currentContext,
      document: options.document
    });
  }

  function update(voxels?: VoxelGrid, context?: Partial<GridContext>) {
    if (voxels && voxels !== currentVoxelGrid) {
      currentVoxelGrid = voxels;
    }
    if (context) {
      currentContext = { ...currentContext, ...context };
    }
    if (!handle) return;
    handle.update(currentVoxelGrid, currentContext);
  }

  function updateContext(context?: Partial<GridContext>) {
    if (context) {
      currentContext = { ...currentContext, ...context };
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

  function setShapes(shapes: Record<string, ShapeRenderer>) {
    currentShapes = { ...dimetricShapes, ...shapes };
    handle?.scene.update(currentVoxelGrid, currentContext);
  }

  function setHooks(hooks?: VoxcssHooks) {
    currentHooks = hooks;
    handle?.scene.update(currentVoxelGrid, currentContext);
  }

  function destroy() {
    destroyHandle();
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
    setShapes,
    setHooks,
    destroy,
    getHandle
  };
}
