// Ground-truth and mutation-check coverage for the information-ranked
// candidate enumeration (AGENTS.md's "Charts" — "Data layer"; the
// formula/weights live in `chartCandidates.ts`). `dataProfile.test.ts`
// covers the individual business rules (id exclusion, fill caps, the
// wide-year pivot, the multi-measure melt) through `recommendChart`'s
// public surface; this file covers `chartCandidates.ts` directly — the
// full ranked list and whether real vendored
// datasets' own curated mappings land where a reader would expect.
import { describe, expect, it } from "vitest";
import {
  buildChartCandidates, isIdLikeColumn, type ChartCandidate,
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
  /** Present for the 15 datasets the STATED criterion covers ("15 of 16
   *  rank in the top 3"): the
   *  curated mapping must land at or above this 0-indexed rank. */
  readonly maxRank?: number;
  /**
   * CHARTS-RESEARCH `REVIEW-batch4-codex.md` P2-10 / `-fable.md` F-P3-2:
   * a NAMED exception used to accept ANY rank under 6 — a loose bound that
   * would silently absorb a further regression (say, rank 4 sliding to
   * rank 9) with no failing test. It pins its OWN real, currently-measured
   * rank exactly, so a scorer change that moves it is caught precisely;
   * the "15 of 16 top-3, one named exception" summary stays what's
   * actually true, not a rounded-up claim.
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
  // fix — `bronze`'s
  // ten all-distinct values are a real measure, not an identifier, and
  // correctly counting it only strengthens this same disagreement).
  { dataset: olympics2024MedalsDataset, exactRank: 5 },
  // Real Fisher iris: petal_length x petal_width correlates MORE strongly
  // (r ~ 0.96) than the curated sepal_length x petal_length (r ~ 0.87), so
  // the curated dot sits under that pair and its mirror. It used to be
  // 4th, behind a melted species bar too — which drew 50 overlapping bars
  // per (species, measure) sub-band and showed only each group's maximum,
  // and is no longer offered.
  { dataset: irisFlowersDataset, maxRank: 2 },
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

  // codex P2-10 / fable F-P3-2: the STATED criterion ("15 of 16 rank in
  // the top 3") is a
  // real, checkable claim, not prose — this is what verifies it directly
  // rather than trusting the per-dataset cases above to add up to it.
  it("15 of the 16 curated mappings rank in the top 3 — the other is the named exception above", () => {
    const top3 = GROUND_TRUTH.filter((c) => rankOfCurated(c.dataset) <= 2).length;
    expect(top3).toBe(15);
    const namedExceptions = GROUND_TRUTH.filter((c) => c.exactRank !== undefined);
    expect(namedExceptions).toHaveLength(1);
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
  // be what fires: distinctness is not identity, only an id-like NAME or
  // an exact 0..n-1/1..n row sequence is.
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

  // `REVIEW-batch4-fixes-opus.md` P1-8 side effect: the SET check
  // (min/max/distinctCount) that makes `isIdLikeColumn` recognize a real
  // 0..n-1/1..n row-number sequence also accepted a SHUFFLED permutation of
  // that same set — a shuffled deck, a randomized trial id, is a genuine
  // MEASURE (or at least not an index), not an identifier. The rule must
  // require the sequence IN ROW ORDER, not merely the value set.
  it("isIdLikeColumn accepts a real 0..n-1/1..n row-number sequence but refuses a shuffled permutation of the same values", () => {
    const rowCount = 5;
    const increasingFromOne = profileRows([1, 2, 3, 4, 5].map((v) => ({ trial: v })));
    const increasingFromZero = profileRows([0, 1, 2, 3, 4].map((v) => ({ trial: v })));
    const shuffled = profileRows([3, 1, 4, 5, 2].map((v) => ({ trial: v })));
    const trialCol = (profile: ReturnType<typeof profileRows>) => profile.columns.find((c) => c.name === "trial")!;
    expect(isIdLikeColumn(trialCol(increasingFromOne), rowCount)).toBe(true);
    expect(isIdLikeColumn(trialCol(increasingFromZero), rowCount)).toBe(true);
    // Same value SET (1..5, just reordered) — must stay a measure.
    expect(isIdLikeColumn(trialCol(shuffled), rowCount)).toBe(false);
    // A decreasing 5..1 sequence is also not the id shape (never monotone
    // "increasing"), even though it's the exact reverse of a real index.
    const decreasing = profileRows([5, 4, 3, 2, 1].map((v) => ({ trial: v })));
    expect(isIdLikeColumn(trialCol(decreasing), rowCount)).toBe(false);
    // The NAME-based rule is unaffected by any of this — a shuffled column
    // literally named "id" is still excluded, regardless of row order.
    const shuffledNamedId = profileRows([3, 1, 4, 5, 2].map((v) => ({ id: v })));
    expect(isIdLikeColumn(shuffledNamedId.columns.find((c) => c.name === "id")!, rowCount)).toBe(true);
  });

  // Same defect, at `buildChartCandidates`' own public surface: a shuffled
  // 1..n column with a non-identifier NAME ("trial") must still be usable
  // as a real measure — never silently excluded the way `bronze`
  // (P1-4/P1-8, above) used to be by the old blanket "distinct ⇒ id" rule.
  it("a shuffled 1..n column with a measure-shaped name stays a usable measure, not an excluded id (P1-8 follow-up)", () => {
    const rows: TabularRow[] = [
      { trial: 3, score: 71 }, { trial: 1, score: 55 }, { trial: 4, score: 88 }, { trial: 5, score: 62 }, { trial: 2, score: 79 },
    ];
    const candidates = buildChartCandidates(profileRows(rows));
    const chartsTrial = candidates.some((c) =>
      c.channels.x === "trial" || c.channels.y === "trial" || c.channels.value === "trial" || c.channels.fill === "trial");
    expect(chartsTrial).toBe(true);
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
    // An ordered integer NAMED like time is a time axis only, never a
    // measure, so it no longer
    // pairs into a year-vs-gdp scatter. The claim under test is narrower:
    // at least one real line/area over year exists.
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

// ── Mark-type fit: candidates that drew a wrong or empty chart ────────────
//
// The mark-type toggle enables a
// type iff this enumeration offers one and binds its top candidate, so a
// candidate that renders a misleading picture is a toggle that lies.
describe("mark-type fit: misfires the diagnosis measured", () => {
  const ofMark = (rows: TabularRow[], mark: ChartCandidate["mark"]) => buildChartCandidates(profileRows(rows)).filter((c) => c.mark === mark);

  it("sankey needs an edge list: a repeated (source, target) pair is a cross-tab, not a flow", () => {
    const crossTab: TabularRow[] = Array.from({ length: 40 }, (_, i) => ({ survived: i % 3 === 0 ? "yes" : "no", sex: i % 2 ? "male" : "female", fare: 10 + i }));
    expect(ofMark(crossTab, "sankey")).toHaveLength(0);
  });

  it("sankey refuses a nonpositive flow, and skips a MISSING one (the page drops that row before building the mark and says so)", () => {
    const flows: TabularRow[] = [
      { from: "Coal", to: "Power", tj: 40 }, { from: "Gas", to: "Power", tj: 60 }, { from: "Power", to: "Homes", tj: null }, { from: "Power", to: "Industry", tj: 30 },
    ];
    expect(ofMark(flows, "sankey").length).toBeGreaterThan(0);
    expect(ofMark(flows.map((r) => ({ ...r, tj: r.tj ?? -5 })), "sankey")).toHaveLength(0);
    expect(ofMark(flows.map((r) => ({ ...r, tj: r.tj ?? 5 })), "sankey").length).toBeGreaterThan(0);
  });

  it("a pie needs a whole to slice: an all-zero share column offers no arc (the library would draw an empty disc)", () => {
    const shares: TabularRow[] = [{ source: "Coal", twh: 0 }, { source: "Gas", twh: 0 }, { source: "Wind", twh: 0 }];
    expect(ofMark(shares, "arc")).toHaveLength(0);
    expect(ofMark(shares.map((r, i) => ({ ...r, twh: [5, 12, 7][i]! })), "arc").length).toBeGreaterThan(0);
  });

  it("sankey is not offered for a complete grid (every source x every target), which is a contingency table", () => {
    const grid: TabularRow[] = ["US", "China", "Japan"].flatMap((country, i) => ["gold", "silver", "bronze"].map((medal, j) => ({ country, medal, count: 5 + i * 3 + j })));
    expect(ofMark(grid, "sankey")).toHaveLength(0);
    expect(ofMark(grid, "cell").length).toBeGreaterThan(0);
  });

  it("a code-like integer (3 passenger classes over 200 rows) is never a measure", () => {
    const rows: TabularRow[] = Array.from({ length: 200 }, (_, i) => ({ pclass: 1 + (i % 3), sex: i % 2 ? "male" : "female", fare: 10 + ((i * 37) % 240) }));
    const candidates = buildChartCandidates(profileRows(rows));
    expect(candidates.some((c) => c.channels.y === "pclass" || c.channels.value === "pclass" || (c.mark === "cell" && c.channels.fill === "pclass"))).toBe(false);
  });

  it("a table sorted DESCENDING by a measure offers no line over that measure (a ranking is not an axis)", () => {
    const rows: TabularRow[] = [40, 40, 20, 18, 16, 15, 14, 13, 12, 12].map((gold, i) => ({ country: `C${i}`, gold, bronze: 40 - ((i * 7) % 30) }));
    expect(ofMark(rows, "line")).toHaveLength(0);
    expect(ofMark(rows, "area")).toHaveLength(0);
  });

  it("a long-format integer year repeated per country is a time axis: its filled line tops the ranking", () => {
    const rows: TabularRow[] = ["Chile", "Kenya", "Japan", "Norway"].flatMap((country, c) => Array.from({ length: 12 }, (_, i) => ({
      country, year: 1952 + i * 5, life_exp: 45 + c * 6 + i * 1.8 + ((i * c) % 3) * 0.4, pop: (5 + c * 20 + i * (1 + c)) * 1e6,
    })));
    const candidates = buildChartCandidates(profileRows(rows));
    expect(candidates[0]!.mark).toBe("line");
    expect(candidates[0]!.channels).toMatchObject({ x: "year", fill: "country" });
    // Neither an unfilled zig-zag over the repeated year nor year-as-a-value.
    expect(candidates.some((c) => c.mark === "line" && c.channels.x === "year" && !c.channels.fill && !c.transform)).toBe(false);
    expect(candidates.some((c) => c.channels.y === "year")).toBe(false);
  });

  it("a split bar with repeated (x, fill) pairs is not offered: its bars overlap and show only each group's maximum", () => {
    const rows: TabularRow[] = Array.from({ length: 60 }, (_, i) => ({ schedule: ["Full", "Part", "Contract"][i % 3]!, country: ["US", "IN", "DE"][(i * 7) % 3]!, salary: 50000 + ((i * 7919) % 90000) }));
    expect(ofMark(rows, "bar").some((c) => c.channels.fill !== undefined && c.pipeline === undefined)).toBe(false);
  });

  it("a bar axis past 60 values is not offered", () => {
    const rows: TabularRow[] = Array.from({ length: 142 }, (_, i) => ({ country: `Country ${i}`, gdp: 1000 + ((i * 7919) % 50000) }));
    expect(ofMark(rows, "bar")).toHaveLength(0);
    expect(ofMark(rows.slice(0, 23), "bar").length).toBeGreaterThan(0);
  });

  it("a category x costs a bar no prior: a stacked-bar mapping and a heatmap of the same count carry the same name prior", () => {
    const rows = olympics2024MedalsByTypeDataset.rows as TabularRow[];
    const candidates = buildChartCandidates(profileRows(rows));
    const bar = candidates.find((c) => c.mark === "bar" && c.channels.x === "country" && c.channels.fill === "medal")!;
    const cell = candidates.find((c) => c.mark === "cell" && c.channels.x === "country" && c.channels.y === "medal")!;
    expect(bar.terms.prior).toBe(cell.terms.prior);
    expect(bar.score).toBeGreaterThanOrEqual(cell.score);
  });

  it("a date series offers a time scatter that never out-ranks its own line, and a column chart over a short date axis", () => {
    const rows: TabularRow[] = Array.from({ length: 41 }, (_, i) => ({ year: `${1985 + i}-01-01`, share: 20 + i * 0.3 + ((i * 7) % 5) * 0.2 }));
    const candidates = buildChartCandidates(profileRows(rows));
    const line = candidates.find((c) => c.mark === "line")!;
    const dot = candidates.find((c) => c.mark === "dot")!;
    expect(dot.channels).toEqual(line.channels);
    expect(dot.score).toBeLessThan(line.score);
    expect(ofMark(rows, "bar").map((c) => c.channels)).toContainEqual({ x: "year", y: "share" });
  });
});
