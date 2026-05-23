/**
 * createGlyphPerspectiveCamera / createGlyphOrthographicCamera — vanilla camera
 * factories for glyphcss.
 *
 * These mirror the asciss camera factories and provide a `GlyphCamera`
 * handle with a `project()` method that maps world-space vertices to
 * [col, row, depth] in character-cell grid space.
 *
 * Public names use the Glyph prefix per glyphcss naming convention.
 * The internal camera algorithms are byte-identical to asciss's createCamera.ts.
 *
 * `createGlyphCamera` is the ergonomic default alias — it creates an
 * orthographic camera, matching the voxel/iso identity of glyphcss.
 */

import type { Vec3 } from "@glyphcss/core";

/**
 * Rotate `v` to match glyphcss's world→screen transform for identical (rotY, rotX) values.
 *
 * This is asciss's rotateVec3 (radians, (rotY, rotX) parameter order) — NOT the
 * glyph-core rotateVec3 which takes degrees and (rx, ry, rz). Kept internal
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

export interface GlyphCamera {
  readonly kind: "perspective" | "orthographic";
  rotX: number;
  rotY: number;
  /** Distance from origin along the view axis. Only meaningful for perspective cameras. */
  distance: number;
  /** Camera zoom — mesh size in the viewport (fraction of `min(cols, rows)`). */
  zoom: number;
  /** Extra horizontal stretch on top of `cellAspect`. */
  stretch: number;
  /**
   * Camera target offset in world space — shifts the point the camera orbits around.
   * Subtracted from world coords before projection so the mesh appears to pan without re-baking.
   */
  target: Vec3;
  /**
   * Eye-at-origin projection mode. When true, the perspective camera uses a
   * first-person formulation: `target` is treated as the eye position and
   * vertices behind the eye (`r[2] >= 0`) are NaN-culled. Toggled by
   * `createGlyphFirstPersonControls` at attach / detach time.
   */
  eyeMode: boolean;
  /** Project a world-space vector to `[col, row, depth]`. Same projection used by the renderer and the hit layer. */
  project(v: Vec3, cols: number, rows: number, cellAspect: number): [number, number, number];
}

export interface GlyphPerspectiveCameraOptions {
  /** Y rotation (radians). The "spin" axis. Default 0. */
  rotY?: number;
  /** X rotation (radians). The "tilt" axis. Default 0. */
  rotX?: number;
  /**
   * Perspective distance. Larger = flatter (less foreshortening); smaller =
   * more dramatic. Default 3.
   */
  distance?: number;
  /** Camera zoom — mesh size in the viewport (fraction of `min(cols, rows)`). Default 0.4. */
  zoom?: number;
  /**
   * Extra horizontal scale on top of `cellAspect`. Use to counteract
   * over-stretching when monospace cells are taller than wide. Default 1.0.
   */
  stretch?: number;
  /** Center of projection in normalized grid coords. Default `[0.5, 0.5]`. */
  center?: [number, number];
}

export interface GlyphOrthographicCameraOptions {
  rotY?: number;
  rotX?: number;
  zoom?: number;
  center?: [number, number];
}

/** Handle alias — same surface as `GlyphCamera`, names matched to glyphcss. */
export type GlyphPerspectiveCameraHandle = GlyphCamera;
/** Handle alias — same surface as `GlyphCamera`, names matched to glyphcss. */
export type GlyphOrthographicCameraHandle = GlyphCamera;

export function createGlyphPerspectiveCamera(opts: GlyphPerspectiveCameraOptions = {}): GlyphPerspectiveCameraHandle {
  const state = {
    rotX: opts.rotX ?? 0,
    rotY: opts.rotY ?? 0,
    distance: opts.distance ?? 3,
    zoom: opts.zoom ?? 0.4,
    stretch: opts.stretch ?? 1.0,
    target: [0, 0, 0] as Vec3,
    eyeMode: false,
    // Focal length used in eye mode. Tuned so the scene fills the viewport
    // at a similar fraction as a standard perspective view from ~3 units back.
    focal: 5,
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
    get zoom(): number { return state.zoom; },
    set zoom(v: number) { state.zoom = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    get eyeMode(): boolean { return state.eyeMode; },
    set eyeMode(v: boolean) { state.eyeMode = v; },
    project(v, cols, rows, cellAspect) {
      const shifted: Vec3 = [v[0] - state.target[0], v[1] - state.target[1], v[2] - state.target[2]];
      const r = rotateVec3(shifted, state.rotY, state.rotX);
      if (state.eyeMode) {
        // Eye-at-origin projection: target is the eye position, vertices at or
        // behind the eye plane are culled. Used by GlyphFirstPersonControls.
        const NEAR = 0.001;
        if (r[2] >= -NEAR) return [NaN, NaN, r[2]];
        const inv = state.focal / -r[2];
        const radius = Math.min(cols, rows) * state.zoom * inv;
        const col = cols * cxN + r[0] * radius * cellAspect * state.stretch;
        const row = rows * cyN + r[1] * radius;
        return [col, row, r[2]];
      }
      const MESH_UNIT = 30;
      const ZOOM_TO_RADIUS = 1.5;
      const zPx = r[2] * MESH_UNIT;
      const NEAR = 0.001;
      const denom = 1 - zPx / state.distance;
      if (denom < NEAR) return [NaN, NaN, r[2]];
      const persp = 1 / denom;
      const radius = Math.min(cols, rows) * state.zoom * ZOOM_TO_RADIUS * persp;
      const col = cols * cxN + r[0] * radius * cellAspect * state.stretch;
      const row = rows * cyN + r[1] * radius;
      return [col, row, r[2]];
    },
  };
}

export function createGlyphOrthographicCamera(opts: GlyphOrthographicCameraOptions = {}): GlyphOrthographicCameraHandle {
  const state = {
    rotX: opts.rotX ?? 0,
    rotY: opts.rotY ?? 0,
    distance: 0,
    zoom: opts.zoom ?? 0.4,
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
    get zoom(): number { return state.zoom; },
    set zoom(v: number) { state.zoom = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    // Orthographic cameras never use eye-mode projection. The setter is a no-op
    // so the field satisfies the GlyphCamera interface.
    get eyeMode(): boolean { return false; },
    set eyeMode(_v: boolean) { /* no-op — orthographic projection has no eye mode */ },
    project(v, cols, rows, cellAspect) {
      const shifted: Vec3 = [v[0] - state.target[0], v[1] - state.target[1], v[2] - state.target[2]];
      const r = rotateVec3(shifted, state.rotY, state.rotX);
      const ZOOM_TO_RADIUS = 1.5;
      const radius = Math.min(cols, rows) * state.zoom * ZOOM_TO_RADIUS;
      const col = cols * cxN + r[0] * radius * cellAspect * state.stretch;
      const row = rows * cyN + r[1] * radius;
      return [col, row, r[2]];
    },
  };
}

/**
 * Default camera alias — orthographic projection. The voxel render mode and
 * iso/diagrammatic scenes are glyphcss's differentiator; ortho is the more
 * representative default.
 */
export const createGlyphCamera = createGlyphOrthographicCamera;
