/**
 * NOT SHIPPED — a test-only helper, imported by `widget.walk*.test.ts`.
 *
 * Three of walk mode's properties are about the CAMERA rather than about the
 * picture, and every one of them is easiest to get wrong silently. Reading
 * them needs the eye and the view axis, and a positioned CSS-perspective
 * camera exposes neither directly: it publishes `target`, `rotX`/`rotY` (or
 * `mat`), `perspective` and `zoom`, and the eye is derived from all of them.
 * So the tests recover the eye the way the widget itself derives it, off
 * `eyeDepth` — which is AFFINE in the world point by contract, so its
 * gradient is exact rather than a finite-difference approximation of
 * something curved.
 */
import type { Vec3 } from "@glyphcss/core";

/** glyphcss's world-unit-to-perspective-Z factor (`createGlyphCamera`'s `BASE_TILE`). */
const BASE_TILE = 50;

/** The radius `@glyphcss/maps` models the Earth at, metres. */
export const EARTH_RADIUS_M = 6_371_000;

interface ProbeCamera {
  readonly perspective: number;
  readonly zoom: number;
  readonly target: Vec3;
  eyeDepth(v: Vec3): number;
  project(v: Vec3, cols: number, rows: number, cellAspect: number, metrics?: {
    cellWidth?: number; cellHeight?: number; centerCol?: number; centerRow?: number;
  }): [number, number, number, number?];
}

/**
 * The camera's VIEW AXIS, unit length, pointing the way the walker faces.
 *
 * `eyeDepth(v) = P - (r_z(v) * BASE_TILE - distance) - P * k` is affine in
 * `v`, so its gradient is a constant vector pointing AWAY from the eye at
 * `BASE_TILE` per world unit; the walker looks the other way. Two
 * evaluations per axis give it exactly, with no dependence on `rotX`/`rotY`
 * or on whether a bearing matrix is installed — which is the point: a test
 * that re-derived the axis from the Euler angles would be re-implementing
 * the thing under test.
 */
export function walkForward(camera: ProbeCamera): Vec3 {
  const t = camera.target;
  const base = camera.eyeDepth(t);
  const h = 1e-7;
  const g = [0, 1, 2].map((i) => {
    const v: Vec3 = [t[0], t[1], t[2]];
    v[i] += h;
    return (camera.eyeDepth(v) - base) / h;
  }) as [number, number, number];
  const n = Math.hypot(g[0], g[1], g[2]);
  return [g[0] / n, g[1] / n, g[2] / n];
}

/**
 * Where the walker's eye actually is, in world units.
 *
 * The CSS-perspective eye sits `perspective / BASE_TILE` world units BEHIND
 * `camera.target` along the view axis — the same relation `poseWalkCamera`
 * inverts to put the target ahead of the eye — so this is that relation read
 * in the other direction.
 */
export function walkEye(camera: ProbeCamera): Vec3 {
  const f = walkForward(camera);
  const d = camera.perspective / BASE_TILE;
  const t = camera.target;
  return [t[0] - f[0] * d, t[1] - f[1] * d, t[2] - f[2] * d];
}

/** Straight-line distance between two world points, in metres. */
export function metresBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * EARTH_RADIUS_M;
}

/**
 * The HORIZONTAL field of view the camera actually produces, degrees.
 *
 * Not read off `perspective`/`zoom` through the formula the widget solves —
 * that would only prove the widget can invert its own arithmetic. This
 * bisects on the REAL `project()`: the half-FOV is the off-axis angle whose
 * ray lands exactly on the right edge of the rendered grid, so it measures
 * the lens through the same call the rasteriser makes, including every cell
 * metric and centring term.
 */
export function measuredHorizontalFovDeg(
  camera: ProbeCamera,
  grid: { cols: number; rows: number; cellWidth: number; cellHeight: number },
): number {
  const f = walkForward(camera);
  const eye = walkEye(camera);
  // A right vector: perpendicular to the view axis and to the local up at
  // the eye (the eye is a point on a sphere about the origin, so its own
  // normalized position IS that up).
  const un = Math.hypot(eye[0], eye[1], eye[2]);
  const up: Vec3 = [eye[0] / un, eye[1] / un, eye[2] / un];
  const r: Vec3 = [
    f[1] * up[2] - f[2] * up[1],
    f[2] * up[0] - f[0] * up[2],
    f[0] * up[1] - f[1] * up[0],
  ];
  const rn = Math.hypot(r[0], r[1], r[2]);
  const right: Vec3 = [r[0] / rn, r[1] / rn, r[2] / rn];
  const metrics = { cellWidth: grid.cellWidth, cellHeight: grid.cellHeight };
  // 100 m ahead: far enough to be well past the near plane, near enough that
  // the sphere's curvature over the offset is irrelevant.
  const ahead = 100 / EARTH_RADIUS_M;
  const colAt = (angleDeg: number): number => {
    const t = Math.tan((angleDeg * Math.PI) / 180) * ahead;
    const p: Vec3 = [
      eye[0] + f[0] * ahead + right[0] * t,
      eye[1] + f[1] * ahead + right[1] * t,
      eye[2] + f[2] * ahead + right[2] * t,
    ];
    return camera.project(p, grid.cols, grid.rows, grid.cellWidth / grid.cellHeight, metrics)[0];
  };
  let lo = 0.01, hi = 89;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (colAt(mid) < grid.cols) lo = mid; else hi = mid;
  }
  return 2 * ((lo + hi) / 2);
}
