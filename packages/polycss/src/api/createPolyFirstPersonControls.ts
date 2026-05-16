/**
 * createPolyFirstPersonControls — first-person camera input for a PolyScene.
 *
 * Mouselook on pointer-lock, WASD/arrow planar move in the yaw-aligned XY
 * plane, Space jump (parametric arc, no collision), Ctrl crouch. Each input
 * axis is independently toggleable so callers can mix-and-match (e.g.
 * mouselook-only on a model viewer, or move-only on a tour rail).
 *
 * For orbit semantics use `createPolyOrbitControls`. For pan/orbit map
 * semantics use `createPolyMapControls`.
 */

import type { PolySceneHandle } from "./createPolyScene";
import { BASE_TILE } from "@layoutit/polycss-core";
import {
  makeListenerRegistry,
  makeCameraSnapshot,
  type PolyControlsEvent,
  type PolyControlsListener,
} from "./controls/common";

export type {
  PolyControlsCamera,
  PolyControlsChangeEvent,
  PolyControlsInteractionEvent,
  PolyControlsEvent,
  PolyControlsListener,
} from "./controls/common";

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
  /** Standing eye height above the ground plane (target.z). Default: `1.7`. */
  eyeHeight?: number;
  /** Eye height while crouching. Default: `1`. */
  crouchHeight?: number;
  /** World Z of the ground plane the player walks on. Default: `0`. */
  groundZ?: number;
  /** Min pitch (rotX) angle. Default: `5`. */
  minPitch?: number;
  /** Max pitch (rotX) angle. Default: `175`. */
  maxPitch?: number;
}

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
   * The camera's WORLD position (the eye). FPV maintains this separately
   * from the scene's `target` so mouselook rotates around it (in-place)
   * instead of orbiting around target. Snapshot — mutate via WASD / jump /
   * crouch, or by calling `setOrigin`.
   */
  getOrigin(): [number, number, number];
  /**
   * Move the camera origin to a specific world position. Re-derives the
   * scene's target so the perspective viewer follows. Use this to teleport,
   * spawn at a chosen spot, etc.
   */
  setOrigin(origin: [number, number, number]): void;
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

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);
const JUMP_KEYS = new Set(["Space"]);
const CROUCH_KEYS = new Set(["ControlLeft", "ControlRight"]);

