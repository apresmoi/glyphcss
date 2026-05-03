/**
 * Primary tests for the span-aware coverage helpers in core.
 * These helpers were previously duplicated across the React, Vue, and html
 * packages with z+1 (non-z2-aware) probes; the canonical implementation now
 * lives in core and probes at `z2` (top) and `z - 1` (bottom).
 */
import { describe, it, expect } from "vitest";
import { isCovered, isBottomOccluded, shouldRenderBottom } from "./coverage";
import { buildSceneContext } from "./context";
import type { GridContext, Voxel, WallsMask } from "../types";

function makeContext(voxels: Voxel[], wallsOverride?: Partial<WallsMask>): GridContext {
  const allFalseWalls: WallsMask = { t: false, b: false, bl: false, br: false, fl: false, fr: false };
  const walls = wallsOverride ? { ...allFalseWalls, ...wallsOverride } : allFalseWalls;
  const result = buildSceneContext({
    grid: voxels,
    context: { walls },
  });
  return { ...result.context, walls };
}

describe("isCovered", () => {
  it("span-aware probe at z2 instead of z+1", () => {
    const tall: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const ctx = makeContext([tall, { x: 0, y: 0, z: 3 }]);
    expect(isCovered(tall, ctx)).toBe(true);
  });

  it("returns false for an isolated voxel", () => {
    const v: Voxel = { x: 0, y: 0, z: 0 };
    const ctx = makeContext([v]);
    expect(isCovered(v, ctx)).toBe(false);
  });

  it("returns true when a voxel sits at z + 1 for a single-layer voxel", () => {
    const base: Voxel = { x: 0, y: 0, z: 0 };
    const above: Voxel = { x: 0, y: 0, z: 1 };
    const ctx = makeContext([base, above]);
    expect(isCovered(base, ctx)).toBe(true);
  });

  it("does not consider a neighbor inside the voxel's own span as covering", () => {
    // For a tall voxel, anything at z+1 is *inside* the voxel itself; only
    // a neighbor at z2 should cover it.
    const tall: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const ctx = makeContext([tall]); // z=1 and z=2 cells are populated by the tall voxel itself in the lookup
    expect(isCovered(tall, ctx)).toBe(false);
  });

  it("any-cell semantics: returns true when at least one cell above the footprint is occupied", () => {
    const wide: Voxel = { x: 0, y: 0, z: 0, x2: 2, y2: 2 };
    const ctx = makeContext([wide, { x: 1, y: 1, z: 1 }]); // only one of 4 cells covered
    expect(isCovered(wide, ctx)).toBe(true);
  });
});

describe("isBottomOccluded", () => {
  it("returns false when z is 0 (no layer below)", () => {
    const v: Voxel = { x: 0, y: 0, z: 0 };
    const ctx = makeContext([v]);
    expect(isBottomOccluded(v, ctx)).toBe(false);
  });

  it("returns true when every cell at z - 1 is occupied", () => {
    const v: Voxel = { x: 0, y: 0, z: 1, x2: 2, y2: 2 };
    const ctx = makeContext([
      v,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ]);
    expect(isBottomOccluded(v, ctx)).toBe(true);
  });

  it("returns false when any cell at z - 1 is missing", () => {
    const v: Voxel = { x: 0, y: 0, z: 1, x2: 2, y2: 2 };
    const ctx = makeContext([
      v,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      // missing (1, 1, 0)
    ]);
    expect(isBottomOccluded(v, ctx)).toBe(false);
  });

  it("for a tall voxel probes z - 1 (the actual base of the voxel), not z2 - 1", () => {
    const tall: Voxel = { x: 0, y: 0, z: 2, z2: 5 };
    const below: Voxel = { x: 0, y: 0, z: 1 };
    const ctx = makeContext([tall, below]);
    expect(isBottomOccluded(tall, ctx)).toBe(true);
  });
});

describe("shouldRenderBottom", () => {
  it("false when z-1 is fully covered, true otherwise", () => {
    const v: Voxel = { x: 0, y: 0, z: 1 };
    const covered = makeContext([v, { x: 0, y: 0, z: 0 }]);
    const open = makeContext([v]);
    expect(shouldRenderBottom(v, covered)).toBe(false);
    expect(shouldRenderBottom(v, open)).toBe(true);
  });

  it("false when the wall mask hides the bottom face", () => {
    const v: Voxel = { x: 0, y: 0, z: 0 };
    const ctx = makeContext([v], { b: true });
    expect(shouldRenderBottom(v, ctx)).toBe(false);
  });
});
