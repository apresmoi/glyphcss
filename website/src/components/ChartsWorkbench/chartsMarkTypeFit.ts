// Which mark types the CURRENT data can honestly draw, and what each one
// binds when a reader picks it — the one source of truth behind the mark
// card's Type toggle and a remote dataset's first chart (AGENTS.md's
// "Charts" "Data layer"; rationale and the 16-dataset matrix in
// `docs/design/charts.md`'s "Mark-type fit").
//
// A type FITS iff some candidate of it — the dataset's curated mapping, or
// one the information ranker (`lib/chartCandidates.ts`) offers, in rank
// order — binds every channel the type needs to a real column AND the mark
// built from it through the page's own build path renders. Picking it
// installs exactly that built mark, so an enabled button can't throw. The
// table below is the only per-type data: nothing else in the page branches
// on a type's name to decide fit.
import { glyphChartScaleDomains, renderGlyphChart, type GlyphChartMarkType, type GlyphChartRenderOptions } from "@glyphcss/charts";
import { buildChartCandidates, type ChartCandidate } from "../../lib/chartCandidates";
import { normaliseDateColumn, runPipeline, type PipelineStep } from "../../lib/dataPipeline";
import { profiledCellUsable, profileRows, type ColumnProfile } from "../../lib/dataProfile";
import type { TabularRow } from "../../lib/tabularParse";
import { buildDatasetMark, type ChartsRecommendedChannels } from "./chartsDataSource";
import { findChartsDataset, type ChartsDatasetRecommendation } from "./datasets";
// A cycle with chartsWorkbenchState.ts (its reducer asks this module for a
// binding, and this module renders through its spec builder); both sides
// only call into the other at run time, never while a module initialises.
import {
  buildChartsWorkbenchSpec, chartRelevantChannels, createChartsWorkbenchState,
  type ChartsWorkbenchDataState, type ChartsWorkbenchMark, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";

type ChannelKey = keyof ChartsRecommendedChannels;

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
  /** A bare number series (the tray's sample lists, or a table whose only
   *  chartable content is one measure) draws honestly as this type over
   *  its own index. */
  readonly series: boolean;
  /** Channels a binding of this type must name, each a real column. */
  readonly requires: readonly ChannelKey[];
  /** How the fit probe proves a built mark renders
   *  (`chartsBuiltMarkRenders`): the library's validation and scales, or a
   *  small render for the marks that refuse while laying out. */
  readonly probe: "scales" | "render";
}

const XY: readonly ChannelKey[] = ["x", "y"];
export const CHARTS_MARK_TYPE_RULES: Readonly<Record<GlyphChartMarkType, ChartsMarkTypeRule>> = {
  line: { name: "Line", ranked: true, series: true, requires: XY, probe: "scales", needs: "Line needs a date or steadily increasing number column and a number column." },
  area: { name: "Area", ranked: true, series: true, requires: XY, probe: "scales", needs: "Area needs a date or steadily increasing number column and a number column." },
  bar: { name: "Bar", ranked: true, series: true, requires: XY, probe: "scales", needs: "Bar needs a category or short date column and a number column." },
  dot: { name: "Dot", ranked: true, series: true, requires: XY, probe: "scales", needs: "Dot needs two number columns, or a date and a number column." },
  arc: { name: "Pie", ranked: true, series: false, requires: ["y"], probe: "render", needs: "Pie needs one category (2 to 6 values, one row each) and one non-negative number column that isn't all zero." },
  cell: { name: "Heatmap", ranked: true, series: false, requires: ["x", "y", "fill"], probe: "scales", needs: "Heatmap needs two category columns and a number column." },
  sankey: { name: "Sankey", ranked: true, series: false, requires: ["source", "target", "value"], probe: "render", needs: "Sankey needs source and target category columns, one row per link, and a positive number column." },
  funnel: { name: "Funnel", ranked: true, series: false, requires: ["stage", "value"], probe: "render", needs: "Funnel needs a stage column (named like stage or step) and a positive number column." },
  rect: { name: "Rect", ranked: false, series: false, requires: [], probe: "scales", needs: "Rect needs x/y range columns, which this page doesn't bind; Bar draws the same shapes." },
  text: { name: "Text", ranked: false, series: false, requires: [], probe: "scales", needs: "Text labels annotate another chart, and this page draws one mark at a time." },
  rule: { name: "Rule", ranked: false, series: false, requires: [], probe: "scales", needs: "Rule draws reference lines over another chart, and this page draws one mark at a time." },
};
const MARK_TYPES = Object.keys(CHARTS_MARK_TYPE_RULES) as GlyphChartMarkType[];

