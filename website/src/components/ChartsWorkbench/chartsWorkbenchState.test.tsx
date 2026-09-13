// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { glyphChartPlot, glyphChartScaleDomains, renderGlyphChartJson, type GlyphChartRenderOptions, type GlyphChartSpec } from "@glyphcss/charts";
import ChartsWorkbench from "./ChartsWorkbench";
// Standalone Vitest lacks Astro's core alias; use the real module behind it.
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
import {
  CHART_MARK_TYPES, CHART_PRESETS, buildChartsWorkbenchSpec, chartMarkFields, chartsWorkbenchRenderOptions,
  createChartsWorkbenchState, generateChartsWorkbenchSnippets, reduceChartsWorkbenchState,
  resolveGlyphChartsWorkbenchControls, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { renderChartsWorkbenchState } from "./chartsWorkbenchRender";

const initial = createChartsWorkbenchState;
const presetState = (id: string) => reduceChartsWorkbenchState(initial(), { type: "apply-preset", id });

describe("ChartsWorkbench state", () => {
  it("adds, updates and removes one mark without mutating its siblings or reusing ids", () => {
    const start = initial();
    const added = reduceChartsWorkbenchState(start, { type: "add-mark", markType: "dot" });
    expect(added.marks.map((mark) => mark.type)).toEqual(["line", "dot"]);
    expect(start.marks).toHaveLength(1);
    const updated = reduceChartsWorkbenchState(added, { type: "update-mark", id: added.marks[1]!.id,
      patch: { type: "area", dataText: "[9,2,6]", channels: { x: "index", y: "value" }, transform: "normalize" } });
    expect(updated.marks[0]).toBe(start.marks[0]);
    expect(buildChartsWorkbenchSpec(updated).marks[1]).toMatchObject({ type: "area", data: [9, 2, 6], channels: { x: [0, 1, 2], y: [9, 2, 6] }, transform: { kind: "normalize" } });
    const removed = reduceChartsWorkbenchState(updated, { type: "remove-mark", id: updated.marks[1]!.id });
    expect(removed.marks).toEqual(start.marks);
    expect(reduceChartsWorkbenchState(removed, { type: "add-mark" }).marks[1]!.id).toBeGreaterThan(added.marks[1]!.id);
  });

  it("replaces all marks on preset apply and preserves output overrides", () => {
    const state = reduceChartsWorkbenchState(presetState("line-rule"), { type: "set-control", control: { type: "charset", value: "ascii" } });
    const next = reduceChartsWorkbenchState(state, { type: "apply-preset", id: "stacked-bar" });
    expect(next.marks).toHaveLength(1);
    expect(next.marks[0]).toMatchObject({ type: "bar", transform: "stack" });
    expect(next.controls.overrides.charset).toBe("ascii");
    expect(state.marks).toHaveLength(2);
  });

  it("changes untouched target defaults while retaining explicit overrides, then resets them all", () => {
    let state = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "width", value: 72 } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "detail", value: "faithful" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "web" } });
    expect(resolveGlyphChartsWorkbenchControls(state.controls)).toEqual({ target: "web", width: 72, height: 32, color: "css", charset: "braille", detail: "faithful" });
    const reset = reduceChartsWorkbenchState(state, { type: "reset-target" });
    expect(resolveGlyphChartsWorkbenchControls(reset.controls)).toEqual({ target: "web", width: 96, height: 32, color: "css", charset: "braille" });
    expect(reset.controls.overrides).toEqual({});
    expect(reset.marks).toBe(state.marks);
  });

  it("retains invalid JSON drafts and renders an error until repaired", () => {
    const state = initial();
    const broken = reduceChartsWorkbenchState(state, { type: "update-mark", id: state.marks[0]!.id, patch: { dataText: "[" } });
    expect(broken.marks[0]!.dataText).toBe("[");
    expect(renderChartsWorkbenchState(broken)).toMatchObject({ ok: false, error: expect.stringContaining("Invalid JSON") });
    const fixed = reduceChartsWorkbenchState(broken, { type: "sample-mark", id: broken.marks[0]!.id });
    expect(renderChartsWorkbenchState(fixed).ok).toBe(true);
  });

  it.each(CHART_MARK_TYPES)("supplies a renderable %s sample and matching channel fields", (type) => {
    let state = initial();
    state = reduceChartsWorkbenchState(state, { type: "remove-mark", id: state.marks[0]!.id });
    state = reduceChartsWorkbenchState(state, { type: "add-mark", markType: type });
    expect(renderChartsWorkbenchState(state)).toMatchObject({ ok: true, text: expect.stringMatching(/\S/) });
    expect(chartMarkFields(state.marks[0]!).length).toBeGreaterThan(0);
  });

  it("infers either blank bound from transformed data, including stacked zero baselines", () => {
    const state = reduceChartsWorkbenchState(presetState("stacked-bar"), { type: "set-scale", axis: "y", patch: { max: "30" } });
    expect(buildChartsWorkbenchSpec(state).scales?.y).toEqual({ type: "linear", domain: [0, 30] });
    const minimum = reduceChartsWorkbenchState(presetState("stacked-bar"), { type: "set-scale", axis: "y", patch: { min: "-10" } });
    expect(buildChartsWorkbenchSpec(minimum).scales?.y).toEqual({ type: "linear", domain: [-10, 17] });
  });

  it("preserves intermediate band categories when domain endpoints are selected", () => {
    const state = reduceChartsWorkbenchState(presetState("bar"), { type: "set-scale", axis: "x", patch: { min: "Feb", max: "Apr" } });
    expect(buildChartsWorkbenchSpec(state).scales?.x).toEqual({ type: "band", domain: ["Feb", "Mar", "Apr"] });
  });

  it("axes: 0 ticks / empty title build to 'auto' (omitted), a real count/title is passed through", () => {
    const auto = buildChartsWorkbenchSpec(initial());
    expect(auto.axes?.x).toEqual({ tickMarks: true, grid: false });
    const state = reduceChartsWorkbenchState(
      reduceChartsWorkbenchState(initial(), { type: "set-axis", axis: "x", patch: { ticks: 4, title: "Month", grid: true } }),
      { type: "set-axis", axis: "y", patch: { tickMarks: false } },
    );
    const built = buildChartsWorkbenchSpec(state);
    expect(built.axes?.x).toEqual({ ticks: 4, tickMarks: true, title: "Month", grid: true });
    expect(built.axes?.y).toEqual({ tickMarks: false, grid: false });
  });

  // Owner packet items 1/2/3 — legend/title placement dispatch through the
  // existing generic "set-chart" action; this pins the reducer AND that
  // buildChartsWorkbenchSpec actually carries the chosen placement into the
  // built spec (never just into unused state), and that a render option
  // never reintroduces the plain-boolean default over it (`chartsWorkbenchRenderOptions`'s own doc).
  it("legend/title placement dispatch through set-chart and reach the built spec", () => {
    const defaultChart = buildChartsWorkbenchSpec(initial());
    expect(defaultChart.legend).toEqual({ placement: "bottom" });
    expect(defaultChart.title).toMatchObject({ align: "center", position: "top" });

    const state = reduceChartsWorkbenchState(initial(), {
      type: "set-chart",
      patch: { legendPlacement: "top-right", titleAlign: "left", titlePosition: "bottom" },
    });
    expect(state.chart.legendPlacement).toBe("top-right");
    expect(state.chart.titleAlign).toBe("left");
    expect(state.chart.titlePosition).toBe("bottom");
    const built = buildChartsWorkbenchSpec(state);
    expect(built.legend).toEqual({ placement: "top-right" });
    expect(built.title).toMatchObject({ align: "left", position: "bottom" });

    const options = chartsWorkbenchRenderOptions(state);
    expect(options).not.toHaveProperty("legend");
  });

  it("turning the legend off drops the placement object entirely, matching legend: false", () => {
    const state = reduceChartsWorkbenchState(
      reduceChartsWorkbenchState(initial(), { type: "set-chart", patch: { legendPlacement: "top-left" } }),
      { type: "set-chart", patch: { legend: false } },
    );
    expect(buildChartsWorkbenchSpec(state).legend).toBe(false);
  });

  it("applying a preset resets the axes controls to auto", () => {
    const withAxis = reduceChartsWorkbenchState(initial(), { type: "set-axis", axis: "x", patch: { ticks: 5, title: "custom" } });
    const reset = reduceChartsWorkbenchState(withAxis, { type: "apply-preset", id: "bar" });
    expect(reset.axes.x).toEqual({ ticks: 0, tickMarks: true, title: "", grid: false });
  });

  it("uses real log and time domains through the pure domain helper", () => {
    expect(glyphChartScaleDomains({ marks: [{ type: "line", data: [10, 10], channels: {} }], scales: { y: { type: "log" } } }).y.domain).toEqual([1, 100]);
    const time = glyphChartScaleDomains({ marks: [{ type: "line", data: [{ t: "2026-01-01", v: 1 }, { t: "2026-02-01", v: 3 }], channels: { x: "t", y: "v" } }], scales: { x: { type: "time" } } });
    expect(time.x.type).toBe("time");
    expect(time.x.domain.map((v) => (v as Date).toISOString())).toEqual(["2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"]);
  });

  it("feeds terminal env flags into the real ANSI render, with FORCE_COLOR precedence", () => {
    let state = reduceChartsWorkbenchState(presetState("multi-line"), { type: "set-control", control: { type: "target", value: "terminal" } });
    expect(renderChartsWorkbenchState(state)).toMatchObject({ ok: true, ansi: expect.stringContaining("\x1b[") });
    state = reduceChartsWorkbenchState(state, { type: "set-terminal", flag: "NO_COLOR", value: true });
    expect(renderChartsWorkbenchState(state)).toMatchObject({ ok: true, ansi: undefined });
    state = reduceChartsWorkbenchState(state, { type: "set-terminal", flag: "FORCE_COLOR", value: true });
    expect(renderChartsWorkbenchState(state)).toMatchObject({ ok: true, ansi: expect.stringContaining("\x1b[") });
  });
});

