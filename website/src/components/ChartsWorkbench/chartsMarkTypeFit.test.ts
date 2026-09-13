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
import {
  CHARTS_MARK_TYPE_RULES, chartsCandidateBindable, chartsMarkOmittedRows, chartsMarkTypeBase, chartsMarkTypeFitTable, chartsOmittedRowsNote, remoteDatasetRecommendationCheck,
} from "./chartsMarkTypeFit";
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

// ── Round 2 (codex + opus review of the fit table) ─────────────────────
// An ENABLED type must render: the fit table now builds each candidate
// through the page's own build path (`chartsBuildBoundMark`, which drops
// rows whose charted cells don't hold their column's type) and keeps it
// only if that mark renders.

const remote = (rows: TabularRow[], ref = "test/hostile") => reduceChartsWorkbenchState(createChartsWorkbenchState(), {
  type: "select-remote-dataset", ref, title: ref, description: "", source: { name: "t", url: "https://example.com" }, rows,
});
const enabled = (state: ChartsWorkbenchState) => CHART_MARK_TYPES.filter((t) => fitsOf(state)[t].fits);
const switchTo = (state: ChartsWorkbenchState, markType: (typeof CHART_MARK_TYPES)[number]) =>
  markType === state.marks[0]!.type ? state : reduceChartsWorkbenchState(state, { type: "set-mark-type", id: state.marks[0]!.id, markType });
/** The page's real render (web 96x32 braille, css colour), and it drew something. */
const renderedOk = (state: ChartsWorkbenchState): string => {
  const r = renderChartsWorkbenchState(state);
  if (!r.ok) return r.error;
  return r.report.ledger.some((e) => e.code === "empty-total") ? "empty-total" : "ok";
};

const day = (i: number) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const HOSTILE: Record<string, TabularRow[]> = {
  "nulls in a date column": Array.from({ length: 30 }, (_, i) => ({ day: i % 7 === 3 ? null : day(i), sales: 10 + ((i * 37) % 50), region: ["N", "S", "E"][i % 3]! })),
  "nulls in a number column": Array.from({ length: 30 }, (_, i) => ({ day: day(i), sales: i % 5 === 2 ? null : 10 + ((i * 37) % 50), cost: 5 + ((i * 11) % 23) })),
  "nulls in a category column": Array.from({ length: 6 }, (_, i) => ({ fuel: i === 2 ? null : ["Coal", "Gas", "Wind", "Solar", "Hydro", "Oil"][i]!, twh: [14, 31, 9, 22, 17, 40][i]! })),
  "nulls in a boolean column": Array.from({ length: 20 }, (_, i) => ({ member: i % 6 === 0 ? null : i % 2 === 0, spend: 20 + ((i * 13) % 40), visits: 1 + ((i * 7) % 9) })),
  "nulls in every column": Array.from({ length: 40 }, (_, i) => ({
    day: i % 9 === 1 ? null : day(i), sales: i % 9 === 4 ? null : 10 + ((i * 37) % 50), cost: i % 9 === 6 ? null : 3 + ((i * 17) % 29), region: i % 9 === 8 ? null : ["N", "S", "E", "W"][i % 4]!,
  })),
  "a category mixing numbers and strings": [{ c: 1, v: 5 }, { c: "B", v: 2 }, { c: 2, v: 9 }, { c: "D", v: 4 }],
  "a number column with a stray string": Array.from({ length: 12 }, (_, i) => ({ day: day(i * 30), v: i === 4 ? "n/a" : 3 + ((i * 7) % 11), w: 2 + ((i * 5) % 13) })),
  "a date column with a stray string": Array.from({ length: 12 }, (_, i) => ({ day: i === 5 ? "unknown" : day(i * 30), v: 3 + ((i * 7) % 11) })),
  "a single row": [{ day: day(0), region: "N", sales: 12, cost: 4 }],
  "a single numeric column": [{ value: 2 }, { value: 4 }, { value: 3 }],
  "a single category column": [{ name: "a" }, { name: "b" }, { name: "c" }],
  "text only": [{ a: "x", b: "y" }, { a: "z", b: "w" }, { a: "q", b: "r" }],
  "numbers only": Array.from({ length: 25 }, (_, i) => ({ height: 150 + ((i * 17) % 40), weight: 50 + ((i * 23) % 45), age: 20 + ((i * 7) % 50) })),
  "3,000 rows": Array.from({ length: 3000 }, (_, i) => ({ day: day(i), sales: 10 + ((i * 37) % 97), cost: 5 + ((i * 11) % 53), region: ["N", "S", "E"][i % 3]! })),
  "3,000 rows of one measure": Array.from({ length: 3000 }, (_, i) => ({ value: (i * 7) % 101 })),
  "a sankey with a null endpoint": [
    { source: "A", target: "B", flow: 5 }, { source: "B", target: "C", flow: 2 }, { source: "A", target: "C", flow: 9 }, { source: null, target: "C", flow: 4 },
  ],
  "a sankey with a null flow": [
    { source: "Coal", target: "Power", flow: 40 }, { source: "Gas", target: "Power", flow: 60 }, { source: "Power", target: "Homes", flow: null }, { source: "Power", target: "Industry", flow: 30 },
  ],
  "a sankey with duplicate edges": [
    { source: "A", target: "B", flow: 5 }, { source: "A", target: "B", flow: 3 }, { source: "B", target: "C", flow: 2 }, { source: "A", target: "C", flow: 9 },
  ],
  "an all-zero share column": [{ source: "Coal", twh: 0 }, { source: "Gas", twh: 0 }, { source: "Wind", twh: 0 }],
  "empty strings for missing values": Array.from({ length: 14 }, (_, i) => ({ month: i % 4 === 1 ? "" : day(i * 31), city: i % 5 === 3 ? "" : ["Oslo", "Rome"][i % 2]!, temp: i % 6 === 2 ? "" : -3 + ((i * 7) % 25) })),
};

