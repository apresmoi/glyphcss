import { describe, it, expect } from "vitest";
import { computeVisibleFaces } from "./visibility";
import { buildSceneContext } from "./context";
import type { GridContext, Voxel, WallsMask, OffsetMap } from "../types";
import { DEFAULT_OFFSETS } from "../types";

function makeContext(voxels: Voxel[], wallsOverride?: Partial<WallsMask>): GridContext {
  const allFalseWalls: WallsMask = { t: false, b: false, bl: false, br: false, fl: false, fr: false };
  const walls = wallsOverride ? { ...allFalseWalls, ...wallsOverride } : allFalseWalls;
  const result = buildSceneContext({
    grid: voxels,
    context: { walls },
  });
  return { ...result.context, walls };
}

describe("computeVisibleFaces — extended coverage", () => {
  // =========================================================================
  // Line 51: isFaceOccluded returns false when offset is [0,0,0]
  // The "f" face in DEFAULT_OFFSETS has offset [0,0,0], meaning dx=0, dy=0, dz=0.
  // This falls through all three if-blocks and returns false at line 51.
  // =========================================================================
  describe("face with zero offset vector", () => {
    it("face with all-zero offset returns false for occlusion (falls through)", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel]);

      // Inject a custom offset with all zeros for a face to trigger line 51
      const customOffsets: OffsetMap = {
        ...DEFAULT_OFFSETS,
        // The "f" face already has [0,0,0] in DEFAULT_OFFSETS,
        // but it's not in CUBE_FACES. Let's make a face that has [0,0,0].
      };
      const customContext: GridContext = {
        ...context,
        offsets: customOffsets,
      };

      // computeVisibleFaces iterates over CUBE_FACES which doesn't include "f",
      // so we need to test isFaceOccluded directly.
      // Since isFaceOccluded is private, we test via a context where an offset
      // for a known face is [0,0,0].
      const contextWithZeroOffset: GridContext = {
        ...context,
        offsets: {
          ...DEFAULT_OFFSETS,
          t: [0, 0, 0] as [number, number, number],
        },
      };

      const faces = computeVisibleFaces(voxel, contextWithZeroOffset);
      // "t" face has [0,0,0] offset so isFaceOccluded should return false
      // and it should NOT be hidden by walls (walls.t is false)
      // So "t" should be in the visible faces
      expect(faces).toContain("t");
    });
  });

  // =========================================================================
  // Line 64: isWallFaceHidden default case
  // This default branch is only hit if a face string doesn't match any of the
  // known cases. In practice, CUBE_FACES only contains known faces, so this
  // is a safety fallback. We can test it indirectly by checking that all
  // known face names are properly handled.
  // =========================================================================
  describe("isWallFaceHidden edge cases", () => {
    it("all six known faces are properly checked against wall mask", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };

      // All walls hidden
      const allHiddenWalls: WallsMask = { t: true, b: true, bl: true, br: true, fl: true, fr: true };
      const context = makeContext([voxel], allHiddenWalls);
      const faces = computeVisibleFaces(voxel, context);

      // All faces should be hidden
      expect(faces).toHaveLength(0);
    });

    it("only specific faces are hidden based on wall mask", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };

      // Only fl and fr hidden
      const context = makeContext([voxel], { fl: true, fr: true });
      const faces = computeVisibleFaces(voxel, context);

      expect(faces).not.toContain("fl");
      expect(faces).not.toContain("fr");
      expect(faces).toContain("t");
      expect(faces).toContain("b");
      expect(faces).toContain("bl");
      expect(faces).toContain("br");
    });
  });

  // =========================================================================
  // Area voxel with dz occlusion (top/bottom faces for wide voxels)
  // =========================================================================
  describe("area voxel top face occlusion", () => {
    it("area voxel top face is occluded when all cells above are covered", () => {
      // 2x2 area voxel at z=0
      const voxel: Voxel = { x: 5, y: 5, z: 0, x2: 7, y2: 7 };
      // 4 voxels above covering entire area
      const above: Voxel[] = [
        { x: 5, y: 5, z: 1 },
        { x: 5, y: 6, z: 1 },
        { x: 6, y: 5, z: 1 },
        { x: 6, y: 6, z: 1 }
      ];
      const context = makeContext([voxel, ...above]);
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("t");
    });

    it("area voxel top face visible when not all cells above are covered", () => {
      // 2x2 area voxel at z=0
      const voxel: Voxel = { x: 5, y: 5, z: 0, x2: 7, y2: 7 };
      // Only 3 of 4 cells above are covered
      const above: Voxel[] = [
        { x: 5, y: 5, z: 1 },
        { x: 5, y: 6, z: 1 },
        { x: 6, y: 5, z: 1 }
        // Missing (6, 6, 1)
      ];
      const context = makeContext([voxel, ...above]);
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).toContain("t");
    });
  });

  // =========================================================================
  // Area voxel fl/br face occlusion (x-axis neighbors)
  // =========================================================================
  describe("area voxel fl face occlusion (x-axis)", () => {
    it("2x1 area voxel fl face is occluded when all x-edge cells have neighbors", () => {
      // 1x2 area voxel (x: 5..6, y: 5..6)
      const voxel: Voxel = { x: 5, y: 5, z: 0, x2: 6, y2: 7 };
      // fl is x+1 direction; for x2=6, targetX = 6
      const neighbor1: Voxel = { x: 6, y: 5, z: 0 };
      const neighbor2: Voxel = { x: 6, y: 6, z: 0 };
      const context = makeContext([voxel, neighbor1, neighbor2]);
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("fl");
    });
  });
});
