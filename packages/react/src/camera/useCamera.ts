import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createIsometricCamera } from "@polycss/core";
import type { CameraState, CameraHandle, AutoRotateOption, AutoRotateConfig } from "@polycss/core";
import { createSceneStore, type SceneStore } from "../store/sceneStore";

const POINTER_DRAG_SPEED = 5;

export interface UseCameraOptions {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  interactive?: boolean;
  invert?: boolean | number;
  animate?: AutoRotateOption | false;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: React.MutableRefObject<CameraHandle>;
  sceneElRef: React.MutableRefObject<HTMLElement | null>;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  cursor: string;
}

function normalizeAngle(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

function normalizeAutoRotateOption(
  option: AutoRotateOption
): { axis: "x" | "y"; speed: number; pauseOnInteraction: boolean } | null {
  if (!option) return null;
  if (option === true) return { axis: "y", speed: 0.3, pauseOnInteraction: true };
  if (typeof option === "number") {
    if (!Number.isFinite(option) || option === 0) return null;
    return { axis: "y", speed: option, pauseOnInteraction: true };
  }
  const config = option as AutoRotateConfig;
  const speed =
    typeof config.speed === "number" && Number.isFinite(config.speed) ? config.speed : 0.3;
  if (!speed) return null;
  return {
    axis: config.axis === "x" ? "x" : "y",
    speed,
    pauseOnInteraction: config.pauseOnInteraction !== false,
  };
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

  // Create store once — only notifies subscribers when wall mask changes
  const store = useMemo(
    () => createSceneStore(handleRef.current!.state),
    []
  );

  const [isDragging, setIsDragging] = useState(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const animationPausedRef = useRef(false);

  const invertRef = useRef(1);
  invertRef.current =
    typeof options.invert === "number"
      ? options.invert < 0
        ? -1
        : 1
      : options.invert === true
        ? -1
        : 1;

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
        const depthOffset = Number(el.dataset.voxDepthOffset ?? 0);
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
    const depthOffset = Number(el.dataset.voxDepthOffset ?? 0);
    el.style.transform = `scale(${s.zoom}) translateY(${depthOffset}px) translateY(${s.tilt}px) translateX(${s.pan}px) rotateX(${s.rotX}deg) rotate(${s.rotY}deg)`;
  }, []);


  // Auto-rotate
  useEffect(() => {
    if (!options.animate) return;
    const config = normalizeAutoRotateOption(options.animate);
    if (!config) return;

    let frameId: number;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (!animationPausedRef.current) {
        const handle = handleRef.current!;
        if (config.axis === "x") {
          handle.update({ rotX: normalizeAngle(handle.state.rotX + config.speed) });
        } else {
          handle.update({ rotY: normalizeAngle(handle.state.rotY + config.speed) });
        }
        applyTransformDirect();
        store.updateCameraFromRef(handle);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
    };
  }, [options.animate, applyTransformDirect, store]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!options.interactive) return;
      if (activePointerIdRef.current !== null) return;
      if (e.isPrimary === false) return;

      const animConfig = options.animate ? normalizeAutoRotateOption(options.animate) : null;
      if (animConfig?.pauseOnInteraction) {
        animationPausedRef.current = true;
      }

      e.preventDefault();
      activePointerIdRef.current = e.pointerId;
      pointerRef.current = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture errors
      }
    },
    [options.interactive, options.animate]
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) return;
    e.preventDefault();
    const handle = handleRef.current!;
    const dX = ((e.clientX - pointerRef.current.x) * invertRef.current) / POINTER_DRAG_SPEED;
    const dY = ((e.clientY - pointerRef.current.y) * invertRef.current) / POINTER_DRAG_SPEED;
    handle.update({
      rotX: Math.max(0, Math.min(100, handle.state.rotX - dY)),
      rotY: (handle.state.rotY - dX + 360) % 360,
    });
    applyTransformDirect();
    pointerRef.current = { x: e.clientX, y: e.clientY };

    // Update store dirBin state (kept as inert state for v0.2)
    store.updateCameraFromRef(handle);
  }, [applyTransformDirect, store]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    setIsDragging(false);
    animationPausedRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
  }, []);

  return {
    store,
    cameraRef: handleRef as React.MutableRefObject<CameraHandle>,
    sceneElRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    cursor: !options.interactive ? "default" : isDragging ? "grabbing" : "grab",
  };
}
