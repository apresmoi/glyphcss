// @vitest-environment node
//
// Unit tests for `applyChartStyle`/`chartsWorkbenchChartStyle` — the ONLY
// place the workbench writes `axes.color`/`axes.x.color`/`axes.y.color`
// and mark `options.color` into a spec (see `chartsWorkbenchRender.ts`'s
// own doc comment above both). Asserted on the returned SPEC OBJECT, never
// on a rendered chart's colours — the built `@glyphcss/charts` in this
// worktree doesn't accept these fields yet (`mark.options.color` throws
// `bad-options`), and the merge that adds them is a separate packet.
import { glyphChartArc, glyphChartLine, glyphChartPlot } from "@glyphcss/charts";
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
});
