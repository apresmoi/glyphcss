import { describe, expect, it } from "vitest";
import { bandColRange, fractionToCol, fractionToRow, layoutGlyphChart, scaleToRow } from "./layout";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartArc, glyphChartBar, glyphChartLine, glyphChartPlot, glyphChartText } from "./spec";

describe("fractionToRow / fractionToCol — rounding, not flooring", () => {
  const plot = { x0: 0, y0: 0, x1: 9, y1: 9 }; // 10x10, so (height-1) = 9.
  // Gate: "honesty … mutation: quantise with `floor` instead of `round` ->
  // a bar is off by more than the tolerance on a designed fixture -> red."
  // 0.5 * 9 = 4.5 — round -> 5, floor -> 4. This directly pins the rounding
  // rule the bar/area/cell painters all depend on for proportional length.
  it("rounds fractional cell positions instead of flooring them", () => {
    expect(fractionToCol(plot, 0.5)).toBe(5);
    expect(fractionToRow(plot, 0.5)).toBe(9 - 5); // row axis is flipped (0 fraction = bottom = plot.y1).
  });

  it("fraction 0 maps to the plot's own start/end and fraction 1 to the other end", () => {
    expect(fractionToCol(plot, 0)).toBe(plot.x0);
    expect(fractionToCol(plot, 1)).toBe(plot.x1);
    expect(fractionToRow(plot, 0)).toBe(plot.y1);
    expect(fractionToRow(plot, 1)).toBe(plot.y0);
  });
});

describe("scaleToRow — honesty: proportional to value, not to sign", () => {
  it("a value exactly at the max of a positive-only domain reaches the plot's top row", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar([10])] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 30, 12, "auto", ledger);
    expect(scaleToRow(scales.y, layout.plot, 10)).toBe(layout.plot.y0);
    expect(scaleToRow(scales.y, layout.plot, 0)).toBe(layout.plot.y1);
  });
});

describe("bandColRange — exact, non-overlapping band bounds", () => {
  it("adjacent categories get disjoint, non-overlapping column ranges", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }], { x: "k", y: "v" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 40, 14, "auto", ledger);
    const a = bandColRange(scales.x, layout.plot, "a")!;
    const b = bandColRange(scales.x, layout.plot, "b")!;
    const c = bandColRange(scales.x, layout.plot, "c")!;
    expect(a[1]).toBeLessThan(b[0]);
    expect(b[1]).toBeLessThan(c[0]);
  });
});

describe("layoutGlyphChart — cartesian axis suppression for arc/text-only specs", () => {
  it("an arc-only spec reserves no y-gutter or x-axis rows", () => {
    const spec = glyphChartPlot({ marks: [glyphChartArc([1, 2, 3])] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 30, 16, "auto", ledger);
    expect(layout.hasCartesianAxes).toBe(false);
    expect(layout.plot.x0).toBe(0);
    // Mutation: reserve cartesian rows for arcs or omit the new per-slice legend -> budget differs.
    expect(layout.legend?.row).toBe(15);
    expect(layout.plot.y1).toBe(14);
  });

  it("a line spec DOES reserve axis space", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 30, 16, "auto", ledger);
    expect(layout.hasCartesianAxes).toBe(true);
    expect(layout.plot.x0).toBeGreaterThan(0);
  });

  it("a text-only spec is treated like arc (no cartesian axes)", () => {
    const spec = glyphChartPlot({ marks: [glyphChartText([{ x: 1, y: 1, label: "hi" }], { x: "x", y: "y", label: "label" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 20, 10, "auto", ledger);
    expect(layout.hasCartesianAxes).toBe(false);
  });
});

describe("layoutGlyphChart — degrade ladder logs to the ledger", () => {
  it("drops the title on a too-short viewport and logs it", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])], title: "Title" });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 20, 4, "auto", ledger);
    expect(layout.titleRow).toBeNull();
    expect(ledger.some((l) => l.includes("title dropped"))).toBe(true);
  });
});
