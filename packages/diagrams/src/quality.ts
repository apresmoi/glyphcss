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
    const arrowheads = new Map<string, Set<string>>();
    for (const route of page.routes) {
      renderedEdges.add(route.edge.id);
      for (const end of ["from", "to"] as const) {
        const head = end === "from" ? route.edge.startHead ?? "none" : route.edge.endHead ?? (route.edge.style === "undirected" ? "none" : "arrow");
        if (head !== "arrow") continue;
        const port = page.layout.ports.find(port => port.edgeId === route.edge.id && port.end === end)!;
        const key = JSON.stringify([port.nodeId, port.side]);
        const point = page.layout.nodes.find((node) => node.id === port.nodeId)?.shape === "point";
        const cells = arrowheads.get(key) ?? new Set<string>();
        cells.add(point ? "point" : `${port.anchor.x},${port.anchor.y}`);
        arrowheads.set(key, cells);
      }
    }
    maxArrowheadsOnSide = Math.max(maxArrowheadsOnSide, ...[...arrowheads.values()].map(cells => cells.size));
  });
  const detours = edges.flatMap((edge) => edge.detourRatio === null ? [] : [edge.detourRatio]);
  const missingEdges = new Set(result.report.unroutable);
  // Metadata keeps original edges, including ones removed by semantic degradation.
  const original = canonicalizeGlyphGraph({ nodes: result.meta.nodes, edges: result.meta.edges, groups: result.meta.groups, direction: result.layout.direction });
  for (const edge of original.edges) if (!edge.invisible && !renderedEdges.has(edge.id)) missingEdges.add(edge.id);
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
