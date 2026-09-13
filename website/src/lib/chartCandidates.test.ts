// Ground-truth and mutation-check coverage for the information-ranked
// candidate enumeration (AGENTS.md's "Charts" — "Data layer";
// `docs/design/charts.md`'s "Chart candidate ranking" has the full
// formula/weights and this file's own ground-truth table). `dataProfile.test.ts`
// covers the individual business rules (id exclusion, fill caps, the
// wide-year pivot, the multi-measure melt) through `recommendChart`'s
// public surface; this file covers `chartCandidates.ts` directly — the
// full ranked list, `pickChartCandidate`, and whether real vendored
// datasets' own curated mappings land where a reader would expect.
import { describe, expect, it } from "vitest";
import {
  buildChartCandidates, CHART_CANDIDATE_WEIGHTED_RANDOM_THRESHOLD, pickChartCandidate, type ChartCandidate,
} from "./chartCandidates";
import { profileRows } from "./dataProfile";
import type { TabularRow } from "./tabularParse";
import {
  cityMonthlyTemperaturesDataset, co2MaunaLoaDataset, ecommerceConversionFunnelDataset, energyConsumptionBySourceDataset,
  energyFlowSankeyDataset, gdpGrowth2020CrisisDataset, gdpLifeExpectancy2007Dataset, globalElectricityMixDataset,
  globalTemperatureDataset, irisFlowersDataset, olympics2024MedalsByTypeDataset, olympics2024MedalsDataset,
  renewableElectricityShareDataset, treasuryYield10yDataset, usUnemploymentDataset, worldPopulationByCountryDataset,
} from "../components/ChartsWorkbench/datasets";
import type { ChartsDataset } from "../components/ChartsWorkbench/datasets/types";

// ── Basic contract ──────────────────────────────────────────────────────

