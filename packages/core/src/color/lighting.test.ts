import { describe, it, expect } from "vitest";
import { parseColor, shadeColor, computeShapeLighting } from "./lighting";

describe("parseColor", () => {
  it("parses 6-digit hex", () => {
    const result = parseColor("#112233");
    expect(result).toEqual({ rgb: [17, 34, 51], alpha: 1 });
  });

  it("parses 3-digit hex", () => {
    const result = parseColor("#abc");
    expect(result).toEqual({ rgb: [170, 187, 204], alpha: 1 });
  });

  it("parses rgb()", () => {
    const result = parseColor("rgb(100, 200, 50)");
    expect(result).toEqual({ rgb: [100, 200, 50], alpha: 1 });
  });

  it("parses rgba()", () => {
    const result = parseColor("rgba(10, 20, 30, 0.5)");
    expect(result).toEqual({ rgb: [10, 20, 30], alpha: 0.5 });
  });

  it("returns null for empty string", () => {
    expect(parseColor("")).toBeNull();
  });

  it("returns null for unparseable strings", () => {
    expect(parseColor("notacolor12345")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = parseColor("  #ff0000  ");
    expect(result?.rgb).toEqual([255, 0, 0]);
  });

  it("caches identical inputs", () => {
    const a = parseColor("#445566");
    const b = parseColor("#445566");
    expect(a).toBe(b);
  });
});

describe("shadeColor", () => {
  it("returns original color when delta is 0", () => {
    expect(shadeColor("#808080", 0)).toBe("rgb(128, 128, 128)");
  });

  it("applies positive delta", () => {
    expect(shadeColor("#808080", 20)).toBe("rgb(148, 148, 148)");
  });

  it("applies negative delta", () => {
    expect(shadeColor("#808080", -20)).toBe("rgb(108, 108, 108)");
  });

  it("clamps at 255", () => {
    expect(shadeColor("#ffffff", 50)).toBe("rgb(255, 255, 255)");
  });

  it("clamps at 0", () => {
    expect(shadeColor("#000000", -50)).toBe("rgb(0, 0, 0)");
  });

  it("falls back to default gray for unparseable input", () => {
    // default = rgb(204,204,204), delta +10
    expect(shadeColor("notacolor12345", 10)).toBe("rgb(214, 214, 214)");
  });
});

describe("computeShapeLighting", () => {
  it("face pointing toward light is fully lit (lambert = 1)", () => {
    // Light shines toward [0,0,-1] (down). A face whose normal is [0,0,1] (up)
    // catches the light fully. With ambient intensity 0, only the
    // directional contribution applies.
    const result = computeShapeLighting(
      [0, 0, 1],
      "#808080",
      { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
      { color: "#ffffff", intensity: 0 },
    );
    expect(result).toBe("rgb(128, 128, 128)");
  });

  it("face pointing away from light gets ambient only", () => {
    const result = computeShapeLighting(
      [0, 0, -1],
      "#808080",
      { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
      { color: "#ffffff", intensity: 0.5 },
    );
    // ambient * base = 0.5 * 128 = 64
    expect(result).toBe("rgb(64, 64, 64)");
  });

  it("perpendicular face gets ambient only", () => {
    const result = computeShapeLighting(
      [1, 0, 0],
      "#808080",
      { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
      { color: "#ffffff", intensity: 0.4 },
    );
    // perpendicular: lambert = 0; only ambient applies → 0.4 * 128 = 51
    expect(result).toBe("rgb(51, 51, 51)");
  });

  it("uses default lights when args are omitted", () => {
    // Defaults: directional intensity 1 + ambient intensity 0.4. Face up gets
    // full light from a top-down default direction.
    // tint = 0.4 + 1*1 = 1.4; channel = 128 * 1.4 = 179.2 → 179.
    const result = computeShapeLighting([0, 0, 1], "#808080");
    expect(result).toBe("rgb(179, 179, 179)");
  });

  it("directional intensity scales the lit contribution independently of ambient", () => {
    const half = computeShapeLighting(
      [0, 0, 1],
      "#808080",
      { direction: [0, 0, -1], color: "#ffffff", intensity: 0.5 },
      { color: "#ffffff", intensity: 0 },
    );
    // tint = 0 + 0.5*1 = 0.5 → 128 * 0.5 = 64
    expect(half).toBe("rgb(64, 64, 64)");
  });

  it("returns shaded color string", () => {
    const result = computeShapeLighting([0, 1, 0], "#ff0000");
    expect(result).toMatch(/^rgb\(/);
  });

  it("normalizes the input normal", () => {
    // Same direction, different magnitude — same shading.
    const a = computeShapeLighting([0, 0, 1], "#808080");
    const b = computeShapeLighting([0, 0, 5], "#808080");
    expect(a).toBe(b);
  });

  it("handles zero-length normal gracefully", () => {
    const result = computeShapeLighting([0, 0, 0], "#808080");
    // Degenerate normal → lambert = 0 → ambient-only
    expect(result).toMatch(/^rgb\(/);
  });
});
