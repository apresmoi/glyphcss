/**
 * `/diagrams`' data overlay — ONE search field (built-in + Hugging Face
 * browse, `DiagramsDatasetSearchBox.tsx`) plus "Random", floating over the
 * viewport exactly the way `ChartsWorkbench/ChartsDataOverlay.tsx` floats
 * its own over the chart (packet D5). A sibling of `<InstrumentViewport>`
 * inside `<InstrumentMain>`.
 */
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";
import { DiagramsDatasetSearchBox, type DiagramsBuiltInGraph } from "./DiagramsDatasetSearchBox";
import type { DatasetHit } from "../../lib/graphDatasetSearch";

const DIAGRAMS_BUILTIN_GRAPHS: readonly DiagramsBuiltInGraph[] = GLYPH_DIAGRAM_WORKBENCH_PRESETS.map((preset) => ({ id: preset.id, label: preset.label }));

export function DiagramsDataOverlay({ loadedTitle, onSelectBuiltIn, onSelectRemote, onRandom }: {
  readonly loadedTitle: string;
  readonly onSelectBuiltIn: (id: string) => void;
  readonly onSelectRemote: (hit: DatasetHit) => void;
  readonly onRandom: () => void;
}) {
  return (
    <div className="diagrams-data-overlay">
      <DiagramsDatasetSearchBox
        builtIn={DIAGRAMS_BUILTIN_GRAPHS}
        loadedTitle={loadedTitle}
        onSelectBuiltIn={onSelectBuiltIn}
        onSelectRemote={onSelectRemote}
      />
      <button type="button" className="control-btn control-btn--primary diagrams-random-btn" title="Load a random graph" aria-label="Load random graph" onClick={onRandom}>Random</button>
    </div>
  );
}
