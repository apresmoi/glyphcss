/**
 * Colour options (AGENTS.md's "Charts" "Colours"): `spec.axes.color` /
 * `spec.axes.{x,y}.color` (defaulting to `GLYPH_CHART_AXIS_DEFAULT_COLOR`
 * when colour is on), and every mark's `options.color` (a single hex or a
 * per-series array, cycling if shorter). Mirrors `review.test.ts`'s own
 * `picture()` harness for exact grid/layout inspection alongside the public
 * `renderGlyphChart` HTML exit.
 */
import Ajv2020 from "ajv/dist/2020";
import { createGlyphCanvas } from "glyphcss";
import { describe, expect, it } from "vitest";
import { GLYPH_CHART_AXIS_DEFAULT_COLOR, layoutGlyphChart } from "./layout";
import { paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartBar, glyphChartCell, glyphChartDot, glyphChartFunnel, glyphChartLine, glyphChartSankey, glyphChartText, normalizeGlyphChartInput } from "./spec";
import { glyphChartJsonSchema } from "./schema";
import { GLYPH_CHART_VALIDATION_RULES, glyphChartRepairHint } from "./validate";
import { categoricalSeriesData } from "./reviewFixtures";
import type { GlyphChartCharset, GlyphChartInput, GlyphChartLedgerEntry, GlyphChartSpec } from "./types";

function picture(input: GlyphChartInput, width: number, height: number, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  return { canvas, layout, ledger };
}

/**
 * Count of cells INSIDE `layout.plot` (the actual data area — never the
 * legend, which sits outside it for the "bottom" placement used throughout
 * this file) carrying an exact colour. Used where a "mark ink" assertion
 * must not be satisfiable by the legend swatch painted in the same colour
 * (review finding P3-5: `colors.test.ts`'s own "overrides both the painted
 * series and its legend swatch" test asserted only the whole-canvas set,
 * which the swatch alone satisfies).
 */
function plotCellsWithColor(p: ReturnType<typeof picture>, color: string): number {
  let n = 0;
  for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) {
    for (let x = p.layout.plot.x0; x <= p.layout.plot.x1; x++) {
      if (p.canvas.grid.color![y * p.canvas.cols + x] === color) n++;
    }
  }
  return n;
}

describe("axes.color (a, b)", () => {
  it("(a) defaults to the muted colour; a line mark's own cells use the palette colour", () => {
    // Mutation: remove `?? GLYPH_CHART_AXIS_DEFAULT_COLOR` in
    // `resolveGlyphChartAxisColor` -> the y-axis cell below reads a
    // different value (or `undefined`) and this assertion reddens.
    const p = picture(glyphChartLine([1, 5, 2, 8]), 24, 10, true);
    expect(p.canvas.grid.color[p.layout.plot.y0 * 24 + p.layout.yAxisCol]).toBe(GLYPH_CHART_AXIS_DEFAULT_COLOR);
    const colors = new Set(p.canvas.grid.color!.filter(Boolean));
    expect(colors).toContain(GLYPH_CHART_AXIS_DEFAULT_COLOR);
    expect(colors).toContain("#3b82f6"); // the palette's own first colour.
  });

  it("(a) HTML exit: the axis and a data cell carry distinct, explicit span colours", () => {
    const r = renderGlyphChart(glyphChartLine([1, 5, 2, 8]), { target: "web", width: 24, height: 10 });
    expect(r.html).toContain(`color:${GLYPH_CHART_AXIS_DEFAULT_COLOR}`);
    expect(r.html).toContain("color:#3b82f6");
  });

  it("(b) spec.axes.color sets both axes; a per-axis axes.x/y.color overrides it", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartLine([1, 2, 3])], axes: { color: "#111111", x: { color: "#222222" } } };
    const p = picture(spec, 24, 10, true);
    expect(p.layout.xAxisColor).toBe("#222222");
    expect(p.layout.yAxisColor).toBe("#111111"); // falls back to the shared axes.color.
  });

  it("(b) with no override at all, both axes fall back to GLYPH_CHART_AXIS_DEFAULT_COLOR", () => {
    const p = picture(glyphChartLine([1, 2, 3]), 24, 10, true);
    expect(p.layout.xAxisColor).toBe(GLYPH_CHART_AXIS_DEFAULT_COLOR);
    expect(p.layout.yAxisColor).toBe(GLYPH_CHART_AXIS_DEFAULT_COLOR);
  });
});

