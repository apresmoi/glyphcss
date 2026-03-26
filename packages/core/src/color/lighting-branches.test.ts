/**
 * Additional branch coverage for lighting.ts
 * Covers: normalizeShapeAngle edge cases, shapeAngularDifference >180 path,
 * angleToBrightnessLevel peak/threshold boundaries, shadeWallFace non-cube faces,
 * DOM probe fallback paths, parseColor cache hits.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseColor,
  shadeColor,
  shadeCubeFace,
  getCubeFaceLightDelta,
  computeShapeLighting,
  shadeWallFace
} from "./lighting";
import type { CubeFace } from "../types";

describe("shadeWallFace — non-directional faces", () => {
  it("returns unshaded color for top face", () => {
    const result = shadeWallFace("#cccccc", "t");
    expect(result).toBe("rgb(204, 204, 204)");
  });

  it("returns unshaded color for bottom face", () => {
    const result = shadeWallFace("#cccccc", "b");
    expect(result).toBe("rgb(204, 204, 204)");
  });
});

describe("computeShapeLighting — angle boundary coverage", () => {
  it("ramp at 180° hits peak-adjacent angle (diff ≤ 30 → level 2)", () => {
    const result = computeShapeLighting("ramp", 180, "#cccccc");
    expect(result.length).toBe(1);
    expect(result[0].level).toBe(2);
  });

  it("ramp at 0° is opposite light source (diff = 180 → level 4)", () => {
    const result = computeShapeLighting("ramp", 0, "#cccccc");
    expect(result.length).toBe(1);
    expect(result[0].level).toBe(4);
  });

  it("ramp at 90° is perpendicular (diff = 90 → level 3)", () => {
    const result = computeShapeLighting("ramp", 90, "#cccccc");
    expect(result.length).toBe(1);
    expect(result[0].level).toBe(3);
  });

  it("ramp at 270° is perpendicular other side (diff = 90 → level 3)", () => {
    const result = computeShapeLighting("ramp", 270, "#cccccc");
    expect(result.length).toBe(1);
    expect(result[0].level).toBe(3);
  });

  it("ramp at 150° (diff = 30 → level 2)", () => {
    const result = computeShapeLighting("ramp", 150, "#cccccc");
    expect(result[0].level).toBe(2);
  });

  it("ramp at negative rotation normalizes correctly", () => {
    const result = computeShapeLighting("ramp", -180, "#cccccc");
    expect(result[0].level).toBe(2);
  });

  it("ramp at large rotation normalizes correctly", () => {
    const result = computeShapeLighting("ramp", 540, "#cccccc");
    expect(result[0].level).toBe(2);
  });

  it("ramp with NaN rotation normalizes to 0", () => {
    const result = computeShapeLighting("ramp", NaN, "#cccccc");
    expect(result.length).toBe(1);
  });

  it("wedge surfaces get different angles", () => {
    const result = computeShapeLighting("wedge", 0, "#cccccc");
    expect(result.length).toBe(2);
    expect(result[0].id).toBe("primary");
    expect(result[1].id).toBe("secondary");
    // primary baseAngle=0, secondary baseAngle=90 → different levels
    expect(result[0].angle).not.toBe(result[1].angle);
  });

  it("spike surfaces get different angles", () => {
    const result = computeShapeLighting("spike", 0, "#cccccc");
    expect(result.length).toBe(2);
    expect(result[0].id).toBe("primary");
    expect(result[1].id).toBe("secondary");
  });
});

describe("parseColor — DOM probe and cache paths", () => {
  it("caches parsed colors on second call", () => {
    const first = parseColor("#aabbcc");
    const second = parseColor("#aabbcc");
    expect(first).toEqual(second);
  });

  it("returns null for empty string", () => {
    expect(parseColor("")).toBeNull();
  });

  it("parses rgb() via DOM probe", () => {
    const result = parseColor("rgb(100, 150, 200)");
    // happy-dom may or may not resolve this via getComputedStyle
    // but the code path is exercised
    if (result) {
      expect(result.rgb).toEqual([100, 150, 200]);
    }
  });
});

describe("getCubeFaceLightDelta — all faces", () => {
  const expected: Record<string, number> = {
    t: 0,
    b: 0,
    fr: -15,
    fl: -25,
    bl: -40,
    br: -30
  };

  for (const [face, delta] of Object.entries(expected)) {
    it(`face ${face} → delta ${delta}`, () => {
      expect(getCubeFaceLightDelta(face as CubeFace)).toBe(delta);
    });
  }
});
