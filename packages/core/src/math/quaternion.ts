/**
 * Minimal quaternion helpers for composing rotations.
 *
 * Why we need quaternions: the public PolyMesh API exposes rotation as a
 * Euler triple `[rx, ry, rz]` in degrees (drives CSS `rotateX rotateY
 * rotateZ`, applied right-to-left). Euler triples don't compose by
 * component addition — rotating Y after X must happen around the mesh's
 * NEW local-Y axis, not world-Y. The transform-controls ring drag handler
 * uses these helpers to compose around the mesh's local axis correctly:
 *
 *   q_start = quatFromEulerXYZ(currentRotationDeg)
 *   q_delta = quatFromAxisAngle(localAxis, deltaRadians)
 *   q_new   = quatMultiply(q_start, q_delta)        // RIGHT-multiply = local frame
 *   next    = eulerXYZFromQuat(q_new)
 *
 * Convention: "XYZ" Euler means the composed rotation matrix is
 * `Rx(rx) · Ry(ry) · Rz(rz)`, which matches CSS `rotateX rotateY rotateZ`
 * (right-to-left application to a point ⇒ Z first, then Y, then X).
 *
 * Quaternion format: `[w, x, y, z]` (real-first, like three.js's internal
 * `_x/_y/_z/_w` reordered). Stored as plain tuples — no constructor or
 * runtime allocations per drag.
 */
import type { Vec3 } from "../types";

/** Quaternion `[w, x, y, z]`, real component first. Unit-length is not
 *  enforced by the type — callers normalize when needed. */
export type Quat = [number, number, number, number];

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Identity quaternion. */
export const QUAT_IDENTITY: Quat = [1, 0, 0, 0];

/** Hamilton product `q1 * q2`. Apply to a vector as `q v q⁻¹`. Right-
 *  multiplication composes the second rotation in the LOCAL frame of the
 *  first — that's the property the gizmo relies on for local-axis drag. */
export function quatMultiply(q1: Quat, q2: Quat): Quat {
  const [w1, x1, y1, z1] = q1;
  const [w2, x2, y2, z2] = q2;
  return [
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
  ];
}

/** Quaternion from axis-angle. `axis` must be unit length (caller's
 *  responsibility — typically a CSS basis vector). `angleRad` in radians. */
export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** Quaternion from Euler XYZ degrees — the order CSS `rotateX rotateY
 *  rotateZ` applies. Matches the composed matrix `Rx(rx)·Ry(ry)·Rz(rz)`. */
export function quatFromEulerXYZ(eulerDeg: Vec3): Quat {
  const rx = eulerDeg[0] * DEG_TO_RAD;
  const ry = eulerDeg[1] * DEG_TO_RAD;
  const rz = eulerDeg[2] * DEG_TO_RAD;
  const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);
  // q = qx * qy * qz with qa(angle) = (cos(angle/2), axisVec*sin(angle/2)).
  return [
    cx * cy * cz - sx * sy * sz,
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
  ];
}

/** Euler XYZ degrees from a quaternion — inverse of `quatFromEulerXYZ`.
 *  Handles gimbal lock (|ry| → 90°) by collapsing rz onto rx. The output
 *  matches the convention used by CSS `rotateX rotateY rotateZ` so it can
 *  be written straight back into a PolyMesh rotation prop. */
export function eulerXYZFromQuat(q: Quat): Vec3 {
  const [w, x, y, z] = q;
  // Matrix elements we need (from quatToMatrix):
  //   m02 = 2(xz + wy)  ← sin(ry)
  //   m12 = 2(yz - wx)  ← -sin(rx)cos(ry)
  //   m22 = 1 - 2(x²+y²) ← cos(rx)cos(ry)
  //   m01 = 2(xy - wz)  ← -cos(ry)sin(rz)
  //   m00 = 1 - 2(y²+z²) ← cos(ry)cos(rz)
  const m02 = 2 * (x * z + w * y);
  const m12 = 2 * (y * z - w * x);
  const m22 = 1 - 2 * (x * x + y * y);
  const m01 = 2 * (x * y - w * z);
  const m00 = 1 - 2 * (y * y + z * z);
  // sin(ry) clamped to handle floating-point overshoot.
  const sy = Math.max(-1, Math.min(1, m02));
  const ry = Math.asin(sy);
  // Gimbal lock threshold: cos(ry) ≈ 0 → ry near ±90°. Pick rz = 0 and
  // recover rx from the remaining diagonal — same approach three.js uses.
  if (Math.abs(sy) < 0.99999) {
    return [
      Math.atan2(-m12, m22) * RAD_TO_DEG,
      ry * RAD_TO_DEG,
      Math.atan2(-m01, m00) * RAD_TO_DEG,
    ];
  }
  return [
    Math.atan2(2 * (y * z + w * x), 1 - 2 * (x * x + z * z)) * RAD_TO_DEG,
    ry * RAD_TO_DEG,
    0,
  ];
}
