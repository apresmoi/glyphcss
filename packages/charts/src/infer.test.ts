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

  it("infers time for a column of plain calendar-valid ISO date strings (the CLI/JSON path, no explicit scales.x.type needed)", () => {
    expect(inferGlyphChartScaleType(["2011-01-01", "2012-01-01", "2013-01-01"])).toBe("time");
  });

  it("infers time for ISO strings carrying a time-of-day/offset component too", () => {
    expect(inferGlyphChartScaleType(["2026-01-01T00:00:00Z", "2026-01-01T02:00:00+01:00"])).toBe("time");
  });

  it("a mixed column (some ISO dates, some plain strings) stays band — only a homogeneous column has one honest type", () => {
    expect(inferGlyphChartScaleType(["2011-01-01", "not-a-date", "2013-01-01"])).toBe("band");
  });

  it("plain non-date strings still infer band, unaffected", () => {
    expect(inferGlyphChartScaleType(["Chrome", "Safari", "Firefox"])).toBe("band");
  });
});
