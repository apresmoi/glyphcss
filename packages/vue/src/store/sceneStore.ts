/**
 * Lightweight reactive store for polycss scene state.
 * Components subscribe to specific slices via selectors,
 * so only the components that care about a changed value re-render.
 */
import type { CameraState, CameraHandle } from "@layoutit/polycss-core";

export interface SceneStoreState {
  cameraState: CameraState;
}

export interface SceneStore {
  getState(): SceneStoreState;
  setState(partial: Partial<SceneStoreState>): void;
  subscribe(listener: () => void): () => void;

  /** Update camera state from the current imperative camera handle. */
  updateCameraFromRef(handle: CameraHandle): boolean;

  /** Force notify all subscribers (e.g. after prop-driven camera change). */
  notifyAll(): void;
}

export function createSceneStore(initial: CameraState): SceneStore {
  let state: SceneStoreState = {
    cameraState: { ...initial },
  };

  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    getState() {
      return state;
    },

    setState(partial) {
      state = { ...state, ...partial };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    updateCameraFromRef(handle) {
      state = { cameraState: { ...handle.state } };
      notify();
      return true;
    },

    notifyAll() {
      notify();
    },
  };
}
