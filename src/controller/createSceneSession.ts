import { createSceneHost, type SceneHost } from "./createSceneHost";
import type { SceneController } from "./createSceneController";
import { buildSceneContext } from "../core/context";
import { normalizeSceneState, type NormalizedSceneState, type SceneStateInput } from "./sceneOptions";
import type { GridContext } from "../core";

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
  getState(): SceneSessionState;
  getHost(): SceneHost;
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
    destroy,
    getState() {
      return { ...state };
    },
    getHost() {
      return host;
    }
  };
}
