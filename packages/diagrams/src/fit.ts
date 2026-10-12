import { glyphDiagramCenterOffset } from "./center";
import { glyphDiagramCompactionFloor } from "./degrade";
import { glyphDiagramText } from "./labels";
import { glyphDiagramSnakeLayout } from "./snake";
import { paintGlyphDiagram } from "./paint";
import { layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, type GlyphDiagramLayout, type GlyphDiagramLayoutOptions, type GlyphDiagramReservedGraph } from "./pipeline";
import { GLYPH_DIAGRAM_ROUTE_SEPARATION, glyphDiagramHasRoutingClearance, routeGlyphGraphEdges, type GlyphDiagramRoutingResult } from "./route";
import type { GlyphGraph } from "./types";

export interface GlyphDiagramFitOptions extends GlyphDiagramLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly autoDirection?: boolean;
  readonly overflow?: "paginate" | "expand";
}
export interface GlyphDiagramAttempt {
  readonly layout: GlyphDiagramLayout;
  readonly routing: GlyphDiagramRoutingResult;
  readonly fits: boolean;
  readonly okay: boolean;
  readonly width: number;
  readonly height: number;
  readonly adjusted: boolean;
}
interface Candidate { readonly raw: GlyphDiagramLayout; readonly adjusted: boolean; readonly nodesep: number; readonly ranksep: number; readonly margin: number }
const perpendicular: Record<GlyphGraph["direction"], GlyphGraph["direction"]> = { TB: "LR", LR: "TB", BT: "RL", RL: "BT" };

function attempt(candidate: Candidate, width: number, height: number): GlyphDiagramAttempt {
  const { raw, adjusted } = candidate;
  const { dx, dy } = glyphDiagramCenterOffset(raw, { width, height });
  const layout = { ...raw,
    nodes: raw.nodes.map(n => ({ ...n, x0: n.x0 + dx, x1: n.x1 + dx, y0: n.y0 + dy, y1: n.y1 + dy })),
    ports: raw.ports.map(p => ({ ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } })),
  };
  const fits = raw.width <= width && raw.height <= height;
  const routing = fits ? routeGlyphGraphEdges(layout, { width, height }) : { routes: [], unroutable: [], ledger: [] };
  return { layout, routing, fits, okay: fits && routing.unroutable.length === 0, width, height, adjusted };
}

/**
 * Uniform snake row gaps to start from, shortest total first: 3 rows let an
 * edge turn between its two port lanes, and each more edge turning there can
 * need one more. Gaps then shrink one at a time below that.
 */
function snakeGaps(edges: number): readonly (readonly [number, number])[] {
  const most = 3 + edges;
  return Array.from({ length: most - 2 }, (_, r) => Array.from({ length: most - 2 }, (_, b) => [r + 3, b + 3] as const))
    .flat().sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0]);
}

/** Total route length and bends: a tighter gap must not buy its rows with a detour. */
function routeShape(result: GlyphDiagramAttempt): readonly [number, number] {
  let cells = 0, bends = 0;
  for (const route of result.routing.routes) {
    cells += route.cells.length;
    for (let i = 2; i < route.cells.length; i++) {
      const [a, b, c] = [route.cells[i - 2]!, route.cells[i - 1]!, route.cells[i]!];
      if ((b.x - a.x) !== (c.x - b.x) || (b.y - a.y) !== (c.y - b.y)) bends++;
    }
  }
  return [cells, bends];
}

function dropsEdgeLabel(result: GlyphDiagramAttempt, options: GlyphDiagramFitOptions): boolean {
  const painted = paintGlyphDiagram(result.layout, result.routing, { ...options, width: result.width, height: result.height });
  return painted.ledger.some(entry => entry.code === "label-dropped");
}

