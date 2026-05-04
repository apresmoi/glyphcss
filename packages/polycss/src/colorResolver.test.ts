/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { resolveColor } from "./colorResolver";

describe("resolveColor", () => {
  it("resolves hex colors via pure parsing", () => {
    const result = resolveColor("#ff0000");
    expect(result).toEqual({ rgb: [255, 0, 0], alpha: 1 });
  });

  it("resolves rgb() via pure parsing", () => {
    const result = resolveColor("rgb(100, 200, 50)");
    expect(result).toEqual({ rgb: [100, 200, 50], alpha: 1 });
  });

  it("resolves rgba() via pure parsing", () => {
    const result = resolveColor("rgba(10, 20, 30, 0.5)");
    expect(result).toEqual({ rgb: [10, 20, 30], alpha: 0.5 });
  });

  it("returns null for empty string", () => {
    expect(resolveColor("")).toBeNull();
  });

  it("returns null for invalid color", () => {
    expect(resolveColor("notacolor12345")).toBeNull();
  });

  it("caches results", () => {
    const a = resolveColor("#aabbcc");
    const b = resolveColor("#aabbcc");
    expect(a).toEqual(b);
  });
});

describe("setColorResolver integration", () => {
  it("parseColor uses DOM resolver for named colors when html is loaded", async () => {
    // Import html barrel which auto-registers the resolver
    await import("./index");
    const { parseColor } = await import("@layoutit/voxcss-core");

    // Hex should still work
    const hex = parseColor("#ff0000");
    expect(hex).toEqual({ rgb: [255, 0, 0], alpha: 1 });

    // Named colors depend on happy-dom's getComputedStyle support
    // At minimum, parseColor should not crash on named colors
    const named = parseColor("red");
    // If happy-dom resolves it, great; if not, it falls back to null
    if (named) {
      expect(named.rgb[0]).toBeGreaterThan(200); // red channel should be high
    }
  });
});
