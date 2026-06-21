// Vendored from voxcss packages/polycss/src/api/createPolyMapControls.ts@cac9da3. glyphcss deltas: Poly→Glyph rename; rotX/rotY in degrees (camera expects degrees); wheel/anim/options helpers inlined (controls/common.ts holds only the shared event registry); zoom clamp widened to absolute scale [0.1,500].
/**
 * createGlyphMapControls — map/pan-mode camera input for a GlyphScene.
 *
 * Left-drag pans the target (slippy-map semantics). Right-drag or
 * Shift+left-drag orbits. Wheel zooms. Mirrors voxcss's createPolyMapControls
 * semantics, adapted for the ASCII rasterizer's GlyphCamera.
 *
 * rotX and rotY are in DEGREES (three.js / voxcss convention).
 * Drag sensitivity: 4 px per degree (POINTER_DRAG_SPEED = 4).
 * Animate speed: degrees per 60 Hz-equivalent frame.
 */

import type { GlyphSceneHandle } from "./createGlyphScene";
import type { Vec3 } from "@glyphcss/core";
import { makeListenerRegistry, makeCameraSnapshot, makeEventMethods, type GlyphControlsEventTarget } from "./controls/common";
export type {
  GlyphControlsCamera,
  GlyphControlsChangeEvent,
  GlyphControlsInteractionEvent,
  GlyphControlsEvent,
  GlyphControlsListener,
} from "./controls/common";

export interface GlyphMapControlsOptions {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export interface GlyphMapControlsHandle extends GlyphControlsEventTarget {
  update(opts: GlyphMapControlsOptions): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

export function createGlyphMapControls(
  scene: GlyphSceneHandle,
  options: GlyphMapControlsOptions = {},
): GlyphMapControlsHandle {
  const host = scene.host;
  let drag = options.drag ?? true;
  let wheel = options.wheel ?? true;
  let invertFactor = resolveInvert(options.invert);
  let animOpts = options.animate ?? false;
  let stopped = false;
  let animPaused = false;
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
  let lastTime: number | null = null;
  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };
  let rightDown = false;

  const camera = scene.camera;
  const registry = makeListenerRegistry();
  const snapshot = makeCameraSnapshot(scene);
  const { emitChange, emitInteraction } = registry;
  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
  // rotX/rotY are in degrees — drag sensitivity: 4 px per degree (POINTER_DRAG_SPEED = 4).
  const DEG_PER_PX = 1 / 4;
  const PAN_SCALE = 0.02;

  function onPointerDown(e: PointerEvent): void {
    if (!drag || stopped) return;
    if (activePointerId !== null) return;
    if (e.isPrimary === false) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
    rightDown = e.button === 2;
    host.style.cursor = "grabbing";
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (animOpts && (animOpts as { pauseOnInteraction?: boolean }).pauseOnInteraction !== false) {
      animPaused = true;
    }
    emitInteraction("start", snapshot);
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    if (!drag || stopped) return;
    e.preventDefault();
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer = { x: e.clientX, y: e.clientY };
    const f = invertFactor;

    if (rightDown || e.shiftKey) {
      // Orbit — rotX/rotY in degrees
      camera.rotY = camera.rotY - dx * DEG_PER_PX * f;
      camera.rotX = Math.max(-90, Math.min(90, camera.rotX + dy * DEG_PER_PX * f));
    } else {
      // Pan: translate target in camera-tangent plane
      const t = camera.target;
      camera.target = [
        t[0] - dx * PAN_SCALE / camera.zoom,
        t[1] - dy * PAN_SCALE / camera.zoom,
        t[2],
      ] as Vec3;
    }
    scene.rerender();
    emitChange(snapshot);
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    rightDown = false;
    host.style.cursor = drag && !stopped ? "grab" : "";
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (animOpts) animPaused = false;
    emitInteraction("end", snapshot);
  }

  function onContextMenu(e: Event): void { e.preventDefault(); }

  function onWheel(e: WheelEvent): void {
    if (!wheel || stopped) return;
    e.preventDefault();
    const delta = e.deltaY * 0.001;
    // Absolute px-per-world-unit zoom: wide clamp so fitted framings (~10–40)
    // and deep zoom both work. Was [0.05, 10] under the old fraction scale.
    camera.zoom = Math.max(0.1, Math.min(500, camera.zoom * (1 - delta)));
    scene.rerender();
    if (!wheelActive) { wheelActive = true; emitInteraction("start", snapshot); }
    emitChange(snapshot);
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null;
      wheelActive = false;
      emitInteraction("end", snapshot);
    }, 150);
  }

  function animTick(time: number): void {
    if (stopped || !animOpts) return;
    if (!animPaused) {
      const dt = lastTime !== null ? Math.min(time - lastTime, 50) : 16.67;
      const speed = (typeof animOpts === "object" && animOpts.speed) ? animOpts.speed : 0.3;
      const axis = (typeof animOpts === "object" && animOpts.axis) ? animOpts.axis : "y";
      // speed is degrees per 60 Hz-equivalent frame; dt normalised to 16.67 ms reference.
      const dAngle = speed * (dt / 16.67);
      if (axis === "y") camera.rotY = camera.rotY + dAngle;
      else camera.rotX = camera.rotX + dAngle;
      scene.rerender();
      emitChange(snapshot);
    }
    lastTime = time;
    rafId = requestAnimationFrame(animTick);
  }

  function startAnim(): void {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame !== "undefined" && animOpts) {
      rafId = requestAnimationFrame(animTick);
    }
  }

  function stopAnim(): void {
    if (rafId !== null) { if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId); rafId = null; }
    lastTime = null;
  }

  function attach(): void {
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.style.cursor = drag ? "grab" : "";
    host.style.touchAction = "none";
    host.style.userSelect = "none";
  }

  function detach(): void {
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerUp);
    host.removeEventListener("contextmenu", onContextMenu);
    host.removeEventListener("wheel", onWheel);
    host.style.cursor = "";
    host.style.touchAction = "";
    host.style.userSelect = "";
  }

  function clearWheelIdle(): void {
    if (wheelIdleTimer !== null) { clearTimeout(wheelIdleTimer); wheelIdleTimer = null; }
    wheelActive = false;
  }

  attach();
  startAnim();

  return {
    ...makeEventMethods(registry),
    update(opts: GlyphMapControlsOptions): void {
      const wasAnimating = !!animOpts;
      drag = opts.drag ?? drag;
      wheel = opts.wheel ?? wheel;
      invertFactor = resolveInvert(opts.invert);
      animOpts = opts.animate ?? animOpts;
      if (!stopped && activePointerId === null) host.style.cursor = drag ? "grab" : "";
      const isAnimating = !!animOpts;
      if (wasAnimating && !isAnimating) stopAnim();
      else if (!wasAnimating && isAnimating) startAnim();
    },
    pause(): void { if (stopped) return; stopped = true; detach(); stopAnim(); clearWheelIdle(); activePointerId = null; animPaused = false; },
    resume(): void { if (!stopped) return; stopped = false; attach(); startAnim(); },
    destroy(): void { if (!stopped) detach(); stopAnim(); clearWheelIdle(); stopped = true; },
  };
}

function resolveInvert(invert: boolean | number | undefined): number {
  if (invert === undefined || invert === false) return 1;
  if (invert === true) return -1;
  return invert;
}
