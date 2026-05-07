/**
 * <PolyControls> — additive camera input + autorotate, mirroring the
 * vanilla `createPolyControls` API. Uses the existing PolyCameraContext
 * to read/write camera state and attach handlers.
 *
 * Render-free: returns null. Place inside <PolyCamera> (typically also
 * inside <PolyScene>, but the only context needed is PolyCameraContext).
 *
 *   <PolyCamera rotX={65} rotY={45} zoom={1}>
 *     <PolyScene>
 *       <PolyControls drag wheel animate={{ speed: 0.3 }} />
 *       <PolyMesh polygons={...} />
 *     </PolyScene>
 *   </PolyCamera>
 *
 * If you also pass `interactive` or `animate` to <PolyCamera>, you'll get
 * two sets of handlers fighting for the same scene. Use one or the other,
 * not both. <PolyControls> is the recommended path going forward; the
 * inline props on <PolyCamera> are kept for back-compat.
 */
import { useEffect, useRef } from "react";
import { useCameraContext } from "../camera/context";

export interface PolyControlsAnimateOptions {
  /** Degrees per 60Hz-equivalent frame. Default 0.3 (≈ 18 deg/sec). */
  speed?: number;
  /** Rotation axis. Default "y". */
  axis?: "x" | "y";
  /** Pause animate while a pointer drag is in progress. Default true. */
  pauseOnInteraction?: boolean;
}

export interface PolyControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
}

export interface PolyControlsProps {
  /** Pointer-drag rotation. Default true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default true. */
  wheel?: boolean;
  /** Drag-direction inversion. Number = sensitivity multiplier. Default false. */
  invert?: boolean | number;
  /** Zoom range clamps. Default { min: 0.1, max: 10 }. */
  zoom?: { min?: number; max?: number };
  /** Auto-rotate. Pass false (or omit) to disable. */
  animate?: false | PolyControlsAnimateOptions;
  /**
   * Fires whenever the controls mutate camera state — pointer drag,
   * wheel zoom, or an autorotate tick. Mirrors Three.js OrbitControls'
   * `change` event, with the post-mutation camera passed as the argument.
   * Autorotate fires this every frame; throttle, or use `onInteractionEnd`
   * instead if you only need the final position.
   */
  onChange?: (camera: PolyControlsCamera) => void;
  /**
   * Fires on first user gesture of an interaction (pointerdown / first
   * wheel of a burst). Receives the camera at gesture start so handlers
   * can stash the pre-drag state if needed.
   */
  onInteractionStart?: (camera: PolyControlsCamera) => void;
  /**
   * Fires when the gesture concludes (pointerup / wheel idle ~150 ms),
   * with the final camera. Use this instead of `onChange` when you want
   * to commit state once per gesture (avoids per-frame React re-renders).
   */
  onInteractionEnd?: (camera: PolyControlsCamera) => void;
}

const WHEEL_IDLE_END_MS = 150;

const POINTER_DRAG_SPEED = 4;
const ZOOM_STEP = 0.0008;
const ANIM_FRAME_MS = 16.67;
const ANIM_DT_CLAMP_MS = 50;

const DEFAULT_ZOOM_MIN = 0.1;
const DEFAULT_ZOOM_MAX = 10;
const DEFAULT_ANIMATE_SPEED = 0.3;

function invertFactor(invert: boolean | number | undefined): number {
  if (invert === true) return -1;
  if (invert === undefined || invert === false) return 1;
  return invert;
}

