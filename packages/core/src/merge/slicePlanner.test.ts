import { describe, it, expect } from "vitest";
import { buildSceneContext } from "../scene/context";
import { buildFaceDataFromSnapshot } from "./slicePlanner";
import type { Voxel } from "../types";

describe("buildFaceDataFromSnapshot", () => {
  it("z2 voxel populates occupancy at every covered layer — top face plane at z2", () => {
    const tall: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const built = buildSceneContext({ grid: [tall] });
    const faces = buildFaceDataFromSnapshot({ layers: built.layers, context: built.context });

    // The tall cube spans z=0..2; its top face plane should be at z2=3, not z+1=1.
    const top = faces.find(f => f.key.face === "t");
    expect(top).toBeDefined();
    expect(top!.key.plane).toBe(3);
  });

  it("regression: 1×1×3 cube produces visible faces across all three Z layers", () => {
    // Without SR-1, only z=0 would be in occupancy and the upper layers' side cells
    // would be missing — br face height (z-span) would be 1 instead of 3.
    const tall: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const built = buildSceneContext({ grid: [tall] });
    const faces = buildFaceDataFromSnapshot({ layers: built.layers, context: built.context });

    // For "br"/"le" faces: addCell("x", ..., face, voxel, z+1, y)
    // row = z+1, col = y → height encodes z-span
    const br = faces.find(f => f.key.face === "br");
    expect(br).toBeDefined();
    expect(br!.buffer.height).toBe(3);
  });

  it("tall cube next to short cube: short cube correctly occludes the bottom of the tall cube's side", () => {
    // A 1×1×3 tall cube at (0,0) and a 1×1×1 short cube at (0,1).
    // The short cube occupies z=0 only; the tall cube's fr face at z=1 and z=2
    // should still be visible (no neighbor there).
    const tall: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const short: Voxel = { x: 0, y: 1, z: 0 };
    const built = buildSceneContext({ grid: [tall, short] });
    const faces = buildFaceDataFromSnapshot({ layers: built.layers, context: built.context });

    // The fr face of the tall cube (at y=1 plane) should still appear
    // because the full side strip ([z=0..2]) is not covered — only z=0 is blocked.
    const frFaces = faces.filter(f => f.key.face === "fr" && f.key.axis === "y");
    // The short cube's back face and the tall cube's front face share the same plane (y=1),
    // but not all layers are covered, so the tall cube's fr cells at z=1 and z=2 remain.
    const frPlane1 = frFaces.find(f => f.key.plane === 1);
    expect(frPlane1).toBeDefined();
    // The fr plane at y=1 must contain cells at z=1 and z=2 (visible, not occluded).
    // height for fr is 1 (row=x=0 only), width encodes z-span; check width >= 2
    // because z=1 and z=2 cells (col=2 and col=3) are present.
    expect(frPlane1!.buffer.width).toBeGreaterThanOrEqual(2);
  });
});