// Execute the emitted call itself. Comparing two calls to the same option
// selector would miss a generator that drops or misnames an output option.
function executeSnippet(state: ChartsWorkbenchState) {
  const snippets = generateChartsWorkbenchSnippets(state);
  let captured: { spec: GlyphChartSpec; options: GlyphChartRenderOptions; result: { text: string; html?: string } } | undefined;
  new Function("glyphChartPlot", "renderGlyphChart", snippets.typescript.replace(/^import[^\n]+\n/, ""))(glyphChartPlot,
    (spec: GlyphChartSpec, options: GlyphChartRenderOptions) => {
      captured = { spec, options, result: JSON.parse(renderGlyphChartJson(JSON.stringify(spec), options)) };
      return captured.result;
    });
  expect(captured).toBeDefined();
  return { ...captured!, json: snippets.json };
}

describe("ChartsWorkbench generated TypeScript", () => {
  it.each(["chat", "terminal", "web"] as const)("round-trips the emitted %s call through renderGlyphChartJson", (target) => {
    let state = presetState("multi-line");
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: target } });
    state = {
      ...state,
      controls: { target, overrides: { width: 57, height: 19, charset: "ascii", detail: "faithful", color: target === "web" ? "css" : target === "terminal" ? "ansi16" : "none" } },
      // `legend`'s placement rides in the built SPEC now (`buildChartsWorkbenchSpec`),
      // not in the render options — see `chartsWorkbenchRenderOptions`'s own doc.
      chart: { title: "Edited title", description: "Two regions", legend: true, legendPlacement: "bottom", titleAlign: "center", titlePosition: "top" },
      terminal: { NO_COLOR: true, FORCE_COLOR: true },
    };
    const emitted = executeSnippet(state);
    expect(emitted.options).toEqual({ target, width: 57, height: 19, charset: "ascii", detail: "faithful", color: target === "web" ? "css" : target === "terminal" ? "ansi16" : "none", ...(target === "terminal" ? { env: { NO_COLOR: "1", FORCE_COLOR: "1" } } : {}) });
    expect(JSON.parse(emitted.json)).toEqual(emitted.spec);
    const live = renderChartsWorkbenchState(state);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(emitted.result.text.replace(/\x1b\[[0-9;]*m/g, "")).toBe(live.text);
    if (target === "web") expect(emitted.result.html).toBe(live.display);
    expect(live.text.split("\n")).toHaveLength(19);
    expect(live.text.split("\n")[0]).toHaveLength(57);
  });
});

