// Vendored from voxcss packages/core/src/camera/camera.ts@cac9da3.
// glyphcss deltas: output target [col,row,depth] char-grid instead of CSS matrix3d;
//   Poly→Glyph rename; BASE_TILE retained; perspective + eyeMode projection added;
//   zoom semantic = CSS scale multiplier (same as voxcss); DEG conversion inline.

import type { Vec3 } from "@glyphcss/core";

/**
 * Base tile size in virtual pixels. One glyphcss world unit = BASE_TILE virtual
 * pixels (pre-zoom). Matches voxcss exactly so world-coordinate values are
 * numerically compatible across both renderers.
 */
const BASE_TILE = 50;

/** Degrees-to-radians factor (same as voxcss `unproject.ts`). */
const DEG = Math.PI / 180;

/**
 * Apply voxcss's world→screen rotation convention to a world-space vector.
 *
 * voxcss `getStyle()` transform order (right-to-left for points):
 *   translate3d(-cssX, -cssY, -cssZ)
 *   → rotate(rotY deg)      [CSS rotate = rotateZ in 3D]
 *   → rotateX(rotX deg)
 *   → scale(zoom)
 *
 * world→CSS axis map (same as voxcss camera.ts `getStyle` comments):
 *   world[0] → CSS Y   (cssY = world[0] * tile)
 *   world[1] → CSS X   (cssX = world[1] * tile)
 *   world[2] → CSS Z   (cssZ = world[2] * tile)
 *
 * Forward projection (left-to-right):
 *   1. axis-swap: cx = v[1], cy = v[0], cz = v[2]
 *   2. rotateZ(rotY): CSS `rotate()` — rotation in the XY plane
 *   3. rotateX(rotX)
 *
 * Returns the rotated [x, y, z] in CSS-frame virtual-pixel units
 * (caller still needs to multiply by zoom * BASE_TILE to get screen pixels).
 */
function rotateVec3Voxcss(v: Vec3, rotXDeg: number, rotYDeg: number): Vec3 {
  // Axis-swap: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z.
  const cx = v[1];
  const cy = v[0];
  const cz = v[2];

  // Step 2: CSS rotate(rotY deg) = rotateZ(rotY).
  // RotZ(θ): (x,y,z) → (x·cosθ − y·sinθ, x·sinθ + y·cosθ, z)
  const rotYR = rotYDeg * DEG;
  const cosY = Math.cos(rotYR);
  const sinY = Math.sin(rotYR);
  const rx = cx * cosY - cy * sinY;
  const ry = cx * sinY + cy * cosY;
  const rz = cz;

  // Step 3: rotateX(rotX deg).
  // RotX(θ): (x,y,z) → (x, y·cosθ − z·sinθ, y·sinθ + z·cosθ)
  const rotXR = rotXDeg * DEG;
  const cosX = Math.cos(rotXR);
  const sinX = Math.sin(rotXR);
  const ry2 = ry * cosX - rz * sinX;
  const rz2 = ry * sinX + rz * cosX;

  return [rx, ry2, rz2];
}

export interface GlyphCamera {
  readonly kind: "perspective" | "orthographic";
  rotX: number;
  rotY: number;
  /** Distance from target along the view axis. For perspective cameras: world units. Default 0. */
  distance: number;
  /**
   * Camera zoom — CSS scale multiplier (same semantic as voxcss).
   * `zoom = 1` → one world unit = BASE_TILE (50) virtual pixels.
   * Larger values zoom in; smaller zoom out. NOT a fraction of viewport.
   */
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
   * vertices behind the eye (`rz2 >= 0`) are NaN-culled. Toggled by
   * `createGlyphFirstPersonControls` at attach / detach time.
   */
  eyeMode: boolean;
  /** Project a world-space vector to `[col, row, depth]`. Same projection used by the renderer and the hit layer. */
  project(v: Vec3, cols: number, rows: number, cellAspect: number): [number, number, number];
}

export interface GlyphPerspectiveCameraOptions {
  /**
   * X rotation in **degrees** (tilt). Default 65.
   * Matches voxcss / three.js convention.
   */
  rotX?: number;
  /**
   * Y rotation in **degrees** (spin). Default 45.
   * Matches voxcss / three.js convention.
   */
  rotY?: number;
  /**
   * Perspective distance in world units. Larger = flatter (less foreshortening);
   * smaller = more dramatic. Default 6.
   */
  distance?: number;
  /**
   * Camera zoom — CSS scale multiplier. Default 0.3.
   * `zoom = 1` → BASE_TILE (50) virtual px per world unit.
   */
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
  /** X rotation in **degrees** (tilt). Default 65. */
  rotX?: number;
  /** Y rotation in **degrees** (spin). Default 45. */
  rotY?: number;
  /**
   * Camera zoom — CSS scale multiplier. Default 0.3.
   * `zoom = 1` → BASE_TILE (50) virtual px per world unit.
   */
  zoom?: number;
  /** Center of projection in normalized grid coords. Default `[0.5, 0.5]`. */
  center?: [number, number];
}

