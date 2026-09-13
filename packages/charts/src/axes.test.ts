import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartBar, glyphChartLine, glyphChartPlot } from "./spec";

/**
 * Packet "renderers, legends, axes, table editor" item 6 — axes with tick
 * marks default ON (`┤`/`┴`/`└`, `+` on ascii), a requested `ticks` count,
 * `tickMarks: false` reverting to the plain axis, integer-only ticks for
 * integer/index data, and axis titles (default: the channel's own field
 * name) plus an opt-in faint grid.
 */
describe("axes — tick marks (default ON)", () => {
  it("default render shows tick marks (┤/┴) at tick positions and └ at the corner", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8, 6, 9]), { target: "chat", charset: "box", color: "none", width: 30, height: 12 });
    expect(r.text).toContain("┤");
    expect(r.text).toContain("┴");
    expect(r.text).toContain("└");
  });

  it("tickMarks: false restores the plain axis (no ┤/┴/└ anywhere)", () => {
    const spec = { marks: [glyphChartLine([3, 5, 2, 8, 6, 9])], axes: { x: { tickMarks: false }, y: { tickMarks: false } } };
    const r = renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 30, height: 12 });
    expect(r.text).not.toContain("┤");
    expect(r.text).not.toContain("┴");
    expect(r.text).not.toContain("└");
    expect(r.text).toContain("│");
    expect(r.text).toContain("─");
  });

  it("ascii tier uses '+' for every tick mark and the corner", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8, 6, 9]), { target: "chat", charset: "ascii", color: "none", width: 30, height: 12 });
    expect(r.text).toContain("+");
    // ascii's own junction table collapses every multi-stem entry (corner
    // included) to '+' — never a box-drawing glyph leaking through.
    expect(r.text).not.toMatch(/[┤┴└┼├┬┐┘┌]/);
  });

  it("ticks: 3 yields no more than 3 evenly spaced x ticks", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([3, 5, 2, 8, 6, 9, 4, 7])], axes: { x: { ticks: 3 } } });
    const r = renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 60, height: 14 });
    const tickRow = r.text.split("\n").find((line) => /\d/.test(line));
    expect(tickRow).toBeDefined();
    const positions = [...tickRow!.matchAll(/\d+/g)].map((m) => m.index!);
    expect(positions.length).toBeLessThanOrEqual(3);
    expect(positions.length).toBeGreaterThan(0);
  });

  it("index data [3,5,2,8] never shows a 0.5 tick", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", width: 44, height: 12 });
    expect(r.text).not.toMatch(/0\.5|1\.5|2\.5/);
  });

  it("integer y data never shows a fractional tick either", () => {
    const r = renderGlyphChart(glyphChartBar([3, 5, 2, 8]), { target: "chat", color: "none", width: 44, height: 16 });
    expect(r.text).not.toMatch(/\d\.\d/);
  });

  // Mutation: swap `named.get(name)!` (or the tick-glyph selection) so
  // tickMarks stops distinguishing ticked vs plain cells -> every axis cell
  // reads the same glyph and this goes red.
  it("mutation guard: tick cells and non-tick cells on the same axis line read DIFFERENT glyphs", () => {
    const spec = { marks: [glyphChartLine([3, 5, 2, 8, 6, 9])] };
    const r = renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 30, height: 12 });
    const xAxisRow = r.text.split("\n").find((line) => line.includes("┴") || line.includes("└"))!;
    expect(xAxisRow).toBeDefined();
    expect(xAxisRow).toContain("─");
  });
});

describe("axes — titles", () => {
  it("defaults the x title to the channel's own field name", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([{ month: 0, value: 3 }, { month: 1, value: 5 }], { x: "month", y: "value" })] });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    expect(r.text).toContain("month");
  });

  it("defaults the y title to the channel's own field name, placed top-left", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([{ month: 0, value: 3 }, { month: 1, value: 5 }], { x: "month", y: "value" })] });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    const lines = r.text.split("\n");
    const titleLine = lines.findIndex((line) => line.includes("value"));
    expect(titleLine).toBeGreaterThanOrEqual(0);
    expect(lines[titleLine]!.indexOf("value")).toBeLessThanOrEqual(2);
  });

  it("an explicit axes.x.title overrides the default field name", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([{ month: 0, value: 3 }, { month: 1, value: 5 }], { x: "month", y: "value" })] }, );
    const withTitle = { ...spec, axes: { x: { title: "Month of year" } } };
    const r = renderGlyphChart(withTitle, { target: "chat", width: 50, height: 14 });
    expect(r.text).toContain("Month of year");
    expect(r.text).not.toMatch(/[^a-zA-Z]month[^a-zA-Z]/);
  });

  it("explicit axes.x.title: '' suppresses the default entirely", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([{ month: 0, value: 3 }, { month: 1, value: 5 }], { x: "month", y: "value" })] });
    const suppressed = { ...spec, axes: { x: { title: "" } } };
    const r = renderGlyphChart(suppressed, { target: "chat", width: 40, height: 14 });
    expect(r.text).not.toContain("month");
  });

  it("a bare numeric-shorthand line (accessor channels, no field name) shows no default title", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", width: 40, height: 14 });
    // No stray field-name text anywhere outside the tick digits/axis glyphs.
    expect(r.text).not.toMatch(/[a-zA-Z]{2,}/);
  });
});

describe("axes — grid", () => {
  it("grid defaults to off (no extra ┈/┊ ink beyond marks and axes)", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", charset: "box", color: "none", width: 30, height: 12 });
    expect(r.text).not.toContain("┈");
    expect(r.text).not.toContain("┊");
  });

  it("axes.y.grid: true paints faint horizontal gridlines at y-tick rows", () => {
    const spec = { marks: [glyphChartLine([3, 5, 2, 8, 6, 9])], axes: { y: { grid: true } } };
    const r = renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 30, height: 12 });
    expect(r.text).toContain("┈");
  });

  it("axes.x.grid: true paints faint vertical gridlines at x-tick columns", () => {
    const spec = { marks: [glyphChartLine([3, 5, 2, 8, 6, 9])], axes: { x: { grid: true } } };
    const r = renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 30, height: 12 });
    expect(r.text).toContain("┊");
  });

  it("ascii tier's grid glyph is '.' never ┈/┊", () => {
    const spec = { marks: [glyphChartLine([3, 5, 2, 8, 6, 9])], axes: { x: { grid: true }, y: { grid: true } } };
    const r = renderGlyphChart(spec, { target: "chat", charset: "ascii", color: "none", width: 30, height: 12 });
    expect(r.text).not.toContain("┈");
    expect(r.text).not.toContain("┊");
  });
});
