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
 * Perspective near plane as a fraction of the perspective distance `P`. The
 * clipped-vertex projection scale is `P / near = 1 / fraction`, so 0.01 caps it
 * to ~100× — small enough not to clip visible geometry, large enough that
 * near-clipped triangles stay numerically stable instead of jittering.
 */
const PERSPECTIVE_NEAR_FRACTION = 0.01;

/**
 * Default CSS-perspective distance in virtual pixels — mirrors voxcss/polycss
 * `DEFAULT_PERSPECTIVE`. Large enough that perspective foreshortening is gentle
 * (a normal scene only spans a few hundred px), so the on-screen result matches
 * polycss out of the box.
 */
export const DEFAULT_PERSPECTIVE = 32000;

/**
 * Near fraction used by `eyeDepth` for near-plane CLIPPING — deliberately a hair
 * larger than the projection's `PERSPECTIVE_NEAR_FRACTION`. The clip plane sits
 * at `eyeDepth = 0`, which puts the interpolated crossing vertices exactly there;
 * if that coincided with the projection's near plane, those crossings would
 * reproject to `denom ≈ NEAR ± rounding` and the `denom < NEAR` test would reject
 * a hair of them as NaN — collapsing the clipped triangle and dropping the whole
 * polygon (e.g. the floor right under the camera vanishes when looking down). By
 * clipping a hair INSIDE the frustum, every surviving + crossing vertex has
 * `denom` safely above the projection near plane and projects to a finite point.
 */
const PERSPECTIVE_CLIP_NEAR_FRACTION = PERSPECTIVE_NEAR_FRACTION * 1.01;

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

/**
 * Apply a pre-built 9-element row-major 3×3 rotation matrix to a world-space
 * vector.  Mirrors `project_ortho` in glyphcss.c: the SAME axis-swap
 * (vx = v[1], vy = v[0], vz = v[2]) is baked in so the output is numerically
 * identical to the C reference for the same `mat` array.
 *
 * Used by the `useMat=true` camera path (quaternion trackball).
 *
 * Layout: row-major 3×3, same convention as `gc_opts.mat`:
 *   rx  = mat[0]·vx + mat[1]·vy + mat[2]·vz
 *   ry2 = mat[3]·vx + mat[4]·vy + mat[5]·vz
 *   rz2 = mat[6]·vx + mat[7]·vy + mat[8]·vz
 */
function rotateVec3WithMat(v: Vec3, mat: number[]): Vec3 {
  // Axis-swap identical to glyphcss.c project_ortho line 99.
  const vx = v[1];
  const vy = v[0];
  const vz = v[2];
  return [
    mat[0] * vx + mat[1] * vy + mat[2] * vz,
    mat[3] * vx + mat[4] * vy + mat[5] * vz,
    mat[6] * vx + mat[7] * vy + mat[8] * vz,
  ];
}

