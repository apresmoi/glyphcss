import {
  type GlyphChartMarkType,
  type GlyphChartRenderOptions,
  type GlyphChartTarget,
  renderGlyphChart,
} from "@glyphcss/charts";
import { type ChartsDatasetRecommendation } from "../data/index";
import { type ChartCandidate, buildChartCandidates } from "../tabular/chartCandidates";
import { type PipelineStep, normaliseDateColumn, runPipeline } from "../tabular/dataPipeline";
import { type ColumnProfile, profileRows, profiledCellUsable } from "../tabular/dataProfile";
import type { TabularRow } from "../tabular/tabularParse";
import { type ChartsRecommendedChannels, buildDatasetMark } from "./chartsDataSource";
import { type ChartsMarkTypeBase, chartsMarkTypeBase } from "./chartsMarkData";
import {
  type ChartsWorkbenchDataState,
  type ChartsWorkbenchMark,
  type ChartsWorkbenchState,
  buildChartsWorkbenchSpec,
  chartRelevantChannels,
  createChartsWorkbenchState,
} from "./chartsSpec";

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
}

const XY: readonly ChannelKey[] = ["x", "y"];

export const CHARTS_MARK_TYPE_RULES: Readonly<Record<GlyphChartMarkType, ChartsMarkTypeRule>> = {
  line: {
    name: "Line",
    ranked: true,
    series: true,
    requires: XY,
    needs:
      "Line needs a date or steadily increasing number column and a number column, with at least two rows in one series.",
  },
  area: {
    name: "Area",
    ranked: true,
    series: true,
    requires: XY,
    needs:
      "Area needs a date or steadily increasing number column and a number column that isn't all zero, with at least two rows in one series.",
  },
  bar: {
    name: "Bar",
    ranked: true,
    series: true,
    requires: XY,
    needs: "Bar needs a category or short date column and a number column that isn't all zero.",
  },
  dot: {
    name: "Dot",
    ranked: true,
    series: true,
    requires: XY,
    needs: "Dot needs two number columns, or a date and a number column.",
  },
  arc: {
    name: "Pie",
    ranked: true,
    series: false,
    requires: ["y"],
    needs:
      "Pie needs one category (2 to 6 values, one row each) and one non-negative number column that isn't all zero.",
  },
  cell: {
    name: "Heatmap",
    ranked: true,
    series: false,
    requires: ["x", "y", "fill"],
    needs: "Heatmap needs two category columns and a number column that isn't all zero.",
  },
  sankey: {
    name: "Sankey",
    ranked: true,
    series: false,
    requires: ["source", "target", "value"],
    needs: "Sankey needs source and target category columns, one row per link, and a positive number column.",
  },
  funnel: {
    name: "Funnel",
    ranked: true,
    series: false,
    requires: ["stage", "value"],
    needs: "Funnel needs a stage column (named like stage or step) and a positive number column.",
  },
  rect: {
    name: "Rect",
    ranked: false,
    series: false,
    requires: [],
    needs: "Rect needs x/y range columns, which this page doesn't bind; Bar draws the same shapes.",
  },
  text: {
    name: "Text",
    ranked: false,
    series: false,
    requires: [],
    needs: "Text labels annotate another chart, and this page draws one mark at a time.",
  },
  rule: {
    name: "Rule",
    ranked: false,
    series: false,
    requires: [],
    needs: "Rule draws reference lines over another chart, and this page draws one mark at a time.",
  },
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

/** Rows of the READER's table a binding leaves out because a column it
 *  charts holds no usable value of that column's type there (a null, or a
 *  stray string in a date or number column). Counted and named in the
 *  table as loaded, never in a reshape of it: `total` is its row count and
 *  `columns` its own column names. `partial` when a reshape charts several
 *  of a row's cells and some of that row still draws (one measure of a
 *  melted multi-measure bar). */
export interface ChartsOmittedRows {
  readonly count: number;
  readonly total: number;
  readonly columns: readonly string[];
  readonly partial: boolean;
}

export type ChartsMarkTypeFit =
  | {
      readonly fits: true;
      readonly binding: ChartsMarkBinding;
      /** Position of the winning candidate in the ranker's list (curated: -1). */
      readonly rank: number;
      readonly omitted: ChartsOmittedRows | null;
    }
  | { readonly fits: false; readonly reason: string };

export type ChartsMarkTypeFitTable = Readonly<Record<GlyphChartMarkType, ChartsMarkTypeFit>>;

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
  return {
    id,
    type,
    dataText: JSON.stringify(values, null, 2),
    channels: { ...SERIES_CHANNELS },
    transform: "none",
    options: {},
  };
}

