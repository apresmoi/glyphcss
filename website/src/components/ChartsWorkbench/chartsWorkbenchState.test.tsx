// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { glyphChartPlot, glyphChartScaleDomains, renderGlyphChartJson, type GlyphChartRenderOptions, type GlyphChartSpec } from "@glyphcss/charts";
import ChartsWorkbench from "./ChartsWorkbench";
// Standalone Vitest lacks Astro's core alias; use the real module behind it.
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
import {
  CHART_AXIS_COLOR_MODES, CHART_MARK_TYPES, CHART_PRESETS, CHARTS_CUSTOM_MAX_BYTES, CHARTS_DATASETS,
  CHARTS_DEFAULT_DENSITY, CHARTS_DENSITY_MAX, CHARTS_DENSITY_MIN, CHARTS_DENSITY_MIN_FONT_PX,
  buildChartsWorkbenchSpec, chartMarkFields, chartsDensitySliderMax, chartsNumberToScaleBound, chartsScaleBoundToNumber, chartsScaleSliderBounds,
  chartsTimeBoundDisplay, chartsTimeBoundFromDisplay, chartsWorkbenchDensity, chartsWorkbenchDensityLocked, chartsWorkbenchEffectiveDensity,
  chartsWorkbenchInferredDomains,
  chartsWorkbenchRenderOptions, createChartsWorkbenchState, findChartsDataset, generateChartsWorkbenchSnippets,
  reduceChartsWorkbenchState, resolveGlyphChartsWorkbenchControls, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";
import { renderChartsWorkbenchSpec, renderChartsWorkbenchState } from "./chartsWorkbenchRender";

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

  it("N5/P3-5: switching a mark carrying a stale transform to sankey/funnel never forwards it (no bad-options crash)", () => {
    // The "Stacked bar" preset's own mark still carries `transform: "stack"`
    // in its editable state; switching its TYPE to sankey/funnel without
    // touching the (now-disabled) Transform select used to forward it
    // straight into `bad-options` at render time.
    const stacked = presetState("stacked-bar");
    for (const type of ["sankey", "funnel"] as const) {
      const switched = reduceChartsWorkbenchState(stacked, { type: "update-mark", id: stacked.marks[0]!.id, patch: { type } });
      expect(switched.marks[0]!.transform).toBe("stack"); // stale state survives — the BUILDER must still ignore it.
      const built = buildChartsWorkbenchSpec(switched);
      expect(built.marks[0]).not.toHaveProperty("transform");
      expect(() => renderChartsWorkbenchSpec(switched)).not.toThrow();
    }
  });

  it("changes untouched target defaults while retaining explicit overrides, then resets them all", () => {
    let state = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "width", value: 72 } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "detail", value: "faithful" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "web" } });
    expect(resolveGlyphChartsWorkbenchControls(state.controls)).toEqual({ target: "web", width: 72, height: 32, color: "css", charset: "braille", cellAspect: 0.5859375, detail: "faithful" });
    const reset = reduceChartsWorkbenchState(state, { type: "reset-target" });
    expect(resolveGlyphChartsWorkbenchControls(reset.controls)).toEqual({ target: "web", width: 96, height: 32, color: "css", charset: "braille", cellAspect: 0.5859375 });
    expect(reset.controls.overrides).toEqual({});
    expect(reset.marks).toBe(state.marks);
  });

  // Density (the user's own framing — "like in the 3D renderers we have
  // the density sliders", AGENTS.md's "Per-mesh detail layers"): a
  // website-only render-grid multiplier, WEB only, that the state keeps
  // regardless of target so switching back to `web` restores it.
  describe("density", () => {
    it("defaults to 1 and is web-only — locked (and effectively 1) on chat/terminal", () => {
      const state = initial();
      expect(chartsWorkbenchDensity(state.controls)).toBe(CHARTS_DEFAULT_DENSITY);
      expect(chartsWorkbenchEffectiveDensity(state.controls)).toBe(1);
      expect(chartsWorkbenchDensityLocked("web")).toBe(false);
      expect(chartsWorkbenchDensityLocked("terminal")).toBe(true);
      expect(chartsWorkbenchDensityLocked("chat")).toBe(true);
    });

    it("set-control density rides in resolveGlyphChartsWorkbenchControls and survives a target switch", () => {
      let state = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "density", value: 2.5 } });
      expect(resolveGlyphChartsWorkbenchControls(state.controls).density).toBe(2.5);
      expect(chartsWorkbenchEffectiveDensity(state.controls)).toBe(2.5);
      state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "terminal" } });
      // The STATE keeps the dialed-in value even off web (task's own
      // framing: "switching back restores it") — only the EFFECTIVE value
      // (what actually reaches the render grid) drops to 1.
      expect(chartsWorkbenchDensity(state.controls)).toBe(2.5);
      expect(chartsWorkbenchEffectiveDensity(state.controls)).toBe(1);
      state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "web" } });
      expect(chartsWorkbenchEffectiveDensity(state.controls)).toBe(2.5);
    });

    it("reset-target clears the density override back to the default", () => {
      const dirty = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "density", value: 3 } });
      const reset = reduceChartsWorkbenchState(dirty, { type: "reset-target" });
      expect(reset.controls.overrides.density).toBeUndefined();
      expect(chartsWorkbenchDensity(reset.controls)).toBe(CHARTS_DEFAULT_DENSITY);
    });

    it("chartsWorkbenchRenderOptions scales width/height by density on web, and never off web", () => {
      let state = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "density", value: 2 } });
      state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "width", value: 40 } });
      state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "height", value: 10 } });
      const webOptions = chartsWorkbenchRenderOptions(state);
      expect(webOptions.width).toBe(80);
      expect(webOptions.height).toBe(20);
      // `density` is a website-only concept, never forwarded to the library's own options.
      expect(webOptions).not.toHaveProperty("density");
      // Explicit width/height/density overrides all survive a target
      // switch (`reduceGlyphChartsWorkbenchControls`'s own rule) — only the
      // EFFECTIVE density drops to 1 off web, so the same 40x10 override
      // renders unscaled on terminal and chat.
      const terminalState = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "terminal" } });
      const terminalOptions = chartsWorkbenchRenderOptions(terminalState);
      expect(terminalOptions.width).toBe(40);
      expect(terminalOptions.height).toBe(10);
      const chatState = reduceChartsWorkbenchState(terminalState, { type: "set-control", control: { type: "target", value: "chat" } });
      const chatOptions = chartsWorkbenchRenderOptions(chatState);
      expect(chatOptions.width).toBe(40);
      expect(chatOptions.height).toBe(10);
    });

    it("a fractional round (round(width×d)) rounds to the nearest cell rather than truncating or throwing", () => {
      let state = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "density", value: 1.25 } });
      state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "width", value: 41 } });
      // 41 * 1.25 = 51.25 -> rounds to 51
      expect(chartsWorkbenchRenderOptions(state).width).toBe(51);
    });

    // `@glyphcss/charts`' own `textScale` (AGENTS.md's "Charts" "Density"
    // paragraph) — `chartsWorkbenchRenderOptions` is the ONE place this
    // page decides `textScale: round(density)`.
    it("chartsWorkbenchRenderOptions carries textScale: round(density) on web, and OMITS it at density 1 (byte-identical to before textScale existed)", () => {
      const at1 = chartsWorkbenchRenderOptions(initial());
      expect(at1).not.toHaveProperty("textScale");

      const at2 = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "density", value: 2 } });
      expect(chartsWorkbenchRenderOptions(at2).textScale).toBe(2);

      // round(density), not density itself — a non-integer density (2.5)
      // still yields an integer textScale, matching `canvas.text`'s own
      // integer-scale contract.
      const at2point5 = reduceChartsWorkbenchState(initial(), { type: "set-control", control: { type: "density", value: 2.5 } });
      expect(chartsWorkbenchRenderOptions(at2point5).textScale).toBe(3); // round(2.5) === 3

      // Off web, effective density is always 1 regardless of the dialed-in
      // override, so textScale is omitted there too.
      const terminalAt2 = reduceChartsWorkbenchState(at2, { type: "set-control", control: { type: "target", value: "terminal" } });
      expect(chartsWorkbenchRenderOptions(terminalAt2)).not.toHaveProperty("textScale");
    });

    it("chartsDensitySliderMax caps at the legible floor, snapped to the step grid, never above CHARTS_DENSITY_MAX", () => {
      expect(chartsDensitySliderMax(13)).toBeCloseTo(13 / CHARTS_DENSITY_MIN_FONT_PX, 5); // 3.25 — already on the 0.25 grid
      expect(chartsDensitySliderMax(1000)).toBe(CHARTS_DENSITY_MAX); // never past the nominal ceiling
      expect(chartsDensitySliderMax(CHARTS_DENSITY_MIN_FONT_PX)).toBe(CHARTS_DENSITY_MIN); // no legible room at all — floor, not below it
    });
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
    const cellAspect = target === "web" ? 0.5859375 : 0.5;
    expect(emitted.options).toEqual({ target, width: 57, height: 19, charset: "ascii", detail: "faithful", cellAspect, color: target === "web" ? "css" : target === "terminal" ? "ansi16" : "none", ...(target === "terminal" ? { env: { NO_COLOR: "1", FORCE_COLOR: "1" } } : {}) });
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

