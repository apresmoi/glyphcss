import { glyphDiagramGraphLabels } from "./graphLabels";
import { glyphDiagramRouteQuality } from "./routeQuality";
import { GLYPH_DIAGRAM_DAGRE_ALIGN, GLYPH_DIAGRAM_DAGRE_ALIGNMENTS } from "./fitAlignment";
import type { GlyphDiagramLedgerEntry } from "./ledger";
import { glyphDiagramCenterOffset } from "./center";
import { glyphDiagramCompactionFloor } from "./degrade";
import { glyphDiagramText } from "./labels";
import { glyphDiagramSnakeLayout } from "./snake";
import { GLYPH_DIAGRAM_LOOP_LABEL_MAX } from "./loop";
import { GLYPH_DIAGRAM_FAN_GAP, GLYPH_DIAGRAM_EDGE_LABEL_ROOM, glyphDiagramFoldLabel, glyphDiagramGroupDepths, glyphDiagramGroupParents, glyphDiagramWords, glyphDiagramWrap, GLYPH_DIAGRAM_DIRECTIONS, layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, type GlyphDiagramLayout, type GlyphDiagramLayoutOptions, type GlyphDiagramReservedGraph } from "./pipeline";
import { GLYPH_DIAGRAM_ROUTE_SEPARATION, glyphDiagramHasRoutingClearance, glyphDiagramLoopsClear, routeGlyphGraphEdges, type GlyphDiagramRoutingResult } from "./route";
import type { GlyphGraph } from "./types";
import { GLYPH_DIAGRAM_WORK, GlyphDiagramWorkLimit, type GlyphDiagramWork } from "./work";

export interface GlyphDiagramFitOptions extends GlyphDiagramLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly autoDirection?: boolean;
  readonly overflow?: "paginate" | "expand";
  /** Stop before cutting a word (default true). The nested-frame fallback uses it to try the cheaper layouts first. */
  readonly cutWords?: boolean;
  readonly [GLYPH_DIAGRAM_WORK]?: GlyphDiagramWork;
}
const FIT_SPACING = Symbol("fit spacing");
export interface GlyphDiagramAttempt {
  readonly [FIT_SPACING]?: number;
  readonly layout: GlyphDiagramLayout;
  readonly routing: GlyphDiagramRoutingResult;
  readonly fits: boolean;
  readonly okay: boolean;
  readonly width: number;
  readonly height: number;
  readonly adjusted: boolean;
}
interface Candidate { readonly raw: GlyphDiagramLayout; readonly adjusted: boolean; readonly nodesep: number; readonly ranksep: number; readonly margin: number }
const MAX_TALL_SNAKES = 3;
const MAX_LOOP_WRAPS = 3;
const MAX_EXPAND_PROBES = 256;
const MAX_GUTTER_PROBES = 128;
const MAX_EXPAND_ROUTING = 384;
const perpendicular: Record<GlyphGraph["direction"], GlyphGraph["direction"]> = { TB: "LR", LR: "TB", BT: "RL", RL: "BT" };

function routeAttempt(candidate: Candidate, width: number, height: number, stopOnFailure = false, work?: GlyphDiagramWork): GlyphDiagramAttempt {
  const { raw, adjusted } = candidate;
  const { dx, dy } = glyphDiagramCenterOffset(raw, { width, height });
  const layout = { ...raw,
    nodes: raw.nodes.map(n => ({ ...n, x0: n.x0 + dx, x1: n.x1 + dx, y0: n.y0 + dy, y1: n.y1 + dy })),
    ports: raw.ports.map(p => ({ ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } })),
  };
  const fits = raw.width <= width && raw.height <= height;
  let routing: GlyphDiagramRoutingResult = { routes: [], unroutable: [], ledger: [] };
  if (fits) {
    // A failed fitting probe is discarded; only terminal panels need every failure.
    try { routing = routeGlyphGraphEdges(layout, { width, height, stopOnFailure: stopOnFailure || (!!work && !work.terminal), [GLYPH_DIAGRAM_WORK]: work } as Parameters<typeof routeGlyphGraphEdges>[1]); }
    catch (error) {
      if (!(error instanceof GlyphDiagramWorkLimit)) throw error;
      // Partial probe routes are never painted as a complete graph.
      routing = { routes: [], unroutable: layout.edges.map(edge => edge.id), ledger: [] };
    }
  }
  // A loop that fits nowhere is not a routing failure the search would notice: its label would only be dropped.
  return { [FIT_SPACING]: candidate.margin, layout, routing, fits, okay: fits && routing.unroutable.length === 0 && glyphDiagramLoopsClear(layout), width, height, adjusted };
}

/**
 * Uniform snake row gaps to start from, shortest total first: 3 rows let an
 * edge turn between its two port lanes, and each more edge turning there can
 * need one more. Gaps then shrink one at a time below that.
 */
function snakeGaps(edges: number, floor: number): readonly (readonly [number, number])[] {
  const most = floor + edges;
  return Array.from({ length: most - floor + 1 }, (_, r) => Array.from({ length: most - floor + 1 }, (_, b) => [r + floor, b + floor] as const))
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
  return glyphDiagramGraphLabels(result.layout, result.routing, { ...options, width: result.width, height: result.height }).dropped.length > 0;
}

/** Resolve geometry in cells; output encoding and font metrics never enter this search. */
export async function fitGlyphGraph(graph: GlyphGraph, options: GlyphDiagramFitOptions): Promise<GlyphDiagramAttempt> {
  options = { ...options, [GLYPH_DIAGRAM_FAN_GAP]: true };
  const nested = Math.max(0, ...glyphDiagramGroupDepths(glyphDiagramGroupParents(graph.groups ?? [])).values()) > 0;
  if (!nested) return fitAligned(graph, options);
  // Frames padded outside the frames they hold are a preference, not a requirement: they cost a few cells on every side, so a
  // graph that only fits with frames sharing a border still gets them before it is cut into panels or its words are cut.
  const limits: GlyphDiagramLedgerEntry[] = [];
  const fit = async (opts: GlyphDiagramFitOptions) => {
    const result = await fitAligned(graph, opts);
    limits.push(...result.layout.ledger.filter(entry => entry.code === "fit-search-limited"));
    return result;
  };
  const finish = (result: GlyphDiagramAttempt) => limits.length
    ? { ...result, layout: { ...result.layout, ledger: [...result.layout.ledger, ...limits] } } : result;
  const padded = await fit({ ...options, frameInset: true, cutWords: false });
  if (padded.okay || options[GLYPH_DIAGRAM_WORK]?.limited) return finish(padded);
  const shared = await fit({ ...options, frameInset: false, cutWords: false });
  if (shared.okay || options[GLYPH_DIAGRAM_WORK]?.limited) return finish(shared);
  const cutPadded = await fit({ ...options, frameInset: true });
  if (cutPadded.okay || options[GLYPH_DIAGRAM_WORK]?.limited) return finish(cutPadded);
  const cutShared = await fit({ ...options, frameInset: false });
  return finish(cutShared.okay ? cutShared : cutPadded);
}