/** Carries each reshaped row's position in the reader's own table through a
 *  melt, so the rows a chart leaves out are counted in that table
 *  (`ChartsOmittedRows`). A NUL-prefixed key: no parsed header or JSON
 *  field the page loads reaches a column name through it. */
const ORIGIN = "\u0000origin";

/** The only reshape the fit layer binds is a melt (`pivotLonger`), which
 *  copies its id columns onto every row it emits; any other step could
 *  drop or regroup on the origin column, so the count falls back to the
 *  reshaped rows. */
function tracksOrigin(pipeline: readonly PipelineStep[]): boolean {
  return pipeline.every((step) => step.kind === "pivotLonger");
}

/**
 * Builds the mark a binding describes — `set-mark-type`, `select-dataset`,
 * `select-remote-dataset`, a channel edit (`chartsRebindMark`) and the fit
 * probe all go through here, so what a button was tested with is what it
 * installs. `null` when the binding can't be built: a channel the type
 * requires is unbound or names no column, the reshape fails, or no row
 * survives.
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
export function chartsBuildBoundMark(
  id: number,
  type: GlyphChartMarkType,
  rows: readonly TabularRow[] | readonly number[],
  binding: ChartsMarkBinding,
): ChartsBuiltMark | null {
  if (rows.length === 0) return null;
  if (rows.every((row) => typeof row === "number")) {
    const values = (rows as readonly number[]).filter(Number.isFinite);
    return values.length === 0 ? null : { mark: seriesMark(id, type, values), isDate: false, omitted: null };
  }
  const records = rows as readonly TabularRow[];
  let out = records;
  let tracked = false;
  let melt: { readonly key: string; readonly value: string } | undefined;
  if (binding.pipeline && binding.pipeline.length > 0) {
    tracked = tracksOrigin(binding.pipeline);
    const steps = tracked
      ? binding.pipeline.map((step) =>
          step.kind === "pivotLonger" ? { ...step, idColumns: [...step.idColumns, ORIGIN] } : step,
        )
      : binding.pipeline;
    const reshaped = runPipeline(tracked ? records.map((row, i) => ({ ...row, [ORIGIN]: i })) : records, steps);
    if (!reshaped.ok) return null;
    out = reshaped.rows;
    for (const step of binding.pipeline) {
      if (step.kind === "pivotLonger") melt = { key: step.keyColumn ?? "key", value: step.valueColumn ?? "value" };
    }
  }
  const total = tracked || out === records ? records.length : out.length;
  const originOf = (row: TabularRow, j: number): number => (tracked ? (row[ORIGIN] as number) : j);
  // A refused cell is named by the reader's own column: a melted value
  // cell by the column it was melted from.
  const readerColumn = (row: TabularRow, name: string): string =>
    melt !== undefined && name === melt.value && typeof row[melt.key] === "string" ? (row[melt.key] as string) : name;
  const strip = (row: TabularRow): TabularRow => {
    if (!tracked) return row;
    const { [ORIGIN]: _origin, ...rest } = row;
    return rest;
  };
  const columns = new Map(profileRows(out).columns.map((col) => [col.name, col]));

  /** Keeps the rows `refused` finds nothing wrong with, counting the
   *  reader's rows it leaves out (wholly, or some of their cells). */
  const clean = (refused: (row: TabularRow) => readonly string[]) => {
    const kept: TabularRow[] = [];
    const names = new Set<string>();
    const byOrigin = new Map<number, { rows: number; dropped: number }>();
    out.forEach((row, j) => {
      const origin = originOf(row, j);
      const tally = byOrigin.get(origin) ?? { rows: 0, dropped: 0 };
      byOrigin.set(origin, tally);
      tally.rows++;
      const bad = refused(row);
      if (bad.length === 0) {
        kept.push(row);
        return;
      }
      tally.dropped++;
      for (const name of bad) names.add(readerColumn(row, name));
    });
    let count = 0;
    let partial = false;
    for (const tally of byOrigin.values()) {
      if (tally.dropped === 0) continue;
      count++;
      if (tally.dropped < tally.rows) partial = true;
    }
    const omitted: ChartsOmittedRows | null = count > 0 ? { count, total, columns: [...names], partial } : null;
    return { kept, omitted };
  };

  if (binding.series !== undefined) {
    const name = binding.series;
    if (!columns.has(name)) return null;
    const { kept, omitted } = clean((row) => {
      const v = row[name] ?? null;
      return typeof v === "number" && Number.isFinite(v) ? [] : [name];
    });
    if (kept.length === 0) return null;
    return {
      mark: seriesMark(
        id,
        type,
        kept.map((row) => row[name] as number),
      ),
      isDate: false,
      omitted,
    };
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
  const { kept, omitted } = clean((row) =>
    bound.filter((col) => !profiledCellUsable(col, row[col.name] ?? null)).map((col) => col.name),
  );
  if (kept.length === 0) return null;
  const stringify = bound.filter(
    (col) => (col.type === "category" || col.type === "text") && kept.some((row) => typeof row[col.name] !== "string"),
  );
  const dateColumn =
    binding.channels.x !== undefined && columns.get(binding.channels.x)?.type === "date"
      ? binding.channels.x
      : undefined;
  const markRows =
    stringify.length === 0 && dateColumn === undefined && !tracked
      ? kept
      : kept.map((row) => {
          const next: TabularRow = tracked ? strip(row) : { ...row };
          for (const col of stringify) next[col.name] = String(next[col.name]);
          if (dateColumn !== undefined) next[dateColumn] = normaliseDateColumn(next[dateColumn] ?? null);
          return next;
        });
  return {
    mark: buildDatasetMark(id, type, markRows, binding.channels, binding.transform),
    isDate: dateColumn !== undefined,
    omitted,
  };
}

