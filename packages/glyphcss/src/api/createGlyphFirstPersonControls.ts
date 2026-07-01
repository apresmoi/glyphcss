// Vendored from voxcss packages/polycss/src/api/createPolyFirstPersonControls.ts@cac9da3.
// glyphcss deltas: Poly→Glyph rename; the camera sync uses eyeMode (target IS the
// eye, projected along rotX/rotY) instead of polycss's CSS-perspective + derived
// look-ahead target — so there's no cameraEl/perspective-host plumbing and no
// lookOffset. Otherwise the input model (pointer-lock mouselook, WASD planar
// move, Space jump, Ctrl crouch, gravity) and the option/handle surface match
// voxcss 1:1. Like voxcss, model-relative sizing (eye height / spawn / speed) is
// the caller's job — pass proportional options (see the gallery's FPV spawn).
/**
 * createGlyphFirstPersonControls — first-person camera input for a GlyphScene.
 *
 * Mouselook on pointer-lock, WASD/arrow planar move in the yaw-aligned XY
 * plane, Space jump (parametric arc, no collision), Ctrl crouch. Each input
 * axis is independently toggleable.
 *
 * Requires a perspective camera; sets `camera.eyeMode = true` on attach (the
 * camera projects from `target` along rotX/rotY) and restores it on detach.
 * rotX/rotY are in DEGREES (three.js / voxcss convention).
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

export interface GlyphFirstPersonControlsOptions {
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

function resolveOptions(base: ResolvedOptions, partial: GlyphFirstPersonControlsOptions): ResolvedOptions {
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

export interface GlyphFirstPersonControlsHandle extends GlyphControlsEventTarget {
  update(partial: GlyphFirstPersonControlsOptions): void;
  resume(): void;
  pause(): void;
  destroy(): void;
  /** Request pointer-lock now. Call from a user gesture (click). */
  lock(): void;
  /** Release pointer-lock. */
  unlock(): void;
  /** Whether pointer-lock is currently held. */
  isLocked(): boolean;
  /** The camera's WORLD position (the eye). Mutated via WASD / jump / crouch. */
  getOrigin(): [number, number, number];
  /** Teleport the camera eye to a world position (e.g. spawn at a chosen spot). */
  setOrigin(origin: [number, number, number]): void;
}

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);
const JUMP_KEYS = new Set(["Space"]);
const CROUCH_KEYS = new Set(["ControlLeft", "ControlRight"]);

