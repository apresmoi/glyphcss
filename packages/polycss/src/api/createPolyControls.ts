/**
 * Imperative camera input + autorotate handle for a PolyScene.
 *
 * Modeled on Three.js OrbitControls: the renderer (createPolyScene) owns
 * camera state (rotX / rotY / zoom) and the rendered DOM; controls is an
 * additive layer that listens for pointer/wheel input and runs an
 * optional rAF loop, calling scene.setOptions(...) to drive state.
 *
 * Defaults: drag on, wheel on, animate off — opt out by passing false.
 */

import type { SceneHandle } from "./createPolyScene";

export interface PolyControlsAnimateOptions {
  /**
   * Rotation rate in degrees per 60 Hz-equivalent frame. The tick is
   * dt-clamped so 0.3 deg/frame ≈ 18 deg/sec on every refresh rate.
   * Default: 0.3.
   */
  speed?: number;
  /** Rotation axis. Default: "y" (yaw, rotates around vertical world Z). */
  axis?: "x" | "y";
  /** Halt the loop while a pointer drag is in progress. Default: true. */
  pauseOnInteraction?: boolean;
}

export interface PolyControlsOptions {
  /** Pointer-drag rotation. Default: true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default: true. */
  wheel?: boolean;
  /**
   * Drag-direction inversion. `false` = natural, `true` = invert (×-1),
   * a number multiplies sensitivity (negative inverts). Default: false.
   */
  invert?: boolean | number;
  /** Zoom range clamps. Default: { min: 0.1, max: 10 }. */
  zoom?: { min?: number; max?: number };
  /** Auto-rotate. Pass false (or omit) to disable. */
  animate?: false | PolyControlsAnimateOptions;
}

export interface PolyControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
}

/**
 * `change` fires whenever the controls mutate scene camera state — pointer
 * drag, wheel zoom, or an autorotate tick. Carries the post-mutation
 * camera snapshot so listeners don't have to reach back into the scene.
 */
export interface PolyControlsChangeEvent {
  type: "change";
  camera: PolyControlsCamera;
}

/**
 * `start` fires on the first user gesture of an interaction (pointerdown
 * or first wheel of a burst). `end` fires when that gesture concludes
 * (pointerup or after the wheel has been idle for ~150 ms). Drag and
 * wheel are independent — each emits its own start/end pair. Both carry
 * the current camera so consumers using `'end'` to commit final state
 * don't need a separate `'change'` listener to track it.
 */
export interface PolyControlsInteractionEvent {
  type: "start" | "end";
  camera: PolyControlsCamera;
}

export type PolyControlsEvent = PolyControlsChangeEvent | PolyControlsInteractionEvent;

export type PolyControlsListener<E extends PolyControlsEvent = PolyControlsEvent> = (event: E) => void;

export interface ControlsHandle {
  /** Mutate options live without re-creating. Diff-applies. */
  update(partial: PolyControlsOptions): void;
  /** Re-attach input listeners and (re)start the autorotate rAF after pause(). */
  resume(): void;
  /** Detach input listeners and halt the autorotate loop. Reversible by resume(). */
  pause(): void;
  /** Hard teardown; functionally identical to pause() in this implementation. */
  destroy(): void;
  /**
   * Subscribe to controls events. Modeled on Three.js OrbitControls'
   * `addEventListener`. The listener type narrows based on `type`:
   * `'change'` listeners receive a {@link PolyControlsChangeEvent} (with
   * camera snapshot), `'start'` / `'end'` listeners receive a
   * {@link PolyControlsInteractionEvent}.
   */
  addEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void;
  removeEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void;
  hasEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): boolean;
}

// Wheel events have no native "wheel up" — emit `end` once no new wheel
// event has arrived for this many milliseconds. Matches Three.js's
// internal idle threshold so feel matches.
const WHEEL_IDLE_END_MS = 150;

// Tunables — mirror the values in the previous in-scene implementation so
// existing apps that switch to controls feel identical at default settings.
const POINTER_DRAG_SPEED = 4; // px per degree
const ZOOM_STEP = 0.0008; // wheel sensitivity
const ANIM_FRAME_MS = 16.67; // 60 Hz reference for dt normalization
const ANIM_DT_CLAMP_MS = 50; // cap dt per tick; prevents jump after tab regains focus

interface ResolvedOptions {
  drag: boolean;
  wheel: boolean;
  invert: boolean | number;
  zoom: { min: number; max: number };
  animate: false | Required<PolyControlsAnimateOptions>;
}

const DEFAULTS: ResolvedOptions = {
  drag: true,
  wheel: true,
  invert: false,
  zoom: { min: 0.1, max: 10 },
  animate: false,
};

