import { describe, expect, it } from "vitest";
import { buildDatasetMark, profileChartsData, resolveChartsDataRows, xChannelIsDate } from "./chartsDataSource";

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
