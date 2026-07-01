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
  // Multi-touch: track every active pointer so two fingers can pinch-zoom while
  // one finger pans. `activePointerId` is the single pointer driving the pan.
  const pointers = new Map<number, { x: number; y: number }>();
  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };
  let rightDown = false;
  let pinchDist = 0; // finger distance when the pinch began
  let pinchZoom = 0; // camera.zoom when the pinch began

  const camera = scene.camera;
  const registry = makeListenerRegistry(scene);
  const snapshot = makeCameraSnapshot(scene);
  const { emitChange, emitInteraction } = registry;
  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
  // rotX/rotY are in degrees — drag sensitivity: 4 px per degree (POINTER_DRAG_SPEED = 4).
  const DEG_PER_PX = 1 / 4;
  const PAN_SCALE = 0.02;

  function twoFingerDist(): number {
    const p = [...pointers.values()];
    return p.length >= 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!drag || stopped) return;
    // The first pointer must be primary (ignore stray secondary buttons); later
    // pointers join regardless so a second finger can pinch-zoom.
    if (pointers.size === 0 && e.isPrimary === false) return;
    e.preventDefault();
    if (pointers.size === 0) emitInteraction("start", snapshot);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture on the stable host, NOT e.target — colored output rewrites the
    // <pre> innerHTML each render, destroying the captured <span> → pointercancel
    // would abort the drag mid-gesture.
    try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size >= 2) {
      // Two fingers → pinch-zoom; suspend pan.
      activePointerId = null;
      pinchDist = twoFingerDist();
      pinchZoom = camera.zoom;
      host.style.cursor = "";
    } else {
      activePointerId = e.pointerId;
      pointer = { x: e.clientX, y: e.clientY };
      rightDown = e.button === 2;
      host.style.cursor = "grabbing";
      if (animOpts && (animOpts as { pauseOnInteraction?: boolean }).pauseOnInteraction !== false) {
        animPaused = true;
      }
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (stopped || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      // Pinch-zoom (only when zoom/wheel is enabled).
      if (!wheel) return;
      e.preventDefault();
      const d = twoFingerDist();
      if (pinchDist > 0 && d > 0) {
        camera.zoom = Math.max(0.1, Math.min(500, pinchZoom * (d / pinchDist)));
        scene.rerender();
        emitChange(snapshot);
      }
      return;
    }

    if (!drag || e.pointerId !== activePointerId) return;
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
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { host.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.pointerId === activePointerId) activePointerId = null;
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 1) {
      // One finger left after a pinch → resume pan from it (no jump).
      const [id, pos] = [...pointers.entries()][0];
      activePointerId = id;
      pointer = { x: pos.x, y: pos.y };
      rightDown = false;
      host.style.cursor = drag && !stopped ? "grabbing" : "";
    } else if (pointers.size === 0) {
      rightDown = false;
      host.style.cursor = drag && !stopped ? "grab" : "";
      if (animOpts) animPaused = false;
      emitInteraction("end", snapshot);
    }
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
