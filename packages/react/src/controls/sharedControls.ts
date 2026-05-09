/**
 * Shared pan/orbit math for PolyOrbitControls and PolyMapControls.
 */
import { BASE_TILE } from "@layoutit/polycss-core";
import type { CameraHandle, CameraState, Vec3 } from "@layoutit/polycss-core";

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
  target: Vec3;
}

export interface SharedControlsProps {
  /** Pointer-drag. Default true. */
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
   * Fires whenever the controls mutate camera state.
   */
  onChange?: (camera: PolyControlsCamera) => void;
  onInteractionStart?: (camera: PolyControlsCamera) => void;
  onInteractionEnd?: (camera: PolyControlsCamera) => void;
}

const POINTER_DRAG_SPEED = 4; // px per degree for orbit

function invertFactor(invert: boolean | number | undefined): number {
  if (invert === true) return -1;
  if (invert === undefined || invert === false) return 1;
  return invert;
}

/**
 * Apply orbit (rotate rotX / rotY) from screen-space drag delta.
 * Drag tracks the pointer — visible object follows the user's mouse.
 */
function applyOrbit(
  dx: number,
  dy: number,
  s: CameraState,
  handle: CameraHandle,
  invert: boolean | number | undefined,
): void {
  const f = invertFactor(invert);
  const dX = (dx / POINTER_DRAG_SPEED) * f;
  const dY = (dy / POINTER_DRAG_SPEED) * f;
  const rotX = Math.max(0, Math.min(100, s.rotX - dY));
  const rotY = (((s.rotY - dX) % 360) + 360) % 360;
  handle.update({ rotX, rotY });
}

/**
 * Apply world-space pan from screen-space drag delta.
 *
 * Slippy-map semantics: a drag (dx, dy) in screen pixels makes the terrain
 * appear to follow the finger by exactly (dx, dy) on screen, regardless of
 * camera rotation.
 *
 * Derivation: the scene transform composes as
 *   scale(zoom) · rotateX(rotX) · rotate(rotY) · translate3d(-targetCss)
 * so a target shift Δt translates scene-local (pre-rotation) coords by -Δtcss,
 * which after rotateZ(rotY) and rotateX(rotX) and scale(zoom) produces a
 * screen shift. Solving the inverse — given desired screen shift (dx, dy),
 * find Δt such that the scene shifts by (dx, dy) on screen, with Δt[2]=0
 * (ground-plane pan) — yields:
 *
 *   Δt[0] = ( dx·sin(rotY) - dy·cos(rotY)/cos(rotX)) / (zoom·tile)
 *   Δt[1] = -(dx·cos(rotY) + dy·sin(rotY)/cos(rotX)) / (zoom·tile)
 *
 * The cos(rotX) divisor compensates for tilt foreshortening of the world Y
 * axis (= scene-local CSS Y, which rotateX rotates toward the viewer).
 */
function applyPan(
  dx: number,
  dy: number,
  s: CameraState,
  handle: CameraHandle,
  _invert: boolean | number | undefined,
): void {
  const z = Math.max(0.01, s.zoom);
  // Preserve the sign of cos(rotX) — at rotX > 90° the camera is upside-down
  // relative to the scene, so the dy term must flip. A magnitude clamp of
  // 0.1 keeps things stable through the rotX≈90° edge-on singularity.
  const cosRotXRaw = Math.cos((s.rotX * Math.PI) / 180);
  const cosRotX = cosRotXRaw >= 0 ? Math.max(0.1, cosRotXRaw) : Math.min(-0.1, cosRotXRaw);
  const cZ = Math.cos((s.rotY * Math.PI) / 180);
  const sZ = Math.sin((s.rotY * Math.PI) / 180);
  const k = z * BASE_TILE;
  const targetD0 =  (dx * sZ - dy * cZ / cosRotX) / k;
  const targetD1 = -(dx * cZ + dy * sZ / cosRotX) / k;
  const t = s.target;
  handle.update({ target: [t[0] + targetD0, t[1] + targetD1, t[2]] });
}

export const buildOrbitControls = {
  applyOrbit,
  applyPan,
  invertFactor,
};
