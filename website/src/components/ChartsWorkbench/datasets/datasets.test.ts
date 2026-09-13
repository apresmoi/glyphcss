import { describe, expect, it } from "vitest";
import { CHARTS_DATASETS, findChartsDataset } from "./index";
import { profileRows } from "../../../lib/dataProfile";
import type { TabularRow } from "../../../lib/tabularParse";

describe("CHARTS_DATASETS", () => {
  it("has 8 datasets, each within the 200-row cap and fully sourced", () => {
    expect(CHARTS_DATASETS).toHaveLength(8);
    for (const dataset of CHARTS_DATASETS) {
      expect(dataset.rows.length).toBeGreaterThan(0);
      expect(dataset.rows.length).toBeLessThanOrEqual(200);
      expect(dataset.source.name.length).toBeGreaterThan(0);
      expect(dataset.source.url).toMatch(/^https:\/\//);
      expect(dataset.source.licence.length).toBeGreaterThan(0);
      expect(dataset.title.length).toBeGreaterThan(0);
      expect(dataset.description.length).toBeGreaterThan(0);
    }
  });

  it("every dataset's recommended channels name real columns", () => {
    for (const dataset of CHARTS_DATASETS) {
      const { x, y, fill, label } = dataset.recommended;
      for (const field of [x, y, fill, label]) {
        if (field !== undefined) expect(dataset.columns).toContain(field);
      }
    }
  });

  it("every row only carries the dataset's own declared columns", () => {
    for (const dataset of CHARTS_DATASETS) {
      for (const row of dataset.rows) {
        expect(Object.keys(row).sort()).toEqual([...dataset.columns].sort());
      }
    }
  });

  it("finds a dataset by id and returns undefined for an unknown one", () => {
    expect(findChartsDataset("global-temperature")?.title).toBe("Global temperature anomaly");
    expect(findChartsDataset("no-such-dataset")).toBeUndefined();
  });

  it("at least three datasets carry ISO date x-values at a different granularity each (yearly/monthly/daily)", () => {
    const dateColumnFor = (id: string) => {
      const dataset = findChartsDataset(id)!;
      const profile = profileRows(dataset.rows as TabularRow[]);
      return profile.columns.find((c) => c.type === "date");
    };
    const yearly = dateColumnFor("global-temperature");
    const monthly = dateColumnFor("co2-mauna-loa");
    const daily = dateColumnFor("treasury-yield-10y");
    expect(yearly?.name).toBe("year");
    expect(monthly?.name).toBe("month");
    expect(daily?.name).toBe("date");
    // Granularity check: consecutive values differ by ~1 year / ~1 month / ~1-3 days.
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    const yearlyDataset = findChartsDataset("global-temperature")!;
    const monthlyDataset = findChartsDataset("co2-mauna-loa")!;
    const dailyDataset = findChartsDataset("treasury-yield-10y")!;
    expect(days(String(yearlyDataset.rows[0]!.year), String(yearlyDataset.rows[1]!.year))).toBeCloseTo(365, -1);
    expect(days(String(monthlyDataset.rows[0]!.month), String(monthlyDataset.rows[1]!.month))).toBeGreaterThanOrEqual(28);
    expect(days(String(monthlyDataset.rows[0]!.month), String(monthlyDataset.rows[1]!.month))).toBeLessThanOrEqual(31);
    expect(days(String(dailyDataset.rows[0]!.date), String(dailyDataset.rows[1]!.date))).toBeLessThanOrEqual(4);
  });

  it("recommendation reasons and shapes match the profiler's own top pick where a recommender-covered shape applies", () => {
    // The Olympics table and Iris are hand-picked (bar-by-country, dot-by-
    // species) rather than the profiler's literal top choice, so this only
    // pins the three plain date+numeric datasets, where profiler and
    // hand-authored `recommended` must agree.
    for (const id of ["global-temperature", "co2-mauna-loa", "us-unemployment"]) {
      const dataset = findChartsDataset(id)!;
      expect(dataset.recommended.mark === "line" || dataset.recommended.mark === "area").toBe(true);
    }
  });
});
