// Pure glue between the vendored/custom data sources (`datasets/`,
// `../../lib/tabularParse.ts`), the transform pipeline
// (`../../lib/dataPipeline.ts`), the profiler/recommender
// (`../../lib/dataProfile.ts`), the information-ranked candidate
// enumeration (`../../lib/chartCandidates.ts`), and `chartsWorkbenchState.ts`'s
// mark shape. No DOM — `ChartsDock.tsx` is the thin component that reads a
// file/textarea and calls into this. See AGENTS.md's "Charts" ("Data layer").
import { runPipeline, type PipelineStep } from "../../lib/dataPipeline";
import { profileRows, recommendChart, type ChartRecommendation, type DataProfile } from "../../lib/dataProfile";
import { parseTabular, type TabularRow } from "../../lib/tabularParse";
import { findChartsDataset, type ChartsDataset } from "./datasets";
import type { ChartsWorkbenchMark } from "./chartsWorkbenchState";

export type ChartsDataSource =
  | { readonly kind: "dataset"; readonly id: string }
  | {
      readonly kind: "custom"; readonly raw: string; readonly filename?: string; readonly mimeType?: string;
      /** Set only when a `?c=` link was encoded with this source's `raw`
       *  over `CHARTS_URL_SIZE_WARN_BYTES` (`chartsUrlState.ts`, P2-5): the
       *  envelope carries the FILENAME but drops the payload itself rather
       *  than writing a query string a plain static host's request-line
       *  limit would 414 on reload. `raw` is `""` whenever this is `true`. */
      readonly omitted?: true;
    }
  | {
      /** A dataset resolved off the network (`lib/datasetSearch.ts` +
       *  `lib/datasetLoad.ts`) rather than one of the 8 vendored
       *  `datasets/` entries — a Hugging Face Hub search hit or a pasted
       *  raw-file URL. `ref` is what `select-remote-dataset` (and a `?c=`
       *  decode's re-fetch) resolves AGAIN on demand: a Hugging Face
       *  dataset id (`"org/name"`) or the exact URL that was searched/
       *  pasted — never the rows themselves, which this source never
       *  carries (see `chartsUrlState.ts`'s "URL state" doc). `title`/
       *  `description`/`source` are a snapshot of what was shown when the
       *  dataset was chosen, carried here (rather than re-derived) because,
       *  unlike a vendored `ChartsDataset`, there is no local object to
       *  read them back off between loads. */
      readonly kind: "remote"; readonly ref: string; readonly title: string; readonly description: string;
      readonly source: { readonly name: string; readonly url: string; readonly licence?: string };
    };

export type ChartsDataResolution =
  | { readonly ok: true; readonly rows: readonly TabularRow[]; readonly dataset?: ChartsDataset }
  | { readonly ok: false; readonly error: string };

/** Cap on a pasted/uploaded custom payload (P2-5) — `ChartsDataFolder.tsx`
 *  refuses a paste/file over this with an inline message before it ever
 *  reaches `dispatch`, so an accidentally-huge file never becomes the
 *  reducer's `dataText`/URL-envelope problem in the first place. 256 KB is
 *  generous for the CSV/TSV/JSON shapes this feature targets (every
 *  vendored dataset is under 200 rows) while still ruling out "pasted a
 *  multi-megabyte export by mistake". */
export const CHARTS_CUSTOM_MAX_BYTES = 256 * 1024;

