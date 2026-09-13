/**
 * `/charts`' data overlay — the dataset SEARCH box, the stock dataset
 * `<select>` and "Random", as ONE bar floating over the chart viewport's
 * top-left corner. The user's own words: "the dataset search should be
 * above the chart like in the /maps view — also the pick-a-dataset and the
 * random button."
 *
 * A sibling of `<InstrumentViewport>` inside `<InstrumentMain>`, exactly
 * where `MapsWorkbench/MapSearchBox.tsx` sits on `/maps` — the same
 * chrome-on-the-render idiom, just three controls in one row instead of
 * one. `charts-workbench.css`'s `.charts-data-overlay` positions it
 * (`position: absolute`, the shared `--overlay-top`/`--overlay-left`
 * insets) and gives the viewport a matching top inset so the render never
 * starts under it.
 *
 * ONE row at every width down to 760px; below that the bar wraps (search
 * full-width first, select + Random sharing a second row) — CSS-only, see
 * that stylesheet's own doc.
 *
 * The rail (`ChartsWorkbench.tsx`) keeps only the dataset CARD (title,
 * description, credit, "View data ▸") and the Marks section below it —
 * no portal, no header action slot; this component owns the `<select>`
 * directly.
 */
import type { Dispatch } from "react";
import type { DatasetHit } from "../../lib/datasetSearch";
import { ChartsDatasetSearchBox } from "./ChartsDatasetSearchBox";
import { CHARTS_DATASETS, type ChartsWorkbenchAction } from "./chartsWorkbenchState";

export function ChartsDataOverlay({ activeDatasetId, dispatch, onSelectRemote, onRandom }: {
  readonly activeDatasetId: string | undefined;
  readonly dispatch: Dispatch<ChartsWorkbenchAction>;
  readonly onSelectRemote: (hit: DatasetHit) => void;
  readonly onRandom: () => void;
}) {
  return (
    <div className="charts-data-overlay">
      <ChartsDatasetSearchBox onSelect={onSelectRemote} />
      <span className="gx-select charts-dataset-select charts-data-overlay-select">
        <select aria-label="Dataset" value={activeDatasetId ?? ""} onChange={(e) => dispatch({ type: "select-dataset", id: e.target.value })}>
          {!activeDatasetId && <option value="" disabled>— pick a dataset —</option>}
          {CHARTS_DATASETS.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </span>
      <button type="button" className="control-btn control-btn--primary charts-random-btn" title="Load a random dataset" aria-label="Load random dataset" onClick={onRandom}>Random</button>
    </div>
  );
}
