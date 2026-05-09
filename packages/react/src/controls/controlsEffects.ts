/**
 * Shared wheel-zoom and animate-loop effect factories for
 * PolyOrbitControls and PolyMapControls.
 */
import type { MutableRefObject } from "react";
import type { CameraHandle } from "@layoutit/polycss-core";
import type { SceneStore } from "../store/sceneStore";
import type { PolyControlsAnimateOptions } from "./sharedControls";

const WHEEL_IDLE_END_MS = 150;
const ZOOM_STEP = 0.0008;
const ANIM_FRAME_MS = 16.67;
const ANIM_DT_CLAMP_MS = 50;
const DEFAULT_ANIMATE_SPEED = 0.3;

interface WheelEffectArgs {
  wheel: boolean;
  wheelRef: MutableRefObject<boolean>;
  zoomMinRef: MutableRefObject<number>;
  zoomMaxRef: MutableRefObject<number>;
  cameraElRef: MutableRefObject<HTMLElement | null>;
  cameraRef: MutableRefObject<CameraHandle>;
  applyTransformDirect: () => void;
  store: SceneStore;
  fireStart: () => void;
  fireChange: () => void;
  fireEnd: () => void;
}

export function makeWheelEffect({
  wheel,
  wheelRef,
  zoomMinRef,
  zoomMaxRef,
  cameraElRef,
  cameraRef,
  applyTransformDirect,
  store,
  fireStart,
  fireChange,
  fireEnd,
}: WheelEffectArgs): (() => void) | void {
  if (!wheel) return;
  const el = cameraElRef.current;
  if (!el) return;

  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const onWheel = (e: WheelEvent): void => {
    if (!wheelRef.current) return;
    e.preventDefault();
    const lineFactor = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    const factor = Math.exp(-e.deltaY * lineFactor * ZOOM_STEP);
    const handle = cameraRef.current;
    const next = Math.max(
      zoomMinRef.current,
      Math.min(zoomMaxRef.current, handle.state.zoom * factor),
    );
    handle.update({ zoom: next });
    applyTransformDirect();
    store.updateCameraFromRef(handle);
    if (!wheelActive) {
      wheelActive = true;
      fireStart();
    }
    fireChange();
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null;
      wheelActive = false;
      fireEnd();
    }, WHEEL_IDLE_END_MS);
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", onWheel);
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
  };
}

interface AnimateEffectArgs {
  animateOn: boolean;
  animateRef: MutableRefObject<false | PolyControlsAnimateOptions>;
  animationPausedShared: { value: boolean };
  applyTransformDirect: () => void;
  cameraRef: MutableRefObject<CameraHandle>;
  store: SceneStore;
  fireChange: () => void;
}

export function makeAnimateEffect({
  animateOn,
  animateRef,
  animationPausedShared,
  applyTransformDirect,
  cameraRef,
  store,
  fireChange,
}: AnimateEffectArgs): (() => void) | void {
  if (!animateOn) return;
  let rafId: number | null = null;
  let stopped = false;
  let lastTime = 0;
  const tick = (now: number): void => {
    if (stopped) return;
    const a = animateRef.current;
    if (!a) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    if (!animationPausedShared.value) {
      const dt = Math.min(ANIM_DT_CLAMP_MS, lastTime ? now - lastTime : ANIM_FRAME_MS);
      lastTime = now;
      const speed = a.speed ?? DEFAULT_ANIMATE_SPEED;
      const delta = speed * (dt / ANIM_FRAME_MS);
      const handle = cameraRef.current;
      const s = handle.state;
      if (a.axis === "x") {
        const rotX = (((s.rotX + delta) % 360) + 360) % 360;
        handle.update({ rotX });
      } else {
        const rotY = (((s.rotY + delta) % 360) + 360) % 360;
        handle.update({ rotY });
      }
      applyTransformDirect();
      store.updateCameraFromRef(handle);
      fireChange();
    } else {
      lastTime = now;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
