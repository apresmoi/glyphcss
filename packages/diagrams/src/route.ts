import type { GlyphCanvasPoint } from "glyphcss";
import { glyphDiagramError } from "./validate";
import { GLYPH_DIAGRAM_DIRECTIONS, glyphDiagramGroupRect, type GlyphDiagramEdge, type GlyphDiagramLayout, type GlyphDiagramRect } from "./pipeline";
import { ledgerUnroutable, type GlyphDiagramLedgerEntry } from "./ledger";

const PORT_LANE_LENGTH = 2;
const PORT_LANE_CLEARANCE = 1;
const NODE_CLEARANCE = 1;
// Two opposing protected lanes leave one free corridor cell between them.
export const GLYPH_DIAGRAM_ROUTE_SEPARATION = 2 * (PORT_LANE_LENGTH + PORT_LANE_CLEARANCE) + 1;
export const GLYPH_DIAGRAM_ROUTE_COSTS = Object.freeze({ bend: 4, crossing: 12, ringParallel: 4000 });
/**
 * Width, in cells, of the band around a group's rendered dot ring where a
 * route running PARALLEL to the boundary is charged `ringParallel` — the
 * ring's own perimeter cells (`inside(p, r, 0)`, previously treated as
 * unpenalised "inside" so a crossing edge could enter freely) AND the one
 * cell strictly outside it, never a cell strictly inside (that stays
 * ordinary open interior, the corridor `GLYPH_DIAGRAM_GROUP_PAD` leaves
 * between the ring and an inset member). USER FEEDBACK, verbatim: "some of
 * the lines that are dotted are hard to understand on what is the
 * direction... probably if we have a block that is dotted we need some
 * padding around them" — followed up, after a small SOFT cost (previously
 * `GLYPH_DIAGRAM_ROUTE_COSTS.groupClearance`, `4`, the same as one bend)
 * still let a router take a free-ish shortcut straight along a group's own
 * bottom edge (`inside(p, r, 0)` charged nothing at all, by design, for a
 * crossing edge — but nothing there ever told "one cell of crossing" apart
 * from "the whole width of the group, because it happened to be the
 * shortest lane"): "we need something else... or have explicit ways to not
 * overlap them EVER". A route may still CROSS this band — one cell,
 * perpendicular to the boundary, is exactly how an edge reaches a node
 * inside the group, and stays free — but running COLLINEAR with the
 * boundary through it now costs `ringParallel` (`4000`, in
 * `ringParallelBlockAxis` below): large enough that no detour reachable on
 * any shipped diagram ever costs more, so it is never PREFERRED, but finite
 * — a genuine hard block risked making an edge whose ONLY corridor happens
 * to graze a ring (a real, cramped fixture, not a hypothetical) unroutable
 * outright, which is a worse failure than one paid cell of ring contact.
 */
export const GLYPH_DIAGRAM_GROUP_CLEARANCE_RING = 1;
/**
 * The movement axis that runs PARALLEL to rect `r`'s own boundary at point
 * `p`, within `GLYPH_DIAGRAM_GROUP_CLEARANCE_RING` cells of it (the rect's
 * own perimeter line included, a cell strictly inside excluded — see the
 * doc above). `0` is north/south travel (hugging a LEFT/RIGHT edge), `1` is
 * east/west travel (hugging a TOP/BOTTOM edge), `2` is both — a corner
 * cell, where two edges meet and no straight direction through it is a
 * genuine perpendicular crossing of either one. `undefined` means `p` is
 * clear of this rect's guarded band entirely and every direction is
 * ordinary. The one movement always exempt at a `0`/`1` cell is the
 * PERPENDICULAR axis — a single hop straight through, into the interior or
 * back out — which is exactly a crossing, never a run.
 */
