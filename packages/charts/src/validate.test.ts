import { describe, expect, it } from "vitest";
import { glyphChartLine, glyphChartArc, glyphChartRule, glyphChartPlot } from "./spec";
import { GLYPH_CHART_VALIDATION_RULES, glyphChartRepairHint, validateGlyphChartRenderSize, validateGlyphChartSpec, type GlyphChartValidationError } from "./validate";

function code(fn: () => void): string | undefined {
  try { fn(); return undefined; } catch (e) { return (e as GlyphChartValidationError).code; }
}

describe("validateGlyphChartSpec", () => {
  it("accepts a valid spec", () => {
    expect(() => validateGlyphChartSpec(glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])] }))).not.toThrow();
  });

  it("empty-marks: a spec with no marks throws that rule id", () => {
    expect(code(() => validateGlyphChartSpec({ marks: [] }))).toBe("empty-marks");
  });

  it("unknown-mark-type: a designed bad spec throws exactly this rule id", () => {
    // Gate: "schema validates every fixture and rejects a designed bad spec
    // with the expected rule id" (mutation: drop a rule from
    // GLYPH_CHART_VALIDATION_RULES/validateMark -> this assertion goes from
    // "unknown-mark-type" to undefined -> red).
    const bad = glyphChartPlot({ marks: [{ type: "scatter3d", data: [1], channels: {} } as never] });
    expect(code(() => validateGlyphChartSpec(bad))).toBe("unknown-mark-type");
  });

  it("empty-data: a mark with no rows throws", () => {
    expect(code(() => validateGlyphChartSpec(glyphChartPlot({ marks: [glyphChartLine([])] })))).toBe("empty-data");
  });

  it("missing-xy-channels: record data without both x and y channels throws", () => {
    const bad = glyphChartPlot({ marks: [glyphChartLine([{ v: 1 }], { x: "v" })] });
    expect(code(() => validateGlyphChartSpec(bad))).toBe("missing-xy-channels");
  });

  it("invalid-transform-n: a non-positive bin count throws", () => {
    const bad = glyphChartPlot({ marks: [{ ...glyphChartLine([1, 2, 3]), transform: { kind: "bin", n: 0 } }] });
    expect(code(() => validateGlyphChartSpec(bad))).toBe("invalid-transform-n");
  });

  it("invalid-inner-radius: an arc's innerRadius outside [0,1) throws", () => {
    const bad = glyphChartPlot({ marks: [glyphChartArc([1, 2], {}, { innerRadius: 1.5 })] });
    expect(code(() => validateGlyphChartSpec(bad))).toBe("invalid-inner-radius");
  });

  it("invalid-rule-axis: a rule's axis outside x/y throws", () => {
    const rule = glyphChartRule([0]);
    const bad = glyphChartPlot({ marks: [{ ...rule, options: { axis: "z" as never } }] });
    expect(code(() => validateGlyphChartSpec(bad))).toBe("invalid-rule-axis");
  });
});

describe("validateGlyphChartRenderSize", () => {
  it("bad-size: zero/negative/non-finite dimensions throw", () => {
    expect(code(() => validateGlyphChartRenderSize(0, 10))).toBe("bad-size");
    expect(code(() => validateGlyphChartRenderSize(10, -1))).toBe("bad-size");
    expect(code(() => validateGlyphChartRenderSize(NaN, 10))).toBe("bad-size");
  });
  it("accepts positive finite sizes", () => {
    expect(() => validateGlyphChartRenderSize(40, 12)).not.toThrow();
  });
});

describe("glyphChartRepairHint", () => {
  it("has a non-empty hint for every rule id", () => {
    for (const id of GLYPH_CHART_VALIDATION_RULES) {
      expect(glyphChartRepairHint(id).length).toBeGreaterThan(0);
    }
  });
});
