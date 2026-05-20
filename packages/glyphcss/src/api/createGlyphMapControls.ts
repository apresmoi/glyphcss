/**
 * createGlyphMapControls — map/pan-mode camera input for a GlyphScene.
 *
 * Left-drag pans the target (slippy-map semantics). Right-drag or
 * Shift+left-drag orbits. Wheel zooms. Mirrors glyphcss's createPolyMapControls
 * semantics, adapted for the ASCII rasterizer's GlyphCamera.
 */

import type { GlyphSceneHandle } from "./createGlyphScene";
import type { Vec3 } from "@glyphcss/core";

export interface GlyphMapControlsOptions {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export interface GlyphMapControlsHandle {
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
  const RAD_PER_PX = (1 / 4) * Math.PI / 180;
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
      // Orbit
      camera.rotY = camera.rotY - dx * RAD_PER_PX * f;
      camera.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotX + dy * RAD_PER_PX * f));
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
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    rightDown = false;
    host.style.cursor = drag && !stopped ? "grab" : "";
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (animOpts) animPaused = false;
  }

  function onContextMenu(e: Event): void { e.preventDefault(); }

  function onWheel(e: WheelEvent): void {
    if (!wheel || stopped) return;
    e.preventDefault();
    const delta = e.deltaY * 0.001;
    camera.zoom = Math.max(0.05, Math.min(10, camera.zoom * (1 - delta)));
    scene.rerender();
  }

  function animTick(time: number): void {
    if (stopped || !animOpts) return;
    if (!animPaused) {
      const dt = lastTime !== null ? Math.min(time - lastTime, 50) : 16.67;
      const speed = (typeof animOpts === "object" && animOpts.speed) ? animOpts.speed : 0.3;
      const axis = (typeof animOpts === "object" && animOpts.axis) ? animOpts.axis : "y";
      const dAngle = speed * (Math.PI / 180) * (dt / 16.67);
      if (axis === "y") camera.rotY = camera.rotY + dAngle;
      else camera.rotX = camera.rotX + dAngle;
      scene.rerender();
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

  attach();
  startAnim();

  return {
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
    pause(): void { if (stopped) return; stopped = true; detach(); stopAnim(); activePointerId = null; animPaused = false; },
    resume(): void { if (!stopped) return; stopped = false; attach(); startAnim(); },
    destroy(): void { if (!stopped) detach(); stopAnim(); stopped = true; },
  };
}

function resolveInvert(invert: boolean | number | undefined): number {
  if (invert === undefined || invert === false) return 1;
  if (invert === true) return -1;
  return invert;
}
