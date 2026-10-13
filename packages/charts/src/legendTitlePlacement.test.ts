import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArea, glyphChartBar, glyphChartLine, glyphChartPlot } from "./spec";
import type { GlyphChartResult } from "./types";

/**
 * Owner packet: "legends only have on or off but no placements" / "the
 * title has to have some placement controls" — `legend: boolean |
 * { placement }` and `title: string | { text, align?, position? }`.
 */
const data = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 4 }];

function at(r: GlyphChartResult, x: number, y: number): string {
  return r.build.canvas.grid.char[y * r.build.canvas.grid.cols + x]!;
}
function findRow(r: GlyphChartResult, text: string): number {
  for (let y = 0; y < r.build.canvas.grid.rows; y++) {
    let s = "";
    for (let x = 0; x < r.build.canvas.grid.cols; x++) s += at(r, x, y);
    if (s.includes(text)) return y;
  }
  return -1;
}

describe("legend placement (owner packet item 1)", () => {
  it("legend: true is byte-identical to omitting legend and to { placement: 'bottom' }", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })] });
    const omitted = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    const trueOpt = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: true });
    const bottomOpt = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: { placement: "bottom" } });
    expect(trueOpt.text).toBe(omitted.text);
    expect(bottomOpt.text).toBe(omitted.text);
  });

  it("a corner placement paints inside the plot (no row reserved) — mutation: hardcode placement to 'bottom' -> the legend row would sit at the same bottommost row as the explicit bottom render", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar(data, { x: "x", y: "y" }, { name: "Revenue" })] });
    const bottom = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: { placement: "bottom" } });
    const corner = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: { placement: "top-right" } });
    const bottomRow = findRow(bottom, "Revenue");
    const cornerRow = findRow(corner, "Revenue");
    expect(bottomRow).toBeGreaterThan(-1);
    expect(cornerRow).toBeGreaterThan(-1);
    expect(cornerRow).toBeLessThan(bottomRow);
    // Right corner: the legend text ends near the plot's own right edge, not the left.
    let cornerLine = "";
    for (let x = 0; x < corner.build.canvas.grid.cols; x++) cornerLine += at(corner, x, cornerRow);
    expect(cornerLine.indexOf("Revenue")).toBeGreaterThan(corner.build.canvas.grid.cols / 2);
  });

  it("top-left places the legend near the plot's top-left, above where 'bottom' would reserve a row", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })] });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: { placement: "top-left" } });
    const row = findRow(r, "Revenue");
    expect(row).toBeGreaterThanOrEqual(0);
    let line = "";
    for (let x = 0; x < r.build.canvas.grid.cols; x++) line += at(r, x, row);
    expect(line.indexOf("Revenue")).toBeLessThan(r.build.canvas.grid.cols / 2);
  });

  it("a corner legend that overlaps painted data reports legend-overlaps-marks with the covered cell count", () => {
    const wide = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 10 }));
    const spec = glyphChartPlot({ marks: [glyphChartArea(wide, { x: "x", y: "y" }, { name: "Fill" })] });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: { placement: "top-left" } });
    const entry = r.report.ledger.find((e) => e.code === "legend-overlaps-marks");
    expect(entry).toBeDefined();
    expect((entry!.detail as { covered: number }).covered).toBeGreaterThan(0);
    expect(entry!.detail!.placement).toBe("top-left");
  });

  it("placement: 'title' shares the title's own row, after the title text", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })], title: "Sales" });
    const r = renderGlyphChart(spec, { target: "chat", width: 60, height: 14, legend: { placement: "title" } });
    const row = findRow(r, "Sales");
    expect(row).toBeGreaterThanOrEqual(0);
    let line = "";
    for (let x = 0; x < r.build.canvas.grid.cols; x++) line += at(r, x, row);
    expect(line).toContain("Revenue");
    expect(line.indexOf("Revenue")).toBeGreaterThan(line.indexOf("Sales"));
    expect(r.report.ledger.some((e) => e.code === "legend-placement-degraded")).toBe(false);
  });

  it("placement: 'title' degrades to bottom with a ledger entry when there's no title to share", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })] });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14, legend: { placement: "title" } });
    expect(r.report.ledger.some((e) => e.code === "legend-placement-degraded")).toBe(true);
    expect(findRow(r, "Revenue")).toBeGreaterThanOrEqual(0);
  });
});

