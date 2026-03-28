/**
 * Lightweight reactive store for voxcss scene state.
 * Uses useSyncExternalStore under the hood — zero dependencies.
 * Components subscribe to specific slices via selectors,
 * so only the components that care about a changed value re-render.
 */
import { useSyncExternalStore, useRef, useCallback } from "react";
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

/**
 * Subscribe to a slice of the scene store.
 * Only re-renders when the selected value changes (by reference).
 */
export function useStoreSelector<T>(
  store: SceneStore,
  selector: (state: SceneStoreState) => T
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot);
}