/** Resolve geometry in cells; output encoding and font metrics never enter this search. */
export async function fitGlyphGraph(graph: GlyphGraph, options: GlyphDiagramFitOptions): Promise<GlyphDiagramAttempt> {
  const { width, height } = options;
  const direction = options.direction ?? graph.direction;
  const directions = options.autoDirection ? [direction, perpendicular[direction]] : [direction];
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
  const longest = Math.max(1, ...graph.nodes.flatMap(node => node.label.split(/\r?\n/).map(line => glyphDiagramText(line, options.charset).length)));
  const labelWidth = options.labelWidth ?? longest;
  // Keep validation at the public layout boundary, including explicit values
  // that an already-impossible viewport would otherwise prune before layout.
  const initial: Candidate = { raw: await layoutGlyphGraph(graph, { ...options, direction, labelWidth }), adjusted: false, nodesep, ranksep, margin };
  const first = attempt(initial, width, height);
  if (first.okay) return first;

  const floor = glyphDiagramCompactionFloor(graph);
  const candidates: Candidate[] = [initial];
  const measured: { readonly reserved: GlyphDiagramReservedGraph; readonly wrap: number }[] = [];
  const seenMeasurements = new Set<string>();
  // Every distinct measurable wrap is considered. The upper bound comes from
  // authored text and the available cells, not a list of preferred resolutions.
  for (let wrap = Math.min(labelWidth, Math.max(1, width - 4)); wrap >= 1; wrap--) {
    for (const dir of directions) {
      const reserved = reserveGlyphGraphPorts(measureGlyphGraph(graph, { ...options, direction: dir, labelWidth: wrap }));
      const key = JSON.stringify([dir, reserved.nodes.map(node => [node.width, node.height])]);
      if (seenMeasurements.has(key)) continue;
      seenMeasurements.add(key);
      measured.push({ reserved, wrap });
    }
  }

  const seenLayouts = new Set<string>();
  const geometryKey = (raw: GlyphDiagramLayout) => JSON.stringify([raw.direction, raw.width, raw.height,
    raw.nodes.map(node => [node.id, node.x0, node.y0, node.x1, node.y1]),
    raw.ports.map(port => [port.edgeId, port.end, port.side, port.anchor, port.escape])]);
  seenLayouts.add(geometryKey(initial.raw));
  const layoutInputs = new Set<string>();
  const place = async (reserved: GlyphDiagramReservedGraph, ns: number, rs: number, pad: number) => {
    // The two spacing axes converge on the same candidates through different
    // parents. Deduplicate before Dagre, not only after it has done the work.
    const key = JSON.stringify([reserved.direction, reserved.nodes.map(node => [node.width, node.height]), ns, rs, pad]);
    if (layoutInputs.has(key)) return;
    layoutInputs.add(key);
    const raw = await layoutGlyphGraph(reserved, { ...options, nodesep: ns, ranksep: rs, margin: pad });
    const geometry = geometryKey(raw);
    if (seenLayouts.has(geometry)) return;
    seenLayouts.add(geometry);
    return raw;
  };
  const marginCount = Math.min(margin, Math.floor(Math.min(width, height) / 2)) + 1;
  const margins = Array.from({ length: marginCount }, (_, i) => marginCount - i - 1);
  const tryLayout = async (reserved: GlyphDiagramReservedGraph, ns: number, rs: number, pad: number) => {
    const raw = await place(reserved, ns, rs, pad);
    if (!raw) return;
    const candidate = { raw, adjusted: true, nodesep: ns, ranksep: rs, margin: pad };
    candidates.push(candidate);
    if (raw.width > width || raw.height > height || !glyphDiagramHasRoutingClearance(raw)) return;
    const result = attempt(candidate, width, height);
    return result.okay ? result : undefined;
  };
  const compact: Array<readonly [number, number]> = [];
  for (let ns = nodesep; ns >= Math.min(nodesep, floor); ns--) {
    for (let rs = ranksep; rs >= Math.min(ranksep, floor); rs--) compact.push([ns, rs]);
  }
  compact.sort((a, b) => (nodesep - a[0]) + (ranksep - a[1]) - (nodesep - b[0]) - (ranksep - b[1]));
  // A wrap narrower than the longest word cuts words mid-letter ("Deplo"/"y"),
  // so whole-word wraps go first, then the snake, and cut words only last.
  const longestWord = Math.max(1, ...graph.nodes.flatMap(node => glyphDiagramText(node.label, options.charset).split(/\s+/).map(word => word.length)));
  const tryMeasured = async (keep: (wrap: number) => boolean) => {
    for (const { reserved, wrap } of measured) {
      if (!keep(wrap)) continue;
      for (const [ns, rs] of compact) for (const pad of margins) {
        const result = await tryLayout(reserved, ns, rs, pad);
        if (result) return result;
      }
    }
  };
  const whole = await tryMeasured(wrap => wrap >= longestWord);
  if (whole) return whole;
  // Snakes taller than the budget still count when the canvas may grow.
  const tallSnakes: Candidate[] = [];
  if (directions.includes("LR")) {
    for (let wrap = Math.min(labelWidth, Math.max(1, width - 4)); wrap >= Math.max(1, Math.min(longestWord, width - 4)); wrap--) {
      const lr = measureGlyphGraph(graph, { ...options, direction: "LR", labelWidth: wrap });
      for (const [, rs] of compact) {
        const snake = (rowGap: readonly number[], branchGap: readonly number[]) => {
          const raw = glyphDiagramSnakeLayout(lr, { width, gap: rs, margin, branchGap, rowGap });
          if (!raw || raw.width > width || !glyphDiagramHasRoutingClearance(raw)) return undefined;
          const candidate = { raw, adjusted: true, nodesep, ranksep: rs, margin };
          const result = attempt(candidate, width, Math.max(height, raw.height));
          return result.okay && !dropsEdgeLabel(result, options) ? { candidate, result } : undefined;
        };
        // The shortest uniform gaps that route, then each gap shrunk on its
        // own: one turning edge must not pad every other gap to its size.
        let found: { readonly candidate: Candidate; readonly result: GlyphDiagramAttempt } | undefined, rowGaps: number[] = [], branchGaps: number[] = [];
        for (const [r, b] of snakeGaps(graph.edges.length)) {
          const rows = glyphDiagramSnakeLayout(lr, { width, gap: rs, margin, branchGap: b, rowGap: r })?.ledger.find(e => e.code === "layout-wrapped")?.detail?.rows as number | undefined;
          if (rows === undefined) continue;
          rowGaps = Array(rows).fill(r); branchGaps = Array(rows).fill(b);
          found = snake(rowGaps, branchGaps);
          if (found) break;
        }
        if (!found) continue;
        for (const gaps of [rowGaps, branchGaps]) for (let i = 0; i < gaps.length; i++) {
          for (let g = 1; g < gaps[i]!; g++) {
            const trial = [...gaps]; trial[i] = g;
            const tighter = gaps === rowGaps ? snake(trial, branchGaps) : snake(rowGaps, trial);
            if (!tighter) continue;
            const [cells, bends] = routeShape(tighter.result), [beforeCells, beforeBends] = routeShape(found.result);
            if (cells <= beforeCells && bends <= beforeBends) { gaps[i] = g; found = tighter; break; }
          }
        }
        if (found.candidate.raw.height <= height) return found.result;
        if (options.overflow === "expand") tallSnakes.push(found.candidate);
      }
    }
  }
  // Tightening is insufficient when protected port lanes or a return edge
  // consume a gap. Each additional connection can need its own separated lane.
  // Search the two axes independently: widening one must not waste the other.
  const clearance = GLYPH_DIAGRAM_ROUTE_SEPARATION + 2 * graph.edges.length;
  const maxNodeGap = Math.max(nodesep, clearance), maxRankGap = Math.max(ranksep, clearance);
  const repair = async (candidate: Candidate): Promise<Candidate[]> => {
    const next: Candidate[] = [];
    for (const [ns, rs] of [[candidate.nodesep + 1, candidate.ranksep], [candidate.nodesep, candidate.ranksep + 1]]) {
      if (ns > maxNodeGap || rs > maxRankGap) continue;
      const raw = await place(candidate.raw, ns, rs, candidate.margin);
      if (!raw) continue;
      next.push({ raw, adjusted: true, nodesep: ns, ranksep: rs, margin: candidate.margin });
    }
    return next;
  };
  // Widening a gap inside the viewport can clear a blocked route; candidates it
  // creates join the pool the final expand searches.
  const repairWithin = async (pool: Candidate[]): Promise<GlyphDiagramAttempt | undefined> => {
    const blocked = pool.filter(candidate => candidate.raw.width <= width && candidate.raw.height <= height);
    for (let i = 0; i < blocked.length; i++) {
      for (const candidate of await repair(blocked[i]!)) {
        candidates.push(candidate);
        // Increasing spacing outside a fixed viewport cannot rescue its overflow.
        if (candidate.raw.width > width || candidate.raw.height > height) continue;
        if (glyphDiagramHasRoutingClearance(candidate.raw)) {
          const result = attempt(candidate, width, height);
          if (result.okay) return result;
        }
        blocked.push(candidate);
      }
    }
    return undefined;
  };
  // Whole words first, inside the viewport. When the canvas may grow, a taller
  // whole-word diagram at the same width then beats one that fits by cutting
  // words; a WIDER one does not — widening is the last resort below.
  const repairedWhole = await repairWithin([...candidates]);
  if (repairedWhole) return repairedWhole;
  if (options.overflow === "expand") {
    const best = await expand([...candidates, ...tallSnakes], width);
    if (best) return best;
  }
  const wholeCount = candidates.length;
  const cut = await tryMeasured(wrap => wrap < longestWord);
  if (cut) return cut;
  const repairedCut = await repairWithin(candidates.slice(wholeCount));
  if (repairedCut) return repairedCut;

  if (options.overflow === "expand") {
    const best = await expand(candidates);
    if (best) return best;
  }
  return first;

  // Preserve the available line width before adding rows: vertical panning
  // keeps each line readable without requiring sideways travel as well.
  async function expand(pool: Candidate[], maxCols = Infinity): Promise<GlyphDiagramAttempt | undefined> {
    const cost = (cols: number, rows: number) => [cols / width, rows / height] as const;
    const compare = (a: readonly [number, number], b: readonly [number, number]) => a[0] - b[0] || a[1] - b[1];
    const lowerBound = (candidate: Candidate) => cost(Math.max(width, candidate.raw.width), Math.max(height, candidate.raw.height));
    const candidates = pool.filter(candidate => candidate.raw.width <= maxCols);
    let best: GlyphDiagramAttempt | undefined;
    while (candidates.length) {
      candidates.sort((a, b) => compare(lowerBound(a), lowerBound(b)));
      const candidate = candidates.shift()!;
      if (best && compare(lowerBound(candidate), cost(best.width, best.height)) >= 0) break;
      let previousWidth = 0, previousHeight = 0;
      // Bounds include routing space, not just node boxes. Centering is exactly
      // the same for this probe and the final paint, so an accepted route is reused.
      const hasClearance = glyphDiagramHasRoutingClearance(candidate.raw);
      for (let gutter = 0; hasClearance && gutter <= clearance * 2; gutter++) {
        const cols = Math.min(maxCols, Math.max(width, candidate.raw.width + gutter)), rows = Math.max(height, candidate.raw.height + gutter);
        if (cols === previousWidth && rows === previousHeight) continue;
        previousWidth = cols; previousHeight = rows;
        if (best && compare(cost(cols, rows), cost(best.width, best.height)) >= 0) break;
        const result = attempt(candidate, cols, rows);
        if (result.okay) { best = result; break; }
      }
      candidates.push(...(await repair(candidate)).filter(next => next.raw.width <= maxCols));
    }
    return best;
  }
}
