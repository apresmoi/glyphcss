import { describe, expect, it } from "vitest";
import { inferGlyphChartScaleType } from "./infer";

describe("inferGlyphChartScaleType", () => {
  it("infers time for Date values", () => {
    expect(inferGlyphChartScaleType([new Date(), new Date()])).toBe("time");
  });
  it("infers band for string values", () => {
    expect(inferGlyphChartScaleType(["a", "b"])).toBe("band");
  });
  it("infers linear for number values", () => {
    expect(inferGlyphChartScaleType([1, 2, 3])).toBe("linear");
  });
  it("skips leading null/undefined to find the first real value", () => {
    expect(inferGlyphChartScaleType([null, undefined, "x"])).toBe("band");
  });
  it("falls back to linear for an all-nullish channel", () => {
    expect(inferGlyphChartScaleType([null, undefined])).toBe("linear");
  });
});
