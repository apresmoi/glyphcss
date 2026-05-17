/**
 * <PolyFirstPersonControls> — first-person camera controls for a PolyScene.
 *
 * Mouselook on pointer-lock, WASD / arrow-key planar movement, Space jump,
 * Ctrl crouch. Each input axis is independently toggleable.
 *
 *   <PolyCamera rotX={90} rotY={0}>
 *     <PolyScene>
 *       <PolyFirstPersonControls moveSpeed={8} eyeHeight={1.7} />
 *       <PolyMesh polygons={...} />
 *     </PolyScene>
 *   </PolyCamera>
 *
 * Click the scene to acquire pointer-lock; Escape releases it.
 */
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { BASE_TILE } from "@layoutit/polycss-core";
import { useCameraContext } from "../camera/context";

// ── Public types (mirror vanilla names/shapes) ───────────────────────────────

export interface PolyFirstPersonControlsOptions {
  /** Master switch. When `false`, all sub-controls are inert. Default: `true`. */
  enabled?: boolean;
  /** Pointer-lock mouselook (rotX = pitch, rotY = yaw). Default: `true`. */
  lookEnabled?: boolean;
  /** WASD / arrow-key planar movement on world XY. Default: `true`. */
  moveEnabled?: boolean;
  /** Space-bar parametric jump arc on world Z. Default: `true`. */
  jumpEnabled?: boolean;
  /** Ctrl crouch (lowers eye height while held). Default: `true`. */
  crouchEnabled?: boolean;
  /** Mouselook sensitivity in degrees per pixel. Default: `0.15`. */
  lookSensitivity?: number;
  /** Invert vertical mouselook. Default: `false`. */
  invertY?: boolean;
  /** Movement speed in world units per second. Default: `5`. */
  moveSpeed?: number;
  /** Initial vertical velocity for a jump, world units per second. Default: `7`. */
  jumpVelocity?: number;
  /** Gravity acceleration in world units per second squared. Default: `18`. */
  gravity?: number;
  /** Standing eye height above the ground plane. Default: `1.7`. */
  eyeHeight?: number;
  /** Eye height while crouching. Default: `1`. */
  crouchHeight?: number;
  /** World Z of the ground plane the player walks on. Default: `0`. */
  groundZ?: number;
  /** Min pitch (rotX) angle in degrees. Default: `5`. */
  minPitch?: number;
  /** Max pitch (rotX) angle in degrees. Default: `175`. */
  maxPitch?: number;
}

export interface PolyFirstPersonControlsHandle {
  update(partial: PolyFirstPersonControlsOptions): void;
  resume(): void;
  pause(): void;
  destroy(): void;
  /** Request pointer-lock now. Call from a user gesture (click). */
  lock(): void;
  /** Release pointer-lock. */
  unlock(): void;
  /** Whether pointer-lock is currently held. */
  isLocked(): boolean;
  /**
   * The camera's WORLD position (the eye). Snapshot — mutate via WASD /
   * jump / crouch, or by calling `setOrigin`.
   */
  getOrigin(): [number, number, number];
  /**
   * Move the camera origin to a specific world position. Re-derives the
   * scene's target so the perspective viewer follows.
   */
  setOrigin(origin: [number, number, number]): void;
  addEventListener(type: "change" | "start" | "end", listener: () => void): void;
  removeEventListener(type: "change" | "start" | "end", listener: () => void): void;
  hasEventListener(type: "change" | "start" | "end", listener: () => void): boolean;
}