export function createGlyphFirstPersonControls(
  scene: GlyphSceneHandle,
  options: GlyphFirstPersonControlsOptions = {},
): GlyphFirstPersonControlsHandle {
  if (scene.camera.kind !== "perspective") {
    throw new Error(
      "glyphcss: GlyphFirstPersonControls requires a perspective camera. " +
      "Use <GlyphPerspectiveCamera> (not <GlyphOrthographicCamera> / <GlyphCamera>).",
    );
  }

  let opts: ResolvedOptions = resolveOptions(DEFAULTS, options);
  const camera = scene.camera;
  const host = scene.host;
  const doc = host.ownerDocument ?? document;
  const win = (doc.defaultView ?? globalThis) as typeof globalThis;

  const registry = makeListenerRegistry(scene);
  const snapshot = makeCameraSnapshot(scene);
  const { emitChange, emitInteraction } = registry;

  const keysHeld = new Set<string>();
  let pointerLocked = false;
  let stopped = false;

  // Vertical state, separate from origin.z so crouch + jump stack.
  let verticalVel = 0;
  let jumpOffset = 0;

  // In eyeMode the camera projects FROM `target`, so the eye IS `target`. We
  // keep an authoritative `cameraOrigin` and write it straight to `target`;
  // mouselook only changes rotX/rotY (origin fixed → in-place look), WASD moves
  // the origin.
  let cameraOrigin: [number, number, number] = [0, 0, opts.groundZ + opts.eyeHeight];

  function syncTarget(): void {
    camera.target = [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]] as Vec3;
    scene.rerender();
    emitChange(snapshot);
  }

  // On attach adopt the camera's current target (the orbit/pan visual center)
  // as the eye position, snapped to eye height. After this FPV owns `target`.
  function initializeOriginFromTarget(): void {
    const t = camera.target ?? [0, 0, 0];
    cameraOrigin = [t[0], t[1], opts.groundZ + opts.eyeHeight];
    syncTarget();
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
    emitInteraction(locked ? "start" : "end", snapshot);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!pointerLocked || !opts.enabled || !opts.lookEnabled || stopped) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    if (dx === 0 && dy === 0) return;
    const sens = opts.lookSensitivity;
    const dyDir = opts.invertY ? -1 : 1;
    camera.rotY = ((((camera.rotY - dx * sens) % 360) + 360) % 360);
    let rotX = camera.rotX - dy * sens * dyDir;
    if (rotX < opts.minPitch) rotX = opts.minPitch;
    else if (rotX > opts.maxPitch) rotX = opts.maxPitch;
    camera.rotX = rotX;
    syncTarget();
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const isFpvKey = (code: string): boolean =>
    FORWARD_KEYS.has(code) || BACK_KEYS.has(code) || LEFT_KEYS.has(code) ||
    RIGHT_KEYS.has(code) || JUMP_KEYS.has(code) || CROUCH_KEYS.has(code);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!opts.enabled || stopped) return;
    if (!isFpvKey(e.code)) return;
    if (!pointerLocked && !opts.moveEnabled) return;
    if (JUMP_KEYS.has(e.code)) {
      if (!opts.jumpEnabled) return;
      e.preventDefault();
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

  const onBlur = (): void => { keysHeld.clear(); };

  // ── RAF tick ──────────────────────────────────────────────────────────────
  let rafId: number | null = null;
  let lastTime = 0;
  const ANIM_DT_CLAMP = 0.05;

  const tick = (now: number): void => {
    if (rafId === null || stopped) return;
    const dt = Math.min(ANIM_DT_CLAMP, lastTime ? (now - lastTime) / 1000 : 0.0167);
    lastTime = now;

    if (opts.enabled) {
      let dirty = false;

      if (opts.moveEnabled) {
        let mf = 0, mr = 0;
        for (const code of keysHeld) {
          if (FORWARD_KEYS.has(code)) mf += 1;
          else if (BACK_KEYS.has(code)) mf -= 1;
          else if (RIGHT_KEYS.has(code)) mr += 1;
          else if (LEFT_KEYS.has(code)) mr -= 1;
        }
        if (mf !== 0 || mr !== 0) {
          const r = (camera.rotY * Math.PI) / 180;
          // Horizontal yaw projection (pitch-independent — WASD walks the floor).
          const fx = -Math.cos(r), fy = -Math.sin(r);
          const rx = -Math.sin(r), ry = Math.cos(r);
          const len = Math.hypot(mf, mr) || 1;
          const step = opts.moveSpeed * dt;
          cameraOrigin[0] += ((fx * mf + rx * mr) / len) * step;
          cameraOrigin[1] += ((fy * mf + ry * mr) / len) * step;
          dirty = true;
        }
      }

      const crouched = opts.crouchEnabled &&
        (keysHeld.has("ControlLeft") || keysHeld.has("ControlRight"));
      const baseHeight = crouched ? opts.crouchHeight : opts.eyeHeight;
      if (opts.jumpEnabled && (verticalVel !== 0 || jumpOffset > 0)) {
        verticalVel -= opts.gravity * dt;
        jumpOffset += verticalVel * dt;
        if (jumpOffset <= 0) { jumpOffset = 0; verticalVel = 0; }
      } else if (!opts.jumpEnabled) {
        jumpOffset = 0; verticalVel = 0;
      }
      const originZ = opts.groundZ + baseHeight + jumpOffset;
      if (Math.abs(cameraOrigin[2] - originZ) > 1e-4) {
        cameraOrigin[2] = originZ;
        dirty = true;
      }

      if (dirty) syncTarget();
    }

    rafId = win.requestAnimationFrame(tick);
  };

  function startLoop(): void {
    if (rafId !== null || stopped) return;
    lastTime = 0;
    if (typeof win.requestAnimationFrame !== "undefined") rafId = win.requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId === null) return;
    win.cancelAnimationFrame(rafId);
    rafId = null;
  }

  function attach(): void {
    camera.eyeMode = true;
    host.addEventListener("click", onHostClick);
    doc.addEventListener("pointerlockchange", onPointerLockChange);
    doc.addEventListener("mousemove", onMouseMove);
    win.addEventListener("keydown", onKeyDown);
    win.addEventListener("keyup", onKeyUp);
    win.addEventListener("blur", onBlur);
    host.style.cursor = opts.lookEnabled ? "crosshair" : "";
    host.style.touchAction = "none";
  }

  function detach(): void {
    host.removeEventListener("click", onHostClick);
    doc.removeEventListener("pointerlockchange", onPointerLockChange);
    doc.removeEventListener("mousemove", onMouseMove);
    win.removeEventListener("keydown", onKeyDown);
    win.removeEventListener("keyup", onKeyUp);
    win.removeEventListener("blur", onBlur);
    host.style.cursor = "";
    host.style.touchAction = "";
    keysHeld.clear();
    if (pointerLocked) { try { doc.exitPointerLock(); } catch { /* ignore */ } }
    camera.eyeMode = false;
  }

  initializeOriginFromTarget();
  attach();
  startLoop();

  function update(partial: GlyphFirstPersonControlsOptions): void {
    const prevHeight = opts.eyeHeight;
    const prevGround = opts.groundZ;
    opts = resolveOptions(opts, partial);
    if (!stopped) host.style.cursor = opts.lookEnabled ? "crosshair" : "";
    if (opts.eyeHeight !== prevHeight || opts.groundZ !== prevGround) {
      cameraOrigin[2] = opts.groundZ + opts.eyeHeight;
      syncTarget();
    }
  }

  return {
    ...makeEventMethods(registry),
    update,
    resume(): void {
      if (!stopped) return;
      stopped = false;
      attach();
      startLoop();
    },
    pause(): void {
      if (stopped) return;
      stopped = true;
      detach();
      stopLoop();
    },
    destroy(): void {
      if (!stopped) { detach(); stopLoop(); }
      stopped = true;
    },
    lock(): void {
      if (!opts.enabled || !opts.lookEnabled || stopped) return;
      try { host.requestPointerLock(); } catch { /* ignore */ }
    },
    unlock(): void {
      if (pointerLocked) { try { doc.exitPointerLock(); } catch { /* ignore */ } }
    },
    isLocked(): boolean { return pointerLocked; },
    getOrigin(): [number, number, number] {
      return [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]];
    },
    setOrigin(origin: [number, number, number]): void {
      cameraOrigin = [origin[0], origin[1], origin[2]];
      syncTarget();
    },
  };
}