export function PolyControls({
  drag = true,
  wheel = true,
  invert = false,
  zoom,
  animate = false,
  onChange,
  onInteractionStart,
  onInteractionEnd,
}: PolyControlsProps): null {
  const { store, cameraRef, cameraElRef, applyTransformDirect } = useCameraContext();

  // Stash latest props in refs so the effect bodies can read fresh values
  // without re-attaching listeners on every render. Effects below depend
  // only on the high-level "is this thing on at all" booleans.
  const dragRef = useRef(drag);
  const wheelRef = useRef(wheel);
  const invertRef = useRef(invert);
  const zoomMinRef = useRef(zoom?.min ?? DEFAULT_ZOOM_MIN);
  const zoomMaxRef = useRef(zoom?.max ?? DEFAULT_ZOOM_MAX);
  const animateRef = useRef(animate);
  const onChangeRef = useRef(onChange);
  const onInteractionStartRef = useRef(onInteractionStart);
  const onInteractionEndRef = useRef(onInteractionEnd);
  useEffect(() => {
    dragRef.current = drag;
    wheelRef.current = wheel;
    invertRef.current = invert;
    zoomMinRef.current = zoom?.min ?? DEFAULT_ZOOM_MIN;
    zoomMaxRef.current = zoom?.max ?? DEFAULT_ZOOM_MAX;
    animateRef.current = animate;
    onChangeRef.current = onChange;
    onInteractionStartRef.current = onInteractionStart;
    onInteractionEndRef.current = onInteractionEnd;
  });

  const fireChange = (): void => {
    const fn = onChangeRef.current;
    if (!fn) return;
    const s = cameraRef.current.state;
    try { fn({ rotX: s.rotX, rotY: s.rotY, zoom: s.zoom }); }
    catch (err) { console.error("[polycss/react] PolyControls onChange threw:", err); }
  };
  const cameraSnapshot = (): PolyControlsCamera => {
    const s = cameraRef.current.state;
    return { rotX: s.rotX, rotY: s.rotY, zoom: s.zoom };
  };
  const fireStart = (): void => {
    const fn = onInteractionStartRef.current;
    if (!fn) return;
    try { fn(cameraSnapshot()); } catch (err) { console.error("[polycss/react] PolyControls onInteractionStart threw:", err); }
  };
  const fireEnd = (): void => {
    const fn = onInteractionEndRef.current;
    if (!fn) return;
    try { fn(cameraSnapshot()); } catch (err) { console.error("[polycss/react] PolyControls onInteractionEnd threw:", err); }
  };

  // ── Pointer drag ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const el = cameraElRef.current;
    if (!el) return;

    let activePointerId: number | null = null;
    let pointer = { x: 0, y: 0 };
    let animationPaused = false;

    const onDown = (e: PointerEvent): void => {
      if (!dragRef.current) return;
      if (activePointerId !== null) return;
      if (e.isPrimary === false) return;
      e.preventDefault();
      activePointerId = e.pointerId;
      pointer = { x: e.clientX, y: e.clientY };
      el.style.cursor = "grabbing";
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch { /* ignore */ }
      const a = animateRef.current;
      if (a && a.pauseOnInteraction !== false) {
        animationPaused = true;
        animationPausedShared.value = true;
      }
      fireStart();
    };

    const onMove = (e: PointerEvent): void => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      if (!dragRef.current) return;
      e.preventDefault();
      const f = invertFactor(invertRef.current);
      const dX = ((e.clientX - pointer.x) / POINTER_DRAG_SPEED) * f;
      const dY = ((e.clientY - pointer.y) / POINTER_DRAG_SPEED) * f;
      pointer = { x: e.clientX, y: e.clientY };
      const handle = cameraRef.current;
      const s = handle.state;
      // Drag should track the pointer — visible object follows the
      // user's mouse. Both axes subtract the delta from the camera.
      const rotX = Math.max(0, Math.min(100, s.rotX - dY));
      const rotY = (((s.rotY - dX) % 360) + 360) % 360;
      handle.update({ rotX, rotY });
      applyTransformDirect();
      store.updateCameraFromRef(handle);
      fireChange();
    };

    const onUp = (e: PointerEvent): void => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = null;
      el.style.cursor = dragRef.current ? "grab" : "";
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      if (animationPaused) {
        animationPaused = false;
        animationPausedShared.value = false;
      }
      fireEnd();
    };

    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.style.userSelect = "none";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.style.cursor = "";
      el.style.touchAction = "";
      el.style.userSelect = "";
    };
  }, [drag, applyTransformDirect, cameraElRef, cameraRef, store]);

  // Shared between drag (writer) and animate (reader). Plain object so a
  // ref isn't needed — it's effect-scoped and stable across renders.
  // Re-created per PolyControls instance (useRef would also work).
  const animationPausedShared = useRef({ value: false }).current;

  // ── Wheel zoom ─────────────────────────────────────────────────────────
  useEffect(() => {
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
  }, [wheel, applyTransformDirect, cameraElRef, cameraRef, store]);

  // ── Animate (autorotate) ────────────────────────────────────────────────
  // Re-runs when animate flips truthy/falsy. While running, reads speed/
  // axis from animateRef (so live changes propagate without restarting
  // the loop).
  const animateOn = !!animate;
  useEffect(() => {
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
  }, [animateOn, animationPausedShared, applyTransformDirect, cameraRef, store]);

  return null;
}
