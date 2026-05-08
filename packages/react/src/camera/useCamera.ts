import { useRef, useCallback, useEffect, useMemo } from "react";
import { createIsometricCamera } from "@polycss/core";
import type { CameraState, CameraHandle } from "@polycss/core";
import { createSceneStore, type SceneStore } from "../store/sceneStore";

export interface UseCameraOptions {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: React.MutableRefObject<CameraHandle>;
  sceneElRef: React.MutableRefObject<HTMLElement | null>;
  /**
   * Attach to the camera root element. Layered components like
   * <PolyControls> need the underlying ref to wire non-passive wheel /
   * pointer listeners (React's synthetic onWheel is passive in modern
   * versions and can't preventDefault).
   */
  cameraElRef: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * Apply the current camera state (from cameraRef.current.state) directly
   * to sceneEl.style.transform — bypasses React. Exposed so layered
   * components like <PolyControls> can call it after mutating state.
   */
  applyTransformDirect: () => void;
}

export function useCamera(options: UseCameraOptions): UseCameraResult {
  const handleRef = useRef<CameraHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = createIsometricCamera({
      zoom: options.zoom,
      pan: options.pan,
      tilt: options.tilt,
      rotX: options.rotX,
      rotY: options.rotY,
    });
  }

  const sceneElRef = useRef<HTMLElement | null>(null);
  const cameraElRef = useRef<HTMLDivElement | null>(null);

  // Create store once; camera props and controls sync into this store.
  const store = useMemo(
    () => createSceneStore(handleRef.current!.state),
    []
  );

  // Sync prop changes to camera handle
  useEffect(() => {
    const handle = handleRef.current!;
    const next: Partial<CameraState> = {};
    if (options.zoom !== undefined) next.zoom = options.zoom;
    if (options.pan !== undefined) next.pan = options.pan;
    if (options.tilt !== undefined) next.tilt = options.tilt;
    if (options.rotX !== undefined) next.rotX = options.rotX;
    if (options.rotY !== undefined) next.rotY = options.rotY;
    if (Object.keys(next).length > 0) {
      handle.update(next);
      // Apply transform directly to DOM
      const el = sceneElRef.current;
      if (el) {
        const s = handle.state;
        const depthOffset = Number(el.dataset.polycssDepthOffset ?? 0);
        el.style.transform = `scale(${s.zoom}) translateY(${depthOffset}px) translateY(${s.tilt}px) translateX(${s.pan}px) rotateX(${s.rotX}deg) rotate(${s.rotY}deg)`;
      }
      store.updateCameraFromRef(handle);
      store.notifyAll(); // props changed — always notify
    }
  }, [options.zoom, options.pan, options.tilt, options.rotX, options.rotY, store]);

  // Apply camera transform directly to scene element (bypasses React)
  const applyTransformDirect = useCallback(() => {
    const el = sceneElRef.current;
    if (!el) return;
    const handle = handleRef.current!;
    const s = handle.state;
    const depthOffset = Number(el.dataset.polycssDepthOffset ?? 0);
    el.style.transform = `scale(${s.zoom}) translateY(${depthOffset}px) translateY(${s.tilt}px) translateX(${s.pan}px) rotateX(${s.rotX}deg) rotate(${s.rotY}deg)`;
  }, []);

  return {
    store,
    cameraRef: handleRef as React.MutableRefObject<CameraHandle>,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  };
}
