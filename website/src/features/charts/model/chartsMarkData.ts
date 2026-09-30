import { type ChartsDatasetRecommendation, findChartsDataset } from "../data/index";
import type { TabularRow } from "../tabular/tabularParse";
import { type ChartsWorkbenchDataState, type ChartsWorkbenchMark } from "./chartsSpec";

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
      else if (parsed.every((row) => typeof row === "object" && row !== null && !Array.isArray(row)))
        rows = parsed as TabularRow[];
    }
  } catch {
    /* an in-progress edit fits nothing until it parses */
  }
  return { key: `mark:${mark.dataText}`, rows };
}
