// Pure glue between the vendored/custom data sources (`datasets/`,
// `../../lib/tabularParse.ts`), the transform pipeline
// (`../../lib/dataPipeline.ts`), the profiler/recommender
// (`../../lib/dataProfile.ts`), and `chartsWorkbenchState.ts`'s mark shape.
// No DOM — `ChartsDock.tsx` is the thin component that reads a file/textarea
// and calls into this. See AGENTS.md's "Charts" ("Data layer").
import { runPipeline, type PipelineStep } from "../../lib/dataPipeline";
import { profileRows, recommendChart, type ChartRecommendation, type DataProfile } from "../../lib/dataProfile";
import { parseTabular, type TabularRow } from "../../lib/tabularParse";
import { findChartsDataset, type ChartsDataset } from "./datasets";
import type { ChartsWorkbenchMark } from "./chartsWorkbenchState";

export type ChartsDataSource =
  | { readonly kind: "dataset"; readonly id: string }
  | { readonly kind: "custom"; readonly raw: string; readonly filename?: string; readonly mimeType?: string };

export type ChartsDataResolution =
  | { readonly ok: true; readonly rows: readonly TabularRow[]; readonly dataset?: ChartsDataset }
  | { readonly ok: false; readonly error: string };

/** Raw input (a dataset's own rows, or a freshly parsed custom paste/file) → pipeline output. */
export function resolveChartsDataRows(source: ChartsDataSource, pipeline: readonly PipelineStep[]): ChartsDataResolution {
  if (source.kind === "dataset") {
    const dataset = findChartsDataset(source.id);
    if (!dataset) return { ok: false, error: `Unknown dataset "${source.id}".` };
    const result = runPipeline(dataset.rows, pipeline);
    return result.ok ? { ok: true, rows: result.rows, dataset } : { ok: false, error: `Step ${result.stepIndex + 1}: ${result.error}` };
  }
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
 *  so this covers exactly what `recommendChart`/a dataset's own field emit. */
export type ChartsRecommendedChannels = { readonly x?: string; readonly y?: string; readonly fill?: string; readonly label?: string };

/** Builds ONE editable mark (this package's own shape, `dataText` included)
 *  from resolved rows + a chosen mark type/channel mapping — what "Apply"
 *  in the Data folder commits into `state.marks` (replacing them, exactly
 *  like `apply-preset` already does), and what feeds `chartsDateAxis`'s own
 *  scale-type decision below. */
export function buildDatasetMark(id: number, mark: ChartsWorkbenchMark["type"], rows: readonly TabularRow[], channels: ChartsRecommendedChannels): ChartsWorkbenchMark {
  return {
    id, type: mark, dataText: JSON.stringify(rows, null, 2),
    channels: { x: channels.x, y: channels.y, fill: channels.fill, label: channels.label },
    transform: "none", options: {},
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
