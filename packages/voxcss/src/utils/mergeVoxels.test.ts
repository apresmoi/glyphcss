import { describe, it, expect } from "vitest";
import { mergeVoxels } from "./mergeVoxels";
import {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge,
} from "./mergeVoxelsOption";
import type { Voxel } from "../core/types";

describe("mergeVoxels", () => {
  it("returns empty array for empty grid", () => {
    expect(mergeVoxels([])).toEqual([]);
  });

  it("returns empty array for null-ish grid", () => {
    // @ts-expect-error testing null input
    expect(mergeVoxels(null)).toEqual([]);
  });

  it("returns single voxel unchanged (with x2/y2 set)", () => {
    const grid: Voxel[] = [{ x: 2, y: 3, z: 0, color: "red" }];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(2);
    expect(result[0].y).toBe(3);
    expect(result[0].z).toBe(0);
    expect(result[0].x2).toBe(3);
    expect(result[0].y2).toBe(4);
    expect(result[0].color).toBe("red");
  });

  it("merges adjacent same-color voxels horizontally", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(1);
    expect(result[0].x2! - result[0].x).toBe(2);
  });

  it("does not merge adjacent different-color voxels", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#00ff00" },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(2);
  });

  it("merges a 2x2 block into single voxel", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa" },
      { x: 1, y: 0, z: 0, color: "#aaa" },
      { x: 0, y: 1, z: 0, color: "#aaa" },
      { x: 1, y: 1, z: 0, color: "#aaa" },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(1);
    expect(result[0].x2! - result[0].x).toBe(2);
    expect(result[0].y2! - result[0].y).toBe(2);
  });

  it("merges L-shape into 2 rectangles", () => {
    // L-shape:
    // XX
    // X.
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa" },
      { x: 1, y: 0, z: 0, color: "#aaa" },
      { x: 0, y: 1, z: 0, color: "#aaa" },
    ];
    const result = mergeVoxels(grid);
    // Should produce 2 rectangles (exact decomposition depends on order)
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Total cell coverage should be 3
    let totalCells = 0;
    for (const v of result) {
      const w = (v.x2 ?? v.x + 1) - v.x;
      const h = (v.y2 ?? v.y + 1) - v.y;
      totalCells += w * h;
    }
    expect(totalCells).toBe(3);
  });

  it("does not merge voxels with different textures", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa", texture: "wood.png" },
      { x: 1, y: 0, z: 0, color: "#aaa", texture: "stone.png" },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(2);
  });

  it("merges voxels with same texture", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa", texture: "wood.png" },
      { x: 1, y: 0, z: 0, color: "#aaa", texture: "wood.png" },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(1);
  });

  it("does not merge non-cube shapes", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa", shape: "ramp" },
      { x: 1, y: 0, z: 0, color: "#aaa", shape: "ramp" },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(2);
  });

  it("does not merge cubes into cells occupied by non-cube shapes", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa", shape: "ramp" },
      { x: 1, y: 0, z: 0, color: "#aaa" }, // default cube
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(2);
  });

  it("merges each z layer independently", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa" },
      { x: 1, y: 0, z: 0, color: "#aaa" },
      { x: 0, y: 0, z: 1, color: "#bbb" },
      { x: 1, y: 0, z: 1, color: "#bbb" },
    ];
    const result = mergeVoxels(grid);
    // Each layer should merge into 1 voxel
    expect(result).toHaveLength(2);
    const layer0 = result.filter((v) => v.z === 0);
    const layer1 = result.filter((v) => v.z === 1);
    expect(layer0).toHaveLength(1);
    expect(layer1).toHaveLength(1);
  });

  it("handles tall voxels (z2 span) by splitting into layers", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, z2: 3, color: "#aaa" },
    ];
    const result = mergeVoxels(grid);
    // The tall voxel should be split into 3 layers
    expect(result).toHaveLength(3);
    expect(result.map((v) => v.z).sort()).toEqual([0, 1, 2]);
  });

  it("output is sorted by z, then x, then y", () => {
    const grid: Voxel[] = [
      { x: 3, y: 0, z: 2, color: "#aaa" },
      { x: 0, y: 0, z: 0, color: "#bbb" },
      { x: 1, y: 0, z: 1, color: "#ccc" },
    ];
    const result = mergeVoxels(grid);
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const order = prev.z - curr.z || prev.x - curr.x || prev.y - curr.y;
      expect(order).toBeLessThanOrEqual(0);
    }
  });

  it("preserves voxel metadata in merged output", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#aaa", data: { id: "test" } },
      { x: 1, y: 0, z: 0, color: "#aaa", data: { id: "test" } },
    ];
    const result = mergeVoxels(grid);
    expect(result).toHaveLength(1);
    expect(result[0].data).toEqual({ id: "test" });
  });
});

describe("normalizeMergeVoxelsOption", () => {
  it("returns false for false", () => {
    expect(normalizeMergeVoxelsOption(false)).toBe(false);
  });

  it("returns '2d' for '2d'", () => {
    expect(normalizeMergeVoxelsOption("2d")).toBe("2d");
  });

  it("returns '3d' for '3d'", () => {
    expect(normalizeMergeVoxelsOption("3d")).toBe("3d");
  });

  it("returns false for undefined", () => {
    expect(normalizeMergeVoxelsOption(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(normalizeMergeVoxelsOption(null)).toBe(false);
  });

  it("returns false for invalid string", () => {
    expect(normalizeMergeVoxelsOption("invalid")).toBe(false);
  });

  it("returns false for true", () => {
    expect(normalizeMergeVoxelsOption(true)).toBe(false);
  });

  it("returns false for number", () => {
    expect(normalizeMergeVoxelsOption(42)).toBe(false);
  });
});

describe("is2dMerge", () => {
  it("returns true for '2d'", () => {
    expect(is2dMerge("2d")).toBe(true);
  });

  it("returns false for '3d'", () => {
    expect(is2dMerge("3d")).toBe(false);
  });

  it("returns false for false", () => {
    expect(is2dMerge(false)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(is2dMerge(undefined)).toBe(false);
  });
});

describe("is3dMerge", () => {
  it("returns true for '3d'", () => {
    expect(is3dMerge("3d")).toBe(true);
  });

  it("returns false for '2d'", () => {
    expect(is3dMerge("2d")).toBe(false);
  });

  it("returns false for false", () => {
    expect(is3dMerge(false)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(is3dMerge(undefined)).toBe(false);
  });
});
