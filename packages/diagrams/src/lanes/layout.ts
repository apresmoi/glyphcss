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
 *   MERGE point: the leftmost waiting column becomes its lane, the others
 *   are freed one row later (the connector row), never carried forward.
 * - When a node names more than one parent, it is a BRANCH point: its own
 *   lane continues to `parents[0]`, and each further parent gets its own
 *   newly allocated lane (again preferring a freed column) one row later.
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

export interface GlyphLaneConnectorRow {
  readonly type: "connector";
  readonly top: number;
  /** The lane the triggering node occupies — every merge/branch on this row pivots through it. */
  readonly hubLane: number;
  /** Whether `hubLane` itself continues below this row (the node had at least one parent) — a childless node merged into by other lanes still closes its own column here. */
  readonly hubContinues: boolean;
  /** Lanes merging INTO `hubLane` on this row; freed immediately after. */
  readonly mergeLanes: readonly number[];
  /** Newly allocated lanes branching OUT of `hubLane` on this row; active from this row on. */
  readonly branchLanes: readonly number[];
  /** Other active lanes strictly between the row's min/max touched column — crossed by the horizontal connector, painted as a 4-way junction. */
  readonly passthroughLanes: readonly number[];
  /** Other active lanes outside the row's touched span entirely — painted as a plain vertical rule, same as a node row's. */
  readonly untouchedLanes: readonly number[];
}

export type GlyphLaneRow = GlyphLaneNodeRow | GlyphLaneConnectorRow;

export interface GlyphLaneRowsResult {
  readonly rows: readonly GlyphLaneRow[];
  /** Highest lane index ever occupied — `maxLane + 1` is the natural (undegraded) lane-column count. */
  readonly maxLane: number;
  readonly laneOf: ReadonlyMap<string, number>;
}

export function layoutGlyphLaneRows(dag: GlyphLaneDag): GlyphLaneRowsResult {
  const lanes: (string | null)[] = [];
  const laneOf = new Map<string, number>();
  const rows: GlyphLaneRow[] = [];
  let top = 0;
  let maxLane = -1;

  const allocateLane = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const node of dag.nodes) {
    const arriving: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === node.id) arriving.push(i);
    const activeBefore = lanes.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0);

    const primaryLane = arriving.length ? arriving[0]! : allocateLane();
    const mergeLanes = arriving.slice(1);
    laneOf.set(node.id, primaryLane);
    maxLane = Math.max(maxLane, primaryLane, ...mergeLanes);

    const nodeRowOther = activeBefore.filter((i) => i !== primaryLane);
    rows.push({ type: "node", top, node, lane: primaryLane, passthroughLanes: nodeRowOther });
    top++;

    const [firstParent, ...restParents] = node.parents;
    lanes[primaryLane] = firstParent ?? null;
    for (const laneIndex of mergeLanes) lanes[laneIndex] = null;
    const branchLanes = restParents.map((parentId) => {
      const laneIndex = allocateLane();
      lanes[laneIndex] = parentId;
      maxLane = Math.max(maxLane, laneIndex);
      return laneIndex;
    });

    if (mergeLanes.length > 0 || branchLanes.length > 0) {
      const touched = [primaryLane, ...mergeLanes, ...branchLanes];
      const spanMin = Math.min(...touched), spanMax = Math.max(...touched);
      const other = activeBefore.filter((i) => i !== primaryLane && !mergeLanes.includes(i));
      const passthroughLanes = other.filter((i) => i > spanMin && i < spanMax);
      const untouchedLanes = other.filter((i) => i < spanMin || i > spanMax);
      rows.push({
        type: "connector", top, hubLane: primaryLane, hubContinues: firstParent !== undefined,
        mergeLanes: [...mergeLanes].sort((a, b) => a - b), branchLanes: [...branchLanes].sort((a, b) => a - b),
        passthroughLanes: passthroughLanes.sort((a, b) => a - b), untouchedLanes: untouchedLanes.sort((a, b) => a - b),
      });
      top++;
    }
  }

  return { rows, maxLane, laneOf };
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
    return {
      ...row, hubLane: mapLane(row.hubLane),
      mergeLanes: dedupeSorted(row.mergeLanes), branchLanes: dedupeSorted(row.branchLanes),
      passthroughLanes: dedupeSorted(row.passthroughLanes), untouchedLanes: dedupeSorted(row.untouchedLanes),
    };
  });
  return { rows, columns: overflowColumn + 1, collapsedLaneIndices: [...collapsedSet].sort((a, b) => a - b), collapsedNodeIds };
}
