import { describe, expect, it } from "vitest";
import { glyphChartLine, glyphChartPlot, glyphChartRule, normalizeGlyphChartInput } from "./spec";

describe("normalizeGlyphChartInput", () => {
  it("wraps a bare number array as a one-mark line spec", () => {
    const spec = normalizeGlyphChartInput([3, 5, 2, 8]);
    expect(spec.marks).toHaveLength(1);
    expect(spec.marks[0]!.type).toBe("line");
  });

  it("wraps a lone mark as a one-mark spec", () => {
    const mark = glyphChartLine([1, 2, 3]);
    const spec = normalizeGlyphChartInput(mark);
    expect(spec.marks).toEqual([mark]);
  });

  it("wraps an array of marks", () => {
    const marks = [glyphChartLine([1, 2]), glyphChartRule([0])];
    const spec = normalizeGlyphChartInput(marks);
    expect(spec.marks).toEqual(marks);
  });

  it("passes a full spec through unchanged", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2])], title: "T" });
    expect(normalizeGlyphChartInput(spec)).toBe(spec);
  });

  it("throws for an unrecognisable input", () => {
    expect(() => normalizeGlyphChartInput("nope" as never)).toThrow(TypeError);
  });
});

describe("glyphChartRule", () => {
  it("defaults axis to y", () => {
    expect(glyphChartRule([0]).options?.axis).toBe("y");
  });
  it("honours an explicit axis", () => {
    expect(glyphChartRule([0], { axis: "x" }).options?.axis).toBe("x");
  });
  // Final-gate-2 review (codex #11): a hand-authored JSON rule mark keeps
  // its `name` (options pass through verbatim); the constructor used to
  // accept only `{ axis? }` and silently drop it, so the two disagreed.
  // Mutation: revert `glyphChartRule`'s param type back to `{ axis?: "x" |
  // "y" }` -> `.options?.name` reads undefined -> red.
  it("keeps a caller-supplied name, exactly like every other mark constructor", () => {
    expect(glyphChartRule([5], { name: "Target" }).options?.name).toBe("Target");
    expect(glyphChartRule([5], { axis: "x", name: "Target" }).options).toEqual({ axis: "x", name: "Target" });
  });
});
