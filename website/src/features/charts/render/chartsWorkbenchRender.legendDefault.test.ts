// @vitest-environment node
//
// A funnel/sankey labels every stage/node on the chart itself, so the library
// defaults their legend OFF. The workbench must not force one on: an unchosen
// legend rides in the spec as `undefined`, and only an explicit toggle wins.
import { describe, expect, it } from "vitest";
import { renderChartsWorkbenchState } from "./chartsWorkbenchRender";
import { buildChartsWorkbenchSpec, CHART_PRESETS, createChartsWorkbenchState } from "../model/chartsSpec";
import { chartsWorkbenchLegendControl, reduceChartsWorkbenchState } from "../model/chartsWorkbenchState";
import { decodeChartsUrlState, encodeChartsUrlState } from "../services/chartsUrlState";

function presetState(id: string, legend?: boolean) {
  let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id });
  state = { ...state, controls: { target: "chat", overrides: {} } };
  return legend === undefined ? state : reduceChartsWorkbenchState(state, { type: "set-chart", patch: { legend } });
}

function text(id: string, legend?: boolean): string {
  const rendered = renderChartsWorkbenchState(presetState(id, legend));
  if (!rendered.ok) throw new Error(rendered.error);
  return rendered.text;
}

describe("charts workbench legend default", () => {
  for (const id of ["funnel", "sankey"]) {
    it(`${id} follows the library default (no legend), explicit choice still wins`, () => {
      expect(buildChartsWorkbenchSpec(presetState(id)).legend).toBeUndefined();
      expect(text(id)).toBe(text(id, false));
      expect(text(id, true)).not.toBe(text(id, false));
    });
  }

  it("a bar chart keeps its legend by default", () => {
    expect(text("stacked-bar")).not.toBe(text("stacked-bar", false));
    expect(text("stacked-bar")).toBe(text("stacked-bar", true));
  });
});

describe("charts workbench legend choice is explicit", () => {
  const flow = ["funnel", "sankey"];
  const others = CHART_PRESETS.map((p) => p.id).filter((id) => !flow.includes(id));

  it("every non-flow preset paints the same by default as with an explicit legend", () => {
    for (const id of others) expect(text(id), id).toBe(text(id, true));
  });

  // Pinned list, not a count: each of these painted a legend before the
  // workbench stopped forcing one, so each must still differ from legend off.
  // Mutation: suppress unchosen single-series legends -> line, bar, area go red.
  const legendPresets = ["line", "multi-line", "bar", "stacked-bar", "stacked-area", "dot", "area", "pie", "donut", "heatmap", "line-rule"];
  it.each(legendPresets)("%s still shows its legend by default", (id) => {
    expect(others).toContain(id);
    expect(text(id)).not.toBe(text(id, false));
  });

  it("an explicit legend on survives a share-link round trip and a later funnel preset", async () => {
    const on = reduceChartsWorkbenchState(presetState("line"), { type: "set-chart", patch: { legend: true } });
    const restored = (await decodeChartsUrlState(await encodeChartsUrlState(on)))!;
    expect(restored.chart.legend).toBe(true);
    const funnel = reduceChartsWorkbenchState(restored, { type: "apply-preset", id: "funnel" });
    expect(buildChartsWorkbenchSpec(funnel).legend).toEqual({ placement: "bottom" });
  });

  it("an unchosen legend stays unchosen across a round trip", async () => {
    const restored = (await decodeChartsUrlState(await encodeChartsUrlState(presetState("funnel"))))!;
    expect(restored.chart.legend).toBeUndefined();
  });

  it("choosing a corner and then bottom keeps the legend on a funnel", () => {
    let state = presetState("funnel");
    state = reduceChartsWorkbenchState(state, { type: "set-chart", patch: { legendPlacement: "top-right" } });
    state = reduceChartsWorkbenchState(state, { type: "set-chart", patch: { legendPlacement: "bottom" } });
    expect(buildChartsWorkbenchSpec(state).legend).toEqual({ placement: "bottom" });
    expect(chartsWorkbenchLegendControl(state)).toEqual({ visible: true, shown: true });
  });

  it("the Legend control reflects the active chart: 2D funnel off, 3D hidden", () => {
    expect(chartsWorkbenchLegendControl(presetState("funnel"))).toEqual({ visible: true, shown: false });
    expect(chartsWorkbenchLegendControl(presetState("line"))).toEqual({ visible: true, shown: true });
    const threeD = reduceChartsWorkbenchState(presetState("funnel"), { type: "set-3d-dimension", dimension: "3d" });
    expect(threeD.dimension).toBe("3d");
    expect(chartsWorkbenchLegendControl(threeD).visible).toBe(false);
  });
});
