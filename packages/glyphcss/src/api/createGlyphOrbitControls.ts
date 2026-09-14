// Vendored from voxcss packages/polycss/src/api/createPolyOrbitControls.ts@cac9da3. glyphcss deltas: Poly→Glyph rename; rotX/rotY in degrees (camera expects degrees); wheel/anim/options helpers inlined (controls/common.ts holds only the shared event registry); zoom clamp widened to scale range [0.1,500]; `pitchRange` (was `clampPitch`) plus a `trackball` mode (AGENTS.md "Cameras and orbit controls").
/**
 * createGlyphOrbitControls — orbit-mode camera input for a GlyphScene.
 *
 * Two modes:
 * - `"turntable"` (default) — left-drag rotates rotX / rotY around the
 *   target (Euler orbit, up-vector locked: world +Z always projects
 *   screen-up, at any pitch `pitchRange` allows). Byte-identical to the
 *   pre-trackball behaviour.
 * - `"trackball"` — left-drag rotates about the screen axis perpendicular
 *   to the drag (any orientation reachable, including roll), and a
 *   two-finger twist rolls. Backed by `camera.mat`/`useMat` (the core
 *   quaternion/matrix path), never by rotX/rotY.
 *
 * Wheel zooms or dollies in both modes. Mirrors voxcss's
 * createPolyOrbitControls semantics, adapted for the ASCII rasterizer's
 * GlyphCamera instead of the CSS matrix3d camera.
 *
 * rotX and rotY are in DEGREES (three.js / voxcss convention).
 * Drag sensitivity: 4 px per degree (POINTER_DRAG_SPEED = 4).
 * Animate speed: degrees per 60 Hz-equivalent frame.
 */

import type { GlyphSceneHandle } from "./createGlyphScene";
import { makeListenerRegistry, makeCameraSnapshot, makeEventMethods, type GlyphControlsEventTarget } from "./controls/common";
export type {
  GlyphControlsCamera,
  GlyphControlsChangeEvent,
  GlyphControlsInteractionEvent,
  GlyphControlsEvent,
  GlyphControlsListener,
} from "./controls/common";

/** Degrees-to-radians factor, matching `createGlyphCamera`'s own `DEG`. */
const DEG = Math.PI / 180;

export type GlyphOrbitControlsMode = "turntable" | "trackball";

export interface GlyphOrbitControlsOptions {
  /** Pointer-drag. Default: true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default: true. */
  wheel?: boolean;
  /** Drag-direction inversion. Default: false. */
  invert?: boolean | number;
  /**
   * Turntable-mode pitch clamp, `[min, max]` degrees, or `null` for
   * unrestricted tumbling (views from below the equator included — world
   * +Z still projects screen-up at every pitch, since the Euler path never
   * introduces roll). Default `[-90, 90]`, identical to the old
   * `clampPitch: true`; `null` matches the old `clampPitch: false`. No-op
   * in `"trackball"` mode.
   */
  pitchRange?: [number, number] | null;
  /**
   * `"turntable"` (default) — two-axis Euler orbit, up-vector locked.
   * `"trackball"` — free rotation about the screen axis perpendicular to
   * the drag, reaching any orientation including roll; a two-finger twist
   * rolls. Switching modes carries the current on-screen orientation over
   * (no jump).
   */
  mode?: GlyphOrbitControlsMode;
  /** Auto-rotate. Pass false or omit to disable. */
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export interface GlyphOrbitControlsHandle extends GlyphControlsEventTarget {
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
  let pitchRange: [number, number] | null =
    options.pitchRange !== undefined ? options.pitchRange : [-90, 90];
  let mode: GlyphOrbitControlsMode = options.mode ?? "turntable";
  let animOpts = options.animate ?? false;
  let stopped = false;
  let animPaused = false;
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
  let lastTime: number | null = null;

  // Multi-touch: track every active pointer so two fingers can pinch-zoom while
  // one finger orbits. `activePointerId` is the single pointer driving the orbit.
  const pointers = new Map<number, { x: number; y: number }>();
  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };
  let pinchDist = 0; // finger distance when the pinch began
  let pinchZoom = 0; // camera.zoom when the pinch began
  let pinchAngle = 0; // angle (rad) of the finger pair, updated per move (trackball twist)