interface SnakeSearch { readonly fit?: GlyphDiagramAttempt; readonly tall: Candidate[] }

/** Node area and the longest acyclic rank path are necessary, not sufficient, bounds. */
function minimumFootprintFits(graph: GlyphDiagramReservedGraph, width: number, height: number): boolean {
  if (graph.nodes.some(node => node.width > width || node.height > height)
    || graph.nodes.reduce((cells, node) => cells + node.width * node.height, 0) > width * height) return false;
  // Compound ranking and cycle reversal have their own constraints; don't infer their ranks here.
  if (graph.groups.length) return true;
  const across = graph.direction === "TB" || graph.direction === "BT";
  const sizes = new Map(graph.nodes.map(node => [node.id, across ? node.height : node.width]));
  const flow = graph.edges.filter(edge => edge.from !== edge.to);
  const indegree = new Map(graph.nodes.map(node => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of flow) { indegree.set(edge.to, indegree.get(edge.to)! + 1); outgoing.get(edge.from)!.push(edge.to); }
  const ready = graph.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  const extent = new Map(sizes);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!; visited++;
    for (const to of outgoing.get(id)!) {
      extent.set(to, Math.max(extent.get(to)!, extent.get(id)! + 3 + sizes.get(to)!));
      indegree.set(to, indegree.get(to)! - 1);
      if (!indegree.get(to)) ready.push(to);
    }
  }
  return visited !== graph.nodes.length || Math.max(0, ...extent.values()) <= (across ? height : width);
}