describe("final-gate-2 (Opus finding 1): the Heatmap tray preset paints every category", () => {
  it("no plot-body row is left as bare axis chrome with no cell ink — the bottommost category (whose label IS shown) and every row above the axis rule all carry real shade glyphs", () => {
    // Mutation: let `paintCell`'s row range include `xAxisLineRow` again
    // (the pre-fix `bandRowRange` behaviour) -> the bottommost category's
    // whole chunk collapses onto the axis line row, `paintAxes` (which runs
    // after `paintCell`) overwrites it, and that row shows only the axis
    // rule/corner glyph with zero shade ink -> red. `AM` and `PM` get
    // checked by their own visible tick label; `Noon`'s label is thinned by
    // the (unrelated, pre-existing) tick-collision logic at this size, so
    // its row is instead covered by the "every plot-body row" sweep below.
    let state = reduceChartsWorkbenchState(presetState("heatmap"), { type: "set-control", control: { type: "charset", value: "box" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "color", value: "none" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "width", value: 24 } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "height", value: 8 } });
    const rendered = renderChartsWorkbenchState(state);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const lines = rendered.text.split("\n");
    const shadeGlyphs = /[░▒▓█]/;
    for (const label of ["AM", "PM"]) {
      const line = lines.find((l) => l.includes(label));
      expect(line, `expected a tick-label row for "${label}" in:\n${rendered.text}`).toBeDefined();
      expect(line, `"${label}"'s own row carries no cell ink — only axis chrome:\n${rendered.text}`).toMatch(shadeGlyphs);
    }
    // The axis LINE row itself (the corner "└"/tick-junction "┴" row) is
    // chrome, not data — real ink never reaches it, and every plot-body
    // row strictly above it must carry ink (never bare axis characters).
    const axisRowIndex = lines.findIndex((l) => l.includes("└"));
    expect(axisRowIndex).toBeGreaterThan(0);
    const titleRowIndex = lines.findIndex((l) => l.includes("Heatmap"));
    for (let i = titleRowIndex + 1; i < axisRowIndex; i++) {
      expect(lines[i], `row ${i} between the title and the axis line has no cell ink:\n${rendered.text}`).toMatch(shadeGlyphs);
    }
  });
});

describe("ChartsWorkbench presets through the page", () => {
  it.each(CHART_PRESETS)("renders $label as nonempty 7-bit text in the actual viewport", (preset) => {
    let state = reduceChartsWorkbenchState(presetState(preset.id), { type: "set-control", control: { type: "charset", value: "ascii" } });
    // Plain-text assertion below; the page's own default colour (css, for
    // the web target) would otherwise wrap the preview in colour spans.
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "color", value: "none" } });
    const rendered = renderChartsWorkbenchState(state);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const page = renderToStaticMarkup(<ChartsWorkbench initialState={state} />);
    const preview = /<pre class="glyph-output"[^>]*>([\s\S]*?)<\/pre>/.exec(page)?.[1];
    expect(preview).toMatch(/\S/);
    expect(preview).toMatch(/^[\x00-\x7f]+$/);
    expect(preview).toBe(renderToStaticMarkup(<pre>{rendered.text}</pre>).slice(5, -6));
    expect(page).toContain("synth-shell dn-root dn-root--synth");
    expect(page).toContain('id="charts-controls-panel"');
    expect(page).toContain('aria-label="Chart presets"');
  });
});
