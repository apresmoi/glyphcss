import { describe, it, expect } from "vitest";
import { shapeCoversFullyFace, oppositeFace } from "./coverage";
import { buildSceneContext, computeVisibleFaces } from "../index";
import type { Voxel } from "../types";

describe("shapeCoversFullyFace", () => {
  it("cube fully covers every face", () => {
    const cube: Voxel = { x: 0, y: 0, z: 0 };
    for (const face of ["t", "b", "fr", "fl", "bl", "br"] as const) {
      expect(shapeCoversFullyFace(cube, face)).toBe(true);
    }
  });

  it("ramp fully covers bottom and back-side; not the slope side or top", () => {
    // rot=0 → slope drops in +Y (fr); back side is bl (-Y).
    const ramp: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 0 };
    expect(shapeCoversFullyFace(ramp, "b")).toBe(true);
    expect(shapeCoversFullyFace(ramp, "bl")).toBe(true);
    expect(shapeCoversFullyFace(ramp, "fr")).toBe(false);
    expect(shapeCoversFullyFace(ramp, "t")).toBe(false);
    expect(shapeCoversFullyFace(ramp, "fl")).toBe(false);
    expect(shapeCoversFullyFace(ramp, "br")).toBe(false);
  });

  it("spike fully covers only its bottom face", () => {
    const spike: Voxel = { x: 0, y: 0, z: 0, shape: "spike", rot: 90 };
    expect(shapeCoversFullyFace(spike, "b")).toBe(true);
    for (const face of ["t", "fr", "fl", "bl", "br"] as const) {
      expect(shapeCoversFullyFace(spike, face)).toBe(false);
    }
  });
});

describe("isFaceOccluded — shape-aware (via computeVisibleFaces)", () => {
  it("cube next to cube: shared face IS occluded", () => {
    const a: Voxel = { x: 0, y: 0, z: 0 };
    const b: Voxel = { x: 1, y: 0, z: 0 };
    const { context } = buildSceneContext({ grid: [a, b], context: { walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } } });
    const faces = computeVisibleFaces(a, context);
    // a's +X (fl) face faces b — should be culled.
    expect(faces).not.toContain("fl");
  });

  it("cube next to spike: shared cube face is NOT occluded (spike doesn't fully cover its -X)", () => {
    const cube: Voxel = { x: 0, y: 0, z: 0 };
    // Spike with rot=180 → walls at br(-X) and fr(+Y) → its -X coverage is a triangle, not full.
    const spike: Voxel = { x: 1, y: 0, z: 0, shape: "spike", rot: 180 };
    const { context } = buildSceneContext({ grid: [cube, spike], context: { walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } } });
    const faces = computeVisibleFaces(cube, context);
    // Cube's +X (fl) face must render — the spike's -X is only a triangle.
    expect(faces).toContain("fl");
  });

  it("cube below spike: top face IS still occluded (spike's bottom is full)", () => {
    const cube: Voxel = { x: 0, y: 0, z: 0 };
    const spike: Voxel = { x: 0, y: 0, z: 1, shape: "spike", rot: 90 };
    const { context } = buildSceneContext({ grid: [cube, spike], context: { walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } } });
    const faces = computeVisibleFaces(cube, context);
    expect(faces).not.toContain("t");
  });

  it("cube next to ramp on the ramp's back side: cube face IS occluded (ramp back is full)", () => {
    const cube: Voxel = { x: 0, y: 0, z: 0 };
    // Ramp rot=0 → slope drops in +Y, back side is -Y (bl). Cube at y=-1 sees ramp's -Y (full) face.
    const ramp: Voxel = { x: 0, y: 1, z: 0, shape: "ramp", rot: 0 };
    const { context } = buildSceneContext({ grid: [cube, ramp], context: { walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } } });
    const faces = computeVisibleFaces(cube, context);
    // Cube's +Y (fr) face faces ramp's -Y (bl) which is full → occluded.
    expect(faces).not.toContain("fr");
  });

  it("cube next to ramp on the ramp's slope side: cube face is NOT occluded (slope side is empty)", () => {
    const cube: Voxel = { x: 0, y: 1, z: 0 };
    // Ramp rot=0 at y=0; cube at y=1 sees ramp's +Y face which is empty.
    const ramp: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 0 };
    const { context } = buildSceneContext({ grid: [cube, ramp], context: { walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } } });
    const faces = computeVisibleFaces(cube, context);
    // Cube's -Y (bl) face faces ramp's +Y (fr) which is empty → renders.
    expect(faces).toContain("bl");
  });
});

describe("oppositeFace", () => {
  it("pairs faces correctly", () => {
    expect(oppositeFace("t")).toBe("b");
    expect(oppositeFace("b")).toBe("t");
    expect(oppositeFace("fr")).toBe("bl");
    expect(oppositeFace("bl")).toBe("fr");
    expect(oppositeFace("fl")).toBe("br");
    expect(oppositeFace("br")).toBe("fl");
  });
});
