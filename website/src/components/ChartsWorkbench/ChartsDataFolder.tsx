import { useMemo, useState, type Dispatch } from "react";
import { createPortal } from "react-dom";
import {
  CHARTS_DATASETS, findChartsDataset, parseChartMarkData,
  type ChartsDataset, type ChartsWorkbenchAction, type ChartsWorkbenchDataState, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";

// Custom paste/upload (a "Custom…" dataset option, a pipeline step editor,
// and a profiler-ranked recommendation + Apply button) lived here before
// `/charts` became a dataset SHOWCASE rather than a builder — see
// AGENTS.md's "## Charts" ("Data layer") for the current, dataset-driven
// contract. The pure `lib/tabularParse`/`dataPipeline`/`dataProfile`
// modules that fed it stay, fully tested; the page's own editable-table
// reducer surface (`set-cell`/`add-row`/…) was removed as DEAD CODE
// (P3-4, REVIEW-showcase-opus.md) rather than kept on a "coming back"
// comment with no real consumer — a future custom-upload feature would
// build its own editor fresh against those same pure libraries.

const DATASET_DATA_VIEWS = [{ id: "table", label: "Table" }, { id: "json", label: "JSON" }] as const;

/** A generic read-only table/JSON pair over plain rows — shared by the
 *  vendored-dataset view (`ChartsDatasetDataView`, below) and the remote
 *  one (`ChartsRemoteDatasetDataView`), which has no static `ChartsDataset`
 *  object to read rows/columns off and instead parses them from the
 *  chart's own current mark. */
function ChartsDataTable({ title, columns, rows }: { readonly title: string; readonly columns: readonly string[]; readonly rows: readonly Readonly<Record<string, unknown>>[] }) {
  const [view, setView] = useState<typeof DATASET_DATA_VIEWS[number]["id"]>("table");
  const gridStyle = { gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(6ch, 1fr))` };
  return <details className="charts-mark-data-details">
    <summary className="charts-mark-data-summary">View data <span className="charts-mark-data-marker" aria-hidden="true">▸</span></summary>
    <div className="gx-toggle charts-data-tabs" role="tablist" aria-label={`${title} data view`}>
      {DATASET_DATA_VIEWS.map((v) => <button type="button" key={v.id} role="tab" aria-selected={view === v.id}
        className={`gx-toggle-btn gx-toggle-text${view === v.id ? " is-active" : ""}`} onClick={() => setView(v.id)}>{v.label}</button>)}
    </div>
    {view === "table"
      ? <div className="charts-grid-wrap">
          <div className="charts-grid charts-grid--readonly" role="table" aria-label={`${title} data`} style={gridStyle}>
            <div className="charts-grid-row" role="row" style={{ display: "contents" }}>
              {columns.map((column) => <div className="charts-grid-header" role="columnheader" key={column}>{column}</div>)}
            </div>
            {rows.map((row, r) => <div className="charts-grid-row" role="row" style={{ display: "contents" }} key={r}>
              {columns.map((column) => <div className={`charts-grid-cell${typeof row[column] === "number" ? " is-numeric" : ""}`} role="cell" key={column}>{String(row[column] ?? "")}</div>)}
            </div>)}
          </div>
        </div>
      : <textarea className="charts-mark-data" aria-label={`${title} data JSON`} value={JSON.stringify(rows, null, 2)} readOnly spellCheck={false} />}
  </details>;
}

/** Read-only table/JSON views of a STOCK dataset's own rows — the "View
 *  data ▸" disclosure on the dataset card (AGENTS.md's "Charts" — "Data
 *  layer"). Unlike the old per-mark table editor this replaced, nothing
 *  here is editable: a showcase reader looks at the real data behind the
 *  chart, they don't reshape it. Closed by default (`<details>`, no state,
 *  nothing persisted to the URL), same idiom as the mark card's own "View
 *  data" disclosure used before this feature. */
function ChartsDatasetDataView({ dataset }: { readonly dataset: ChartsDataset }) {
  return <ChartsDataTable title={dataset.title} columns={dataset.columns} rows={dataset.rows} />;
}

/** The same read-only disclosure for a REMOTE dataset (glyphcss
 *  dataset-search feature) — there is no static `ChartsDataset` object to
 *  read rows/columns off, so this parses them straight from the chart's
 *  own current mark (`select-remote-dataset` builds that mark's `dataText`
 *  directly from the loaded rows, so the two are always the same data). */
function ChartsRemoteDatasetDataView({ title, marks }: { readonly title: string; readonly marks: readonly ChartsWorkbenchMark[] }) {
  const { columns, rows } = useMemo(() => {
    const mark = marks[0];
    if (!mark) return { columns: [], rows: [] };
    try {
      const data = parseChartMarkData(mark);
      if (data.every((row) => typeof row === "number")) return { columns: ["value"], rows: data.map((value) => ({ value })) };
      const objectRows = data.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
      return { columns: [...new Set(objectRows.flatMap((row) => Object.keys(row)))], rows: objectRows };
    } catch { return { columns: [], rows: [] }; }
  }, [marks]);
  if (rows.length === 0) return null;
  return <ChartsDataTable title={title} columns={columns} rows={rows} />;
}

/**
 * The dataset card in the left rail (AGENTS.md's "Charts" — "Data layer"):
 * a showcase, not a builder — picking a dataset from the `<select>` (or
 * the header's own SEARCH box, `ChartsDatasetSearchBox`) IMMEDIATELY
 * replaces the chart with a curated/recommended mapping
 * (`select-dataset`/`select-remote-dataset`, `chartsWorkbenchState.ts`),
 * no intermediate "Apply" step. The card itself shows the dataset's
 * title, description, source credit, and a closed "View data ▸"
 * disclosure over its own rows — for a `"remote"` source, `loading`
 * shows an inline "Loading…" state instead while a search result's rows
 * are still in flight (`ChartsWorkbench.tsx`'s own `loadRemoteDataset`).
 *
 * The `<select>` renders into `selectSlot` — the rail header's own `action`
 * slot (`ChartsWorkbench.tsx`, beside the "Random" button) — via a plain
 * `createPortal`; `selectSlot` omitted/`null` (this file's own direct-mount
 * tests) renders it inline instead.
 */
export function ChartsDataFolder({ data, dispatch, selectSlot, marks, loading }: {
  readonly data: ChartsWorkbenchDataState; readonly dispatch: Dispatch<ChartsWorkbenchAction>; readonly selectSlot?: HTMLElement | null;
  readonly marks?: readonly ChartsWorkbenchMark[]; readonly loading?: boolean;
}) {
  const activeDataset = data.source?.kind === "dataset" ? findChartsDataset(data.source.id) : undefined;
  const remote = data.source?.kind === "remote" ? data.source : undefined;

  const selectField = (
    <span className="gx-select charts-dataset-select">
      <select aria-label="Dataset" value={activeDataset?.id ?? ""} onChange={(e) => dispatch({ type: "select-dataset", id: e.target.value })}>
        {!activeDataset && <option value="" disabled>— pick a dataset —</option>}
        {CHARTS_DATASETS.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
      </select>
    </span>
  );

  return <div className="charts-data-folder">
    {selectSlot
      ? createPortal(selectField, selectSlot)
      : <label className="voice-row charts-mark-row"><span>Dataset</span>{selectField}</label>}

    {loading && <p className="charts-readout charts-data-loading" role="status">Loading…</p>}

    {activeDataset && <div className="charts-data-info">
      <p className="charts-data-title">{activeDataset.title}</p>
      <p className="charts-readout">{activeDataset.description}</p>
      <p className="charts-readout"><a href={activeDataset.source.url} target="_blank" rel="noreferrer">{activeDataset.source.name}</a> — {activeDataset.source.licence}</p>
      <ChartsDatasetDataView dataset={activeDataset} />
    </div>}

    {remote && !loading && <div className="charts-data-info">
      <p className="charts-data-title">{remote.title}</p>
      <p className="charts-readout">{remote.description}</p>
      <p className="charts-readout"><a href={remote.source.url} target="_blank" rel="noreferrer">{remote.source.name}</a>{remote.source.licence ? ` — ${remote.source.licence}` : ""}</p>
      <ChartsRemoteDatasetDataView title={remote.title} marks={marks ?? []} />
    </div>}
  </div>;
}
