import type { GlyphLaneDag, GlyphLaneNode } from "./types";

/**
 * Lane allocation — the one genuinely new algorithm this form needs (see the
 * package's own lane-DAG contract doc). `nodes` is walked in its AUTHORED
 * order (newest first, "array order is time" — `types.ts`'s own doc), never
 * sorted. A lane is a column: `lanes[i]` names the node id that column `i`
 * is currently waiting to reach (its next OLDER node along that line of
 * history), or `null` when the column is free.
 *
 * - A node with nothing waiting for it (a fresh head no earlier node named
 *   as a parent) gets a brand-new lane: the LEFTMOST free column, or a new
 *   one appended past the end. Reusing a freed column instead of always
 *   appending is what stops a long history drifting rightward forever — the
 *   property `render.test.ts`'s mutation-check test asserts directly.
 * - When more than one column is waiting for the same node (two different
 *   lines of history both name it as their next parent), that node is a
 *   MERGE point: the leftmost waiting column becomes its lane, and the
 *   others join it on a connector row ABOVE the node, as `git log --graph`
 *   draws `|/` — joined below, a line read as descending from the node's
 *   parent instead of the node.
 * - When a node names more than one parent, it is a BRANCH point: its own
 *   lane continues to `parents[0]`, and each further parent gets its own
 *   newly allocated lane (again preferring a freed column) on a connector
 *   row BELOW the node.
 */

export interface GlyphLaneRowCells {
  /** Other active lanes that simply pass through this row untouched — painted as a plain vertical rule. */
  readonly passthroughLanes: readonly number[];
}

export interface GlyphLaneNodeRow extends GlyphLaneRowCells {
  readonly type: "node";
  readonly top: number;
  readonly node: GlyphLaneNode;
  readonly lane: number;
}

/** A node's merges sit on a connector row directly above it (only `mergeLanes`), its branches on one directly below (only `branchLanes`). */
export interface GlyphLaneConnectorRow {
  readonly type: "connector";
  readonly top: number;
  /** The lane the triggering node occupies — every merge/branch on this row pivots through it. */
  readonly hubLane: number;
  /** Whether `hubLane` itself continues below this row: always above a node, and below one only when the node has a parent. */
  readonly hubContinues: boolean;
  /** A fixed destination column can begin here when every arriving lane is elsewhere. */
  readonly hubStarts?: boolean;
  /** Lanes merging INTO `hubLane` on this row; freed immediately after. */
  readonly mergeLanes: readonly number[];
  /** Newly allocated lanes branching OUT of `hubLane` on this row; active from this row on. */
  readonly branchLanes: readonly number[];
  /** Other active lanes strictly between the row's min/max touched column — crossed by the horizontal connector, painted as a 4-way junction. */
  readonly passthroughLanes: readonly number[];
  /** Other active lanes outside the row's touched span entirely — painted as a plain vertical rule, same as a node row's. */
  readonly untouchedLanes: readonly number[];
}

/**
 * Lanes whose line runs past the edge of a truncated window: a dashed rule
 * under the last node (newest-first) or above the first (`incoming`), so a
 * lane still waiting on an absent node never reads as the start of history.
 */
export interface GlyphLaneContinuationRow {
  readonly type: "continuation";
  readonly top: number;
  readonly lanes: readonly number[];
  /** The id each lane (same index) is waiting for — lets the painter colour a lane from the node it leads to. */
  readonly waitingFor: readonly string[];
}

export type GlyphLaneRow = GlyphLaneNodeRow | GlyphLaneConnectorRow | GlyphLaneContinuationRow;

export interface GlyphLaneLayoutOptions {
  /** Source-owned lane identity survives chronological inversion (Mermaid branches). */
  readonly laneOf?: ReadonlyMap<string, number>;
  /**
   * Lanes that already wait for `id` before the first row, one entry per
   * absent parent (`source` is that absent parent's id) — pre-opens them
   * under a leading continuation row. An `id` not among `nodes` is ignored:
   * no row would ever resolve its lane, so it would draw a phantom
   * continuation at both ends.
   */
  readonly incoming?: readonly { readonly id: string; readonly source: string }[];
  /**
   * node id -> the id of the node (or `incoming` source) whose lane it
   * continues when several lanes arrive at it. Default: the leftmost arriving
   * lane, which in newest-first order IS the first parent's. An inverted DAG
   * must say it: lanes are opened in child order there, so the leftmost one
   * is not necessarily the first parent's.
   */
  readonly continuesFrom?: ReadonlyMap<string, string>;
}

export interface GlyphLaneRowsResult {
  readonly rows: readonly GlyphLaneRow[];
  /** Highest lane index ever occupied — `maxLane + 1` is the natural (undegraded) lane-column count. */
  readonly maxLane: number;
  readonly laneOf: ReadonlyMap<string, number>;
}