interface FitSearch {
  readonly work: { expansionRoutes: number };
  readonly snakes: Map<number, SnakeSearch>;
  readonly layouts: Map<string, GlyphDiagramLayout>;
  readonly attempts: Map<string, GlyphDiagramAttempt>;
  readonly ledger: GlyphDiagramLedgerEntry[];
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

function wordCuts(result: GlyphDiagramAttempt, charset: GlyphDiagramFitOptions["charset"]): number {
  const cut = (label: string, lines: readonly string[]) => {
    const shown = new Set(lines.flatMap(glyphDiagramWords));
    return glyphDiagramWords(glyphDiagramFoldLabel(label, charset)).filter(piece => !shown.has(piece)).length;
  };
  return result.layout.nodes.reduce((sum, node) => sum + (node.shape === "point" ? 0 : cut(node.label, node.lines)), 0)
    + result.layout.loops.reduce((sum, loop) => sum + cut(result.layout.edges.find(edge => edge.id === loop.edgeId)?.label ?? "", loop.lines), 0);
}
const cutsWords = (result: GlyphDiagramAttempt, charset: GlyphDiagramFitOptions["charset"]) => wordCuts(result, charset) > 0;

const readabilityCache = new WeakMap<GlyphDiagramAttempt, readonly number[]>();
function readability(result: GlyphDiagramAttempt): readonly number[] {
  const cached = readabilityCache.get(result);
  if (cached) return cached;
  const quality = glyphDiagramRouteQuality(result.layout, result.routing.routes);
  const score = [quality.crossings, quality.fakeFrames, quality.edges.reduce((sum, edge) => sum + edge.bends, 0),
    quality.edges.reduce((sum, edge) => sum + (edge.detourRatio ?? 0), 0), quality.edges.reduce((sum, edge) => sum + edge.routeCells, 0)];
  readabilityCache.set(result, score);
  return score;
}
function compareScore(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** One sideways trailing chain, with the existing labels and a full reroute. */
export function glyphDiagramFoldTail(result: GlyphDiagramAttempt, options: GlyphDiagramFitOptions): GlyphDiagramAttempt {
  const layout = result.layout;
  if (!result.okay || options[GLYPH_DIAGRAM_WORK]?.terminal || layout.groups.length || layout.loops.length
    || (layout.direction !== "TB" && layout.direction !== "BT")) return result;
  const incoming = (id: string) => layout.edges.filter(edge => edge.to === id);
  const outgoing = (id: string) => layout.edges.filter(edge => edge.from === id);
  const tails = layout.nodes.filter(node => incoming(node.id).length === 1 && !outgoing(node.id).length).map(sink => {
    const chain = [sink];
    while (incoming(chain[0]!.id).length === 1) {
      const parent = layout.nodes.find(node => node.id === incoming(chain[0]!.id)[0]!.from)!;
      if (outgoing(parent.id).length !== 1 || chain.includes(parent)) break;
      chain.unshift(parent);
    }
    return chain;
  }).filter(chain => chain.length >= 3 && chain.every(node => node.shape !== "point"));
  // One deterministic chain keeps repairs within the fitting work bound.
  const chain = tails.sort((a, b) => b.length - a.length)[0];
  if (!chain) return result;
  const margin = result[FIT_SPACING] ?? options.margin ?? 1, gap = 2;
  const rowWidth = chain.reduce((sum, node) => sum + node.width, 0) + gap * (chain.length - 1);
  if (rowWidth + 2 * margin > result.width) return result;
  const originalHead = chain[0]!;
  const x0 = Math.min(originalHead.x0, result.width - margin - rowWidth);
  const head = { ...originalHead, x0, x1: x0 + originalHead.width - 1 };
  const center = head.y0 + Math.floor((head.height - 1) / 2);
  let x = head.x1 + gap + 1;
  const moved = new Map(chain.slice(1).map(node => {
    const centered = center - Math.floor((node.height - 1) / 2);
    const y = layout.direction === "TB" ? Math.max(head.y0, centered) : Math.min(head.y1 - node.height + 1, centered);
    const x0 = x;
    const placed = { ...node, x0, x1: x0 + node.width - 1, y0: y, y1: y + node.height - 1 };
    x += node.width + gap;
    return [node.id, placed];
  }));
  moved.set(head.id, head);
  // The existing incoming port lanes need a turning corridor even after the tail turns sideways.
  // Add it upstream rather than stretching every rank gap.
  const parents = incoming(head.id).map(edge => layout.nodes.find(node => node.id === edge.from)!);
  const gapBefore = Math.min(...parents.map(node => layout.direction === "TB" ? head.y0 - node.y1 - 1 : node.y0 - head.y1 - 1));
  const clearance = Math.max(0, GLYPH_DIAGRAM_ROUTE_SEPARATION - gapBefore);
  const ids = new Set(chain.map(node => node.id));
  const upstream = layout.direction === "TB" ? -clearance : clearance;
  const placed = layout.nodes.map(node => moved.get(node.id)
    ?? { ...node, y0: node.y0 + upstream, y1: node.y1 + upstream });
  const shift = Math.min(...placed.map(node => node.y0)) - margin;
  const nodes = placed.map(node => ({ ...node, y0: node.y0 - shift, y1: node.y1 - shift }));
  if (nodes.some((node, i) => nodes.slice(i + 1).some(other => node.x0 <= other.x1 && node.x1 >= other.x0
    && node.y0 <= other.y1 && node.y1 >= other.y0))) return result;
  const naturalHeight = Math.max(...nodes.map(node => node.y1 + 1 + margin));
  const height = Math.max(options.height, naturalHeight);
  if (naturalHeight >= layout.height) return result;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ports = layout.ports.map(port => {
    const edge = layout.edges.find(edge => edge.id === port.edgeId)!;
    const sideways = ids.has(edge.from) && ids.has(edge.to);
    const side = sideways ? port.end === "from" ? "e" : "w" : port.side;
    const node = byId.get(port.nodeId)!;
    const offset = sideways ? center - shift - node.y0 : port.offset;
    const anchor = side === "n" || side === "s" ? { x: node.x0 + offset, y: side === "n" ? node.y0 : node.y1 }
      : { x: side === "w" ? node.x0 : node.x1, y: node.y0 + offset };
    const delta = GLYPH_DIAGRAM_DIRECTIONS[side];
    return { ...port, side, offset, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y } };
  });
  const raw = { ...layout, nodes, ports, width: result.width, height: naturalHeight };
  const candidate = routeAttempt({ raw, adjusted: true, nodesep: options.nodesep ?? 4, ranksep: gap, margin },
    result.width, height, true, options[GLYPH_DIAGRAM_WORK]);
  return candidate.okay && readability(candidate)[0]! <= readability(result)[0]!
    && readability(candidate)[1]! <= readability(result)[1]! && !dropsEdgeLabel(candidate, options) ? candidate : result;
}

/** One top-down pass: a moved parent can straighten its children next. */
export function glyphDiagramStraightenPorts(result: GlyphDiagramAttempt, options: GlyphDiagramFitOptions): GlyphDiagramAttempt {
  if (!result.okay || result.layout.groups.length || result.layout.loops.length || result.layout.nodes.some(node => node.shape === "point")
    || (result.layout.direction !== "TB" && result.layout.direction !== "BT")
    || options[GLYPH_DIAGRAM_WORK]?.terminal) return result;
  const margin = result[FIT_SPACING] ?? options.margin ?? 1;
  const rowOrder = [...result.layout.nodes].sort((a, b) => (result.layout.direction === "TB" ? a.y0 - b.y0 : b.y1 - a.y1)
    || a.x0 - b.x0 || a.id.localeCompare(b.id));
  for (const original of rowOrder) {
    if (options[GLYPH_DIAGRAM_WORK]?.limited) break;
    const layout = result.layout, node = layout.nodes.find(node => node.id === original.id)!;
    const incoming = layout.ports.filter(port => port.nodeId === node.id && port.end === "to"
      && (port.side === "n" || port.side === "s")).sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    let best = result;
    const tried = new Set<number>();
    for (const to of incoming) {
      const from = layout.ports.find(port => port.edgeId === to.edgeId && port.end === "from")!;
      if (from.side !== (to.side === "n" ? "s" : "n")
        || (to.side === "n" ? from.anchor.y >= to.anchor.y : from.anchor.y <= to.anchor.y)) continue;
      const dx = from.anchor.x - to.anchor.x;
      if (!dx || tried.has(dx)) continue;
      tried.add(dx);
      const single = incoming.length === 1 && layout.edges.filter(edge => edge.from === from.nodeId).length === 1;
      if (!single && Math.abs(dx) > 3) continue;
      const ids = new Set([node.id]);
      // Keep a single-input subtree together; joins remain anchored to their
      // other inputs, and backward edges must never pull an ancestor along.
      if (single) for (const id of ids) for (const edge of layout.edges.filter(edge => edge.from === id)) {
        const parent = layout.nodes.find(other => other.id === id)!;
        const child = layout.nodes.find(other => other.id === edge.to)!;
        if (layout.edges.filter(other => other.to === child.id).length === 1
          && (layout.direction === "TB" ? child.y0 > parent.y1 : child.y1 < parent.y0)) ids.add(child.id);
      }
      const moved = layout.nodes.filter(other => ids.has(other.id));
      const free = moved.every(other => {
        const neighbours = layout.nodes.filter(peer => !ids.has(peer.id) && other.y0 <= peer.y1 && other.y1 >= peer.y0);
        const left = Math.max(margin, ...neighbours.filter(peer => peer.x1 < other.x0).map(peer => peer.x1 + 2));
        const right = Math.min(result.width - margin - 1, ...neighbours.filter(peer => peer.x0 > other.x1).map(peer => peer.x0 - 2));
        return other.x0 + dx >= left && other.x1 + dx <= right;
      });
      if (!free) continue;
      const raw = { ...layout, width: result.width, height: result.height,
        nodes: layout.nodes.map(other => ids.has(other.id) ? { ...other, x0: other.x0 + dx, x1: other.x1 + dx } : other),
        ports: layout.ports.map(port => ids.has(port.nodeId) ? { ...port,
          anchor: { ...port.anchor, x: port.anchor.x + dx }, escape: { ...port.escape, x: port.escape.x + dx } } : port) };
      const candidate = routeAttempt({ raw, adjusted: true, margin, nodesep: options.nodesep ?? 4, ranksep: options.ranksep ?? 4 },
        result.width, result.height, true, options[GLYPH_DIAGRAM_WORK]);
      if (!candidate.okay) continue;
      const route = candidate.routing.routes.find(route => route.edge.id === to.edgeId)!;
      if (!route.cells.every(cell => cell.x === from.anchor.x)) continue;
      if (readability(candidate)[2]! < readability(best)[2]!
        && readability(candidate)[0]! <= readability(result)[0]!
        && readability(candidate)[1]! <= readability(result)[1]! && !dropsEdgeLabel(candidate, options)) best = candidate;
    }
    result = best;
  }
  return result;
}

/** Widen cut labels into their rank's spare columns without moving other ranks. */
function widenRanks(result: GlyphDiagramAttempt, options: GlyphDiagramFitOptions): GlyphDiagramAttempt {
  if (!result.okay || !cutsWords(result, options.charset) || result.layout.groups.length || result.layout.loops.length) return result;
  const nodes = [...result.layout.nodes];
  const margin = result[FIT_SPACING] ?? options.margin ?? 1;
  let changed = false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.shape === "point") continue;
    const text = glyphDiagramFoldLabel(node.label, options.charset);
    const desired = Math.min(options.labelWidth ?? Infinity, Math.max(1, ...glyphDiagramWords(text).map(word => word.length)));
    const current = Math.max(1, ...node.lines.map(line => line.length));
    if (desired <= current) continue;
    const neighbours = nodes.filter(n => n.id !== node.id && n.y0 <= node.y1 && n.y1 >= node.y0);
    const left = Math.max(margin, ...neighbours.filter(n => n.x1 < node.x0).map(n => n.x1 + 4));
    const right = Math.min(result.width - 1 - margin, ...neighbours.filter(n => n.x0 > node.x1).map(n => n.x0 - 4));
    const extra = node.shape === "subroutine" ? 2 : 0;
    const limit = Math.min(desired, right - left + 1 - 4 - extra);
    if (limit <= current) continue;
    const lines = glyphDiagramWrap(text, limit);
    const width = Math.max(node.width, ...lines.map(line => line.length + 4 + extra));
    const x0 = Math.max(left, Math.min(node.x0, right - width + 1));
    nodes[i] = { ...node, lines, width, x0, x1: x0 + width - 1 };
    changed = true;
  }
  if (!changed) return result;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const ports = result.layout.ports.map(port => {
    const node = byId.get(port.nodeId)!;
    // Keep the laid-out sibling order; only recenter its already reserved slots.
    const offset = port.offset + ((port.side === "n" || port.side === "s") ? Math.floor((node.width - result.layout.nodes.find(n => n.id === node.id)!.width) / 2) : 0);
    const anchor = port.side === "n" || port.side === "s" ? { x: node.x0 + offset, y: port.side === "n" ? node.y0 : node.y1 }
      : { x: port.side === "w" ? node.x0 : node.x1, y: node.y0 + offset };
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    return { ...port, offset, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y } };
  });
  const layout = { ...result.layout, nodes, ports };
  const routing = routeGlyphGraphEdges(layout, { width: result.width, height: result.height, stopOnFailure: true, [GLYPH_DIAGRAM_WORK]: options[GLYPH_DIAGRAM_WORK] } as Parameters<typeof routeGlyphGraphEdges>[1]);
  const candidate = { ...result, layout, routing, okay: routing.unroutable.length === 0, adjusted: true };
  return candidate.okay && readability(candidate)[0]! <= readability(result)[0]! && !dropsEdgeLabel(candidate, options) ? candidate : result;
}

