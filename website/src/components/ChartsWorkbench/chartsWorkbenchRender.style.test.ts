// @vitest-environment node
//
// Unit tests for `applyChartStyle`/`chartsWorkbenchChartStyle` — the ONLY
// place the workbench writes `axes.color`/`axes.x.color`/`axes.y.color`
// and mark `options.color` into a spec (see `chartsWorkbenchRender.ts`'s
// own doc comment above both). Most of these assert on the returned SPEC
// OBJECT (cheap, and the merge logic itself has nothing to do with
// rendering); the "reaches a rendered span" describe block below goes
// through the real `renderGlyphChart` to prove the resulting spec's
// `options.color` is actually painted, not just present on the object —
// `@glyphcss/charts` has accepted both fields for real since the parent
// packet (`47fa302b`).
import { glyphChartArc, glyphChartLine, glyphChartPlot, renderGlyphChart } from "@glyphcss/charts";
import { describe, expect, it } from "vitest";
import { applyChartStyle, chartsWorkbenchChartStyle, type ChartsWorkbenchChartStyle } from "./chartsWorkbenchRender";
import { createChartsWorkbenchState, reduceChartsWorkbenchState } from "./chartsWorkbenchState";

describe("applyChartStyle", () => {
  const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3]), glyphChartArc([1, 2])] });

  it("is a no-op — same axes/marks references — for an empty style", () => {
    const styled = applyChartStyle(spec, {});
    expect(styled.axes).toBe(spec.axes);
    expect(styled.marks).toBe(spec.marks);
  });

  it("writes a single shared axes.color and leaves marks untouched", () => {
    const styled = applyChartStyle(spec, { axes: { color: "#7a7f8a" } });
    expect(styled.axes).toEqual({ color: "#7a7f8a" });
    expect(styled.marks).toBe(spec.marks);
  });

  it("writes per-axis x/y colours independently, preserving any existing axis options", () => {
    const withTicks = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])], axes: { x: { ticks: 4 }, y: { grid: true } } });
    const styled = applyChartStyle(withTicks, { axes: { x: { color: "#ff0000" }, y: { color: "#00ff00" } } });
    expect(styled.axes).toEqual({ x: { ticks: 4, color: "#ff0000" }, y: { grid: true, color: "#00ff00" } });
  });

  // Axis title placement (Dock item "Axis Title + Title at") — folds into
  // the SAME per-axis style object as colour (the generic `{ ...spec.axes?.x,
  // ...style.axes.x }` merge above needs no code change to carry it), and
  // independently of colour: one can be set with the other absent.
  it("writes titleAt alongside an unrelated axis colour, and alone with no colour at all", () => {
    const styled = applyChartStyle(spec, { axes: { x: { color: "#ff0000", titleAt: "end" }, y: { titleAt: "bottom" } } });
    expect(styled.axes).toEqual({ x: { color: "#ff0000", titleAt: "end" }, y: { titleAt: "bottom" } });
  });

  it("writes a single-string mark colour into that mark's options.color, by position", () => {
    const styled = applyChartStyle(spec, { markColors: [undefined, "#3b82f6"] });
    expect(styled.marks[0]).toBe(spec.marks[0]);
    expect(styled.marks[1]!.options).toEqual({ ...spec.marks[1]!.options, color: "#3b82f6" });
  });

  it("writes a per-series colour array unchanged", () => {
    const styled = applyChartStyle(spec, { markColors: [["#3b82f6", "#f97316"], undefined] });
    expect(styled.marks[0]!.options).toEqual({ ...spec.marks[0]!.options, color: ["#3b82f6", "#f97316"] });
    expect(styled.marks[1]).toBe(spec.marks[1]);
  });

  it("mutation: an all-undefined markColors array is still a no-op (the `.some` guard actually discriminates)", () => {
    const styled = applyChartStyle(spec, { markColors: [undefined, undefined] });
    expect(styled.marks).toBe(spec.marks);
  });
});

