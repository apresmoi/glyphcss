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

  // N6c: the rolled-day check was ISO-only — `SLASH_DATE` ("MM/DD/YYYY")
  // rolls exactly the same way and used to sail through unchecked.
  it("does not classify a rolled slash-date day (2/30/2024) as a date", () => {
    const rows: TabularRow[] = [{ d: "2/30/2024" }, { d: "3/01/2024" }];
    expect(profileRows(rows).columns[0]!.type).not.toBe("date");
  });

  it("still classifies a genuinely valid slash-date column as a date", () => {
    const rows: TabularRow[] = [{ d: "2/28/2024" }, { d: "3/01/2024" }];
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
    // Values deliberately NOT the exact `1..n` sequence a 4-row sample of
    // 1,2,3,4 would coincidentally form — `isIdLikeColumn` (CHARTS-RESEARCH
    // `REVIEW-batch4-fable.md` F-P1-4) correctly treats a genuine 1..n
    // row-number shape as an identifier, and a 4-distinct-value column
    // that happens to BE 1,2,3,4 is indistinguishable from one at this
    // sample size — realistic, non-sequential measurements avoid that
    // coincidence without weakening what this test is actually checking.
    const rows: TabularRow[] = [
      { day: "Mon", hour: "AM", value: 5 }, { day: "Mon", hour: "PM", value: 12 },
      { day: "Tue", hour: "AM", value: 8 }, { day: "Tue", hour: "PM", value: 20 },
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
    // `10, 25, 7` rather than `1, 2, 3` — a 3-row sample of exactly
    // `1, 2, 3` is byte-identical to a genuine 1..n row-number column at
    // this size, and `isIdLikeColumn` (CHARTS-RESEARCH `REVIEW-batch4-
    // fable.md` F-P1-4) correctly excludes that shape as an identifier —
    // realistic, non-sequential values keep this test's real claim (a
    // lone numeric column still charts by row order) independent of that
    // coincidence.
    const rows: TabularRow[] = [{ value: 10 }, { value: 25 }, { value: 7 }];
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

  // N4 — the multi-numeric bar rule REWRITE: `x`/`fill` naming the SAME
  // category column (the pre-fix shape, which also silently dropped every
  // numeric column but `numbers[1]`) is replaced by a long-format reshape
  // that keeps every measure, distinguished by `fill` naming the MELTED
  // measure column — never `x` again.
  it("a small category with SEVERAL numeric measurements recommends a grouped bar naming every measure, never a pie (or a same-channel x/fill bar) for one arbitrary measurement (Fisher's iris shape)", () => {
    const rows: TabularRow[] = Array.from({ length: 12 }, (_, i) => ({
      sepal_length: 5 + i * 0.1, sepal_width: 3 + i * 0.05, petal_length: 1.5 + i * 0.1, petal_width: 0.2 + i * 0.02,
      species: ["setosa", "versicolor", "virginica"][i % 3],
    }));
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("bar");
    expect(top!.channels.x).toBe("species");
    expect(top!.channels.fill).not.toBe("species"); // never duplicates x into fill
    expect(top!.pipeline).toEqual([
      { kind: "pivotLonger", idColumns: ["species"], keyColumn: top!.channels.fill, valueColumn: top!.channels.y },
    ]);
    expect(recommendChart(profileRows(rows)).some((r) => r.mark === "arc")).toBe(false);
  });

  // N4 — the review's own repro: a 4-region table with TWO measures used to
  // score a pie of one arbitrary measure ABOVE a bar that (post-round-1)
  // plotted `numbers[1]` (target) alone with `fill` duplicating `x`,
  // silently dropping `sales` entirely. The fixed rule's top pick must not
  // be WORSE than the original pie — it now charts BOTH measures as their
  // own series via the same long-format reshape, which is strictly more
  // informative than a pie that can only ever show one.
  it("a 4-region table with two measures charts BOTH measures as their own series, never one summed arbitrarily", () => {
    const rows: TabularRow[] = [
      { region: "North", sales: 100, target: 90 },
      { region: "South", sales: 80, target: 85 },
      { region: "East", sales: 120, target: 110 },
      { region: "West", sales: 60, target: 70 },
    ];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("bar");
    expect(top!.channels.x).toBe("region");
    expect(top!.channels.fill).not.toBe("region");
    expect(top!.reason).toMatch(/2 numeric columns/);
    if (!top!.pipeline) throw new Error("expected a reshape pipeline");
    const [step] = top!.pipeline;
    expect(step).toMatchObject({ kind: "pivotLonger", idColumns: ["region"] });
  });

  // N11 — an unfilled category count directly bounds a fill's own output:
  // one line, one legend entry and one style (of a 4-style cycle) per
  // distinct value. Past DATE_NUMERIC_CATEGORY_FILL_MAX_CATEGORIES (8) none
  // of the three stays distinguishable, so the fill is dropped rather than
  // silently degrading to an unreadable chart with no explanation.
  it("caps the date+numeric+category fill rule at 8 categories, falling back to a plain (unfilled) line beyond that", () => {
    const rows: TabularRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push({ year: "2020-01-01", population: i, country: `Country${i}` });
      rows.push({ year: "2021-01-01", population: i + 1, country: `Country${i}` });
    }
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("line");
    expect(top!.channels).toEqual({ x: "year", y: "population" });
    expect(top!.reason).toMatch(/12 categories/);
  });

  // N4 — arc stays reachable, but only for a numeric column that actually
  // READS AS a share/count (non-negative) — a signed quantity like a
  // temperature change has no honest "wedge size" reading.
  it("does not recommend arc for a small category whose single numeric column has negative values", () => {
    const rows: TabularRow[] = [
      { city: "A", tempChangeC: -3 }, { city: "B", tempChangeC: 2 }, { city: "C", tempChangeC: -1 },
    ];
    const [top] = recommendChart(profileRows(rows));
    expect(top!.mark).toBe("bar");
    expect(recommendChart(profileRows(rows)).some((r) => r.mark === "arc")).toBe(false);
  });
});