async function fitAligned(graph: GlyphGraph, options: GlyphDiagramFitOptions): Promise<GlyphDiagramAttempt> {
  const search: FitSearch = { attempts: new Map(), layouts: new Map(), snakes: new Map(), ledger: [], work: { expansionRoutes: 0 } };
  try { return await searchAligned(); }
  catch (error) {
    if (!(error instanceof GlyphDiagramWorkLimit)) throw error;
    const attempts = [...search.attempts.values()];
    const best = attempts.filter(result => result.okay).sort((a, b) => a.width - b.width || a.height - b.height)[0] ?? attempts[0];
    if (!best) throw error;
    return { ...best, layout: { ...best.layout, ledger: [...best.layout.ledger, ...search.ledger] } };
  }
  async function searchAligned(): Promise<GlyphDiagramAttempt> {
    let initial = await fitOnce(graph, options, search, !options[GLYPH_DIAGRAM_WORK]?.terminal);
    if (options[GLYPH_DIAGRAM_WORK]?.terminal) return initial;
    // A closed return corridor is a geometry failure, not a wrapping failure.
    // Try the same labels with BK alignment and one extra cell on either gap
    // before exhaustively wrapping/cutting them. Failed probes remain cached
    // for the full search; a passing default still keeps its exact output.
    if (initial.fits && !initial.okay && !cutsWords(initial, options.charset)) {
      const ns = options.nodesep ?? 4, rs = options.ranksep ?? 4;
      let repaired: GlyphDiagramAttempt | undefined;
      for (const align of [undefined, ...GLYPH_DIAGRAM_DAGRE_ALIGNMENTS]) {
        for (const [nodesep, ranksep] of [[ns, rs], [ns + 1, rs], [ns, rs + 1]]) {
          const result = await fitOnce(graph, { ...options, nodesep, ranksep, [GLYPH_DIAGRAM_DAGRE_ALIGN]: align } as GlyphDiagramFitOptions, search, true);
          if (!result.okay || cutsWords(result, options.charset)) continue;
          const [cells, bends] = routeShape(result), [bestCells, bestBends] = repaired ? routeShape(repaired) : [Infinity, Infinity];
          if (bends < bestBends || (bends === bestBends && cells < bestCells)) repaired = result;
          break;
        }
      }
      if (repaired) initial = { ...repaired, adjusted: true };
    }
    let first = widenRanks(initial.okay ? initial : await fitOnce(graph, options, search), options);
    const missing = first.okay ? glyphDiagramGraphLabels(first.layout, first.routing,
      { ...options, width: first.width, height: first.height }).dropped : [];
    if (missing.length) {
      const edges = first.layout.edges.filter(edge => missing.includes(`edge:${edge.id}`));
      const margin = first[FIT_SPACING] ?? options.margin ?? 1;
      options[GLYPH_DIAGRAM_WORK]?.layout(first.layout);
      const raw = await layoutGlyphGraph(first.layout, { ...options, direction: first.layout.direction,
        margin, ranksep: Math.max(options.ranksep ?? 4, ...edges.map(edge =>
          first.layout.direction === "LR" || first.layout.direction === "RL" ? glyphDiagramText(edge.label!, options.charset).length + 4 : 4)),
        [GLYPH_DIAGRAM_EDGE_LABEL_ROOM]: edges.map(edge => edge.id) });
      const repaired = routeAttempt({ raw, adjusted: true, nodesep: options.nodesep ?? 4, ranksep: options.ranksep ?? 4, margin },
        options.overflow === "expand" ? Math.max(first.width, raw.width) : first.width,
        options.overflow === "expand" ? Math.max(first.height, raw.height) : first.height, true, options[GLYPH_DIAGRAM_WORK]);
      if (repaired.okay && !dropsEdgeLabel(repaired, options)) first = repaired;
    }
    const folded = glyphDiagramFoldTail(first, options);
    if (folded !== first && !cutsWords(folded, options.charset)) return glyphDiagramStraightenPorts(folded, options);
    if (first.okay && !cutsWords(first, options.charset)
      && (first.layout.groups.length || first.layout.ledger.some(entry => entry.code === "layout-wrapped"))) return first;
    let best = folded;
    if (first.layout.nodes.length === 1) return first;
    if (!first.okay || cutsWords(first, options.charset) || readability(first)[0]! > 0) {
      // Crossing-free whole-word defaults keep their text. Readability alternatives
      // stay within the first fit's canvas and the existing shared work budget.
      const bounded = { ...search, maxWidth: first.okay ? first.width : undefined, maxHeight: first.okay ? first.height : undefined };
      for (const align of first.okay && !cutsWords(first, options.charset)
        ? GLYPH_DIAGRAM_DAGRE_ALIGNMENTS.slice(0, 2).reverse()
        : GLYPH_DIAGRAM_DAGRE_ALIGNMENTS) {
        const alignedOptions = { ...options, [GLYPH_DIAGRAM_DAGRE_ALIGN]: align } as GlyphDiagramFitOptions;
        let result: GlyphDiagramAttempt;
        if (first.okay) {
          // Crossing probes only replay measured labels; never repeat the full
          // wrapping, snake and expansion search after a usable fit.
          const margin = first[FIT_SPACING] ?? options.margin ?? 1;
          const labels: GlyphDiagramReservedGraph[] = [first.layout];
          if (options.autoDirection && cutsWords(first, options.charset)) labels.unshift(reserveGlyphGraphPorts({ ...first.layout, direction: perpendicular[first.layout.direction] }));
          if (options.autoDirection) {
            const widths = [...new Set(first.layout.nodes.flatMap(node => glyphDiagramWords(glyphDiagramFoldLabel(node.label, options.charset)).map(word => Math.min(word.length, options.labelWidth ?? Infinity))))].sort((a, b) => b - a).slice(0, 2);
            for (const labelWidth of widths) labels.push(reserveGlyphGraphPorts(measureGlyphGraph(graph,
              { ...alignedOptions, direction: perpendicular[first.layout.direction], labelWidth })));
          }
          result = first;
          for (const measured of labels) {
            options[GLYPH_DIAGRAM_WORK]?.layout(measured);
            const raw = await layoutGlyphGraph(measured, { ...alignedOptions, margin });
            let probe = widenRanks(routeAttempt({ raw, adjusted: true, nodesep: options.nodesep ?? 4,
              ranksep: options.ranksep ?? 4, margin }, first.width, Math.max(first.height, raw.height), true, options[GLYPH_DIAGRAM_WORK]), options);
            probe = glyphDiagramFoldTail(probe, options);
            if (probe.okay && wordCuts(probe, options.charset) <= wordCuts(first, options.charset)
              && readability(probe)[0]! <= readability(first)[0]! && compareScore(readability(probe), readability(first)) < 0
              && !dropsEdgeLabel(probe, options)) { result = probe; break; }
          }
        } else result = widenRanks(await fitOnce(graph, alignedOptions, bounded), alignedOptions);
        if (!result.okay) continue;
        if (first.okay && (result.width > first.width || result.height > first.height
          || readability(result)[0]! > readability(first)[0]! || dropsEdgeLabel(result, options))) continue;
        if (!best.okay || wordCuts(result, options.charset) < wordCuts(best, options.charset)
          || (wordCuts(result, options.charset) === wordCuts(best, options.charset)
            && compareScore(readability(result), readability(best)) < 0)) {
          best = result;
          const tail = glyphDiagramFoldTail(best, options);
          if (tail !== best) best = glyphDiagramStraightenPorts(tail, options);
          return search.ledger.length ? { ...best, layout: { ...best.layout, ledger: [...best.layout.ledger, ...search.ledger] } } : best;
        }
      }
    }
    for (const result of search.attempts.values()) {
      if (!result.okay || result.width > best.width || result.height > best.height
        || wordCuts(result, options.charset) > wordCuts(best, options.charset)
        || readability(result)[0]! > readability(best)[0]!) continue;
      if (compareScore([wordCuts(result, options.charset), ...readability(result)], [wordCuts(best, options.charset), ...readability(best)]) < 0
        && !dropsEdgeLabel(result, options)) best = result;
    }
    const tail = glyphDiagramFoldTail(best, options);
    best = glyphDiagramStraightenPorts(tail, options);
    return search.ledger.length ? { ...best, layout: { ...best.layout, ledger: [...best.layout.ledger, ...search.ledger] } } : best;
  }
}

