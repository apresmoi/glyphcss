import type { SceneController } from "./sceneController";
import type { ProjectionMode, VoxelGrid, SceneSnapshot } from "../core";
import { deriveSceneSnapshot } from "../core/state";
import { diffScenes } from "../core/diff";
import { createDomRenderer } from "../core/domRenderer";
import { injectBaseStyles } from "../core/styles";

const DEFAULT_SCENE_FLAGS = {
  showWalls: false,
  showFloor: false,
  projection: "cubic" as ProjectionMode
};

export interface SceneStateInput {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export interface SceneStateShape extends SceneStateInput {
  voxels: VoxelGrid;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
}

export const EMPTY_VOXELS: VoxelGrid = [];

export function normalizeSceneState(
  input: SceneStateInput = {},
  fallback?: SceneStateShape
): SceneStateShape {
  return {
    voxels: input.voxels ?? fallback?.voxels ?? EMPTY_VOXELS,
    rows: input.rows ?? fallback?.rows,
    cols: input.cols ?? fallback?.cols,
    depth: input.depth ?? fallback?.depth,
    showWalls: input.showWalls ?? fallback?.showWalls ?? DEFAULT_SCENE_FLAGS.showWalls,
    showFloor: input.showFloor ?? fallback?.showFloor ?? DEFAULT_SCENE_FLAGS.showFloor,
    projection: input.projection ?? fallback?.projection ?? DEFAULT_SCENE_FLAGS.projection
  };
}

interface SceneRendererHandle {
  update(state: SceneStateShape): void;
  destroy(): void;
}

interface SceneRendererOptions {
  controller: SceneController;
  element: HTMLElement;
  state: SceneStateShape;
}

function createSceneRenderer(options: SceneRendererOptions): SceneRendererHandle {
  const controller = options.controller;
  const element = options.element;
  let state: SceneStateShape = normalizeSceneState(options.state);
  let previousSnapshot: SceneSnapshot | null = null;

  const documentRef = element.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  if (!documentRef) {
    throw new Error("voxcss: document is not available. Provide a host element attached to a document.");
  }
  injectBaseStyles(documentRef);
  const renderer = createDomRenderer({
    documentRef,
    target: element
  });

  const applyBoxStyle = (style: Record<string, string>) => {
    for (const [key, value] of Object.entries(style)) {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    }
  };

  applyBoxStyle(controller.getBoxStyle());
  const unsubscribeBox = controller.subscribeBoxStyle(applyBoxStyle);

  const renderScene = () => {
    const contextSnapshot = controller.applySceneState(state);
    const nextSnapshot = deriveSceneSnapshot({
      grid: state.voxels,
      userContext: contextSnapshot,
      previous: previousSnapshot,
      analysis: contextSnapshot.analysis
    });
    if (!previousSnapshot) {
      renderer.applyInitial(nextSnapshot);
    } else {
      const diff = diffScenes(previousSnapshot, nextSnapshot);
      renderer.applyPatches(nextSnapshot, diff.patches);
    }
    previousSnapshot = nextSnapshot;
  };

  renderScene();

  const unsubscribeWalls = controller.subscribeWalls(() => renderScene());
  const unsubscribeDimensions = controller.subscribeDimensions(() => renderScene());

  return {
    update(nextState) {
      state = normalizeSceneState(nextState, state);
      renderScene();
    },
    destroy() {
      unsubscribeBox();
      unsubscribeWalls();
      unsubscribeDimensions();
      renderer.destroy();
      previousSnapshot = null;
    }
  };
}

export interface SceneBindingOptions extends SceneStateInput {
  controller: SceneController;
  element: HTMLElement;
}

export interface SceneBindingHandle {
  update(options: SceneStateInput): void;
  destroy(): void;
}

export function createSceneBinding(options: SceneBindingOptions): SceneBindingHandle {
  if (!options.element) {
    throw new Error("voxcss: createSceneBinding requires an element.");
  }
  const controller = options.controller;
  let state: SceneStateShape = normalizeSceneState(options);
  const renderer = createSceneRenderer({
    controller,
    element: options.element,
    state
  });

  return {
    update(next) {
      state = normalizeSceneState(next, state);
      renderer.update(state);
    },
    destroy() {
      renderer.destroy();
    }
  };
}

export interface SceneComponentProps extends SceneStateInput {}

export const SCENE_HOST_CLASS = "voxcss-scene-host";

export function ensureSceneController(controller: SceneController | null): SceneController {
  if (!controller) {
    throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
  }
  return controller;
}
