// Which mark types the CURRENT data can honestly draw, and what each one
// binds when a reader picks it — the one source of truth behind the mark
// card's Type toggle (AGENTS.md's "Charts" "Data layer"; rationale and the
// 16-dataset matrix in `docs/design/charts.md`'s "Mark-type fit").
//
// A type FITS iff the information ranker (`lib/chartCandidates.ts`'s
// `buildChartCandidates`) produces at least one candidate of that type the
// page can bind, and picking it binds THAT type's top-ranked candidate
// (channels, transform, reshape pipeline). The table below is the only
// per-type data: nothing else in the page branches on a type's name to
// decide fit.
import type { GlyphChartMarkType } from "@glyphcss/charts";
import { buildChartCandidates, type ChartCandidate } from "../../lib/chartCandidates";
import type { PipelineStep } from "../../lib/dataPipeline";
import { profileRows } from "../../lib/dataProfile";
import type { TabularRow } from "../../lib/tabularParse";
import type { ChartsRecommendedChannels } from "./chartsDataSource";
import { findChartsDataset, type ChartsDatasetRecommendation } from "./datasets";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsWorkbenchState";

export interface ChartsMarkTypeRule {
  /** What a reader calls it — the word the reason sentence opens with. */
  readonly name: string;
  /** The reason a disabled button carries, on its title and aria-label. */
  readonly needs: string;
  /** `buildChartCandidates` enumerates this type. `false` types never fit
   *  a dataset: `rect` has no range channels on this page (it draws
   *  exactly what `bar` draws), and `text`/`rule` are annotation layers
   *  over another mark while the page charts one mark at a time. */
  readonly ranked: boolean;
  /** A bare numeric array (the tray's sample series) draws honestly as
   *  this type over its own index. The ranker never sees one — it has no
   *  columns — so this is the series half of the same rule. */
  readonly series: boolean;
}

export const CHARTS_MARK_TYPE_RULES: Readonly<Record<GlyphChartMarkType, ChartsMarkTypeRule>> = {
  line: { name: "Line", ranked: true, series: true, needs: "Line needs a date or steadily increasing number column and a number column." },
  area: { name: "Area", ranked: true, series: true, needs: "Area needs a date or steadily increasing number column and a number column." },
  bar: { name: "Bar", ranked: true, series: true, needs: "Bar needs a category or short date column and a number column." },
  dot: { name: "Dot", ranked: true, series: true, needs: "Dot needs two number columns, or a date and a number column." },
  arc: { name: "Pie", ranked: true, series: false, needs: "Pie needs one category (2 to 6 values, one row each) and one non-negative number column." },
  cell: { name: "Heatmap", ranked: true, series: false, needs: "Heatmap needs two category columns and a number column." },
  sankey: { name: "Sankey", ranked: true, series: false, needs: "Sankey needs source and target category columns, one row per link, and a positive number column." },
  funnel: { name: "Funnel", ranked: true, series: false, needs: "Funnel needs a stage column (named like stage or step) and a positive number column." },
  rect: { name: "Rect", ranked: false, series: false, needs: "Rect needs x/y range columns, which this page doesn't bind; Bar draws the same shapes." },
  text: { name: "Text", ranked: false, series: false, needs: "Text labels annotate another chart, and this page draws one mark at a time." },
  rule: { name: "Rule", ranked: false, series: false, needs: "Rule draws reference lines over another chart, and this page draws one mark at a time." },
};

/** What picking a type installs on the mark. `channels` name columns of the
 *  rows AFTER `pipeline` runs. */
export interface ChartsMarkBinding {
  readonly channels: ChartsRecommendedChannels;
  readonly transform: ChartsWorkbenchMark["transform"];
  readonly pipeline?: readonly PipelineStep[];
}
export type ChartsMarkTypeFit =
  | { readonly fits: true; readonly binding: ChartsMarkBinding }
  | { readonly fits: false; readonly reason: string };
export type ChartsMarkTypeFitTable = Readonly<Record<GlyphChartMarkType, ChartsMarkTypeFit>>;

/** The rows a type switch re-derives from: a vendored dataset's OWN rows
 *  when the chart is made of one with no pipeline (so a switch never
 *  compounds an earlier switch's reshape), otherwise the mark's own data. */