describe("axes.color also colours gridlines, tick labels, and axis titles (P2-1)", () => {
  // AGENTS.md's "Charts" "Colours": axes.color covers "line, tick marks,
  // tick labels, title, and grid" — before this, only the axis LINE itself
  // (`colors.test.ts`'s own "(a)" case) had a positional gate; deleting the
  // `{ color }` argument from `paintGrid`'s tick-label/title writes left the
  // whole 901-test suite green (REVIEW-colours-opus.md's M5/M6/M7). Two
  // points positioned by an EXPLICIT scale domain so neither ever lands on
  // the probed cells below — every assertion is then reddened only by the
  // paint call it targets, never by mark ink crossing the same cell.
  const probeMark = glyphChartDot([{ x: 1, y: 3 }, { x: 2, y: 4 }], { x: "x", y: "y" });
  const domains = { scales: { x: { domain: [0, 5] as [number, number] }, y: { domain: [0, 10] as [number, number] } } };

  it("x axis: gridline, tick label, and title", () => {
    // Mutation: `paintGrid`'s xColor -> null redddens the gridline
    // assertion; the tick-label write losing `{ color }` reddens the
    // second; the title write losing it reddens the third.
    const spec: GlyphChartSpec = { marks: [probeMark], ...domains, axes: { x: { grid: true, title: "X title", color: "#111111" }, y: { color: "#222222" } } };
    const p = picture(spec, 40, 16, true);
    const idx = (x: number, y: number) => y * p.canvas.cols + x;
    expect(p.layout.xGrid).toBe(true);
    // Gridline: any x-tick column at the plot's TOP row — the y domain's
    // max (10) never coincides with the probe dots' own y values (3, 4),
    // and the top row is never `xAxisLineRow` (the y=0 row, at the BOTTOM
    // of a [0, 10] domain), so only the grid itself can have inked it.
    const xTick = p.layout.xTicks[0]!;
    expect(p.canvas.grid.color![idx(xTick.cell, p.layout.plot.y0)]).toBe("#111111");
    // Tick label: `xAxisLabelRow` is a dedicated row below the plot rect,
    // so it never collides with mark ink.
    expect(p.canvas.grid.color![idx(xTick.labelStart, p.layout.xAxisLabelRow)]).toBe("#111111");
    // Title: an explicit title always shows (AGENTS.md's "Charts" "Axes").
    expect(p.layout.xAxisTitleRow).toBeGreaterThanOrEqual(0);
    const titleCol = [...Array(p.canvas.cols).keys()].find((x) => p.canvas.grid.char[idx(x, p.layout.xAxisTitleRow)] !== " ")!;
    expect(p.canvas.grid.color![idx(titleCol, p.layout.xAxisTitleRow)]).toBe("#111111");
  });

  it("y axis: gridline, tick label, and title", () => {
    const spec: GlyphChartSpec = { marks: [probeMark], ...domains, axes: { x: { color: "#111111" }, y: { grid: true, title: "Y title", color: "#222222" } } };
    const p = picture(spec, 40, 16, true);
    const idx = (x: number, y: number) => y * p.canvas.cols + x;
    expect(p.layout.yGrid).toBe(true);
    // Gridline: a y-tick row other than the x-axis line's own row (which
    // `paintAxes` repaints in xColor, not yColor) at the plot's leftmost
    // column — neither probe dot (x = 1, 2 of a [0, 5] domain) lands there.
    const yTick = p.layout.yTicks.find((t) => t.cell !== p.layout.xAxisLineRow)!;
    expect(p.canvas.grid.color![idx(p.layout.plot.x0, yTick.cell)]).toBe("#222222");
    // Tick label: `labelStart` sits left of `yAxisCol`, outside the plot.
    expect(p.canvas.grid.color![idx(yTick.labelStart, yTick.cell)]).toBe("#222222");
    expect(p.layout.yAxisTitleRow).toBeGreaterThanOrEqual(0);
    expect(p.canvas.grid.color![idx(0, p.layout.yAxisTitleRow)]).toBe("#222222");
  });
});