/** Handle alias — same surface as `GlyphCamera`, names matched to glyphcss. */
export type GlyphPerspectiveCameraHandle = GlyphCamera;
/** Handle alias — same surface as `GlyphCamera`, names matched to glyphcss. */
export type GlyphOrthographicCameraHandle = GlyphCamera;

export function createGlyphPerspectiveCamera(opts: GlyphPerspectiveCameraOptions = {}): GlyphPerspectiveCameraHandle {
  const state = {
    rotX: opts.rotX ?? 65,
    rotY: opts.rotY ?? 45,
    distance: opts.distance ?? 6,
    zoom: opts.zoom ?? 0.65,
    stretch: opts.stretch ?? 1.0,
    target: [0, 0, 0] as Vec3,
    eyeMode: false,
    // Focal length used in eye mode (world units). Governs how "tight" the
    // first-person field of view feels — 1 world unit behind the eye plane
    // projects at unit scale.
    focal: 1.0,
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
      // Virtual char-cell pixel sizes (world-unit-to-cell conversion).
      // cellAspect = cellPxH / cellPxW; we define BASE_TILE as cellPxH so that
      // vertical and horizontal scales stay consistent with voxcss's BASE_TILE.
      // cellPxW = BASE_TILE / cellAspect.
      const cellPxH = BASE_TILE;
      const cellPxW = BASE_TILE / cellAspect;

      const shifted: Vec3 = [
        v[0] - state.target[0],
        v[1] - state.target[1],
        v[2] - state.target[2],
      ];
      const r = rotateVec3Voxcss(shifted, state.rotX, state.rotY);

      if (state.eyeMode) {
        // Eye-at-origin first-person projection.
        // `target` is the eye position; rz2 < 0 means in front of the eye.
        // Perspective scale: objects at depth -d project at scale focal/d.
        const NEAR = 0.001;
        if (r[2] >= -NEAR) return [NaN, NaN, r[2]];
        // Perspective scale in world units. state.focal is the reference depth
        // (distance of the "screen plane" from the eye).
        const perspScale = state.focal / -r[2];
        // world→screen-px: multiply by zoom * BASE_TILE, then divide by cell size.
        const screenPxX = r[0] * perspScale * state.zoom * BASE_TILE;
        const screenPxY = r[1] * perspScale * state.zoom * BASE_TILE;
        const col = cols * cxN + screenPxX / cellPxW * state.stretch;
        const row = rows * cyN + screenPxY / cellPxH;
        return [col, row, r[2]];
      }

      // Perspective projection (orthographic when distance is very large).
      // rz2 is in world units; distance is in world units.
      // perspective scale = distance / (distance - rz2), same derivation as a
      // pinhole camera at depth `distance` looking toward +Z.
      const NEAR = 0.001;
      const denom = state.distance - r[2];
      if (denom < NEAR) return [NaN, NaN, r[2]];
      const perspScale = state.distance / denom;

      // world→screen-px→char-cell
      const screenPxX = r[0] * perspScale * state.zoom * BASE_TILE;
      const screenPxY = r[1] * perspScale * state.zoom * BASE_TILE;
      const col = cols * cxN + screenPxX / cellPxW * state.stretch;
      const row = rows * cyN + screenPxY / cellPxH;
      return [col, row, r[2]];
    },
  };
}

export function createGlyphOrthographicCamera(opts: GlyphOrthographicCameraOptions = {}): GlyphOrthographicCameraHandle {
  const state = {
    rotX: opts.rotX ?? 65,
    rotY: opts.rotY ?? 45,
    distance: 0,
    zoom: opts.zoom ?? 0.65,
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
      // Virtual char-cell pixel sizes (see perspective camera for derivation).
      const cellPxH = BASE_TILE;
      const cellPxW = BASE_TILE / cellAspect;

      const shifted: Vec3 = [
        v[0] - state.target[0],
        v[1] - state.target[1],
        v[2] - state.target[2],
      ];
      const r = rotateVec3Voxcss(shifted, state.rotX, state.rotY);

      // Orthographic: no perspective divide.
      const screenPxX = r[0] * state.zoom * BASE_TILE;
      const screenPxY = r[1] * state.zoom * BASE_TILE;
      const col = cols * cxN + screenPxX / cellPxW;
      const row = rows * cyN + screenPxY / cellPxH;
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
