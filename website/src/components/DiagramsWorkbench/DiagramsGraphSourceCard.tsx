/**
 * The remote graph's provenance — the rail's own FIRST thing, above the
 * editor (packet D5, AGENTS.md's "Diagrams" — mirrors "Charts" "Data
 * layer" / `ChartsWorkbench/ChartsDataFolder.tsx`): a Hugging Face pick's
 * title, description, source credit and licence, its own graph label (`y`)
 * and a note when the node cap simplified it. A tray preset renders
 * NOTHING here — it names itself in the rail header, and presets carry no
 * external credit/licence of their own. `loadingTitle`/`notice` mirror
 * the charts card's own feedback-lives-in-the-rail rule (the user's own
 * words there: "it shouldn't be in the rendering area — it moves the
 * chart") — never floated over the render.
 */
import type { GlyphDiagramsGraphSource } from "../../features/diagrams/model/diagramsWorkbenchState";

export function DiagramsGraphSourceCard({
  graphSource,
  loadingTitle,
  notice,
  nodeCount,
  edgeCount,
}: {
  readonly graphSource: GlyphDiagramsGraphSource | undefined;
  readonly loadingTitle?: string;
  readonly notice?: string;
  /** P3 fix round — the CURRENTLY parsed graph's own `nodes`/`edges`
   *  lengths (`DiagramsWorkbench.tsx`'s `parsedGraph`), i.e. the "N"/"K"
   *  halves of "N of M nodes, K of L edges shown" — read off the live parse
   *  rather than duplicated on `graphSource`, since they're already exactly
   *  `graph.nodes.length`/`graph.edges.length` for a remote pick and this
   *  card would otherwise be the one place they could drift from it (an
   *  edit changes them; `graphSource`'s own snapshot fields don't).
   *  `undefined` while the draft doesn't parse. */
  readonly nodeCount?: number;
  readonly edgeCount?: number;
}) {
  const remote = graphSource?.kind === "remote" ? graphSource : undefined;
  // Only meaningful while the loaded graph still matches the remote
  // snapshot's own counts (an un-edited pick) — `nodeCount`/`edgeCount`
  // read the live parse, so a source edit that adds/removes nodes stops
  // this line from claiming a truncation the edit itself may have already
  // changed the shape of.
  const showCounts =
    remote &&
    typeof nodeCount === "number" &&
    typeof remote.originalNodeCount === "number" &&
    typeof edgeCount === "number" &&
    typeof remote.logicalEdgeCount === "number";

  if (!notice && !loadingTitle && !remote) return null;
  return (
    <div className="diagrams-graph-source">
      {notice && (
        <p className="diagrams-readout" role="status">
          {notice}
        </p>
      )}
      {loadingTitle && (
        <p className="diagrams-readout diagrams-data-loading" role="status">
          {loadingTitle}{" "}
          <span className="diagrams-data-loading-spinner" aria-hidden="true">
            ⟳
          </span>
        </p>
      )}
      {!loadingTitle && remote && (
        <div className="diagrams-graph-info">
          <p className="diagrams-graph-title">{remote.title}</p>
          {remote.description && <p className="diagrams-readout">{remote.description}</p>}
          <p className="diagrams-readout">
            <a href={remote.source.url} target="_blank" rel="noreferrer">
              {remote.source.name}
            </a>
            {remote.source.licence ? ` — ${remote.source.licence}` : ""}
          </p>
          {remote.label !== undefined && <p className="diagrams-readout">Graph label: {remote.label}</p>}
          {/* P1 — states which case applied (a symmetric edge_index reads as
           *  undirected, no arrowheads; anything else keeps every edge with
           *  its own arrowhead), rather than leaving a reader to infer it from
           *  the render alone. */}
          {remote.edgeDirection && <p className="diagrams-readout">Edges: {remote.edgeDirection}</p>}
          {/* P3 — "N of M nodes, K of L edges shown": states exactly how much
           *  the node cap trimmed, nodes AND edges (a graph can lose real
           *  edges to the cap even when its own node count barely exceeds it —
           *  a hub node just past the cap takes every one of its own edges
           *  with it). Shown whenever the counts are known, not only while
           *  `simplified` — an un-truncated graph reads "N of N nodes, K of K
           *  edges shown", which is a fine thing to state plainly too. */}
          {showCounts && (
            <p className="diagrams-readout">
              Showing {nodeCount} of {remote.originalNodeCount} nodes, {edgeCount} of {remote.logicalEdgeCount} edges.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
