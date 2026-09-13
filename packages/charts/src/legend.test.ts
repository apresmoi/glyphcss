import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartLine, glyphChartPlot } from "./spec";

/**
 * Packet "renderers, legends, axes, table editor" item 4 — every mark
 * constructor's `name?: string` option (`GlyphChartMarkOptions.name`,
 * `series.ts`'s `chartSeries`) contributes its own legend entry with its own
 * swatch, exactly like a categorical `fill`/`stroke` series already does.
 * `target: "chat"` (box, no colour) throughout so the legend's swatch glyph
 * is the monochrome LINE STYLE (`SERIES_STYLES` cycling solid/dashed/dotted/
 * double) rather than a colour swatch — the shape most sensitive to a
 * "the two entries render identically" mutation.
 */
const data = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }];

function legendRow(text: string, ...labels: string[]): string {
  const row = text.split("\n").find((line) => labels.every((label) => line.includes(label)));
  if (row === undefined) throw new Error(`no row contains all of ${JSON.stringify(labels)} in:\n${text}`);
  return row;
}
function swatchBefore(row: string, label: string): string {
  const idx = row.indexOf(label);
  return row.slice(Math.max(0, idx - 3), idx).trim();
}

describe("chart legends — named marks (packet item 4)", () => {
  it("two named lines produce two legend entries with distinct swatches", () => {
    const spec = glyphChartPlot({
      marks: [
        glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" }),
        glyphChartLine(data, { x: "x", y: "y" }, { name: "Visits" }),
      ],
    });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    expect(r.meta.series).toEqual(["Revenue", "Visits"]);
    const row = legendRow(r.text, "Revenue", "Visits");
    const revenueSwatch = swatchBefore(row, "Revenue");
    const visitsSwatch = swatchBefore(row, "Visits");
    expect(revenueSwatch).not.toBe("");
    expect(visitsSwatch).not.toBe("");
    // Mutation: ignore `mark.options?.name` when assigning styleIndex (both
    // series fall back to styleIndex 0) -> both swatches render identically.
    expect(revenueSwatch).not.toBe(visitsSwatch);
  });

  it("a single named mark still gets its own legend entry and swatch", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })] });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    expect(r.meta.series).toEqual(["Revenue"]);
    const row = legendRow(r.text, "Revenue");
    expect(swatchBefore(row, "Revenue")).not.toBe("");
    expect(r.report.ledger.some((entry) => entry.code === "legend-dropped")).toBe(false);
  });

  it("an unnamed single mark shows no legend row", () => {
    const r = renderGlyphChart(glyphChartLine(data, { x: "x", y: "y" }), { target: "chat", width: 40, height: 14 });
    expect(r.meta.series).toEqual([]);
    expect(() => legendRow(r.text, "line")).toThrow();
    expect(r.report.ledger.some((entry) => entry.code === "legend-dropped")).toBe(false);
  });

  it("legend: false hides the row even for two named marks, without changing meta.series", () => {
    const spec = glyphChartPlot({
      marks: [
        glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" }),
        glyphChartLine(data, { x: "x", y: "y" }, { name: "Visits" }),
      ],
    });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: false });
    expect(r.meta.series).toEqual(["Revenue", "Visits"]);
    expect(() => legendRow(r.text, "Revenue", "Visits")).toThrow();
  });
});
