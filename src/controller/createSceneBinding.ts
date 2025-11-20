import type { SceneController } from "./createSceneController";
import { createSceneSession, type SceneSessionHandle } from "./createSceneSession";
import type { ProjectionMode, VoxelGrid } from "../core";
import type { SceneHost } from "./createSceneHost";
import { normalizeSceneState, type NormalizedSceneState, extractSceneState } from "./sceneOptions";

export interface SceneBindingOptions {
  controller: SceneController;
  element: HTMLElement | null;
  host?: SceneHost;
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
  onSessionChange?(session: SceneSessionHandle | null): void;
}

export interface SceneBindingHandle {
  mount(): void;
  update(options: Partial<Omit<SceneBindingOptions, "controller" | "element">>): void;
  destroy(): void;
}

type BindingState = Omit<SceneBindingOptions, keyof NormalizedSceneState> & NormalizedSceneState;

export function createSceneBinding(initial: SceneBindingOptions): SceneBindingHandle {
  let current: BindingState = {
    ...initial,
    ...normalizeSceneState(initial)
  };
  let session: SceneSessionHandle | null = null;
  let mounted = false;

  const mount = () => {
    if (mounted) return;
    const element = current.element;
    if (!element) return;
    session = createSceneSession({
      controller: current.controller,
      element,
      host: current.host,
      ...extractSceneState(current)
    });
    session.mount();
    current.onSessionChange?.(session);
    mounted = true;
  };

  const update = (next: Partial<Omit<SceneBindingOptions, "controller" | "element">>) => {
    current = {
      ...current,
      ...next,
      ...normalizeSceneState(next, current)
    };
    if (!mounted || !session) return;
    session.setState(extractSceneState(current));
  };

  const destroy = () => {
    session?.destroy();
    current.onSessionChange?.(null);
    session = null;
    mounted = false;
  };

  return {
    mount,
    update,
    destroy
  };
}
