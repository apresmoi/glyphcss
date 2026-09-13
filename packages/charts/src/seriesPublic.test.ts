import { describe, expect, it } from "vitest";
import { glyphChartLine, glyphChartPlot, glyphChartRule } from "./spec";
import { renderGlyphChart } from "./render";
import { glyphChartSeriesPreview } from "./seriesPublic";

const SAMPLE = [3, 5, 2, 8, 6, 9, 4];

describe("glyphChartSeriesPreview", () => {
  it("matches the real render's colours on the line-rule preset (a cross-mark styleIndex case)", () => {
    const spec = glyphChartPlot({
      marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), glyphChartRule([5], { name: "Target" })],
      title: "Line + rule",
    });
    const preview = glyphChartSeriesPreview(spec);
    expect(preview).toEqual([
      { name: "Revenue", markIndex: 0, styleIndex: 0, color: "#3b82f6" },
      { name: "Target", markIndex: 1, styleIndex: 1, color: "#f97316" },
    ]);
    // The gate: the swatch colour must be a colour the render actually paints.
    const result = renderGlyphChart(spec, { target: "web", width: 40, height: 12 });
    expect(result.html).toContain(preview[0]!.color);
    expect(result.html).toContain(preview[1]!.color);
  });

  it("a numeric fill channel is ONE series (never a per-row split), matching the library's own meta.series", () => {
    const spec = glyphChartPlot({
      marks: [{ type: "line", data: [{ x: 0, y: 1, fill: 10 }, { x: 1, y: 2, fill: 20 }], channels: { x: "x", y: "y", fill: "fill" } }],
    });
    const preview = glyphChartSeriesPreview(spec);
    expect(preview).toHaveLength(1);
    expect(preview[0]!.markIndex).toBe(0);
  });

  it("an unnamed single-series mark still gets exactly one entry, falling back to a Mark <n> label", () => {
    const preview = glyphChartSeriesPreview(glyphChartPlot({ marks: [glyphChartLine(SAMPLE)] }));
    expect(preview).toEqual([{ name: "Mark 1", markIndex: 0, styleIndex: 0, color: "#3b82f6" }]);
  });

  it("resolves a mark's own colour override, cycling a short array across its series", () => {
    const spec = glyphChartPlot({
      marks: [{
        type: "line",
        data: [{ month: 0, value: 3, region: "South" }, { month: 0, value: 1, region: "North" }, { month: 0, value: 2, region: "East" }],
        channels: { x: "month", y: "value", fill: "region" },
        options: { color: ["#ff0000", "#00ff00"] },
      }],
    });
    const preview = glyphChartSeriesPreview(spec);
    expect(preview.map((s) => s.color)).toEqual(["#ff0000", "#00ff00", "#ff0000"]); // cycled, matching resolveMarkColorAt
  });
});
