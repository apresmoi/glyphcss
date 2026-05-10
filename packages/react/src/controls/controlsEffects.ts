/**
 * Shared wheel-zoom and animate-loop effect factories for
 * PolyOrbitControls and PolyMapControls.
 */
import type { MutableRefObject } from "react";
import type { CameraHandle } from "@layoutit/polycss-core";
import type { SceneStore } from "../store/sceneStore";
import type { PolyControlsAnimateOptions } from "./sharedControls";

const WHEEL_IDLE_END_MS = 150;
// Three.js OrbitControls-style zoom curve (Math.pow(0.95, |delta|*0.01)).
// Translated to exp-based: Math.exp(-|delta|*0.01*ln(1/0.95)) = exp(-|delta|*0.000513).
// Slightly gentler than the previous 0.0008 to match three.js feel.
const ZOOM_STEP = 0.000513;
// macOS trackpad pinch-to-zoom sends wheel events with ctrlKey=true and small
// deltaY values. Without amplification they barely move the zoom — three.js
// multiplies by 10 to make pinch responsive.
const PINCH_AMP = 10;
// Two-finger trackpad scroll fires many more events per gesture than pinch,
// but each event has a smaller delta. Without amplification scroll feels much
// weaker than pinch for the same physical gesture. ×3 brings them in line.
const SCROLL_AMP = 3;
const ANIM_FRAME_MS = 16.67;
const ANIM_DT_CLAMP_MS = 50;
const DEFAULT_ANIMATE_SPEED = 0.3;

interface WheelEffectArgs {
  wheel: boolean;
  dollyRef: MutableRefObject<boolean>;
  wheelRef: MutableRefObject<boolean>;
  zoomMinRef: MutableRefObject<number>;
  zoomMaxRef: MutableRefObject<number>;
  distanceMinRef: MutableRefObject<number>;
  distanceMaxRef: MutableRefObject<number>;
  cameraElRef: MutableRefObject<HTMLElement | null>;
  cameraRef: MutableRefObject<CameraHandle>;
  applyTransformDirect: () => void;
  store: SceneStore;
  fireStart: () => void;
  fireChange: () => void;
  fireEnd: () => void;
}

// Distance step in CSS pixels per unit wheel delta — analogous to ZOOM_STEP
// but additive (distance is in pixels, not a multiplier).
const DOLLY_STEP = 0.05;

export function makeWheelEffect({
  wheel,
  dollyRef,
  wheelRef,
  zoomMinRef,
  zoomMaxRef,
  distanceMinRef,
  distanceMaxRef,
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
    // Normalise deltaMode to pixel-equivalents (three.js convention: line×16, page×100).
    const lineFactor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    let delta = e.deltaY * lineFactor;
    // macOS trackpad pinch sends wheel events with ctrlKey=true and small deltas
    // — amplify so pinch matches three.js feel.
    if (e.ctrlKey) delta *= PINCH_AMP;
    else delta *= SCROLL_AMP;
    const handle = cameraRef.current;
    if (dollyRef.current) {
      // Dolly mode: change distance (camera pull-back) instead of zoom.
      // Positive delta (scroll down) → dolly out (increase distance).
      const nextDist = Math.max(
        distanceMinRef.current,
        Math.min(distanceMaxRef.current, handle.state.distance + delta * DOLLY_STEP),
      );
      handle.update({ distance: nextDist });
    } else {
      // Zoom mode: change CSS scale.
      const factor = Math.exp(-delta * ZOOM_STEP);
      const next = Math.max(
        zoomMinRef.current,
        Math.min(zoomMaxRef.current, handle.state.zoom * factor),
      );
      handle.update({ zoom: next });
    }
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
