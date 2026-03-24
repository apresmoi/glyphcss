import { describe, it, expect } from "vitest";
import {
  buildSceneContext,
  computeWallMask,
  wallMasksEqual,
  inferGridDimensions,
  getVoxelBounds,
  getVoxelZBounds,
} from "./context";
import type { Voxel, WallsMask } from "./types";

describe("inferGridDimensions", () => {
  it("returns fallback dimensions for empty grid", () => {
    const dims = inferGridDimensions([]);
    expect(dims.rows).toBe(16);
    expect(dims.cols).toBe(16);
    expect(dims.depth).toBe(12);
  });

  it("infers dimensions from voxels", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 5, z: 2 },
    ];
    const dims = inferGridDimensions(grid);
    expect(dims.rows).toBe(4); // max x+1 = 4
    expect(dims.cols).toBe(6); // max y+1 = 6
    expect(dims.depth).toBe(3); // max z+1 = 3
  });

  it("accounts for area voxels (x2/y2)", () => {
    const grid: Voxel[] = [{ x: 0, y: 0, z: 0, x2: 10, y2: 8 }];
    const dims = inferGridDimensions(grid);
    expect(dims.rows).toBe(10);
    expect(dims.cols).toBe(8);
  });
});

describe("buildSceneContext", () => {
  it("returns fallback dimensions for empty grid", () => {
    const result = buildSceneContext({ grid: [] });
    expect(result.dimensions.rows).toBe(16);
    expect(result.dimensions.cols).toBe(16);
    expect(result.dimensions.depth).toBe(12);
  });

  it("creates correct number of layers matching voxel z values", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
    ];
    const result = buildSceneContext({ grid });
    expect(result.layers.length).toBe(3);
    expect(result.layers[0]).toHaveLength(1);
    expect(result.layers[1]).toHaveLength(1);
    expect(result.layers[2]).toHaveLength(1);
  });

  it("places voxels in correct layers by z value", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "red" },
      { x: 1, y: 1, z: 2, color: "blue" },
    ];
    const result = buildSceneContext({ grid });
    expect(result.layers[0][0].color).toBe("red");
    expect(result.layers[2][0].color).toBe("blue");
  });

  describe("getVoxel", () => {
    it("returns placed voxel at its position", () => {
      const voxel: Voxel = { x: 2, y: 3, z: 0, color: "green" };
      const result = buildSceneContext({ grid: [voxel] });
      const found = result.context.getVoxel(2, 3, 0);
      expect(found).not.toBeNull();
      expect(found!.color).toBe("green");
    });

    it("returns null for empty cell", () => {
      const result = buildSceneContext({ grid: [{ x: 0, y: 0, z: 0 }] });
      expect(result.context.getVoxel(5, 5, 0)).toBeNull();
    });

    it("returns null for out-of-bounds coordinates", () => {
      const result = buildSceneContext({ grid: [{ x: 0, y: 0, z: 0 }] });
      expect(result.context.getVoxel(-1, 0, 0)).toBeNull();
      expect(result.context.getVoxel(0, -1, 0)).toBeNull();
      expect(result.context.getVoxel(0, 0, -1)).toBeNull();
      expect(result.context.getVoxel(999, 0, 0)).toBeNull();
    });

    it("finds area voxels for all covered cells", () => {
      const areaVoxel: Voxel = { x: 1, y: 1, z: 0, x2: 3, y2: 4 };
      const result = buildSceneContext({ grid: [areaVoxel] });
      // All cells in [1..2] x [1..3] should return the voxel
      expect(result.context.getVoxel(1, 1, 0)).not.toBeNull();
      expect(result.context.getVoxel(1, 2, 0)).not.toBeNull();
      expect(result.context.getVoxel(1, 3, 0)).not.toBeNull();
      expect(result.context.getVoxel(2, 1, 0)).not.toBeNull();
      expect(result.context.getVoxel(2, 3, 0)).not.toBeNull();
      // Outside area
      expect(result.context.getVoxel(3, 1, 0)).toBeNull();
      expect(result.context.getVoxel(1, 4, 0)).toBeNull();
      expect(result.context.getVoxel(0, 0, 0)).toBeNull();
    });

    it("finds tall voxels in multiple layers", () => {
      const tallVoxel: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
      const result = buildSceneContext({ grid: [tallVoxel] });
      expect(result.context.getVoxel(0, 0, 0)).not.toBeNull();
      expect(result.context.getVoxel(0, 0, 1)).not.toBeNull();
      expect(result.context.getVoxel(0, 0, 2)).not.toBeNull();
      expect(result.context.getVoxel(0, 0, 3)).toBeNull();
    });
  });

  it("respects dimension overrides", () => {
    const result = buildSceneContext({
      grid: [{ x: 0, y: 0, z: 0 }],
      dimensions: { rows: 32, cols: 24, depth: 8 },
    });
    expect(result.dimensions.rows).toBeGreaterThanOrEqual(32);
    expect(result.dimensions.cols).toBeGreaterThanOrEqual(24);
    expect(result.dimensions.depth).toBeGreaterThanOrEqual(8);
  });

  it("uses cubic projection by default", () => {
    const result = buildSceneContext({ grid: [] });
    expect(result.context.projection).toBe("cubic");
    expect(result.context.layerElevation).toBe(50);
  });

  it("uses half elevation for dimetric projection", () => {
    const result = buildSceneContext({
      grid: [],
      context: { projection: "dimetric" },
    });
    expect(result.context.projection).toBe("dimetric");
    expect(result.context.layerElevation).toBe(25);
  });

  it("tileSize is always 50", () => {
    const result = buildSceneContext({ grid: [] });
    expect(result.context.tileSize).toBe(50);
  });

  it("uses default wall color", () => {
    const result = buildSceneContext({ grid: [] });
    expect(result.context.wallColor).toBe("#3e3e4d");
  });

  it("computes walls from rotation angles", () => {
    const result = buildSceneContext({
      grid: [],
      context: { rotX: 65, rotY: 45 },
    });
    expect(result.context.walls.t).toBe(false);
    expect(result.context.walls.b).toBe(true);
  });
});