export function layoutGlyphLaneRows(dag: GlyphLaneDag, options: GlyphLaneLayoutOptions = {}): GlyphLaneRowsResult {
  const lanes: (string | null)[] = [];
  /** The id that opened each lane — what `continuesFrom` selects by. */
  const source: (string | null)[] = [];
  const laneOf = new Map<string, number>();
  const rows: GlyphLaneRow[] = [];
  let top = 0;
  let maxLane = -1;

  // Reserve identity columns even before their first node. Auxiliary ancestry
  // connections may reuse only columns beyond them, never another branch's.
  const fixedCount = options.laneOf ? Math.max(-1, ...options.laneOf.values()) + 1 : 0;
  for (let i = 0; i < fixedCount; i++) { lanes.push(null); source.push(null); }
  const allocateLane = (id?: string): number => {
    const fixed = id === undefined ? undefined : options.laneOf?.get(id);
    if (fixed !== undefined && lanes[fixed] === null) return fixed;
    const free = lanes.indexOf(null, fixedCount);
    if (free !== -1) return free;
    lanes.push(null);
    source.push(null);
    return lanes.length - 1;
  };

  const present = new Set(dag.nodes.map((n) => n.id));
  const incoming = (options.incoming ?? []).filter((entry) => present.has(entry.id));
  if (incoming.length) {
    const opened = incoming.map(({ id, source: from }) => {
      const laneIndex = allocateLane();
      lanes[laneIndex] = id;
      source[laneIndex] = from;
      maxLane = Math.max(maxLane, laneIndex);
      return laneIndex;
    });
    rows.push({ type: "continuation", top, lanes: opened, waitingFor: incoming.map((entry) => entry.id) });
    top++;
  }

  for (const node of dag.nodes) {
    const arriving: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === node.id) arriving.push(i);
    const activeBefore = lanes.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0);

    const wanted = options.continuesFrom?.get(node.id);
    const primaryLane = options.laneOf?.get(node.id) ?? (arriving.length ? (arriving.find((i) => source[i] === wanted) ?? arriving[0]!) : allocateLane());
    const mergeLanes = arriving.filter((i) => i !== primaryLane);
    laneOf.set(node.id, primaryLane);
    maxLane = Math.max(maxLane, primaryLane, ...mergeLanes);

    const connector = (touched: readonly number[], active: readonly number[], fields: Pick<GlyphLaneConnectorRow, "hubContinues" | "hubStarts" | "mergeLanes" | "branchLanes">): void => {
      const spanMin = Math.min(...touched), spanMax = Math.max(...touched);
      const other = active.filter((i) => !touched.includes(i));
      rows.push({
        type: "connector", top, hubLane: primaryLane, ...fields,
        passthroughLanes: other.filter((i) => i > spanMin && i < spanMax), untouchedLanes: other.filter((i) => i < spanMin || i > spanMax),
      });
      top++;
    };
    if (mergeLanes.length > 0) {
      connector([primaryLane, ...mergeLanes], activeBefore, { hubContinues: true, ...(!arriving.includes(primaryLane) ? { hubStarts: true } : {}), mergeLanes, branchLanes: [] });
      for (const laneIndex of mergeLanes) lanes[laneIndex] = null;
    }
    const activeAtNode = activeBefore.filter((i) => !mergeLanes.includes(i));
    rows.push({ type: "node", top, node, lane: primaryLane, passthroughLanes: activeAtNode.filter((i) => i !== primaryLane) });
    top++;

    // Prefer the same branch in either reading direction. Without a same-
    // branch successor, carry this line to the next node's merge row instead
    // of borrowing an occupied branch column or creating a needless detour.
    const firstParent = (options.laneOf && node.parents.find(id => options.laneOf!.get(id) === primaryLane)) ?? node.parents[0];
    const restParents = node.parents.filter(id => id !== firstParent);
    lanes[primaryLane] = firstParent ?? null;
    source[primaryLane] = node.id;
    const branchLanes = restParents.map((parentId) => {
      const laneIndex = allocateLane(parentId);
      lanes[laneIndex] = parentId;
      source[laneIndex] = node.id;
      maxLane = Math.max(maxLane, laneIndex);
      return laneIndex;
    });

    if (branchLanes.length > 0) connector([primaryLane, ...branchLanes], activeAtNode, { hubContinues: firstParent !== undefined, mergeLanes: [], branchLanes: [...branchLanes].sort((a, b) => a - b) });
  }

  // Every lane naming a present node has resolved by now, so what is still
  // open is waiting on an id outside the window.
  const open = lanes.flatMap((id, i) => (id === null ? [] : [i]));
  if (open.length) rows.push({ type: "continuation", top, lanes: open, waitingFor: open.map((i) => lanes[i]!) });

  return { rows, maxLane, laneOf };
}