/** What the rail says about rows a chart leaves out, in the reader's own
 *  rows and columns. */
export function chartsOmittedRowsNote(omitted: ChartsOmittedRows): string {
  const one = omitted.count === 1;
  const head = `${omitted.count} of ${omitted.total} rows ${one ? "has" : "have"} no usable ${omitted.columns.join(", ")}`;
  if (omitted.partial) return `${head}; ${one ? "that value isn't" : "those values aren't"} drawn.`;
  return `${head} and ${one ? "isn't" : "aren't"} drawn.`;
}

// ── The draw probe ──────────────────────────────────────────────────────

/** The probed mark's own colour: no palette entry, axis default or text
 *  colour is this, so a cell carrying it was painted by the mark. */
const PROBE_COLOR = "#010203";

/** The page's own default charset (web braille), small, one paint
 *  (`regionFill: "texture"`, so a region mark isn't painted twice), no
 *  legend (its swatch is in the mark's colour). A mark that paints nothing
 *  here paints nothing at any size: every blank chart the probe catches
 *  (one point per line series, an all-zero bar, heatmap, area or pie) is
 *  blank because of its data, never its grid. The cost is the painters'
 *  per-row work, so the grid is as small as a plot stays readable: an area
 *  over 180 rows paints in 4 to 8 ms here and 9 to 14 at 32x12. */
const PROBE_OPTIONS: GlyphChartRenderOptions = {
  target: "web",
  width: 20,
  height: 8,
  charset: "braille",
  color: "css",
  regionFill: "texture",
  legend: false,
};

let probeBase: ChartsWorkbenchState | undefined;

/** A cell in the probed mark's colour, as ink or as a solid cell's
 *  background (`background-color:` ends in the same text). */
function paintsProbeColor(html: string): boolean {
  return html.includes(`color:${PROBE_COLOR}`);
}

/** The one-mark state a fitting type's OWN built mark renders as — shared by
 *  the draw probe below (painted in `PROBE_COLOR`) and the type picker's own
 *  live thumbnail (`chartsMarkTypeThumbnailSpec`, painted in the mark's real
 *  style): both need the SAME built mark mounted alone, with no title/legend
 *  of its own, on a scale that matches whether its x channel is a date. */
function chartsMarkTypeProbeState(built: Pick<ChartsBuiltMark, "mark" | "isDate">): ChartsWorkbenchState {
  probeBase ??= (() => {
    const base = createChartsWorkbenchState();
    return { ...base, chart: { ...base.chart, title: "", legend: false } };
  })();
  return {
    ...probeBase,
    marks: [built.mark],
    scales: { x: built.isDate ? { type: "time", min: "", max: "" } : probeBase.scales.x, y: probeBase.scales.y },
  };
}

export type ChartsDrawVerdict = "draws" | "blank" | "refused";

