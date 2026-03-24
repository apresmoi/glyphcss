import { describe, it, expect } from "vitest";
import { parseColor, shadeColor } from "./lighting";

/**
 * Extended lighting tests for parseColor.
 * parseColor tries hex parsing first, then falls back to a DOM probe
 * using getComputedStyle. In happy-dom, named colors may or may not resolve
 * depending on the environment's CSS support.
 */

describe("parseColor — hex and rgb parsing", () => {
  it("parses 6-digit hex", () => {
    const result = parseColor("#112233");
    expect(result).toEqual({ rgb: [17, 34, 51], alpha: 1 });
  });

  it("parses 3-digit hex", () => {
    const result = parseColor("#abc");
    expect(result).toEqual({ rgb: [170, 187, 204], alpha: 1 });
  });

  it("returns null for invalid CSS color string", () => {
    expect(parseColor("notacolor12345")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseColor("")).toBeNull();
  });

  it("caches parsed colors", () => {
    const a = parseColor("#112233");
    const b = parseColor("#112233");
    expect(a).toBe(b);
  });

  it("shadeColor with unresolvable color falls back to default rgb(204,204,204)", () => {
    // Use a string that can't be parsed as hex and won't resolve via DOM
    const result = shadeColor("notacolor12345", 10);
    // default is rgb(204, 204, 204), with delta +10 = rgb(214, 214, 214)
    expect(result).toBe("rgb(214, 214, 214)");
  });

  it("parses rgb() format directly", () => {
    const result = parseColor("rgb(100, 200, 50)");
    expect(result).toEqual({ rgb: [100, 200, 50], alpha: 1 });
  });

  it("parses rgba() format", () => {
    const result = parseColor("rgba(10, 20, 30, 0.5)");
    expect(result).toEqual({ rgb: [10, 20, 30], alpha: 0.5 });
  });

  it("shadeColor applies delta correctly to hex color", () => {
    // #808080 = rgb(128, 128, 128), delta -15 = rgb(113, 113, 113)
    expect(shadeColor("#808080", -15)).toBe("rgb(113, 113, 113)");
  });

  it("shadeColor clamps at 0", () => {
    // #000000 = rgb(0,0,0), delta -50 should clamp to 0
    expect(shadeColor("#000000", -50)).toBe("rgb(0, 0, 0)");
  });

  it("shadeColor clamps at 255", () => {
    // #ffffff = rgb(255,255,255), delta +50 should clamp to 255
    expect(shadeColor("#ffffff", 50)).toBe("rgb(255, 255, 255)");
  });
});