/** What picking a type installs on the mark. `channels` name columns of the
 *  rows AFTER `pipeline` runs; `series` names the one column drawn as a
 *  bare number list over its index (`channels` is then `index`/`value`). */
export interface ChartsMarkBinding {
  readonly channels: ChartsRecommendedChannels;
  readonly transform: ChartsWorkbenchMark["transform"];
  readonly pipeline?: readonly PipelineStep[];
  readonly series?: string;
}
/** Rows a binding leaves out because a column it charts holds no usable
 *  value of that column's type there (a null, or a stray string in a date
 *  or number column). */
export interface ChartsOmittedRows {
  readonly count: number;
  readonly total: number;
  readonly columns: readonly string[];
}
export type ChartsMarkTypeFit =
  | {
      readonly fits: true; readonly binding: ChartsMarkBinding;
      /** Position of the winning candidate in the ranker's list (curated: -1). */
      readonly rank: number;
      readonly omitted: ChartsOmittedRows | null;
    }
  | { readonly fits: false; readonly reason: string };
export type ChartsMarkTypeFitTable = Readonly<Record<GlyphChartMarkType, ChartsMarkTypeFit>>;

// ── The rows a type switch re-derives from ─────────────────────────────

/** A remote dataset's rows as it was loaded. Its marks carry reshaped and
 *  cleaned rows, and the `?c=` link carries none, so without this a type
 *  switch would re-derive from the previous switch's reshape (a melted
 *  table offers a heatmap and hides the scatter of its own measures). A
 *  session memo keyed by `ref`: `select-remote-dataset` records it, and a
 *  re-fetch of the same ref replaces it. */
const REMOTE_ROWS_LIMIT = 8;
const remoteRows = new Map<string, readonly TabularRow[]>();
export function chartsRememberRemoteRows(ref: string, rows: readonly TabularRow[]): void {
  remoteRows.delete(ref);
  remoteRows.set(ref, rows);
  if (remoteRows.size > REMOTE_ROWS_LIMIT) remoteRows.delete(remoteRows.keys().next().value!);
}
export function chartsRemoteRows(ref: string): readonly TabularRow[] | undefined {
  return remoteRows.get(ref);
}

/** The rows a type switch re-derives from: a vendored dataset's OWN rows
 *  when the chart is made of one with no pipeline, a remote dataset's rows
 *  as loaded, otherwise the mark's own data. `key` is set only for rows
 *  parsed fresh per call; a stable array is memoised by identity. */
export interface ChartsMarkTypeBase {
  readonly key?: string;
  readonly rows: readonly TabularRow[] | readonly number[] | null;
  readonly curated?: ChartsDatasetRecommendation;
}

