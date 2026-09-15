/**
 * The graph source card — the rail's own FIRST thing, above the "Edit
 * source ▸" disclosure (packet D5, AGENTS.md's "Diagrams" — mirrors
 * "Charts" "Data layer" / `ChartsWorkbench/ChartsDataFolder.tsx`): the
 * currently loaded graph's title, description, source credit, and — for a
 * Hugging Face pick — its own graph label (`y`) and a note when the node
 * cap simplified it. A tray preset shows only its own label (presets carry
 * no external credit/licence of their own; `datasets3d/LICENSES.md` covers
 * the 3D examples' own provenance already). `loadingTitle`/`notice` mirror
 * the charts card's own feedback-lives-in-the-rail rule (the user's own
 * words there: "it shouldn't be in the rendering area — it moves the
 * chart") — never floated over the render.
 */
import type { GlyphDiagramsGraphSource } from "./diagramsWorkbenchState";

export function DiagramsGraphSourceCard({ graphSource, presetLabel, loadingTitle, notice }: {
  readonly graphSource: GlyphDiagramsGraphSource | undefined;
  /** The tray preset's own label, when `graphSource.kind === "builtin"` —
   *  `diagramsWorkbenchState.ts`'s preset list, not re-imported here so
   *  this component stays a pure display of whatever the caller resolved. */
  readonly presetLabel?: string;
  readonly loadingTitle?: string;
  readonly notice?: string;
}) {
  const remote = graphSource?.kind === "remote" ? graphSource : undefined;

  return <div className="diagrams-graph-source">
    {notice && <p className="diagrams-readout" role="status">{notice}</p>}
    {loadingTitle && <p className="diagrams-readout diagrams-data-loading" role="status">
      {loadingTitle} <span className="diagrams-data-loading-spinner" aria-hidden="true">⟳</span>
    </p>}
    {!loadingTitle && graphSource?.kind === "builtin" && presetLabel && <div className="diagrams-graph-info">
      <p className="diagrams-graph-title">{presetLabel}</p>
    </div>}
    {!loadingTitle && remote && <div className="diagrams-graph-info">
      <p className="diagrams-graph-title">{remote.title}</p>
      {remote.description && <p className="diagrams-readout">{remote.description}</p>}
      <p className="diagrams-readout"><a href={remote.source.url} target="_blank" rel="noreferrer">{remote.source.name}</a>{remote.source.licence ? ` — ${remote.source.licence}` : ""}</p>
      {remote.label !== undefined && <p className="diagrams-readout">Graph label: {remote.label}</p>}
      {remote.simplified && <p className="diagrams-readout">Simplified for legibility — the full graph is larger than what's shown.</p>}
    </div>}
  </div>;
}