describe("title placement (owner packet item 2)", () => {
  it("a string title is byte-identical to { align: 'center', position: 'top' }", () => {
    const stringSpec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], title: "Sales" });
    const objectSpec = { ...stringSpec, title: { text: "Sales", align: "center" as const, position: "top" as const } };
    const a = renderGlyphChart(stringSpec, { target: "chat", width: 40, height: 14 });
    const b = renderGlyphChart(objectSpec, { target: "chat", width: 40, height: 14 });
    expect(b.text).toBe(a.text);
  });

  it("align: 'left' starts the title near column 0; align: 'right' ends it near the last column", () => {
    const base = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })] });
    const left = renderGlyphChart({ ...base, title: { text: "Sales", align: "left" } }, { target: "chat", width: 60, height: 14 });
    const right = renderGlyphChart({ ...base, title: { text: "Sales", align: "right" } }, { target: "chat", width: 60, height: 14 });
    const leftRow = left.text.split("\n")[0]!;
    const rightRow = right.text.split("\n")[0]!;
    expect(leftRow.indexOf("Sales")).toBeLessThan(5);
    expect(rightRow.indexOf("Sales") + "Sales".length).toBeGreaterThan(55);
  });

  it("position: 'bottom' puts the title on the very last row of the chart, below the legend/axis rows", () => {
    const spec = glyphChartPlot({
      marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })],
      title: { text: "Sales", position: "bottom" },
    });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    const rows = r.text.split("\n");
    expect(rows).toHaveLength(14);
    expect(rows[13]).toContain("Sales");
    // The legend row (reserved before the bottom title, per layout.ts's
    // doc) sits ABOVE it, not sharing or fighting for the same row.
    const legendRow = findRow(r, "Revenue");
    expect(legendRow).toBeLessThan(13);
  });

  it("explicit title: '' suppresses the title exactly like omitting it entirely, but still reports meta.title", () => {
    const withEmpty = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], title: "" });
    const withoutTitle = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })] });
    const a = renderGlyphChart(withEmpty, { target: "chat", width: 40, height: 14 });
    const b = renderGlyphChart(withoutTitle, { target: "chat", width: 40, height: 14 });
    expect(a.text).toBe(b.text);
    expect(a.meta.title).toBe("");
    expect(b.meta.title).toBeNull();
  });
});

describe("corner legend reports the drops the bottom placement already reports, and never overwrites the x-axis row (fable review, batch 3, finding f)", () => {
  it("a plot too narrow for any corner legend content reports legend-dropped, exactly like the bottom placement's own drop", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" }, { name: "Revenue" })], legend: { placement: "top-right" } });
    const r = renderGlyphChart(spec, { target: "chat", width: 5, height: 14 });
    expect(r.report.ledger.some((e) => e.code === "legend-dropped")).toBe(true);
  });

  it("more series than the plot has rows drops the excess and reports legend-dropped naming the dropped count", () => {
    const marks = Array.from({ length: 10 }, (_, i) => glyphChartLine(data, { x: "x", y: "y" }, { name: `S${i}` }));
    const spec = glyphChartPlot({ marks, legend: { placement: "top-right" } });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 8 });
    const entry = r.report.ledger.find((e) => e.code === "legend-dropped");
    expect(entry).toBeDefined();
    expect((entry!.detail as { series: number }).series).toBeGreaterThan(0);
    // Only the surviving entries paint — S9 (the last, lowest-priority
    // series) is among the ones cut.
    expect(r.text).not.toContain("S9");
  });

  it("a bottom-right legend never overwrites the x-axis rule row, even when it would otherwise reach the plot's own last row", () => {
    const marks = Array.from({ length: 6 }, (_, i) => glyphChartBar(data, { x: "x", y: "y" }, { name: `S${i}` }));
    const spec = glyphChartPlot({ marks, legend: { placement: "bottom-right" } });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 7 });
    const rows = r.text.split("\n");
    // The x-axis rule row is the one whose left cell is the corner glyph
    // '└' (a plain, non-interior x-axis line — the common case here).
    const axisRow = rows.find((row) => row.trimStart().startsWith("0 └") || row.startsWith("└"));
    expect(axisRow, "no x-axis rule row found in the rendered output").toBeDefined();
    // The axis row's own rule glyphs survive intact — no legend swatch or
    // series label character landed on it. Before the fix, the corner
    // legend's own bottom row was mapped onto exactly this row (`plot.y1`),
    // painting a series name over the axis rule.
    expect(axisRow).toMatch(/^[└┬─\s0]+$/);
  });
});