export interface GlyphCamera {
  readonly kind: "perspective" | "orthographic";
  rotX: number;
  rotY: number;
  /** Projection center in normalized grid coords (default `[0.5, 0.5]`). Mutable — detail layers offset it to render a bbox sub-window. */
  center: [number, number];
  /**
   * 9-element row-major 3×3 rotation matrix, same layout as `gc_opts.mat` in
   * glyphcss.c.  Set this together with `useMat=true` to switch the camera to
   * the quaternion/matrix path and achieve device-parity for any orientation,
   * including poles where the 2-Euler path has gimbal lock.
   * `null` = no matrix override (Euler path is used regardless of `useMat`).
   */
  mat: number[] | null;
  /**
   * When `true` and `mat` is set, the camera projects using `mat` instead of
   * the Euler `rotX`/`rotY` angles.  Default `false` (Euler path, backward
   * compatible).  Setting `useMat=true` with `mat=null` is a no-op (falls back
   * to Euler).
   */
  useMat: boolean;
  /** Distance from target along the view axis. For perspective cameras: world units. Default 0. */
  distance: number;
  /**
   * CSS-perspective distance in virtual pixels (voxcss parity). When > 0, the
   * camera projects with the browser's `P / (P − z)` CSS-perspective math.
   * Default 0 (disabled).
   */
  perspective: number;
  /**
   * Camera zoom — CSS scale multiplier (same semantic as voxcss).
   * `zoom = 1` → one world unit = BASE_TILE (50) virtual pixels.
   * Larger values zoom in; smaller zoom out. NOT a fraction of viewport.
   */
  zoom: number;
  /** Extra horizontal stretch on top of `cellAspect`. */
  stretch: number;
  /**
   * Isotropic field-of-view scale applied to the projected screen offset (around
   * the center), independent of the perspective divide. `1` = off. Use it to
   * decouple the FOV from the grid resolution: when the grid grows (e.g. a
   * smaller line-height adds rows), the FOV would otherwise widen — set
   * `fovScale` proportional to the resolution change to keep it fixed. Unlike
   * `zoom`, it does NOT alter perspective foreshortening (zoom scales `cssZ`,
   * shifting the `P/(P−z)` divide; this only scales the post-divide offset).
   */
  fovScale: number;
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
  /**
   * Project a world-space vector to `[col, row, depth, zbuf?]`. `depth` is the
   * linear eye-space `cssZ` (the public contract, used by the hit layer). The
   * optional 4th element `zbuf` is the **screen-space-linear** depth (`1/denom`)
   * for perspective cameras — the renderer's z-buffer must use it (not `depth`)
   * so the depth test is perspective-correct: interpolating linear `cssZ` with
   * screen-space barycentric weights misorders overlapping triangles, which
   * shows the wrong (farther) surface in some cells and flickers under motion.
   * Orthographic cameras omit it (their linear `depth` is already screen-linear).
   */
  project(v: Vec3, cols: number, rows: number, cellAspect: number): [number, number, number, number?];
  /**
   * Signed distance of a world vertex past the near plane: `> 0` is visible
   * (in front of the near plane), `<= 0` is culled (at/behind the eye). The
   * near plane sits at `eyeDepth = 0`, so an edge crossing the near plane is
   * found by linear interpolation where `eyeDepth` changes sign. The renderer
   * uses this for near-plane clipping; `eyeDepth` is affine in `v`, so the
   * world-space crossing point interpolates linearly. Orthographic cameras
   * return `+Infinity` (never clipped).
   */
  eyeDepth(v: Vec3): number;
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
   * CSS-perspective distance in **virtual pixels**, matching voxcss/polycss
   * `createPolyPerspectiveCamera({ perspective })`. When > 0, the camera projects
   * with the same `P / (P − z)` pinhole math the browser applies for CSS
   * `perspective: Npx` — so identical camera params (rotX/rotY/target/zoom/
   * distance/perspective) produce the same on-screen projection as polycss, and
   * a first-person view falls out naturally (no `eyeMode` needed). Default
   * {@link DEFAULT_PERSPECTIVE} (32000), matching voxcss. Set to 0 to disable
   * (→ legacy orbit projection using `distance` in world units).
   */
  perspective?: number;
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
  /** Isotropic FOV scale on the projected offset (resolution-independent FOV). Default 1. */
  fovScale?: number;
  /** Center of projection in normalized grid coords. Default `[0.5, 0.5]`. */
  center?: [number, number];
  /**
   * 9-element row-major 3×3 rotation matrix (same layout as `gc_opts.mat`).
   * Provide together with `useMat=true` to use the matrix path instead of Euler.
   */
  mat?: number[];
  /**
   * When `true` and `mat` is set, use `mat` for projection instead of Euler
   * `rotX`/`rotY`.  Default `false` (Euler, backward compatible).
   */
  useMat?: boolean;
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
  /**
   * 9-element row-major 3×3 rotation matrix (same layout as `gc_opts.mat`).
   * Provide together with `useMat=true` to use the matrix path instead of Euler.
   */
  mat?: number[];
  /**
   * When `true` and `mat` is set, use `mat` for projection instead of Euler
   * `rotX`/`rotY`.  Default `false` (Euler, backward compatible).
   */
  useMat?: boolean;
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
    perspective: opts.perspective ?? DEFAULT_PERSPECTIVE,
    zoom: opts.zoom ?? 0.65,
    stretch: opts.stretch ?? 1.0,
    fovScale: opts.fovScale ?? 1.0,
    target: [0, 0, 0] as Vec3,
    eyeMode: false,
    // Focal length used in eye mode (world units). Governs how "tight" the
    // first-person field of view feels — 1 world unit behind the eye plane
    // projects at unit scale.
    focal: 1.0,
    mat: opts.mat ?? null as number[] | null,
    useMat: opts.useMat ?? false,
    center: (opts.center ?? [0.5, 0.5]) as [number, number],
  };

  return {
    kind: "perspective",
    get center(): [number, number] { return state.center; },
    set center(v: [number, number]) { state.center = v; },
    get rotX(): number { return state.rotX; },
    set rotX(v: number) { state.rotX = v; },
    get rotY(): number { return state.rotY; },
    set rotY(v: number) { state.rotY = v; },
    get distance(): number { return state.distance; },
    set distance(v: number) { state.distance = v; },
    get perspective(): number { return state.perspective; },
    set perspective(v: number) { state.perspective = v; },
    get zoom(): number { return state.zoom; },
    set zoom(v: number) { state.zoom = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get fovScale(): number { return state.fovScale; },
    set fovScale(v: number) { state.fovScale = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    get eyeMode(): boolean { return state.eyeMode; },
    set eyeMode(v: boolean) { state.eyeMode = v; },
    get mat(): number[] | null { return state.mat; },
    set mat(v: number[] | null) { state.mat = v; },
    get useMat(): boolean { return state.useMat; },
    set useMat(v: boolean) { state.useMat = v; },
    eyeDepth(v) {
      const shifted: Vec3 = [v[0] - state.target[0], v[1] - state.target[1], v[2] - state.target[2]];
      const r = (state.useMat && state.mat)
        ? rotateVec3WithMat(shifted, state.mat)
        : rotateVec3Voxcss(shifted, state.rotX, state.rotY);
      // Clip a hair inside the projection near plane (0.001) for the same reason
      // as the perspective branch — crossing vertices must reproject finitely.
      const NEAR = 0.001 * 1.01;
      // eyeMode (first-person) takes precedence over `perspective`: a camera can
      // carry the default CSS-perspective value AND be flipped into eyeMode by
      // the first-person controls, and the eye-at-origin projection must win.
      if (state.eyeMode) return (-r[2]) - NEAR;
      if (state.perspective > 0) {
        const cssZ = r[2] * state.zoom * BASE_TILE - state.distance;
        // Near plane at 1% of the perspective distance, not ~on the eye: a
        // vertex right on the eye projects with `perspScale = P/near = ∞`,
        // which makes near-clipped triangles jitter wildly as the camera moves.
        // Bounding `near` to `P/100` caps that to ~100× and kills the jitter.
        return (state.perspective - cssZ) - state.perspective * PERSPECTIVE_CLIP_NEAR_FRACTION;
      }
      return (state.distance - r[2]) - NEAR;
    },
    project(v, cols, rows, cellAspect) {
      // Virtual char-cell pixel sizes (world-unit-to-cell conversion).
      // cellAspect = cellPxH / cellPxW; we define BASE_TILE as cellPxH so that
      // vertical and horizontal scales stay consistent with voxcss's BASE_TILE.
      // cellPxW = BASE_TILE / cellAspect.
      const cellPxH = BASE_TILE;
      const cellPxW = BASE_TILE / cellAspect;
      const cxN = state.center[0], cyN = state.center[1];

      const shifted: Vec3 = [
        v[0] - state.target[0],
        v[1] - state.target[1],
        v[2] - state.target[2],
      ];
      const r = (state.useMat && state.mat)
        ? rotateVec3WithMat(shifted, state.mat)
        : rotateVec3Voxcss(shifted, state.rotX, state.rotY);

      // eyeMode (first-person) takes precedence over `perspective`: the camera
      // can carry the default CSS-perspective value and still be flipped into
      // first-person by the controls, in which case the eye-at-origin
      // projection must win.
      if (state.eyeMode) {
        // Eye-at-origin first-person projection.
        // `target` is the eye position; rz2 < 0 means in front of the eye.
        // Perspective scale: objects at depth -d project at scale focal/d.
        const NEAR = 0.001;
        if (r[2] >= -NEAR) return [NaN, NaN, r[2], NaN];
        // Perspective scale in world units. state.focal is the reference depth
        // (distance of the "screen plane" from the eye).
        const perspScale = state.focal / -r[2];
        // world→screen-px: multiply by zoom * BASE_TILE, then divide by cell size.
        const screenPxX = r[0] * perspScale * state.zoom * BASE_TILE;
        const screenPxY = r[1] * perspScale * state.zoom * BASE_TILE;
        const col = cols * cxN + screenPxX / cellPxW * state.stretch;
        const row = rows * cyN + screenPxY / cellPxH;
        // zbuf = -1/r[2]: screen-space-linear (r[2] < 0 in front; nearer → larger).
        return [col, row, r[2], -1 / r[2]];
      }

      if (state.perspective > 0) {
        // voxcss / CSS-perspective parity projection.
        //
        // Reproduces exactly what the browser does for polycss: the camera
        // transform `translateZ(-distance) scale(zoom) rotateX rotate
        // translate3d(-target)` followed by the container's CSS
        // `perspective: P` (which applies `P / (P − z)` about the centre).
        //
        // r is the rotated vector in world units; convert to CSS px the same
        // way voxcss does (× zoom × BASE_TILE), pull back by `distance` px,
        // then apply the perspective divide. `target` is the world point at the
        // screen centre, so placing it ahead of the player makes the eye land
        // on the player → first-person, no eyeMode flag required.
        const P = state.perspective;
        const cssX = r[0] * state.zoom * BASE_TILE;
        const cssY = r[1] * state.zoom * BASE_TILE;
        const cssZ = r[2] * state.zoom * BASE_TILE - state.distance;
        const denom = P - cssZ;
        // Near plane at `P/100` (not ~0): keeps `perspScale = P/denom` bounded so
        // near-clipped triangles don't jitter. Geometry nearer than this is
        // clipped, matching how CSS hides geometry past the perspective origin.
        const NEAR = P * PERSPECTIVE_NEAR_FRACTION;
        if (denom < NEAR) return [NaN, NaN, cssZ, NaN];
        const perspScale = P / denom;
        const col = cols * cxN + (cssX * perspScale) / cellPxW * state.stretch * state.fovScale;
        const row = rows * cyN + (cssY * perspScale) / cellPxH * state.fovScale;
        // zbuf = 1/denom: affine in screen space, so barycentric interpolation
        // is exact. Nearer (larger cssZ → smaller denom) → larger 1/denom, so
        // the renderer's `pixelDepth > depthBuf` keeps the nearer surface.
        return [col, row, cssZ, 1 / denom];
      }

      // Perspective projection (orthographic when distance is very large).
      // rz2 is in world units; distance is in world units.
      // perspective scale = distance / (distance - rz2), same derivation as a
      // pinhole camera at depth `distance` looking toward +Z.
      const NEAR = 0.001;
      const denom = state.distance - r[2];
      if (denom < NEAR) return [NaN, NaN, r[2], NaN];
      const perspScale = state.distance / denom;

      // world→screen-px→char-cell
      const screenPxX = r[0] * perspScale * state.zoom * BASE_TILE;
      const screenPxY = r[1] * perspScale * state.zoom * BASE_TILE;
      const col = cols * cxN + screenPxX / cellPxW * state.stretch * state.fovScale;
      const row = rows * cyN + screenPxY / cellPxH * state.fovScale;
      // zbuf = 1/denom: screen-space-linear (nearer → smaller denom → larger).
      return [col, row, r[2], 1 / denom];
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
    fovScale: 1.0,
    target: [0, 0, 0] as Vec3,
    mat: opts.mat ?? null as number[] | null,
    useMat: opts.useMat ?? false,
    center: (opts.center ?? [0.5, 0.5]) as [number, number],
  };

  return {
    kind: "orthographic",
    get center(): [number, number] { return state.center; },
    set center(v: [number, number]) { state.center = v; },
    get rotX(): number { return state.rotX; },
    set rotX(v: number) { state.rotX = v; },
    get rotY(): number { return state.rotY; },
    set rotY(v: number) { state.rotY = v; },
    get distance(): number { return state.distance; },
    set distance(v: number) { state.distance = v; },
    // Orthographic projection has no perspective; field satisfies the interface.
    get perspective(): number { return 0; },
    set perspective(_v: number) { /* no-op — orthographic projection has no perspective */ },
    get zoom(): number { return state.zoom; },
    set zoom(v: number) { state.zoom = v; },
    get stretch(): number { return state.stretch; },
    set stretch(v: number) { state.stretch = v; },
    get fovScale(): number { return state.fovScale; },
    set fovScale(v: number) { state.fovScale = v; },
    get target(): Vec3 { return state.target; },
    set target(v: Vec3) { state.target = v; },
    // Orthographic cameras never use eye-mode projection. The setter is a no-op
    // so the field satisfies the GlyphCamera interface.
    get eyeMode(): boolean { return false; },
    set eyeMode(_v: boolean) { /* no-op — orthographic projection has no eye mode */ },
    get mat(): number[] | null { return state.mat; },
    set mat(v: number[] | null) { state.mat = v; },
    get useMat(): boolean { return state.useMat; },
    set useMat(v: boolean) { state.useMat = v; },
    // Orthographic projection has no eye, so nothing is ever near-clipped.
    eyeDepth(_v) { return Number.POSITIVE_INFINITY; },
    project(v, cols, rows, cellAspect) {
      // Virtual char-cell pixel sizes (see perspective camera for derivation).
      const cellPxH = BASE_TILE;
      const cellPxW = BASE_TILE / cellAspect;

      const shifted: Vec3 = [
        v[0] - state.target[0],
        v[1] - state.target[1],
        v[2] - state.target[2],
      ];
      // Branch: use the matrix path (quaternion trackball, no pole singularity)
      // or the Euler path (backward-compatible default).
      const r = (state.useMat && state.mat)
        ? rotateVec3WithMat(shifted, state.mat)
        : rotateVec3Voxcss(shifted, state.rotX, state.rotY);

      // Orthographic: no perspective divide.
      const cxN = state.center[0], cyN = state.center[1];
      const screenPxX = r[0] * state.zoom * BASE_TILE;
      const screenPxY = r[1] * state.zoom * BASE_TILE;
      const col = cols * cxN + screenPxX / cellPxW * state.fovScale;
      const row = rows * cyN + screenPxY / cellPxH * state.fovScale;
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