describe("ChartsWorkbench colour controls — state", () => {
  it("defaults the axis colour to the shared muted-grey constant", () => {
    expect(initial().style).toEqual({
      axisColor: { mode: "shared", shared: CHARTS_AXIS_DEFAULT_COLOR, x: CHARTS_AXIS_DEFAULT_COLOR, y: CHARTS_AXIS_DEFAULT_COLOR },
      axisTitlePlacement: { x: "center", y: "top" },
    });
  });

  it("set-axis-color-mode/set-axis-color write only the addressed field", () => {
    let state = reduceChartsWorkbenchState(initial(), { type: "set-axis-color-mode", mode: "per-axis" });
    expect(state.style.axisColor.mode).toBe("per-axis");
    state = reduceChartsWorkbenchState(state, { type: "set-axis-color", which: "x", color: "#ff0000" });
    expect(state.style.axisColor).toEqual({ mode: "per-axis", shared: CHARTS_AXIS_DEFAULT_COLOR, x: "#ff0000", y: CHARTS_AXIS_DEFAULT_COLOR });
  });

  it("set-mark-color writes only the addressed mark", () => {
    const state = reduceChartsWorkbenchState(reduceChartsWorkbenchState(initial(), { type: "add-mark" }), { type: "set-mark-color", id: 1, color: "#123456" });
    expect(state.marks[0]!.color).toBe("#123456");
    expect(state.marks[1]!.color).toBeUndefined();
  });

  // P2-6 (REVIEW-dock-colours-sliders-opus.md): the Output header's reset
  // is scoped to OUTPUT settings ONLY — a hand-picked axis/mark colour or a
  // typed scale domain lives in the Chart/Scales folders and must survive
  // it, with no undo otherwise. `reset-chart-style` is the folder-scoped
  // reset for exactly those.
  it("reset-target touches ONLY controls — style and scale domains survive it untouched", () => {
    const clean = initial();
    let dirty = reduceChartsWorkbenchState(clean, { type: "set-axis-color", which: "shared", color: "#ff0000" });
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-mark-color", id: dirty.marks[0]!.id, color: "#00ff00" });
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-scale", axis: "y", patch: { min: "1", max: "9" } });
    const reset = reduceChartsWorkbenchState(dirty, { type: "reset-target" });
    expect(reset.style).toBe(dirty.style);
    expect(reset.marks).toBe(dirty.marks);
    expect(reset.scales).toBe(dirty.scales);
  });

  it("reset-chart-style clears axis colour, every mark's colour and every scale's typed domain, staying a no-op reference when nothing was customised", () => {
    const clean = initial();
    const untouched = reduceChartsWorkbenchState(clean, { type: "reset-chart-style" });
    expect(untouched.marks).toBe(clean.marks);
    expect(untouched.style).toBe(clean.style);
    expect(untouched.scales).toBe(clean.scales);
    expect(untouched.axes).toBe(clean.axes);

    let dirty = reduceChartsWorkbenchState(clean, { type: "set-axis-color", which: "shared", color: "#ff0000" });
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-mark-color", id: dirty.marks[0]!.id, color: "#00ff00" });
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-scale", axis: "y", patch: { min: "1", max: "9" } });
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-axis-title-at", axis: "x", value: "end" });
    // Ticks (Dock item "Ticks rows") are the OTHER Axes-folder setting this
    // reset reaches across folders for (REVIEW-dock-addenda-opus.md P3-3) —
    // `tickMarks`/`grid`/`title` are untouched, only the count.
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-axis", axis: "x", patch: { ticks: 12, grid: true } });
    dirty = reduceChartsWorkbenchState(dirty, { type: "set-axis", axis: "y", patch: { ticks: 8 } });
    const reset = reduceChartsWorkbenchState(dirty, { type: "reset-chart-style" });
    expect(reset.style).toEqual({
      axisColor: { mode: "shared", shared: CHARTS_AXIS_DEFAULT_COLOR, x: CHARTS_AXIS_DEFAULT_COLOR, y: CHARTS_AXIS_DEFAULT_COLOR },
      axisTitlePlacement: { x: "center", y: "top" },
    });
    expect(reset.marks[0]!.color).toBeUndefined();
    expect(reset.scales).toEqual({ x: { type: "auto", min: "", max: "" }, y: { type: "auto", min: "", max: "" } });
    expect(reset.axes.x.ticks).toBe(0);
    expect(reset.axes.y.ticks).toBe(0);
    // Only the tick COUNT resets — grid stays exactly as the reader left it.
    expect(reset.axes.x.grid).toBe(true);
    // Never touches output settings.
    expect(reset.controls).toBe(dirty.controls);
  });

  it("CHART_AXIS_COLOR_MODES is a non-empty vocabulary the Dock reads from", () => {
    expect(CHART_AXIS_COLOR_MODES).toEqual(["shared", "per-axis"]);
  });

  // Axis title placement (Dock item "Axis Title + Title at") — same
  // write-only-the-addressed-axis discipline `set-axis-color` already has.
  it("set-axis-title-at writes only the addressed axis", () => {
    let state = reduceChartsWorkbenchState(initial(), { type: "set-axis-title-at", axis: "x", value: "end" });
    expect(state.style.axisTitlePlacement).toEqual({ x: "end", y: "top" });
    state = reduceChartsWorkbenchState(state, { type: "set-axis-title-at", axis: "y", value: "bottom" });
    expect(state.style.axisTitlePlacement).toEqual({ x: "end", y: "bottom" });
  });
});