describe("round 2: every ENABLED type renders on hostile remote data, and the current type is never stranded", () => {
  it.each(Object.keys(HOSTILE))("%s", (name) => {
    const rows = HOSTILE[name]!;
    const init = createChartsWorkbenchState();
    const state = remote(rows, `hostile/${name}`);
    const check = remoteDatasetRecommendationCheck(rows);
    // The page dispatches only when the check passes; the reducer selects
    // exactly then, and on a refusal nothing at all is enabled.
    expect(state.data.source?.kind === "remote").toBe(check.ok);
    if (!check.ok) {
      expect(state.marks).toEqual(init.marks);
      const table = chartsMarkTypeFitTable({ rows });
      expect(CHART_MARK_TYPES.filter((t) => table[t].fits)).toEqual([]);
      return;
    }
    expect(renderedOk(state)).toBe("ok");
    expect(fitsOf(state)[state.marks[0]!.type].fits).toBe(true);
    for (const type of enabled(state)) {
      const next = switchTo(state, type);
      expect(next.marks[0]!.type).toBe(type);
      expect(`${type}: ${renderedOk(next)}`).toBe(`${type}: ok`);
      // Never stranded: the type just installed is still enabled, and so is
      // the one it came from.
      expect(fitsOf(next)[type].fits).toBe(true);
      expect(fitsOf(next)[state.marks[0]!.type].fits).toBe(true);
    }
  }, 30_000);

  it("the suite reaches both outcomes: a refusal, and a chart that leaves rows out with a note", () => {
    expect(Object.values(HOSTILE).filter((rows) => !remoteDatasetRecommendationCheck(rows).ok).length).toBeGreaterThan(0);
    const noted = Object.entries(HOSTILE).filter(([name, rows]) => {
      const state = remote(rows, `hostile/${name}`);
      return state.data.source?.kind === "remote" && chartsMarkOmittedRows(fitsOf(state), state.marks[0]!) !== null;
    });
    expect(noted.length).toBeGreaterThan(3);
  }, 30_000);
});