export interface PolyFirstPersonControlsProps extends PolyFirstPersonControlsOptions {
  /** Called on every camera state change (mouselook, WASD, jump, crouch). */
  onChange?: () => void;
  /** Called when pointer-lock is acquired (interaction starts). */
  onInteractionStart?: () => void;
  /** Called when pointer-lock is released (interaction ends). */
  onInteractionEnd?: () => void;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

interface ResolvedOptions {
  enabled: boolean;
  lookEnabled: boolean;
  moveEnabled: boolean;
  jumpEnabled: boolean;
  crouchEnabled: boolean;
  lookSensitivity: number;
  invertY: boolean;
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  eyeHeight: number;
  crouchHeight: number;
  groundZ: number;
  minPitch: number;
  maxPitch: number;
}

const DEFAULTS: ResolvedOptions = {
  enabled: true,
  lookEnabled: true,
  moveEnabled: true,
  jumpEnabled: true,
  crouchEnabled: true,
  lookSensitivity: 0.15,
  invertY: false,
  moveSpeed: 5,
  jumpVelocity: 7,
  gravity: 18,
  eyeHeight: 1.7,
  crouchHeight: 1,
  groundZ: 0,
  minPitch: 5,
  maxPitch: 175,
};

function resolveOptions(base: ResolvedOptions, partial: PolyFirstPersonControlsOptions): ResolvedOptions {
  return {
    enabled: partial.enabled ?? base.enabled,
    lookEnabled: partial.lookEnabled ?? base.lookEnabled,
    moveEnabled: partial.moveEnabled ?? base.moveEnabled,
    jumpEnabled: partial.jumpEnabled ?? base.jumpEnabled,
    crouchEnabled: partial.crouchEnabled ?? base.crouchEnabled,
    lookSensitivity: partial.lookSensitivity ?? base.lookSensitivity,
    invertY: partial.invertY ?? base.invertY,
    moveSpeed: partial.moveSpeed ?? base.moveSpeed,
    jumpVelocity: partial.jumpVelocity ?? base.jumpVelocity,
    gravity: partial.gravity ?? base.gravity,
    eyeHeight: partial.eyeHeight ?? base.eyeHeight,
    crouchHeight: partial.crouchHeight ?? base.crouchHeight,
    groundZ: partial.groundZ ?? base.groundZ,
    minPitch: partial.minPitch ?? base.minPitch,
    maxPitch: partial.maxPitch ?? base.maxPitch,
  };
}

// ── Key sets ──────────────────────────────────────────────────────────────────

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);
const JUMP_KEYS = new Set(["Space"]);
const CROUCH_KEYS = new Set(["ControlLeft", "ControlRight"]);

function isFpvKey(code: string): boolean {
  return (
    FORWARD_KEYS.has(code) ||
    BACK_KEYS.has(code) ||
    LEFT_KEYS.has(code) ||
    RIGHT_KEYS.has(code) ||
    JUMP_KEYS.has(code) ||
    CROUCH_KEYS.has(code)
  );
}

// ── Listener registry ─────────────────────────────────────────────────────────

type EventType = "change" | "start" | "end";

interface ListenerRegistry {
  change: Array<() => void>;
  start: Array<() => void>;
  end: Array<() => void>;
}

function makeRegistry(): ListenerRegistry {
  return { change: [], start: [], end: [] };
}

