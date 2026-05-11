/**
 * Shared types, constants, and utilities for orbit/map controls factories.
 * Not part of the public API surface — use createPolyOrbitControls or
 * createPolyMapControls.
 */
import type { PolySceneHandle } from "../createPolyScene";
import type { Vec3 } from "@layoutit/polycss-core";

// ── Wheel idle threshold ──────────────────────────────────────────────────
// Fires `end` once no new wheel event has arrived for this many milliseconds.
// Matches Three.js's internal idle threshold.
export const WHEEL_IDLE_END_MS = 150;

// ── Tunables ──────────────────────────────────────────────────────────────
export const POINTER_DRAG_SPEED = 4; // px per degree
export const ZOOM_STEP = 0.000513; // wheel sensitivity
export const PINCH_AMP = 10; // macOS trackpad pinch amplification
export const SCROLL_AMP = 3; // two-finger scroll amplification
export const ANIM_FRAME_MS = 16.67; // 60 Hz reference for dt normalization
export const ANIM_DT_CLAMP_MS = 50; // cap dt per tick
export const DOLLY_STEP = 0.05; // CSS pixels per unit wheel delta

// ── Shared animate options ────────────────────────────────────────────────
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

// ── Shared base options ───────────────────────────────────────────────────
export interface PolyControlsBaseOptions {
  /** Pointer-drag. Default: true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default: true. */
  wheel?: boolean;
  /**
   * When `true`, wheel events change `distance` (camera pull-back in CSS px)
   * instead of `zoom`. Mirrors Three.js OrbitControls dolly behaviour.
   * Default: false (zoom mode).
   */
  dolly?: boolean;
  /**
   * Drag-direction inversion. `false` = natural, `true` = invert (×-1),
   * a number multiplies sensitivity (negative inverts). Default: false.
   */
  invert?: boolean | number;
  /** Minimum CSS zoom. Default: 0.1. */
  minZoom?: number;
  /** Maximum CSS zoom. Default: 10. */
  maxZoom?: number;
  /** Minimum dolly distance in CSS pixels. Default: 0. Only used when `dolly: true`. */
  minDistance?: number;
  /** Maximum dolly distance in CSS pixels. Default: Infinity. Only used when `dolly: true`. */
  maxDistance?: number;
  /** Auto-rotate. Pass false (or omit) to disable. */
  animate?: false | PolyControlsAnimateOptions;
}

// ── Camera snapshot ───────────────────────────────────────────────────────
export interface PolyControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
  target: Vec3;
  distance: number;
}

export interface PolyControlsChangeEvent {
  type: "change";
  camera: PolyControlsCamera;
}

export interface PolyControlsInteractionEvent {
  type: "start" | "end";
  camera: PolyControlsCamera;
}

export type PolyControlsEvent = PolyControlsChangeEvent | PolyControlsInteractionEvent;
export type PolyControlsListener<E extends PolyControlsEvent = PolyControlsEvent> = (event: E) => void;

// ── Handle base shape ─────────────────────────────────────────────────────
export interface PolyControlsHandle {
  update(partial: PolyControlsBaseOptions): void;
  resume(): void;
  pause(): void;
  destroy(): void;
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

// ── Resolved options ──────────────────────────────────────────────────────
export interface ResolvedOptions {
  drag: boolean;
  wheel: boolean;
  dolly: boolean;
  invert: boolean | number;
  minZoom: number;
  maxZoom: number;
  minDistance: number;
  maxDistance: number;
  animate: false | Required<PolyControlsAnimateOptions>;
}

export const BASE_DEFAULTS: ResolvedOptions = {
  drag: true,
  wheel: true,
  dolly: false,
  invert: false,
  minZoom: 0.1,
  maxZoom: 10,
  minDistance: 0,
  maxDistance: Infinity,
  animate: false,
};

export function resolveOptions(
  base: ResolvedOptions,
  partial: PolyControlsBaseOptions,
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
    dolly: partial.dolly ?? base.dolly,
    invert: partial.invert ?? base.invert,
    minZoom: partial.minZoom ?? base.minZoom,
    maxZoom: partial.maxZoom ?? base.maxZoom,
    minDistance: partial.minDistance ?? base.minDistance,
    maxDistance: partial.maxDistance ?? base.maxDistance,
    animate,
  };
}

export function invertFactor(invert: boolean | number): number {
  if (invert === true) return -1;
  if (invert === false) return 1;
  return invert;
}

