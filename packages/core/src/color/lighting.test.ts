import { describe, it, expect, beforeEach } from "vitest";
import {
  parseColor,
  shadeColor,
  shadeCubeFace,
  getCubeFaceLightDelta,
  computeShapeLighting,
  shadeWallFace,
} from "./lighting";
import type { CubeFace } from "../types";

describe("parseColor", () => {
  it("parses a 6-digit hex color", () => {
    const result = parseColor("#ff8800");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([255, 136, 0]);
    expect(result!.alpha).toBe(1);
  });

  it("parses a 6-digit hex color without hash", () => {
    const result = parseColor("aabbcc");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([170, 187, 204]);
  });

  it("parses a 3-digit hex color", () => {
    const result = parseColor("#f80");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([255, 136, 0]);
    expect(result!.alpha).toBe(1);
  });

  it("parses a 3-digit hex color without hash", () => {
    const result = parseColor("abc");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([170, 187, 204]);
  });

  it("returns null for empty string", () => {
    expect(parseColor("")).toBeNull();
  });

  it("returns null for null-like input", () => {
    // @ts-expect-error testing invalid input
    expect(parseColor(null)).toBeNull();
    // @ts-expect-error testing invalid input
    expect(parseColor(undefined)).toBeNull();
  });

  it("trims whitespace before parsing", () => {
    const result = parseColor("  #ff0000  ");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([255, 0, 0]);
  });

  it("caches parsed colors (returns same result for same input)", () => {
    const a = parseColor("#112233");
    const b = parseColor("#112233");
    expect(a).toBe(b);
  });

  it("parses black (#000000)", () => {
    const result = parseColor("#000000");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([0, 0, 0]);
  });

  it("parses white (#ffffff)", () => {
    const result = parseColor("#ffffff");
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual([255, 255, 255]);
  });
});

describe("shadeColor", () => {
  it("returns original color when delta is 0", () => {
    const result = shadeColor("#808080", 0);
    expect(result).toBe("rgb(128, 128, 128)");
  });

  it("applies positive delta", () => {
    const result = shadeColor("#808080", 20);
    expect(result).toBe("rgb(148, 148, 148)");
  });

  it("applies negative delta", () => {
    const result = shadeColor("#808080", -20);
    expect(result).toBe("rgb(108, 108, 108)");
  });

  it("clamps at 255 (no overflow)", () => {
    const result = shadeColor("#ffffff", 50);
    expect(result).toBe("rgb(255, 255, 255)");
  });

  it("clamps at 0 (no underflow)", () => {
    const result = shadeColor("#000000", -50);
    expect(result).toBe("rgb(0, 0, 0)");
  });

  it("uses default color (#cccccc) for unparseable input", () => {
    const result = shadeColor("", 0);
    // Default color is [204, 204, 204]
    expect(result).toBe("rgb(204, 204, 204)");
  });

  it("partially clamps channels independently", () => {
    // #f0100a = (240, 16, 10)
    const result = shadeColor("#f0100a", 20);
    // (260 => 255, 36, 30)
    expect(result).toBe("rgb(255, 36, 30)");
  });
});

describe("getCubeFaceLightDelta", () => {
  it("returns 0 for top face", () => {
    expect(getCubeFaceLightDelta("t")).toBe(0);
  });

  it("returns 0 for bottom face", () => {
    expect(getCubeFaceLightDelta("b")).toBe(0);
  });

  it("returns -15 for front-right face", () => {
    expect(getCubeFaceLightDelta("fr")).toBe(-15);
  });

  it("returns -25 for front-left face", () => {
    expect(getCubeFaceLightDelta("fl")).toBe(-25);
  });

  it("returns -40 for back-left face", () => {
    expect(getCubeFaceLightDelta("bl")).toBe(-40);
  });

  it("returns -30 for back-right face", () => {
    expect(getCubeFaceLightDelta("br")).toBe(-30);
  });

  it("returns 0 for unknown face", () => {
    expect(getCubeFaceLightDelta("unknown" as CubeFace)).toBe(0);
  });
});