  const camera = scene.camera;
  const registry = makeListenerRegistry(scene);
  const snapshot = makeCameraSnapshot(scene);
  const { emitChange, emitInteraction } = registry;
  let wheelActive = false;
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // Trackball orientation matrix — row-major 3×3, same layout as `camera.mat`.
  // Only written while `mode === "trackball"`; turntable mode never reads it.
  let trackballMat: number[] = eulerToMat(camera.rotX, camera.rotY);

  /**
   * Engage the trackball matrix path, carrying the CURRENT on-screen
   * orientation over — from `camera.mat` if a matrix is already installed
   * (re-entering trackball after a prior session), else derived from the
   * live Euler `rotX`/`rotY` (leaving turntable) — so a mode switch never
   * jumps the view.
   */
  function ensureTrackballMat(): void {
    trackballMat = camera.useMat && camera.mat ? camera.mat.slice() : eulerToMat(camera.rotX, camera.rotY);
    camera.mat = trackballMat;
    camera.useMat = true;
  }

  if (mode === "trackball") ensureTrackballMat();

  function clampPitchRange(value: number): number {
    return pitchRange ? Math.max(pitchRange[0], Math.min(pitchRange[1], value)) : value;
  }

  /** Rotate the trackball matrix about the screen axis perpendicular to a drag of (dxPx, dyPx). */
  function rotateTrackballDrag(dxPx: number, dyPx: number, degPerPx: number): void {
    const dist = Math.hypot(dxPx, dyPx);
    if (dist === 0) return;
    const angleRad = dist * degPerPx * DEG;
    const ax = -dyPx / dist;
    const ay = dxPx / dist;
    trackballMat = matMul3(axisAngleMat(ax, ay, 0, angleRad), trackballMat);
    camera.mat = trackballMat;
    camera.useMat = true;
  }

  /** Roll the trackball matrix about the view (depth) axis by `deltaRad` — the two-finger twist gesture. */
  function rotateTrackballTwist(deltaRad: number): void {
    trackballMat = matMul3(axisAngleMat(0, 0, 1, -deltaRad), trackballMat);
    camera.mat = trackballMat;
    camera.useMat = true;
  }

  function twoFingerDist(): number {
    const p = [...pointers.values()];
    return p.length >= 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
  }

