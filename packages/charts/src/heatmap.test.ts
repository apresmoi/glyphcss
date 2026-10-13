/**
 * Heatmaps (`heatmap.ts`, reviewFixtures exception 13): flush, roughly
 * square cells sized to the grid, a ramp with no blank level, a range key,
 * and the `cellRamp` / `axes.*.line` options the chat skill uses.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartCell, glyphChartPlot } from "./spec";
import type { GlyphChartRenderOptions, GlyphChartSpec } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BASE: GlyphChartRenderOptions = { width: 72, height: 24, charset: "box", color: "none" };

function week(hours: number, value: (day: number, hour: number) => number = (d, h) => 5 + d * 24 + h): GlyphChartSpec {
  const data = DAYS.flatMap((day, d) => Array.from({ length: hours }, (_, h) => ({ day, hour: String(h).padStart(2, "0"), v: value(d, h) })));
  return glyphChartPlot({ marks: [glyphChartCell(data, { x: "hour", y: "day", fill: "v" })] });
}
const lines = (text: string) => text.split("\n");
/** The grid rows: every line that starts with a day label. */
const gridRows = (text: string) => lines(text).filter((l) => DAYS.some((d) => l.startsWith(d)));
/** Runs of identical glyphs along one grid row, after the gutter. */
function runs(row: string, from: number): number[] {
  const cells = [...row].slice(from);
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) if (i === 0 || cells[i] !== cells[i - 1]) out.push(1); else out[out.length - 1]!++;
  return out;
}

describe("heatmap geometry", () => {
  it("tiles 24 x 7 cells flush, two columns by one row each, and shrinks the chart to the grid", () => {
    // Mutation: keep band padding for heatmaps, or drop `bandFlush`'s integer partition -> red.
    const r = renderGlyphChart(week(24, (d, h) => (d + h) % 2), BASE);
    const rows = gridRows(r.text);
    expect(rows).toHaveLength(7);
    const gutter = rows[0]!.indexOf("┤") + 1;
    for (const row of rows) expect(runs(row.trimEnd(), gutter)).toEqual(Array(24).fill(2));
    // Mutation: skip the second, shrunken layout pass -> the canvas stays 72 wide.
    expect(r.build.canvas.cols).toBe(gutter + 48);
  });

  it("grows cells in proportion when there is room: 8 x 7 gets 4-column, 2-row cells", () => {
    // Mutation: fix k at 1 -> 2-column cells.
    const r = renderGlyphChart(week(8, (d, h) => (d + h) % 2), BASE);
    const grid = lines(r.text).slice(0, 14);
    const gutter = grid[1]!.indexOf("┤") + 1;
    for (const row of grid) expect(runs(row.trimEnd(), gutter)).toEqual(Array(8).fill(4));
  });

  it("labels every day on consecutive rows and starts the hour labels at the first one", () => {
    // Mutation: keep the 2-row y-label spacing for flush bands -> only every other day.
    const r = renderGlyphChart(week(24), BASE);
    expect(gridRows(r.text).map((l) => l.slice(0, 3))).toEqual([...DAYS].reverse());
    // Mutation: anchor x thinning at the last category -> labels start at "02".
    const labels = lines(r.text).find((l) => /\b00\b/.test(l) || /\b02\b/.test(l))!;
    expect(labels.trim().startsWith("00")).toBe(true);
    expect(r.report.ledger.filter((e) => e.code === "ticks-thinned" && e.detail?.axis === "y")).toEqual([]);
  });

  it("keeps bars and other band charts' padding", () => {
    const r = renderGlyphChart(glyphChartPlot({ marks: [glyphChartCell([{ x: "a", y: 1, v: 1 }, { x: "b", y: 1, v: 2 }], { x: "x", y: "y", fill: "v" })] }), BASE);
    // A numeric y is not a band, so this is not a heatmap: full canvas, gaps kept.
    expect(r.build.canvas.cols).toBe(72);
  });
});

