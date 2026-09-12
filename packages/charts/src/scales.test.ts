import { describe, expect, it } from "vitest";
import { resolveGlyphChartScales } from "./scales";
import { resolveGlyphChartSpec } from "./resolve";
import { glyphChartDot, glyphChartLine, glyphChartPlot } from "./spec";
import { layoutGlyphChart } from "./layout";
import type { GlyphChartLedgerEntry } from "./ledger";

describe("resolveGlyphChartScales — one scale per axis", () => {
  // Gate: "one scale per axis" (mutation: build a scale PER MARK instead of
  // once per spec -> the two marks below, with disjoint y ranges, would each
  // get a domain sized only to its own data, so a value from the OTHER
  // mark's range would map outside [0,1] on ITS scale; sharing one scale
  // means every mark's values map inside the shared domain).
  it("a spec with two marks of very different ranges shares ONE y scale whose domain covers both", () => {
    const spec = glyphChartPlot({
      marks: [
        glyphChartLine([1, 2, 3]),
        glyphChartDot([{ x: 0, y: 1000 }], { x: "x", y: "y" }),
      ],
    });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    // Both extremes fall inside [0, 1] of the SAME scale.
    expect(scales.y.toFraction(1)).toBeGreaterThanOrEqual(0);
    expect(scales.y.toFraction(1)).toBeLessThanOrEqual(1);
    expect(scales.y.toFraction(1000)).toBeGreaterThanOrEqual(0);
    expect(scales.y.toFraction(1000)).toBeLessThanOrEqual(1);
    // The line mark's own value (3) is nowhere near the top of the shared
    // domain, proving the domain was extended by the OTHER mark, not
    // computed independently per mark.
    expect(scales.y.toFraction(3)).toBeLessThan(0.1);
  });
});

describe("tick thinning — non-empty and pairwise disjoint", () => {
  // Gate: "ticks: at 40/60/80/120 columns the tick list is non-empty AND
  // pairwise disjoint" (mutation: return no ticks from layoutGlyphChart's
  // thinning -> the non-empty assertion reddens).
  const data = Array.from({ length: 50 }, (_, i) => ({ t: i, v: Math.sin(i / 3) * 100 }));
  const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "t", y: "v" })] });
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);

  for (const cols of [40, 60, 80, 120]) {
    it(`cols=${cols}: x ticks are non-empty and pairwise label-disjoint`, () => {
      const ledger: GlyphChartLedgerEntry[] = [];
      const layout = layoutGlyphChart(spec, marks, scales, cols, 20, "auto", ledger);
      expect(layout.xTicks.length).toBeGreaterThan(0);
      const sorted = [...layout.xTicks].sort((a, b) => a.cell - b.cell);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        const aHalf = Math.ceil(a.label.length / 2);
        const bHalf = Math.ceil(b.label.length / 2);
        // Disjoint spans: a's right edge must not reach b's left edge.
        expect(a.cell + aHalf).toBeLessThan(b.cell - bHalf);
      }
    });
  }
});

it("numeric tick formatters emit ASCII even for negative micro units", () => {
  // Mutation: retain d3's Unicode minus or micro prefix -> tick formatter itself leaks Unicode.
  const marks = resolveGlyphChartSpec(glyphChartPlot({ marks: [glyphChartDot([-0.000002, 0.000001])] }));
  const scales = resolveGlyphChartScales(marks, undefined);
  expect(scales.y.format(-0.000001)).toBe("-1u");
  for (const tick of scales.y.ticks(5)) expect(tick.label).toMatch(/^[\x20-\x7e]*$/);
});
