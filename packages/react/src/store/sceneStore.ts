/**
 * Lightweight reactive store for polycss scene state.
 * Uses useSyncExternalStore under the hood — zero dependencies.
 * Components subscribe to specific slices via selectors,
 * so only the components that care about a changed value re-render.
 */
import { useSyncExternalStore, useRef, useCallback } from "react";
import type { CameraState, CameraHandle, Vec3 } from "@layoutit/polycss-core";

export interface SceneStoreState {
  cameraState: CameraState;
  /**
   * Bbox-center of all auto-centerable meshes in world coords. Kept separate
   * from `target` so user pan (written to `target` by controls) survives mesh
   * add/remove without fighting the auto-managed centering offset.
   * [0, 0, 0] when autoCenter is off or there are no centerable meshes.
   */
  autoCenterOffset: Vec3;
}

export interface SceneStore {
  getState(): SceneStoreState;
  setState(partial: Partial<SceneStoreState>): void;
  subscribe(listener: () => void): () => void;

  /** Update camera state from the current imperative camera handle. */
  updateCameraFromRef(handle: CameraHandle): boolean;

  /** Force notify all subscribers (e.g. after prop-driven camera change). */
  notifyAll(): void;

  /** Update the autoCenterOffset (world coords bbox center). */
  setAutoCenterOffset(offset: Vec3): void;
}

export function createSceneStore(initial: CameraState): SceneStore {
  let state: SceneStoreState = {
    cameraState: { ...initial },
    autoCenterOffset: [0, 0, 0],
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
      state = { ...state, cameraState: { ...handle.state } };
      notify();
      return true;
    },

    notifyAll() {
      notify();
    },

    setAutoCenterOffset(offset) {
      state = { ...state, autoCenterOffset: offset };
      // No notify — the offset is read synchronously by applyTransformDirect;
      // PolyScene re-renders on its own when the bbox-derived useMemo fires.
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