/**
 * Renders the built mark through the page's own spec builder, alone and
 * in `PROBE_COLOR`, and asks whether any cell carries that colour: the
 * renderer itself decides, for every type, so no rule here restates when
 * a line, an area or a heatmap has something to draw. `refused` when the
 * library throws (a missing channel, a bad time domain, a sankey cycle).
 * Cost is one small paint: 0.4 to 8 ms over 180 rows, an area the slowest.
 * Restating the library's rules instead (two points per line series, a
 * nonzero bar) was rejected: `fill` splitting, `group`/`stack`/`bin` and the
 * heatmap's zero anchor make that a deep mirror that drifts.
 */
export function chartsBuiltMarkProbe(built: Pick<ChartsBuiltMark, "mark" | "isDate">): ChartsDrawVerdict {
  try {
    const spec = buildChartsWorkbenchSpec(chartsMarkTypeProbeState(built));
    const probe = {
      ...spec,
      marks: spec.marks.map((mark) => ({ ...mark, options: { ...mark.options, color: PROBE_COLOR } })),
    };
    return paintsProbeColor(renderGlyphChart(probe, PROBE_OPTIONS).html ?? "") ? "draws" : "blank";
  } catch {
    return "refused";
  }
}

export function chartsBuiltMarkRenders(built: Pick<ChartsBuiltMark, "mark" | "isDate">): boolean {
  return chartsBuiltMarkProbe(built) === "draws";
}

/**
 * The type picker's own live thumbnail (`ChartsMarkTypePicker.tsx`) — the
 * SAME built mark the fit table already proved draws, rendered through the
 * real library at a small size, so a tile can never promise a shape picking
 * it won't actually produce (the diagrams shape menu's own trick, applied
 * here to chart types). One text render per FITTING type only — an unfit
 * type has no built mark to draw a thumbnail of; its tile shows the reason
 * instead (`chartsMarkTypeFitTable`'s own `needs` sentence). `null` rows (no
 * table loaded yet) thumbnail nothing.
 */
export function chartsMarkTypeThumbnails(
  base: ChartsMarkTypeBase,
  table: ChartsMarkTypeFitTable,
  target: GlyphChartTarget,
): Readonly<Partial<Record<GlyphChartMarkType, string>>> {
  if (base.rows === null || base.rows.length === 0) return {};
  const out: Partial<Record<GlyphChartMarkType, string>> = {};
  for (const type of MARK_TYPES) {
    const fit = table[type];
    if (!fit.fits) continue;
    const built = chartsBuildBoundMark(0, type, base.rows, fit.binding);
    if (!built) continue;
    try {
      const spec = buildChartsWorkbenchSpec(chartsMarkTypeProbeState(built));
      out[type] = renderGlyphChart(spec, { target, width: 22, height: 6 }).text;
    } catch {
      /* the tile falls back to its own icon */
    }
  }
  return out;
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
  return {
    channels: candidate.channels,
    transform: candidate.transform?.kind ?? "none",
    ...(candidate.pipeline ? { pipeline: candidate.pipeline } : {}),
  };
}

function firstRendering(
  type: GlyphChartMarkType,
  rows: readonly TabularRow[] | readonly number[],
  attempts: Iterable<{ readonly binding: ChartsMarkBinding; readonly rank: number }>,
): ChartsMarkTypeFit {
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
      table[type] = CHARTS_MARK_TYPE_RULES[type].series
        ? firstRendering(type, rows, [{ binding: { channels: SERIES_CHANNELS, transform: "none" }, rank }])
        : unfit(type);
    });
    return table;
  }
  // Sorted best first, so the first candidate of a type that renders is its top.
  const candidates = buildChartCandidates(profileRows(rows as readonly TabularRow[]));
  for (const type of MARK_TYPES) {
    const rule = CHARTS_MARK_TYPE_RULES[type];
    if (!rule.ranked) {
      table[type] = unfit(type);
      continue;
    }
    // A vendored dataset's own curated chart is what `select-dataset`
    // draws; switching back to its type restores it rather than a
    // different ranked mapping of the same type.
    const curated = base.curated?.mark === type ? [{ binding: curatedBinding(base.curated), rank: -1 }] : [];
    // The row-order fallback is a series: it draws as every series type.
    const ranked = candidates.flatMap((candidate, rank) =>
      (candidate.rowOrder ? rule.series : candidate.mark === type) && chartsCandidateBindable(candidate)
        ? [{ binding: candidateBinding(candidate), rank }]
        : [],
    );
    table[type] = firstRendering(type, rows, [...curated, ...ranked]);
  }
  return table;
}