describe("heatmap ramp and key", () => {
  it("shades the minimum with the lightest glyph and the maximum with the darkest, never blank", () => {
    // Mutation: put a blank back at the bottom of the ramp -> red.
    const r = renderGlyphChart(week(24), BASE);
    const rows = gridRows(r.text);
    const gutter = rows[0]!.indexOf("┤") + 1;
    expect(rows.at(-1)![gutter]).toBe("░"); // Mon 00, the minimum.
    expect(rows[0]!.trimEnd().at(-1)).toBe("█"); // Sun 23, the maximum.
    for (const row of rows) expect(row.slice(gutter).trimEnd()).not.toContain(" ");
  });

  it("draws a range key under the grid", () => {
    // Mutation: drop `paintCellKey` -> red.
    const r = renderGlyphChart(week(24), BASE);
    expect(lines(r.text).at(-1)!.trim()).toBe("5 ░░▒▒▓▓██ 172");
  });

  it("takes a caller ramp, and a hidden axis line leaves only labels", () => {
    // Mutation: ignore `cellRamp`, or paint lines when `axes.*.line` is false -> red.
    const ramp = [..."⠂⠢⠪⡪⣺⣿▒▓█"];
    const spec = { ...week(24), axes: { x: { line: false }, y: { line: false } } };
    const r = renderGlyphChart(spec, { ...BASE, cellRamp: ramp });
    expect(r.text).not.toMatch(/[│┤└─┬]/);
    expect(lines(r.text).at(-1)!.trim()).toBe(`5 ${ramp.map((g) => g + g).join("")} 172`);
    // Without the axis row, the bottom day sits directly on the hour labels.
    const all = lines(r.text);
    expect(all.findIndex((l) => l.startsWith("Mon")) + 1).toBe(all.findIndex((l) => /^\s+00/.test(l)));
  });

  it("falls back to single-glyph key cells, then drops the key with a ledger entry", () => {
    const spec = glyphChartPlot({ marks: [glyphChartCell([{ x: "a", y: "r", v: 1000000 }, { x: "b", y: "r", v: 2000000 }], { x: "x", y: "y", fill: "v" })] });
    const ramp = [..."abcdefghijklmnop"];
    const narrow = renderGlyphChart(spec, { ...BASE, width: 30, cellRamp: ramp });
    expect(narrow.text).toContain("1M abcdefghijklmnop 2M");
    // Mutation: drop the ledger push -> red.
    const tiny = renderGlyphChart(spec, { ...BASE, width: 16, cellRamp: ramp });
    expect(tiny.report.ledger.some((e) => e.code === "label-dropped" && e.detail?.role === "heatmap key")).toBe(true);
  });

  it("gives a signed heatmap no key and keeps blank for exactly zero", () => {
    const spec = glyphChartPlot({ marks: [glyphChartCell([{ x: "a", y: "r", v: -5 }, { x: "b", y: "r", v: 0 }, { x: "c", y: "r", v: 5 }], { x: "x", y: "y", fill: "v" })] });
    const r = renderGlyphChart(spec, BASE);
    expect(r.text).not.toMatch(/-5 .* 5$/m);
    expect(r.build.canvas.grid.char).toContain("▙");
  });

  it("paints equal values with the lightest glyph", () => {
    // Mutation: give `hi === lo` the darkest level -> red.
    const r = renderGlyphChart(week(4, () => 7), BASE);
    expect(gridRows(r.text).join("")).toContain("░");
    expect(gridRows(r.text).join("")).not.toMatch(/[▒▓█]/);
  });

  it("rejects a malformed ramp", () => {
    expect(() => renderGlyphChart(week(4), { ...BASE, cellRamp: ["ab"] })).toThrow(expect.objectContaining({ code: "bad-cell-ramp" }));
    expect(() => renderGlyphChart(week(4), { ...BASE, charset: "ascii", cellRamp: ["░"] })).toThrow(expect.objectContaining({ code: "bad-cell-ramp" }));
  });
});
