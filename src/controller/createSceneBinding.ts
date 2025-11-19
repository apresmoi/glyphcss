import { createSceneHost } from "./createSceneHost";
import type { SceneHost } from "./createSceneHost";
import type { SceneController } from "./createSceneController";
import { buildSceneContext, inferGridDimensions } from "../core/context";
import type { ProjectionMode, SceneDimensions, VoxelGrid } from "../core";

export interface SceneBindingOptions {
  controller: SceneController;
  element: HTMLElement | null;
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
}

export interface SceneBindingHandle {
  mount(): void;
  update(options: Partial<Omit<SceneBindingOptions, "controller" | "element">>): void;
  setVoxels(voxels: VoxelGrid): void;
  destroy(): void;
}

export function createSceneBinding(initial: SceneBindingOptions): SceneBindingHandle {
  let current: SceneBindingOptions = { ...initial };
  let host: SceneHost | null = null;
  let mounted = false;
  let lastDimensions: Required<SceneDimensions> | null = null;

  const ensureHost = () => {
    if (!host) {
      host = createSceneHost();
    }
    return host;
  };

  const computeDimensions = (dims: SceneDimensions, controller: SceneController) => {
    if (!dims.rows || !dims.cols || !dims.depth) {
      const inferred = inferGridDimensions(current.voxels);
      dims = {
        rows: dims.rows ?? inferred.rows,
        cols: dims.cols ?? inferred.cols,
        depth: dims.depth ?? inferred.depth
      };
    }
    const existing = controller.getDimensions();
    if (dims.rows !== existing.rows || dims.cols !== existing.cols || dims.depth !== existing.depth) {
      controller.setDimensions(dims);
    }
    lastDimensions = dims as Required<SceneDimensions>;
  };

  const buildContextSnapshot = () => {
    const projectionMode: ProjectionMode | undefined = current.projection;
    const controller = current.controller;
    controller.setProjection?.(projectionMode);
    const snapshot = buildSceneContext({
      grid: current.voxels,
      context: {
        rows: current.rows,
        cols: current.cols,
        depth: current.depth,
        showWalls: current.showWalls,
        showFloor: current.showFloor,
        projection: projectionMode,
        walls: controller.getWalls()
      },
      dimensions: controller.getDimensions()
    });
    computeDimensions(snapshot.dimensions, controller);
    return snapshot;
  };

  const mount = () => {
    if (mounted) return;
    const element = current.element;
    if (!element) return;
    const hostInstance = ensureHost();
    const snapshot = buildContextSnapshot();
    hostInstance.mount(element, current.voxels, snapshot.snapshot);
    hostInstance.syncController(current.controller, () => buildContextSnapshot().snapshot);
    mounted = true;
  };

  const update = (next: Partial<Omit<SceneBindingOptions, "controller" | "element">>) => {
    current = { ...current, ...next };
    if (!mounted || !host) return;
    const snapshot = buildContextSnapshot();
    host.setState({ context: snapshot.snapshot, voxels: current.voxels });
    host.flush();
  };

  const setVoxels = (voxels: VoxelGrid) => {
    current.voxels = voxels;
    update({});
  };

  const destroy = () => {
    host?.destroy();
    host = null;
    mounted = false;
    lastDimensions = null;
  };

  return {
    mount,
    update,
    setVoxels,
    destroy
  };
}