describe("chartsWorkbenchInferredDomains / scale bound conversion", () => {
  it("infers the numeric extent from mark data, ignoring any typed min/max", () => {
    const state = reduceChartsWorkbenchState(initial(), { type: "update-mark", id: initial().marks[0]!.id, patch: { dataText: "[3,5,2,8,6,9,4]" } });
    const withOverride = reduceChartsWorkbenchState(state, { type: "set-scale", axis: "y", patch: { min: "0", max: "1" } });
    expect(chartsWorkbenchInferredDomains(withOverride).y!.domain).toEqual(chartsWorkbenchInferredDomains(state).y!.domain);
  });

  it("degrades to undefined per-axis on invalid mark data rather than throwing", () => {
    const bad = reduceChartsWorkbenchState(initial(), { type: "update-mark", id: initial().marks[0]!.id, patch: { dataText: "not json" } });
    expect(chartsWorkbenchInferredDomains(bad)).toEqual({ x: undefined, y: undefined });
  });

  it("a failing Y (sign-crossing log) domain doesn't blank X's own, otherwise-valid inference", () => {
    const state = reduceChartsWorkbenchState(initial(), {
      type: "update-mark", id: initial().marks[0]!.id, patch: { dataText: "[-3,5,2]", channels: { x: "index", y: "value" } },
    });
    const withLogY = reduceChartsWorkbenchState(state, { type: "set-scale", axis: "y", patch: { type: "log" } });
    const inferred = chartsWorkbenchInferredDomains(withLogY);
    expect(inferred.x).toBeDefined();
    expect(inferred.x!.domain).toEqual(chartsWorkbenchInferredDomains(state).x!.domain);
    expect(inferred.y!.disabledReason).toBe("A log domain must have one sign and exclude zero.");
    // Tagged with the LINEAR reading, not a fabricated placeholder — real
    // numbers a disabled control can still show.
    expect(inferred.y!.domain).toEqual([-3, 5]);
  });

  it("round-trips a linear bound and a time bound through number<->string", () => {
    expect(chartsScaleBoundToNumber("linear", "42")).toBe(42);
    expect(chartsScaleBoundToNumber("linear", "")).toBeNull();
    expect(chartsScaleBoundToNumber("linear", "nope")).toBeNull();
    expect(chartsNumberToScaleBound("linear", 42)).toBe("42");
    const iso = "2024-06-01T00:00:00.000Z";
    expect(chartsScaleBoundToNumber("time", iso)).toBe(new Date(iso).getTime());
    expect(chartsNumberToScaleBound("time", new Date(iso).getTime())).toBe(iso);
  });
});

