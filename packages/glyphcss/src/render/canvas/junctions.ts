/**
 * Per-edge route bookkeeping and junction resolution for the cell canvas.
 *
 * `canvas.edge(edgeId, { from, to, priority? })` registers an edge's graph
 * endpoints BEFORE any `route()` call for it — `route()` throws if the edge
 * was never registered, because the join/crossing decision below is
 * undecidable without knowing what an edge actually connects to.
 * `canvas.route(edgeId, cells)` then records the edge's ORDERED cell
 * polyline (consecutive cells must be 4-adjacent, else `RangeError`) — never
 * a caller-supplied mask. Every cell's N/E/S/W contribution is DERIVED from
 * its neighbours in that polyline, per edge, and never unioned across edges
 * at record time; `resolveGlyphCanvasJunctions` is what turns the recorded
 * routes into a JOIN, a CROSSING or a route CONFLICT.
 *
 * **Junctions are decided by ROUTE COINCIDENCE, not by node identity alone.**
 * An earlier version asked only "do these two edges share a `from`/`to`
 * string, transitively through however many other edges" — which drew a
 * false join between edges that merely happened to reference a common node
 * SOMEWHERE, however far from the cell in question, and (via transitivity)
 * chained unrelated edges together through a bridging third edge. The
 * question this module actually needs answered is LOCAL: at cell C, do two
 * edges that share an endpoint node `n` follow the exact same sequence of
 * cells all the way from C to `n`? A hub where several edges genuinely
 * originate at the same physical cell answers "yes" trivially (the walk
 * from C to `n` is zero cells, since C already IS `n`'s location); a shared
 * trunk that later fans out, or several branches that merge into one final
 * run, answers "yes" over a longer walk; two edges that reference the same
 * node id but never actually run along the same cells only look connected
 * on paper, and answer "no".
 */

import type { CellGrid } from "../cells";
import type { GlyphCanvasReport, GlyphCanvasRouteConflictKind } from "./report";
import { GLYPH_CANVAS_DIRECTION_BITS, type GlyphCanvasTier } from "./tiers";

export interface GlyphCanvasEdgeOptions {
  readonly from: string;
  readonly to: string;
  /**
   * Explicit priority: a HIGHER number wins a crossing. Ties (including two
   * edges that never set one, both defaulting to `0`) break by registration
   * order — the earlier `edge()` call wins. Optional because most callers
   * have no reason to care who wins a given crossing and can rely on the
   * order they build their graph in instead.
   */
  readonly priority?: number;
}

interface GlyphCanvasEdgeMeta {
  readonly from: string;
  readonly to: string;
  readonly explicitPriority: number;
  /** Registration order — lower means registered earlier. */
  readonly order: number;
}

/**
 * `route()`'s accumulated state for one canvas. Not itself part of the
 * public `GlyphCanvas` surface — `canvas.ts` owns one per canvas and calls
 * the functions below from `edge()`/`route()`/`resolveJunctions()`.
 */
export interface GlyphCanvasEdgeState {
  /** edgeId → registered graph endpoints + priority. */
  readonly edges: Map<string, GlyphCanvasEdgeMeta>;
  /** edgeId → its ordered route, as cell INDICES (`y * cols + x`). */
  readonly routes: Map<string, number[]>;
  /** cellIndex → edge ids touching it, in first-registered order. */
  readonly cellEdges: Map<number, string[]>;
  nextOrder: number;
}

export function createGlyphCanvasEdgeState(): GlyphCanvasEdgeState {
  return { edges: new Map(), routes: new Map(), cellEdges: new Map(), nextOrder: 0 };
}

/** Register `edgeId`'s graph endpoints. Idempotent per id — a re-registration
 * updates the endpoints/priority but keeps the original registration order,
 * since re-declaring an edge is not the same event as routing it. */
export function registerGlyphCanvasEdge(
  state: GlyphCanvasEdgeState,
  edgeId: string,
  opts: GlyphCanvasEdgeOptions,
): void {
  const existing = state.edges.get(edgeId);
  state.edges.set(edgeId, {
    from: opts.from,
    to: opts.to,
    explicitPriority: opts.priority ?? 0,
    order: existing?.order ?? state.nextOrder++,
  });
}

const { n: N, s: S, e: E, w: W } = GLYPH_CANVAS_DIRECTION_BITS;

/** The N/E/S/W bit for the direction FROM cell `fromIdx` TO its 4-adjacent
 * neighbour `toIdx`. Throws if the two cells are not 4-adjacent — the same
 * check `registerGlyphCanvasRoute` already ran over every consecutive pair
 * at registration time, so this can only fire from a bug in this module. */
