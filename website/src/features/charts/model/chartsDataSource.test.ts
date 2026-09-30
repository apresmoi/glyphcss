import { describe, expect, it } from "vitest";
import { buildDatasetMark, profileChartsData, resolveChartsDataRows, topChartsRecommendation, xChannelIsDate } from "./chartsDataSource";
import { buildChartsWorkbenchSpec, createChartsWorkbenchState } from "./chartsSpec";
import { reduceChartsWorkbenchState } from "./chartsWorkbenchState";
import { findChartsDataset } from "../data/index";

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

// ── F1/P1-1 — `select-dataset` uses each STOCK dataset's own curated
// `recommended` mapping, never the general profiler's top pick ───────────
//
// Before this fix, the Data folder's old Apply button always committed
// `profiled.recommendations[0]` — the profiler's own ranking — even for a
// dataset that ships a curated `recommended` field naming a DIFFERENT
// mapping. `topChartsRecommendation` is the fix: it reads the dataset's own
// field when one exists, and `select-dataset` (AGENTS.md's "Charts" — "Data
// layer") is now the ONE action that resolves it and commits a mark — no
// separate Apply step, no pipeline to inject beforehand (the rail has no
// pipeline editor any more). These two datasets are the original review's
// own repro (`world-population-by-country`: profiler picks an unfilled
// line; `iris-flowers`: profiler picks a pie of summed sepal lengths) —
// both are tested end to end as the actual chart SPEC `select-dataset`
// produces.
describe("topChartsRecommendation (F1/P1-1)", () => {
  function selectDataset(id: string) {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id });
    const resolved = resolveChartsDataRows({ kind: "dataset", id }, []);
    if (!resolved.ok) throw new Error(resolved.error);
    const { profile, recommendations } = profileChartsData(resolved.rows);
    const top = topChartsRecommendation(resolved.dataset, profile, recommendations);
    if (!top) throw new Error("expected a top recommendation");
    return { top, spec: buildChartsWorkbenchSpec(state) };
  }

  it("world-population-by-country: select-dataset produces a line filled by country, reading the dataset's curated mapping directly", () => {
    const { top, spec } = selectDataset("world-population-by-country");
    expect(top).toEqual({
      mark: "line", channels: { x: "year", y: "population", fill: "country", label: undefined },
      reason: expect.stringContaining("Population"),
    });
    expect(spec.marks[0]).toMatchObject({ type: "line", channels: { fill: "country" } });
  });

  it("iris-flowers: select-dataset produces a species-coloured scatter (dot), never a pie of summed sepal lengths", () => {
    const { top, spec } = selectDataset("iris-flowers");
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

  // N1/A1's own reducer-level guards (falling back with a `fallbackNotice`
  // when a pipeline step drops a curated column, and no-op'ing on a
  // genuinely channel-less recommendation) are no longer reachable through
  // `select-dataset` — it always resolves with an EMPTY pipeline (the rail
  // has no pipeline editor to have changed columns with), so a real
  // vendored dataset's curated mapping always resolves. `topChartsRecommendation`
  // itself still carries both guards (it's a pure function, unchanged) and
  // stays covered directly, pipeline injection included — this is the same
  // fallback logic `select-dataset` shares, just exercised at the layer that
  // can still reach it.
  it("falls back to the profiler's own top pick, with a fallbackNotice, when a pipeline step drops a curated column (N1)", () => {
    const resolved = resolveChartsDataRows({ kind: "dataset", id: "world-population-by-country" }, [
      { kind: "pivotWider", keyColumn: "country", valueColumn: "population" },
    ]);
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.rows[0] ? Object.keys(resolved.rows[0]) : []).not.toContain("population");
    expect(resolved.rows[0] ? Object.keys(resolved.rows[0]) : []).not.toContain("country");
    const { profile, recommendations } = profileChartsData(resolved.rows);
    const top = topChartsRecommendation(resolved.dataset, profile, recommendations);
    if (!top) throw new Error("expected a fallback recommendation");
    // Never the curated mapping's own now-nonexistent columns.
    expect(top.channels.x).not.toBe("population");
    expect(top.channels.y).not.toBe("population");
    expect(top.fallbackNotice).toMatch(/pipeline changed the columns/i);
    // A REAL chart, not merely "some mark object exists" — the profiler
    // found the reshaped table's own date + numeric columns.
    expect(Object.values(top.channels).some((value) => value !== undefined)).toBe(true);
    expect(top.channels.x).toBe("year");
  });

  // A1 (N1 residue) — the review's own repro of a fallback that finds
  // NOTHING to plot: `pivotLonger(idColumns:["year"])` melts every OTHER
  // column (country names and the population numbers alike) into one mixed
  // `value` column, so the profiler honestly answers `bar {channels: {}}`
  // ("No obvious numeric or date column found").
  it("a genuinely channel-less recommendation carries no channels at all (A1)", () => {
    const resolved = resolveChartsDataRows({ kind: "dataset", id: "world-population-by-country" }, [
      { kind: "pivotLonger", idColumns: ["year"] },
    ]);
    if (!resolved.ok) throw new Error(resolved.error);
    const { profile, recommendations } = profileChartsData(resolved.rows);
    const top = topChartsRecommendation(resolved.dataset, profile, recommendations);
    if (!top) throw new Error("expected a fallback recommendation");
    expect(top.channels).toEqual({});
    expect(top.reason).toMatch(/no obvious numeric or date column/i);
  });
});
