import { GLYPH_DIAGRAM_EDGE_WAYPOINTS, GLYPH_MERMAID_STATE_REGION, type GlyphMermaidStateRegion } from "./layoutHints";
import type { GlyphCanvasPoint } from "glyphcss";
import { glyphDiagramError } from "./validate";
import { GLYPH_DIAGRAM_DIRECTIONS, glyphDiagramGroupRects, type GlyphDiagramEdge, type GlyphDiagramLayout, type GlyphDiagramRect } from "./pipeline";
import { ledgerUnroutable, type GlyphDiagramLedgerEntry } from "./ledger";
import { glyphDiagramLoopGeometry, type GlyphDiagramLoopGeometry } from "./loop";
import { GLYPH_DIAGRAM_WORK, type GlyphDiagramWork } from "./work";

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
export interface GlyphDiagramRoutingOptions { readonly width?: number; readonly height?: number; readonly bendCost?: number; readonly crossingCost?: number; readonly ringParallelCost?: number; readonly obstacles?: readonly GlyphDiagramRect[]; readonly stopOnFailure?: boolean }
export interface GlyphDiagramRoutingResult { readonly routes: readonly GlyphDiagramRoute[]; readonly unroutable: readonly string[]; readonly ledger: readonly GlyphDiagramLedgerEntry[] }
const steps = [GLYPH_DIAGRAM_DIRECTIONS.n, GLYPH_DIAGRAM_DIRECTIONS.e, GLYPH_DIAGRAM_DIRECTIONS.s, GLYPH_DIAGRAM_DIRECTIONS.w];
const key = (p: GlyphCanvasPoint) => `${p.x},${p.y}`;
const same = (a: GlyphCanvasPoint, b: GlyphCanvasPoint) => a.x === b.x && a.y === b.y;
const inside = (p: GlyphCanvasPoint, r: GlyphDiagramRect, ring = 0) => p.x >= r.x0 - ring && p.x <= r.x1 + ring && p.y >= r.y0 - ring && p.y <= r.y1 + ring;
function otherPortLanes(layout: GlyphDiagramLayout, edgeId: string): GlyphCanvasPoint[] {
  const own = layout.ports.filter(port => port.edgeId === edgeId);
  const siblings = new Set(layout.ports.filter(port => (port.trunk && own.some(p => p.trunk === port.trunk))
    || own.some(p => p.end === "from" && port.end === "from" && p.nodeId === port.nodeId && same(p.escape, port.escape))).map(port => port.edgeId));
  return layout.ports.filter(port => port.edgeId !== edgeId && !siblings.has(port.edgeId)).flatMap(port => {
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    return Array.from({ length: PORT_LANE_LENGTH }, (_, offset) => ({ x: port.escape.x + offset * delta.x, y: port.escape.y + offset * delta.y }));
  });
}
/** Every self-edge's cells and label room; a hand-built layout that never listed its loops gets label-less ones. */
function loopGeometries(layout: GlyphDiagramLayout): GlyphDiagramLoopGeometry[] {
  const loops = layout.edges.filter((edge) => edge.from === edge.to).map((edge) => layout.loops.find((loop) => loop.edgeId === edge.id) ?? { edgeId: edge.id, nodeId: edge.from, lines: [], labelWidth: 0 });
  return glyphDiagramLoopGeometry({ ports: layout.ports, loops });
}
const touches = (a: GlyphDiagramRect, b: GlyphDiagramRect, pad = 0) => a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.y0 - pad <= b.y1 && a.y1 + pad >= b.y0;
const cellRect = (p: GlyphCanvasPoint): GlyphDiagramRect => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
/** Whether two loops would touch: one's cells inside the other's label room, or the two labels or the two loops' cells meeting. */
function loopsConflict(a: GlyphDiagramLoopGeometry, b: GlyphDiagramLoopGeometry): boolean {
  return (a.label !== undefined && b.cells.some((p) => touches(a.label!, cellRect(p), 1)))
    || (b.label !== undefined && a.cells.some((p) => touches(b.label!, cellRect(p), 1)))
    || (a.label !== undefined && b.label !== undefined && touches(a.label, b.label, 1))
    || a.cells.some((p) => b.cells.some((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= 1));
}
function blockedByNodes(p: GlyphCanvasPoint, layout: GlyphDiagramLayout, start: GlyphCanvasPoint, goal: GlyphCanvasPoint): boolean {
  return layout.nodes.some(node => inside(p, node))
    || (!same(p, start) && !same(p, goal) && layout.nodes.some(node => inside(p, node, NODE_CLEARANCE)));
}
function blockedByPortLanes(p: GlyphCanvasPoint, lanes: readonly GlyphCanvasPoint[]): boolean {
  return lanes.some(lane => Math.abs(p.x - lane.x) + Math.abs(p.y - lane.y) <= PORT_LANE_CLEARANCE);
}
/**
 * Whether every self-loop has its four cells and its label's rows clear of
 * every node and every other loop. A loop is a fixed shape, so unlike a
 * routed edge a blocked one is known without searching.
 */
export function glyphDiagramLoopsClear(layout: GlyphDiagramLayout): boolean {
  const geometries = loopGeometries(layout);
  for (const mine of geometries) {
    const edge = layout.edges.find((e) => e.id === mine.loop.edgeId)!;
    const from = layout.ports.find((port) => port.edgeId === edge.id && port.end === "from")!, to = layout.ports.find((port) => port.edgeId === edge.id && port.end === "to")!;
    const lanes = otherPortLanes(layout, edge.id);
    if (mine.cells.some((point) => blockedByNodes(point, layout, from.escape, to.escape) || blockedByPortLanes(point, lanes))) return false;
    if (mine.label && layout.nodes.some((node) => touches(node, mine.label!, 1))) return false;
    if (geometries.some((other) => other !== mine && loopsConflict(mine, other))) return false;
  }
  return true;
}
/** Reject blocked mandatory port steps; a passing layout can still need route search. */
export function glyphDiagramHasRoutingClearance(layout: GlyphDiagramLayout): boolean {
  if (!glyphDiagramLoopsClear(layout)) return false;
  for (const edge of layout.edges) {
    if (edge.from === edge.to) continue;
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
  const work = (options as GlyphDiagramRoutingOptions & { [GLYPH_DIAGRAM_WORK]?: GlyphDiagramWork })[GLYPH_DIAGRAM_WORK];
  work?.route();
  const cols = options.width ?? layout.width, rows = options.height ?? layout.height;
  if (![cols, rows].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "Routing bounds must be positive integers.");
  if ([options.bendCost, options.crossingCost, options.ringParallelCost].some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))) glyphDiagramError("bad-options", "Routing costs must be finite nonnegative numbers.");
  const used = new Map<string, { axis: number; point: GlyphCanvasPoint; owners: Set<string> }>();
  const routes: GlyphDiagramRoute[] = [], unroutable: string[] = [], ledger: GlyphDiagramLedgerEntry[] = [];
  // Mirrors `paint.ts`'s own group-rect computation exactly (same helper),
  // so the ring this pays extra to cross is the same rectangle the painter
  // rings with dots.
  const groupRects = [...glyphDiagramGroupRects(layout, { cols, rows })].filter(([id]) => !(layout.groups.find(group => group.id === id) as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]).map(([, rect]) => rect);
  // A direction whose axis matches ANY guarded rect's forbidden axis at `p`
  // pays `ringParallel` — see `GLYPH_DIAGRAM_ROUTE_COSTS`'s own doc for why
  // this is a cost, not a hard block, and why it is high enough to never be
  // preferred over a real detour.
  const ringParallelCost = (p: GlyphCanvasPoint, dir: number): number =>
    groupRects.some((r) => { const axis = ringParallelBlockAxis(p, r); return axis === 2 || axis === dir % 2; })
      ? options.ringParallelCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.ringParallel : 0;
  const ports = new Map(layout.edges.map((e) => [e.id, layout.ports.filter((p) => p.edgeId === e.id)]));
  const trunkCounts = new Map<string, number>();
  for (const port of layout.ports) if (port.trunk) trunkCounts.set(port.trunk, (trunkCounts.get(port.trunk) ?? 0) + 1);
  const singletonBuses = new Set(layout.ports.filter(port => port.end === "from" && port.trunk && trunkCounts.get(port.trunk) === 1).map(port => port.edgeId));
  const sideJoins = new Set(layout.edges.filter(edge => ports.get(edge.id)!.every(port => port.side === "s")).map(edge => edge.id));
  // Forward branches claim their corridor before same-side joins; a singleton style claims its own bus first.
  const ordered = [...layout.edges].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    || Number(sideJoins.has(a.id)) - Number(sideJoins.has(b.id))
    || Number(singletonBuses.has(b.id)) - Number(singletonBuses.has(a.id))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A branch entering a farther border can fence off a nearer sibling's
  // group entry once committed. Reserve the nearer border first, retaining
  // the original slots among unrelated edges and equal-distance siblings.
  const entries = new Map<string, number[]>();
  const horizontal = layout.direction === "LR" || layout.direction === "RL";
  ordered.forEach((edge, index) => {
    const groups = layout.groups.filter(group => group.members.includes(edge.to) && !group.members.includes(edge.from)).map(group => group.id).sort();
    if (!groups.length) return;
    const family = JSON.stringify([edge.from, edge.priority ?? 0, groups]);
    entries.set(family, [...(entries.get(family) ?? []), index]);
  });
  const distance = (edge: GlyphDiagramEdge) => {
    const pair = ports.get(edge.id)!, from = pair.find(port => port.end === "from")!.escape, to = pair.find(port => port.end === "to")!.escape;
    return horizontal ? Math.abs(from.x - to.x) : Math.abs(from.y - to.y);
  };
  for (const indices of entries.values()) {
    if (indices.length < 2) continue;
    const family = indices.map(index => ordered[index]!).sort((a, b) => distance(a) - distance(b));
    indices.forEach((index, i) => { ordered[index] = family[i]!; });
  }
  // A loop's label room (and the blank cell before it) is kept clear of every other route, so the label paint
  // places beside the loop can never be taken by a transit routed after it.
  const geometries = loopGeometries(layout);
  const loopLabels = geometries.flatMap((g) => g.label ? [{ ...g.label, x0: g.label.x0 - 1, x1: g.label.x1 + 1 }] : []);
  const commonObstacles = [...(options.obstacles ?? []), ...loopLabels];
  const regionRects = glyphDiagramGroupRects(layout, { cols, rows });
  for (const edge of ordered) {
    if (edge.invisible) continue;
    // Concurrent siblings own independent routing corridors. A return must
    // not escape through another region merely to avoid its own caption.
    const region = layout.groups.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]
      && group.members.includes(edge.from) && group.members.includes(edge.to)).sort((a, b) => a.members.length - b.members.length)[0];
    const room = region && regionRects.get(region.id);
    const obstacles = room ? [...commonObstacles,
      { x0: 0, x1: cols - 1, y0: 0, y1: room.y0 - 1 },
      { x0: 0, x1: cols - 1, y0: room.y1 + 1, y1: rows - 1 },
      { x0: 0, x1: room.x0 - 1, y0: 0, y1: rows - 1 },
      { x0: room.x1 + 1, x1: cols - 1, y0: 0, y1: rows - 1 },
    ] : commonObstacles;
    // Fitting discards a canvas after its first failed edge; routing the rest
    // cannot make that gutter feasible. Final-output routing keeps every failure.
    if (options.stopOnFailure && unroutable.length) break;
    const from = ports.get(edge.id)!.find((p) => p.end === "from")!;
    const to = ports.get(edge.id)!.find((p) => p.end === "to")!;
    if (edge.from === edge.to) {
      // A loop is a fixed shape, not a search. All four of its cells lie in its
      // two ports' protected lanes, which every other edge already routes around.
      const mine = geometries.find((g) => g.loop.edgeId === edge.id)!, cells = mine.cells, lanes = otherPortLanes(layout, edge.id);
      const free = cells.every((p) => p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows
        && !blockedByNodes(p, layout, from.escape, to.escape) && !(options.obstacles ?? []).some((r) => inside(p, r)) && !blockedByPortLanes(p, lanes))
        && !geometries.some((other) => other !== mine && loopsConflict(mine, other))
        && (!mine.label || (mine.label.x1 < cols && mine.label.y1 < rows));
      if (!free) { unroutable.push(edge.id); ledger.push(ledgerUnroutable({ edgeId: edge.id, reason: `there is no room beside "${edge.from}" for its loop` })); continue; }
      routes.push({ edge, cells });
      continue;
    }
    const start = from.escape, goal = to.escape;
    const outward = GLYPH_DIAGRAM_DIRECTIONS[from.side], inward = GLYPH_DIAGRAM_DIRECTIONS[to.side];
    const startDir = steps.findIndex((s) => same(s, outward));
    const endDir = steps.findIndex((s) => s.x === -inward.x && s.y === -inward.y);
    const otherLanes = otherPortLanes(layout, edge.id);
    const trunks = [from.trunk, to.trunk].filter((trunk): trunk is string => !!trunk);
    const family = new Map(trunks.map(trunk => [trunk, new Set(layout.ports.filter(port => port.trunk === trunk).map(port => port.edgeId))]));
    const sharedExits = new Set(layout.ports.filter(port => port.end === "from" && port.nodeId === from.nodeId && same(port.escape, from.escape)).map(port => port.edgeId));
    const foreign = (cell: ReturnType<typeof used.get>) => {
      if (!cell) return false;
      // Different style buses share only the short exit stub, then keep separate lanes.
      if (sharedExits.size > 1 && Math.abs(cell.point.x - from.escape.x) + Math.abs(cell.point.y - from.escape.y) <= PORT_LANE_LENGTH
        && [...cell.owners].every(id => sharedExits.has(id))) return false;
      return ![...family.values()].some(owners => [...cell.owners].every(id => owners.has(id)));
    };
    // Obstacles and earlier routes stay fixed throughout this edge's A*.
    // Cache their cell/axis checks; only turning depends on the prior state.
    const freeCells = new Map<number, number>();
    const isFree = (p: GlyphCanvasPoint, dir: number, previous?: State): boolean => {
      if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows) return false;
      const axis = dir % 2;
      const cellKey = key(p);
      const crossing = used.get(cellKey);
      const blocked = foreign(crossing);
      if (previous && previous.dir !== dir && (blocked || foreign(used.get(key(previous))))) return false;
      const cacheKey = p.y * cols + p.x;
      const cached = freeCells.get(cacheKey);
      if (cached !== undefined) return (cached & (1 << axis)) !== 0;
      let freeAxes = 0;
      if (!blockedByNodes(p, layout, start, goal)
        && !obstacles.some(r => inside(p, r))
        && !blockedByPortLanes(p, otherLanes)) {
        freeAxes = 3;
        if (blocked) freeAxes &= crossing!.axis === 2 ? 0 : ~(1 << crossing!.axis);
        for (const step of steps) {
          const neighbour = used.get(key({ x: p.x + step.x, y: p.y + step.y }));
          if (foreign(neighbour)) freeAxes &= neighbour!.axis === 2 ? 0 : ~(1 << neighbour!.axis);
        }
      }
      freeCells.set(cacheKey, freeAxes);
      return (freeAxes & (1 << axis)) !== 0;
    };
    // Use the same branch corridor for every member of a star, from either end.
    const stem = from.trunk ? from : to.trunk ? to : undefined;
    const delta = stem && GLYPH_DIAGRAM_DIRECTIONS[stem.side];
    const transverse = outward.x ? "y" : "x", along = outward.x ? "x" : "y";
    let bus = stem ? stem.escape[along] + (delta!.x || delta!.y) : 0;
    const peers = stem ? layout.ports.filter(port => port.trunk === stem.trunk).map(port =>
      ports.get(port.edgeId)!.find(other => other.end !== stem.end)!.escape) : [];
    if (stem) {
      const direction = delta!.x || delta!.y;
      const limit = direction > 0 ? Math.min(...peers.map(p => p[along])) - 1 : Math.max(...peers.map(p => p[along])) + 1;
      for (; direction > 0 ? bus <= limit : bus >= limit; bus += direction) {
        let clear = true;
        for (let cross = Math.min(stem.escape[transverse], ...peers.map(p => p[transverse]));
          cross <= Math.max(stem.escape[transverse], ...peers.map(p => p[transverse])); cross++) {
          work?.take("expansions");
          const p = { ...start, [along]: bus, [transverse]: cross };
          if (blockedByNodes(p, layout, start, goal) || obstacles.some(rect => inside(p, rect))
            || blockedByPortLanes(p, otherLanes) || foreign(used.get(key(p)))) { clear = false; break; }
        }
        if (clear) break;
      }
    }
    const busPoints: GlyphCanvasPoint[] = [];
    if (stem && from.side !== to.side && outward.x === -inward.x && outward.y === -inward.y) {
      const waypoints = [start, { ...start, [along]: bus }, { ...goal, [along]: bus }, goal];
      busPoints.push(start);
      for (const target of waypoints.slice(1)) {
        let p = busPoints[busPoints.length - 1]!;
        while (!same(p, target)) {
          work?.take("expansions");
          p = { x: p.x + Math.sign(target.x - p.x), y: p.y + Math.sign(target.y - p.y) };
          busPoints.push(p);
        }
      }
    }
    let busState: State | undefined;
    for (let i = 0; i < busPoints.length; i++) {
      const p = busPoints[i]!, prev = busPoints[i - 1], next = busPoints[i + 1];
      const move = prev ? { x: p.x - prev.x, y: p.y - prev.y } : next ? { x: next.x - p.x, y: next.y - p.y } : outward;
      const dir = steps.findIndex(step => same(step, move));
      if (dir < 0 || (i === 0 && dir !== startDir) || (i === busPoints.length - 1 && dir !== endDir)
        || foreign(used.get(key(p))) || ringParallelCost(p, dir) > 0 || !isFree(p, dir, busState)) { busState = undefined; break; }
      busState = { ...p, dir, cost: i, estimate: i, order: i, parent: busState };
    }
    const guides = layout[GLYPH_DIAGRAM_EDGE_WAYPOINTS]?.[edge.id]?.filter((_, i, points) => points.length > 1 && i % 2 === 1) ?? [];
    // Dummy positions are mandatory only for the deterministic compartment
    // candidate. Failed corridors fall back at the fitter, never at paint.
    let found: State | undefined = guides.length ? undefined : busState;
    // Ignore bends and port direction for a cheap necessary connectivity check.
    // Earlier routes often enclose the target: no gutter can rescue that edge
    // unless it opens this component. Search from the target's usually small side.
    const connected = (): boolean => {
      if (!options.stopOnFailure || !used.size) return true;
      const visited = new Set<number>(), pending = [goal];
      visited.add(goal.y * cols + goal.x);
      while (pending.length) {
        work?.take("expansions");
        const point = pending.pop()!;
        if (same(point, start)) return true;
        for (let dir = 0; dir < steps.length; dir++) {
          const next = { x: point.x + steps[dir]!.x, y: point.y + steps[dir]!.y };
          if (next.x < 0 || next.y < 0 || next.x >= cols || next.y >= rows) continue;
          const id = next.y * cols + next.x;
          // A* checks the destination's movement axis; a predecessor may
          // arrive on the other axis and turn here. Keep that possibility.
          if (visited.has(id) || !isFree(point, dir) || (!isFree(next, 0) && !isFree(next, 1))) continue;
          visited.add(id); pending.push(next);
        }
      }
      return false;
    };
    let seed: State | undefined;
    for (const target of [...guides, goal]) {
      const final = target === goal;
      const queue = new Queue(), best = new Map<string, number>();
      let order = 0;
      const startCost = ringParallelCost(start, startDir);
      const origin = seed ?? { ...start, dir: startDir, cost: startCost, estimate: startCost, order: order++ };
      if (seed) found = undefined;
      if (!found && isFree(origin, origin.dir) && (!final || isFree(goal, endDir)) && (guides.length || connected())) {
        queue.push({ ...origin, estimate: origin.cost + Math.abs(origin.x - target.x) + Math.abs(origin.y - target.y) });
        best.set(`${key(origin)},${origin.dir}`, origin.cost);
      }
      let current: State | undefined;
      while (!found && (current = queue.pop())) {
        work?.take("expansions");
        if (current.cost !== best.get(`${key(current)},${current.dir}`)) continue;
        if (same(current, target) && (!final || current.dir === endDir)) { found = current; break; }
        for (let dir = 0; dir < steps.length; dir++) {
          if ((dir + 2) % 4 === current.dir || (!current.parent && dir !== startDir)) continue;
          const p = { x: current.x + steps[dir]!.x, y: current.y + steps[dir]!.y };
          if (final && same(p, goal) && dir !== endDir) continue;
          if (!isFree(p, dir, current)) continue;
          const cost = current.cost + 1 + (dir === current.dir ? 0 : options.bendCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.bend) + (foreign(used.get(key(p))) ? options.crossingCost ?? GLYPH_DIAGRAM_ROUTE_COSTS.crossing : 0) + ringParallelCost(p, dir);
          const stateKey = `${key(p)},${dir}`;
          if (cost >= (best.get(stateKey) ?? Infinity)) continue;
          best.set(stateKey, cost);
          queue.push({ ...p, dir, cost, estimate: cost + Math.abs(p.x - target.x) + Math.abs(p.y - target.y), parent: current, order: order++ });
        }
      }
      if (!found) break;
      seed = found;
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
      const previous = used.get(key(point));
      used.set(key(point), { point, axis: previous && previous.axis !== axis ? 2 : axis,
        owners: new Set([...(previous?.owners ?? []), edge.id]) });
    });
  }
  return { routes, unroutable, ledger };
}
