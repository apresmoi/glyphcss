import { useState, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { CHARTS_DATASETS, findChartsDataset, type ChartsDataset, type ChartsWorkbenchAction, type ChartsWorkbenchDataState } from "./chartsWorkbenchState";

// Custom paste/upload (a "Custom…" dataset option, a pipeline step editor,
// and a profiler-ranked recommendation + Apply button) lived here before
// `/charts` became a dataset SHOWCASE rather than a builder — see
// AGENTS.md's "## Charts" ("Data layer") for the current, dataset-driven
// contract. Custom data: coming back.

const DATASET_DATA_VIEWS = [{ id: "table", label: "Table" }, { id: "json", label: "JSON" }] as const;

/** Read-only table/JSON views of a STOCK dataset's own rows — the "View
 *  data ▸" disclosure on the dataset card (AGENTS.md's "Charts" — "Data
 *  layer"). Unlike the old per-mark table editor this replaced, nothing
 *  here is editable: a showcase reader looks at the real data behind the
 *  chart, they don't reshape it. Closed by default (`<details>`, no state,
 *  nothing persisted to the URL), same idiom as the mark card's own "View
 *  data" disclosure used before this feature. */
function ChartsDatasetDataView({ dataset }: { readonly dataset: ChartsDataset }) {
  const [view, setView] = useState<typeof DATASET_DATA_VIEWS[number]["id"]>("table");
  const gridStyle = { gridTemplateColumns: `repeat(${Math.max(1, dataset.columns.length)}, minmax(6ch, 1fr))` };
  return <details className="charts-mark-data-details">
    <summary className="charts-mark-data-summary">View data <span className="charts-mark-data-marker" aria-hidden="true">▸</span></summary>
    <div className="gx-toggle charts-data-tabs" role="tablist" aria-label={`${dataset.title} data view`}>
      {DATASET_DATA_VIEWS.map((v) => <button type="button" key={v.id} role="tab" aria-selected={view === v.id}
        className={`gx-toggle-btn gx-toggle-text${view === v.id ? " is-active" : ""}`} onClick={() => setView(v.id)}>{v.label}</button>)}
    </div>
    {view === "table"
      ? <div className="charts-grid-wrap">
          <div className="charts-grid charts-grid--readonly" role="table" aria-label={`${dataset.title} data`} style={gridStyle}>
            <div className="charts-grid-row" role="row" style={{ display: "contents" }}>
              {dataset.columns.map((column) => <div className="charts-grid-header" role="columnheader" key={column}>{column}</div>)}
            </div>
            {dataset.rows.map((row, r) => <div className="charts-grid-row" role="row" style={{ display: "contents" }} key={r}>
              {dataset.columns.map((column) => <div className={`charts-grid-cell${typeof row[column] === "number" ? " is-numeric" : ""}`} role="cell" key={column}>{String(row[column] ?? "")}</div>)}
            </div>)}
          </div>
        </div>
      : <textarea className="charts-mark-data" aria-label={`${dataset.title} data JSON`} value={JSON.stringify(dataset.rows, null, 2)} readOnly spellCheck={false} />}
  </details>;
}

/**
 * The dataset card in the left rail (AGENTS.md's "Charts" — "Data layer"):
 * a showcase, not a builder — picking a dataset from the `<select>`
 * IMMEDIATELY replaces the chart with that dataset's own curated
 * recommendation (`select-dataset`, `chartsWorkbenchState.ts`), no
 * intermediate "Apply" step. The card itself shows the dataset's title,
 * description, source credit, and a closed "View data ▸" disclosure over
 * its own rows.
 *
 * The `<select>` renders into `selectSlot` — the rail header's own `action`
 * slot (`ChartsWorkbench.tsx`, beside the "⚄ Random" button) — via a plain
 * `createPortal`; `selectSlot` omitted/`null` (this file's own direct-mount
 * tests) renders it inline instead.
 */
export function ChartsDataFolder({ data, dispatch, selectSlot }: { readonly data: ChartsWorkbenchDataState; readonly dispatch: Dispatch<ChartsWorkbenchAction>; readonly selectSlot?: HTMLElement | null }) {
  const activeDataset = data.source?.kind === "dataset" ? findChartsDataset(data.source.id) : undefined;

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

    {activeDataset && <div className="charts-data-info">
      <p className="charts-data-title">{activeDataset.title}</p>
      <p className="charts-readout">{activeDataset.description}</p>
      <p className="charts-readout"><a href={activeDataset.source.url} target="_blank" rel="noreferrer">{activeDataset.source.name}</a> — {activeDataset.source.licence}</p>
      <ChartsDatasetDataView dataset={activeDataset} />
    </div>}
  </div>;
}