// P1-1/P1-2 (REVIEW-dock-colours-sliders-opus.md): the slider's own bounds
// must never admit a thumb position the library rejects. Both the
// zero-anchor cap and the log rule are gated at every value ON the boundary
// (0, and the exact `min(0,extent)`/`max(0,extent)` end) through a REAL
// render, not just the pure bounds arithmetic — a mutation that dropped
// either cap would still pass a pure-arithmetic-only assertion (the number
// itself only matters through what it lets a thumb reach).
// P2-2 (REVIEW-dock-colours-sliders-opus.md): the old pair was
// `toLocaleDateString()`/`new Date(raw)` — not inverses of each other, and
// locale-dependent (`de-DE`/`en-GB` both parsed the FORMATTED string back
// as `Invalid Date`, `en-US` shifted by the reader's own UTC offset).
describe("chartsTimeBoundDisplay / chartsTimeBoundFromDisplay", () => {
  it("round-trips a UTC-midnight timestamp exactly, independent of format/parse order", () => {
    const utcMidnight = Date.UTC(2024, 5, 15);
    expect(chartsTimeBoundDisplay(utcMidnight)).toBe("2024-06-15");
    expect(chartsTimeBoundFromDisplay(chartsTimeBoundDisplay(utcMidnight))).toBe(utcMidnight);
  });

  it("parses a plain YYYY-MM-DD as UTC midnight, never the reader's local timezone", () => {
    expect(chartsTimeBoundFromDisplay("2024-06-15")).toBe(Date.UTC(2024, 5, 15));
  });

  it("also accepts a full ISO string, and rejects garbage as null (not Invalid Date)", () => {
    expect(chartsTimeBoundFromDisplay("2024-06-15T00:00:00.000Z")).toBe(Date.UTC(2024, 5, 15));
    expect(chartsTimeBoundFromDisplay("15.6.2024")).toBeNull();
    expect(chartsTimeBoundFromDisplay("15/06/2024")).toBeNull();
    expect(chartsTimeBoundFromDisplay("")).toBeNull();
  });
});