/** Raw input (a dataset's own rows, or a freshly parsed custom paste/file) → pipeline output. */
export function resolveChartsDataRows(source: ChartsDataSource, pipeline: readonly PipelineStep[]): ChartsDataResolution {
  if (source.kind === "dataset") {
    const dataset = findChartsDataset(source.id);
    if (!dataset) return { ok: false, error: `Unknown dataset "${source.id}".` };
    const result = runPipeline(dataset.rows, pipeline);
    return result.ok ? { ok: true, rows: result.rows, dataset } : { ok: false, error: `Step ${result.stepIndex + 1}: ${result.error}` };
  }
  if (source.kind === "remote") {
    // Unlike a vendored dataset or a pasted "Custom…" paste, a remote
    // source's rows live off-network and this function is SYNCHRONOUS —
    // `select-remote-dataset` (`chartsWorkbenchState.ts`) is the one path
    // that resolves one, and it's handed already-loaded rows directly
    // (`lib/datasetLoad.ts`), never through here.
    return { ok: false, error: "A remote dataset resolves asynchronously — see lib/datasetLoad.ts." };
  }
  if (source.omitted) return { ok: false, error: "Custom data isn't in this link — paste or upload it again." };
  const parsed = parseTabular(source.raw, { filename: source.filename, mimeType: source.mimeType });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const input = parsed.kind === "rows" ? parsed.rows : parsed.value;
  const result = runPipeline(input, pipeline);
  return result.ok ? { ok: true, rows: result.rows } : { ok: false, error: `Step ${result.stepIndex + 1}: ${result.error}` };
}

export interface ChartsDataProfileResult {
  readonly profile: DataProfile;
  readonly recommendations: readonly ChartRecommendation[];
}
export function profileChartsData(rows: readonly TabularRow[]): ChartsDataProfileResult {
  const profile = profileRows(rows);
  return { profile, recommendations: recommendChart(profile) };
}

/** `recommended.mark` (dataset or profiler) is `GlyphChartMarkType`-shaped
 *  already; only `rect`/`text`/`rule` never come out of a recommendation,
 *  so this covers exactly what `recommendChart`/a dataset's own field emit.
 *  `source`/`target`/`value`/`stage` are `sankey`/`funnel`'s own channel
 *  vocabulary (`datasets/types.ts`'s `ChartsDatasetRecommendation`) — the
 *  profiler itself never emits them (it has no sankey/funnel rule), so a
 *  profiler-derived recommendation always leaves these `undefined`. */
export type ChartsRecommendedChannels = {
  readonly x?: string; readonly y?: string; readonly fill?: string; readonly label?: string;
  readonly source?: string; readonly target?: string; readonly value?: string; readonly stage?: string;
};

export interface ChartsTopRecommendation {
  readonly mark: ChartsWorkbenchMark["type"];
  readonly channels: ChartsRecommendedChannels;
  readonly reason: string;
  /** A reshape (currently only `pivotLonger`) that must run on top of the
   *  already-resolved rows BEFORE building the mark, because `channels`
   *  names a column the reshape itself produces (`recommendChart`'s own
   *  multi-numeric rule, N4) rather than one the source data already has. */
  readonly pipeline?: readonly PipelineStep[];
  /** N1: set when a STOCK dataset's curated mapping named a column the
   *  pipeline's OUTPUT no longer has — the profiler's own top pick was
   *  substituted instead (never an empty chart with no explanation), and
   *  this is the reader-facing note explaining why the readout no longer
   *  matches the dataset's usual chart. */
  readonly fallbackNotice?: string;
  /** A dataset's own curated `recommended.transform` (e.g. `"stack"` for a
   *  genuinely stacked bar/area) — forwarded only for a curated mapping;
   *  the profiler's own ranked recommendations carry no transform opinion. */
  readonly transform?: ChartsWorkbenchMark["transform"];
}

/** True when every channel a curated mapping names actually resolves
 *  against the profiled OUTPUT columns (N1) — a column-changing pipeline
 *  step (`select`/`flatten`/`pivotLonger`/`pivotWider`) can rename or drop
 *  the very columns a dataset's `recommended` field hard-codes, and
 *  applying it anyway used to render an empty chart with an empty ledger
 *  and no error at all. */
function curatedChannelsResolve(channels: ChartsRecommendedChannels, profile: DataProfile): boolean {
  const names = new Set(profile.columns.map((c) => c.name));
  return [channels.x, channels.y, channels.fill, channels.label, channels.source, channels.target, channels.value, channels.stage]
    .every((name) => name === undefined || names.has(name));
}