// Profiling, enumeration and one small probe paint per fitting type cost
// 0.7 to 9 ms warm on the vendored datasets and 8 ms on 200 rows, the most
// a remote load brings,
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
    if (!byCurated) fitByRows.set(base.rows, (byCurated = new Map()));
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
export function chartsBestFit(
  table: ChartsMarkTypeFitTable,
): { readonly type: GlyphChartMarkType; readonly binding: ChartsMarkBinding } | null {
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
export function remoteDatasetRecommendationCheck(
  rows: readonly TabularRow[],
): { readonly ok: true } | { readonly ok: false; readonly columns: readonly string[] } {
  if (chartsBestFit(chartsMarkTypeFitTable({ rows }))) return { ok: true };
  return { ok: false, columns: profileRows(rows).columns.map((c) => `${c.name} (${c.type})`) };
}

// ── The current mark ────────────────────────────────────────────────────

const columnsMemo = new WeakMap<object, ReadonlySet<string>>();

function columnsOf(rows: readonly TabularRow[]): ReadonlySet<string> {
  let columns = columnsMemo.get(rows);
  if (!columns) columnsMemo.set(rows, (columns = new Set(rows.flatMap((row) => Object.keys(row)))));
  return columns;
}

const reshapedColumnsMemo = new WeakMap<object, WeakMap<object, ReadonlySet<string> | null>>();

function reshapedColumnsOf(rows: readonly TabularRow[], pipeline: readonly PipelineStep[]): ReadonlySet<string> | null {
  let byPipeline = reshapedColumnsMemo.get(rows);
  if (!byPipeline) reshapedColumnsMemo.set(rows, (byPipeline = new WeakMap()));
  if (!byPipeline.has(pipeline)) {
    const reshaped = runPipeline(rows, pipeline);
    byPipeline.set(pipeline, reshaped.ok ? columnsOf(reshaped.rows) : null);
  }
  return byPipeline.get(pipeline)!;
}

/**
 * The column TYPE behind each of the current mark's own fields
 * (`chartMarkFields`, `chartsWorkbenchState.ts`) — the rail's own channel
 * rows annotate a field option with this (`ChartsMarkCard.tsx`), so a reader
 * sees what kind of column they are binding, not just its name. Profiled off
 * the mark's OWN data (`mark.dataText` — post-reshape, whatever the chart
 * currently draws), the same rows `chartMarkFields` itself reads. Empty for
 * a bare number series (there are no named columns to type) or data that
 * doesn't parse as tabular rows (an in-progress edit).
 */
export function chartsMarkFieldTypes(
  mark: Pick<ChartsWorkbenchMark, "dataText">,
): ReadonlyMap<string, ColumnProfile["type"]> {
  try {
    const data: unknown = JSON.parse(mark.dataText);
    if (
      !Array.isArray(data) ||
      data.length === 0 ||
      data.some((row) => typeof row !== "object" || row === null || Array.isArray(row))
    )
      return new Map();
    return new Map(profileRows(data as TabularRow[]).columns.map((c) => [c.name, c.type]));
  } catch {
    return new Map();
  }
}

/**
 * The binding the mark CURRENTLY describes over the reader's own table:
 * its own channels and transform, plus the melt its channels are named
 * after, if any. A channel edit therefore re-derives the chart from the
 * table as loaded, never from rows an earlier binding already cleaned.
 * `null` when there is no such table (a tray sample, a legacy link's own
 * rows) or the channels name columns of neither the table nor a reshape
 * the fit table offers.
 */
function chartsMarkCurrentBinding(
  data: ChartsWorkbenchDataState,
  mark: ChartsWorkbenchMark,
): { readonly rows: readonly TabularRow[]; readonly binding: ChartsMarkBinding } | null {
  const base = chartsMarkTypeBase(data, mark);
  if (base.key !== undefined || base.rows === null || base.rows.some((row) => typeof row === "number")) return null;
  const rows = base.rows as readonly TabularRow[];
  const keys = chartRelevantChannels(mark.type) as readonly ChannelKey[];
  const channels: ChartsRecommendedChannels = Object.fromEntries(
    keys.map((key) => [key, mark.channels[key] || undefined]),
  );
  const names = keys.flatMap((key) => (channels[key] ? [channels[key]!] : []));
  const binding: ChartsMarkBinding = { channels, transform: mark.transform };
  if (names.every((name) => columnsOf(rows).has(name))) return { rows, binding };
  const table = chartsMarkTypeFitTable(base);
  for (const type of [mark.type, ...MARK_TYPES]) {
    const fit = table[type];
    if (!fit.fits) continue;
    if (fit.binding.series !== undefined) {
      if (keys.every((key) => (fit.binding.channels[key] || undefined) === channels[key]))
        return { rows, binding: { ...fit.binding, transform: mark.transform } };
      continue;
    }
    const pipeline = fit.binding.pipeline;
    if (pipeline && names.every((name) => reshapedColumnsOf(rows, pipeline)?.has(name)))
      return { rows, binding: { ...binding, pipeline } };
  }
  return null;
}

/** The mark its current channels describe, rebuilt from the reader's own
 *  table through the one build path (`update-mark`'s channel edits). */
export function chartsRebindMark(data: ChartsWorkbenchDataState, mark: ChartsWorkbenchMark): ChartsBuiltMark | null {
  const current = chartsMarkCurrentBinding(data, mark);
  return current && chartsBuildBoundMark(mark.id, mark.type, current.rows, current.binding);
}

/** Type changes prefer the reader's columns; automatic mapping is only a
 * fallback when those columns cannot draw the requested shape. The picker
 * and reducer share this table so previews match the chart they install. */
export function chartsMarkTypeFitsForMark(
  data: ChartsWorkbenchDataState,
  mark: ChartsWorkbenchMark,
): ChartsMarkTypeFitTable {
  const base = chartsMarkTypeBase(data, mark);
  const table = chartsMarkTypeFitTable(base);
  if (base.rows === null) return table;
  const current = chartsMarkCurrentBinding(data, mark);
  const binding = current?.binding ?? { channels: mark.channels, transform: mark.transform };
  const rows = current?.rows ?? base.rows;
  const preferred = { ...table };
  for (const type of MARK_TYPES) {
    const fit = table[type];
    if (!fit.fits) continue;
    const built = chartsBuildBoundMark(mark.id, type, rows, binding);
    if (built && chartsBuiltMarkRenders(built)) {
      preferred[type] = { fits: true, binding, rank: fit.rank, omitted: built.omitted };
    }
  }
  return preferred;
}

const omittedMemo = new WeakMap<
  ChartsWorkbenchMark,
  { readonly data: ChartsWorkbenchDataState; readonly omitted: ChartsOmittedRows | null }
>();

/** Rows of the reader's table the CURRENT chart leaves out, for its current
 *  channels. Reported only while the mark's data is exactly what its
 *  binding builds: a hand-built link's own data says nothing about the
 *  table. */
export function chartsMarkOmittedRows(
  data: ChartsWorkbenchDataState,
  mark: ChartsWorkbenchMark,
): ChartsOmittedRows | null {
  const hit = omittedMemo.get(mark);
  if (hit && hit.data === data) return hit.omitted;
  const rebuilt = chartsRebindMark(data, mark);
  const omitted = rebuilt && rebuilt.mark.dataText === mark.dataText ? rebuilt.omitted : null;
  omittedMemo.set(mark, { data, omitted });
  return omitted;
}

const drawMemo = new WeakMap<ChartsWorkbenchMark, Map<boolean, ChartsDrawVerdict>>();

/**
 * Why the chart shows nothing, when a data mark on it paints no cell (a
 * channel edit or a hand-built link left it one point per line series, or
 * all zeros). `renderChartsWorkbenchState` reports it as an error, so the
 * viewport keeps the last good chart dimmed with this in the rail, and the
 * Type toggle still offers every type that draws. `null` when every data
 * mark draws, and for a mark the library refuses outright: the render
 * reports that error itself.
 */
export function chartsWorkbenchNothingDrawn(state: Pick<ChartsWorkbenchState, "marks" | "scales">): string | null {
  const isDate = state.scales.x.type === "time";
  for (const mark of state.marks) {
    const rule = CHARTS_MARK_TYPE_RULES[mark.type];
    if (!rule.ranked) continue;
    let byScale = drawMemo.get(mark);
    if (!byScale) drawMemo.set(mark, (byScale = new Map()));
    let verdict = byScale.get(isDate);
    if (verdict === undefined) byScale.set(isDate, (verdict = chartsBuiltMarkProbe({ mark, isDate })));
    if (verdict === "blank") return `Nothing to draw. ${rule.needs}`;
  }
  return null;
}