export interface ChartsMarkTypeBase {
  readonly key: string;
  readonly rows: readonly TabularRow[] | readonly number[] | null;
  readonly curated?: ChartsDatasetRecommendation;
}

export function chartsMarkTypeBase(data: ChartsWorkbenchDataState, mark: ChartsWorkbenchMark): ChartsMarkTypeBase {
  if (data.source?.kind === "dataset" && data.pipeline.length === 0) {
    const dataset = findChartsDataset(data.source.id);
    if (dataset) return { key: `dataset:${dataset.id}`, rows: dataset.rows, curated: dataset.recommended };
  }
  let rows: readonly TabularRow[] | readonly number[] | null = null;
  try {
    const parsed: unknown = JSON.parse(mark.dataText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (parsed.every((row) => typeof row === "number")) rows = parsed as number[];
      else if (parsed.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) rows = parsed as TabularRow[];
    }
  } catch { /* an in-progress edit fits nothing until it parses */ }
  return { key: `mark:${mark.dataText}`, rows };
}

/** The page binds `transform` as a bare kind, and the library's own
 *  `group` sums — a candidate that asks for a MEAN cannot be bound without
 *  silently summing instead, so it doesn't count toward fit. */
export function chartsCandidateBindable(candidate: Pick<ChartCandidate, "transform">): boolean {
  return candidate.transform === undefined || candidate.transform.reduce === "sum";
}

function curatedBinding(curated: ChartsDatasetRecommendation): ChartsMarkBinding {
  const { x, y, fill, label, source, target, value, stage, transform } = curated;
  return { channels: { x, y, fill, label, source, target, value, stage }, transform: transform ?? "none" };
}

function unfit(type: GlyphChartMarkType): ChartsMarkTypeFit {
  return { fits: false, reason: CHARTS_MARK_TYPE_RULES[type].needs };
}

function computeFitTable(base: ChartsMarkTypeBase): ChartsMarkTypeFitTable {
  const types = Object.keys(CHARTS_MARK_TYPE_RULES) as GlyphChartMarkType[];
  const rows = base.rows;
  if (rows === null) return Object.fromEntries(types.map((type) => [type, unfit(type)])) as Record<GlyphChartMarkType, ChartsMarkTypeFit>;
  if (rows.every((row) => typeof row === "number")) {
    return Object.fromEntries(types.map((type) => [type, CHARTS_MARK_TYPE_RULES[type].series
      ? { fits: true, binding: { channels: { x: "index", y: "value" }, transform: "none" } }
      : unfit(type)])) as Record<GlyphChartMarkType, ChartsMarkTypeFit>;
  }
  // Sorted best first, so the first bindable candidate of a type is its top.
  const candidates = buildChartCandidates(profileRows(rows as readonly TabularRow[]));
  return Object.fromEntries(types.map((type): [GlyphChartMarkType, ChartsMarkTypeFit] => {
    if (!CHARTS_MARK_TYPE_RULES[type].ranked) return [type, unfit(type)];
    // A vendored dataset's own curated chart is what `select-dataset`
    // draws; switching back to its type restores it rather than a
    // different ranked mapping of the same type.
    if (base.curated?.mark === type) return [type, { fits: true, binding: curatedBinding(base.curated) }];
    const top = candidates.find((c) => c.mark === type && chartsCandidateBindable(c));
    if (!top) return [type, unfit(type)];
    return [type, { fits: true, binding: { channels: top.channels, transform: top.transform?.kind ?? "none", ...(top.pipeline ? { pipeline: top.pipeline } : {}) } }];
  })) as Record<GlyphChartMarkType, ChartsMarkTypeFit>;
}

// Profiling plus enumeration costs a few milliseconds on a 200-row table
// (`docs/design/charts.md`'s "Mark-type fit" — timings), and the card asks
// on every render; the answer only changes when the base rows do.
const FIT_CACHE_LIMIT = 8;
const fitCache = new Map<string, ChartsMarkTypeFitTable>();

export function chartsMarkTypeFitTable(base: ChartsMarkTypeBase): ChartsMarkTypeFitTable {
  const hit = fitCache.get(base.key);
  if (hit) return hit;
  const table = computeFitTable(base);
  if (fitCache.size >= FIT_CACHE_LIMIT) fitCache.delete(fitCache.keys().next().value!);
  fitCache.set(base.key, table);
  return table;
}