  function twoFingerAngle(): number {
    const p = [...pointers.values()];
    return p.length >= 2 ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) : 0;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!drag || stopped) return;
    // The first pointer must be primary (ignore stray secondary buttons); later
    // pointers join regardless so a second finger can pinch-zoom.
    if (pointers.size === 0 && e.isPrimary === false) return;
    e.preventDefault();
    if (pointers.size === 0) emitInteraction("start", snapshot);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture on the stable host, NOT e.target: colored output rewrites the
    // <pre>'s innerHTML each render, destroying the <span> under the finger —
    // capturing it would fire pointercancel mid-drag and abort the gesture.
    try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size >= 2) {
      // Two fingers → pinch-zoom (+ twist-to-roll in trackball mode); suspend orbit.
      activePointerId = null;
      pinchDist = twoFingerDist();
      pinchZoom = camera.zoom;
      pinchAngle = twoFingerAngle();
      host.style.cursor = "";
    } else {
      activePointerId = e.pointerId;
      pointer = { x: e.clientX, y: e.clientY };
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
      // Pinch-zoom (needs `wheel`) + two-finger twist-to-roll (needs `drag`,
      // trackball mode only). Same gating as the pre-trackball code when
      // `mode === "turntable"`: `!wheel` alone still short-circuits with no
      // `preventDefault()`, keeping default behaviour byte-identical.
      const zoomActive = wheel;
      const twistActive = drag && mode === "trackball";
      if (!zoomActive && !twistActive) return;
      e.preventDefault();
      let changed = false;
      if (zoomActive) {
        const d = twoFingerDist();
        if (pinchDist > 0 && d > 0) {
          camera.zoom = Math.max(0.1, Math.min(500, pinchZoom * (d / pinchDist)));
          changed = true;
        }
      }
      if (twistActive) {
        const angle = twoFingerAngle();
        const deltaRad = angle - pinchAngle;
        pinchAngle = angle;
        if (pinchDist > 0 && deltaRad !== 0) {
          rotateTrackballTwist(deltaRad);
          changed = true;
        }
      }
      if (changed) {
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
    // Drag sensitivity: 4 px per degree (POINTER_DRAG_SPEED = 4).
    // rotX and rotY are in degrees — no radians conversion needed.
    const DEG_PER_PX = 1 / 4;
    if (mode === "trackball") {
      rotateTrackballDrag(dx * f, dy * f, DEG_PER_PX);
    } else {
      camera.rotY = camera.rotY - dx * DEG_PER_PX * f;
      // Drag in the same direction as the pointer: dragging UP tilts the camera
      // UP (positive rotX increase from the +Z-is-screen-up convention), so dy
      // negates here. Matches the horizontal axis's `-dx` direction.
      const nextRotX = camera.rotX - dy * DEG_PER_PX * f;
      camera.rotX = clampPitchRange(nextRotX);
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
      // One finger left after a pinch → resume orbit from it (no jump).
      const [id, pos] = [...pointers.entries()][0];
      activePointerId = id;
      pointer = { x: pos.x, y: pos.y };
      host.style.cursor = drag && !stopped ? "grabbing" : "";
    } else if (pointers.size === 0) {
      host.style.cursor = drag && !stopped ? "grab" : "";
      if (animOpts) animPaused = false;
      emitInteraction("end", snapshot);
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!wheel || stopped) return;
    e.preventDefault();
    const delta = e.deltaY * 0.001;
    // Absolute CSS px/world-unit zoom. Keep a wide clamp: a low
    // floor avoids div-by-zero, a high ceiling allows deep zoom.
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

  function clearWheelIdle(): void {
    if (wheelIdleTimer !== null) { clearTimeout(wheelIdleTimer); wheelIdleTimer = null; }
    wheelActive = false;
  }

  attach();
  startAnim();

  return {
    ...makeEventMethods(registry),
    update(opts: GlyphOrbitControlsOptions): void {
      const wasAnimating = !!animOpts;
      drag = opts.drag ?? drag;
      wheel = opts.wheel ?? wheel;
      invertFactor = resolveInvert(opts.invert);
      if (opts.pitchRange !== undefined) pitchRange = opts.pitchRange;
      if (opts.mode !== undefined && opts.mode !== mode) {
        mode = opts.mode;
        if (mode === "trackball") ensureTrackballMat();
        else camera.useMat = false; // turntable resumes from Euler rotX/rotY.
      }
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
      clearWheelIdle();
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
      clearWheelIdle();
      stopped = true;
    },
  };
}

function resolveInvert(invert: boolean | number | undefined): number {
  if (invert === undefined || invert === false) return 1;
  if (invert === true) return -1;
  return invert;
}

/**
 * The row-major 3×3 matrix equivalent to `rotateVec3Voxcss(v, rotXDeg,
 * rotYDeg)` in `createGlyphCamera.ts` — RotX(rotX) · RotZ(rotY) applied to
 * the axis-swapped world vector `rotateVec3WithMat` also swaps. Used ONLY to
 * seed `trackballMat` with visual continuity when trackball mode engages
 * from a turntable orientation; never read by the turntable path itself.
 */
function eulerToMat(rotXDeg: number, rotYDeg: number): number[] {
  const x = rotXDeg * DEG, y = rotYDeg * DEG;
  const cosX = Math.cos(x), sinX = Math.sin(x);
  const cosY = Math.cos(y), sinY = Math.sin(y);
  return [
    cosY, -sinY, 0,
    cosX * sinY, cosX * cosY, -sinX,
    sinX * sinY, sinX * cosY, cosX,
  ];
}

/** Row-major 3×3 matrix product `a · b` (apply `b` first, then `a`). */
function matMul3(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** Rodrigues rotation matrix (row-major 3×3) about a UNIT axis `(ax, ay, az)` by `angleRad`. */
function axisAngleMat(ax: number, ay: number, az: number, angleRad: number): number[] {
  const c = Math.cos(angleRad), s = Math.sin(angleRad), t = 1 - c;
  return [
    c + ax * ax * t, ax * ay * t - az * s, ax * az * t + ay * s,
    ay * ax * t + az * s, c + ay * ay * t, ay * az * t - ax * s,
    az * ax * t - ay * s, az * ay * t + ax * s, c + az * az * t,
  ];
}