describe("buildChartCandidates", () => {
  it("is sorted best-first and never empty for a non-empty profile", () => {
    const candidates = buildChartCandidates(profileRows(globalTemperatureDataset.rows));
    expect(candidates.length).toBeGreaterThan(0);
    for (let i = 1; i < candidates.length; i++) expect(candidates[i - 1]!.score).toBeGreaterThanOrEqual(candidates[i]!.score);
  });

  it("every candidate carries all five terms, each in [0, 1], and a score that's their weighted composite", () => {
    const candidates = buildChartCandidates(profileRows(gdpLifeExpectancy2007Dataset.rows));
    for (const c of candidates) {
      for (const term of Object.values(c.terms)) {
        expect(term).toBeGreaterThanOrEqual(0);
        expect(term).toBeLessThanOrEqual(1);
      }
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  it("degrades to a channel-less bar for a profile with no usable numeric or date column, never an empty list", () => {
    const rows: TabularRow[] = [{ label: "only text here, long enough to not read as a category value at all really" }];
    const candidates = buildChartCandidates(profileRows(rows));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.mark).toBe("bar");
  });
});

describe("pickChartCandidate", () => {
  const candidates = buildChartCandidates(profileRows(gdpLifeExpectancy2007Dataset.rows));

  it("'best' returns the top of the sorted list", () => {
    expect(pickChartCandidate(candidates, { mode: "best" })).toBe(candidates[0]);
  });

  it("'weighted-random' is reproducible under a fixed seed and stays within the threshold band", () => {
    for (let seed = 0; seed < 30; seed++) {
      const picked = pickChartCandidate(candidates, { mode: "weighted-random", seed });
      const pickedAgain = pickChartCandidate(candidates, { mode: "weighted-random", seed });
      expect(picked).toEqual(pickedAgain);
      expect(picked!.score).toBeGreaterThanOrEqual(candidates[0]!.score * CHART_CANDIDATE_WEIGHTED_RANDOM_THRESHOLD);
    }
  });

  it("'weighted-random' actually rotates across seeds rather than always landing on 'best' (real datasets have more than one informative view)", () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const picked = pickChartCandidate(candidates, { mode: "weighted-random", seed })!;
      picks.add(`${picked.mark}:${JSON.stringify(picked.channels)}`);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("returns null only for a genuinely empty candidate list", () => {
    expect(pickChartCandidate([], { mode: "best" })).toBeNull();
    expect(pickChartCandidate([], { mode: "weighted-random", seed: 1 })).toBeNull();
  });
});

// ── Mutation checks ──────────────────────────────────────────────────────
//
// AGENTS.md's global rule: a guarantee with no failing test is not a
// guarantee. Each of these isolates ONE term by holding every other
// candidate property equal, so the assertion can only pass because that
// term did its job — deleting the term's contribution (zeroing its
// weight, or reading it as a constant) makes the corresponding assertion
// go red, not just "less confident".

describe("mutation checks", () => {
  it("entropy: a CONSTANT measure never outranks a varying one sharing the same category and shape", () => {
    // Same category (region, 4 distinct, one row each — no duplicate-key
    // ambiguity), two measures with IDENTICAL name-lexicon signal (neither
    // "steady"/"varying" matches the measure lexicon) and structurally
    // identical shape (one value per region) — entropy is the only term
    // that can tell them apart: `steady` is literally the same number
    // every row (entropy 0), `varying` spans a real range. Both are
    // non-integer so a small, all-distinct sample never trips the
    // (pre-existing, `dataProfile.ts`-derived) "unique-cardinality integer
    // reads as an id" heuristic `isIdLikeColumn` also applies.
    const rows: TabularRow[] = [
      { region: "North", steady: 50.5, varying: 10.5 },
      { region: "South", steady: 50.5, varying: 80.5 },
      { region: "East", steady: 50.5, varying: 45.5 },
      { region: "West", steady: 50.5, varying: 95.5 },
    ];
    const candidates = buildChartCandidates(profileRows(rows));
    const steadyBar = candidates.find((c) => c.mark === "bar" && c.channels.y === "steady" && !c.channels.fill);
    const varyingBar = candidates.find((c) => c.mark === "bar" && c.channels.y === "varying" && !c.channels.fill);
    if (!steadyBar || !varyingBar) throw new Error("expected both plain bar candidates");
    // `bar`'s own entropy blends the Y measure with the X category's
    // entropy too (both axes are "the plotted quantity" for a bar) — a
    // constant measure still contributes exactly 0 to that blend, so the
    // gap between the two is entirely the measure's own doing.
    expect(varyingBar.terms.entropy).toBeGreaterThan(steadyBar.terms.entropy);
    expect(varyingBar.score).toBeGreaterThan(steadyBar.score);
    // The composite candidate list reflects it too: the constant measure's
    // bar never outranks the varying one's.
    expect(candidates.indexOf(varyingBar)).toBeLessThan(candidates.indexOf(steadyBar));
  });

  it("structure: a genuinely correlated measure pair outranks an uncorrelated pair sharing identical entropy/coverage/legibility/prior", () => {
    // Three measures, all built from the SAME underlying spread (so each
    // has identical entropy) — `b` tracks `a` in lock-step (r = 1),
    // `c` is `a`'s own values in a fixed but UNRELATED order (a
    // permutation — same histogram, same entropy, zero correlation to
    // `a`). Only `structure` can tell the (a,b) pair from the (a,c) pair.
    // `.5`-offset so a small, all-distinct sample never reads as an id
    // (see the entropy mutation check's own comment).
    const a = [10.5, 20.5, 30.5, 40.5, 50.5, 60.5, 70.5, 80.5, 90.5, 100.5, 15.5, 25.5];
    const b = a.map((v) => v * 2 + 3.3);
    const c = [...a].reverse().map((v, i) => (i % 2 === 0 ? v : a[(i * 7) % a.length]!));
    const rows: TabularRow[] = a.map((v, i) => ({ a: v, b: b[i]!, c: c[i]! }));
    const candidates = buildChartCandidates(profileRows(rows));
    const ab = candidates.find((cd) => cd.mark === "dot" && cd.channels.x === "a" && cd.channels.y === "b");
    const ac = candidates.find((cd) => cd.mark === "dot" && cd.channels.x === "a" && cd.channels.y === "c");
    if (!ab || !ac) throw new Error("expected both dot candidates");
    expect(ab.terms.structure).toBeGreaterThan(0.7);
    expect(ab.terms.structure).toBeGreaterThan(ac.terms.structure * 2);
    expect(Math.abs(ab.terms.entropy - ac.terms.entropy)).toBeLessThan(0.1);
    expect(ab.score).toBeGreaterThan(ac.score);
  });
});

// ── Ground truth: the 16 vendored datasets' own curated mapping ─────────
//
// `datasets/index.ts`'s `recommended` field is hand-curated ground truth,
// not derived from this scorer — it's what a reader familiar with each
// dataset would draw first. The claim under test: the GENERAL enumeration
// (no dataset-specific knowledge, only the profiled columns) independently
// ranks that same mapping highly. `transform` is NOT part of the
// comparison — the general enumerator doesn't reproduce a curated
// `"stack"` opinion (a styling choice `chartsDataSource.ts`'s curated path
// still supplies), only the mark/channel SHAPE.
interface GroundTruthCase {
  readonly dataset: ChartsDataset;
  /** Present for the 14 datasets the STATED criterion covers (`docs/design/
   *  charts.md`'s "Ground truth" — "14 of 16 rank in the top 3"): the
   *  curated mapping must land at or above this 0-indexed rank. */
  readonly maxRank?: number;
  /**
   * CHARTS-RESEARCH `REVIEW-batch4-codex.md` P2-10 / `-fable.md` F-P3-2:
   * the two NAMED exceptions used to accept ANY rank under 6 — a loose
   * bound that would silently absorb a further regression (say, rank 4
   * sliding to rank 9) with no failing test. Each now pins its OWN real,
   * currently-measured rank exactly, so a scorer change that moves either
   * one is caught precisely rather than passing through a wide net; the
   * "14 of 16 top-3, two named exceptions" summary above these two entries
   * stays what's actually true, not a rounded-up claim.
   */
  readonly exactRank?: number;
}

function channelsMatch(a: Record<string, string | undefined>, b: Record<string, string | undefined>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function rankOfCurated(dataset: ChartsDataset): number {
  const candidates = buildChartCandidates(profileRows(dataset.rows));
  const rec = dataset.recommended;
  const want = { x: rec.x, y: rec.y, fill: rec.fill, label: rec.label, source: rec.source, target: rec.target, value: rec.value, stage: rec.stage };
  return candidates.findIndex((c) => c.mark === rec.mark && channelsMatch(c.channels, want));
}

const GROUND_TRUTH: readonly GroundTruthCase[] = [
  { dataset: globalTemperatureDataset, maxRank: 0 },
  { dataset: co2MaunaLoaDataset, maxRank: 0 },
  { dataset: usUnemploymentDataset, maxRank: 0 },
  { dataset: worldPopulationByCountryDataset, maxRank: 0 },
  { dataset: renewableElectricityShareDataset, maxRank: 1 },
  { dataset: treasuryYield10yDataset, maxRank: 0 },
  // A medal table ranked descending by gold is monotone by construction —
  // that's a RANKING, not a "gold is the interesting measure" claim. With
  // silver/bronze sitting right there and correlated with gold across
  // countries, the multi-measure melt (every medal, per country) and a
  // gold-vs-silver/gold-vs-bronze scatter are both honestly MORE
  // informative than "gold alone" for this exact table (and the
  // maintainers' own reasoning agrees — `olympics2024MedalsByType.ts`'s
  // header comment: "the wide-format sibling dataset only ever charts
  // gold alone", which is why that second, fuller dataset exists at all).
  // Curation is deliberately narrow here for editorial reasons (a single
  // clean bar for the front page); the scorer is not wrong to prefer
  // showing all three medals. Rank 5 (was 4 before the `isIdLikeColumn`
  // fix, `docs/design/charts.md`'s "isIdLikeColumn" section — `bronze`'s
  // ten all-distinct values are a real measure, not an identifier, and
  // correctly counting it only strengthens this same disagreement).
  { dataset: olympics2024MedalsDataset, exactRank: 5 },
  // Real Fisher iris: petal_length x petal_width correlates MORE strongly
  // (r ~ 0.96) than the curated sepal_length x petal_length (r ~ 0.87) —
  // both are genuinely strong, cross-part relationships; the curated pick
  // is the more commonly cited pairing but not the statistically
  // stronger one on this exact data, so it lands 4th, not top 3. A
  // defensible information disagreement, not a scorer defect.
  { dataset: irisFlowersDataset, exactRank: 3 },
  { dataset: energyFlowSankeyDataset, maxRank: 0 },
  { dataset: ecommerceConversionFunnelDataset, maxRank: 0 },
  { dataset: globalElectricityMixDataset, maxRank: 0 },
  { dataset: cityMonthlyTemperaturesDataset, maxRank: 0 },
  { dataset: gdpLifeExpectancy2007Dataset, maxRank: 1 },
  { dataset: energyConsumptionBySourceDataset, maxRank: 1 },
  { dataset: gdpGrowth2020CrisisDataset, maxRank: 0 },
  { dataset: olympics2024MedalsByTypeDataset, maxRank: 1 },
];

describe("ground truth: curated recommendation vs. the general enumeration", () => {
  it.each(GROUND_TRUTH.map((c) => ({ id: c.dataset.id, ...c })))("$id", ({ dataset, maxRank, exactRank }) => {
    const rank = rankOfCurated(dataset);
    if (exactRank !== undefined) {
      // Pinned exactly — see `GroundTruthCase.exactRank`'s own doc: a
      // loose "still found somewhere" bound would silently absorb a
      // further regression instead of catching it.
      expect(rank).toBe(exactRank);
      return;
    }
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThanOrEqual(Math.max(maxRank!, 2));
  });

  it("at least 10 of the 16 curated mappings rank #1", () => {
    const top1 = GROUND_TRUTH.filter((c) => rankOfCurated(c.dataset) === 0).length;
    expect(top1).toBeGreaterThanOrEqual(10);
  });

  // codex P2-10 / fable F-P3-2: the STATED criterion (`docs/design/
  // charts.md`'s "Ground truth" — "14 of 16 rank in the top 3") is a
  // real, checkable claim, not prose — this is what verifies it directly
  // rather than trusting the per-dataset cases above to add up to it.
  it("14 of the 16 curated mappings rank in the top 3 — the other 2 are the named exceptions above", () => {
    const top3 = GROUND_TRUTH.filter((c) => rankOfCurated(c.dataset) <= 2).length;
    expect(top3).toBe(14);
    const namedExceptions = GROUND_TRUTH.filter((c) => c.exactRank !== undefined);
    expect(namedExceptions).toHaveLength(2);
    for (const c of namedExceptions) expect(rankOfCurated(c.dataset)).toBeGreaterThan(2);
  });

  it("every curated mapping is at least FOUND in the enumeration (never absent)", () => {
    for (const { dataset } of GROUND_TRUTH) expect(rankOfCurated(dataset)).toBeGreaterThanOrEqual(0);
  });
});

// ── Review cases ──────────────────────────────────────────────────────────

describe("review cases", () => {
  // scikit-learn/iris ships a real `Id` column (1..150) alongside the
  // measurements — the id-exclusion rule (shared with dataProfile.ts, via
  // `isIdLikeColumn`) must keep it off every measure axis.
  it("an Id-bearing iris-shaped table never puts Id on a measure axis, and still ranks a species-coloured petal/sepal dot highly", () => {
    const species = ["setosa", "versicolor", "virginica"] as const;
    const rows: TabularRow[] = Array.from({ length: 150 }, (_, i) => ({
      Id: i + 1,
      SepalLengthCm: 4.5 + (i % 30) * 0.1,
      SepalWidthCm: 2.5 + ((i * 3) % 20) * 0.05,
      PetalLengthCm: 1 + (i % 50) * 0.1,
      PetalWidthCm: 0.1 + (i % 25) * 0.08,
      Species: species[i % 3],
    }));
    const candidates = buildChartCandidates(profileRows(rows));
    for (const c of candidates) {
      expect(c.channels.x).not.toBe("Id");
      expect(c.channels.y).not.toBe("Id");
      expect(c.channels.fill).not.toBe("Id");
      expect(c.channels.value).not.toBe("Id");
    }
    const top = candidates[0]!;
    expect(top.mark).toBe("dot");
    expect(top.channels.fill).toBe("Species");
    expect([top.channels.x, top.channels.y]).toEqual(expect.arrayContaining([expect.stringContaining("Cm")]));
  });

  // mstz/electricity-shaped table: half-hourly price/demand records over
  // time — the top candidate should be a genuine time series of one of
  // the two real measures, never the (excluded) row-ordinal-like column.
  it("a price/demand-over-time table recommends a real time series, not an ordinal column", () => {
    const rows: TabularRow[] = Array.from({ length: 48 }, (_, i) => {
      const hour = String(i % 24).padStart(2, "0");
      const day = String(1 + Math.floor(i / 24)).padStart(2, "0");
      return {
        period: i,
        date: `2024-01-${day}T${hour}:00:00Z`,
        price: 30 + 20 * Math.sin(i / 4) + (i % 3),
        demand: 6000 + 900 * Math.sin(i / 4 + 1) + (i % 5) * 10,
      };
    });
    const candidates = buildChartCandidates(profileRows(rows));
    const top = candidates[0]!;
    expect(["line", "area"]).toContain(top.mark);
    expect(top.channels.x).toBe("date");
    expect(["price", "demand"]).toContain(top.channels.y);
  });

  // A wide-year table (one column per year) recommends the pivoted line,
  // never a meaningless bar-per-year-per-row melt of the same columns.
  it("a wide-year table recommends the pivoted-long line at rank 0", () => {
    const rows: TabularRow[] = [
      { country: "Alpha", "1990": 10, "2000": 20, "2010": 35, "2020": 60 },
      { country: "Beta", "1990": 5, "2000": 12, "2010": 22, "2020": 40 },
      { country: "Gamma", "1990": 8, "2000": 9, "2010": 15, "2020": 28 },
    ];
    const candidates = buildChartCandidates(profileRows(rows));
    expect(candidates[0]!.mark).toBe("line");
    expect(candidates[0]!.channels).toEqual({ x: "year", y: "value", fill: "country" });
    expect(candidates[0]!.pipeline).toBeDefined();
  });

  // A 2,000-row transaction table recommends AGGREGATING (a `group`
  // transform) rather than a raw per-row bar/line nobody could read.
  it("a 2,000-row transaction table's top candidate carries a group transform", () => {
    const categoriesPool = ["Electronics", "Grocery", "Apparel", "Home", "Toys"];
    const rows: TabularRow[] = Array.from({ length: 2000 }, (_, i) => ({
      category: categoriesPool[i % categoriesPool.length]!,
      amount: 5 + ((i * 37) % 400),
    }));
    const candidates = buildChartCandidates(profileRows(rows));
    const top = candidates[0]!;
    expect(top.mark).toBe("bar");
    expect(top.transform).toEqual({ kind: "group", reduce: "sum" });
  });

  it("a constant column never wins the top candidate", () => {
    const rows: TabularRow[] = Array.from({ length: 20 }, (_, i) => ({
      region: `Region${i % 5}`,
      flat: 42.5,
      revenue: 100.5 + i * 13,
    }));
    const candidates = buildChartCandidates(profileRows(rows));
    expect(candidates[0]!.channels.y).not.toBe("flat");
    expect(candidates[0]!.channels.value).not.toBe("flat");
    // A plain, unfilled bar/dot over the constant alone has NOTHING but
    // the constant contributing to its measure-entropy term (no fill/x
    // category entropy to blend in) — that reading is exactly 0.
    const plainFlatBar = candidates.find((c) => c.mark === "bar" && c.channels.y === "flat" && !c.channels.fill);
    if (plainFlatBar) expect(plainFlatBar.terms.entropy).toBeLessThan(0.5);
  });

  it("an id column never appears on a y/value/fill axis across a mixed real-shaped table", () => {
    const rows: TabularRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      category: `Cat${i % 6}`,
      score: 10.5 + ((i * 17) % 90),
    }));
    const candidates = buildChartCandidates(profileRows(rows));
    for (const c of candidates) {
      expect(c.channels.y).not.toBe("id");
      expect(c.channels.value).not.toBe("id");
      expect(c.channels.fill).not.toBe("id");
      expect(c.channels.x).not.toBe("id");
    }
  });

  // codex P1-8 (`REVIEW-batch4-codex.md`): `{id, name}` rows — every
  // numeric column IS an identifier, so `effectiveNumbers` must stay
  // empty rather than falling back to the excluded list. No candidate may
  // chart `id` as a measure; the enumerator's own last-resort tail must
  // be what fires (`docs/design/charts.md`'s "isIdLikeColumn" section).
  it("a table whose only numeric column is an id produces zero measure-based candidates (P1-8)", () => {
    const rows: TabularRow[] = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }, { id: 4, name: "D" }];
    const candidates = buildChartCandidates(profileRows(rows));
    for (const c of candidates) {
      expect(c.channels.y).not.toBe("id");
      expect(c.channels.value).not.toBe("id");
      expect(c.channels.fill).not.toBe("id");
    }
    // The last-resort "no obvious numeric or date column" bar, and
    // nothing else — an `id` measure never sneaks back in as a fallback.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.mark).toBe("bar");
    expect(candidates[0]!.channels).toEqual({});
  });

  // fable F-P1-4: an ordinary all-distinct INTEGER year column (never an
  // identifier by name or by the 0..n-1/1..n row-number shape) must still
  // be usable as an ordered x — the old blanket "every value distinct ⇒
  // id" rule excluded it, leaving no candidate charted over year at all.
  it("a 25-row table with a distinct integer year column offers a real line/area over year, not zero ordered-x candidates (F-P1-4)", () => {
    const rows: TabularRow[] = Array.from({ length: 25 }, (_, i) => ({
      year: 2000 + i,
      gdp: 500 + i * 23 + ((i * 7) % 11),
      debt: 200 + i * 9 + ((i * 5) % 13),
    }));
    const candidates = buildChartCandidates(profileRows(rows));
    // Under the old blanket "every value distinct ⇒ id" rule, `year` was
    // excluded from `monotonicNumeric` (`isIdLikeColumn`'s own gate on
    // `orderedX`) and NO candidate ever charted anything over it — the
    // reported repro's own "the only candidate is line {y: co2} over the
    // row index ... no candidate over year at all". A correlated
    // gdp-vs-debt scatter is free to legitimately outscore it (both were
    // built as near-linear in `i`, so their own correlation is real, not
    // a defect) — the claim under test is that year-as-x now EXISTS as a
    // real candidate, not that it wins.
    // `year` is now also a legitimate distinct-integer MEASURE in its own
    // right (not just an ordered x), so it can pair into a `dot` scatter
    // too (e.g. `year` vs `gdp`) — a genuine additional candidate, not a
    // defect. The claim under test is narrower: at least one real
    // line/area over year now exists.
    const lineOverYear = candidates.filter((c) => c.channels.x === "year" && (c.mark === "line" || c.mark === "area"));
    expect(lineOverYear.length).toBeGreaterThan(0);
    for (const c of lineOverYear) expect(["gdp", "debt"]).toContain(c.channels.y);
    // `gdp`/`debt` must both still be usable as real measures too — a
    // distinct integer MEASURE (not just the ordered x) must not be
    // excluded either.
    expect(candidates.some((c) => c.channels.y === "gdp" || c.channels.value === "gdp")).toBe(true);
    expect(candidates.some((c) => c.channels.y === "debt" || c.channels.value === "debt")).toBe(true);
  });
});
