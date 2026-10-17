import { renderGlyphLaneDag, GLYPH_LANE_FIXED_LANES } from "./lanes/render";
import type { GlyphMermaidGitLanes } from "./mermaidGit";
import type { GlyphGraph } from "./types";
import type { GlyphDiagramLedgerEntry } from "./ledger";
import type { GlyphDiagramRenderOptions, GlyphDiagramResult, GlyphDiagramPage } from "./renderTypes";

/** Lanes own geometry. Root metadata retains ancestry; graph-only geometry arrays are empty. */
export async function renderGlyphMermaidGit(graph: GlyphGraph, lanes: GlyphMermaidGitLanes, notes: GlyphDiagramLedgerEntry[], options: GlyphDiagramRenderOptions): Promise<GlyphDiagramResult> {
  const result = await renderGlyphLaneDag(lanes.dag, { ...options, order: lanes.order, ids: lanes.ids, [GLYPH_LANE_FIXED_LANES]: lanes.laneOf });
  const pages: GlyphDiagramPage[] = result.pages.map(page => ({ ...page, routes: [], labels: [], layout: {
    nodes: [], edges: [], groups: [], ports: [], loops: [], ledger: [], direction: graph.direction,
    width: page.canvas.cols, height: page.canvas.rows,
  } }));
  return { ...result, ...pages[0]!, text: result.text, ...(result.html === undefined ? {} : { html: result.html }), pages,
    meta: { nodes: graph.nodes, edges: graph.edges, groups: [], description: result.meta.description },
    report: { ...result.report, ledger: [...notes, ...result.report.ledger], unroutable: [] } };
}
