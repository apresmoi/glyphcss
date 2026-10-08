import { type ChartsWorkbenchState, createChartsWorkbenchState } from "../../features/charts/model/chartsSpec";
import { randomChartsDatasetId, reduceChartsWorkbenchState } from "../../features/charts/model/chartsWorkbenchState";

/**
 * `/charts` is a SHOWCASE, not a builder (the user's own framing) — mirrors
 * `/gallery`'s own `resolveInitialPreset`/`randomPreset`: with no `?c=`
 * link to restore, the page always opens on a random vendored dataset's own
 * curated chart, rather than the empty/default preset a builder would
 * start from. `createChartsWorkbenchState()` (no dataset) stays exactly
 * what it always was — the historical-link regression pin
 * (`chartsUrlState.test.ts`) and every test that wants a fixed, dataset-free
 * starting point still get it — this is the ONE new entry point that layers
 * a real dataset selection on top via the same `select-dataset` reducer
 * action the rail's own dropdown and "Random" button dispatch.
 */
export function createRandomChartsWorkbenchState(): ChartsWorkbenchState {
  return reduceChartsWorkbenchState(createChartsWorkbenchState(), {
    type: "select-dataset",
    id: randomChartsDatasetId(),
  });
}
