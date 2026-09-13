import { describe, expect, it } from "vitest";
import { profileRows, recommendChart } from "./dataProfile";
import type { TabularRow } from "./tabularParse";

describe("profileRows", () => {
  it("infers integer, date, and category columns with min/max and monotonicity", () => {
    const rows: TabularRow[] = [
      { year: "2020-01-01", temp: 14, region: "north" },
      { year: "2021-01-01", temp: 15, region: "south" },
      { year: "2022-01-01", temp: 16, region: "north" },
    ];
    const profile = profileRows(rows);
    const year = profile.columns.find((c) => c.name === "year")!;
    const temp = profile.columns.find((c) => c.name === "temp")!;
    const region = profile.columns.find((c) => c.name === "region")!;
    expect(year.type).toBe("date");
    expect(year.monotonic).toBe("increasing");
    expect(temp.type).toBe("integer");
    expect(temp.min).toBe(14);
    expect(temp.max).toBe(16);
    expect(temp.monotonic).toBe("increasing");
    expect(region.type).toBe("category");
    expect(region.cardinality).toBe("low");
  });

  it("classifies a fractional numeric column as number, not integer", () => {
    const rows: TabularRow[] = [{ v: 1.5 }, { v: 2.25 }];
    expect(profileRows(rows).columns[0]!.type).toBe("number");
  });

  it("classifies a high-cardinality string column as text", () => {
    const rows: TabularRow[] = Array.from({ length: 30 }, (_, i) => ({ note: `unique-${i}` }));
    expect(profileRows(rows).columns[0]!.type).toBe("text");
    expect(profileRows(rows).columns[0]!.cardinality).toBe("unique");
  });

  it("counts nulls and handles an empty table", () => {
    const rows: TabularRow[] = [{ a: 1 }, { a: null }, { a: 2 }];
    expect(profileRows(rows).columns[0]!.nullCount).toBe(1);
    expect(profileRows([])).toEqual({ rowCount: 0, columns: [] });
  });

  it("reports 'none' monotonicity for an unsorted numeric column", () => {
    const rows: TabularRow[] = [{ v: 3 }, { v: 1 }, { v: 2 }];
    expect(profileRows(rows).columns[0]!.monotonic).toBe("none");
  });

  // P3: `Date.parse("2024-02-30")` silently rolls to March 1st instead of
  // rejecting the out-of-range day — a data-entry typo becoming a
  // plausible WRONG date rather than a flagged one. `"2024-13-45"` (no
  // valid month) was already rejected via `Date.parse` returning `NaN`;
  // this closes the OTHER half.
  it("does not classify an out-of-range calendar day (2024-02-30) as a date", () => {
    const rows: TabularRow[] = [{ d: "2024-02-30" }, { d: "2024-03-01" }];
    expect(profileRows(rows).columns[0]!.type).not.toBe("date");
  });

  it("still classifies a genuinely valid ISO date column as a date", () => {
    const rows: TabularRow[] = [{ d: "2024-02-28" }, { d: "2024-03-01" }];
    expect(profileRows(rows).columns[0]!.type).toBe("date");
  });
});

describe("recommendChart", () => {
  it("recommends a line chart, x = date, for one date column and one numeric column", () => {
    const rows: TabularRow[] = [{ year: "2020-01-01", temp: 14 }, { year: "2021-01-01", temp: 15 }];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("line");
    expect(top!.channels).toEqual({ x: "year", y: "temp" });
  });

  it("recommends arc (not bar) as the top pick for a small share-like category", () => {
    const rows: TabularRow[] = [
      { browser: "Chrome", share: 65 }, { browser: "Safari", share: 20 }, { browser: "Firefox", share: 15 },
    ];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("arc");
  });

  it("recommends bar for a wider category (more than 6 values)", () => {
    const rows: TabularRow[] = Array.from({ length: 8 }, (_, i) => ({ country: `c${i}`, gdp: i * 10 }));
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("bar");
  });

  it("recommends cell (heatmap) for category x category x numeric", () => {
    const rows: TabularRow[] = [
      { day: "Mon", hour: "AM", value: 1 }, { day: "Mon", hour: "PM", value: 2 },
      { day: "Tue", hour: "AM", value: 3 }, { day: "Tue", hour: "PM", value: 4 },
    ];
    const recs = recommendChart(profileRows(rows));
    expect(recs.some((r) => r.mark === "cell")).toBe(true);
  });

  it("recommends dot for two numeric columns with no date or category", () => {
    const rows: TabularRow[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 1 }];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("dot");
  });

  it("never returns an empty list for a non-empty profile", () => {
    const rows: TabularRow[] = [{ label: "only text here" }, { label: "and more text" }];
    expect(recommendChart(profileRows(rows)).length).toBeGreaterThan(0);
  });

  // P2-6: the bare-JSON-array sugar (`tabularParse.ts`'s `jsonToParsedTabular`)
  // resolves to a single "value" column with no x/date/category at all — the
  // recommender's own last-resort "by row order" line/bar fallback is what a
  // reader actually gets, matching AGENTS.md's `renderGlyphChart` shorthand.
  it("recommends a 'by row order' line for a bare numeric-array shape (single 'value' column)", () => {
    const rows: TabularRow[] = [{ value: 1 }, { value: 2 }, { value: 3 }];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("line");
    expect(top!.channels).toEqual({ y: "value" });
  });

  // F1/P1-1 — the two rules this review added.
  it("date + numeric + category recommends a line filled by category, not a plain single line", () => {
    const rows: TabularRow[] = [
      { year: "2020-01-01", population: 10, country: "A" }, { year: "2020-01-01", population: 20, country: "B" },
      { year: "2021-01-01", population: 11, country: "A" }, { year: "2021-01-01", population: 21, country: "B" },
    ];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("line");
    expect(top!.channels).toEqual({ x: "year", y: "population", fill: "country" });
  });

  it("a small category with SEVERAL numeric measurements recommends a grouped bar, never a pie of the first measurement (Fisher's iris shape)", () => {
    const rows: TabularRow[] = Array.from({ length: 12 }, (_, i) => ({
      sepal_length: 5 + i * 0.1, sepal_width: 3 + i * 0.05, petal_length: 1.5 + i * 0.1, petal_width: 0.2 + i * 0.02,
      species: ["setosa", "versicolor", "virginica"][i % 3],
    }));
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("bar");
    expect(top!.channels).toEqual({ x: "species", y: "sepal_width", fill: "species" });
    expect(recommendChart(profileRows(rows)).some((r) => r.mark === "arc")).toBe(false);
  });
});
