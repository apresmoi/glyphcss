/**
 * createGlyphOrbitControls — orbit-mode camera input for a GlyphScene.
 *
 * Left-drag rotates rotX / rotY around the target (orbit). Wheel zooms or
 * dollies. Mirrors glyphcss's createPolyOrbitControls semantics, adapted for
 * the ASCII rasterizer's GlyphCamera instead of the CSS matrix3d camera.
 */

import type { GlyphSceneHandle } from "./createGlyphScene";

export interface GlyphOrbitControlsOptions {
  /** Pointer-drag. Default: true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default: true. */
  wheel?: boolean;
  /** Drag-direction inversion. Default: false. */
  invert?: boolean | number;
  /**
   * Clamp vertical drag to ±π/2 (camera stays above the equator, never
   * flipping past either pole). Default: true. Set to false for globe-style
   * unrestricted tumbling.
   */
  clampPitch?: boolean;
  /** Auto-rotate. Pass false or omit to disable. */
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export interface GlyphOrbitControlsHandle {
  update(opts: GlyphOrbitControlsOptions): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

export function createGlyphOrbitControls(
  scene: GlyphSceneHandle,
  options: GlyphOrbitControlsOptions = {},
): GlyphOrbitControlsHandle {
  const host = scene.host;
  let drag = options.drag ?? true;
  let wheel = options.wheel ?? true;
  let invertFactor = resolveInvert(options.invert);
  let clampPitch = options.clampPitch ?? true;
  let animOpts = options.animate ?? false;
  let stopped = false;
  let animPaused = false;
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
  let lastTime: number | null = null;

  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };

  const camera = scene.camera;

  function onPointerDown(e: PointerEvent): void {
    if (!drag || stopped) return;
    if (activePointerId !== null) return;
    if (e.isPrimary === false) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
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
    // Drag sensitivity: 4px per degree, converted to radians
    const DEG_PER_PX = 1 / 4;
    const RAD_PER_PX = DEG_PER_PX * Math.PI / 180;
    camera.rotY = camera.rotY - dx * RAD_PER_PX * f;
    // Drag in the same direction as the pointer: dragging UP tilts the camera
    // UP (positive rotX increase from the +Z-is-screen-up convention), so dy
    // negates here. Matches the horizontal axis's `-dx` direction.
    const nextRotX = camera.rotX - dy * RAD_PER_PX * f;
    camera.rotX = clampPitch ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, nextRotX)) : nextRotX;
    scene.rerender();
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    host.style.cursor = drag && !stopped ? "grab" : "";
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (animOpts) animPaused = false;
  }

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
    if (rafId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastTime = null;
  }

  function attach(): void {
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
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
    host.removeEventListener("wheel", onWheel);
    host.style.cursor = "";
    host.style.touchAction = "";
    host.style.userSelect = "";
  }

  attach();
  startAnim();

  return {
    update(opts: GlyphOrbitControlsOptions): void {
      const wasAnimating = !!animOpts;
      drag = opts.drag ?? drag;
      wheel = opts.wheel ?? wheel;
      invertFactor = resolveInvert(opts.invert);
      if (opts.clampPitch !== undefined) clampPitch = opts.clampPitch;
      animOpts = opts.animate ?? animOpts;
      if (!stopped && activePointerId === null) {
        host.style.cursor = drag ? "grab" : "";
      }
      const isAnimating = !!animOpts;
      if (wasAnimating && !isAnimating) stopAnim();
      else if (!wasAnimating && isAnimating) startAnim();
    },
    pause(): void {
      if (stopped) return;
      stopped = true;
      detach();
      stopAnim();
      activePointerId = null;
      animPaused = false;
    },
    resume(): void {
      if (!stopped) return;
      stopped = false;
      attach();
      startAnim();
    },
    destroy(): void {
      if (!stopped) detach();
      stopAnim();
      stopped = true;
    },
  };
}

function resolveInvert(invert: boolean | number | undefined): number {
  if (invert === undefined || invert === false) return 1;
  if (invert === true) return -1;
  return invert;
}