describe("options.color (c)", () => {
  it("(c) a per-series array overrides both the painted series and its legend swatch", () => {
    // Mutation: `resolveSeriesColor` dropping `entry.color` (M9) must
    // redden THIS test, not just the funnel one below (review finding
    // P3-5) — asserted on cells INSIDE `layout.plot`, never satisfiable by
    // the legend swatch alone, which sits below the plot for this size.
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }, { color: ["#123456", "#abcdef"] });
    const p = picture(mark, 24, 10, true);
    expect(p.layout.legend!.items.find((it) => it.label === "A")?.color).toBe("#123456");
    expect(p.layout.legend!.items.find((it) => it.label === "B")?.color).toBe("#abcdef");
    expect(plotCellsWithColor(p, "#123456")).toBeGreaterThan(0);
    expect(plotCellsWithColor(p, "#abcdef")).toBeGreaterThan(0);
  });

  it("(c) a series NAME shared by two marks resolves to ONE colour everywhere (P2-2)", () => {
    // REVIEW-colours-opus.md's own repro: two line marks each carry a "B"
    // series with a different explicit override. The FIRST mark's colour
    // for "B" must win for both the legend swatch AND mark 2's own ink, and
    // the conflict must be reported — never a silent per-mark divergence.
    const d1 = [{ x: 0, y: 1, s: "A" }, { x: 1, y: 2, s: "A" }, { x: 0, y: 5, s: "B" }, { x: 1, y: 6, s: "B" }];
    const d2 = [{ x: 0, y: 3, s: "B" }, { x: 1, y: 4, s: "B" }, { x: 0, y: 8, s: "C" }, { x: 1, y: 9, s: "C" }];
    const spec: GlyphChartSpec = {
      marks: [
        glyphChartLine(d1, { x: "x", y: "y", stroke: "s" }, { color: ["#111111", "#222222"] }),
        glyphChartLine(d2, { x: "x", y: "y", stroke: "s" }, { color: ["#aa1111", "#aa2222"] }),
      ],
    };
    const p = picture(spec, 24, 10, true);
    expect(p.layout.legend!.items.find((it) => it.label === "B")?.color).toBe("#222222");
    // Mark 2's own "B" ink must agree with the legend — never its own
    // mark-local override (#aa1111).
    expect(plotCellsWithColor(p, "#222222")).toBeGreaterThan(0);
    expect(p.canvas.grid.color!.filter(Boolean)).not.toContain("#aa1111");
    expect(p.ledger).toContainEqual(expect.objectContaining({
      code: "series-color-conflict",
      detail: expect.objectContaining({ name: "B", kept: "#222222", rejected: "#aa1111" }),
    }));
  });

  it("(c) a single string broadcasts (cycles) to every series of that mark", () => {
    const mark = glyphChartBar(categoricalSeriesData, { x: "x", y: "y", fill: "s" }, { color: "#00ff00" });
    const p = picture(mark, 24, 10, true);
    expect(p.layout.legend!.items.map((it) => it.color)).toEqual(["#00ff00", "#00ff00"]);
  });

  it("(c) covers the sankey mark, per SOURCE NODE", () => {
    const mark = { ...glyphChartSankey([{ from: "A", to: "X", v: 1 }, { from: "B", to: "X", v: 1 }], { source: "from", target: "to", value: "v" }), options: { color: ["#101010", "#202020"] } };
    const p = picture(mark, 40, 12, true);
    expect(p.layout.legend!.items.find((it) => it.label === "A")?.color).toBe("#101010");
    expect(p.layout.legend!.items.find((it) => it.label === "B")?.color).toBe("#202020");
  });

  it("(c) covers the funnel mark, per STAGE", () => {
    const mark = glyphChartFunnel([1000, 500, 100], { color: ["#a1a1a1", "#b2b2b2", "#c3c3c3"] });
    const p = picture(mark, 40, 12, true, "box");
    const colors = new Set(p.canvas.grid.color!.filter(Boolean));
    expect(colors).toContain("#a1a1a1");
    expect(colors).toContain("#b2b2b2");
    expect(colors).toContain("#c3c3c3");
  });

  it("(c) cell: a 2-array on a diverging domain is [losses, gains]", () => {
    const data = [{ x: "a", y: "v", v: -10 }, { x: "b", y: "v", v: 10 }];
    const mark = glyphChartCell(data, { x: "x", y: "y", fill: "v" }, { color: ["#ff0000", "#00ff00"] });
    const p = picture(mark, 24, 10, true);
    const colors = new Set(p.canvas.grid.color!.filter(Boolean));
    expect(colors).toContain("#ff0000");
    expect(colors).toContain("#00ff00");
  });

  it("(c) a text mark's own label is painted in its color option (P3-2)", () => {
    // A `text` mark is a mark like any other — before this its label
    // was always plain, and `mark-color-unused` billed its one series a
    // USED slot it never actually consumed (review finding P3-2).
    const mark = glyphChartText([{ x: 0, y: 1, label: "hi" }], { x: "x", y: "y", label: "label" }, { color: "#123456" });
    const p = picture(mark, 24, 10, true);
    expect(plotCellsWithColor(p, "#123456")).toBeGreaterThan(0);
    const r = renderGlyphChart(mark, { width: 24, height: 10, color: "css" });
    expect(r.report.ledger.some((e) => e.code === "mark-color-unused")).toBe(false);
  });
});

