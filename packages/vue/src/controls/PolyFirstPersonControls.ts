/**
 * <PolyFirstPersonControls> — Vue 3 first-person camera controls for polycss.
 *
 * Pointer-lock mouselook (click to acquire), WASD/arrow planar move, Space
 * jump, Ctrl crouch. Each input axis is independently toggled via props.
 *
 *   <PolyCamera>
 *     <PolyScene>
 *       <PolyFirstPersonControls />
 *       <PolyMesh :polygons="..." />
 *     </PolyScene>
 *   </PolyCamera>
 *
 * The handle (with getOrigin/setOrigin/lock/unlock/etc.) is accessible via
 * template ref:
 *
 *   <PolyFirstPersonControls ref="fpvRef" />
 *   fpvRef.value.setOrigin([10, 5, 0])
 */
import {
  defineComponent,
  inject,
  onMounted,
  onBeforeUnmount,
  watch,
} from "vue";
import { BASE_TILE } from "@layoutit/polycss-core";
import { PolyCameraContextKey } from "../camera/context";

// ── Public types (mirror React names/shapes) ──────────────────────────────────

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

// ── Defaults ──────────────────────────────────────────────────────────────────

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

export const PolyFirstPersonControls = defineComponent({
  name: "PolyFirstPersonControls",
  props: {
    enabled: { type: Boolean, default: true },
    lookEnabled: { type: Boolean, default: true },
    moveEnabled: { type: Boolean, default: true },
    jumpEnabled: { type: Boolean, default: true },
    crouchEnabled: { type: Boolean, default: true },
    lookSensitivity: { type: Number, default: 0.15 },
    invertY: { type: Boolean, default: false },
    moveSpeed: { type: Number, default: 5 },
    jumpVelocity: { type: Number, default: 7 },
    gravity: { type: Number, default: 18 },
    eyeHeight: { type: Number, default: 1.7 },
    crouchHeight: { type: Number, default: 1 },
    groundZ: { type: Number, default: 0 },
    minPitch: { type: Number, default: 5 },
    maxPitch: { type: Number, default: 175 },
  },
  emits: {
    change: (_origin: [number, number, number]) => true,
    "interaction-start": (_origin: [number, number, number]) => true,
    "interaction-end": (_origin: [number, number, number]) => true,
  },
  setup(props, { emit, expose }) {
    const ctx = inject(PolyCameraContextKey, null);
    if (!ctx) {
      if (typeof console !== "undefined") {
        console.warn("[polycss] <PolyFirstPersonControls> must be used inside <PolyCamera>.");
      }
      expose({});
      return () => null;
    }

    const { store, cameraRef, cameraElRef, applyTransformDirect } = ctx;

    // Mutable options — prop changes are forwarded here without tearing down listeners.
    let opts: ResolvedOptions = resolveOptions(DEFAULTS, props);

    // Camera origin (eye position in world coords).
    const cameraOrigin: [number, number, number] = [0, 0, 0];

    // RAF state
    let rafId: number | null = null;
    let lastTime = 0;
    let stopped = false;

    // Pointer-lock + interaction state
    let pointerLocked = false;
    let interacting = false;

    // Keys held
    const keysHeld = new Set<string>();

    // Vertical state for jump/gravity
    let verticalVel = 0;
    let jumpOffset = 0;

    // Listener registry for the imperative handle's event API
    const registry = makeRegistry();

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
      const host = cameraElRef.value;
      const perspStr = host ? getComputedStyle(host).perspective : "";
      const n = parseFloat(perspStr);
      return (Number.isFinite(n) && n > 0 ? n : 8000) / BASE_TILE;
    }

    function deriveTarget(): [number, number, number] {
      const s = cameraRef.value.state;
      const f = forwardDir(s.rotX ?? 90, s.rotY ?? 0);
      const d = lookOffset();
      return [
        cameraOrigin[0] + f[0] * d,
        cameraOrigin[1] + f[1] * d,
        cameraOrigin[2] + f[2] * d,
      ];
    }

    function syncTargetFromOrigin(): void {
      const t = deriveTarget();
      const handle = cameraRef.value;
      handle.update({ target: t });
      applyTransformDirect();
      store.updateCameraFromRef(handle);
    }

    // ── RAF tick ───────────────────────────────────────────────────────────────

    const ANIM_DT_CLAMP = 0.05;

    function tick(now: number): void {
      if (rafId === null || stopped) return;
      const dt = Math.min(ANIM_DT_CLAMP, lastTime ? (now - lastTime) / 1000 : 0.0167);
      lastTime = now;

      if (opts.enabled) {
        let dirty = false;
        const s = cameraRef.value.state;

        // Horizontal movement
        if (opts.moveEnabled) {
          let mf = 0, mr = 0;
          for (const code of keysHeld) {
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
            cameraOrigin[0] += ((fx * mf + rx * mr) / len) * step;
            cameraOrigin[1] += ((fy * mf + ry * mr) / len) * step;
            dirty = true;
          }
        }

        // Vertical (jump + gravity + crouch)
        const crouched = opts.crouchEnabled &&
          (keysHeld.has("ControlLeft") || keysHeld.has("ControlRight"));
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
          const t = deriveTarget();
          const handle = cameraRef.value;
          handle.update({ target: t });
          applyTransformDirect();
          store.updateCameraFromRef(handle);
          emitEvent(registry, "change");
          try { emit("change", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    function startLoop(): void {
      if (rafId !== null || stopped) return;
      lastTime = 0;
      rafId = requestAnimationFrame(tick);
    }

    function stopLoop(): void {
      if (rafId === null) return;
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // ── Event listeners ────────────────────────────────────────────────────────

    let cleanupListeners: (() => void) | null = null;

    function attachListeners(): void {
      const host = cameraElRef.value;
      if (!host) return;

      const doc = host.ownerDocument ?? document;
      const win = (doc.defaultView ?? globalThis) as typeof globalThis;

      const onHostClick = (): void => {
        if (!opts.enabled || !opts.lookEnabled || stopped || pointerLocked) return;
        try { host.requestPointerLock(); } catch { /* ignore */ }
      };

      const onPointerLockChange = (): void => {
        const locked = doc.pointerLockElement === host;
        if (locked === pointerLocked) return;
        pointerLocked = locked;
        if (locked) {
          interacting = true;
          emitEvent(registry, "start");
          try { emit("interaction-start", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
        } else {
          if (interacting) {
            interacting = false;
            emitEvent(registry, "end");
            try { emit("interaction-end", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
          }
        }
      };

      const onMouseMove = (e: MouseEvent): void => {
        if (!pointerLocked || stopped) return;
        if (!opts.enabled || !opts.lookEnabled) return;
        const dx = e.movementX ?? 0;
        const dy = e.movementY ?? 0;
        if (dx === 0 && dy === 0) return;
        const handle = cameraRef.value;
        const sceneOpts = handle.state;
        const sens = opts.lookSensitivity;
        const dyDir = opts.invertY ? -1 : 1;
        const rotY = ((((sceneOpts.rotY ?? 0) - dx * sens) % 360) + 360) % 360;
        let rotX = (sceneOpts.rotX ?? 90) - dy * sens * dyDir;
        if (rotX < opts.minPitch) rotX = opts.minPitch;
        else if (rotX > opts.maxPitch) rotX = opts.maxPitch;
        const f = forwardDir(rotX, rotY);
        const d = lookOffset();
        const target: [number, number, number] = [
          cameraOrigin[0] + f[0] * d,
          cameraOrigin[1] + f[1] * d,
          cameraOrigin[2] + f[2] * d,
        ];
        handle.update({ rotX, rotY, target });
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        emitEvent(registry, "change");
        try { emit("change", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
      };

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

      const onBlur = (): void => {
        keysHeld.clear();
      };

      host.addEventListener("click", onHostClick);
      doc.addEventListener("pointerlockchange", onPointerLockChange);
      doc.addEventListener("mousemove", onMouseMove);
      win.addEventListener("keydown", onKeyDown);
      win.addEventListener("keyup", onKeyUp);
      win.addEventListener("blur", onBlur);

      cleanupListeners = (): void => {
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
      };
    }

    // ── Exposed imperative handle ──────────────────────────────────────────────

    expose({
      update(partial: PolyFirstPersonControlsOptions): void {
        opts = resolveOptions(opts, partial);
        const host = cameraElRef.value;
        if (host && !stopped) {
          host.style.cursor = opts.lookEnabled ? "crosshair" : "";
        }
      },
      resume(): void {
        if (!stopped) return;
        stopped = false;
        const host = cameraElRef.value;
        if (host) host.style.cursor = opts.lookEnabled ? "crosshair" : "";
        startLoop();
      },
      pause(): void {
        if (stopped) return;
        stopped = true;
        stopLoop();
        const host = cameraElRef.value;
        if (host) host.style.cursor = "";
        if (interacting) {
          interacting = false;
          emitEvent(registry, "end");
          try { emit("interaction-end", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
        }
      },
      destroy(): void {
        stopped = true;
        stopLoop();
      },
      lock(): void {
        if (!opts.enabled || !opts.lookEnabled || stopped) return;
        const host = cameraElRef.value;
        try { host?.requestPointerLock(); } catch { /* ignore */ }
      },
      unlock(): void {
        if (pointerLocked) {
          const host = cameraElRef.value;
          try { host?.ownerDocument?.exitPointerLock(); } catch { /* ignore */ }
        }
      },
      isLocked(): boolean {
        return pointerLocked;
      },
      getOrigin(): [number, number, number] {
        return [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]];
      },
      setOrigin(origin: [number, number, number]): void {
        cameraOrigin[0] = origin[0];
        cameraOrigin[1] = origin[1];
        cameraOrigin[2] = origin[2];
        syncTargetFromOrigin();
        emitEvent(registry, "change");
        try { emit("change", [cameraOrigin[0], cameraOrigin[1], cameraOrigin[2]]); } catch { /* ignore */ }
      },
      addEventListener(type: EventType, listener: () => void): void {
        const arr = registry[type];
        if (!arr.includes(listener)) arr.push(listener);
      },
      removeEventListener(type: EventType, listener: () => void): void {
        const arr = registry[type];
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      },
      hasEventListener(type: EventType, listener: () => void): boolean {
        return registry[type].includes(listener);
      },
    } satisfies PolyFirstPersonControlsHandle);

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    onMounted(() => {
      const host = cameraElRef.value;
      if (!host) return;

      stopped = false;
      pointerLocked = false;
      interacting = false;
      keysHeld.clear();
      verticalVel = 0;
      jumpOffset = 0;

      // Seed camera origin from current target, snapped to eye height.
      const s = cameraRef.value.state;
      const t = s.target ?? [0, 0, 0];
      cameraOrigin[0] = t[0];
      cameraOrigin[1] = t[1];
      cameraOrigin[2] = opts.groundZ + opts.eyeHeight;
      syncTargetFromOrigin();

      host.style.cursor = opts.lookEnabled ? "crosshair" : "";

      attachListeners();
      startLoop();
    });

    onBeforeUnmount(() => {
      stopped = true;
      stopLoop();
      cleanupListeners?.();
      cleanupListeners = null;
    });

    // Forward prop changes to the live opts without tearing down listeners.
    const PROP_KEYS = [
      "enabled", "lookEnabled", "moveEnabled", "jumpEnabled", "crouchEnabled",
      "lookSensitivity", "invertY", "moveSpeed", "jumpVelocity", "gravity",
      "eyeHeight", "crouchHeight", "groundZ", "minPitch", "maxPitch",
    ] as const;
    for (const key of PROP_KEYS) {
      watch(
        () => props[key],
        () => {
          opts = resolveOptions(opts, props);
          const host = cameraElRef.value;
          if (host && !stopped) {
            host.style.cursor = opts.lookEnabled ? "crosshair" : "";
          }
        },
      );
    }

    return () => null;
  },
});
