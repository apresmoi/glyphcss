/**
 * createGlyphcssPerspectiveCamera / createGlyphcssOrthographicCamera /
 * createGlyphcssFirstPersonCamera — vanilla camera factories for glyphcss.
 *
 * These mirror the asciss camera factories and provide a `GlyphcssCamera`
 * handle with a `project()` method that maps world-space vertices to
 * [col, row, depth] in character-cell grid space.
 *
 * Public names are Glyphcss-prefixed to mirror polycss's naming convention.
 * The internal camera algorithms are byte-identical to asciss's createCamera.ts.
 */

import type { Vec3 } from "@glyphcss/core";

/**
 * Rotate `v` to match polycss's world→screen transform for identical (rotY, rotX) values.
 *
 * This is asciss's rotateVec3 (radians, (rotY, rotX) parameter order) — NOT the
 * polycss-core rotateVec3 which takes degrees and (rx, ry, rz). Kept internal
 * so the camera math stays byte-identical to asciss.
 */
function rotateVec3(v: Vec3, a: number, b: number): Vec3 {
  // rotateZ(a) on the axis-swapped input (v[1], v[0], v[2])
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const x1 = cosA * v[1] - sinA * v[0];
  const y1 = sinA * v[1] + cosA * v[0];
  const z1 = v[2];
  // rotateX(b)
  const cosB = Math.cos(b), sinB = Math.sin(b);
  const y2 = cosB * y1 - sinB * z1;
  const z2 = sinB * y1 + cosB * z1;
  return [x1, y2, z2];
}

export interface GlyphcssCamera {
  readonly kind: "perspective" | "orthographic" | "firstPerson";
  rotX: number;
  rotY: number;
  /** Distance from origin along the view axis. Only meaningful for perspective cameras. */
  distance: number;
  /** Mesh size in the viewport (fraction of `min(cols, rows)`). */
  scale: number;
  /** Extra horizontal stretch on top of `cellAspect`. */
  stretch: number;
  /**
   * Camera target offset in world space — shifts the point the camera orbits around.
   * Subtracted from world coords before projection so the mesh appears to pan without re-baking.
   */
  target: Vec3;
  /** Project a world-space vector to `[col, row, depth]`. Same projection used by the renderer and the hit layer. */
  project(v: Vec3, cols: number, rows: number, cellAspect: number): [number, number, number];
}

export interface GlyphcssPerspectiveCameraOptions {
  /** Y rotation (radians). The "spin" axis. Default 0. */
  rotY?: number;
  /** X rotation (radians). The "tilt" axis. Default 0. */
  rotX?: number;
  /**
   * Perspective distance. Larger = flatter (less foreshortening); smaller =
   * more dramatic. Default 3.
   */
  distance?: number;
  /** Size of the mesh in the viewport (fraction of `min(cols, rows)`). Default 0.4. */
  scale?: number;
  /**
   * Extra horizontal scale on top of `cellAspect`. Use to counteract
   * over-stretching when monospace cells are taller than wide. Default 1.0.
   */
  stretch?: number;
  /** Center of projection in normalized grid coords. Default `[0.5, 0.5]`. */
  center?: [number, number];
}

export interface GlyphcssOrthographicCameraOptions {
  rotY?: number;
  rotX?: number;
  zoom?: number;
  center?: [number, number];
}

export interface GlyphcssFirstPersonCameraOptions {
  rotY?: number;
  rotX?: number;
  /** Focal length in world units. Smaller = wider FOV. */
  focal?: number;
  /** Eye position in world space. Used as the projection origin. */
  origin?: Vec3;
  center?: [number, number];
}

/** Handle alias — same surface as `GlyphcssCamera`, names matched to polycss. */
export type GlyphcssPerspectiveCameraHandle = GlyphcssCamera;
/** Handle alias — same surface as `GlyphcssCamera`, names matched to polycss. */
export type GlyphcssOrthographicCameraHandle = GlyphcssCamera;
/** Handle alias — same surface as `GlyphcssCamera`, names matched to polycss. */
export type GlyphcssFirstPersonCameraHandle = GlyphcssCamera;