describe("color: \"none\" byte-identity (d)", () => {
  it("is unaffected by axes.color/options.color — same spec renders identically with and without them", () => {
    const base: GlyphChartSpec = { marks: [glyphChartLine([1, 2, 3])] };
    const withOverrides: GlyphChartSpec = {
      marks: [glyphChartLine([1, 2, 3], undefined, { color: "#123456" })],
      axes: { color: "#111111", x: { color: "#222222" } },
    };
    const rBase = renderGlyphChart(base, { color: "none", width: 24, height: 10 });
    const rOverride = renderGlyphChart(withOverrides, { color: "none", width: 24, height: 10 });
    expect(rOverride.text).toBe(rBase.text);
    expect(rOverride.build.canvas.grid).toEqual(rBase.build.canvas.grid);
  });
});

describe("validation (e)", () => {
  const ajv = new Ajv2020({ strict: false, strictNumbers: true });
  const validate = ajv.compile(glyphChartJsonSchema());

  it("bad-axes rejects a non-object axes/axes.x at runtime AND via the JSON Schema (P3-3)", () => {
    // Ajv/runtime parity: `axes?.color`'s optional chaining used to accept
    // every one of these silently (review finding P3-3) while real Ajv
    // already rejected them — see `reviewFixtures.ts`'s own `bad-axes` rows.
    for (const badSpec of [
      { marks: [glyphChartLine([1, 2])], axes: null as never },
      { marks: [glyphChartLine([1, 2])], axes: "red" as never },
      { marks: [glyphChartLine([1, 2])], axes: { x: null } as never },
      { marks: [glyphChartLine([1, 2])], axes: { x: 5 } as never },
    ] satisfies GlyphChartSpec[]) {
      expect(() => renderGlyphChart(badSpec)).toThrow(expect.objectContaining({ code: "bad-axes" }));
      expect(validate(badSpec)).toBe(false);
    }
  });

  it("bad-axis-color rejects at runtime and via the JSON Schema — 'none' included", () => {
    const badAxes: GlyphChartSpec = { marks: [glyphChartLine([1, 2])], axes: { color: "none" as never } };
    expect(() => renderGlyphChart(badAxes)).toThrow(expect.objectContaining({ code: "bad-axis-color" }));
    expect(validate(badAxes)).toBe(false);
    expect(GLYPH_CHART_VALIDATION_RULES).toContain("bad-axis-color");
    expect(glyphChartRepairHint("bad-axis-color")).toBeTruthy();
  });

  it("bad-axis-color rejects a non-canonical per-axis colour (uppercase hex)", () => {
    const badAxes: GlyphChartSpec = { marks: [glyphChartLine([1, 2])], axes: { x: { color: "#ABCDEF" as never } } };
    expect(() => renderGlyphChart(badAxes)).toThrow(expect.objectContaining({ code: "bad-axis-color" }));
    expect(validate(badAxes)).toBe(false);
  });

  it("bad-mark-color rejects at runtime and via the JSON Schema", () => {
    const badMark: GlyphChartSpec = { marks: [glyphChartLine([1, 2], undefined, { color: "blue" as never })] };
    expect(() => renderGlyphChart(badMark)).toThrow(expect.objectContaining({ code: "bad-mark-color" }));
    expect(validate(badMark)).toBe(false);
    expect(GLYPH_CHART_VALIDATION_RULES).toContain("bad-mark-color");
    expect(glyphChartRepairHint("bad-mark-color")).toBeTruthy();
  });

  it("bad-mark-color rejects an empty array", () => {
    const badMark: GlyphChartSpec = { marks: [glyphChartBar([1, 2], undefined, { color: [] as never })] };
    expect(() => renderGlyphChart(badMark)).toThrow(expect.objectContaining({ code: "bad-mark-color" }));
    expect(validate(badMark)).toBe(false);
  });
});