describe("chartsScaleSliderBounds", () => {
  it("pads a zero-anchored (bar/area/rect) domain symmetrically, and caps each thumb at zero", () => {
    const bounds = chartsScaleSliderBounds("linear", 0, 8, true);
    expect(bounds.min).toBeCloseTo(-1.6);
    expect(bounds.max).toBeCloseTo(9.6);
    expect(bounds.loCeiling).toBe(0);
    expect(bounds.hiFloor).toBe(0);
    // Every legal render for this bound set keeps zero in the domain —
    // the low thumb can reach `bounds.min` but never past `loCeiling`,
    // the high thumb never below `hiFloor`.
    for (const lo of [bounds.min, bounds.loCeiling!, -0.4]) {
      for (const hi of [bounds.hiFloor!, 4, bounds.max]) {
        const spec = { marks: [{ type: "bar" as const, data: [1, 2, 3], channels: {}, options: {} }], scales: { y: { type: "linear" as const, domain: [lo, hi] } } };
        const rendered = renderChartsWorkbenchSpec(JSON.stringify(spec), { target: "web", width: 24, height: 8 });
        expect(rendered.ok, `lo=${lo} hi=${hi}: ${!rendered.ok ? rendered.error : ""}`).toBe(true);
      }
    }
  });

  it("a zero-anchored negative-only domain pads both ends the same span-relative amount", () => {
    const bounds = chartsScaleSliderBounds("linear", -8, 0, true);
    expect(bounds.min).toBeCloseTo(-9.6);
    expect(bounds.max).toBeCloseTo(1.6);
    expect(bounds.loCeiling).toBe(0);
    expect(bounds.hiFloor).toBe(0);
  });

  it("a log domain pads multiplicatively (never additively, which can cross zero)", () => {
    const bounds = chartsScaleSliderBounds("log", 1, 1000, false);
    expect(bounds.min).toBeCloseTo(1 / 1.2);
    expect(bounds.max).toBeCloseTo(1200);
    expect(bounds.loCeiling).toBeUndefined();
    for (const lo of [bounds.min, 1, 500]) {
      for (const hi of [500, 1000, bounds.max]) {
        if (lo >= hi) continue;
        const spec = { marks: [{ type: "line" as const, data: [1, 10, 100, 1000], channels: {}, options: {} }], scales: { y: { type: "log" as const, domain: [lo, hi] } } };
        const rendered = renderChartsWorkbenchSpec(JSON.stringify(spec), { target: "web", width: 24, height: 8 });
        expect(rendered.ok, `lo=${lo} hi=${hi}: ${!rendered.ok ? rendered.error : ""}`).toBe(true);
      }
    }
  });

  // NEW-1 (REVIEW-dock-colours-sliders-opus-round2.md): a log scale's own
  // sign/zero-exclusion rule (`log-domain`) has no ceiling/floor analogue
  // in the zero-anchored branch above — `loFloor`/`hiFloor` are the log
  // branch's OWN cap, small enough to leave a legitimately narrow typed
  // value (0.001 on this same [1, 1000] domain) reachable, per P2-1.
  it("a log domain's loFloor stays strictly positive and far below any realistic typed minimum, and sets no hiFloor (native-attribute-free)", () => {
    const bounds = chartsScaleSliderBounds("log", 1, 1000, false);
    expect(bounds.loFloor).toBeGreaterThan(0);
    expect(bounds.hiFloor).toBeUndefined();
    expect(bounds.loFloor!).toBeLessThan(0.001);
    // Mutation: a `loFloor` derived from `domainMax` instead of `domainMin`
    // (or hardcoded to `bounds.min`) would swallow this — pin it against a
    // domain where the two diverge by orders of magnitude.
    const wide = chartsScaleSliderBounds("log", 1e-3, 1e9, false);
    expect(wide.loFloor!).toBeGreaterThan(0);
    expect(wide.loFloor!).toBeLessThan(1e-3);
  });

  it("an ordinary (non-zero-anchored) scale keeps the original symmetric +/-20% pad, and sets no thumb cap", () => {
    const bounds = chartsScaleSliderBounds("linear", 2, 8, false);
    expect(bounds.min).toBeCloseTo(0.8);
    expect(bounds.max).toBeCloseTo(9.2);
    expect(bounds.loCeiling).toBeUndefined();
    expect(bounds.hiFloor).toBeUndefined();
  });

  // P1-4 (batch-3 review): a log domain need not be positive — only
  // zero-containing or sign-crossing domains are illegal (AGENTS.md's
  // "Charts") — but the log branch assumed `domainMin > 0` and fell back to
  // the POSITIVE fallback `Number.MIN_VALUE` for a negative domain, which
  // `RangeSlider`'s (pre-fix) unconditional `Math.max(next, loFloor)` then
  // used to push every negative committed value UP to a tiny POSITIVE one
  // — the reported `[null, 5e-324]` corruption of a Shift+ArrowLeft nudge
  // on `[-100, -10, -1]`. Mutation check: reverting the negative branch
  // (dropping the `domainMax < 0` special case) makes `bounds.loFloor`
  // come back `Number.MIN_VALUE` (positive) instead of a small NEGATIVE
  // value, and the render loop below (which pins the actual end-to-end
  // guarantee — every legal lo/hi pair on this domain renders without
  // `log-domain`) fails once `RangeSlider`'s sign-aware clamp is exercised
  // through `commit`'s own `Math.max`/`Math.min` split.
  it("a negative-only log domain pads outward (never through zero) and caps both ends at a small NEGATIVE ceiling, never a positive floor", () => {
    const bounds = chartsScaleSliderBounds("log", -100, -1, false);
    expect(bounds.min).toBeCloseTo(-120); // -100 * 1.2 — more negative, away from zero
    expect(bounds.max).toBeCloseTo(-1 / 1.2); // -1 / 1.2 — closer to zero, mirroring the positive branch's domainMin/1.2
    expect(bounds.loFloor).toBeDefined();
    expect(bounds.loFloor!).toBeLessThan(0); // a ceiling near zero from the negative side, never Number.MIN_VALUE (positive)
    expect(bounds.hiFloor).toBeUndefined();
    expect(bounds.loCeiling).toBeUndefined();
    for (const lo of [bounds.min, -100, -50]) {
      for (const hi of [-50, -1, bounds.max]) {
        if (lo >= hi) continue;
        const spec = { marks: [{ type: "line" as const, data: [-100, -10, -1], channels: {}, options: {} }], scales: { y: { type: "log" as const, domain: [lo, hi] } } };
        const rendered = renderChartsWorkbenchSpec(JSON.stringify(spec), { target: "web", width: 24, height: 8 });
        expect(rendered.ok, `lo=${lo} hi=${hi}: ${!rendered.ok ? rendered.error : ""}`).toBe(true);
      }
    }
  });
});

