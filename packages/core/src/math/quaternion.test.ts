import { describe, it, expect } from "vitest";
import {
  QUAT_IDENTITY,
  eulerXYZFromQuat,
  quatFromAxisAngle,
  quatFromEulerXYZ,
  quatMultiply,
} from "./quaternion";

const TAU = Math.PI * 2;

function expectVec3Close(actual: readonly [number, number, number], expected: readonly [number, number, number], tol = 1e-6): void {
  expect(actual[0]).toBeCloseTo(expected[0], tol < 1 ? 5 : 0);
  expect(actual[1]).toBeCloseTo(expected[1], tol < 1 ? 5 : 0);
  expect(actual[2]).toBeCloseTo(expected[2], tol < 1 ? 5 : 0);
}

describe("quaternion helpers", () => {
  it("identity round-trips through eulerXYZFromQuat", () => {
    const e = eulerXYZFromQuat(QUAT_IDENTITY);
    expectVec3Close(e, [0, 0, 0]);
  });

  it("quatFromEulerXYZ([0,0,0]) is identity", () => {
    const q = quatFromEulerXYZ([0, 0, 0]);
    expect(q).toEqual([1, 0, 0, 0]);
  });

  it("quatFromAxisAngle(X, 0) is identity", () => {
    const q = quatFromAxisAngle([1, 0, 0], 0);
    expect(q).toEqual([1, 0, 0, 0]);
  });

  it("Euler round-trips for pure single-axis rotations", () => {
    for (const axis of [0, 1, 2] as const) {
      const eIn: [number, number, number] = [0, 0, 0];
      eIn[axis] = 30;
      const q = quatFromEulerXYZ(eIn);
      const eOut = eulerXYZFromQuat(q);
      expectVec3Close(eOut, eIn);
    }
  });

  it("Euler round-trips for combined rotations away from gimbal lock", () => {
    const eIn: [number, number, number] = [20, 35, 45];
    const eOut = eulerXYZFromQuat(quatFromEulerXYZ(eIn));
    expectVec3Close(eOut, eIn);
  });

  it("quatMultiply with identity is a no-op", () => {
    const q = quatFromEulerXYZ([15, 25, 35]);
    expect(quatMultiply(q, QUAT_IDENTITY)).toEqual(q);
    expect(quatMultiply(QUAT_IDENTITY, q)).toEqual(q);
  });

  it("local-axis compose ≠ Euler-add when an axis is repeated after another", () => {
    // Bug scenario: mesh has rotation [90, 45, 0] (rotated X=90 then Y=45).
    // User drags the X ring again. Euler-add would set rotation[0] =
    // 90 + 45 = 135, producing matrix X(135)*Y(45). Local-compose multiplies
    // on the right: X(90)*Y(45)*X(45) ≠ X(135)*Y(45). The composed Euler is
    // therefore different from the naïve add.
    const qBase = quatFromEulerXYZ([90, 45, 0]);
    const qDelta = quatFromAxisAngle([1, 0, 0], (Math.PI * 45) / 180);
    const qLocal = quatMultiply(qBase, qDelta);
    const localEuler = eulerXYZFromQuat(qLocal);
    const naiveAddEuler: [number, number, number] = [135, 45, 0];
    const diff =
      Math.abs(localEuler[0] - naiveAddEuler[0]) +
      Math.abs(localEuler[1] - naiveAddEuler[1]) +
      Math.abs(localEuler[2] - naiveAddEuler[2]);
    expect(diff).toBeGreaterThan(1);
  });

  it("local-axis compose IS commutative with Euler-add for X-then-Y-once (XYZ order quirk)", () => {
    // Sanity: when the user only ever rotates each axis at most once and in
    // X-then-Y-then-Z order, local-compose collapses to Euler-add (because
    // that's the very definition of Euler XYZ). Verifies the helpers are
    // self-consistent — bugs in other tests above would also fail here.
    const qStart = quatFromEulerXYZ([90, 0, 0]);
    const qDelta = quatFromAxisAngle([0, 1, 0], (Math.PI * 45) / 180);
    const qNew = quatMultiply(qStart, qDelta);
    const e = eulerXYZFromQuat(qNew);
    expectVec3Close(e, [90, 45, 0]);
  });

  it("composing a full TAU rotation around any axis returns to identity orientation", () => {
    for (const axis of [
      [1, 0, 0] as const,
      [0, 1, 0] as const,
      [0, 0, 1] as const,
    ]) {
      const q = quatFromAxisAngle([axis[0], axis[1], axis[2]], TAU);
      // 2π rotation = identity OR -identity (same orientation, opposite hemisphere).
      const same = Math.abs(q[0] - 1) < 1e-6;
      const flipped = Math.abs(q[0] + 1) < 1e-6;
      expect(same || flipped).toBe(true);
    }
  });
});