/**
 * The `lane-history-continues` count: distinct lane columns carrying a dashed
 * rule on ANY continuation row. A column dashed at both ends (a window cut on
 * each side) is one line, since the ledger reports lines the reader sees as
 * running past the window, not rules painted.
 */
export function countGlyphLaneContinuationLines(rows: readonly GlyphLaneRow[]): number {
  return new Set(rows.flatMap((row) => (row.type === "continuation" ? row.lanes : []))).size;
}

export interface GlyphLaneCapResult {
  readonly rows: readonly GlyphLaneRow[];
  /** Total rendered columns, including the single shared overflow column when anything collapsed. */
  readonly columns: number;
  readonly collapsedLaneIndices: readonly number[];
  readonly collapsedNodeIds: readonly string[];
}

function laneActivity(result: GlyphLaneRowsResult): number[] {
  const activity = new Array<number>(result.maxLane + 1).fill(0);
  const bump = (i: number) => { activity[i]!++; };
  for (const row of result.rows) {
    if (row.type === "node") { bump(row.lane); row.passthroughLanes.forEach(bump); }
    else if (row.type === "continuation") row.lanes.forEach(bump);
    else { bump(row.hubLane); row.mergeLanes.forEach(bump); row.branchLanes.forEach(bump); row.passthroughLanes.forEach(bump); row.untouchedLanes.forEach(bump); }
  }
  return activity;
}

/**
 * Collapses the LEAST ACTIVE original lane columns (fewest rows occupied,
 * `laneActivity`'s own count) into one shared overflow column, remapping
 * every remaining column to a dense `0..columns-1` range. `cap` is the
 * TOTAL number of painted columns the result may use (dense lanes plus, if
 * anything collapses, the one shared overflow column) — so collapsing ever
 * saves width only two-or-more lanes at a time: folding a single lane into
 * its own overflow column would still cost it a column, same as leaving it
 * dense. Never drops a node — a collapsed node still paints its own marker
 * and full label, only its distinct lane position is lost — and never
 * silent: the caller logs `collapsedLaneIndices`/`collapsedNodeIds` via
 * `ledgerLaneCapCollapsed`.
 */
export function applyGlyphLaneCap(result: GlyphLaneRowsResult, cap: number): GlyphLaneCapResult {
  const naturalColumns = result.maxLane + 1;
  const boundedCap = Math.max(1, cap);
  if (naturalColumns <= boundedCap) return { rows: result.rows, columns: naturalColumns, collapsedLaneIndices: [], collapsedNodeIds: [] };
  const visibleCount = Math.max(0, boundedCap - 1);
  const activity = laneActivity(result);
  const order = activity.map((score, i) => ({ i, score })).sort((a, b) => a.score - b.score || a.i - b.i);
  const collapsedSet = new Set(order.slice(0, naturalColumns - visibleCount).map((e) => e.i));
  const visible = Array.from({ length: naturalColumns }, (_, i) => i).filter((i) => !collapsedSet.has(i));
  const remap = new Map(visible.map((orig, newIndex) => [orig, newIndex]));
  const overflowColumn = visible.length;
  const mapLane = (i: number): number => (collapsedSet.has(i) ? overflowColumn : remap.get(i)!);
  const dedupeSorted = (values: readonly number[]): number[] => [...new Set(values.map(mapLane))].sort((a, b) => a - b);

  const collapsedNodeIds: string[] = [];
  const rows: GlyphLaneRow[] = result.rows.map((row) => {
    if (row.type === "node") {
      if (collapsedSet.has(row.lane)) collapsedNodeIds.push(row.node.id);
      return { ...row, lane: mapLane(row.lane), passthroughLanes: dedupeSorted(row.passthroughLanes) };
    }
    if (row.type === "continuation") {
      const firstId = new Map<number, string>();
      row.lanes.forEach((lane, k) => { if (!firstId.has(mapLane(lane))) firstId.set(mapLane(lane), row.waitingFor[k]!); });
      const lanes = dedupeSorted(row.lanes);
      return { ...row, lanes, waitingFor: lanes.map((lane) => firstId.get(lane)!) };
    }
    return {
      ...row, hubLane: mapLane(row.hubLane),
      mergeLanes: dedupeSorted(row.mergeLanes), branchLanes: dedupeSorted(row.branchLanes),
      passthroughLanes: dedupeSorted(row.passthroughLanes), untouchedLanes: dedupeSorted(row.untouchedLanes),
    };
  });
  return { rows, columns: overflowColumn + 1, collapsedLaneIndices: [...collapsedSet].sort((a, b) => a - b), collapsedNodeIds };
}
