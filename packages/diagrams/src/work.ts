import type { GlyphGraph } from "./types";
import type { GlyphDiagramLedgerEntry } from "./ledger";
import { glyphDiagramGroupDepths, glyphDiagramGroupParents } from "./pipeline";

// Private plumbing: no caller-controlled budget and no browser clock in fitting.
export const GLYPH_DIAGRAM_WORK = Symbol("diagram render work");
const SEARCH_WORK = 2_500_000;
const ROUTE_WORK = 1_000;
// Sparse compound layouts still build/rank/order Dagre's dummy graph. Edge
// triples alone let thousands of rejected geometries escape the search cap.
const LAYOUT_WORK = 5_000;
function layoutCost(graph: GlyphGraph): number {
  const edges = graph.edges.filter(edge => edge.from !== edge.to).length;
  const groups = graph.groups ?? [];
  const depth = Math.max(0, ...glyphDiagramGroupDepths(glyphDiagramGroupParents(graph.groups ?? [])).values());
  // Compound ranking adds boundary nodes/edges even for sparse authored graphs.
  const size = graph.nodes.length + edges + groups.length;
  return groups.length ? Math.max(LAYOUT_WORK, size ** 3) * (1 + depth) ** 2 : Math.max(ROUTE_WORK, edges ** 3);
}
export class GlyphDiagramWorkLimit extends Error {}

export class GlyphDiagramWork {
  readonly counts = { layouts: 0, routings: 0, expansions: 0, probes: 0 };
  readonly limit: number;
  private remaining: number;
  private readonly reserve: number;
  limited = false;
  terminal = false;

  constructor(graph: GlyphGraph, width: number, height: number) {
    // Reserve two spacing choices per distinct wrap/direction/margin, plus
    // four directional cell states and connectivity room for one route.
    const panels = graph.edges.length + graph.nodes.filter(node => !graph.edges.some(edge => edge.from === node.id || edge.to === node.id)).length;
    // An unfunded initial graph also probes its first boundary panel.
    this.reserve = (panels ? panels + 1 : 0) * ((2 + 2 * width * (height + 2)) * layoutCost({ ...graph, nodes: graph.nodes.slice(0, 2), edges: [] })
      + width + ROUTE_WORK + 5 * width * height);
    this.limit = SEARCH_WORK + this.reserve;
    this.remaining = this.limit;
  }

  check(): void {
    if (this.limited && !this.terminal) throw new GlyphDiagramWorkLimit();
  }

  take(kind: keyof GlyphDiagramWork["counts"], cost = 1): void {
    this.check();
    if (this.remaining - cost < (this.terminal ? 0 : this.reserve)) {
      this.limited = true;
      throw new GlyphDiagramWorkLimit();
    }
    this.remaining -= cost;
    this.counts[kind]++;
  }

  layout(graph: GlyphGraph): void {
    this.take("layouts", layoutCost(graph));
  }

  canLayout(graph: GlyphGraph): boolean {
    return !this.limited && this.remaining - layoutCost(graph) >= this.reserve;
  }

  route(): void { this.take("routings", ROUTE_WORK); }

  ledger(): GlyphDiagramLedgerEntry[] {
    return this.limited ? [{ code: "render-work-limited", message: "Stopped fitting at the render's deterministic work limit and used edge panels where needed.",
      detail: { ...this.counts, work: this.limit - this.remaining, workLimit: this.limit, searchWorkLimit: SEARCH_WORK } }] : [];
  }
}
