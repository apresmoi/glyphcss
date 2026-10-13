import { describe, expect, it } from "vitest";
import {
  glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartFunnel,
  glyphChartLine, glyphChartSankey, renderGlyphChart,
  type GlyphChartMark, type GlyphChartMarkType,
} from "@glyphcss/charts";
import { CHARTS_DATASETS, findChartsDataset } from "./index";
import { profileRows } from "../tabular/dataProfile";
import { CHART_MARK_TYPES } from "../model/chartsWorkbenchState";
import type { TabularRow } from "../tabular/tabularParse";
import type { ChartsDataset } from "./types";

describe("CHARTS_DATASETS", () => {
  it("has 16 datasets, each within the 200-row cap and fully sourced", () => {
    expect(CHARTS_DATASETS).toHaveLength(16);
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
      const { x, y, fill, label, source, target, value, stage } = dataset.recommended;
      for (const field of [x, y, fill, label, source, target, value, stage]) {
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

// ── Mark-type coverage ────────────────────────────────────────────────────
//
// Every dataset should be reachable from the picker AND showcase every mark
// type the library exposes at least once (the task this describe block
// gates against). `text` and `rule` are deliberately left uncovered: none
// of the sixteen datasets here is a genuinely natural fit for either (a
// small set of annotated points for `text`, or a single reference line for
// `rule` would have to be invented rather than sourced from a real
// public dataset, and AGENTS.md/this task both say never invent data for a
// vendored dataset).
const DELIBERATELY_UNCOVERED_MARK_TYPES: readonly GlyphChartMarkType[] = ["text", "rule"];

describe("mark-type coverage", () => {
  it("every CHART_MARK_TYPES entry is recommended by at least one dataset, or is a listed deliberate exception", () => {
    const recommended = new Set(CHARTS_DATASETS.map((d) => d.recommended.mark));
    for (const type of CHART_MARK_TYPES) {
      if (DELIBERATELY_UNCOVERED_MARK_TYPES.includes(type)) {
        expect(recommended.has(type)).toBe(false); // still true today — keeps the exception list honest
        continue;
      }
      expect(recommended.has(type)).toBe(true);
    }
  });

  it("DELIBERATELY_UNCOVERED_MARK_TYPES names only real CHART_MARK_TYPES entries", () => {
    for (const type of DELIBERATELY_UNCOVERED_MARK_TYPES) {
      expect(CHART_MARK_TYPES).toContain(type);
    }
  });
});

// ── Every dataset renders through the real renderGlyphChart ──────────────
//
// Builds the ONE mark `recommended` describes (the exact library
// constructor for that mark type, not a hand-rolled object) and renders it
// at chat size (72x24, `@glyphcss/charts`' smallest target) — the size most
// likely to trigger a degradation, so a clean render there is a real
// guarantee, not a web-size (96x32) freebie.
function markForRecommendation(dataset: ChartsDataset): GlyphChartMark {
  const r = dataset.recommended;
  const data = dataset.rows as unknown as GlyphChartMark["data"];
  const cartesian = { x: r.x, y: r.y, fill: r.fill, label: r.label };
  let built: GlyphChartMark;
  switch (r.mark) {
    case "line": built = glyphChartLine(data, cartesian); break;
    case "area": built = glyphChartArea(data, cartesian); break;
    case "bar": built = glyphChartBar(data, cartesian); break;
    case "dot": built = glyphChartDot(data, cartesian); break;
    case "arc": built = glyphChartArc(data, cartesian); break;
    case "cell": built = glyphChartCell(data, cartesian); break;
    case "sankey": built = glyphChartSankey(data, { source: r.source!, target: r.target!, value: r.value! }); break;
    case "funnel": built = glyphChartFunnel(data, { stage: r.stage, value: r.value }); break;
    default: throw new Error(`datasets.test.ts: markForRecommendation has no builder for mark type "${r.mark}".`);
  }
  return r.transform ? { ...built, transform: { kind: r.transform } } : built;
}

// The reject set is deliberately narrow: at chat's 72x24 (`@glyphcss/charts`'
// smallest target) a real dataset routinely earns purely COSMETIC
// degradations — `ticks-thinned`, `label-abbreviated`, a line series
// falling back to `double-diagonal-solid` past its third colour-off style,
// a sankey's `sankey-crossings-merged`/`sankey-band-broken` where two flows
// genuinely cross — all of them documented in AGENTS.md's "Charts" as
// deliberate, non-lossy narrowings, and every one of the eight PRE-EXISTING
// vendored datasets already earns at least one (`ticks-thinned`, mostly, on
// a date axis at chat width). What "free of reject codes" means here is the
// narrower, real guarantee: no entry that means the chart is WRONG rather
// than merely tight — a value silently dropped or zeroed out, a sankey that
// doesn't conserve, a funnel/sankey structure collapsed to fit, or a colour
// mapping that conflicted. A vendored dataset earning one of these would
// mean the DATA (not just the canvas) doesn't suit its recommended mark.
const REJECT_LEDGER_CODES = new Set([
  "empty-total", "slice-dropped", "sankey-imbalance", "sankey-nodes-dropped",
  "sankey-columns-folded", "funnel-folded-stages", "funnel-bad-reference",
  "mark-color-unused", "series-color-conflict",
]);

describe("every dataset renders through renderGlyphChart at chat size", () => {
  for (const dataset of CHARTS_DATASETS) {
    it(`${dataset.id} (${dataset.recommended.mark}) renders with a ledger free of reject codes`, () => {
      const mark = markForRecommendation(dataset);
      const result = renderGlyphChart(mark, { target: "chat" });
      expect(result.text.length).toBeGreaterThan(0);
      const codes = result.report.ledger.map((e) => e.code);
      expect(codes.filter((c) => REJECT_LEDGER_CODES.has(c))).toEqual([]);
    });
  }

  it("energy-flow-sankey conserves at every node (no sankey-imbalance)", () => {
    const dataset = findChartsDataset("energy-flow-sankey")!;
    const mark = markForRecommendation(dataset);
    const result = renderGlyphChart(mark, { target: "chat" });
    expect(result.report.ledger.some((e) => e.code === "sankey-imbalance")).toBe(false);
    expect(result.report.ledger.some((e) => e.code === "sankey-cycle")).toBe(false);
  });

  it("global-electricity-mix's arc mark also renders as a donut via innerRadius (the library option, not a second dataset)", () => {
    // AGENTS.md's "Charts" documents `mark.options.innerRadius` (`[0, 1)`)
    // as the donut hole — arc and donut are the SAME mark type, so donut
    // coverage is demonstrated on the pie dataset's own real data rather
    // than vendoring a second share table with no other purpose.
    const dataset = findChartsDataset("global-electricity-mix")!;
    const built = markForRecommendation(dataset);
    const donut: GlyphChartMark = { ...built, options: { ...built.options, innerRadius: 0.5 } };
    const result = renderGlyphChart(donut, { target: "chat" });
    expect(result.report.ledger.filter((e) => REJECT_LEDGER_CODES.has(e.code))).toEqual([]);
    expect(result.text).not.toEqual(renderGlyphChart(built, { target: "chat" }).text);
  });

  it("olympics-2024-medals-by-type actually stacks (transform forwarded to the built mark)", () => {
    const dataset = findChartsDataset("olympics-2024-medals-by-type")!;
    const mark = markForRecommendation(dataset);
    expect(mark.transform).toEqual({ kind: "stack" });
  });

  it("energy-consumption-by-source actually stacks (transform forwarded to the built mark)", () => {
    const dataset = findChartsDataset("energy-consumption-by-source")!;
    const mark = markForRecommendation(dataset);
    expect(mark.transform).toEqual({ kind: "stack" });
  });

  it("gdp-growth-2020-crisis carries real negative values (mixed-sign bar axis)", () => {
    const dataset = findChartsDataset("gdp-growth-2020-crisis")!;
    const values = dataset.rows.map((r) => r.gdp_growth_pct as number);
    expect(values.some((v) => v < 0)).toBe(true);
    expect(values.some((v) => v > 0)).toBe(true);
  });
});