function emitEvent(registry: ListenerRegistry, type: EventType): void {
  const list = [...registry[type]]; // snapshot to avoid mutation during iteration
  for (const fn of list) {
    try { fn(); } catch { /* ignore */ }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PolyFirstPersonControls = forwardRef<
  PolyFirstPersonControlsHandle,
  PolyFirstPersonControlsProps
>(function PolyFirstPersonControls(props, ref): null {
  const { store, cameraRef, cameraElRef, applyTransformDirect } = useCameraContext();

  // Keep callback refs stable so the inner effect closure always calls
  // the latest callback without needing to be recreated.
  const onChangeRef = useRef(props.onChange);
  const onInteractionStartRef = useRef(props.onInteractionStart);
  const onInteractionEndRef = useRef(props.onInteractionEnd);
  useEffect(() => {
    onChangeRef.current = props.onChange;
    onInteractionStartRef.current = props.onInteractionStart;
    onInteractionEndRef.current = props.onInteractionEnd;
  });

  // Options are kept in a ref so the RAF tick always reads the latest
  // values without requiring an effect dependency on every option.
  const optsRef = useRef<ResolvedOptions>(resolveOptions(DEFAULTS, props));

  // Camera origin (eye position in world coords).
  const cameraOriginRef = useRef<[number, number, number]>([0, 0, 0]);

  // RAF state
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const stoppedRef = useRef(false);

  // Pointer-lock + interaction state
  const pointerLockedRef = useRef(false);
  const interactingRef = useRef(false);

  // Keys held
  const keysHeldRef = useRef<Set<string>>(new Set());

  // Vertical state for jump/gravity
  const verticalVelRef = useRef(0);
  const jumpOffsetRef = useRef(0);

  // Listener registry for the imperative handle's event API
  const registryRef = useRef<ListenerRegistry>(makeRegistry());

  // Stopped flag drives pause/resume (internal to the effect)
  // stoppedRef.current is checked in tick and event handlers

  // Imperative handle ─────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    update(partial: PolyFirstPersonControlsOptions): void {
      const prev = optsRef.current;
      optsRef.current = resolveOptions(prev, partial);
      if (!stoppedRef.current) {
        const host = cameraElRef.current;
        if (host) host.style.cursor = optsRef.current.lookEnabled ? "crosshair" : "";
      }
    },
    resume(): void {
      if (!stoppedRef.current) return;
      stoppedRef.current = false;
      const host = cameraElRef.current;
      if (host) host.style.cursor = optsRef.current.lookEnabled ? "crosshair" : "";
      startLoop();
    },
    pause(): void {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      stopLoop();
      const host = cameraElRef.current;
      if (host) host.style.cursor = "";
      if (interactingRef.current) {
        interactingRef.current = false;
        emitEvent(registryRef.current, "end");
        try { onInteractionEndRef.current?.(); } catch { /* ignore */ }
      }
    },
    destroy(): void {
      stoppedRef.current = true;
      stopLoop();
    },
    lock(): void {
      const opts = optsRef.current;
      if (!opts.enabled || !opts.lookEnabled || stoppedRef.current) return;
      const host = cameraElRef.current;
      try { host?.requestPointerLock(); } catch { /* ignore */ }
    },
    unlock(): void {
      if (pointerLockedRef.current) {
        const host = cameraElRef.current;
        try { host?.ownerDocument?.exitPointerLock(); } catch { /* ignore */ }
      }
    },
    isLocked(): boolean {
      return pointerLockedRef.current;
    },
    getOrigin(): [number, number, number] {
      const o = cameraOriginRef.current;
      return [o[0], o[1], o[2]];
    },
    setOrigin(origin: [number, number, number]): void {
      cameraOriginRef.current[0] = origin[0];
      cameraOriginRef.current[1] = origin[1];
      cameraOriginRef.current[2] = origin[2];
      syncTargetFromOrigin();
      emitEvent(registryRef.current, "change");
      try { onChangeRef.current?.(); } catch { /* ignore */ }
    },
    addEventListener(type: EventType, listener: () => void): void {
      const arr = registryRef.current[type];
      if (!arr.includes(listener)) arr.push(listener);
    },
    removeEventListener(type: EventType, listener: () => void): void {
      const arr = registryRef.current[type];
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    },
    hasEventListener(type: EventType, listener: () => void): boolean {
      return registryRef.current[type].includes(listener);
    },
  }));

  // ── Helpers ────────────────────────────────────────────────────────────────

  function forwardDir(rotX: number, rotY: number): [number, number, number] {
    const rx = (rotX * Math.PI) / 180;
    const ry = (rotY * Math.PI) / 180;
    return [
      -Math.sin(rx) * Math.cos(ry),
      -Math.sin(rx) * Math.sin(ry),
      -Math.cos(rx),
    ];
  }

  function lookOffset(): number {
    const host = cameraElRef.current;
    const perspStr = host ? getComputedStyle(host).perspective : "";
    const n = parseFloat(perspStr);
    return (Number.isFinite(n) && n > 0 ? n : 8000) / BASE_TILE;
  }

  function deriveTarget(): [number, number, number] {
    const s = cameraRef.current.state;
    const f = forwardDir(s.rotX ?? 90, s.rotY ?? 0);
    const d = lookOffset();
    const o = cameraOriginRef.current;
    return [o[0] + f[0] * d, o[1] + f[1] * d, o[2] + f[2] * d];
  }

  function syncTargetFromOrigin(): void {
    const t = deriveTarget();
    const handle = cameraRef.current;
    handle.update({ target: t });
    applyTransformDirect();
    store.updateCameraFromRef(handle);
  }

  // ── RAF tick ───────────────────────────────────────────────────────────────

  const ANIM_DT_CLAMP = 0.05;

  function tick(now: number): void {
    if (rafIdRef.current === null || stoppedRef.current) return;
    const dt = Math.min(ANIM_DT_CLAMP, lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0.0167);
    lastTimeRef.current = now;

    const opts = optsRef.current;
    if (opts.enabled) {
      let dirty = false;
      const s = cameraRef.current.state;
      const o = cameraOriginRef.current;

      // Horizontal movement
      if (opts.moveEnabled) {
        let mf = 0, mr = 0;
        for (const code of keysHeldRef.current) {
          if (FORWARD_KEYS.has(code)) mf += 1;
          else if (BACK_KEYS.has(code)) mf -= 1;
          else if (RIGHT_KEYS.has(code)) mr += 1;
          else if (LEFT_KEYS.has(code)) mr -= 1;
        }
        if (mf !== 0 || mr !== 0) {
          const rotY = s.rotY ?? 0;
          const r = (rotY * Math.PI) / 180;
          const fx = -Math.cos(r), fy = -Math.sin(r);
          const rx = -Math.sin(r), ry = Math.cos(r);
          const len = Math.hypot(mf, mr) || 1;
          const step = opts.moveSpeed * dt;
          o[0] += ((fx * mf + rx * mr) / len) * step;
          o[1] += ((fy * mf + ry * mr) / len) * step;
          dirty = true;
        }
      }

      // Vertical (jump + gravity + crouch)
      const crouched = opts.crouchEnabled &&
        (keysHeldRef.current.has("ControlLeft") || keysHeldRef.current.has("ControlRight"));
      const baseHeight = crouched ? opts.crouchHeight : opts.eyeHeight;
      if (opts.jumpEnabled && (verticalVelRef.current !== 0 || jumpOffsetRef.current > 0)) {
        verticalVelRef.current -= opts.gravity * dt;
        jumpOffsetRef.current += verticalVelRef.current * dt;
        if (jumpOffsetRef.current <= 0) {
          jumpOffsetRef.current = 0;
          verticalVelRef.current = 0;
        }
      } else if (!opts.jumpEnabled) {
        jumpOffsetRef.current = 0;
        verticalVelRef.current = 0;
      }
      const originZ = opts.groundZ + baseHeight + jumpOffsetRef.current;
      if (Math.abs(o[2] - originZ) > 1e-4) {
        o[2] = originZ;
        dirty = true;
      }

      if (dirty) {
        const t = deriveTarget();
        const handle = cameraRef.current;
        handle.update({ target: t });
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        emitEvent(registryRef.current, "change");
        try { onChangeRef.current?.(); } catch { /* ignore */ }
      }
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }

  function startLoop(): void {
    if (rafIdRef.current !== null || stoppedRef.current) return;
    lastTimeRef.current = 0;
    rafIdRef.current = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafIdRef.current === null) return;
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = null;
  }

  // ── Main effect — attaches / detaches all listeners ─────────────────────────

  useEffect(() => {
    const host = cameraElRef.current;
    if (!host) return;

    const doc = host.ownerDocument ?? document;
    const win = (doc.defaultView ?? globalThis) as typeof globalThis;

    stoppedRef.current = false;
    pointerLockedRef.current = false;
    interactingRef.current = false;
    keysHeldRef.current.clear();
    verticalVelRef.current = 0;
    jumpOffsetRef.current = 0;

    // Seed camera origin from current target, snapped to eye height
    const s = cameraRef.current.state;
    const t = s.target ?? [0, 0, 0];
    const opts = optsRef.current;
    cameraOriginRef.current = [t[0], t[1], opts.groundZ + opts.eyeHeight];
    syncTargetFromOrigin();

    // Apply initial cursor
    host.style.cursor = opts.lookEnabled ? "crosshair" : "";

    // FPV needs a perspective context on the host so scene Z motion shows
    // as depth, not as a planar pan. Read the current effective perspective
    // BEFORE adding the class so we honor any value the camera component
    // set (PolyPerspectiveCamera's inline `perspective: Npx`); fall back to
    // 2000px for orthographic (`perspective: none`) so the FPV math and
    // visual perspective stay in sync. The `.polycss-fpv-host` class uses
    // `!important` (see styles.ts) to override inline `perspective: none`.
    const computedPersp = win.getComputedStyle(host).perspective;
    const persp = parseFloat(computedPersp);
    const effectivePersp = Number.isFinite(persp) && persp > 0 ? persp : 2000;
    host.style.setProperty("--polycss-fpv-perspective", `${effectivePersp}px`);
    host.classList.add("polycss-fpv-host");

    // ── Pointer-lock ──────────────────────────────────────────────────────────
    const onHostClick = (): void => {
      const o = optsRef.current;
      if (!o.enabled || !o.lookEnabled || stoppedRef.current || pointerLockedRef.current) return;
      try { host.requestPointerLock(); } catch { /* ignore */ }
    };

    const onPointerLockChange = (): void => {
      const locked = doc.pointerLockElement === host;
      if (locked === pointerLockedRef.current) return;
      pointerLockedRef.current = locked;
      if (locked) {
        interactingRef.current = true;
        emitEvent(registryRef.current, "start");
        try { onInteractionStartRef.current?.(); } catch { /* ignore */ }
      } else {
        if (interactingRef.current) {
          interactingRef.current = false;
          emitEvent(registryRef.current, "end");
          try { onInteractionEndRef.current?.(); } catch { /* ignore */ }
        }
      }
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!pointerLockedRef.current || stoppedRef.current) return;
      const o = optsRef.current;
      if (!o.enabled || !o.lookEnabled) return;
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;
      if (dx === 0 && dy === 0) return;
      const handle = cameraRef.current;
      const sceneOpts = handle.state;
      const sens = o.lookSensitivity;
      const dyDir = o.invertY ? -1 : 1;
      const rotY = ((((sceneOpts.rotY ?? 0) - dx * sens) % 360) + 360) % 360;
      let rotX = (sceneOpts.rotX ?? 90) - dy * sens * dyDir;
      if (rotX < o.minPitch) rotX = o.minPitch;
      else if (rotX > o.maxPitch) rotX = o.maxPitch;
      const f = forwardDir(rotX, rotY);
      const d = lookOffset();
      const origin = cameraOriginRef.current;
      const target: [number, number, number] = [
        origin[0] + f[0] * d,
        origin[1] + f[1] * d,
        origin[2] + f[2] * d,
      ];
      handle.update({ rotX, rotY, target });
      applyTransformDirect();
      store.updateCameraFromRef(handle);
      emitEvent(registryRef.current, "change");
      try { onChangeRef.current?.(); } catch { /* ignore */ }
    };

    // ── Keyboard ──────────────────────────────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent): void => {
      const o = optsRef.current;
      if (!o.enabled || stoppedRef.current) return;
      if (!isFpvKey(e.code)) return;
      if (!pointerLockedRef.current && !o.moveEnabled) return;
      if (JUMP_KEYS.has(e.code)) {
        if (!o.jumpEnabled) return;
        e.preventDefault();
        if (!keysHeldRef.current.has(e.code) && verticalVelRef.current === 0 && jumpOffsetRef.current === 0) {
          verticalVelRef.current = o.jumpVelocity;
        }
        keysHeldRef.current.add(e.code);
        return;
      }
      if (CROUCH_KEYS.has(e.code) && !o.crouchEnabled) return;
      if (!o.moveEnabled && !CROUCH_KEYS.has(e.code)) return;
      e.preventDefault();
      keysHeldRef.current.add(e.code);
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      if (!isFpvKey(e.code)) return;
      keysHeldRef.current.delete(e.code);
    };

    const onBlur = (): void => {
      keysHeldRef.current.clear();
    };

    host.addEventListener("click", onHostClick);
    doc.addEventListener("pointerlockchange", onPointerLockChange);
    doc.addEventListener("mousemove", onMouseMove);
    win.addEventListener("keydown", onKeyDown);
    win.addEventListener("keyup", onKeyUp);
    win.addEventListener("blur", onBlur);

    startLoop();

    return () => {
      stoppedRef.current = true;
      stopLoop();
      host.removeEventListener("click", onHostClick);
      doc.removeEventListener("pointerlockchange", onPointerLockChange);
      doc.removeEventListener("mousemove", onMouseMove);
      win.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("keyup", onKeyUp);
      win.removeEventListener("blur", onBlur);
      host.style.cursor = "";
      host.classList.remove("polycss-fpv-host");
      host.style.removeProperty("--polycss-fpv-perspective");
      keysHeldRef.current.clear();
      if (pointerLockedRef.current) {
        try { doc.exitPointerLock(); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraElRef, cameraRef, applyTransformDirect, store]);

  // ── Prop-change effect — forwards updates without destroying controls ────────

  useEffect(() => {
    optsRef.current = resolveOptions(optsRef.current, props);
    const host = cameraElRef.current;
    if (host && !stoppedRef.current) {
      host.style.cursor = optsRef.current.lookEnabled ? "crosshair" : "";
    }
  });

  return null;
});
