/**
 * Branch-coverage tests for `computeVisibleFaces` covering the z2-aware
 * (multi-cell-tall) cases introduced in Phase 1a of the Z2 refactor:
 *
 * - Top face probes at `z2`, not `z + 1`, so a neighbor sitting *inside* the
 *   span doesn't self-occlude.
 * - Side faces require *every cell of the side strip* (Policy A, §2.5) —
 *   every (xi, yi) along the side AND every z' ∈ [z, z2) — to be occupied.
 * - Bottom face probes at `z - 1`, regardless of z2.
 */
import { describe, it, expect } from "vitest";
import { computeVisibleFaces } from "./visibility";
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

describe("computeVisibleFaces — z2 branches", () => {
  it("z2 cube: top face hidden only when neighbor sits at z2, not at z+1", () => {
    const tall: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const above: Voxel = { x: 0, y: 0, z: 3 };
    const ctx = makeContext([tall, above]);
    expect(computeVisibleFaces(tall, ctx)).not.toContain("t");

    // sanity: a neighbor at z+1 (inside the span) must NOT count as occluding;
    // it would just be a self-overlap.
    const innerOnly = makeContext([tall, { x: 0, y: 0, z: 1 }]);
    expect(computeVisibleFaces(tall, innerOnly)).toContain("t");
  });

  it("z2 cube: side face hidden only when every cell in the side strip is occupied", () => {
    const tall: Voxel = { x: 0, y: 0, z: 0, x2: 1, y2: 1, z2: 3 };
    // full neighbor strip (1 cell wide × 3 layers tall) at y=1
    const full = makeContext([
      tall,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 1, z: 2 },
    ]);
    expect(computeVisibleFaces(tall, full)).not.toContain("fr");

    // missing one layer of the strip → side renders
    const partial = makeContext([
      tall,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 }, // missing z=2
    ]);
    expect(computeVisibleFaces(tall, partial)).toContain("fr");
  });

  it("z2 cube: bottom face hidden when z-1 has a covering voxel", () => {
    const tall: Voxel = { x: 0, y: 0, z: 1, z2: 3 };
    const below: Voxel = { x: 0, y: 0, z: 0 };
    const ctx = makeContext([tall, below]);
    expect(computeVisibleFaces(tall, ctx)).not.toContain("b");
  });

  it("z2 + x2 cube: side strip requires all (yi, zi) cells occupied along Y face", () => {
    // 2x1x2 voxel: footprint covers x ∈ [0, 2), y = 0; height z ∈ [0, 2).
    const tall: Voxel = { x: 0, y: 0, z: 0, x2: 2, y2: 1, z2: 2 };
    // Full strip at y=1: 2 columns (x=0,1) × 2 layers (z=0,1) = 4 cells.
    const full = makeContext([
      tall,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
    ]);
    expect(computeVisibleFaces(tall, full)).not.toContain("fr");

    // Drop one cell — side renders.
    const partial = makeContext([
      tall,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 0 },
      // missing (1, 1, 1)
    ]);
    expect(computeVisibleFaces(tall, partial)).toContain("fr");
  });

  it("z2 cube: top face on multi-cell footprint hidden when every cell at z2 is covered", () => {
    const tall: Voxel = { x: 0, y: 0, z: 0, x2: 2, y2: 2, z2: 3 };
    const full = makeContext([
      tall,
      { x: 0, y: 0, z: 3 },
      { x: 0, y: 1, z: 3 },
      { x: 1, y: 0, z: 3 },
      { x: 1, y: 1, z: 3 },
    ]);
    expect(computeVisibleFaces(tall, full)).not.toContain("t");

    // Missing one cell at z=3 → top renders.
    const partial = makeContext([
      tall,
      { x: 0, y: 0, z: 3 },
      { x: 0, y: 1, z: 3 },
      { x: 1, y: 0, z: 3 },
      // missing (1, 1, 3)
    ]);
    expect(computeVisibleFaces(tall, partial)).toContain("t");
  });
});