export function chartsMarkTypeBase(data: ChartsWorkbenchDataState, mark: ChartsWorkbenchMark): ChartsMarkTypeBase {
  if (data.source?.kind === "dataset" && data.pipeline.length === 0) {
    const dataset = findChartsDataset(data.source.id);
    if (dataset) return { rows: dataset.rows, curated: dataset.recommended };
  }
  if (data.source?.kind === "remote" && data.pipeline.length === 0) {
    const loaded = chartsRemoteRows(data.source.ref);
    if (loaded) return { rows: loaded };
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

// ── The one build path ──────────────────────────────────────────────────

/** The page binds `transform` as a bare kind, and the library's own
 *  `group` sums — a candidate that asks for a MEAN cannot be bound without
 *  silently summing instead, so it doesn't count toward fit. */
export function chartsCandidateBindable(candidate: Pick<ChartCandidate, "transform">): boolean {
  return candidate.transform === undefined || candidate.transform.reduce === "sum";
}

export interface ChartsBuiltMark {
  readonly mark: ChartsWorkbenchMark;
  /** The x channel is a date column, so the x scale must be `time`. */
  readonly isDate: boolean;
  readonly omitted: ChartsOmittedRows | null;
}

const SERIES_CHANNELS: ChartsRecommendedChannels = { x: "index", y: "value" };

function seriesMark(id: number, type: GlyphChartMarkType, values: readonly number[]): ChartsWorkbenchMark {
  return { id, type, dataText: JSON.stringify(values, null, 2), channels: { ...SERIES_CHANNELS }, transform: "none", options: {} };
}

/**
 * Builds the mark a binding describes — `set-mark-type`, `select-dataset`,
 * `select-remote-dataset` and the fit probe all go through here, so what a
 * button was tested with is what it installs. `null` when the binding
 * can't be built: a channel the type requires is unbound or names no
 * column, the reshape fails, or no row survives.
 *
 * Rows whose charted cells don't hold their column's profiled type are
 * DROPPED and reported in `omitted` (the rail says so): the profiler types
 * a column by its non-null values, while the renderer rejects the first
 * null date or null sankey endpoint outright. A category column mixing
 * numbers and strings is read as the strings it mostly is, since the
 * renderer infers a numeric x from the first number and rejects the rest
 * (`mixed-x-scale`). A date x is normalised to the ISO form the library's
 * time domain accepts.
 */
export function chartsBuildBoundMark(id: number, type: GlyphChartMarkType, rows: readonly TabularRow[] | readonly number[], binding: ChartsMarkBinding): ChartsBuiltMark | null {
  if (rows.length === 0) return null;
  if (rows.every((row) => typeof row === "number")) {
    const values = (rows as readonly number[]).filter(Number.isFinite);
    return values.length === 0 ? null : { mark: seriesMark(id, type, values), isDate: false, omitted: null };
  }
  let out = rows as readonly TabularRow[];
  if (binding.pipeline && binding.pipeline.length > 0) {
    const reshaped = runPipeline(out, binding.pipeline);
    if (!reshaped.ok) return null;
    out = reshaped.rows;
  }
  const columns = new Map(profileRows(out).columns.map((col) => [col.name, col]));
  if (binding.series !== undefined) {
    const col = columns.get(binding.series);
    if (!col) return null;
    const values = out.map((row) => row[binding.series!] ?? null).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length === 0) return null;
    const count = out.length - values.length;
    return { mark: seriesMark(id, type, values), isDate: false, omitted: count > 0 ? { count, total: out.length, columns: [col.name] } : null };
  }
  const relevant = chartRelevantChannels(type) as readonly ChannelKey[];
  if (CHARTS_MARK_TYPE_RULES[type].requires.some((key) => !binding.channels[key])) return null;
  const bound: ColumnProfile[] = [];
  for (const key of relevant) {
    const name = binding.channels[key];
    if (!name) continue;
    const col = columns.get(name);
    if (!col) return null;
    if (!bound.includes(col)) bound.push(col);
  }
  const refused = new Set<string>();
  const kept = out.filter((row) => {
    let ok = true;
    for (const col of bound) {
      if (!profiledCellUsable(col, row[col.name] ?? null)) { refused.add(col.name); ok = false; }
    }
    return ok;
  });
  if (kept.length === 0) return null;
  const stringify = bound.filter((col) => (col.type === "category" || col.type === "text") && kept.some((row) => typeof row[col.name] !== "string"));
  const dateColumn = binding.channels.x !== undefined && columns.get(binding.channels.x)?.type === "date" ? binding.channels.x : undefined;
  const markRows = stringify.length === 0 && dateColumn === undefined ? kept : kept.map((row) => {
    const next: TabularRow = { ...row };
    for (const col of stringify) next[col.name] = String(row[col.name]);
    if (dateColumn !== undefined) next[dateColumn] = normaliseDateColumn(row[dateColumn] ?? null);
    return next;
  });
  const count = out.length - kept.length;
  return {
    mark: buildDatasetMark(id, type, markRows, binding.channels, binding.transform),
    isDate: dateColumn !== undefined,
    omitted: count > 0 ? { count, total: out.length, columns: [...refused] } : null,
  };
}

/** What the rail says about rows a chart leaves out. */
export function chartsOmittedRowsNote(omitted: ChartsOmittedRows): string {
  const one = omitted.count === 1;
  return `${omitted.count} of ${omitted.total} rows ${one ? "has" : "have"} no usable ${omitted.columns.join(", ")} and ${one ? "isn't" : "aren't"} drawn.`;
}

// ── The render probe ────────────────────────────────────────────────────

/** Small, colourless and ASCII: a flow or share mark's refusals are
 *  statements about its data (an endpoint, a cycle, a zero total), made
 *  while it lays out, not about the grid it lands on. */
const PROBE_OPTIONS: GlyphChartRenderOptions = { target: "web", width: 32, height: 12, charset: "ascii", color: "none" };
let probeBase: ChartsWorkbenchState | undefined;

/**
 * The built mark renders through the page's own spec builder, and draws
 * something (an all-zero pie renders an empty disc with `empty-total`).
 * A cartesian mark's every data refusal (channels, non-finite data, mixed
 * or bad time domains, a bar domain without zero) is made by the library's
 * validation and scale resolution, which `glyphChartScaleDomains` runs
 * without painting; painting a 3,000-row area even at 32x12 costs ~87 ms.
 * `arc`/`sankey`/`funnel` refuse while laying out, so they render.
 */
export function chartsBuiltMarkRenders(built: ChartsBuiltMark): boolean {
  probeBase ??= createChartsWorkbenchState();
  const state: ChartsWorkbenchState = {
    ...probeBase, marks: [built.mark],
    scales: { x: built.isDate ? { type: "time", min: "", max: "" } : probeBase.scales.x, y: probeBase.scales.y },
  };
  try {
    const spec = buildChartsWorkbenchSpec(state);
    if (CHARTS_MARK_TYPE_RULES[built.mark.type].probe === "scales") { glyphChartScaleDomains(spec); return true; }
    return !renderGlyphChart(spec, PROBE_OPTIONS).report.ledger.some((entry) => entry.code === "empty-total");
  } catch { return false; }
}

// ── The table ───────────────────────────────────────────────────────────

/** How many BUILT candidates of one type are probed before the type is
 *  called unfit. The build already drops unusable rows, so the first one
 *  renders in every shape the property suite throws at it; the cap bounds
 *  the cost on data where every candidate fails for one shared reason. */
const FIT_PROBE_ATTEMPTS = 3;

function unfit(type: GlyphChartMarkType): ChartsMarkTypeFit {
  return { fits: false, reason: CHARTS_MARK_TYPE_RULES[type].needs };
}

function curatedBinding(curated: ChartsDatasetRecommendation): ChartsMarkBinding {
  const { x, y, fill, label, source, target, value, stage, transform } = curated;
  return { channels: { x, y, fill, label, source, target, value, stage }, transform: transform ?? "none" };
}

function candidateBinding(candidate: ChartCandidate): ChartsMarkBinding {
  if (candidate.rowOrder) return { channels: SERIES_CHANNELS, transform: "none", series: candidate.channels.y };
  return { channels: candidate.channels, transform: candidate.transform?.kind ?? "none", ...(candidate.pipeline ? { pipeline: candidate.pipeline } : {}) };
}

function firstRendering(type: GlyphChartMarkType, rows: readonly TabularRow[] | readonly number[], attempts: Iterable<{ readonly binding: ChartsMarkBinding; readonly rank: number }>): ChartsMarkTypeFit {
  let probed = 0;
  for (const { binding, rank } of attempts) {
    const built = chartsBuildBoundMark(0, type, rows, binding);
    if (!built) continue;
    if (chartsBuiltMarkRenders(built)) return { fits: true, binding, rank, omitted: built.omitted };
    if (++probed >= FIT_PROBE_ATTEMPTS) break;
  }
  return unfit(type);
}

function computeFitTable(base: ChartsMarkTypeBase): ChartsMarkTypeFitTable {
  const rows = base.rows;
  const table = {} as Record<GlyphChartMarkType, ChartsMarkTypeFit>;
  if (rows === null || rows.length === 0) {
    for (const type of MARK_TYPES) table[type] = unfit(type);
    return table;
  }
  if (rows.every((row) => typeof row === "number")) {
    MARK_TYPES.forEach((type, rank) => {
      table[type] = CHARTS_MARK_TYPE_RULES[type].series ? firstRendering(type, rows, [{ binding: { channels: SERIES_CHANNELS, transform: "none" }, rank }]) : unfit(type);
    });
    return table;
  }
  // Sorted best first, so the first candidate of a type that renders is its top.
  const candidates = buildChartCandidates(profileRows(rows as readonly TabularRow[]));
  for (const type of MARK_TYPES) {
    const rule = CHARTS_MARK_TYPE_RULES[type];
    if (!rule.ranked) { table[type] = unfit(type); continue; }
    // A vendored dataset's own curated chart is what `select-dataset`
    // draws; switching back to its type restores it rather than a
    // different ranked mapping of the same type.
    const curated = base.curated?.mark === type ? [{ binding: curatedBinding(base.curated), rank: -1 }] : [];
    // The row-order fallback is a series: it draws as every series type.
    const ranked = candidates.flatMap((candidate, rank) =>
      (candidate.rowOrder ? rule.series : candidate.mark === type) && chartsCandidateBindable(candidate) ? [{ binding: candidateBinding(candidate), rank }] : []);
    table[type] = firstRendering(type, rows, [...curated, ...ranked]);
  }
  return table;
}

// Profiling, enumeration and one small probe render per fitting type cost
// 1 to 14 ms on the vendored datasets (`docs/design/charts.md`'s round 2),
// and the card asks on every render; the answer only changes with the rows.
// A stable array (a vendored or remote dataset's own rows) is memoised by
// identity AND its curated mapping, since the same rows with and without
// one fit differently; rows parsed from a mark's text by that text.
const FIT_CACHE_LIMIT = 8;
const fitByText = new Map<string, ChartsMarkTypeFitTable>();
const fitByRows = new WeakMap<object, Map<ChartsDatasetRecommendation | undefined, ChartsMarkTypeFitTable>>();

export function chartsMarkTypeFitTable(base: ChartsMarkTypeBase): ChartsMarkTypeFitTable {
  if (base.key === undefined && base.rows !== null) {
    let byCurated = fitByRows.get(base.rows);
    if (!byCurated) fitByRows.set(base.rows, byCurated = new Map());
    const hit = byCurated.get(base.curated);
    if (hit) return hit;
    const table = computeFitTable(base);
    byCurated.set(base.curated, table);
    return table;
  }
  const key = base.key ?? "";
  const hit = fitByText.get(key);
  if (hit) return hit;
  const table = computeFitTable(base);
  if (fitByText.size >= FIT_CACHE_LIMIT) fitByText.delete(fitByText.keys().next().value!);
  fitByText.set(key, table);
  return table;
}

/** The type a remote dataset opens on: the best-ranked fitting candidate
 *  across every type. */
export function chartsBestFit(table: ChartsMarkTypeFitTable): { readonly type: GlyphChartMarkType; readonly binding: ChartsMarkBinding } | null {
  let best: { type: GlyphChartMarkType; binding: ChartsMarkBinding; rank: number } | null = null;
  for (const type of MARK_TYPES) {
    const fit = table[type];
    if (fit.fits && (best === null || fit.rank < best.rank)) best = { type, binding: fit.binding, rank: fit.rank };
  }
  return best && { type: best.type, binding: best.binding };
}

/**
 * P2-3 (REVIEW-arc-density-search-opus.md): a remote dataset can LOAD fine
 * and still have nothing to chart — every column categorical/boolean
 * (`mstz/mushroom`), or every candidate failing to render. Checked before
 * `select-remote-dataset` is dispatched (a reducer can't report its own
 * no-op back), so the caller can skip both the dispatch and the Recent
 * entry and say why. The table it computes is the one the reducer then
 * reads, memoised on the same rows array.
 */
export function remoteDatasetRecommendationCheck(rows: readonly TabularRow[]): { readonly ok: true } | { readonly ok: false; readonly columns: readonly string[] } {
  if (chartsBestFit(chartsMarkTypeFitTable({ rows }))) return { ok: true };
  return { ok: false, columns: profileRows(rows).columns.map((c) => `${c.name} (${c.type})`) };
}

/** Rows the CURRENT chart leaves out — reported only while the mark is
 *  still exactly its type's binding (a later channel edit or a hand-built
 *  link charts something else). */
export function chartsMarkOmittedRows(table: ChartsMarkTypeFitTable, mark: ChartsWorkbenchMark): ChartsOmittedRows | null {
  const fit = table[mark.type];
  if (!fit.fits || fit.omitted === null || fit.binding.transform !== mark.transform) return null;
  const keys: readonly ChannelKey[] = ["x", "y", "fill", "label", "source", "target", "value", "stage"];
  return keys.every((key) => (fit.binding.channels[key] || undefined) === (mark.channels[key] || undefined)) ? fit.omitted : null;
}