function directionBit(fromIdx: number, toIdx: number, cols: number): number {
  const dx = (toIdx % cols) - (fromIdx % cols);
  const dy = Math.floor(toIdx / cols) - Math.floor(fromIdx / cols);
  if (dx === 1 && dy === 0) return E;
  if (dx === -1 && dy === 0) return W;
  if (dy === 1 && dx === 0) return S;
  if (dy === -1 && dx === 0) return N;
  throw new RangeError(`glyphcss: route() cells must be 4-adjacent, got a step of (${dx}, ${dy}).`);
}

function areIndicesAdjacent(a: number, b: number, cols: number): boolean {
  const dx = (b % cols) - (a % cols);
  const dy = Math.floor(b / cols) - Math.floor(a / cols);
  return (Math.abs(dx) === 1 && dy === 0) || (Math.abs(dy) === 1 && dx === 0);
}

/**
 * Record edge `edgeId`'s ordered cell polyline. Throws if `edgeId` was never
 * passed to `registerGlyphCanvasEdge` (see the module doc), if any cell is
 * out of bounds or non-integer, or if two consecutive cells are not
 * 4-adjacent — a route is a walk over the grid, not an arbitrary point set,
 * and every mask this module derives depends on that adjacency holding. A
 * second `route()` call for the same edge id REPLACES its route entirely
 * (removing its old cell contributions first), since a caller re-routing an
 * edge (e.g. after a layout change) means the old path no longer exists.
 */
export function registerGlyphCanvasRoute(
  state: GlyphCanvasEdgeState,
  cols: number,
  rows: number,
  edgeId: string,
  cells: readonly { readonly x: number; readonly y: number }[],
): void {
  if (!state.edges.has(edgeId)) {
    throw new RangeError(
      `glyphcss: route() called with unregistered edge ${JSON.stringify(edgeId)} — call canvas.edge(${JSON.stringify(edgeId)}, { from, to }) first.`,
    );
  }

  const indices: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const { x, y } = cells[i]!;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= cols || y < 0 || y >= rows) {
      throw new RangeError(
        `glyphcss: route() requires integer cell coordinates inside the ${cols}x${rows} grid, got (${x}, ${y}) at position ${i}.`,
      );
    }
    indices.push(y * cols + x);
  }
  for (let i = 1; i < indices.length; i++) {
    if (!areIndicesAdjacent(indices[i - 1]!, indices[i]!, cols)) {
      throw new RangeError(
        `glyphcss: route() cells for edge ${JSON.stringify(edgeId)} must be 4-adjacent — cells ${i - 1} (${cells[i - 1]!.x}, ${cells[i - 1]!.y}) and ${i} (${cells[i]!.x}, ${cells[i]!.y}) are not.`,
      );
    }
  }

  const old = state.routes.get(edgeId);
  if (old) {
    for (const idx of old) {
      const list = state.cellEdges.get(idx);
      if (!list) continue;
      const at = list.indexOf(edgeId);
      if (at !== -1) list.splice(at, 1);
      if (list.length === 0) state.cellEdges.delete(idx);
    }
  }

  state.routes.set(edgeId, indices);
  for (const idx of indices) {
    let list = state.cellEdges.get(idx);
    if (!list) {
      list = [];
      state.cellEdges.set(idx, list);
    }
    if (!list.includes(edgeId)) list.push(edgeId);
  }
}

/** An edge's own N/E/S/W mask contribution at one of its route cells,
 * derived from its neighbours IN THE ROUTE (never caller-supplied): the
 * bit(s) toward whichever of the previous/next cell exist. A route endpoint
 * contributes a single bit (a stub); an interior cell contributes one or two
 * (a straight transit or a corner, depending on whether the two neighbours
 * are opposite or adjacent sides). */
function edgeMaskAtCell(route: readonly number[], idx: number, cols: number): number {
  const i = route.indexOf(idx);
  let mask = 0;
  if (i > 0) mask |= directionBit(idx, route[i - 1]!, cols);
  if (i < route.length - 1) mask |= directionBit(idx, route[i + 1]!, cols);
  return mask;
}

/** A plain straight transit: entering from one side, leaving the OPPOSITE
 * one. Distinct from a corner (e.g. `N|E`), which shares a popcount of 2 but
 * is a turn, not a through-run. */
function isStraightTransitMask(mask: number): boolean {
  return mask === (N | S) || mask === (E | W);
}

interface EdgeGroup {
  readonly edgeIds: readonly string[];
  readonly mask: number;
}

