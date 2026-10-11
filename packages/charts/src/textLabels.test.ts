/**
 * `text` labels over another mark (`paint.ts`'s `labelSpot`): a label never
 * overwrites the data ink it annotates. Alone, a text mark still centres on
 * its point.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartLine, glyphChartPlot, glyphChartText } from "./spec";
import type { GlyphChartMark } from "./types";

const OPTS = { target: "chat" as const, width: 48, height: 16, charset: "braille" as const, color: "none" as const };
const series = [{ m: 1, v: 12 }, { m: 2, v: 18 }, { m: 3, v: 15 }, { m: 4, v: 31 }, { m: 5, v: 28 }, { m: 6, v: 40 }];
const line = glyphChartLine(series, { x: "m", y: "v" });
const labels = glyphChartText([{ m: 4, v: 31, t: "launch" }, { m: 6, v: 40, t: "peak" }], { x: "m", y: "v", label: "t" });

const grid = (marks: GlyphChartMark[]) => renderGlyphChart(glyphChartPlot({ marks }), OPTS).build.canvas.grid.char;

describe("text labels over another mark", () => {
  it("keep every cell of the data ink they annotate", () => {
    // Mutation: centre the label on its point again, or drop the ink check (take the first spot) -> red.
    const bare = grid([line]);
    const labelled = grid([line, labels]);
    const covered = bare.flatMap((ch, i) => ch !== " " && labelled[i] !== ch ? [i] : []);
    expect(covered).toEqual([]);
    const text = labelled.join("");
    expect(text).toContain("launch");
    expect(text).toContain("peak");
  });

  it("sit next to their point", () => {
    const r = renderGlyphChart(glyphChartPlot({ marks: [line, labels] }), OPTS);
    const rows = r.text.split("\n");
    const peakRow = rows.findIndex((l) => l.includes("peak"));
    // The 40 point is the top plot row; "peak" sits on that row, to its left.
    expect(rows[peakRow]!.startsWith("40")).toBe(true);
    expect(rows[peakRow]!.trimEnd().endsWith("peak ⡠")).toBe(true);
  });

  it("centre on their point when the chart is text alone", () => {
    // Mutation: offset labels whatever the chart holds -> red.
    const r = renderGlyphChart(glyphChartPlot({ marks: [glyphChartText([{ x: 1, y: 1, t: "lo" }, { x: 2, y: 2, t: "hi" }], { x: "x", y: "y", label: "t" })] }), { ...OPTS, charset: "box" });
    const rows = r.text.split("\n");
    expect(rows.findIndex((l) => l.includes("hi"))).toBe(r.build.plot.y0);
    expect(rows.findIndex((l) => l.includes("lo"))).toBe(r.build.plot.y1);
  });
});
