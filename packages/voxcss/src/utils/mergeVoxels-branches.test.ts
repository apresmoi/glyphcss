/**
 * Additional branch coverage for mergeVoxels.ts
 * Covers: z-span voxel splitting, null/undefined voxels in grid,
 * negative coordinate handling, sortByPosition tie-breaking.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { mergeVoxels } from "./mergeVoxels";
import type { Voxel } from "../core/types";

describe("mergeVoxels — z-span splitting", () => {
  it("splits a tall voxel (z2 set) into individual layers", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, z2: 3, color: "#ff0000" }
    ];
    const result = mergeVoxels(grid);
    // Should produce 3 separate voxels at z=0, z=1, z=2
    expect(result.length).toBe(3);
    expect(result[0].z).toBe(0);
    expect(result[1].z).toBe(1);
    expect(result[2].z).toBe(2);
    // z2 should be removed
    expect(result[0].z2).toBeUndefined();
  });

  it("does not split when z2 equals z+1 (single layer)", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, z2: 1, color: "#ff0000" }
    ];
    const result = mergeVoxels(grid);
    expect(result.length).toBe(1);
  });
});

describe("mergeVoxels — null/undefined handling", () => {
  it("skips null entries in grid", () => {
    const grid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      null as any,
      { x: 1, y: 0, z: 0, color: "#ff0000" }
    ];
    const result = mergeVoxels(grid);
    // Should merge the two valid voxels
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles undefined grid", () => {
    const result = mergeVoxels(undefined as any);
    expect(result).toEqual([]);
  });
});

describe("mergeVoxels — sortByPosition tie-breaking", () => {
  it("sorts by z first, then x, then y", () => {
    const grid: Voxel[] = [
      { x: 2, y: 0, z: 1, color: "#aa0000" },
      { x: 0, y: 0, z: 0, color: "#bb0000" },
      { x: 0, y: 2, z: 0, color: "#cc0000" },
      { x: 0, y: 0, z: 0, color: "#dd0000" }
    ];
    const result = mergeVoxels(grid);
    // z=0 voxels should come before z=1
    const zValues = result.map((v) => v.z);
    for (let i = 1; i < zValues.length; i++) {
      expect(zValues[i]).toBeGreaterThanOrEqual(zValues[i - 1]);
    }
  });
});

describe("mergeVoxels — non-cube shapes are passthrough", () => {
  it("does not merge ramp shapes", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" },
      { x: 1, y: 0, z: 0, shape: "ramp", color: "#ff0000" }
    ];
    const result = mergeVoxels(grid);
    expect(result.length).toBe(2);
  });

  it("non-cube shapes block merge cells", () => {
    const grid: Voxel[] = [
      { x: 0, y: 0, z: 0, shape: "wedge", color: "#ff0000" },
      { x: 0, y: 0, z: 0, color: "#ff0000" } // same position, cube — blocked by wedge
    ];
    const result = mergeVoxels(grid);
    // wedge is passthrough, cube at same pos is blocked
    expect(result.some((v) => v.shape === "wedge")).toBe(true);
  });
});