/** P2-4: `ChartRecommendation.transform` (a `dataProfile.ts` "group by X"
 *  recommendation) is forwarded onto `ChartsTopRecommendation.transform`
 *  ONLY for `reduce: "sum"` — `ChartsWorkbenchMark.transform` is a bare
 *  `"none" | GlyphChartTransformKind` with nowhere to carry `reduce`
 *  (`chartsWorkbenchState.ts`'s own field doc), so applying a `"mean"`
 *  recommendation through it would silently SUM instead, which is a
 *  materially wrong chart rather than a merely un-aggregated one. `"sum"`
 *  is safe because `GlyphChartTransform`'s own `group` already defaults to
 *  `"sum"` when no `reduce` is given (`packages/charts/src/transforms.ts`),
 *  so the two agree by construction. */
function forwardableTransformKind(transform: ChartRecommendation["transform"]): ChartsWorkbenchMark["transform"] | undefined {
  return transform && transform.reduce === "sum" ? transform.kind : undefined;
}

/** A `mean` group can't be forwarded (above), and building its channels
 *  with no transform draws every duplicate-key row on top of the others —
 *  so the one-click pick is the best recommendation the page can actually
 *  bind, the same rule the mark-type toggle's fit uses
 *  (`chartsMarkTypeFit.ts`'s `chartsCandidateBindable`). */
function bindableRecommendation(rec: ChartRecommendation): boolean {
  return rec.transform === undefined || rec.transform.reduce === "sum";
}

function describeRecommendation(mark: string, channels: ChartsRecommendedChannels): string {
  const parts: string[] = [];
  if (channels.y) parts.push(channels.y);
  if (channels.x) parts.push(`by ${channels.x}`);
  return parts.length > 0 ? `${mark} of ${parts.join(" ")}` : mark;
}

/** What the Data folder's Apply button (and its own "Recommended: …"
 *  readout) actually offers as the ONE-CLICK choice (F1/P1-1).
 *
 *  A STOCK dataset's own curated `recommended` mapping always wins over the
 *  general profiler's ranking — `datasets/types.ts` documents it as exactly
 *  this ("what the Data folder's … flow applies with one click"), and it
 *  used to go completely unread at runtime: Apply called
 *  `profiled.recommendations[0]` unconditionally, so two of eight vendored
 *  datasets (`world-population-by-country`, `iris-flowers`) rendered a
 *  materially wrong chart — a plain unfilled line where the curated mapping
 *  fills by country, and a pie of summed sepal lengths where the curated
 *  mapping is a species-coloured scatter — while the CORRECT mapping sat
 *  unread in the same dataset object. A custom source has no curated
 *  mapping at all, so it still falls back to whatever `recommendChart`
 *  ranked first (which is why `dataProfile.ts` also gained two rules of its
 *  own, so that fallback is a better answer for the same shapes).
 *
 *  N1: the curated mapping is trusted only when its channels actually
 *  resolve against `profile` (the ALREADY-pipelined columns) — a pipeline
 *  step that renames/drops a column the curated field names falls back to
 *  the profiler's own top pick instead, carrying a `fallbackNotice`
 *  explaining why the readout changed, rather than silently rendering
 *  nothing. */
export function topChartsRecommendation(dataset: ChartsDataset | undefined, profile: DataProfile, recommendations: readonly ChartRecommendation[]): ChartsTopRecommendation | null {
  if (dataset) {
    const { mark, x, y, fill, label, source, target, value, stage, transform } = dataset.recommended;
    const channels = { x, y, fill, label, source, target, value, stage };
    if (curatedChannelsResolve(channels, profile)) {
      return { mark, channels, transform, reason: `Curated recommendation for ${dataset.title}.` };
    }
    const top = recommendations.find(bindableRecommendation);
    if (!top) return null;
    return {
      mark: top.mark, channels: top.channels, reason: top.reason, pipeline: top.pipeline, transform: forwardableTransformKind(top.transform),
      fallbackNotice: `Pipeline changed the columns; using recommended ${describeRecommendation(top.mark, top.channels)}.`,
    };
  }
  const top = recommendations.find(bindableRecommendation);
  return top ? { mark: top.mark, channels: top.channels, reason: top.reason, pipeline: top.pipeline, transform: forwardableTransformKind(top.transform) } : null;
}

