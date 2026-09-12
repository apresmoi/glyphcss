import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { renderGlyphChart } from "./render";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartDot, glyphChartLine, glyphChartRect, glyphChartText } from "./spec";
import { layoutGlyphChart, scaleToCol, scaleToRow } from "./layout";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { paintGlyphChart } from "./paint";
import { normalizeGlyphChartInput } from "./spec";
import type { GlyphChartInput, GlyphChartCharset, GlyphChartSpec } from "./types";
import { categoricalSeriesData, stackedArea, signedCells, longBands, hourlyLine, categoricalDots, markFactories } from "./reviewFixtures";

function picture(input: GlyphChartInput, width: number, height: number, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input), marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: string[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  const at = (col: number, row: number) => canvas.grid.char[row * width + col];
  const atValue = (x: unknown, y: unknown) => at(scaleToCol(scales.x, layout.plot, x), scaleToRow(scales.y, layout.plot, y));
  return { canvas, layout, scales, ledger, at, atValue };
}

describe("exact Phase 1 review regressions", () => {
  it("1: all-zero bars at 20x8 have zero painted quantity cells", () => {
    // Mutation: retain inclusive coincident bar endpoints -> three nonzero bars.
    const r = renderGlyphChart(glyphChartBar([0, 0, 0]), { width: 20, height: 8 });
    expect(r.grid.char.filter((c) => c === "█")).toHaveLength(0);
  });
  it("1: all-zero pie at 20x6 is empty with EMPTY_TOTAL", () => {
    // Mutation: total || 1 plus last-slice fallback -> paints a full disc.
    const r = renderGlyphChart(glyphChartArc([0, 0, 0]), { width: 20, height: 6 });
    expect(r.grid.char.every((c) => c === " ")).toBe(true);
    expect(r.report.ledger).toContainEqual(expect.stringContaining("GLYPH_CHART_EMPTY_TOTAL"));
  });
  it("1: positive and negative bars exclude the zero baseline", () => {
    // Mutation: include baseline at either end -> invents an extra cell.
    const p = picture(glyphChartBar([-1, 1]), 20, 8);
    expect(p.atValue(0, 0)).toBe(" ");
    expect(p.atValue(1, 0)).toBe(" ");
    expect(p.atValue(0, -1)).toBe("█");
    expect(p.atValue(1, 1)).toBe("█");
  });
  it("2: log [1,10,100] at 24x8 paints three equally spaced dot rows", () => {
    // Mutation: force log to scaleLinear -> 1 and 10 occupy the same row.
    const r = renderGlyphChart({ marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" } } }, { width: 24, height: 8 });
    const rows = r.text.split("\n").flatMap((s, i) => s.includes("●") ? [i] : []);
    expect(rows).toHaveLength(3);
    expect(Math.abs((rows[1]! - rows[0]!) - (rows[2]! - rows[1]!))).toBeLessThanOrEqual(1);
  });
  it("2: sqrt [0,1,4] paints three equally spaced dot rows", () => {
    // Mutation: force sqrt to linear -> the middle dot sits at a quarter of the height.
    const r = renderGlyphChart({ marks: [glyphChartDot([0, 1, 4])], scales: { y: { type: "sqrt" } } }, { width: 24, height: 12 });
    const rows = r.text.split("\n").flatMap((s, i) => s.includes("●") ? [i] : []);
    expect(rows).toHaveLength(3);
    expect(Math.abs((rows[1]! - rows[0]!) - (rows[2]! - rows[1]!))).toBeLessThanOrEqual(1);
  });
  it.each([glyphChartBar, glyphChartRect])("2: explicit [5,10] rejects and inferred rect/bar includes zero (%#)", (factory) => {
    // Mutation: bypass explicit zero rule or omit rect from inference -> throws wrong/no rule or wrong cell-height ratio.
    expect(() => renderGlyphChart({ marks: [factory([5, 10])], scales: { y: { domain: [5, 10] } } }, { width: 24, height: 8 })).toThrow(expect.objectContaining({ code: "bar-domain-excludes-zero" }));
    const p = picture(factory([5, 10]), 24, 8);
    const heights = [0, 1].map((x) => Array.from({ length: 6 }, (_, y) => p.at(scaleToCol(p.scales.x, p.layout.plot, x), y)).filter((c) => c === "█").length);
    expect(heights[0]).toBeGreaterThan(1);
    expect(Math.abs(heights[0]! * 2 - heights[1]!)).toBeLessThanOrEqual(1);
  });
  it.each([[0, 100], [-1, 1]])("2: log domain %j throws log-domain", (a, b) => {
    // Mutation: feed zero/crossing domain to d3 -> empty geometry without a rule.
    expect(() => renderGlyphChart({ marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log", domain: [a, b] } } })).toThrow(expect.objectContaining({ code: "log-domain" }));
  });
  it("2: ISO time domains parse once and paint their endpoints", () => {
    // Mutation: cast JSON strings to Date -> untagged getTime failure; ignore domain -> endpoint moves.
    const p = picture({ marks: [glyphChartDot([{ x: "2026-01-01", y: 1 }, { x: "2026-01-02", y: 2 }], { x: "x", y: "y" })], scales: { x: { type: "time", domain: ["2026-01-01", "2026-01-02"] } } }, 24, 8);
    expect(p.atValue("2026-01-01", 1)).toBe("●");
    expect(p.atValue("2026-01-02", 2)).toBe("●");
  });
  it.each(["fill", "stroke"] as const)("3: %s splits the exact line into A and B without a false diagonal", (channel) => {
    // Mutation: paint all channel rows as one line -> ink appears in the empty middle rows.
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", [channel]: "s" });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    const p = picture(mark, 24, 10);
    for (const value of [4, 5, 6]) {
      const row = scaleToRow(p.scales.y, p.layout.plot, value);
      expect(r.text.split("\n")[row]!.slice(p.layout.plot.x0).trim()).toBe("");
    }
    expect(r.meta.series).toEqual(["A", "B"]);
    expect(r.text.split("\n").at(-1)).toMatch(/A.+B/);
    const coloured = picture(mark, 24, 10, true);
    expect(new Set(coloured.canvas.grid.color!.filter(Boolean)).size).toBe(2);
  });
  it("3: monochrome line styles cycle and dot series have distinct glyphs", () => {
    // Mutation: ignore styleIndex or dot-series identity -> all four pictures have one style.
    const rows = [1, 3, 5, 7].flatMap((y, i) => [0, 1].map((x) => ({ x, y, s: String(i) })));
    const r = renderGlyphChart(glyphChartLine(rows, { x: "x", y: "y", fill: "s" }), { width: 40, height: 14 });
    expect(r.text).toContain("──"); expect(r.text).toContain("── ──"); expect(r.text).toContain("·"); expect(r.text).toContain("══");
    const dots = picture(glyphChartDot(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }), 24, 10);
    expect(dots.atValue(0, 1)).toBe("●"); expect(dots.atValue(0, 8)).toBe("×");
  });
  it("3: NO_COLOR selects monochrome series styles and FORCE_COLOR restores colours", () => {
    // Mutation: leave colorEnabled true when the encoder suppresses ANSI -> dots lose series identity.
    const mark = glyphChartDot(categoricalSeriesData, { x: "x", y: "y", fill: "s" });
    const plain = renderGlyphChart(mark, { target: "terminal", env: { NO_COLOR: "0" } });
    expect(plain.text).not.toContain("\x1b");
    expect(plain.grid.char.slice(0, -plain.grid.cols)).toContain("×");
    const forced = renderGlyphChart(mark, { target: "terminal", env: { NO_COLOR: "0", FORCE_COLOR: "0" } });
    expect(forced.text).toContain("\x1b[");
    expect(forced.grid.char.slice(0, -forced.grid.cols)).not.toContain("×");
  });
  it("3: area series boundaries retain their monochrome styles", () => {
    // Mutation: leave area styles unused -> both boundaries remain solid fill.
    const r = renderGlyphChart(glyphChartArea(categoricalSeriesData, { x: "x", y: "y", fill: "s" }), { width: 40, height: 14 });
    expect(r.meta.series).toEqual(["A", "B"]);
    expect(r.text).toContain("A"); expect(r.text).toContain("B");
    expect(r.text.split("\n").slice(0, -3).join("\n")).toMatch(/[-_‾▔]/);
  });
  it("3: an area boundary cycles the same line styles as the series legend", () => {
    // Mutation: ignore area styleIndex -> the dashed/dotted/double boundaries become solid.
    const data = [1, 3, 5, 7].flatMap((y, i) => [0, 1].map((x) => ({ x, y, s: String(i) })));
    const p = picture(glyphChartArea(data, { x: "x", y: "y", fill: "s" }), 40, 18);
    const rowAt = (v: number) => Array.from({ length: p.layout.plot.x1 - p.layout.plot.x0 + 1 }, (_, i) => p.at(p.layout.plot.x0 + i, scaleToRow(p.scales.y, p.layout.plot, v))).join("");
    expect(rowAt(3)).toContain("█──█──"); expect(rowAt(5)).toContain("·█·"); expect(rowAt(7)).toContain("══");
  });
  it("4: the exact stacked area fills the full five-unit stack, with no sloping gap", () => {
    // Mutation: read original y rather than y0/y1 -> top two units remain empty.
    const p = picture(stackedArea, 24, 8);
    const { x0, x1, y0, y1 } = p.layout.plot;
    for (let y = y0; y < y1; y++) for (let x = x0; x <= x1; x++) expect(p.at(x, y)).toBe("█");
  });
  it.each([glyphChartArea, glyphChartBar])("4: stacked bounds own disjoint colours (%#)", (factory) => {
    // Mutation: paint every segment from 0, or connect separate stack layers -> wrong colour in lower/upper band.
    const mark = { ...factory([{ x: 0, y: 2, s: "A" }, { x: 1, y: 2, s: "A" }, { x: 0, y: 3, s: "B" }, { x: 1, y: 3, s: "B" }], { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" as const } };
    const p = picture(mark, 24, 14, true), col = scaleToCol(p.scales.x, p.layout.plot, 0);
    const colorAt = (y: number) => p.canvas.grid.color![scaleToRow(p.scales.y, p.layout.plot, y) * 24 + col];
    expect(colorAt(1)).toBe("#3b82f6"); expect(colorAt(4)).toBe("#f97316");
  });
  it("5: signed cells at 24x6 use an ordered diverging shade ramp", () => {
    // Mutation: Math.abs(value) -> negative and positive endpoints get the same glyph.
    const p = picture(signedCells, 24, 6);
    expect(["a", "b", "c"].map((x) => p.atValue(x, "v"))).toEqual([" ", "▒", "█"]);
  });
  it.each([[-10, -5, 0], [0, 5, 10]])("5: same-sign values %j use a shared sequential ramp", (a, b, c) => {
    // Mutation: normalize each cell independently or take absolute values -> ordered shades differ.
    const mark = { ...signedCells, data: [a, b, c].map((v, i) => ({ x: String(i), y: "v", v })) };
    const p = picture(mark, 24, 6);
    expect([0, 1, 2].map((x) => p.atValue(String(x), "v"))).toEqual([" ", "▒", "█"]);
  });
  it("5: separate cell marks share one ramp", () => {
    // Mutation: compute shade domain per mark -> both positive values become maximum shade.
    const p = picture([ { ...signedCells, data: [{ x: "a", y: "v", v: 5 }] }, { ...signedCells, data: [{ x: "b", y: "v", v: 10 }] } ], 24, 6);
    expect(p.atValue("a", "v")).toBe("▒"); expect(p.atValue("b", "v")).toBe("█");
  });
  it.each(markFactories.flatMap((factory) => [[20, 6], [40, 10], [80, 24]].map(([width, height]) => ({ factory, width: width!, height: height!, name: factory([-1, 1]).type }))))("6: ASCII $name at $width x $height with negative data and labels", ({ factory, width, height }) => {
    // Mutations: Unicode minus/ellipsis, ● ASCII dots, or bypass canvas text fold -> byte gate fails.
    const mark = factory([-1, 1]);
    const r = renderGlyphChart({ marks: [mark], title: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcd café …" }, { charset: "ascii", width, height });
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(r.text.split("\n")).toHaveLength(height);
    expect(r.text.split("\n").every((row) => row.length === width)).toBe(true);
  });
  it("6: exact ASCII title and text mark fold to budgeted strings", () => {
    // Mutation: use a one-cell ellipsis budget or retain precomposed é -> exact content differs.
    const r = renderGlyphChart({ marks: [glyphChartText([{ x: 0, y: 1, label: "café" }], { x: "x", y: "y", label: "label" })], title: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcd" }, { charset: "ascii", width: 24, height: 8 });
    expect(r.text.split("\n")[0]).toBe("ABCDEFGHIJKLMNOPQRSTU...");
    expect(r.text).toContain("cafe");
    const dots = renderGlyphChart(glyphChartDot([-1, 1]), { charset: "ascii", width: 20, height: 6 });
    expect(dots.grid.char.filter((c) => c === "o")).toHaveLength(2);
  });
  it("7: exact long band labels at 20x6 are abbreviated in slots, never clipped", () => {
    // Mutation: pass raw labels directly to canvas -> clipped middles, no abbreviation ledger.
    const r = renderGlyphChart(longBands, { width: 20, height: 6 });
    expect(r.text.split("\n").at(-1)).toMatch(/abc.*….*sec.*…/);
    expect(r.report.ledger.filter((s) => s.includes("abbreviated"))).toHaveLength(2);
  });
  it("7: two-hour time axis at 40x8 has distinct complete multi-scale labels", () => {
    // Mutation: fixed %b %d formatter -> repeated Jan 01 and clipped last label.
    const spec: GlyphChartSpec = { marks: [hourlyLine], scales: { x: { type: "time" } } };
    const p = picture(spec, 40, 8);
    expect(new Set(p.layout.xTicks.map((t) => t.label)).size).toBe(p.layout.xTicks.length);
    expect(p.layout.xTicks.length).toBeGreaterThan(1);
    const row = renderGlyphChart(spec, { width: 40, height: 8 }).text.split("\n").at(-1)!;
    for (const t of p.layout.xTicks) expect(row.slice(t.labelStart, t.labelStart + t.label.length)).toBe(t.label);
  });
  it("7/11: designed numeric and band collisions force tick thinning", () => {
    // Mutation: skip collision/stride thinning -> count and pairwise spans fail, even if d3's normal tick sets happen to fit.
    for (const band of [false, true]) {
      const spec = { marks: [glyphChartLine([1, 2])] }, marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, undefined);
      const crowded = { ...scales.x, type: band ? "band" as const : "linear" as const, ticks: () => Array.from({ length: 20 }, (_, i) => ({ value: i, fraction: i / 19, label: `long-${i}` })) };
      const ledger: string[] = [];
      const layout = layoutGlyphChart(spec, marks, { ...scales, x: crowded }, 40, 10, "auto", ledger);
      expect(layout.xTicks.length).toBeGreaterThan(0); expect(layout.xTicks.length).toBeLessThan(20);
      for (let i = 1; i < layout.xTicks.length; i++) expect(layout.xTicks[i]!.labelStart).toBeGreaterThan(layout.xTicks[i - 1]!.labelStart + layout.xTicks[i - 1]!.label.length);
      expect(ledger).toContainEqual(expect.stringContaining("ticks thinned"));
    }
  });
  it.each([{ width: 20.5, height: 6 }, { width: 0.5, height: 6 }, { width: 20, height: 6.5 }])("8: fractional dimensions $width x $height reject before canvas", (options) => {
    // Mutation: accept positive non-integers -> alternating grid widths or untagged canvas failure.
    expect(() => renderGlyphChart(glyphChartLine([1, 2]), options)).toThrow(expect.objectContaining({ code: "bad-size" }));
  });
  it("10: categorical y dots paint low and high on their bands", () => {
    // Mutation: filter dot rows by numeric(y) -> zero dots survive.
    const p = picture(categoricalDots, 24, 8);
    expect(p.atValue(0, "low")).toBe("●"); expect(p.atValue(1, "high")).toBe("●");
  });
});
