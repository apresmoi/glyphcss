/**
 * Lightweight reactive store for polycss scene state.
 * Uses useSyncExternalStore under the hood — zero dependencies.
 * Components subscribe to specific slices via selectors,
 * so only the components that care about a changed value re-render.
 */
import { useSyncExternalStore, useRef, useCallback } from "react";
import type { CameraState, CameraHandle } from "@polycss/core";
import { directionBinFromCamera } from "@polycss/core";

export interface SceneStoreState {
  cameraState: CameraState;
  /**
   * Current camera-direction bin index.
   * Kept as inert state for v0.2's direction-bin culling (POLY-TD-11).
   * In v1, no CSS classes are emitted for this value.
   */
  dirBin: number;
}

export interface SceneStore {
  getState(): SceneStoreState;
  setState(partial: Partial<SceneStoreState>): void;
  subscribe(listener: () => void): () => void;

  /**
   * Update camera + recompute dirBin.
   * Only notifies subscribers if dirBin changed.
   * Returns true if dirBin changed.
   */
  updateCameraFromRef(handle: CameraHandle): boolean;

  /** Force notify all subscribers (e.g. after prop-driven camera change). */
  notifyAll(): void;
}

export function createSceneStore(initial: CameraState): SceneStore {
  let state: SceneStoreState = {
    cameraState: { ...initial },
    dirBin: directionBinFromCamera(initial.rotX, initial.rotY),
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
      const nextDirBin = directionBinFromCamera(handle.state.rotX, handle.state.rotY);
      const dirBinChanged = state.dirBin !== nextDirBin;

      if (dirBinChanged) {
        state = {
          cameraState: { ...handle.state },
          dirBin: nextDirBin,
        };
        notify();
      }

      return dirBinChanged;
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