/**
 * P2-3 (REVIEW-arc-density-search-opus.md): a remote dataset can LOAD fine
 * and still have no usable recommendation at all — every column reads as
 * `category`/`boolean` (a real shape: `mstz/mushroom`'s own columns are
 * `cap_shape, cap_surface, …, odor`, every one a string), so
 * `topChartsRecommendation`'s channel-less answer, applied through
 * `buildRecommendedMarkUpdate`'s A1 guard, is a correct silent no-op at
 * the REDUCER layer — but "silent" there used to also mean "silent to the
 * reader": `select-remote-dataset` still recorded the dataset as loaded
 * and Recent while the chart, card, credit and title kept describing
 * whatever was on screen before, with nothing telling the reader why.
 * Checked BEFORE dispatch (not by inspecting `select-remote-dataset`'s own
 * no-op, which a reducer can't report back through `dispatch`) so the
 * caller can skip BOTH the dispatch and `pushRecentRemoteDataset` — a
 * dataset that can't be charted has no business in the "recently loaded"
 * list either.
 */
export function remoteDatasetRecommendationCheck(rows: readonly TabularRow[]): { readonly ok: true } | { readonly ok: false; readonly columns: readonly string[] } {
  const profiled = profileChartsData(rows);
  const top = topChartsRecommendation(undefined, profiled.profile, profiled.recommendations);
  const usable = top !== null && Object.values(top.channels).some((value) => value !== undefined);
  if (usable) return { ok: true };
  return { ok: false, columns: profiled.profile.columns.map((c) => `${c.name} (${c.type})`) };
}

/** Builds ONE editable mark (this package's own shape, `dataText` included)
 *  from resolved rows + a chosen mark type/channel mapping — what "Apply"
 *  in the Data folder commits into `state.marks` (replacing them, exactly
 *  like `apply-preset` already does), and what feeds `chartsDateAxis`'s own
 *  scale-type decision below. `rows` is expected to already have any
 *  recommendation-carried `pipeline` (N4) applied. `transform`
 *  (`ChartsTopRecommendation.transform`, e.g. `"stack"`) defaults to
 *  `"none"`, matching every call site that predates the field. */
export function buildDatasetMark(id: number, mark: ChartsWorkbenchMark["type"], rows: readonly TabularRow[], channels: ChartsRecommendedChannels, transform: ChartsWorkbenchMark["transform"] = "none"): ChartsWorkbenchMark {
  return {
    id, type: mark, dataText: JSON.stringify(rows, null, 2),
    channels: {
      x: channels.x, y: channels.y, fill: channels.fill, label: channels.label,
      source: channels.source, target: channels.target, value: channels.value, stage: channels.stage,
    },
    transform, options: {},
  };
}

/** Whether the x channel resolves to a `date`-profiled column — the ONE
 *  signal that decides whether the x scale needs an EXPLICIT `{ type:
 *  "time" }` (see chartsDatasetDateAxis.test.ts's header comment: a date
 *  column is a plain JSON string, and Plot's own channel-type inference
 *  reads a bare string as `band`, never `time`, so nothing downstream ever
 *  discovers this on its own). `undefined` x (no x channel at all, e.g. a
 *  bare numeric array) is never a date. */
export function xChannelIsDate(profile: DataProfile, x: string | undefined): boolean {
  if (!x) return false;
  return profile.columns.find((c) => c.name === x)?.type === "date";
}
