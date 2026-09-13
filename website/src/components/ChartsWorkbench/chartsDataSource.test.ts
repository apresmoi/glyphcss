import { describe, expect, it } from "vitest";
import { buildDatasetMark, profileChartsData, resolveChartsDataRows, topChartsRecommendation, xChannelIsDate } from "./chartsDataSource";
import { buildChartsWorkbenchSpec, createChartsWorkbenchState, reduceChartsWorkbenchState } from "./chartsWorkbenchState";

describe("resolveChartsDataRows", () => {
  it("resolves a stock dataset with no pipeline", () => {
    const result = resolveChartsDataRows({ kind: "dataset", id: "global-temperature" }, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.dataset?.id).toBe("global-temperature");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("reports an unknown dataset id", () => {
    const result = resolveChartsDataRows({ kind: "dataset", id: "nope" }, []);
    expect(result).toEqual({ ok: false, error: 'Unknown dataset "nope".' });
  });

  it("runs the pipeline on top of a stock dataset's rows", () => {
    const result = resolveChartsDataRows({ kind: "dataset", id: "world-population-by-country" }, [
      { kind: "filter", column: "country", operator: "==", value: "Germany" },
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows.every((r) => r.country === "Germany")).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("parses and pipelines custom CSV text", () => {
    const result = resolveChartsDataRows({ kind: "custom", raw: "a,b\n1,2\n3,4" }, []);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });

  it("selects/flattens custom nested JSON through the pipeline", () => {
    const raw = JSON.stringify({ items: [{ id: 1, meta: { name: "a" } }] });
    const result = resolveChartsDataRows({ kind: "custom", raw }, [{ kind: "select", path: "items[*]" }, { kind: "flatten" }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([{ id: 1, "meta.name": "a" }]);
  });

  it("surfaces a pipeline step error with its 1-based step number", () => {
    const result = resolveChartsDataRows({ kind: "custom", raw: "a\n1" }, [{ kind: "derive", column: "b", expression: "((" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/^Step 1: /);
  });
});

describe("profileChartsData / xChannelIsDate", () => {
  it("recommends line + flags the x channel as a date for the temperature dataset", () => {
    const result = resolveChartsDataRows({ kind: "dataset", id: "global-temperature" }, []);
    if (!result.ok) throw new Error(result.error);
    const { profile, recommendations } = profileChartsData(result.rows);
    expect(recommendations[0]!.mark).toBe("line");
    expect(xChannelIsDate(profile, "year")).toBe(true);
    expect(xChannelIsDate(profile, "anomaly_c")).toBe(false);
    expect(xChannelIsDate(profile, undefined)).toBe(false);
  });
});

describe("buildDatasetMark", () => {
  it("builds an editable mark carrying serialized rows and the chosen channels", () => {
    const rows = [{ year: "2020-01-01", anomaly_c: 1 }, { year: "2021-01-01", anomaly_c: 1.1 }];
    const mark = buildDatasetMark(7, "line", rows, { x: "year", y: "anomaly_c" });
    expect(mark.id).toBe(7);
    expect(mark.type).toBe("line");
    expect(mark.channels).toEqual({ x: "year", y: "anomaly_c", fill: undefined, label: undefined });
    expect(JSON.parse(mark.dataText)).toEqual(rows);
  });
});

// ── F1/P1-1 — Apply uses each STOCK dataset's own curated `recommended`
// mapping, never the general profiler's top pick ─────────────────────────
//
// Before this fix, `ChartsDataFolder.tsx`'s Apply button always committed
// `profiled.recommendations[0]` — the profiler's own ranking — even for a
// dataset that ships a curated `recommended` field naming a DIFFERENT
// mapping. `topChartsRecommendation` is the fix: it reads the dataset's own
// field when one exists. These two datasets are the review's own repro
// (`world-population-by-country`: profiler picks an unfilled line;
// `iris-flowers`: profiler picks a pie of summed sepal lengths) — both are
// tested end to end as the actual chart SPEC Apply produces, mirroring
// exactly what `ChartsDataFolder.tsx` now does (`topChartsRecommendation`
// -> `apply-data` -> `buildChartsWorkbenchSpec`).
describe("topChartsRecommendation (F1/P1-1)", () => {
  function applyDataset(id: string) {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "dataset", id } });
    const resolved = resolveChartsDataRows(state.data.source!, state.data.pipeline);
    if (!resolved.ok) throw new Error(resolved.error);
    const { profile, recommendations } = profileChartsData(resolved.rows);
    const top = topChartsRecommendation(resolved.dataset, profile, recommendations);
    if (!top) throw new Error("expected a top recommendation");
    state = reduceChartsWorkbenchState(state, { type: "apply-data", mark: top.mark, channels: top.channels, pipeline: top.pipeline });
    return { top, spec: buildChartsWorkbenchSpec(state) };
  }

  it("world-population-by-country: Apply produces a line filled by country, reading the dataset's curated mapping directly", () => {
    const { top, spec } = applyDataset("world-population-by-country");
    expect(top).toEqual({
      mark: "line", channels: { x: "year", y: "population", fill: "country", label: undefined },
      reason: expect.stringContaining("Population"),
    });
    expect(spec.marks[0]).toMatchObject({ type: "line", channels: { fill: "country" } });
  });

  it("iris-flowers: Apply produces a species-coloured scatter (dot), never a pie of summed sepal lengths", () => {
    const { top, spec } = applyDataset("iris-flowers");
    expect(top).toEqual({
      mark: "dot", channels: { x: "sepal_length_cm", y: "petal_length_cm", fill: "species", label: undefined },
      reason: expect.stringContaining("Iris"),
    });
    expect(spec.marks[0]).toMatchObject({ type: "dot", channels: { fill: "species" } });
    expect(spec.marks[0].type).not.toBe("arc");
  });

  it("a custom source (no curated mapping) still falls back to the profiler's own top pick", () => {
    const rows = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    const { profile, recommendations } = profileChartsData(rows);
    const top = topChartsRecommendation(undefined, profile, recommendations);
    expect(top).toEqual({
      mark: recommendations[0]!.mark, channels: recommendations[0]!.channels, reason: recommendations[0]!.reason,
      pipeline: recommendations[0]!.pipeline,
    });
  });

  it("no recommendation at all (empty rows) is null, not a crash", () => {
    expect(topChartsRecommendation(undefined, { rowCount: 0, columns: [] }, [])).toBeNull();
  });

  // N1 — a column-changing pipeline step (here: pivotLonger) can rename or
  // drop the very columns a dataset's curated `recommended` field names.
  // Applying it anyway used to render an empty chart (no marks painted, an
  // empty ledger, no error) — the curated mapping is now validated against
  // the pipelined OUTPUT columns and falls back to the profiler's own top
  // pick, with a `fallbackNotice` explaining why.
  it("falls back to the profiler's own top pick, with a fallbackNotice, when a pipeline step drops a curated column (N1)", () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "dataset", id: "world-population-by-country" } });
    state = reduceChartsWorkbenchState(state, { type: "set-pipeline", pipeline: [{ kind: "pivotLonger", idColumns: ["year"] }] });
    const resolved = resolveChartsDataRows(state.data.source!, state.data.pipeline);
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.rows[0] ? Object.keys(resolved.rows[0]) : []).not.toContain("population");
    const { profile, recommendations } = profileChartsData(resolved.rows);
    const top = topChartsRecommendation(resolved.dataset, profile, recommendations);
    if (!top) throw new Error("expected a fallback recommendation");
    // Never the curated mapping's own now-nonexistent columns.
    expect(top.channels.x).not.toBe("year");
    expect(top.channels.y).not.toBe("population");
    expect(top.fallbackNotice).toMatch(/pipeline changed the columns/i);
    // Applying it must actually render marks, not an empty chart.
    state = reduceChartsWorkbenchState(state, { type: "apply-data", mark: top.mark, channels: top.channels, pipeline: top.pipeline });
    const spec = buildChartsWorkbenchSpec(state);
    expect(spec.marks.length).toBeGreaterThan(0);
  });
});