describe("mark-color-unused (f)", () => {
  it("a mark's colour array longer than its own series count logs it, with the exact counts", () => {
    const mark = glyphChartLine([1, 2, 3], undefined, { color: ["#111111", "#222222", "#333333"] });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    expect(r.report.ledger).toContainEqual(expect.objectContaining({
      code: "mark-color-unused",
      detail: expect.objectContaining({ markType: "line", provided: 3, used: 1 }),
    }));
  });

  it("no entry when the array is shorter than the series count (cycling)", () => {
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }, { color: ["#111111"] });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    expect(r.report.ledger.some((e) => e.code === "mark-color-unused")).toBe(false);
  });

  it("no entry when the array length EXACTLY matches the series count (P3-1)", () => {
    // The `>` boundary itself, not the shorter/cycling case above — a
    // mutated `>` -> `>=` (review finding P3-1) reddens THIS test: it would
    // wrongly log `mark-color-unused` for a 2-colour array over exactly 2
    // series ("A", "B").
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }, { color: ["#123456", "#abcdef"] });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    expect(r.report.ledger.some((e) => e.code === "mark-color-unused")).toBe(false);
  });

  it("a diverging cell mark's array longer than 2 (losses+gains) logs it", () => {
    const data = [{ x: "a", y: "v", v: -5 }, { x: "b", y: "v", v: 5 }];
    const mark = glyphChartCell(data, { x: "x", y: "y", fill: "v" }, { color: ["#111111", "#222222", "#333333"] });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    expect(r.report.ledger).toContainEqual(expect.objectContaining({
      code: "mark-color-unused",
      detail: expect.objectContaining({ markType: "cell", provided: 3, used: 2 }),
    }));
  });

  it("a non-diverging cell mark's array longer than 1 (one ink colour) logs it", () => {
    const data = [{ x: "a", y: "v", v: 1 }, { x: "b", y: "v", v: 5 }];
    const mark = glyphChartCell(data, { x: "x", y: "y", fill: "v" }, { color: ["#111111", "#222222"] });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    expect(r.report.ledger).toContainEqual(expect.objectContaining({
      code: "mark-color-unused",
      detail: expect.objectContaining({ markType: "cell", provided: 2, used: 1 }),
    }));
  });

  it("a diverging cell mark's exact 2-array is fully used — no entry", () => {
    const data = [{ x: "a", y: "v", v: -5 }, { x: "b", y: "v", v: 5 }];
    const mark = glyphChartCell(data, { x: "x", y: "y", fill: "v" }, { color: ["#111111", "#222222"] });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    expect(r.report.ledger.some((e) => e.code === "mark-color-unused")).toBe(false);
  });
});
