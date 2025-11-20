import { createSceneHost, type SceneHost } from "./createSceneHost";
import type { SceneController } from "./createSceneController";
import { buildSceneContext } from "../core/context";
import type { GridContext, ProjectionMode, VoxelGrid } from "../core";

export interface SceneSessionState {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export interface SceneSessionOptions extends SceneSessionState {
  controller: SceneController;
  element: HTMLElement;
  host?: SceneHost;
  buildContextExtras?: () => Partial<GridContext>;
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
  const buildContextExtras = options.buildContextExtras;

  let state: SceneSessionState = {
    voxels: options.voxels ?? [],
    rows: options.rows,
    cols: options.cols,
    depth: options.depth,
    showWalls: options.showWalls ?? false,
    showFloor: options.showFloor ?? false,
    projection: options.projection
  };
  let mounted = false;

  const applyBoxStyle = (style: Record<string, string>) => {
    for (const [key, value] of Object.entries(style)) {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    }
  };

  applyBoxStyle(controller.getBoxStyle());
  const unsubscribeBox = controller.subscribeBoxStyle(applyBoxStyle);
  const unsubscribeDimensions = controller.subscribeDimensions(() => {
    if (!mounted) return;
    host.setState({ context: buildContextSnapshot() });
    host.flush();
  });

  const buildContextSnapshot = () => {
    const projection = state.projection;
    controller.setProjection?.(projection);
    const baseContext: Partial<GridContext> = {
      rows: state.rows,
      cols: state.cols,
      depth: state.depth,
      showWalls: state.showWalls,
      showFloor: state.showFloor,
      projection,
      walls: controller.getWalls()
    };
    const extra = buildContextExtras?.() ?? {};
    const scene = buildSceneContext({
      grid: state.voxels,
      context: { ...baseContext, ...extra }
    });
    const nextDimensions = scene.dimensions;
    const currentDimensions = controller.getDimensions();
    if (
      nextDimensions.rows !== currentDimensions.rows ||
      nextDimensions.cols !== currentDimensions.cols ||
      nextDimensions.depth !== currentDimensions.depth
    ) {
      controller.setDimensions(nextDimensions);
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
    state = { ...state, ...next };
    if (!mounted) return;
    host.setState({ voxels: state.voxels, context: buildContextSnapshot() });
    host.flush();
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