function resolveOptions(
  base: ResolvedOptions,
  partial: PolyControlsOptions,
): ResolvedOptions {
  let animate: ResolvedOptions["animate"];
  if (partial.animate === false) {
    animate = false;
  } else if (partial.animate) {
    animate = {
      speed: partial.animate.speed ?? 0.3,
      axis: partial.animate.axis ?? "y",
      pauseOnInteraction: partial.animate.pauseOnInteraction ?? true,
    };
  } else {
    animate = base.animate;
  }
  return {
    drag: partial.drag ?? base.drag,
    wheel: partial.wheel ?? base.wheel,
    invert: partial.invert ?? base.invert,
    zoom: {
      min: partial.zoom?.min ?? base.zoom.min,
      max: partial.zoom?.max ?? base.zoom.max,
    },
    animate,
  };
}

function invertFactor(invert: boolean | number): number {
  if (invert === true) return -1;
  if (invert === false) return 1;
  return invert;
}

export function createPolyControls(
  scene: SceneHandle,
  options: PolyControlsOptions = {},
): ControlsHandle {
  let opts = resolveOptions(DEFAULTS, options);
  const host = scene.host;
  const win = host.ownerDocument?.defaultView ?? globalThis;

  // Pointer drag state
  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };

  // Animate rAF state
  let animFrameId: number | null = null;
  let animLastTime = 0;
  let animPaused = false; // by interaction

  // Whether pause() has been called. resume() flips it back.
  let stopped = false;

  // Wheel idle-detection: each wheel event refreshes the timer. When it
  // fires, we emit `end` for the wheel gesture. wheelActive tracks whether
  // we've already emitted `start` for the current burst.
  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Event subscription registry ─────────────────────────────────────────
  // Three.js-style start / change / end. Listeners are stored in arrays
  // (not Sets) so we iterate a snapshot — letting a listener remove itself
  // mid-emit without skipping siblings.
  const changeListeners: PolyControlsListener<PolyControlsChangeEvent>[] = [];
  const startListeners: PolyControlsListener<PolyControlsInteractionEvent>[] = [];
  const endListeners: PolyControlsListener<PolyControlsInteractionEvent>[] = [];

  function listenerArray(type: PolyControlsEvent["type"]): PolyControlsListener[] {
    if (type === "change") return changeListeners as PolyControlsListener[];
    if (type === "start") return startListeners as PolyControlsListener[];
    return endListeners as PolyControlsListener[];
  }

  function cameraSnapshot(): PolyControlsCamera {
    const sceneOpts = scene.getOptions();
    return {
      rotX: sceneOpts.rotX ?? 0,
      rotY: sceneOpts.rotY ?? 0,
      zoom: sceneOpts.zoom ?? 1,
    };
  }

  function emitChange(): void {
    if (changeListeners.length === 0) return;
    const event: PolyControlsChangeEvent = { type: "change", camera: cameraSnapshot() };
    // Snapshot before iterating so removals during dispatch don't skip
    // the next listener.
    const snapshot = changeListeners.slice();
    for (const fn of snapshot) {
      try { fn(event); } catch (err) { console.error("[polycss] controls 'change' listener threw:", err); }
    }
  }

  function emitInteraction(type: "start" | "end"): void {
    const list = type === "start" ? startListeners : endListeners;
    if (list.length === 0) return;
    const event: PolyControlsInteractionEvent = { type, camera: cameraSnapshot() };
    const snapshot = list.slice();
    for (const fn of snapshot) {
      try { fn(event); } catch (err) { console.error(`[polycss] controls '${type}' listener threw:`, err); }
    }
  }

  // ── Pointer drag ────────────────────────────────────────────────────────
  const onPointerDown = (e: PointerEvent): void => {
    if (!opts.drag || stopped) return;
    if (activePointerId !== null) return;
    if (e.isPrimary === false) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
    host.style.cursor = "grabbing";
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* ignore — fine on synthetic events / test envs without pointer capture */
    }
    if (opts.animate && opts.animate.pauseOnInteraction) {
      animPaused = true;
    }
    emitInteraction("start");
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    if (!opts.drag || stopped) return;
    e.preventDefault();
    const f = invertFactor(opts.invert);
    const dX = ((e.clientX - pointer.x) / POINTER_DRAG_SPEED) * f;
    const dY = ((e.clientY - pointer.y) / POINTER_DRAG_SPEED) * f;
    pointer = { x: e.clientX, y: e.clientY };
    const sceneOpts = scene.getOptions();
    // The visible object should appear to track the user's pointer:
    // drag-right pulls the front of the scene rightward (camera orbits
    // the other way), drag-down tilts the top toward the user. Both
    // axes therefore subtract the delta from the current camera angle.
    const rotX = Math.max(0, Math.min(100, (sceneOpts.rotX ?? 65) - dY));
    const rotY = ((((sceneOpts.rotY ?? 45) - dX) % 360) + 360) % 360;
    scene.setOptions({ rotX, rotY });
    emitChange();
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    host.style.cursor = opts.drag && !stopped ? "grab" : "";
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (opts.animate && opts.animate.pauseOnInteraction) {
      animPaused = false;
      // Reset lastTime so the next animTick uses a fresh dt anchor — otherwise
      // we'd see a "catch-up" jump equal to however long the drag lasted.
      animLastTime = 0;
    }
    emitInteraction("end");
  };

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  const onWheel = (e: WheelEvent): void => {
    if (!opts.wheel || stopped) return;
    e.preventDefault();
    // Normalize across deltaMode (0 = px, 1 = lines, 2 = pages).
    const lineFactor = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    const factor = Math.exp(-e.deltaY * lineFactor * ZOOM_STEP);
    const sceneOpts = scene.getOptions();
    const cur = sceneOpts.zoom ?? 1;
    const next = Math.max(opts.zoom.min, Math.min(opts.zoom.max, cur * factor));
    scene.setOptions({ zoom: next });
    if (!wheelActive) {
      wheelActive = true;
      emitInteraction("start");
    }
    emitChange();
    // Refresh idle timer — last wheel event in a burst triggers `end`.
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null;
      wheelActive = false;
      emitInteraction("end");
    }, WHEEL_IDLE_END_MS);
  };

  // ── Animate tick ────────────────────────────────────────────────────────
  const animTick = (now: number): void => {
    if (animFrameId === null || stopped) return;
    if (!opts.animate) {
      animFrameId = null;
      return;
    }
    if (!animPaused) {
      const dt = Math.min(ANIM_DT_CLAMP_MS, animLastTime ? now - animLastTime : ANIM_FRAME_MS);
      animLastTime = now;
      const delta = opts.animate.speed * (dt / ANIM_FRAME_MS);
      const sceneOpts = scene.getOptions();
      if (opts.animate.axis === "x") {
        const next = (((sceneOpts.rotX ?? 65) + delta) % 360 + 360) % 360;
        scene.setOptions({ rotX: next });
      } else {
        const next = (((sceneOpts.rotY ?? 45) + delta) % 360 + 360) % 360;
        scene.setOptions({ rotY: next });
      }
      // Autorotate is a programmatic mutation — fire `change` per Three.js
      // OrbitControls semantics, but no `start` / `end` (no user gesture).
      emitChange();
    } else {
      // Keep lastTime fresh so resume doesn't see a huge pause-length dt.
      animLastTime = now;
    }
    animFrameId = win.requestAnimationFrame(animTick);
  };

  // ── Attach / detach ─────────────────────────────────────────────────────
  function attach(): void {
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    // passive:false so onWheel can preventDefault() and stop the page from
    // scrolling while the user is zooming the scene.
    host.addEventListener("wheel", onWheel, { passive: false });
    host.style.cursor = opts.drag ? "grab" : "";
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

  function startAnim(): void {
    if (animFrameId !== null || !opts.animate || stopped) return;
    animLastTime = 0;
    animFrameId = win.requestAnimationFrame(animTick);
  }

  function stopAnim(): void {
    if (animFrameId === null) return;
    win.cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Initial wiring.
  attach();
  startAnim();

  function update(partial: PolyControlsOptions): void {
    const wasAnimating = !!opts.animate;
    opts = resolveOptions(opts, partial);
    if (!stopped && activePointerId === null) {
      host.style.cursor = opts.drag ? "grab" : "";
    }
    const isAnimating = !!opts.animate;
    if (wasAnimating && !isAnimating) {
      stopAnim();
    } else if (!wasAnimating && isAnimating) {
      startAnim();
    }
  }

  function resume(): void {
    if (!stopped) return;
    stopped = false;
    attach();
    startAnim();
  }

  function pause(): void {
    if (stopped) return;
    stopped = true;
    detach();
    stopAnim();
    activePointerId = null;
    animPaused = false;
    if (wheelIdleTimer !== null) {
      clearTimeout(wheelIdleTimer);
      wheelIdleTimer = null;
    }
    wheelActive = false;
  }

  function destroy(): void {
    pause();
    changeListeners.length = 0;
    startListeners.length = 0;
    endListeners.length = 0;
  }

  function addEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void {
    const arr = listenerArray(type);
    if (!arr.includes(listener as PolyControlsListener)) arr.push(listener as PolyControlsListener);
  }

  function removeEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): void {
    const arr = listenerArray(type);
    const idx = arr.indexOf(listener as PolyControlsListener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  function hasEventListener<T extends PolyControlsEvent["type"]>(
    type: T,
    listener: PolyControlsListener<Extract<PolyControlsEvent, { type: T }>>,
  ): boolean {
    return listenerArray(type).includes(listener as PolyControlsListener);
  }

  return {
    update,
    resume,
    pause,
    destroy,
    addEventListener,
    removeEventListener,
    hasEventListener,
  };
}