// ── Event subscription registry ───────────────────────────────────────────
export function makeListenerRegistry(): {
  changeListeners: PolyControlsListener<PolyControlsChangeEvent>[];
  startListeners: PolyControlsListener<PolyControlsInteractionEvent>[];
  endListeners: PolyControlsListener<PolyControlsInteractionEvent>[];
  listenerArray: (type: PolyControlsEvent["type"]) => PolyControlsListener[];
  emitChange: (cameraSnapshot: () => PolyControlsCamera) => void;
  emitInteraction: (type: "start" | "end", cameraSnapshot: () => PolyControlsCamera) => void;
} {
  const changeListeners: PolyControlsListener<PolyControlsChangeEvent>[] = [];
  const startListeners: PolyControlsListener<PolyControlsInteractionEvent>[] = [];
  const endListeners: PolyControlsListener<PolyControlsInteractionEvent>[] = [];

  function listenerArray(type: PolyControlsEvent["type"]): PolyControlsListener[] {
    if (type === "change") return changeListeners as PolyControlsListener[];
    if (type === "start") return startListeners as PolyControlsListener[];
    return endListeners as PolyControlsListener[];
  }

  function emitChange(snapshot: () => PolyControlsCamera): void {
    if (changeListeners.length === 0) return;
    const event: PolyControlsChangeEvent = { type: "change", camera: snapshot() };
    const copy = changeListeners.slice();
    for (const fn of copy) {
      try { fn(event); } catch (err) { console.error("[polycss] controls 'change' listener threw:", err); }
    }
  }

  function emitInteraction(type: "start" | "end", snapshot: () => PolyControlsCamera): void {
    const list = type === "start" ? startListeners : endListeners;
    if (list.length === 0) return;
    const event: PolyControlsInteractionEvent = { type, camera: snapshot() };
    const copy = list.slice();
    for (const fn of copy) {
      try { fn(event); } catch (err) { console.error(`[polycss] controls '${type}' listener threw:`, err); }
    }
  }

  return { changeListeners, startListeners, endListeners, listenerArray, emitChange, emitInteraction };
}

export function makeCameraSnapshot(scene: PolySceneHandle): () => PolyControlsCamera {
  return (): PolyControlsCamera => {
    const sceneOpts = scene.getOptions();
    const t = sceneOpts.target ?? [0, 0, 0];
    return {
      rotX: sceneOpts.rotX ?? 0,
      rotY: sceneOpts.rotY ?? 0,
      zoom: sceneOpts.zoom ?? 1,
      target: [t[0], t[1], t[2]],
      distance: sceneOpts.distance ?? 0,
    };
  };
}

// ── Shared wheel handler builder ──────────────────────────────────────────
export function makeWheelHandler(
  scene: PolySceneHandle,
  getOpts: () => ResolvedOptions,
  isStopped: () => boolean,
  snapshot: () => PolyControlsCamera,
  emitChange: (s: () => PolyControlsCamera) => void,
  emitInteraction: (type: "start" | "end", s: () => PolyControlsCamera) => void,
): {
  onWheel: (e: WheelEvent) => void;
  teardown: () => void;
} {
  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const onWheel = (e: WheelEvent): void => {
    const opts = getOpts();
    if (!opts.wheel || isStopped()) return;
    e.preventDefault();
    const lineFactor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    let delta = e.deltaY * lineFactor;
    if (e.ctrlKey) delta *= PINCH_AMP;
    else delta *= SCROLL_AMP;
    const sceneOpts = scene.getOptions();
    if (opts.dolly) {
      const cur = sceneOpts.distance ?? 0;
      const next = Math.max(opts.minDistance, Math.min(opts.maxDistance, cur + delta * DOLLY_STEP));
      scene.setOptions({ distance: next });
    } else {
      const factor = Math.exp(-delta * ZOOM_STEP);
      const cur = sceneOpts.zoom ?? 1;
      const next = Math.max(opts.minZoom, Math.min(opts.maxZoom, cur * factor));
      scene.setOptions({ zoom: next });
    }
    if (!wheelActive) {
      wheelActive = true;
      emitInteraction("start", snapshot);
    }
    emitChange(snapshot);
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null;
      wheelActive = false;
      emitInteraction("end", snapshot);
    }, WHEEL_IDLE_END_MS);
  };

  const teardown = (): void => {
    if (wheelIdleTimer !== null) {
      clearTimeout(wheelIdleTimer);
      wheelIdleTimer = null;
    }
    wheelActive = false;
  };

  return { onWheel, teardown };
}

// ── Shared animate (rAF) loop builder ────────────────────────────────────
export function makeAnimLoop(
  win: typeof globalThis,
  scene: PolySceneHandle,
  getOpts: () => ResolvedOptions,
  isStopped: () => boolean,
  isAnimPaused: () => boolean,
  snapshot: () => PolyControlsCamera,
  emitChange: (s: () => PolyControlsCamera) => void,
): {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
} {
  let animFrameId: number | null = null;
  let animLastTime = 0;

  const animTick = (now: number): void => {
    if (animFrameId === null || isStopped()) return;
    const opts = getOpts();
    if (!opts.animate) {
      animFrameId = null;
      return;
    }
    if (!isAnimPaused()) {
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
      emitChange(snapshot);
    } else {
      animLastTime = now;
    }
    animFrameId = win.requestAnimationFrame(animTick);
  };

  const start = (): void => {
    if (animFrameId !== null || !getOpts().animate || isStopped()) return;
    animLastTime = 0;
    animFrameId = win.requestAnimationFrame(animTick);
  };

  const stop = (): void => {
    if (animFrameId === null) return;
    win.cancelAnimationFrame(animFrameId);
    animFrameId = null;
  };

  const isRunning = (): boolean => animFrameId !== null;

  return { start, stop, isRunning };
}