describe("computeWallMask", () => {
  it("returns default mask for default angles (65, 45)", () => {
    const mask = computeWallMask(65, 45);
    expect(mask.t).toBe(false);
    expect(mask.b).toBe(true);
    expect(mask.bl).toBe(true);
    expect(mask.br).toBe(true);
    expect(mask.fl).toBe(false);
    expect(mask.fr).toBe(false);
  });

  it("flips top/bottom when rotX >= 90", () => {
    const mask = computeWallMask(90, 45);
    expect(mask.t).toBe(true);
    expect(mask.b).toBe(false);
  });

  it("flips top/bottom when rotX = 89 (below 90)", () => {
    const mask = computeWallMask(89, 45);
    expect(mask.t).toBe(false);
    expect(mask.b).toBe(true);
  });

  it("handles rotY = 0 (first quadrant)", () => {
    const mask = computeWallMask(65, 0);
    expect(mask.bl).toBe(true); // 0 <= 180
    expect(mask.fr).toBe(false); // 0 <= 180
    expect(mask.br).toBe(true); // 0 < 90
    expect(mask.fl).toBe(false); // 0 < 90
  });

  it("handles rotY = 90 (second quadrant)", () => {
    const mask = computeWallMask(65, 90);
    expect(mask.bl).toBe(true); // 90 <= 180
    expect(mask.fr).toBe(false); // 90 <= 180
    expect(mask.br).toBe(false); // 90 >= 90 && 90 < 270
    expect(mask.fl).toBe(true); // 90 >= 90 && 90 < 270
  });

  it("handles rotY = 180 (third quadrant boundary)", () => {
    const mask = computeWallMask(65, 180);
    expect(mask.bl).toBe(true); // 180 <= 180
    expect(mask.fr).toBe(false); // 180 is not > 180
    expect(mask.fl).toBe(true); // 180 >= 90 && 180 < 270
  });

  it("handles rotY = 270 (fourth quadrant)", () => {
    const mask = computeWallMask(65, 270);
    expect(mask.bl).toBe(false); // 270 > 180
    expect(mask.fr).toBe(true); // 270 > 180
    expect(mask.br).toBe(true); // 270 >= 270
    expect(mask.fl).toBe(false); // 270 is not < 270
  });

  it("handles negative rotY by wrapping", () => {
    const maskNeg = computeWallMask(65, -45);
    const maskPos = computeWallMask(65, 315); // -45 + 360 = 315
    expect(maskNeg).toEqual(maskPos);
  });

  it("handles rotY = 360 (wraps to 0)", () => {
    const mask360 = computeWallMask(65, 360);
    const mask0 = computeWallMask(65, 0);
    expect(mask360).toEqual(mask0);
  });

  it("handles large rotY values (> 360)", () => {
    const mask = computeWallMask(65, 405); // 405 % 360 = 45
    const maskBase = computeWallMask(65, 45);
    expect(mask).toEqual(maskBase);
  });

  it("uses default values when called with no arguments", () => {
    const mask = computeWallMask();
    const maskExplicit = computeWallMask(65, 45);
    expect(mask).toEqual(maskExplicit);
  });
});