describe("shadeCubeFace", () => {
  const baseColor = "#cccccc"; // 204, 204, 204

  it("top face leaves color unchanged", () => {
    expect(shadeCubeFace(baseColor, "t")).toBe("rgb(204, 204, 204)");
  });

  it("bottom face leaves color unchanged", () => {
    expect(shadeCubeFace(baseColor, "b")).toBe("rgb(204, 204, 204)");
  });

  it("front-right face darkens by 15", () => {
    expect(shadeCubeFace(baseColor, "fr")).toBe("rgb(189, 189, 189)");
  });

  it("front-left face darkens by 25", () => {
    expect(shadeCubeFace(baseColor, "fl")).toBe("rgb(179, 179, 179)");
  });

  it("back-left face darkens by 40", () => {
    expect(shadeCubeFace(baseColor, "bl")).toBe("rgb(164, 164, 164)");
  });

  it("back-right face darkens by 30", () => {
    expect(shadeCubeFace(baseColor, "br")).toBe("rgb(174, 174, 174)");
  });
});

describe("shadeWallFace", () => {
  it("inverts delta for side faces", () => {
    // fr has delta -15, shadeWallFace negates it → +15
    const result = shadeWallFace("#808080", "fr");
    expect(result).toBe("rgb(143, 143, 143)");
  });

  it("applies zero delta for top face", () => {
    const result = shadeWallFace("#808080", "t");
    expect(result).toBe("rgb(128, 128, 128)");
  });
});

describe("computeShapeLighting", () => {
  describe("ramp", () => {
    it("returns 1 surface definition (slope)", () => {
      const result = computeShapeLighting("ramp", 0, "#cccccc");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("slope");
    });

    it("returns a color string", () => {
      const result = computeShapeLighting("ramp", 0, "#cccccc");
      expect(result[0].color).toMatch(/^rgb/);
    });

    it("rotation affects brightness level", () => {
      const at0 = computeShapeLighting("ramp", 0, "#cccccc");
      const at180 = computeShapeLighting("ramp", 180, "#cccccc");
      // 0 degrees is 180 away from light source (180), difference=180 → level 4
      // 180 degrees is 0 away from light source, difference=0 → level 2 (no allowPeak for ramp)
      expect(at0.length).toBe(1);
      expect(at180.length).toBe(1);
      expect(at0[0].level).not.toBe(at180[0].level);
    });

    it("rotation 180 yields brightest (closest to light source at 180)", () => {
      const result = computeShapeLighting("ramp", 180, "#cccccc");
      expect(result[0].level).toBe(2); // diff=0, within 30
      expect(result[0].delta).toBe(8);
    });

    it("rotation 0 yields darkest (farthest from light source)", () => {
      const result = computeShapeLighting("ramp", 0, "#cccccc");
      expect(result[0].level).toBe(4); // diff=180, beyond 90
      expect(result[0].delta).toBe(-28);
    });
  });

  describe("wedge", () => {
    it("returns 2 surface definitions (primary, secondary)", () => {
      const result = computeShapeLighting("wedge", 0, "#cccccc");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("primary");
      expect(result[1].id).toBe("secondary");
    });

    it("secondary surface has 90-degree offset from primary", () => {
      const result = computeShapeLighting("wedge", 0, "#cccccc");
      const diff = Math.abs(result[0].angle - result[1].angle);
      expect(diff).toBe(90);
    });
  });

  describe("spike", () => {
    it("returns 2 surface definitions (primary, secondary)", () => {
      const result = computeShapeLighting("spike", 0, "#cccccc");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("primary");
      expect(result[1].id).toBe("secondary");
    });

    it("secondary surface has 270-degree base offset", () => {
      const result = computeShapeLighting("spike", 0, "#cccccc");
      // primary at 0 + 0 = 0, secondary at 0 + 270 = 270
      expect(result[1].angle).toBe(270);
    });
  });

  it("returns empty array for unknown shape", () => {
    // @ts-expect-error testing invalid shape type
    const result = computeShapeLighting("unknown", 0, "#cccccc");
    expect(result).toEqual([]);
  });

  it("normalizes negative rotation", () => {
    const pos = computeShapeLighting("ramp", 90, "#cccccc");
    const neg = computeShapeLighting("ramp", -270, "#cccccc");
    expect(pos[0].angle).toBe(neg[0].angle);
    expect(pos[0].level).toBe(neg[0].level);
  });

  it("normalizes rotation above 360", () => {
    const base = computeShapeLighting("ramp", 90, "#cccccc");
    const wrapped = computeShapeLighting("ramp", 450, "#cccccc");
    expect(base[0].angle).toBe(wrapped[0].angle);
  });
});
