/**
 * Tests for the core `computeShapeStyle` helper. The function returns a
 * Record<string, string> of CSS custom-property overrides — empty for
 * 1×1×1 voxels, populated with `--voxcss-layer-elevation` and shape-specific
 * angle/offset variables when the voxel spans multiple cells in any axis.
 */
import { describe, it, expect } from "vitest";
import { computeShapeStyle } from "./shapeStyle";
import { buildSceneContext } from "../scene/context";
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

describe("computeShapeStyle", () => {
  it("returns empty object for 1×1×1 voxels", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, shape: "ramp" };
    const ctx = makeContext([v]);
    expect(computeShapeStyle(v, ctx)).toEqual({});
  });

  it("returns empty object for 1×1×1 cubes (no shape field)", () => {
    const v: Voxel = { x: 0, y: 0, z: 0 };
    const ctx = makeContext([v]);
    expect(computeShapeStyle(v, ctx)).toEqual({});
  });

  it("dynamic angle for ramp with y2 span", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, y2: 3, shape: "ramp" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    // angle = atan(elevation / (3 × tileSize)) = atan(50 / 150) ≈ 18.435°
    expect(style["--voxcss-ramp-angle"]).toMatch(/^18\.43/);
    expect(style["--voxcss-ramp-offset"]).toMatch(/^[\d.]+px$/);
  });

  it("dynamic elevation for z2 span on a ramp", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, z2: 3, shape: "ramp" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    expect(style["--voxcss-layer-elevation"]).toBe("150px"); // 3 × 50
    // ramp also gets angle/offset because spanZ > 1
    expect(style["--voxcss-ramp-angle"]).toBeDefined();
    expect(style["--voxcss-ramp-offset"]).toBeDefined();
  });

  it("z2 cube: only elevation is overridden, no shape-specific angle vars", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, z2: 3, shape: "cube" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    expect(style["--voxcss-layer-elevation"]).toBe("150px");
    expect(style["--voxcss-cube-angle"]).toBeUndefined();
    expect(style["--voxcss-ramp-angle"]).toBeUndefined();
  });

  it("z2 cube without explicit shape field: still gets elevation override", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, z2: 3 };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    expect(style["--voxcss-layer-elevation"]).toBe("150px");
  });

  it("wedge with x2 and y2 spans sets both primary and secondary slopes", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, x2: 2, y2: 3, shape: "wedge" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    expect(style["--voxcss-wedge-angle"]).toBeDefined();
    expect(style["--voxcss-wedge-offset"]).toBeDefined();
    expect(style["--voxcss-wedge-secondary-angle"]).toBeDefined();
    expect(style["--voxcss-wedge-bottom-offset"]).toBeDefined();
  });

  it("spike with z2 sets both primary and secondary slope vars (driven by spanZ)", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, z2: 2, shape: "spike" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    expect(style["--voxcss-layer-elevation"]).toBe("100px"); // 2 × 50
    expect(style["--voxcss-spike-angle"]).toBeDefined();
    expect(style["--voxcss-spike-offset"]).toBeDefined();
    expect(style["--voxcss-spike-secondary-angle"]).toBeDefined();
    expect(style["--voxcss-spike-bottom-offset"]).toBeDefined();
  });

  it("ramp with x2 only (and y2=1, z2=1) does not get angle vars (ramp slope is along Y)", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, x2: 3, shape: "ramp" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    // Ramp angle is keyed on spanY/spanZ; x2 alone shouldn't introduce slope vars.
    expect(style["--voxcss-ramp-angle"]).toBeUndefined();
    expect(style["--voxcss-ramp-offset"]).toBeUndefined();
    // Nor should it set the elevation override (spanZ === 1).
    expect(style["--voxcss-layer-elevation"]).toBeUndefined();
    // The map is "empty" with respect to defined keys — but it's still {} since
    // no branch produced output.
    expect(style).toEqual({});
  });

  it("uses dimetric layerElevation (25) when projection is dimetric", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, z2: 4, shape: "ramp" };
    const result = buildSceneContext({
      grid: [v],
      context: { projection: "dimetric" },
    });
    const ctx = result.context;
    const style = computeShapeStyle(v, ctx);
    // 4 × 25 = 100
    expect(style["--voxcss-layer-elevation"]).toBe("100px");
  });

  it("rounds angle to 3 decimals and offset to 2 decimals", () => {
    const v: Voxel = { x: 0, y: 0, z: 0, y2: 3, shape: "ramp" };
    const ctx = makeContext([v]);
    const style = computeShapeStyle(v, ctx);
    // angle "18.435deg" — at most 3 decimal digits before "deg"
    expect(style["--voxcss-ramp-angle"]).toMatch(/^-?\d+(\.\d{1,3})?deg$/);
    // offset "Xpx" — at most 2 decimal digits before "px"
    expect(style["--voxcss-ramp-offset"]).toMatch(/^-?\d+(\.\d{1,2})?px$/);
  });
});
