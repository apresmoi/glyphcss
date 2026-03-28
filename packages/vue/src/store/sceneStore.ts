/**
 * Lightweight reactive store for voxcss scene state.
 * Components subscribe to specific slices via selectors,
 * so only the components that care about a changed value re-render.
 */
import type { CameraState, WallsMask, CameraHandle } from "@layoutit/voxcss-core";
import { computeWallMask, wallMasksEqual } from "@layoutit/voxcss-core";

export interface SceneStoreState {
  cameraState: CameraState;
  wallMask: WallsMask;
}

export interface SceneStore {
  getState(): SceneStoreState;
  setState(partial: Partial<SceneStoreState>): void;
  subscribe(listener: () => void): () => void;

  /** Update camera + recompute wall mask. Only notifies if wall mask changed. Returns true if mask changed. */
  updateCameraFromRef(handle: CameraHandle): boolean;

  /** Force notify all subscribers (e.g. after prop-driven camera change). */
  notifyAll(): void;
}

export function createSceneStore(initial: CameraState): SceneStore {
  let state: SceneStoreState = {
    cameraState: { ...initial },
    wallMask: computeWallMask(initial.rotX, initial.rotY),
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
      const nextMask = computeWallMask(handle.state.rotX, handle.state.rotY);
      const maskChanged = !wallMasksEqual(state.wallMask, nextMask);

      if (maskChanged) {
        state = {
          cameraState: { ...handle.state },
          wallMask: nextMask,
        };
        notify();
      }

      return maskChanged;
    },

    notifyAll() {
      notify();
    },
  };
}
