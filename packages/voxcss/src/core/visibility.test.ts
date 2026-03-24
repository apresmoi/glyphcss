import { describe, it, expect } from "vitest";
import { computeVisibleFaces } from "./visibility";
import { buildSceneContext } from "./context";
import type { GridContext, Voxel, WallsMask } from "./types";
import { DEFAULT_OFFSETS } from "./types";

function makeContext(voxels: Voxel[], wallsOverride?: Partial<WallsMask>): GridContext {
  const allFalseWalls: WallsMask = { t: false, b: false, bl: false, br: false, fl: false, fr: false };
  const walls = wallsOverride ? { ...allFalseWalls, ...wallsOverride } : allFalseWalls;
  const result = buildSceneContext({
    grid: voxels,
    context: { walls },
  });
  // Override the walls to use our test walls (buildSceneContext may compute its own)
  return { ...result.context, walls };
}

describe("computeVisibleFaces", () => {
  it("isolated voxel with all walls false shows all 6 faces", () => {
    const voxel: Voxel = { x: 5, y: 5, z: 0 };
    const context = makeContext([voxel]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).toHaveLength(6);
    expect(faces).toContain("t");
    expect(faces).toContain("b");
    expect(faces).toContain("fr");
    expect(faces).toContain("fl");
    expect(faces).toContain("bl");
    expect(faces).toContain("br");
  });

  it("neighbor above removes top face", () => {
    const voxel: Voxel = { x: 5, y: 5, z: 0 };
    const above: Voxel = { x: 5, y: 5, z: 1 };
    const context = makeContext([voxel, above]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).not.toContain("t");
    expect(faces).toContain("b");
    expect(faces).toContain("fr");
    expect(faces).toContain("fl");
  });

  it("neighbor below removes bottom face", () => {
    const voxel: Voxel = { x: 5, y: 5, z: 1 };
    const below: Voxel = { x: 5, y: 5, z: 0 };
    const context = makeContext([voxel, below]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).not.toContain("b");
    expect(faces).toContain("t");
  });

  it("neighbor in front-right (y+1) removes fr face", () => {
    // DEFAULT_OFFSETS.fr = [0, 1, 0]
    const voxel: Voxel = { x: 5, y: 5, z: 0 };
    const neighbor: Voxel = { x: 5, y: 6, z: 0 };
    const context = makeContext([voxel, neighbor]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).not.toContain("fr");
  });

  it("neighbor in front-left (x+1) removes fl face", () => {
    // DEFAULT_OFFSETS.fl = [1, 0, 0]
    const voxel: Voxel = { x: 5, y: 5, z: 0 };
    const neighbor: Voxel = { x: 6, y: 5, z: 0 };
    const context = makeContext([voxel, neighbor]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).not.toContain("fl");
  });

  it("neighbor in back-left (y-1) removes bl face", () => {
    // DEFAULT_OFFSETS.bl = [0, -1, 0]
    const voxel: Voxel = { x: 5, y: 5, z: 0 };
    const neighbor: Voxel = { x: 5, y: 4, z: 0 };
    const context = makeContext([voxel, neighbor]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).not.toContain("bl");
  });

  it("neighbor in back-right (x-1) removes br face", () => {
    // DEFAULT_OFFSETS.br = [-1, 0, 0]
    const voxel: Voxel = { x: 5, y: 5, z: 0 };
    const neighbor: Voxel = { x: 4, y: 5, z: 0 };
    const context = makeContext([voxel, neighbor]);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).not.toContain("br");
  });

  it("fully surrounded voxel has no visible faces", () => {
    const voxel: Voxel = { x: 5, y: 5, z: 1 };
    const neighbors: Voxel[] = [
      voxel,
      { x: 5, y: 5, z: 2 }, // above
      { x: 5, y: 5, z: 0 }, // below
      { x: 5, y: 6, z: 1 }, // fr
      { x: 6, y: 5, z: 1 }, // fl
      { x: 5, y: 4, z: 1 }, // bl
      { x: 4, y: 5, z: 1 }, // br
    ];
    const context = makeContext(neighbors);
    const faces = computeVisibleFaces(voxel, context);
    expect(faces).toHaveLength(0);
  });

  describe("wall mask filtering", () => {
    it("wall mask hides top face when t is true", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel], { t: true });
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("t");
    });

    it("wall mask hides bottom face when b is true", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel], { b: true });
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("b");
    });

    it("wall mask hides bl face when bl is true", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel], { bl: true });
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("bl");
    });

    it("wall mask hides fr face when fr is true", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel], { fr: true });
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("fr");
    });

    it("multiple wall masks can hide multiple faces", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel], { t: true, b: true, bl: true });
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("t");
      expect(faces).not.toContain("b");
      expect(faces).not.toContain("bl");
      expect(faces).toContain("fr");
      expect(faces).toContain("fl");
      expect(faces).toContain("br");
    });

    it("default walls (b, bl, br hidden) hide those faces", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0 };
      const context = makeContext([voxel], { b: true, bl: true, br: true });
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("b");
      expect(faces).not.toContain("bl");
      expect(faces).not.toContain("br");
      expect(faces).toContain("t");
      expect(faces).toContain("fr");
      expect(faces).toContain("fl");
    });
  });

  describe("area voxels", () => {
    it("area voxel needs all edge cells occupied for occlusion", () => {
      // 2x1 area voxel at (5,5) to (7,6)
      const voxel: Voxel = { x: 5, y: 5, z: 0, x2: 7, y2: 6 };
      // Only one neighbor along fr edge (y=6), but need both x=5 and x=6
      const partialNeighbor: Voxel = { x: 5, y: 6, z: 0 };
      const context = makeContext([voxel, partialNeighbor]);
      const faces = computeVisibleFaces(voxel, context);
      // fr should NOT be occluded because x=6,y=6 is empty
      expect(faces).toContain("fr");
    });

    it("area voxel fr face is occluded when all edge cells have neighbors", () => {
      const voxel: Voxel = { x: 5, y: 5, z: 0, x2: 7, y2: 6 };
      const neighbor1: Voxel = { x: 5, y: 6, z: 0 };
      const neighbor2: Voxel = { x: 6, y: 6, z: 0 };
      const context = makeContext([voxel, neighbor1, neighbor2]);
      const faces = computeVisibleFaces(voxel, context);
      expect(faces).not.toContain("fr");
    });
  });
});
