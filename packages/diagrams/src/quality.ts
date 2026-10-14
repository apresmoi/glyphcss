import { glyphDiagramRouteQuality } from "./routeQuality";
import { canonicalizeGlyphGraph } from "./pipeline";
import type { GlyphDiagramResult } from "./renderTypes";

interface GlyphDiagramEdgeQuality {
  readonly page: number;
  readonly edgeId: string;
  readonly bends: number;
  readonly routeCells: number;
  readonly portDistance: number;
  /** Coincident escape ports have no finite ratio and are excluded from aggregates. */
  readonly detourRatio: number | null;
}

export interface GlyphDiagramQuality {
  readonly wordCuts: number;
  readonly crossings: number;
  readonly fakeFrames: number;
  readonly bends: { readonly total: number; readonly max: number };
  readonly detourRatio: { readonly mean: number; readonly max: number };
  readonly maxArrowheadsOnSide: number;
  readonly expansionRatio: number;
  readonly whitespaceFraction: number;
  readonly droppedEdges: number;
  readonly droppedLabels: number;
  readonly pages: number;
  readonly edges: readonly GlyphDiagramEdgeQuality[];
}

/** Offline measurements only; importing this module never changes fitting or painting. */
export function computeGlyphDiagramQuality(result: GlyphDiagramResult, budget: { readonly width: number; readonly height: number }): GlyphDiagramQuality {
  if (![budget.width, budget.height].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new RangeError("Quality budget must contain positive integer width and height.");
  }
  const edges: GlyphDiagramEdgeQuality[] = [];
  const renderedEdges = new Set<string>();
  let crossings = 0, fakeFrames = 0, maxArrowheadsOnSide = 0, outputCells = 0, whitespaceCells = 0;
  result.pages.forEach((page, pageIndex) => {
    const { cols, rows, char } = page.canvas.grid;
    outputCells += cols * rows;
    whitespaceCells += char.filter((cell) => cell === " ").length;
    const geometry = glyphDiagramRouteQuality(page.layout, page.routes);
    crossings += geometry.crossings;
    fakeFrames += geometry.fakeFrames;
    edges.push(...geometry.edges.map(edge => ({ ...edge, page: pageIndex + 1 })));
    const arrowheads = new Map<string, number>();
    for (const route of page.routes) {
      renderedEdges.add(route.edge.id);
      const to = page.layout.ports.find(port => port.edgeId === route.edge.id && port.end === "to")!;
      if (route.edge.style !== "undirected") {
        const key = JSON.stringify([to.nodeId, to.side]);
        // Point fan-in paints one head after its join bar, unlike boxed nodes.
        const point = page.layout.nodes.find((node) => node.id === to.nodeId)?.shape === "point";
        arrowheads.set(key, point ? 1 : (arrowheads.get(key) ?? 0) + 1);
      }
    }
    maxArrowheadsOnSide = Math.max(maxArrowheadsOnSide, ...arrowheads.values());
  });
  const detours = edges.flatMap((edge) => edge.detourRatio === null ? [] : [edge.detourRatio]);
  const missingEdges = new Set(result.report.unroutable);
  // Metadata keeps original edges, including ones removed by semantic degradation.
  const original = canonicalizeGlyphGraph({ nodes: result.meta.nodes, edges: result.meta.edges, groups: result.meta.groups, direction: result.layout.direction });
  for (const edge of original.edges) if (!renderedEdges.has(edge.id)) missingEdges.add(edge.id);
  for (const entry of result.report.ledger) if (entry.code === "unroutable" && typeof entry.detail?.edgeId === "string") missingEdges.add(entry.detail.edgeId);
  const wordCuts = result.report.ledger.filter((entry) => entry.code === "word-cut")
    .reduce((total, entry) => total + (entry.detail?.nodes as { words: readonly string[] }[]).reduce((sum, node) => sum + node.words.length, 0), 0);
  return {
    wordCuts, crossings, fakeFrames,
    bends: { total: edges.reduce((sum, edge) => sum + edge.bends, 0), max: Math.max(0, ...edges.map((edge) => edge.bends)) },
    detourRatio: { mean: detours.length ? detours.reduce((sum, ratio) => sum + ratio, 0) / detours.length : 0, max: Math.max(0, ...detours) },
    maxArrowheadsOnSide,
    expansionRatio: outputCells / (budget.width * budget.height),
    whitespaceFraction: outputCells ? whitespaceCells / outputCells : 0,
    droppedEdges: missingEdges.size,
    // The renderer deduplicates its ledger; this counts reported label losses,
    // not an inferred count of unique labels reconstructed from encoded text.
    droppedLabels: result.report.ledger.filter((entry) => entry.code === "label-dropped").length,
    pages: result.pages.length, edges,
  };
}
