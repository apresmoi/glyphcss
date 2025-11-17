/* Scene lifecycle: voxScene host and createVoxScene convenience wrapper. */
import type {
  CreateVoxcssOptions,
  GridContext,
  VoxIllustrationHandle,
  VoxIllustrationOptions,
  VoxcssInstance,
  VoxelGrid
} from "./types";
import { deriveSceneSnapshot, type SceneSnapshot } from "./state";
import { injectBaseStyles } from "./styles";
import { diffScenes, type SceneDiffResult } from "./diff";
import type { RendererHandle } from "./renderer";
import { createDomRenderer } from "./domRenderer";

export type VoxSceneOptions = CreateVoxcssOptions;

export function voxScene(options: VoxSceneOptions = {}): VoxcssInstance {
  const state = {
    root: null as HTMLElement | null,
    grid: [] as VoxelGrid,
    shapes: { ...(options.shapes ?? {}) },
    hooks: options.hooks ?? {},
    userContext: { showWalls: options.showWalls, showFloor: options.showFloor, ...(options.context ?? {}) },
    documentRef: options.document ?? (typeof document !== "undefined" ? document : undefined),
    lastDiff: null as SceneDiffResult | null,
    rendererHandle: null as RendererHandle | null
  };

  let snapshot: SceneSnapshot = deriveSceneSnapshot({
    grid: state.grid,
    userContext: state.userContext
  });
  let previousSnapshotForDiff: SceneSnapshot | null = null;
  let lastDiff: SceneDiffResult | null = diffScenes(null, snapshot);
  state.lastDiff = lastDiff;
  previousSnapshotForDiff = snapshot;

  function mount(target: HTMLElement, grid: VoxelGrid, ctx: Partial<GridContext> = {}): void {
    state.root = target;
    updateState(grid, ctx);
    ensureDocument();
    injectBaseStyles(state.documentRef!);
    state.rendererHandle = createDomRenderer({
      documentRef: state.documentRef!,
      target: target,
      shapes: state.shapes,
      hooks: state.hooks
    });
    state.rendererHandle.applyInitial(snapshot);
    state.lastDiff = null;
    lastDiff = null;
    render();
  }

  function update(grid: VoxelGrid, ctx: Partial<GridContext> = {}): void {
    if (!state.root) {
      throw new Error("voxcss: mount() must be called before update().");
    }
    updateState(grid, ctx);
    render();
  }

  function destroy(): void {
    if (state.root) {
      state.root.innerHTML = "";
    }
    state.rendererHandle?.destroy();
    state.rendererHandle = null;
    state.root = null;
    state.grid = [];
  }

  function updateState(grid: VoxelGrid, ctx: Partial<GridContext>): void {
    const gridChanged = state.grid !== grid;
    state.grid = grid;
    state.userContext = { ...state.userContext, ...ctx };
    const prevSnapshot = snapshot;
    snapshot = deriveSceneSnapshot({
      grid: state.grid,
      userContext: state.userContext,
      previous: gridChanged ? null : snapshot
    });
    lastDiff = diffScenes(previousSnapshotForDiff, snapshot);
    state.lastDiff = lastDiff;
    previousSnapshotForDiff = snapshot;
  }

  function ensureDocument(): void {
    if (!state.documentRef) {
      throw new Error("voxcss: document is not available. Provide options.document when running outside the browser.");
    }
  }

  function render(): void {
    if (!state.root || !state.documentRef) return;
    if (!state.rendererHandle || !state.lastDiff) return;
    state.rendererHandle.applyPatches(snapshot, state.lastDiff.patches);
  }

  return { mount, update, destroy };
}

export function createVoxScene(options: VoxIllustrationOptions & VoxSceneOptions): VoxIllustrationHandle {
  const { element, voxels, ...rest } = options;
  const docRef = rest.document ?? (typeof document !== "undefined" ? document : undefined);
  const target =
    typeof element === "string"
      ? docRef?.querySelector(element)
      : element;

  if (!target) {
    throw new Error("voxcss: unable to resolve element for voxIllustration.");
  }

  const scene = voxScene(rest);
  scene.mount(target as HTMLElement, voxels, rest.context);

  return {
    scene,
    update(grid = voxels, context) {
      scene.update(grid, context ?? rest.context);
    },
    destroy() {
      scene.destroy();
    },
  };
}
