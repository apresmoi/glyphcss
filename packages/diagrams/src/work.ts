import type { GlyphGraph } from "./types";
import type { GlyphDiagramLedgerEntry } from "./ledger";

// Private plumbing: no caller-controlled budget and no browser clock in fitting.
export const GLYPH_DIAGRAM_WORK = Symbol("diagram render work");
const SEARCH_WORK = 2_500_000;
const ROUTE_WORK = 1_000;
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
    this.reserve = (panels ? panels + 1 : 0) * (1 + width + 2 * width * (height + 2) + ROUTE_WORK + 5 * width * height);
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
    // Dense layered layouts create long-edge dummies and crossing comparisons.
    // Charge flow-edge triples, not just calls; self-loops use fixed geometry.
    const edges = graph.edges.filter(edge => edge.from !== edge.to).length;
    this.take("layouts", Math.max(1, edges ** 3));
  }

  canLayout(graph: GlyphGraph): boolean {
    const edges = graph.edges.filter(edge => edge.from !== edge.to).length;
    return !this.limited && this.remaining - Math.max(1, edges ** 3) >= this.reserve;
  }

  route(): void { this.take("routings", ROUTE_WORK); }

  ledger(): GlyphDiagramLedgerEntry[] {
    return this.limited ? [{ code: "render-work-limited", message: "Stopped fitting at the render's deterministic work limit and used edge panels where needed.",
      detail: { ...this.counts, work: this.limit - this.remaining, workLimit: this.limit, searchWorkLimit: SEARCH_WORK } }] : [];
  }
}