function ringParallelBlockAxis(p: GlyphCanvasPoint, r: GlyphDiagramRect): 0 | 1 | 2 | undefined {
  const ring = GLYPH_DIAGRAM_GROUP_CLEARANCE_RING;
  // "Near an edge" means on that edge's own line, or in the ring cells
  // OUTSIDE it — never a cell inside the rect (however close to the line),
  // which stays ordinary interior a route may cross however it likes.
  const nearLeftOrRight = (p.x <= r.x0 && p.x >= r.x0 - ring) || (p.x >= r.x1 && p.x <= r.x1 + ring);
  const nearTopOrBottom = (p.y <= r.y0 && p.y >= r.y0 - ring) || (p.y >= r.y1 && p.y <= r.y1 + ring);
  const nearVerticalEdge = nearLeftOrRight && p.y >= r.y0 - ring && p.y <= r.y1 + ring;
  const nearHorizontalEdge = nearTopOrBottom && p.x >= r.x0 - ring && p.x <= r.x1 + ring;
  if (nearHorizontalEdge && nearVerticalEdge) return 2;
  if (nearHorizontalEdge) return 1;
  if (nearVerticalEdge) return 0;
  return undefined;
}
export interface GlyphDiagramRoute { readonly edge: GlyphDiagramEdge; readonly cells: readonly GlyphCanvasPoint[] }
export interface GlyphDiagramRoutingOptions { readonly width?: number; readonly height?: number; readonly bendCost?: number; readonly crossingCost?: number; readonly ringParallelCost?: number; readonly obstacles?: readonly GlyphDiagramRect[] }
export interface GlyphDiagramRoutingResult { readonly routes: readonly GlyphDiagramRoute[]; readonly unroutable: readonly string[]; readonly ledger: readonly GlyphDiagramLedgerEntry[] }
const steps = [GLYPH_DIAGRAM_DIRECTIONS.n, GLYPH_DIAGRAM_DIRECTIONS.e, GLYPH_DIAGRAM_DIRECTIONS.s, GLYPH_DIAGRAM_DIRECTIONS.w];
const key = (p: GlyphCanvasPoint) => `${p.x},${p.y}`;
const same = (a: GlyphCanvasPoint, b: GlyphCanvasPoint) => a.x === b.x && a.y === b.y;
const inside = (p: GlyphCanvasPoint, r: GlyphDiagramRect, ring = 0) => p.x >= r.x0 - ring && p.x <= r.x1 + ring && p.y >= r.y0 - ring && p.y <= r.y1 + ring;
function otherPortLanes(layout: GlyphDiagramLayout, edgeId: string): GlyphCanvasPoint[] {
  return layout.ports.filter(port => port.edgeId !== edgeId).flatMap(port => {
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    return Array.from({ length: PORT_LANE_LENGTH }, (_, offset) => ({ x: port.escape.x + offset * delta.x, y: port.escape.y + offset * delta.y }));
  });
}
function blockedByNodes(p: GlyphCanvasPoint, layout: GlyphDiagramLayout, start: GlyphCanvasPoint, goal: GlyphCanvasPoint): boolean {
  return layout.nodes.some(node => inside(p, node))
    || (!same(p, start) && !same(p, goal) && layout.nodes.some(node => inside(p, node, NODE_CLEARANCE)));
}
function blockedByPortLanes(p: GlyphCanvasPoint, lanes: readonly GlyphCanvasPoint[]): boolean {
  return lanes.some(lane => Math.abs(p.x - lane.x) + Math.abs(p.y - lane.y) <= PORT_LANE_CLEARANCE);
}
/** Reject blocked mandatory port steps; a passing layout can still need route search. */
export function glyphDiagramHasRoutingClearance(layout: GlyphDiagramLayout): boolean {
  for (const edge of layout.edges) {
    const ports = layout.ports.filter(port => port.edgeId === edge.id);
    const from = ports.find(port => port.end === "from")!;
    const to = ports.find(port => port.end === "to")!;
    const lanes = otherPortLanes(layout, edge.id);
    for (const port of [from, to]) {
      const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
      for (let offset = 0; offset < (same(from.escape, to.escape) ? 1 : PORT_LANE_LENGTH); offset++) {
        const point = { x: port.escape.x + offset * delta.x, y: port.escape.y + offset * delta.y };
        if (blockedByNodes(point, layout, from.escape, to.escape) || blockedByPortLanes(point, lanes)) return false;
      }
    }
  }
  return true;
}
interface State { x: number; y: number; dir: number; cost: number; estimate: number; order: number; parent?: State }
class Queue {
  private items: State[] = [];
  private before(a: State, b: State) { return a.estimate < b.estimate || (a.estimate === b.estimate && a.order < b.order); }
  push(state: State) { let i = this.items.length; this.items.push(state); while (i > 0) { const p = (i - 1) >> 1; if (!this.before(state, this.items[p]!)) break; this.items[i] = this.items[p]!; i = p; } this.items[i] = state; }
  pop(): State | undefined { const root = this.items[0], last = this.items.pop(); if (!this.items.length) return root; let i = 0; while (true) { let child = i * 2 + 1; if (child >= this.items.length) break; if (child + 1 < this.items.length && this.before(this.items[child + 1]!, this.items[child]!)) child++; if (this.before(last!, this.items[child]!)) break; this.items[i] = this.items[child]!; i = child; } this.items[i] = last!; return root; }
}
/** Per-edge cell walks keep graph identity intact until the canvas resolves crossings. */
export function routeGlyphGraphEdges(layout: GlyphDiagramLayout, options: GlyphDiagramRoutingOptions = {}): GlyphDiagramRoutingResult {
  const cols = options.width ?? layout.width, rows = options.height ?? layout.height;
  if (![cols, rows].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "Routing bounds must be positive integers.");
  if ([options.bendCost, options.crossingCost, options.ringParallelCost].some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))) glyphDiagramError("bad-options", "Routing costs must be finite nonnegative numbers.");
  const used = new Map<string, { axis: number; point: GlyphCanvasPoint }>();
  const routes: GlyphDiagramRoute[] = [], unroutable: string[] = [], ledger: GlyphDiagramLedgerEntry[] = [];
  // Mirrors `paint.ts`'s own group-rect computation exactly (same helper),
  // so the ring this pays extra to cross is the same rectangle the painter
  // rings with dots.
  const groupRects = layout.groups
    .map((group) => glyphDiagramGroupRect(layout.nodes.filter((n) => group.members.includes(n.id)), { cols, rows }))
    .filter((r): r is GlyphDiagramRect => r !== undefined);
  // A direction whose axis matches ANY guarded rect's forbidden axis at `p`
  // pays `ringParallel` — see `GLYPH_DIAGRAM_ROUTE_COSTS`'s own doc for why
  // this is a cost, not a hard block, and why it is high enough to never be
  // preferred over a real detour.
  const ringParallelCost = (p: GlyphCanvasPoint, dir: number): number =>
    groupRects.some((r) => { const axis = ringParallelBlockAxis(p, r); return axis === 2 || axis === dir % 2; })
      ? options.ringParallelCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.ringParallel : 0;
  const ports = new Map(layout.edges.map((e) => [e.id, layout.ports.filter((p) => p.edgeId === e.id)]));
  const ordered = [...layout.edges].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const edge of ordered) {
    const from = ports.get(edge.id)!.find((p) => p.end === "from")!;
    const to = ports.get(edge.id)!.find((p) => p.end === "to")!;
    const start = from.escape, goal = to.escape;
    const outward = GLYPH_DIAGRAM_DIRECTIONS[from.side], inward = GLYPH_DIAGRAM_DIRECTIONS[to.side];
    const startDir = steps.findIndex((s) => same(s, outward));
    const endDir = steps.findIndex((s) => s.x === -inward.x && s.y === -inward.y);
    const otherLanes = otherPortLanes(layout, edge.id);
    // Obstacles and earlier routes stay fixed throughout this edge's A*.
    // Cache their cell/axis checks; only turning depends on the prior state.
    const freeCells = new Map<number, number>();
    const isFree = (p: GlyphCanvasPoint, dir: number, previous?: State): boolean => {
      if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows) return false;
      const axis = dir % 2;
      const cellKey = key(p);
      const crossing = used.get(cellKey);
      if (previous && previous.dir !== dir && (crossing || used.has(key(previous)))) return false;
      const cacheKey = p.y * cols + p.x;
      const cached = freeCells.get(cacheKey);
      if (cached !== undefined) return (cached & (1 << axis)) !== 0;
      let freeAxes = 0;
      if (!blockedByNodes(p, layout, start, goal)
        && !(options.obstacles ?? []).some(r => inside(p, r))
        && !blockedByPortLanes(p, otherLanes)) {
        freeAxes = 3;
        if (crossing) freeAxes &= crossing.axis === 2 ? 0 : ~(1 << crossing.axis);
        for (const step of steps) {
          const neighbour = used.get(key({ x: p.x + step.x, y: p.y + step.y }));
          if (neighbour) freeAxes &= neighbour.axis === 2 ? 0 : ~(1 << neighbour.axis);
        }
      }
      freeCells.set(cacheKey, freeAxes);
      return (freeAxes & (1 << axis)) !== 0;
    };
    const queue = new Queue(), best = new Map<string, number>();
    let order = 0, found: State | undefined;
    const startCost = ringParallelCost(start, startDir);
    const initial: State = { ...start, dir: startDir, cost: startCost, estimate: startCost + Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y), order: order++ };
    if (isFree(start, startDir) && isFree(goal, endDir)) { queue.push(initial); best.set(`${key(initial)},${startDir}`, startCost); }
    let current: State | undefined;
    while ((current = queue.pop())) {
      if (current.cost !== best.get(`${key(current)},${current.dir}`)) continue;
      if (same(current, goal) && current.dir === endDir) { found = current; break; }
      for (let dir = 0; dir < steps.length; dir++) {
        if ((dir + 2) % 4 === current.dir || (!current.parent && dir !== startDir)) continue;
        const p = { x: current.x + steps[dir]!.x, y: current.y + steps[dir]!.y };
        if (same(p, goal) && dir !== endDir) continue;
        if (!isFree(p, dir, current)) continue;
        const cost = current.cost + 1 + (dir === current.dir ? 0 : options.bendCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.bend) + (used.has(key(p)) ? options.crossingCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.crossing : 0) + ringParallelCost(p, dir);
        const stateKey = `${key(p)},${dir}`;
        if (cost >= (best.get(stateKey) ?? Infinity)) continue;
        best.set(stateKey, cost);
        queue.push({ ...p, dir, cost, estimate: cost + Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y), parent: current, order: order++ });
      }
    }
    if (!found) { unroutable.push(edge.id); ledger.push(ledgerUnroutable({ edgeId: edge.id, reason: `no path was found from "${edge.from}" to "${edge.to}"` })); continue; }
    const cells: GlyphCanvasPoint[] = [];
    for (let state: State | undefined = found; state; state = state.parent) cells.push({ x: state.x, y: state.y });
    cells.reverse();
    // Positive path costs normally remove loops; reject a revisited cell because the frozen canvas cannot represent it.
    if (new Set(cells.map(key)).size !== cells.length) { unroutable.push(edge.id); ledger.push(ledgerUnroutable({ edgeId: edge.id, reason: "its route would cross its own path" })); continue; }
    routes.push({ edge, cells });
    cells.forEach((point, i) => {
      const a = cells[Math.max(0, i - 1)]!, b = cells[Math.min(cells.length - 1, i + 1)]!;
      const axis = a.x === b.x ? 0 : a.y === b.y ? 1 : 2;
      used.set(key(point), { point, axis: used.has(key(point)) ? 2 : axis });
    });
  }
  return { routes, unroutable, ledger };
}