describe("round 2: the codex repros", () => {
  it.each([1, 3, 3000])("a single numeric column (%i rows) draws over its index, like the tray's number lists", (n) => {
    const rows = n === 3 ? [{ value: 2 }, { value: 4 }, { value: 3 }] : Array.from({ length: n }, (_, i) => ({ value: (i * 7) % 101 }));
    const state = remote(rows, `value-only/${n}`);
    expect(state.marks[0]!.channels).toMatchObject({ x: "index", y: "value" });
    expect(JSON.parse(state.marks[0]!.dataText)).toEqual(rows.map((r) => r.value));
    expect(renderedOk(state)).toBe("ok");
    expect(enabled(state)).toEqual(["line", "area", "bar", "dot"]);
    for (const type of enabled(state)) expect(renderedOk(switchTo(state, type))).toBe("ok");
  }, 30_000);

  it("text-only records enable nothing: no placeholder bar whose click does nothing", () => {
    const rows: TabularRow[] = [{ a: "x", b: "y" }, { a: "z", b: "w" }, { a: "q", b: "r" }];
    const table = chartsMarkTypeFitTable({ rows });
    expect(CHART_MARK_TYPES.filter((t) => table[t].fits)).toEqual([]);
    expect(remoteDatasetRecommendationCheck(rows).ok).toBe(false);
  });

  it("dates with a null enable Line/Area/Bar/Dot, each renders, and the rail names the dropped row", () => {
    const rows: TabularRow[] = [{ d: "2024-01-01", v: 5 }, { d: null, v: 2 }, { d: "2024-01-03", v: 9 }];
    const state = remote(rows, "codex/dates-null");
    expect(enabled(state)).toEqual(["line", "area", "bar", "dot"]);
    for (const type of enabled(state)) {
      const next = switchTo(state, type);
      expect(renderedOk(next)).toBe("ok");
      const omitted = chartsMarkOmittedRows(fitsOf(next), next.marks[0]!);
      expect(omitted).toEqual({ count: 1, total: 3, columns: ["d"] });
      expect(chartsOmittedRowsNote(omitted!)).toBe("1 of 3 rows has no usable d and isn't drawn.");
    }
  });

  it("a category mixing numbers and strings enables Bar, which renders", () => {
    const state = remote([{ c: 1, v: 5 }, { c: "B", v: 2 }, { c: 2, v: 9 }], "codex/mixed-category");
    expect(enabled(state)).toContain("bar");
    const bar = switchTo(state, "bar");
    expect(renderedOk(bar)).toBe("ok");
    expect(JSON.parse(bar.marks[0]!.dataText).map((r: TabularRow) => r.c)).toEqual(["1", "B", "2"]);
  });

  it("three DAG edges plus a null-source edge enable Sankey, which renders without the null edge", () => {
    const state = remote([{ s: "A", t: "B", v: 5 }, { s: "B", t: "C", v: 2 }, { s: "A", t: "C", v: 9 }, { s: null, t: "C", v: 4 }], "codex/sankey-null");
    const sankey = switchTo(state, "sankey");
    expect(sankey.marks[0]!.type).toBe("sankey");
    expect(renderedOk(sankey)).toBe("ok");
    expect(JSON.parse(sankey.marks[0]!.dataText)).toHaveLength(3);
    expect(chartsMarkOmittedRows(fitsOf(sankey), sankey.marks[0]!)).toEqual({ count: 1, total: 4, columns: ["s"] });
  });

  it("a mark whose data holds nothing to drop carries no note", () => {
    const state = selected("olympics-2024-medals");
    expect(chartsMarkOmittedRows(fitsOf(state), state.marks[0]!)).toBeNull();
  });
});

