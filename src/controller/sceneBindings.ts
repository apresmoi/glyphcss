import type { SceneController } from "./sceneController";
import type { ProjectionMode, VoxelGrid, VoxIllustrationHandle } from "../core";
import { createVoxScene } from "../core/scene";
import {
  normalizeSceneState,
  type NormalizedSceneState,
  extractSceneState,
  type SceneStateInput,
  type SceneStateShape
} from "./sceneOptions";

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
  let state: NormalizedSceneState = normalizeSceneState(options.state);
  let handle: VoxIllustrationHandle | null = null;

  const applyBoxStyle = (style: Record<string, string>) => {
    for (const [key, value] of Object.entries(style)) {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    }
  };

  applyBoxStyle(controller.getBoxStyle());
  const unsubscribeBox = controller.subscribeBoxStyle(applyBoxStyle);

  const renderScene = () => {
    const snapshot = controller.applySceneState(state);
    if (!handle) {
      handle = createVoxScene({
        element,
        voxels: state.voxels,
        context: snapshot
      });
    } else {
      handle.update(state.voxels, snapshot);
    }
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
      handle?.destroy();
      handle = null;
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
  let state: NormalizedSceneState = normalizeSceneState(options);
  const renderer = createSceneRenderer({
    controller,
    element: options.element,
    state: extractSceneState(state)
  });

  return {
    update(next) {
      state = normalizeSceneState(next, state);
      renderer.update(extractSceneState(state));
    },
    destroy() {
      renderer.destroy();
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
