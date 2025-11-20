import type { SceneController } from "./createSceneController";
import { createSceneSession, type SceneSessionHandle } from "./createSceneSession";
import type { ProjectionMode, VoxelGrid } from "../core";
import { DEFAULT_SCENE_FLAGS } from "./defaults";

export interface SceneBindingOptions {
  controller: SceneController;
  element: HTMLElement | null;
  voxels?: VoxelGrid;
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
  destroy(): void;
}

type BindingState = SceneBindingOptions & {
  voxels: VoxelGrid;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
};

const EMPTY_VOXELS: VoxelGrid = [];

function applyDefaults(options: SceneBindingOptions): BindingState {
  return {
    ...options,
    voxels: options.voxels ?? EMPTY_VOXELS,
    showWalls: options.showWalls ?? DEFAULT_SCENE_FLAGS.showWalls,
    showFloor: options.showFloor ?? DEFAULT_SCENE_FLAGS.showFloor,
    projection: options.projection ?? DEFAULT_SCENE_FLAGS.projection
  };
}

export function createSceneBinding(initial: SceneBindingOptions): SceneBindingHandle {
  let current: BindingState = applyDefaults(initial);
  let session: SceneSessionHandle | null = null;
  let mounted = false;

  const mount = () => {
    if (mounted) return;
    const element = current.element;
    if (!element) return;
    session = createSceneSession({
      controller: current.controller,
      element,
      voxels: current.voxels,
      rows: current.rows,
      cols: current.cols,
      depth: current.depth,
      showWalls: current.showWalls,
      showFloor: current.showFloor,
      projection: current.projection
    });
    session.mount();
    mounted = true;
  };

  const update = (next: Partial<Omit<SceneBindingOptions, "controller" | "element">>) => {
    current = applyDefaults({ ...current, ...next });
    if (!mounted || !session) return;
    session.setState({
      voxels: current.voxels,
      rows: current.rows,
      cols: current.cols,
      depth: current.depth,
      showWalls: current.showWalls,
      showFloor: current.showFloor,
      projection: current.projection
    });
  };

  const destroy = () => {
    session?.destroy();
    session = null;
    mounted = false;
  };

  return {
    mount,
    update,
    destroy
  };
}
