import { ActionButton } from "../ActionButton";
/**
 * `/charts`' data overlay — ONE search field (built-in + Hugging Face
 * browse, `ChartsDatasetSearchBox.tsx`) plus "Random", floating over the
 * chart viewport's top edge, CENTERED exactly the way
 * `MapsWorkbench/MapSearchBox.tsx` centers `/maps`' own place search. The
 * user's own words: "the search box should be centered like the one in
 * /maps, and the dataset dropdown could be just an arrow inside the search
 * field — I don't need two dataset pickers — and the random button at the
 * right." The old three-control bar (search + a stock `<select>` +
 * "Random") is gone; `charts-workbench.css`'s `.charts-dataset-search`
 * carries the exact same `left`/`transform`/`width`/`top` `.maps-search`
 * does, and `.charts-random-btn` is pinned to its right on the same row.
 *
 * A sibling of `<InstrumentViewport>` inside `<InstrumentMain>`, same as
 * before. `ChartsWorkbench.tsx` still calls this with exactly
 * `{ activeDatasetId, dispatch, onSelectRemote, onRandom }` — this file's
 * own public contract, unchanged, so it stays the seam between the two.
 *
 * The rail (`ChartsWorkbench.tsx`) keeps only the dataset CARD (title,
 * description, credit, "View data ▸") and the Marks section below it —
 * no portal, no header action slot; this component owns dataset selection
 * directly.
 */
import { useEffect, useState, type Dispatch } from "react";
import {
  CHARTS_DATASETS,
  findChartsDataset,
  type ChartsWorkbenchAction,
} from "../../features/charts/model/chartsWorkbenchState";
import type { DatasetHit } from "../../services/datasets/datasetSearch";
import { ChartsDatasetSearchBox } from "./ChartsDatasetSearchBox";

export function ChartsDataOverlay({
  activeDatasetId,
  dispatch,
  onSelectRemote,
  onRandom,
  remoteSuggestions,
}: {
  readonly activeDatasetId: string | undefined;
  readonly dispatch: Dispatch<ChartsWorkbenchAction>;
  readonly onSelectRemote: (hit: DatasetHit) => void;
  readonly onRandom: () => void;
  /** Overrides the search box's own default curated-Hugging-Face
   *  suggestion list (`remoteIndex.ts`'s 2D set) — `ChartsWorkbench.tsx`
   *  passes the 3D-verified list (packet C6) while a 3D type is active, so
   *  the empty-query suggestions read well as 3D scatter picks instead of
   *  the 2D-curated set. `undefined` (the default) keeps the search box's
   *  own default untouched. */
  readonly remoteSuggestions?: readonly DatasetHit[];
}) {
  // The search box's idle display needs "whatever is currently loaded",
  // but its own props (frozen by `ChartsWorkbench.tsx`, which this packet
  // cannot touch) carry only a VENDORED id — a remote pick has no id here
  // at all. Tracked locally instead: set on every remote pick, cleared the
  // moment a vendored id reappears (a Random click or a browse-list pick
  // both flow through `activeDatasetId`, whichever dispatched them).
  const [remoteTitle, setRemoteTitle] = useState<string | null>(null);
  useEffect(() => {
    if (activeDatasetId) setRemoteTitle(null);
  }, [activeDatasetId]);
  const loadedTitle = remoteTitle ?? (activeDatasetId ? findChartsDataset(activeDatasetId)?.title : undefined) ?? "";

  return (
    <div className="charts-data-overlay">
      <ChartsDatasetSearchBox
        builtIn={CHARTS_DATASETS}
        loadedTitle={loadedTitle}
        onSelectBuiltIn={(id) => dispatch({ type: "select-dataset", id })}
        onSelectRemote={(hit) => {
          setRemoteTitle(hit.title);
          onSelectRemote(hit);
        }}
      />
      <ActionButton
        type="button"
        className="control-btn control-btn--primary charts-random-btn"
        title="Load a random dataset"
        aria-label="Load random dataset"
        onClick={onRandom}
      >
        Random
      </ActionButton>
    </div>
  );
}