// P1-5 (batch-3 review), carried forward to `select-dataset`: the reducer
// installs an explicit `scales.x.type: "time"` whenever the resolved x
// channel profiles as `date` (`xChannelIsDate`), normalizing the mark's own
// x column through `normaliseDateColumn` BEFORE installing the scale so the
// two never disagree about what the column contains — `bad-time-domain`
// otherwise. The original P1-5 repro (a slash-date/bare-`YYYY-MM` CUSTOM
// paste) is no longer reachable at all — "Custom…" and Apply are gone
// (AGENTS.md's "Charts" — "Data layer"), and every vendored dataset's own
// date column is already canonical ISO (`normaliseDateColumn` is then a
// no-op) — so this pins the reachable half: a real dataset's date x-channel
// still installs the time scale and still renders.
describe("select-dataset — date x-channel installs a time scale (P1-5)", () => {
  it("co2-mauna-loa (monthly ISO dates): installs scales.x.type: 'time' and renders", () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "co2-mauna-loa" });
    expect(state.scales.x.type).toBe("time");
    expect(state.marks[0]!.channels.x).toBe("month");
    const rendered = renderChartsWorkbenchState(state);
    expect(rendered.ok, !rendered.ok ? rendered.error : "").toBe(true);
  });

  it("a non-date x channel (iris-flowers, numeric x) installs no time scale", () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    expect(state.scales.x.type).toBe("auto");
  });
});