/**
 * The sequence of cell indices from `idx` (inclusive) to the cell where
 * `node` sits on `edgeId`'s own route — i.e. the walk from `idx` toward
 * whichever end of the route (`from` = index 0, `to` = last index) is
 * labelled `node`. Returns `undefined` when `idx` isn't on the route, or
 * `node` isn't one of this edge's own endpoints — either way, this edge has
 * nothing to say about that node from this cell.
 */
function pathToNode(
  state: GlyphCanvasEdgeState,
  edgeId: string,
  node: string,
  idx: number,
): readonly number[] | undefined {
  const meta = state.edges.get(edgeId)!;
  const route = state.routes.get(edgeId)!;
  const i = route.indexOf(idx);
  if (i === -1) return undefined;
  if (meta.to === node) return route.slice(i);
  if (meta.from === node) return route.slice(0, i + 1).reverse();
  return undefined;
}

function pathsCoincide(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Do `e1` and `e2` JOIN at cell `idx`? Only if they share a graph node `n`
 * AND the walk from `idx` to `n` is the IDENTICAL cell sequence for both —
 * a real hub (the walk is zero-length: `idx` already is `n`'s cell), a
 * shared trunk that fans out after `idx` (a common SOURCE node, walking
 * backward), or several branches merging into one run through `idx` (a
 * common TARGET node, walking forward). Sharing a node id with a mismatched
 * or absent coincident path is exactly the false-join shape the module doc
 * describes — it does not join here, whatever the two edges' `from`/`to`
 * strings otherwise have in common.
 */
function edgesJoinAtCell(state: GlyphCanvasEdgeState, e1: string, e2: string, idx: number): boolean {
  const m1 = state.edges.get(e1)!;
  const m2 = state.edges.get(e2)!;
  const candidateNodes = new Set<string>();
  if (m1.from === m2.from || m1.from === m2.to) candidateNodes.add(m1.from);
  if (m1.to === m2.from || m1.to === m2.to) candidateNodes.add(m1.to);
  for (const node of candidateNodes) {
    const p1 = pathToNode(state, e1, node, idx);
    const p2 = pathToNode(state, e2, node, idx);
    if (p1 && p2 && pathsCoincide(p1, p2)) return true;
  }
  return false;
}

/** Sortable priority rank: HIGHER `explicitPriority` wins; ties break by
 * EARLIER `order`. Used both per-edge and per-group (a group's rank is its
 * best-ranked member's rank). */
function compareRank(a: GlyphCanvasEdgeMeta, b: GlyphCanvasEdgeMeta): number {
  if (a.explicitPriority !== b.explicitPriority) return b.explicitPriority - a.explicitPriority;
  return a.order - b.order;
}

function bestMember(edgeIds: readonly string[], edges: ReadonlyMap<string, GlyphCanvasEdgeMeta>): GlyphCanvasEdgeMeta {
  let best = edges.get(edgeIds[0]!)!;
  for (let i = 1; i < edgeIds.length; i++) {
    const meta = edges.get(edgeIds[i]!)!;
    if (compareRank(meta, best) < 0) best = meta;
  }
  return best;
}

/**
 * A group's own glyph, as if it were the only thing at this cell — used
 * both for an uncontested JOIN/lone edge and for the WINNER of a crossing.
 * `contested` (true only when 2+ groups occupy the cell) upgrades a plain
 * straight transit to its dashed `hop` variant so the crossing stays
 * visible; every other shape (a stub, a corner, a real 3+-way join) already
 * looks distinctive and keeps its ordinary `junction` glyph either way.
 */
function resolveOwnGlyph(mask: number, tier: GlyphCanvasTier, contested: boolean): string | undefined {
  if (contested && isStraightTransitMask(mask)) {
    return (mask & (N | S)) !== 0 ? tier.hop.v : tier.hop.h;
  }
  return tier.junction[mask];
}

/**
 * Resolve every cell with at least one routed edge into a final glyph,
 * written to `grid.char`. Occluded cells (the canvas's own occlusion byte,
 * same rule every other painter follows) are skipped entirely.
 *
 * Per cell:
 *
 * 1. **One edge.** Its own derived mask, looked up directly.
 * 2. **Edges partitioned into ONE group** by {@link edgesJoinAtCell} (see the
 *    module doc — a real hub, a merge, or a fan-out, however many edges
 *    take part). A real JOIN: union every member's mask and look up the
 *    combined result.
 * 3. **2+ groups.** A CROSSING or a route CONFLICT. The highest-priority
 *    group (see {@link compareRank}) is the winner and keeps its own glyph
 *    via {@link resolveOwnGlyph}; every other group draws nothing at this
 *    cell. Exactly two groups, both plain straight transits, on
 *    PERPENDICULAR axes — the classic "two wires cross in open space"
 *    case — is the whole story and nothing is logged, because this is the
 *    expected, routine shape a router will produce constantly. Every other
 *    2+-group shape is ALSO recorded in `report.routeConflicts` (every edge
 *    id present, the cell, and a {@link GlyphCanvasRouteConflictKind}):
 *    `"parallel"` for two coincident same-axis transits (which are not a
 *    crossing at all — nothing routes THROUGH open space on the same line
 *    without meaning something), `"corner"` for a corner or stub involved
 *    in an otherwise two-group cell, and `"multi"` for three or more
 *    mutually unrelated groups.
 */
export function resolveGlyphCanvasJunctions(
  grid: CellGrid,
  state: GlyphCanvasEdgeState,
  tier: GlyphCanvasTier,
  report: GlyphCanvasReport,
): void {
  // P2-1 (REVIEW-arc-density-search-opus.md): every cell's resolved GLYPH
  // is an overwrite (idempotent by construction — `grid.char[idx] = ...`
  // always reflects the same `state`), but `report.routeConflicts.push(...)`
  // below is an ACCUMULATOR with no matching clear, so a second call with
  // no new registration re-derived and re-pushed every already-reported
  // conflict a second time. `routeConflicts` has exactly one writer in this
  // module (grepped) and nothing else populates it, so truncating it here
  // makes the whole function a PURE function of `state`/`grid`: two calls
  // with the same routes registered produce an identical report, not a
  // doubled one.
  report.routeConflicts.length = 0;
  const cols = grid.cols;
  for (const [idx, edgeIds] of state.cellEdges) {
    if (grid.occluded && grid.occluded[idx] === 1) continue;
    if (edgeIds.length === 0) continue;

    if (edgeIds.length === 1) {
      const mask = edgeMaskAtCell(state.routes.get(edgeIds[0]!)!, idx, cols);
      const glyph = resolveOwnGlyph(mask, tier, false);
      if (glyph !== undefined) grid.char[idx] = glyph;
      continue;
    }

    const parent = new Map<string, string>(edgeIds.map((id) => [id, id]));
    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = id;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    for (let i = 0; i < edgeIds.length; i++) {
      for (let j = i + 1; j < edgeIds.length; j++) {
        if (!edgesJoinAtCell(state, edgeIds[i]!, edgeIds[j]!, idx)) continue;
        const ra = find(edgeIds[i]!);
        const rb = find(edgeIds[j]!);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
    const groupsById = new Map<string, string[]>();
    for (const id of edgeIds) {
      const root = find(id);
      const list = groupsById.get(root);
      if (list) list.push(id);
      else groupsById.set(root, [id]);
    }
    const groups: EdgeGroup[] = [...groupsById.values()].map((ids) => ({
      edgeIds: ids,
      mask: ids.reduce((acc, id) => acc | edgeMaskAtCell(state.routes.get(id)!, idx, cols), 0),
    }));

    if (groups.length === 1) {
      const glyph = resolveOwnGlyph(groups[0]!.mask, tier, false);
      if (glyph !== undefined) grid.char[idx] = glyph;
      continue;
    }

    const ranked = groups
      .map((group) => ({ group, rank: bestMember(group.edgeIds, state.edges) }))
      .sort((a, b) => compareRank(a.rank, b.rank));
    const winner = ranked[0]!.group;
    const runnerUp = ranked[1]!.group;
    const winnerIsStraight = isStraightTransitMask(winner.mask);
    const runnerUpIsStraight = isStraightTransitMask(runnerUp.mask);
    const isClassicCrossing = groups.length === 2
      && winnerIsStraight
      && runnerUpIsStraight
      && winner.mask !== runnerUp.mask;

    const glyph = resolveOwnGlyph(winner.mask, tier, true);
    if (glyph !== undefined) grid.char[idx] = glyph;

    if (!isClassicCrossing) {
      const order = [...edgeIds].sort(
        (a, b) => state.edges.get(a)!.order - state.edges.get(b)!.order,
      );
      const kind: GlyphCanvasRouteConflictKind = groups.length > 2
        ? "multi"
        : winnerIsStraight && runnerUpIsStraight
          ? "parallel"
          : "corner";
      report.routeConflicts.push({ edgeIds: order, col: idx % cols, row: Math.floor(idx / cols), kind });
    }
  }
}
