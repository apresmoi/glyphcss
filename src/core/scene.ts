/* Scene lifecycle: voxScene host and createVoxScene convenience wrapper. */
import type {
  SceneOptions,
  GridContext,
  VoxIllustrationHandle,
  VoxIllustrationOptions,
  VoxcssInstance,
  VoxelGrid
} from "./types";
import { deriveSceneSnapshot, type SceneSnapshot } from "./state";
import { injectBaseStyles } from "./styles";
import { diffScenes } from "./diff";
import type { RendererHandle } from "./renderer";
import { createDomRenderer } from "./domRenderer";
import type { SceneAnalysisPayload } from "./types";

export type VoxSceneOptions = SceneOptions;

export function voxScene(options: VoxSceneOptions = {}): VoxcssInstance {
  const state = {
    root: null as HTMLElement | null,
    grid: [] as VoxelGrid,
    userContext: sanitizeUserContext({ showWalls: options.showWalls, showFloor: options.showFloor, ...(options.context ?? {}) }),
    documentRef: options.document ?? (typeof document !== "undefined" ? document : undefined),
    rendererHandle: null as RendererHandle | null
  };

  let snapshot: SceneSnapshot = deriveSceneSnapshot({
    grid: state.grid,
    userContext: state.userContext
  });
  let previousSnapshot: SceneSnapshot | null = null;

  function mount(target: HTMLElement, grid: VoxelGrid, ctx: Partial<GridContext> = {}): void {
    state.root = target;
    updateState(grid, ctx);
    ensureDocument();
    injectBaseStyles(state.documentRef!);
    state.rendererHandle = createDomRenderer({
      documentRef: state.documentRef!,
      target: target
    });
    state.rendererHandle.applyInitial(snapshot);
    previousSnapshot = snapshot;
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
    const { cleanedContext, analysis } = splitContextPayload(ctx);
    state.userContext = cleanedContext ? { ...state.userContext, ...cleanedContext } : state.userContext;
    const reuseSnapshot = gridChanged ? null : snapshot;
    const nextSnapshot = deriveSceneSnapshot({
      grid: state.grid,
      userContext: state.userContext,
      previous: reuseSnapshot,
      analysis
    });
    previousSnapshot = snapshot;
    snapshot = nextSnapshot;
  }

  function ensureDocument(): void {
    if (!state.documentRef) {
      throw new Error("voxcss: document is not available. Provide options.document when running outside the browser.");
    }
  }

  function render(): void {
    if (!state.root || !state.documentRef) return;
    if (!state.rendererHandle || !previousSnapshot) return;
    const diff = diffScenes(previousSnapshot, snapshot);
    state.rendererHandle.applyPatches(snapshot, diff.patches);
    previousSnapshot = snapshot;
  }

  return { mount, update, destroy };
}

function splitContextPayload(ctx?: Partial<GridContext>): { cleanedContext?: Partial<GridContext>; analysis?: SceneAnalysisPayload } {
  if (!ctx) return {};
  const maybeSnapshot = ctx as Partial<GridContext> & { analysis?: SceneAnalysisPayload };
  const analysis = maybeSnapshot.analysis;
  if (!analysis) return { cleanedContext: ctx };
  const { analysis: _analysis, ...rest } = maybeSnapshot;
  return { cleanedContext: rest, analysis };
}

function sanitizeUserContext(ctx: Partial<GridContext>): Partial<GridContext> {
  const { cleanedContext } = splitContextPayload(ctx);
  return cleanedContext ?? {};
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