async function fitOnce(graph: GlyphGraph, options: GlyphDiagramFitOptions, search: FitSearch, initialOnly = false): Promise<GlyphDiagramAttempt> {
  const work = options[GLYPH_DIAGRAM_WORK];
  const attempt = (candidate: Candidate, width: number, height: number, stopOnFailure = false): GlyphDiagramAttempt => {
    // Identical BK alignments share centered routes, including unsuccessful
    // probes. Wrap text and loop geometry are part of the identity.
    const key = JSON.stringify([candidate.raw, width, height, stopOnFailure]);
    const known = search.attempts.get(key);
    if (known) return { ...known, adjusted: candidate.adjusted };
    if (stopOnFailure) search.work.expansionRoutes++;
    work?.check();
    const result = routeAttempt(candidate, width, height, stopOnFailure, work);
    search.attempts.set(key, result);
    return result;
  };
  const layout = async (graph: GlyphGraph | GlyphDiagramReservedGraph, opts: GlyphDiagramLayoutOptions) => {
    const align = (opts as GlyphDiagramLayoutOptions & { [GLYPH_DIAGRAM_DAGRE_ALIGN]?: string })[GLYPH_DIAGRAM_DAGRE_ALIGN];
    // With one node, BK can only translate it; normalization removes that.
    const key = JSON.stringify([graph, opts, opts[GLYPH_DIAGRAM_EDGE_LABEL_ROOM], graph.nodes.length === 1 ? undefined : align]);
    const known = search.layouts.get(key);
    if (known) return known;
    work?.layout(graph);
    const result = await layoutGlyphGraph(graph, opts);
    search.layouts.set(key, result);
    return result;
  };
  const { width, height } = options;
  const direction = options.direction ?? graph.direction;
  const directions = options.autoDirection ? [direction, perpendicular[direction]] : [direction];
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
  const longest = Math.max(1, ...graph.nodes.flatMap(node => node.label.split(/\r?\n/).map(line => glyphDiagramText(line, options.charset).length)));
  const labelWidth = options.labelWidth ?? longest;
  // Keep validation at the public layout boundary, including explicit values
  // that an already-impossible viewport would otherwise prune before layout.
  const initial: Candidate = { raw: await layout(graph, { ...options, direction, labelWidth }), adjusted: false, nodesep, ranksep, margin };
  const first = attempt(initial, work?.terminal && options.overflow === "expand" ? Math.max(width, initial.raw.width) : width,
    work?.terminal && options.overflow === "expand" ? Math.max(height, initial.raw.height) : height);
  if (first.okay || initialOnly || (work?.terminal && first.fits)) return first;

  const floor = glyphDiagramCompactionFloor(graph);
  const candidates: Candidate[] = [initial];
  // A loop's label wraps too, whole words only, widest first: each distinct break of every loop label is a width to try. All the
  // loops on one node stack beside (or under) it, so what a break needs is the combined footprint of the node's loops.
  const fold = (label: string) => label.split(/\r?\n/).map(line => glyphDiagramText(line, options.charset)).join("\n");
  const loopHosts = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.from === edge.to) loopHosts.set(edge.from, [...(loopHosts.get(edge.from) ?? []), edge.label?.trim() ? fold(edge.label) : ""]);
  const loopLabels = [...loopHosts.values()].flat().filter(label => label);
  const stackRows = (k: number) => Math.max(3, k + 1), stackCols = (cols: number) => cols > 0 ? cols + 4 : 3;
  /** The cells a node's stacked loops need: across a top-down node, `rows` down its side and `cols` of its widest label; under a left-to-right one, `cols` along its bottom to the last label's end and `rows` of its tallest label. */
  const footprint = (across: boolean, loops: readonly (readonly string[])[]) => {
    const ks = loops.map(lines => lines.length), ls = loops.map(lines => Math.max(0, ...lines.map(line => line.length)));
    // The last loop's label reaches furthest, and any of them may be last: the least it can need is a lower bound.
    const rows = across ? Math.min(...ks.map((k, j) => 1 + ks.reduce((sum, other, i) => i === j ? sum : sum + stackRows(other), 0) + Math.max(k, 3))) : Math.max(...ks);
    const cols = across ? Math.max(...ls) : Math.min(...ls.map((l, j) => 1 + ls.reduce((sum, other, i) => i === j ? sum : sum + stackCols(other), 0) + 2 + l));
    return { rows, cols };
  };
  const loopBreaks: { readonly w: number; readonly hosts: (readonly string[])[][] }[] = [];
  {
    const widest = Math.min(options.loopLabelWidth ?? GLYPH_DIAGRAM_LOOP_LABEL_MAX, Math.max(1, ...loopLabels.flatMap(label => label.split("\n").map(line => line.length))));
    const word = Math.max(1, ...loopLabels.flatMap(label => glyphDiagramWords(label).map(part => part.length)));
    const seen = new Set<string>();
    for (let w = widest; w >= Math.min(widest, word); w--) {
      const hosts = [...loopHosts.values()].map(labels => labels.map(label => label ? glyphDiagramWrap(label, w) : []));
      const key = JSON.stringify(hosts);
      if (!seen.has(key)) { seen.add(key); loopBreaks.push({ w, hosts }); }
    }
  }
  // Every label wrap is searched against every loop wrap. Only breaks that could fit the canvas in this direction are searched
  // (beside a node a label needs its width plus the node and the loop, below one its rows plus the node's; rows are free when the
  // canvas may grow), and when none could, three spread across all of them, so a growing canvas still has something to grow from.
  // The snake and the layout search take the same list.
  const loopWrapsCache = new Map<string, number[]>();
  const loopWrapsFor = (dir: GlyphGraph["direction"]): number[] => {
    const known = loopWrapsCache.get(dir);
    if (known) return known;
    const across = dir === "TB" || dir === "BT";
    const possible = loopBreaks.filter(({ hosts }) => hosts.every(loops => {
      const { rows, cols } = footprint(across, loops);
      const rowsFit = options.overflow === "expand" || (across ? rows <= height : rows <= height - 4);
      return rowsFit && (across ? cols <= width - 8 : cols <= width - 1);
    }));
    const pool = possible.length ? possible : loopBreaks;
    const few3 = (list: typeof pool) => list.length > MAX_LOOP_WRAPS ? [list[0]!, list[Math.floor(list.length / 2)]!, list[list.length - 1]!] : list;
    const widths = (possible.length ? pool : few3(pool)).map(({ w }) => w);
    loopWrapsCache.set(dir, widths);
    return widths;
  };
  // A loop and its label take rows of the gap below their node, and the edge wrapping to the next row turns in what is left.
  const loopRows = loopLabels.length || graph.edges.some(edge => edge.from === edge.to) ? 2 : 0;
  // Every distinct measurable wrap is considered. The upper bound comes from
  // authored text and the available cells, not a list of preferred resolutions.
  function* measurements() {
    const seenMeasurements = new Set<string>();
    for (let wrap = Math.min(labelWidth, Math.max(1, width - 4)); wrap >= 1; wrap--) {
      work?.take("probes");
      for (const dir of directions) for (const loopLabelWidth of loopWrapsFor(dir)) {
        const reserved = reserveGlyphGraphPorts(measureGlyphGraph(graph, { ...options, direction: dir, labelWidth: wrap, loopLabelWidth }));
        const key = JSON.stringify([dir, reserved.nodes.map(node => [node.width, node.height]), reserved.loops.map(loop => loop.lines)]);
        if (seenMeasurements.has(key)) continue;
        seenMeasurements.add(key);
        if (options.overflow !== "expand" && !minimumFootprintFits(reserved, width, height)) continue;
        yield { reserved, wrap };
      }
    }
  }
  // Terminal panels stop measuring as soon as a wrap fits; the full search
  // replays the same measurements across spacing, direction and word passes.
  const measured = work?.terminal ? measurements() : [...measurements()];

  const seenLayouts = new Set<string>();
  const geometryKey = (raw: GlyphDiagramLayout) => JSON.stringify([raw.direction, raw.width, raw.height,
    raw.nodes.map(node => [node.id, node.x0, node.y0, node.x1, node.y1]),
    raw.ports.map(port => [port.edgeId, port.end, port.side, port.anchor, port.escape])]);
  seenLayouts.add(geometryKey(initial.raw));
  const layoutInputs = new Set<string>();
  const place = async (reserved: GlyphDiagramReservedGraph, ns: number, rs: number, pad: number) => {
    // The two spacing axes converge on the same candidates through different
    // parents. Deduplicate before Dagre, not only after it has done the work.
    const key = JSON.stringify([reserved.direction, reserved.nodes.map(node => [node.width, node.height]), reserved.loops.map(loop => loop.lines), ns, rs, pad]);
    if (layoutInputs.has(key)) return;
    layoutInputs.add(key);
    const raw = await layout(reserved, { ...options, nodesep: ns, ranksep: rs, margin: pad });
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
    return result.okay || (work?.terminal && result.fits) ? result : undefined;
  };
  const compact: Array<readonly [number, number]> = [];
  if (work?.terminal) {
    // Edge panels need wrapping and the compaction floor, not another spacing
    // search. At most two gaps per distinct wrap fit in the reserved work.
    compact.push([nodesep, ranksep], [Math.min(nodesep, floor), Math.min(ranksep, floor)]);
  } else for (let ns = nodesep; ns >= Math.min(nodesep, floor); ns--) {
    for (let rs = ranksep; rs >= Math.min(ranksep, floor); rs--) compact.push([ns, rs]);
  }
  compact.sort((a, b) => (nodesep - a[0]) + (ranksep - a[1]) - (nodesep - b[0]) - (ranksep - b[1]));
  // A wrap narrower than the longest word cuts words mid-letter ("Deplo"/"y"),
  // so whole-word wraps go first, then the snake, and cut words only last.
  const longestWord = Math.max(1, ...graph.nodes.flatMap(node => glyphDiagramText(node.label, options.charset).split(/\s+/).map(word => word.length)));
  const longestPiece = Math.max(1, ...graph.nodes.flatMap(node => glyphDiagramWords(glyphDiagramText(node.label, options.charset)).map(word => word.length)));
  const tryMeasured = async (keep: (wrap: number) => boolean, only?: GlyphGraph["direction"]) => {
    for (const { reserved, wrap } of measured) {
      if (!keep(wrap) || (only && reserved.direction !== only)) continue;
      for (const [ns, rs] of compact) for (const pad of margins) {
        const result = await tryLayout(reserved, ns, rs, pad);
        if (result) return result;
      }
    }
  };
  if (work?.terminal) {
    // A terminal panel gets one routing probe, after bounded geometry-only
    // wrapping. An oversized unwrapped label is not evidence it cannot fit.
    return await tryMeasured(() => true) ?? first;
  }
  // The snake is a whole-word LR layout. Snakes taller than the budget still
  // count when the canvas may grow, so they are returned for the expand pass.
  const snakePass = (wordFloor = longestWord): Promise<SnakeSearch> => {
    const known = search.snakes.get(wordFloor);
    if (known) return Promise.resolve(known);
    return searchSnake(wordFloor).then(result => { search.snakes.set(wordFloor, result); return result; });
  };
  const searchSnake = async (wordFloor: number): Promise<SnakeSearch> => {
    const flowEdges = graph.edges.filter(edge => edge.from !== edge.to).length;
    // Port growth compares connections against one another on every snake probe.
    const snakeLayout: typeof glyphDiagramSnakeLayout = (...args) => { work?.take("probes", Math.max(1, flowEdges ** 2)); return glyphDiagramSnakeLayout(...args); };
    const tallSnakes: Candidate[] = [];
    for (let wrap = Math.min(labelWidth, Math.max(1, width - 4)); wrap >= Math.max(1, Math.min(wordFloor, width - 4)); wrap--) {
      for (const loopLabelWidth of loopWrapsFor("LR")) {
      const lr = measureGlyphGraph(graph, { ...options, direction: "LR", labelWidth: wrap, loopLabelWidth });
      for (const [, rs] of compact) {
        // A few tall snakes are all the expand pass needs, but a later candidate may still fit the requested height, so the search
        // goes on; routing is only spent on one whose rows could fit even with every gap at a single row.
        if (tallSnakes.length >= MAX_TALL_SNAKES && !((snakeLayout(lr, { width, gap: rs, margin, branchGap: 1, rowGap: 1 })?.height ?? Infinity) <= height)) continue;
        const snake = (rowGap: readonly number[], branchGap: readonly number[]) => {
          const raw = snakeLayout(lr, { width, gap: rs, margin, branchGap, rowGap });
          if (!raw || raw.width > width || !glyphDiagramHasRoutingClearance(raw)) return undefined;
          const candidate = { raw, adjusted: true, nodesep, ranksep: rs, margin };
          const result = attempt(candidate, width, Math.max(height, raw.height));
          return result.okay && !dropsEdgeLabel(result, options) ? { candidate, result } : undefined;
        };
        // The shortest uniform gaps that route, then each gap shrunk on its
        // own: one turning edge must not pad every other gap to its size.
        type Found = { readonly candidate: Candidate; readonly result: GlyphDiagramAttempt; readonly rowGaps: number[]; readonly branchGaps: number[] };
        // A graph with nothing hanging under its main path has no use for the branch gap, so only one value of it is searched.
        const branchless = (() => {
          const at = (b: number) => snakeLayout(lr, { width, gap: rs, margin, branchGap: b, rowGap: 3 })?.nodes.map(n => [n.x0, n.y0]);
          return JSON.stringify(at(3)) === JSON.stringify(at(4));
        })();
        // The first uniform gaps, from `floor` up, that route: more cannot make a snake shorter.
        const firstRouted = (floor: number): Found | undefined => {
          for (const [r, b] of snakeGaps(graph.edges.length, floor)) {
            if (branchless && b !== floor) continue;
            const rows = snakeLayout(lr, { width, gap: rs, margin, branchGap: b, rowGap: r })?.ledger.find(e => e.code === "layout-wrapped")?.detail?.rows as number | undefined;
            if (rows === undefined) continue;
            const here = snake(Array(rows).fill(r), Array(rows).fill(b));
            if (here) return { ...here, rowGaps: Array(rows).fill(r), branchGaps: Array(rows).fill(b) };
          }
        };
        // Gaps roomy enough for a loop's rows and the turn after them come first; the bare minimum is the fallback when those make the layout too tall.
        let found = loopRows ? firstRouted(3 + loopRows) : undefined;
        if (!found || found.candidate.raw.height > height) {
          const bare = firstRouted(3);
          if (bare && (!found || bare.candidate.raw.height <= height)) found = bare;
        }
        const rowGaps = found?.rowGaps ?? [], branchGaps = found?.branchGaps ?? [];
        if (!found) continue;
        let best: { readonly candidate: Candidate; readonly result: GlyphDiagramAttempt } = found;
        for (const gaps of branchless ? [rowGaps] : [rowGaps, branchGaps]) for (let i = 0; i < gaps.length; i++) {
          for (let g = 1; g < gaps[i]!; g++) {
            const trial = [...gaps]; trial[i] = g;
            const tighter = gaps === rowGaps ? snake(trial, branchGaps) : snake(rowGaps, trial);
            if (!tighter) continue;
            const [cells, bends] = routeShape(tighter.result), [beforeCells, beforeBends] = routeShape(best.result);
            if (cells <= beforeCells && bends <= beforeBends) { gaps[i] = g; best = tighter; break; }
          }
        }
        if (best.candidate.raw.height <= height) return { fit: best.result, tall: tallSnakes };
        if (options.overflow === "expand") tallSnakes.push(best.candidate);
      }
      }
    }
    return { tall: tallSnakes };
  };
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
  // Prefer authored whole-word geometry; wide horizontal layouts get bounded
  // vertical probes before expensive repair: whole-word wraps, the snake (LR only), in-viewport
  // repair, then (when the canvas may grow) a taller layout at the same width.
  // A WIDER one does not beat cutting words in the other direction: widening
  // is the last resort below.
  for (const dir of directions) {
    const whole = await tryMeasured(wrap => wrap >= longestWord, dir);
    if (whole) return whole;
    // Exhaustive repair of an overflowing direction can spend its budget on
    // equivalent blocked corridors. Try the same bounded whole-word alignment
    // probes in the other direction before snakes and spacing repair.
    if (initial.raw.width > width && dir === direction && (dir === "LR" || dir === "RL") && options.autoDirection && options.overflow === "expand" && !graph.groups?.length && !initial.raw.ports.some(port => port.side === "n" || port.side === "s")) {
      const widths = [...new Set(graph.nodes.flatMap(node => glyphDiagramWords(glyphDiagramFoldLabel(node.label, options.charset))
        .map(word => Math.min(word.length, labelWidth))))].sort((a, b) => b - a).slice(0, 2);
      for (const align of GLYPH_DIAGRAM_DAGRE_ALIGNMENTS.slice(0, 2).reverse()) for (const labelWidth of widths) {
        const reserved = reserveGlyphGraphPorts(measureGlyphGraph(graph, { ...options, direction: perpendicular[direction], labelWidth }));
        const raw = await layout(reserved, { ...options, margin, [GLYPH_DIAGRAM_DAGRE_ALIGN]: align } as GlyphDiagramLayoutOptions);
        if (raw.width > width || !glyphDiagramHasRoutingClearance(raw)) continue;
        const result = widenRanks(attempt({ raw, adjusted: true, nodesep, ranksep, margin }, width, Math.max(height, raw.height), true), options);
        if (result.okay && !cutsWords(result, options.charset) && readability(result)[0] === 0 && !dropsEdgeLabel(result, options)) return result;
      }
    }

    const snake = dir === "LR" ? await snakePass() : { tall: [] as Candidate[] };
    if (snake.fit) return snake.fit;
    const pool = candidates.filter(candidate => candidate.raw.direction === dir);
    const repairedWhole = await repairWithin(pool);
    if (repairedWhole) return repairedWhole;
    if (options.overflow === "expand") {
      const best = await expand([...candidates.filter(candidate => candidate.raw.direction === dir), ...snake.tall], width);
      if (best) return best;
    }
    // An ordinary whole-word fit needs no extra punctuation candidates.
    // Otherwise punctuation breaks get the same opportunities before any
    // letter is cut, including the snake and a taller canvas.
    if (longestPiece < longestWord) {
      const start = candidates.length;
      const pieces = await tryMeasured(wrap => wrap >= longestPiece && wrap < longestWord, dir);
      if (pieces) return pieces;
      const snake = dir === "LR" ? await snakePass(longestPiece) : { tall: [] as Candidate[] };
      if (snake.fit) return snake.fit;
      const pool = candidates.slice(start);
      const repaired = await repairWithin(pool);
      if (repaired) return repaired;
      if (options.overflow === "expand") {
        const best = await expand([...pool, ...snake.tall], width);
        if (best) return best;
      }
    }
  }
  if (options.cutWords === false) return first;
  const wholeCount = candidates.length;
  for (const dir of directions) {
    const cut = await tryMeasured(wrap => wrap < longestPiece, dir);
    if (cut) return cut;
    const pool = candidates.slice(wholeCount).filter(candidate => candidate.raw.direction === dir);
    const repairedCut = await repairWithin(pool);
    if (repairedCut) return repairedCut;
    if (options.overflow === "expand") {
      const best = await expand(pool, width);
      if (best) return best;
    }
  }
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
    maxCols = Math.min(maxCols, search.maxWidth ?? Infinity);
    const maxRows = search.maxHeight ?? Infinity;
    const eligible = (candidate: Candidate) => candidate.raw.width <= maxCols && candidate.raw.height <= maxRows;
    const candidates = pool.filter(eligible);
    let best: GlyphDiagramAttempt | undefined;
    const probed: Candidate[] = [];
    const smallest = new Map<Candidate, GlyphDiagramAttempt>();
    // Repair internal spacing before spending routing work on exterior gutters.
    // A bounded probe prevents an impossible tight canvas from exhausting every gap.
    for (let probes = 0; candidates.length && probes < MAX_EXPAND_PROBES && search.work.expansionRoutes < MAX_EXPAND_ROUTING; probes++) {
      candidates.sort((a, b) => compare(lowerBound(a), lowerBound(b)));
      const candidate = candidates.shift()!;
      if (best && compare(lowerBound(candidate), cost(best.width, best.height)) >= 0) {
        candidates.unshift(candidate);
        break;
      }
      probed.push(candidate);
      if (glyphDiagramHasRoutingClearance(candidate.raw)) {
        const result = attempt(candidate, Math.max(width, candidate.raw.width), Math.max(height, candidate.raw.height), true);
        smallest.set(candidate, result);
        if (result.okay) best = result;
      }
      candidates.push(...(await repair(candidate)).filter(eligible));
    }
    if (probed.length === MAX_EXPAND_PROBES && candidates.length) search.ledger.push({
      code: "fit-search-limited", message: "Stopped expansion spacing search at its deterministic work limit.",
      detail: { stage: "expansion-spacing", candidateLimit: MAX_EXPAND_PROBES },
    });
    // A spacing fit is only an upper bound: an earlier candidate can route with
    // a cheaper exterior gutter. Replay in search order, including equal-cost
    // alternatives, so the spacing probe cannot change the accepted tie.
    const spacingBest = best;
    best = undefined;
    candidates.unshift(...probed);
    let routeProbes = 0, replayProbes = 0;
    while (candidates.length && routeProbes < MAX_GUTTER_PROBES && replayProbes < MAX_EXPAND_PROBES && search.work.expansionRoutes < MAX_EXPAND_ROUTING) {
      replayProbes++;
      candidates.sort((a, b) => compare(lowerBound(a), lowerBound(b)));
      const candidate = candidates.shift()!;
      if (best && compare(lowerBound(candidate), cost(best.width, best.height)) >= 0) break;
      let previousWidth = 0, previousHeight = 0;
      // Bounds include routing space, not just node boxes. Centering is exactly
      // the same for this probe and the final paint, so an accepted route is reused.
      const hasClearance = glyphDiagramHasRoutingClearance(candidate.raw);
      for (let gutter = 0; hasClearance && gutter <= clearance * 2 && routeProbes < MAX_GUTTER_PROBES && search.work.expansionRoutes < MAX_EXPAND_ROUTING; gutter++) {
        const cols = Math.min(maxCols, Math.max(width, candidate.raw.width + gutter)), rows = Math.max(height, candidate.raw.height + gutter);
        if (rows > maxRows) break;
        if (cols === previousWidth && rows === previousHeight) continue;
        previousWidth = cols; previousHeight = rows;
        if (best && compare(cost(cols, rows), cost(best.width, best.height)) >= 0) break;
        if (spacingBest && compare(cost(cols, rows), cost(spacingBest.width, spacingBest.height)) > 0) break;
        const cached = smallest.get(candidate);
        routeProbes++;
        const result = cached?.width === cols && cached.height === rows ? cached : attempt(candidate, cols, rows, true);
        if (result.okay) { best = result; break; }
      }
      candidates.push(...(await repair(candidate)).filter(eligible));
    }
    if (routeProbes === MAX_GUTTER_PROBES || (candidates.length && replayProbes === MAX_EXPAND_PROBES) || search.work.expansionRoutes === MAX_EXPAND_ROUTING) {
      search.ledger.push({ code: "fit-search-limited", message: "Stopped expansion gutter search at its deterministic work limit.",
        detail: { stage: "expansion-gutters", routeLimit: MAX_GUTTER_PROBES, candidateLimit: MAX_EXPAND_PROBES, totalRouteLimit: MAX_EXPAND_ROUTING } });
    }
    return best ?? spacingBest;
  }
}
