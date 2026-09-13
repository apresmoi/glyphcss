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
import { glyphChartBar, glyphChartCell, glyphChartFunnel, glyphChartLine, glyphChartSankey, normalizeGlyphChartInput } from "./spec";
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

describe("options.color (c)", () => {
  it("(c) a per-series array overrides both the painted series and its legend swatch", () => {
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }, { color: ["#123456", "#abcdef"] });
    const p = picture(mark, 24, 10, true);
    expect(p.layout.legend!.items.find((it) => it.label === "A")?.color).toBe("#123456");
    expect(p.layout.legend!.items.find((it) => it.label === "B")?.color).toBe("#abcdef");
    const colors = new Set(p.canvas.grid.color!.filter(Boolean));
    expect(colors).toContain("#123456");
    expect(colors).toContain("#abcdef");
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
    expect(rOverride.grid).toEqual(rBase.grid);
  });
});

describe("validation (e)", () => {
  const ajv = new Ajv2020({ strict: false, strictNumbers: true });
  const validate = ajv.compile(glyphChartJsonSchema());

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

  it("no entry when the array exactly matches (or is shorter than, cycling) the series count", () => {
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }, { color: ["#111111"] });
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