// `select-dataset` — item 1's ONE reducer action replacing the old
// `set-data-source` + Apply pair: picking a dataset immediately replaces
// the chart with that dataset's own curated `recommended` mapping, no
// separate Apply step (AGENTS.md's "Charts" — "Data layer").
describe("select-dataset", () => {
  it("apply-preset clears a previously selected dataset's source (P2-1, REVIEW-showcase-opus.md) — the card, select and credit link must not describe a dataset while a tray preset's synthetic sample data is plotted", () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    expect(state.data.source).toEqual({ kind: "dataset", id: "iris-flowers" });
    state = reduceChartsWorkbenchState(state, { type: "apply-preset", id: "pie" });
    expect(state.data.source).toBeNull();
    expect(state.data.pipeline).toEqual([]);
  });
  it("installs the dataset's curated mark/channels, sets data.source, and resets scales/axes to auto", () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-axis", axis: "x", patch: { ticks: 6 } });
    state = reduceChartsWorkbenchState(state, { type: "select-dataset", id: "olympics-2024-medals" });
    expect(state.data.source).toEqual({ kind: "dataset", id: "olympics-2024-medals" });
    expect(state.data.pipeline).toEqual([]);
    expect(state.marks).toHaveLength(1);
    expect(state.marks[0]!.type).not.toBe("");
    expect(state.axes.x.ticks).toBe(0); // reset, not carried over from the previous dataset/preset
    const rendered = renderChartsWorkbenchState(state);
    expect(rendered.ok, !rendered.ok ? rendered.error : "").toBe(true);
  });

  it("sets the chart title/description to the dataset's own", () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    expect(state.chart.title).toBe(findChartsDataset("iris-flowers")!.title);
    expect(state.chart.description).toBe(findChartsDataset("iris-flowers")!.description);
  });

  it("switching datasets replaces the mark entirely (never accumulates)", () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    state = reduceChartsWorkbenchState(state, { type: "select-dataset", id: "olympics-2024-medals" });
    expect(state.marks).toHaveLength(1);
    expect(state.data.source).toEqual({ kind: "dataset", id: "olympics-2024-medals" });
  });

  it("an unknown dataset id is a no-op", () => {
    const start = createChartsWorkbenchState();
    const next = reduceChartsWorkbenchState(start, { type: "select-dataset", id: "not-a-real-dataset" });
    expect(next).toBe(start);
  });

  it("every vendored dataset resolves to a real, renderable chart", () => {
    for (const dataset of CHARTS_DATASETS) {
      const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: dataset.id });
      expect(state.marks.length, dataset.id).toBeGreaterThan(0);
      const rendered = renderChartsWorkbenchState(state);
      expect(rendered.ok, `${dataset.id}: ${!rendered.ok ? rendered.error : ""}`).toBe(true);
    }
  });
});