export function createPolyFirstPersonControls(
  scene: PolySceneHandle,
  options: PolyFirstPersonControlsOptions = {},
): PolyFirstPersonControlsHandle {
  let opts: ResolvedOptions = resolveOptions(DEFAULTS, options);
  const host = scene.host;
  const doc = host.ownerDocument ?? document;
  const win = (doc.defaultView ?? globalThis) as typeof globalThis;

  const registry = makeListenerRegistry();
  const snapshot = makeCameraSnapshot(scene);
  const { changeListeners, startListeners, endListeners, listenerArray, emitChange, emitInteraction } = registry;

  const keysHeld = new Set<string>();
  let pointerLocked = false;
  let stopped = false;

  // Vertical state (separate from origin.z so we can stack crouch + jump).
  // verticalVel is non-zero only mid-air; jumpOffset accumulates from gravity.
  let verticalVel = 0;
  let jumpOffset = 0;
  let interacting = false;

  // True first-person model (matches three.js PointerLockControls semantics):
  //   - `cameraOrigin` is the camera's WORLD position (the eye).
  //   - `target` is a DERIVED point ahead of the camera along its look
  //     direction at offset `perspective / tile`, so polycss's perspective
  //     viewer (located at +CSS_Z from scene origin) mathematically coincides
  //     with `cameraOrigin` in world space.
  //   - Mouselook rotates `target` AROUND `cameraOrigin` (origin fixed) →
  //     in-place rotation, not orbit.
  //   - WASD moves `cameraOrigin` (target follows via the same offset).
  //
  // Without this separation, polycss's rotation pivots around `target` itself,
  // which is camera position with distance=0 — that's orbit-style and reads
  // as "the camera circles a point in front of itself" when you mouselook.
  let cameraOrigin: [number, number, number] = [0, 0, opts.groundZ + opts.eyeHeight];

  function forwardDir(rotX: number, rotY: number): [number, number, number] {
    const rx = (rotX * Math.PI) / 180;
    const ry = (rotY * Math.PI) / 180;
    // Derived from polycss's scene transform inverse: the world direction
    // that maps to CSS -Z (into the screen) under `rotateX(rotX) rotate(rotY)`
    // + the axis swap (worldY→CSS X, worldX→CSS Y).
    return [
      -Math.sin(rx) * Math.cos(ry),
      -Math.sin(rx) * Math.sin(ry),
      -Math.cos(rx),
    ];
  }

  function lookOffset(): number {
    // Distance from camera origin to derived target in world units. For the
    // polycss perspective viewer to coincide with `cameraOrigin`, this must
    // equal `perspective / tile`. If perspective is `false` (orthographic)
    // polycss internally clamps to a 1e6 px value — use a sane fallback so
    // the camera doesn't end up infinitely far from its target.
    const persp = scene.getOptions().perspective;
    const n = typeof persp === "number" && persp > 0 ? persp : 2000;
    return n / BASE_TILE;
  }

  function deriveTarget(): [number, number, number] {
    const sceneOpts = scene.getOptions();
    const f = forwardDir(sceneOpts.rotX ?? 90, sceneOpts.rotY ?? 0);
    const d = lookOffset();
    return [
      cameraOrigin[0] + f[0] * d,
      cameraOrigin[1] + f[1] * d,
      cameraOrigin[2] + f[2] * d,
    ];
  }

  function syncTargetFromOrigin(): void {
    const t = deriveTarget();
    scene.setOptions({ target: t });
  }

  // On attach, seed `cameraOrigin` from whatever the scene currently has as
  // target — the user's previous control mode (orbit/pan) was treating target
  // as the visual center. We adopt that as the FPV camera position, then snap
  // its Z to eye height above the ground plane. After this, FPV is fully
  // authoritative: we only ever write target as a derived value.
  function initializeOriginFromTarget(): void {
    const sceneOpts = scene.getOptions();
    const t = sceneOpts.target ?? [0, 0, 0];
    cameraOrigin = [t[0], t[1], opts.groundZ + opts.eyeHeight];
    syncTargetFromOrigin();
  }

  // ── Pointer-lock ─────────────────────────────────────────────────────────
  const onHostClick = (): void => {
    if (!opts.enabled || !opts.lookEnabled || stopped || pointerLocked) return;
    try { host.requestPointerLock(); } catch { /* ignore */ }
  };

  const onPointerLockChange = (): void => {
    const locked = doc.pointerLockElement === host;
    if (locked === pointerLocked) return;
    pointerLocked = locked;
    if (pointerLocked) {
      interacting = true;
      emitInteraction("start", snapshot);
    } else {
      if (interacting) {
        interacting = false;
        emitInteraction("end", snapshot);
      }
    }
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!pointerLocked || !opts.enabled || !opts.lookEnabled || stopped) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    if (dx === 0 && dy === 0) return;
    const sceneOpts = scene.getOptions();
    const sens = opts.lookSensitivity;
    const dyDir = opts.invertY ? -1 : 1;
    // Yaw: mouse right → look right → rotY decreases (world rotates CW, camera CCW).
    const rotY = ((((sceneOpts.rotY ?? 0) - dx * sens) % 360) + 360) % 360;
    // Pitch: mouse down → look down → rotX decreases below 90 (rotX=90 horizontal).
    let rotX = (sceneOpts.rotX ?? 90) - dy * sens * dyDir;
    if (rotX < opts.minPitch) rotX = opts.minPitch;
    else if (rotX > opts.maxPitch) rotX = opts.maxPitch;
    // Update rotation first, then re-derive target so it lives at
    // `cameraOrigin + new_lookDir * lookOffset`. Result: target swings around
    // the fixed origin = camera rotates in place (true first-person), instead
    // of orbiting some point in front of itself.
    const f = forwardDir(rotX, rotY);
    const d = lookOffset();
    const target: [number, number, number] = [
      cameraOrigin[0] + f[0] * d,
      cameraOrigin[1] + f[1] * d,
      cameraOrigin[2] + f[2] * d,
    ];
    scene.setOptions({ rotX, rotY, target });
    emitChange(snapshot);
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const isFpvKey = (code: string): boolean =>
    FORWARD_KEYS.has(code) ||
    BACK_KEYS.has(code) ||
    LEFT_KEYS.has(code) ||
    RIGHT_KEYS.has(code) ||
    JUMP_KEYS.has(code) ||
    CROUCH_KEYS.has(code);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!opts.enabled || stopped) return;
    if (!isFpvKey(e.code)) return;
    // Only intercept while pointer-locked OR moving — otherwise let the
    // page handle Space/Ctrl normally (page scroll, browser shortcuts).
    if (!pointerLocked && !opts.moveEnabled) return;
    if (JUMP_KEYS.has(e.code)) {
      if (!opts.jumpEnabled) return;
      e.preventDefault();
      // Jump only when grounded (no held velocity, no offset).
      if (!keysHeld.has(e.code) && verticalVel === 0 && jumpOffset === 0) {
        verticalVel = opts.jumpVelocity;
      }
      keysHeld.add(e.code);
      return;
    }
    if (CROUCH_KEYS.has(e.code) && !opts.crouchEnabled) return;
    if (!opts.moveEnabled && !CROUCH_KEYS.has(e.code)) return;
    e.preventDefault();
    keysHeld.add(e.code);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (!isFpvKey(e.code)) return;
    keysHeld.delete(e.code);
  };

  const onBlur = (): void => {
    keysHeld.clear();
  };

  // ── RAF tick ──────────────────────────────────────────────────────────────
  let rafId: number | null = null;
  let lastTime = 0;
  const ANIM_DT_CLAMP = 0.05; // 50 ms

  const tick = (now: number): void => {
    if (rafId === null || stopped) return;
    const dt = Math.min(ANIM_DT_CLAMP, lastTime ? (now - lastTime) / 1000 : 0.0167);
    lastTime = now;

    if (opts.enabled) {
      let dirty = false;
      const sceneOpts = scene.getOptions();

      // ── Move (horizontal): WASD walks the camera origin on the XY plane. ──
      if (opts.moveEnabled) {
        let mf = 0; // forward axis
        let mr = 0; // right axis
        for (const code of keysHeld) {
          if (FORWARD_KEYS.has(code)) mf += 1;
          else if (BACK_KEYS.has(code)) mf -= 1;
          else if (RIGHT_KEYS.has(code)) mr += 1;
          else if (LEFT_KEYS.has(code)) mr -= 1;
        }
        if (mf !== 0 || mr !== 0) {
          const rotY = sceneOpts.rotY ?? 0;
          const r = (rotY * Math.PI) / 180;
          // Horizontal forward (yaw projection onto world XY), independent of
          // pitch — matches three.js PointerLockControls.moveForward which
          // crosses camera.up with camera.right to drop the vertical
          // component. WASD always walks the floor, never flies.
          const fx = -Math.cos(r);
          const fy = -Math.sin(r);
          const rx = -Math.sin(r);
          const ry = Math.cos(r);
          const len = Math.hypot(mf, mr) || 1;
          const step = opts.moveSpeed * dt;
          cameraOrigin[0] += ((fx * mf + rx * mr) / len) * step;
          cameraOrigin[1] += ((fy * mf + ry * mr) / len) * step;
          dirty = true;
        }
      }

      // ── Vertical: jump + gravity + crouch (mutates cameraOrigin.z). ──
      const crouched = opts.crouchEnabled
        && (keysHeld.has("ControlLeft") || keysHeld.has("ControlRight"));
      const baseHeight = crouched ? opts.crouchHeight : opts.eyeHeight;
      if (opts.jumpEnabled && (verticalVel !== 0 || jumpOffset > 0)) {
        verticalVel -= opts.gravity * dt;
        jumpOffset += verticalVel * dt;
        if (jumpOffset <= 0) {
          jumpOffset = 0;
          verticalVel = 0;
        }
      } else if (!opts.jumpEnabled) {
        jumpOffset = 0;
        verticalVel = 0;
      }
      const originZ = opts.groundZ + baseHeight + jumpOffset;
      if (Math.abs(cameraOrigin[2] - originZ) > 1e-4) {
        cameraOrigin[2] = originZ;
        dirty = true;
      }

      if (dirty) {
        // Re-derive target from the new origin so polycss's perspective viewer
        // tracks the camera. Without this, walking forward would move
        // `cameraOrigin` but target would stay put, and the visible center
        // would drift behind us.
        const target = deriveTarget();
        scene.setOptions({ target });
        emitChange(snapshot);
      }
    }

    rafId = win.requestAnimationFrame(tick);
  };

  function startLoop(): void {
    if (rafId !== null || stopped) return;
    lastTime = 0;
    rafId = win.requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId === null) return;
    win.cancelAnimationFrame(rafId);
    rafId = null;
  }

  function attach(): void {
    host.addEventListener("click", onHostClick);
    doc.addEventListener("pointerlockchange", onPointerLockChange);
    doc.addEventListener("mousemove", onMouseMove);
    win.addEventListener("keydown", onKeyDown);
    win.addEventListener("keyup", onKeyUp);
    win.addEventListener("blur", onBlur);
    host.style.cursor = opts.lookEnabled ? "crosshair" : "";
  }

  function detach(): void {
    host.removeEventListener("click", onHostClick);
    doc.removeEventListener("pointerlockchange", onPointerLockChange);
    doc.removeEventListener("mousemove", onMouseMove);
    win.removeEventListener("keydown", onKeyDown);
    win.removeEventListener("keyup", onKeyUp);
    win.removeEventListener("blur", onBlur);
    host.style.cursor = "";
    keysHeld.clear();
    if (pointerLocked) {
      try { doc.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  initializeOriginFromTarget();
  attach();
  startLoop();

  function update(partial: PolyFirstPersonControlsOptions): void {
    const prevHeight = opts.eyeHeight;
    const prevGround = opts.groundZ;
    opts = resolveOptions(opts, partial);
    if (!stopped) host.style.cursor = opts.lookEnabled ? "crosshair" : "";
    if (opts.eyeHeight !== prevHeight || opts.groundZ !== prevGround) {
      // Re-snap the camera's vertical position when the floor or standing
      // height changes (e.g. slider drag). Horizontal position is preserved.
      cameraOrigin[2] = opts.groundZ + opts.eyeHeight;
      syncTargetFromOrigin();
      emitChange(snapshot);
    }
  }

  function resume(): void {
    if (!stopped) return;
    stopped = false;
    attach();
    startLoop();
  }

  function pause(): void {
    if (stopped) return;
    stopped = true;
    detach();
    stopLoop();
    if (interacting) {
      interacting = false;
      emitInteraction("end", snapshot);
    }
  }

  function destroy(): void {
    pause();
    changeListeners.length = 0;
    startListeners.length = 0;
    endListeners.length = 0;
  }

  function lock(): void {
    if (!opts.enabled || !opts.lookEnabled || stopped) return;
    try { host.requestPointerLock(); } catch { /* ignore */ }
  }

  function unlock(): void {
    if (pointerLocked) {
      try { doc.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  function isLocked(): boolean {
    return pointerLocked;
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

  function getOrigin(): [number, number, number] {
    return [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]];
  }

  function setOrigin(origin: [number, number, number]): void {
    cameraOrigin[0] = origin[0];
    cameraOrigin[1] = origin[1];
    cameraOrigin[2] = origin[2];
    syncTargetFromOrigin();
    emitChange(snapshot);
  }

  return {
    update,
    resume,
    pause,
    destroy,
    lock,
    unlock,
    isLocked,
    getOrigin,
    setOrigin,
    addEventListener,
    removeEventListener,
    hasEventListener,
  };
}
