import type { SceneController } from "./createSceneController";
import { createSceneSession, type SceneSessionHandle } from "./createSceneSession";
import type { ProjectionMode, VoxelGrid } from "../core";

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
    current = { ...current, ...next };
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

  const setVoxels = (voxels: VoxelGrid) => {
    current.voxels = voxels;
    if (!mounted || !session) return;
    session.setState({ voxels });
  };

  const destroy = () => {
    session?.destroy();
    session = null;
    mounted = false;
  };

  return {
    mount,
    update,
    setVoxels,
    destroy
  };
}