// ── N2 — the 256 KB custom-payload cap is enforced in the REDUCER itself,
// not only in `ChartsDataFolder.tsx`'s paste/upload handler ───────────────
//
// The original review's bypass went through that one component's own
// `onSelectDataset` (a dispatch with no size check at all); this test skips
// the component ENTIRELY and dispatches `set-data-source` directly, the way
// any OTHER caller — present or future — would. That is the actual
// guarantee N2 asks for: no dispatch path can install an oversized custom
// source, not "the one path the review happened to find". Mutation check:
// removing the reducer's own size guard (dispatching `action.source`
// unconditionally, the pre-fix shape) makes every assertion below go red —
// the oversized source is installed and `data.source.raw.length` comes back
// the huge string's own length instead of the PREVIOUS state being kept.
describe("reduceChartsWorkbenchState — set-data-source size cap (N2)", () => {
  it("refuses an oversized custom source dispatched directly, keeping the previous state untouched", () => {
    const start = createChartsWorkbenchState();
    const huge = "a,b\n" + "1,2\n".repeat(70_000); // well over CHARTS_CUSTOM_MAX_BYTES
    expect(new TextEncoder().encode(huge).length).toBeGreaterThan(CHARTS_CUSTOM_MAX_BYTES);
    const next = reduceChartsWorkbenchState(start, { type: "set-data-source", source: { kind: "custom", raw: huge, filename: "huge.csv" } });
    expect(next).toBe(start); // a true no-op — not merely an equal-looking object
    expect(next.data.source).toBeNull();
  });

  it("still installs a custom source AT or under the cap", () => {
    const start = createChartsWorkbenchState();
    const atCap = "a,b\n" + "1,2\n".repeat(10);
    expect(new TextEncoder().encode(atCap).length).toBeLessThan(CHARTS_CUSTOM_MAX_BYTES);
    const next = reduceChartsWorkbenchState(start, { type: "set-data-source", source: { kind: "custom", raw: atCap } });
    expect(next.data.source).toEqual({ kind: "custom", raw: atCap });
  });

  it("never refuses an already-omitted custom source (a decoded oversized link) regardless of its (empty) raw size", () => {
    const start = createChartsWorkbenchState();
    const next = reduceChartsWorkbenchState(start, { type: "set-data-source", source: { kind: "custom", raw: "", omitted: true, filename: "huge.csv" } });
    expect(next.data.source).toEqual({ kind: "custom", raw: "", omitted: true, filename: "huge.csv" });
  });
});
