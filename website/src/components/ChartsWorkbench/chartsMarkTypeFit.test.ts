// @vitest-environment node
// The mark card's Type toggle (`chartsMarkTypeFit.ts`; `docs/design/
// charts.md`'s "Mark-type fit"). The matrix is checked against the FROZEN
// diagnosis of what each pick did before the fit table existed
// (`fixtures/markTypeFitDiagnosis.json`, CHARTS-RESEARCH
// `DIAGNOSIS-mark-type-fit.md`), never against a rule re-derived here.
import { describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
import { buildChartCandidates } from "../../lib/chartCandidates";
import { profileRows } from "../../lib/dataProfile";
import type { TabularRow } from "../../lib/tabularParse";
import diagnosis from "./fixtures/markTypeFitDiagnosis.json";
import { CHARTS_MARK_TYPE_RULES, chartsCandidateBindable, chartsMarkTypeBase, chartsMarkTypeFitTable } from "./chartsMarkTypeFit";
import {
  CHART_MARK_TYPES, CHARTS_DATASETS, createChartsWorkbenchState, reduceChartsWorkbenchState, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { renderChartsWorkbenchState } from "./chartsWorkbenchRender";

const DIAGNOSIS = diagnosis as unknown as Record<string, Record<string, string>>;
const selected = (id: string) => reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id });
const fitsOf = (state: ChartsWorkbenchState) => chartsMarkTypeFitTable(chartsMarkTypeBase(state.data, state.marks[0]!));

describe("mark-type fit matrix — all 16 vendored datasets x 11 types", () => {
  it("covers every vendored dataset and every mark type in the frozen diagnosis", () => {
    expect(Object.keys(DIAGNOSIS).filter((k) => !k.startsWith("_")).sort()).toEqual(CHARTS_DATASETS.map((d) => d.id).sort());
    for (const d of CHARTS_DATASETS) expect(Object.keys(DIAGNOSIS[d.id]!).sort()).toEqual([...CHART_MARK_TYPES].sort());
  });

  describe.each(CHARTS_DATASETS.map((d) => ({ id: d.id })))("$id", ({ id }) => {
    const state = selected(id);
    const fits = fitsOf(state);

    it.each([...CHART_MARK_TYPES])("%s: enabled renders its own binding without throwing; disabled was diagnosed throwing, blank or meaningless", (type) => {
      const fit = fits[type];
      if (!fit.fits) {
        expect(DIAGNOSIS[id]![type]).not.toBe("meaningful");
        expect(fit.reason).toBe(CHARTS_MARK_TYPE_RULES[type].needs);
        return;
      }
      const next = type === state.marks[0]!.type ? state : reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: type });
      expect(next.marks[0]!.type).toBe(type);
      const rendered = renderChartsWorkbenchState(next);
      expect(rendered.ok ? "ok" : rendered.error).toBe("ok");
    });
  });

  it("a disabled type cannot be activated through the reducer either", () => {
    const state = selected("global-temperature");
    expect(fitsOf(state).sankey.fits).toBe(false);
    expect(reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: "sankey" })).toBe(state);
  });
});

describe("each dataset's own curated recommendation fits", () => {
  it.each(CHARTS_DATASETS.map((d) => ({ id: d.id, dataset: d })))("$id", ({ id, dataset }) => {
    const fit = fitsOf(selected(id))[dataset.recommended.mark];
    expect(fit.fits).toBe(true);
  });

  it("switching away and back restores the curated mapping, transform included", () => {
    const state = selected("energy-consumption-by-source");
    const away = reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: "line" });
    const back = reduceChartsWorkbenchState(away, { type: "set-mark-type", id: state.marks[0]!.id, markType: "area" });
    expect(back.marks[0]!.channels).toMatchObject({ x: "year", y: "twh", fill: "source" });
    expect(back.marks[0]!.transform).toBe("stack");
    // The data is the dataset's own date-normalised rows, so the `?c=` link
    // still omits it (`chartsUrlStateForEncode`'s byte-match).
    expect(back.marks[0]!.dataText).toBe(state.marks[0]!.dataText);
  });
});

describe("a type switch binds that type's top-ranked candidate", () => {
  it("sankey data switched to bar and heatmap gets real x/y channels, not the sankey's source/target/value", () => {
    const state = selected("energy-flow-sankey");
    const candidates = buildChartCandidates(profileRows(CHARTS_DATASETS.find((d) => d.id === "energy-flow-sankey")!.rows as TabularRow[]));
    for (const type of ["bar", "cell"] as const) {
      const top = candidates.find((c) => c.mark === type && chartsCandidateBindable(c))!;
      const next = reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: type });
      const bound = Object.fromEntries(Object.entries(next.marks[0]!.channels).filter(([, v]) => v !== undefined));
      expect(bound).toEqual(top.channels);
      expect(renderChartsWorkbenchState(next).ok).toBe(true);
    }
  });

  it("a time series switched to dot plots the same date and measure", () => {
    const state = selected("global-temperature");
    const next = reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: "dot" });
    expect(next.marks[0]!.channels).toMatchObject({ x: "year", y: "anomaly_c" });
    expect(next.scales.x.type).toBe("time");
  });

  it("a multi-measure bar is reshaped from the dataset's OWN rows, never from an earlier switch's reshape", () => {
    const state = selected("olympics-2024-medals");
    const toDot = reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: "dot" });
    expect(toDot.marks[0]!.channels).toMatchObject({ x: "silver", y: "bronze" });
    const toBar = reduceChartsWorkbenchState(toDot, { type: "set-mark-type", id: state.marks[0]!.id, markType: "bar" });
    // `bar` is olympics' curated type, so it comes back as the curated gold bar.
    expect(toBar.marks[0]!.channels).toMatchObject({ x: "country", y: "gold" });
    expect(JSON.parse(toBar.marks[0]!.dataText)).toHaveLength(10);
  });

  it("a tray sample series (bare numbers) binds index/value for the series types only", () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id: "line" });
    const fits = fitsOf(state);
    expect(CHART_MARK_TYPES.filter((t) => fits[t].fits)).toEqual(["line", "area", "bar", "dot"]);
    const next = reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType: "bar" });
    expect(next.marks[0]!.channels).toEqual({ x: "index", y: "value" });
    expect(renderChartsWorkbenchState(next).ok).toBe(true);
  });
});

describe("a remote dataset's chart is the ranker's top BINDABLE candidate", () => {
  // Every passenger class and sex repeats, so the best-scoring bar is a
  // MEAN of fare per sex — which the page's bare `group` would silently sum.
  const rows: TabularRow[] = Array.from({ length: 60 }, (_, i) => ({
    sex: i % 3 === 0 ? "female" : "male", embarked: ["S", "C", "Q"][i % 3]!, fare: 10 + ((i * 37) % 90), age: 20 + ((i * 13) % 50),
  }));
  it("never builds a mean-grouped candidate it cannot bind", () => {
    const candidates = buildChartCandidates(profileRows(rows));
    expect(candidates[0]!.transform).toEqual({ kind: "group", reduce: "mean" }); // the premise
    const best = candidates.find(chartsCandidateBindable)!;
    const next = reduceChartsWorkbenchState(createChartsWorkbenchState(), {
      type: "select-remote-dataset", ref: "test/remote", title: "t", description: "", source: { name: "t", url: "https://example.com" }, rows,
    });
    expect(next.marks[0]!.type).toBe(best.mark);
    expect(Object.fromEntries(Object.entries(next.marks[0]!.channels).filter(([, v]) => v !== undefined))).toEqual(best.channels);
  });
});