describe("chartsWorkbenchChartStyle", () => {
  it("omits axes entirely at the default shared colour — byte-identical to the feature not existing", () => {
    const style = chartsWorkbenchChartStyle(createChartsWorkbenchState());
    expect(style.axes).toBeUndefined();
  });

  it("reports a shared colour once customised", () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-axis-color", which: "shared", color: "#123456" });
    expect(chartsWorkbenchChartStyle(state).axes).toEqual({ color: "#123456" });
  });

  it("reports per-axis colours only in per-axis mode", () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-axis-color-mode", mode: "per-axis" });
    state = reduceChartsWorkbenchState(state, { type: "set-axis-color", which: "x", color: "#111111" });
    const style: ChartsWorkbenchChartStyle = chartsWorkbenchChartStyle(state);
    expect(style.axes).toEqual({ x: { color: "#111111" }, y: { color: expect.any(String) } });
  });

  it("carries every mark's own colour in mark order", () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "add-mark" });
    state = reduceChartsWorkbenchState(state, { type: "set-mark-color", id: state.marks[1]!.id, color: "#abcdef" });
    expect(chartsWorkbenchChartStyle(state).markColors).toEqual([undefined, "#abcdef"]);
  });

  // Axis title placement (Dock item "Axis Title + Title at").
  it("omits titleAt entirely at the library's own default (center/top)", () => {
    const style = chartsWorkbenchChartStyle(createChartsWorkbenchState());
    expect(style.axes).toBeUndefined();
  });

  it("reports a non-default x titleAt independently of y, and of colour", () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-axis-title-at", axis: "x", value: "end" });
    expect(chartsWorkbenchChartStyle(state).axes).toEqual({ x: { titleAt: "end" } });
  });

  it("reports both axes' titleAt together with a shared axis colour", () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-axis-color", which: "shared", color: "#123456" });
    state = reduceChartsWorkbenchState(state, { type: "set-axis-title-at", axis: "y", value: "bottom" });
    expect(chartsWorkbenchChartStyle(state).axes).toEqual({ color: "#123456", y: { titleAt: "bottom" } });
  });
});

// P3-2 (REVIEW-dock-colours-sliders-opus.md): the axis half of this feature
// was already proven end-to-end through a real render (`ChartsWorkbench.test.tsx`'s
// "an axis colour picked in the Dock reaches the HTML preview's own axis
// span colour"); nothing exercised the MARK half the same way — every test
// above stops at the built spec object, which cannot tell a colour that's
// merely PRESENT on `options.color` from one the painter actually used.
describe("a mark colour set through applyChartStyle reaches a rendered span", () => {
  it("a single-string mark colour paints the mark's own cells", () => {
    const spec = applyChartStyle(glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])] }), { markColors: ["#3b82f6"] });
    const result = renderGlyphChart(spec, { target: "web", width: 24, height: 8 });
    expect(result.html).toContain("#3b82f6");
  });

  it("a per-series colour array paints each series with its own colour", () => {
    const spec = applyChartStyle(
      glyphChartPlot({ marks: [{ type: "bar", data: [{ x: "a", y: 1, region: "N" }, { x: "a", y: 2, region: "S" }], channels: { x: "x", y: "y", fill: "region" } }] }),
      { markColors: [["#ff0000", "#00ff00"]] },
    );
    const result = renderGlyphChart(spec, { target: "web", width: 24, height: 8 });
    expect(result.html).toContain("#ff0000");
    expect(result.html).toContain("#00ff00");
  });
});

// Axis title placement (Dock item "Axis Title + Title at") reaches a real
// render the same way mark colour above does — `@glyphcss/charts` has
// accepted `axes.x.titleAt`/`axes.y.titleAt` for real since the parent
// packet (bffc797a); mirrors this file's own mark-colour precedent above.
describe("an axis titleAt set through applyChartStyle reaches a rendered column", () => {
  it("moves the rendered x-title text to a later column than the library's own center default", () => {
    const data = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 4 }];
    const base = glyphChartPlot({ marks: [glyphChartLine(data, { x: "x", y: "y" })], axes: { x: { title: "Month" } } });
    const centered = renderGlyphChart(base, { target: "web", width: 60, height: 24, color: "none" });
    const ended = renderGlyphChart(applyChartStyle(base, { axes: { x: { titleAt: "end" } } }), { target: "web", width: 60, height: 24, color: "none" });
    const columnOf = (text: string) => text.split("\n").find((row) => row.includes("Month"))!.indexOf("Month");
    expect(columnOf(ended.text)).toBeGreaterThan(columnOf(centered.text));
  });
});
