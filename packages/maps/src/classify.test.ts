import { describe, expect, it } from "vitest";
import {
  classifyGlyphMapField,
  glyphMapBreaks,
  glyphMapEqualInterval,
  glyphMapLog,
  glyphMapQuantile,
  GlyphMapClassifiers,
} from "./classify";
import type { GlyphMapField } from "./types";

function fieldOf(values: number[], kind: "continuous" | "categorical" = "continuous"): GlyphMapField {
  return {
    bounds: { west: 0, east: values.length, south: 0, north: 1 },
    cols: values.length,
    rows: 1,
    values: Float32Array.from(values),
    noData: new Uint8Array(values.length),
    kind,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

describe("classifyGlyphMapField — categorical guard (acceptance gate 3)", () => {
  it("throws when a quantile classifier is applied to a categorical field", () => {
    const field = fieldOf([1, 2, 3, 4], "categorical");
    expect(() => classifyGlyphMapField(field, glyphMapQuantile(3))).toThrow(TypeError);
  });

  it("throws when a log classifier is applied to a categorical field", () => {
    const field = fieldOf([1, 2, 3, 4], "categorical");
    expect(() => classifyGlyphMapField(field, glyphMapLog(3))).toThrow(TypeError);
  });

  it("does NOT throw for a fixed breaks classifier on a categorical field", () => {
    const field = fieldOf([1, 2, 3, 4], "categorical");
    expect(() => classifyGlyphMapField(field, glyphMapBreaks([2, 3]))).not.toThrow();
  });

  it("does not throw quantile/log on a continuous field", () => {
    const field = fieldOf([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => classifyGlyphMapField(field, glyphMapQuantile(3))).not.toThrow();
    expect(() => classifyGlyphMapField(field, glyphMapLog(3))).not.toThrow();
  });
});

describe("glyphMapBreaks", () => {
  it("matches elevToBand's exact bucket boundaries", () => {
    const c = GlyphMapClassifiers.etopo1V1;
    expect(c.classifyValue!(-1)).toBe(0);
    expect(c.classifyValue!(0)).toBe(1);
    expect(c.classifyValue!(249)).toBe(1);
    expect(c.classifyValue!(250)).toBe(2);
    expect(c.classifyValue!(799)).toBe(2);
    expect(c.classifyValue!(800)).toBe(3);
    expect(c.classifyValue!(5599)).toBe(7);
    expect(c.classifyValue!(5600)).toBe(8);
    expect(c.classifyValue!(9000)).toBe(8);
  });

  it("requires strictly ascending breaks", () => {
    expect(() => glyphMapBreaks([0, 0, 5])).toThrow(RangeError);
    expect(() => glyphMapBreaks([5, 0])).toThrow(RangeError);
  });

  it("classify() honors the field's noData mask", () => {
    const field = fieldOf([100, 300, 900]);
    field.noData[1] = 1;
    const bands = classifyGlyphMapField(field, GlyphMapClassifiers.etopo1V1);
    expect(bands.bands[0]).toBe(1); // 100 -> band 1
    expect(bands.noData[1]).toBe(1);
    expect(bands.bands[2]).toBe(3); // 900 -> band 3
  });
});

describe("glyphMapEqualInterval", () => {
  it("divides the field's own [min, max] into n equal bins", () => {
    const field = fieldOf([0, 25, 50, 75, 100]);
    const bands = classifyGlyphMapField(field, glyphMapEqualInterval(4));
    expect(Array.from(bands.bands)).toEqual([0, 1, 2, 3, 3]); // 100 clamps into the last bin
  });

  it("classifyValue is only available when an explicit range is given", () => {
    expect(glyphMapEqualInterval(4).classifyValue).toBeUndefined();
    expect(glyphMapEqualInterval(4, [0, 100]).classifyValue).toBeDefined();
  });
});

describe("glyphMapQuantile", () => {
  it("has no fixed classifyValue — breaks are relative to the fitted field", () => {
    expect(glyphMapQuantile(4).classifyValue).toBeUndefined();
  });

  it("produces roughly equal-population bins", () => {
    const field = fieldOf(Array.from({ length: 100 }, (_, i) => i));
    const bands = classifyGlyphMapField(field, glyphMapQuantile(4));
    const counts = new Map<number, number>();
    for (const b of bands.bands) counts.set(b, (counts.get(b) ?? 0) + 1);
    expect(counts.size).toBe(4);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(15); // roughly 25 each, allow slack for interpolation
    }
  });

  it("two quantile classifiers over different fields are non-comparable — different breaks", () => {
    const low = fieldOf([0, 10, 20, 30]);
    const high = fieldOf([1000, 2000, 3000, 4000]);
    const bandsLow = classifyGlyphMapField(low, glyphMapQuantile(2));
    const bandsHigh = classifyGlyphMapField(high, glyphMapQuantile(2));
    // Same shape of band assignment (relative to each field), but the id
    // carries no information about the fitted breaks — that's the point.
    expect(bandsLow.classifier).toBe(bandsHigh.classifier);
    expect(Array.from(bandsLow.bands)).toEqual(Array.from(bandsHigh.bands));
  });
});

describe("glyphMapLog", () => {
  it("is monotonically non-decreasing across an ascending domain", () => {
    const field = fieldOf([1, 10, 100, 1000, 10000]);
    const bands = classifyGlyphMapField(field, glyphMapLog(5));
    for (let i = 1; i < bands.bands.length; i++) {
      expect(bands.bands[i]).toBeGreaterThanOrEqual(bands.bands[i - 1]);
    }
  });

  it("shifts a domain crossing zero to stay positive instead of producing NaN", () => {
    const field = fieldOf([-500, -100, 0, 500, 5000]);
    const bands = classifyGlyphMapField(field, glyphMapLog(5));
    for (const b of bands.bands) {
      expect(Number.isFinite(b)).toBe(true);
    }
  });
});