export function createGlyphcssPerspectiveCamera(opts: GlyphcssPerspectiveCameraOptions = {}): GlyphcssPerspectiveCameraHandle {
  const state = {
    rotX: opts.rotX ?? 0,
    rotY: opts.rotY ?? 0,
    distance: opts.distance ?? 3,
    scale: opts.scale ?? 0.4,
    stretch: opts.stretch ?? 1.0,
    target: [0, 0, 0] as Vec3,
  };
  const [cxN, cyN] = opts.center ?? [0.5, 0.5];

  return {
    kind: "perspective",
    get rotX(): number { return state.rotX; },
    set rotX(v: number) { state.rotX = v; },
    get rotY(): number { return state.rotY; },
    set rotY(v: number) { state.rotY = v; },
    get distance(): number { return state.distance; },
    set distance(v: number) { state.distance = v; },
    get scale(): number { return state.scale; },
    set scale(v: number) { state.scale = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    project(v, cols, rows, cellAspect) {
      // Subtract the pan target before rotating — mirrors polycss target semantics.
      const shifted: Vec3 = [v[0] - state.target[0], v[1] - state.target[1], v[2] - state.target[2]];
      // rotateVec3(v, rotY, rotX) applies rotZ(rotY) then rotX(rotX) —
      // matches CSS `rotateX(rotX) rotate(rotY)` (CSS reads right-to-left).
      const r = rotateVec3(shifted, state.rotY, state.rotX);
      // Polycss-equivalent perspective math: `persp = 1 / (1 - z/distance)`.
      const MESH_UNIT = 30;
      const ZOOM_TO_RADIUS = 1.5;
      const zPx = r[2] * MESH_UNIT;
      // Near-plane culling: reject the vertex by returning NaN so the rasterizer
      // skips lines through it.
      const NEAR = 0.001;
      const denom = 1 - zPx / state.distance;
      if (denom < NEAR) return [NaN, NaN, r[2]];
      const persp = 1 / denom;
      const radius = Math.min(cols, rows) * state.scale * ZOOM_TO_RADIUS * persp;
      const col = cols * cxN + r[0] * radius * cellAspect * state.stretch;
      const row = rows * cyN + r[1] * radius;
      return [col, row, r[2]];
    },
  };
}

export function createGlyphcssOrthographicCamera(opts: GlyphcssOrthographicCameraOptions = {}): GlyphcssOrthographicCameraHandle {
  const state = {
    rotX: opts.rotX ?? 0,
    rotY: opts.rotY ?? 0,
    distance: 0,
    scale: opts.zoom ?? 0.4,
    stretch: 1.0,
    target: [0, 0, 0] as Vec3,
  };
  const [cxN, cyN] = opts.center ?? [0.5, 0.5];

  return {
    kind: "orthographic",
    get rotX(): number { return state.rotX; },
    set rotX(v: number) { state.rotX = v; },
    get rotY(): number { return state.rotY; },
    set rotY(v: number) { state.rotY = v; },
    get distance(): number { return state.distance; },
    set distance(v: number) { state.distance = v; },
    get scale(): number { return state.scale; },
    set scale(v: number) { state.scale = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    project(v, cols, rows, cellAspect) {
      const shifted: Vec3 = [v[0] - state.target[0], v[1] - state.target[1], v[2] - state.target[2]];
      const r = rotateVec3(shifted, state.rotY, state.rotX);
      const ZOOM_TO_RADIUS = 1.5;
      const radius = Math.min(cols, rows) * state.scale * ZOOM_TO_RADIUS;
      const col = cols * cxN + r[0] * radius * cellAspect * state.stretch;
      const row = rows * cyN + r[1] * radius;
      return [col, row, r[2]];
    },
  };
}

/**
 * First-person camera. Projection origin = eye (`target`). Vertices
 * behind the eye (`r[2] >= 0`) are NaN-culled.
 */
export function createGlyphcssFirstPersonCamera(opts: GlyphcssFirstPersonCameraOptions = {}): GlyphcssFirstPersonCameraHandle {
  const state = {
    rotX: opts.rotX ?? Math.PI / 2,
    rotY: opts.rotY ?? 0,
    distance: 0,
    scale: 1,
    stretch: 1.0,
    target: (opts.origin ?? [0, 0, 0]) as Vec3,
    focal: opts.focal ?? 1,
  };
  const [cxN, cyN] = opts.center ?? [0.5, 0.5];
  return {
    kind: "firstPerson",
    get rotX(): number { return state.rotX; },
    set rotX(v: number) { state.rotX = v; },
    get rotY(): number { return state.rotY; },
    set rotY(v: number) { state.rotY = v; },
    get distance(): number { return state.distance; },
    set distance(v: number) { state.distance = v; state.focal = Math.max(0.05, v / 100); },
    get scale(): number { return state.scale; },
    set scale(v: number) { state.scale = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    project(v, cols, rows, cellAspect) {
      const shifted: Vec3 = [v[0] - state.target[0], v[1] - state.target[1], v[2] - state.target[2]];
      const r = rotateVec3(shifted, state.rotY, state.rotX);
      // Cull at or behind the eye plane.
      const NEAR = 0.001;
      if (r[2] >= -NEAR) return [NaN, NaN, r[2]];
      const inv = state.focal / -r[2];
      const radius = Math.min(cols, rows) * state.scale * inv;
      const col = cols * cxN + r[0] * radius * cellAspect * state.stretch;
      const row = rows * cyN + r[1] * radius;
      return [col, row, r[2]];
    },
  };
}