describe("round 2: the opus findings", () => {
  it("P2-1: a remote dataset's fit reads its rows AS LOADED, so it matches the same rows vendored and survives a reshape", () => {
    const olympics = CHARTS_DATASETS.find((d) => d.id === "olympics-2024-medals")!;
    const vendored = selected(olympics.id);
    const loaded = remote(olympics.rows as TabularRow[], "opus/olympics-as-remote");
    expect(enabled(loaded)).toEqual(enabled(vendored));
    // The remote chart opens on a melted multi-measure bar; the dot of two
    // of its measures is still offered from the rows as loaded.
    expect(loaded.marks[0]!.channels).toMatchObject({ y: "value", fill: "measure" });
    const dot = switchTo(loaded, "dot");
    expect(dot.marks[0]!.type).toBe("dot");
    expect(renderedOk(dot)).toBe("ok");
    const back = switchTo(dot, "bar");
    expect(JSON.parse(back.marks[0]!.dataText)).toHaveLength(JSON.parse(loaded.marks[0]!.dataText).length);
  });

  it("P3-2: an all-zero share column does not enable Pie (it would draw an empty disc)", () => {
    const zeros: TabularRow[] = [{ k: "a", v: 0 }, { k: "b", v: 0 }, { k: "c", v: 0 }];
    expect(chartsMarkTypeFitTable({ rows: zeros }).arc.fits).toBe(false);
    expect(chartsMarkTypeFitTable({ rows: zeros.map((r, i) => ({ ...r, v: [5, 12, 7][i]! })) }).arc.fits).toBe(true);
  });

  it("P3-3: the fit memo keys a stable array by identity AND its curated mapping, and parsed rows by their text", () => {
    const olympics = CHARTS_DATASETS.find((d) => d.id === "olympics-2024-medals")!;
    const withCurated = chartsMarkTypeFitTable({ rows: olympics.rows, curated: olympics.recommended });
    const withoutCurated = chartsMarkTypeFitTable({ rows: olympics.rows });
    expect(withCurated.bar.fits && withCurated.bar.rank).toBe(-1);
    expect(withoutCurated.bar.fits && withoutCurated.bar.rank).not.toBe(-1);
    // Memoised: the same base twice is the same table object.
    expect(chartsMarkTypeFitTable({ rows: olympics.rows, curated: olympics.recommended })).toBe(withCurated);
    const series = chartsMarkTypeFitTable({ key: "mark:[1, 2, 3]", rows: [1, 2, 3] });
    const records = chartsMarkTypeFitTable({ key: "mark:records", rows: HOSTILE["nulls in a category column"]! });
    expect(series.arc.fits).toBe(false);
    expect(records.arc.fits).toBe(true);
    expect(chartsMarkTypeFitTable({ key: "mark:[1, 2, 3]", rows: [1, 2, 3] })).toBe(series);
  });

  it("P3-3: a type switch resets the scales to the new binding (a typed domain and a time x belong to the old columns)", () => {
    // 80 distinct days (past the 60-value date bar), so the bar is the
    // grouped sum of `amount` by region: a line over a time x, a bar over a
    // band x.
    const rows: TabularRow[] = Array.from({ length: 80 }, (_, i) => ({ day: day(i * 3), region: ["North", "South", "East", "West"][i % 4]!, amount: 40 + ((i * 37) % 60) }));
    const start = remote(rows, "opus/scale-reset");
    const line = switchTo(start, "line");
    expect(line.scales.x.type).toBe("time");
    const typed = reduceChartsWorkbenchState(line, { type: "set-scale", axis: "y", patch: { min: "0", max: "500" } });
    const bar = switchTo(typed, "bar");
    expect(bar.marks[0]!.channels.x).toBe("region");
    expect(renderedOk(bar)).toBe("ok");
    expect(bar.scales).toEqual({ x: { type: "auto", min: "", max: "" }, y: { type: "auto", min: "", max: "" } });
    expect(switchTo(bar, "line").scales.x.type).toBe("time");
  });
});