describe("wallMasksEqual", () => {
  const maskA: WallsMask = { t: false, b: true, bl: true, br: true, fl: false, fr: false };
  const maskB: WallsMask = { t: false, b: true, bl: true, br: true, fl: false, fr: false };
  const maskC: WallsMask = { t: true, b: false, bl: false, br: false, fl: true, fr: true };

  it("returns true for identical masks", () => {
    expect(wallMasksEqual(maskA, maskB)).toBe(true);
  });

  it("returns true for same reference", () => {
    expect(wallMasksEqual(maskA, maskA)).toBe(true);
  });

  it("returns false for different masks", () => {
    expect(wallMasksEqual(maskA, maskC)).toBe(false);
  });

  it("returns false when first is null", () => {
    expect(wallMasksEqual(null, maskA)).toBe(false);
  });

  it("returns false when second is null", () => {
    expect(wallMasksEqual(maskA, null)).toBe(false);
  });

  it("returns true when both are null (same reference)", () => {
    expect(wallMasksEqual(null, null)).toBe(true);
  });

  it("returns true when both are undefined (same reference)", () => {
    expect(wallMasksEqual(undefined, undefined)).toBe(true);
  });

  it("returns false when only one field differs", () => {
    const maskDiff: WallsMask = { ...maskA, t: true };
    expect(wallMasksEqual(maskA, maskDiff)).toBe(false);
  });
});

describe("getVoxelBounds", () => {
  it("returns x+1 and y+1 when x2/y2 not set", () => {
    const bounds = getVoxelBounds({ x: 3, y: 5, z: 0 });
    expect(bounds.x2).toBe(4);
    expect(bounds.y2).toBe(6);
  });

  it("returns explicit x2/y2 when set", () => {
    const bounds = getVoxelBounds({ x: 1, y: 2, z: 0, x2: 5, y2: 8 });
    expect(bounds.x2).toBe(5);
    expect(bounds.y2).toBe(8);
  });
});

describe("getVoxelZBounds", () => {
  it("returns z and z+1 when z2 not set", () => {
    const bounds = getVoxelZBounds({ x: 0, y: 0, z: 3 });
    expect(bounds.z).toBe(3);
    expect(bounds.z2).toBe(4);
  });

  it("returns z2 when set", () => {
    const bounds = getVoxelZBounds({ x: 0, y: 0, z: 0, z2: 5 });
    expect(bounds.z).toBe(0);
    expect(bounds.z2).toBe(5);
  });

  it("floors z value", () => {
    const bounds = getVoxelZBounds({ x: 0, y: 0, z: 2.7 });
    expect(bounds.z).toBe(2);
  });

  it("clamps negative z to 0", () => {
    const bounds = getVoxelZBounds({ x: 0, y: 0, z: -3 });
    expect(bounds.z).toBe(0);
    expect(bounds.z2).toBe(1);
  });

  it("ensures z2 is at least z + 1", () => {
    const bounds = getVoxelZBounds({ x: 0, y: 0, z: 5, z2: 5 });
    expect(bounds.z2).toBe(6); // must be at least z+1
  });
});
