import type { GlyphCanvasPoint } from "glyphcss";
import { glyphDiagramError } from "./validate";
import { GLYPH_DIAGRAM_DIRECTIONS, type GlyphDiagramEdge, type GlyphDiagramLayout, type GlyphDiagramRect } from "./pipeline";
import { ledgerUnroutable, type GlyphDiagramLedgerEntry } from "./ledger";

export const GLYPH_DIAGRAM_ROUTE_COSTS = Object.freeze({ bend: 4, crossing: 12 });
export interface GlyphDiagramRoute { readonly edge: GlyphDiagramEdge; readonly cells: readonly GlyphCanvasPoint[] }
export interface GlyphDiagramRoutingOptions { readonly width?: number; readonly height?: number; readonly bendCost?: number; readonly crossingCost?: number; readonly obstacles?: readonly GlyphDiagramRect[] }
export interface GlyphDiagramRoutingResult { readonly routes: readonly GlyphDiagramRoute[]; readonly unroutable: readonly string[]; readonly ledger: readonly GlyphDiagramLedgerEntry[] }
const steps = [GLYPH_DIAGRAM_DIRECTIONS.n, GLYPH_DIAGRAM_DIRECTIONS.e, GLYPH_DIAGRAM_DIRECTIONS.s, GLYPH_DIAGRAM_DIRECTIONS.w];
const key = (p: GlyphCanvasPoint) => `${p.x},${p.y}`;
const same = (a: GlyphCanvasPoint, b: GlyphCanvasPoint) => a.x === b.x && a.y === b.y;
const inside = (p: GlyphCanvasPoint, r: GlyphDiagramRect, ring = 0) => p.x >= r.x0 - ring && p.x <= r.x1 + ring && p.y >= r.y0 - ring && p.y <= r.y1 + ring;
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
  if ([options.bendCost, options.crossingCost].some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))) glyphDiagramError("bad-options", "Routing costs must be finite nonnegative numbers.");
  const used = new Map<string, { axis: number; point: GlyphCanvasPoint }>();
  const routes: GlyphDiagramRoute[] = [], unroutable: string[] = [], ledger: GlyphDiagramLedgerEntry[] = [];
  const ports = new Map(layout.edges.map((e) => [e.id, layout.ports.filter((p) => p.edgeId === e.id)]));
  const ordered = [...layout.edges].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const edge of ordered) {
    const from = ports.get(edge.id)!.find((p) => p.end === "from")!;
    const to = ports.get(edge.id)!.find((p) => p.end === "to")!;
    const start = from.escape, goal = to.escape;
    const outward = GLYPH_DIAGRAM_DIRECTIONS[from.side], inward = GLYPH_DIAGRAM_DIRECTIONS[to.side];
    const startDir = steps.findIndex((s) => same(s, outward));
    const endDir = steps.findIndex((s) => s.x === -inward.x && s.y === -inward.y);
    const otherLanes = layout.ports.filter((p) => p.edgeId !== edge.id).flatMap((port) => {
      const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
      return [port.escape, { x: port.escape.x + delta.x, y: port.escape.y + delta.y }];
    });
    const isFree = (p: GlyphCanvasPoint, dir: number, previous?: State): boolean => {
      if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows) return false;
      // Node rectangles are the owning obstacle; no downstream painter may conceal a transit through one.
      if (layout.nodes.some((n) => inside(p, n))) return false;
      if ((options.obstacles ?? []).some((r) => inside(p, r))) return false;
      if (!same(p, start) && !same(p, goal) && layout.nodes.some((n) => inside(p, n, 1))) return false;
      // Every port keeps its outward lane, including a perpendicular cell of clearance from its neighbour.
      if (otherLanes.some((lane) => Math.abs(p.x - lane.x) + Math.abs(p.y - lane.y) <= 1)) return false;
      const axis = dir % 2;
      const crossing = used.get(key(p));
      if (crossing && (crossing.axis === axis || crossing.axis === 2 || (previous && previous.dir !== dir))) return false;
      if (previous && used.has(key(previous)) && previous.dir !== dir) return false;
      for (const step of steps) {
        const neighbour = used.get(key({ x: p.x + step.x, y: p.y + step.y }));
        if (!neighbour) continue;
        // Perpendicular transits may cross; coincident or adjacent parallel runs may never merge visually.
        if (neighbour.axis === 2 || neighbour.axis === axis) return false;
      }
      return true;
    };
    const queue = new Queue(), best = new Map<string, number>();
    let order = 0, found: State | undefined;
    const initial: State = { ...start, dir: startDir, cost: 0, estimate: Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y), order: order++ };
    if (isFree(start, startDir) && isFree(goal, endDir)) { queue.push(initial); best.set(`${key(initial)},${startDir}`, 0); }
    let current: State | undefined;
    while ((current = queue.pop())) {
      if (current.cost !== best.get(`${key(current)},${current.dir}`)) continue;
      if (same(current, goal) && current.dir === endDir) { found = current; break; }
      for (let dir = 0; dir < steps.length; dir++) {
        if ((dir + 2) % 4 === current.dir || (!current.parent && dir !== startDir)) continue;
        const p = { x: current.x + steps[dir]!.x, y: current.y + steps[dir]!.y };
        if (same(p, goal) && dir !== endDir) continue;
        if (!isFree(p, dir, current)) continue;
        const cost = current.cost + 1 + (dir === current.dir ? 0 : options.bendCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.bend) + (used.has(key(p)) ? options.crossingCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.crossing : 0);
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
