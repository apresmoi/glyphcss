import { describe, expect, it } from "vitest";
import { applyGlyphLaneCap, layoutGlyphLaneRows, type GlyphLaneRow, type GlyphLaneRowsResult } from "./layout";
import type { GlyphLaneDag, GlyphLaneNode } from "./types";

// The reference shape from the task brief:
//   *   9f2c1ab  (main, tag: v2.4.0)  release: cut 2.4.0
//   ├─╮
//   │ *   4ab77de  chore: bump deps
//   │ ├─╮
//   │ │ *   1c90fee  fix(auth): refresh token race
//   │ * │   7e41b02  feat(orders): partial refunds
//   │ ├─╯
//   * │     2d6aa19  docs: architecture decision 014
//   ├─╯
//   *   b83f5c7  fix(http): keep-alive leak
// parents[0] continues a node's own lane; parents[1+] branch off a NEW lane
// (see layout.ts's own doc) — so 9f2c1ab's primary lane runs straight down
// to 2d6aa19 while its second parent 4ab77de opens lane 1, exactly the
// left-continues/right-branches shape the reference art draws.
const GIT_STYLE: GlyphLaneDag = {
  nodes: [
    { id: "9f2c1ab", label: "release: cut 2.4.0", parents: ["2d6aa19", "4ab77de"] },
    { id: "4ab77de", label: "chore: bump deps", parents: ["7e41b02", "1c90fee"] },
    { id: "1c90fee", label: "fix(auth): refresh token race", parents: ["7e41b02"] },
    { id: "7e41b02", label: "feat(orders): partial refunds", parents: ["b83f5c7"] },
    { id: "2d6aa19", label: "docs: architecture decision 014", parents: ["b83f5c7"] },
    { id: "b83f5c7", label: "fix(http): keep-alive leak", parents: [] },
  ],
};

describe("layoutGlyphLaneRows: lane assignment", () => {
  it("assigns the git-style reference DAG's lanes exactly, merges joining above their node and branches leaving below it", () => {
    const { rows, maxLane, laneOf } = layoutGlyphLaneRows(GIT_STYLE);
    expect(laneOf.get("9f2c1ab")).toBe(0);
    expect(laneOf.get("4ab77de")).toBe(1);
    expect(laneOf.get("1c90fee")).toBe(2);
    expect(laneOf.get("7e41b02")).toBe(1);
    expect(laneOf.get("2d6aa19")).toBe(0);
    expect(laneOf.get("b83f5c7")).toBe(0);
    expect(maxLane).toBe(2);

    // node(9f2c1ab), connector(branch 0->1), node(4ab77de), connector(branch
    // 1->2), node(1c90fee), connector(merge 2 into 1), node(7e41b02),
    // node(2d6aa19), connector(merge 1 into 0), node(b83f5c7). A merge joined
    // BELOW its node read as descending from the node's parent instead.
    expect(rows.map((r) => r.type)).toEqual([
      "node", "connector", "node", "connector", "node", "connector", "node", "node", "connector", "node",
    ]);

    const branch1 = rows[1]!; if (branch1.type !== "connector") throw new Error("expected connector");
    expect(branch1).toMatchObject({ hubLane: 0, mergeLanes: [], branchLanes: [1], hubContinues: true });

    const branch2 = rows[3]!; if (branch2.type !== "connector") throw new Error("expected connector");
    expect(branch2).toMatchObject({ hubLane: 1, mergeLanes: [], branchLanes: [2], hubContinues: true });

    const merge1 = rows[5]!; if (merge1.type !== "connector") throw new Error("expected connector");
    expect(merge1).toMatchObject({ hubLane: 1, mergeLanes: [2], branchLanes: [], hubContinues: true });

    const merge2 = rows[8]!; if (merge2.type !== "connector") throw new Error("expected connector");
    expect(merge2).toMatchObject({ hubLane: 0, mergeLanes: [1], branchLanes: [], hubContinues: true });
  });

  it("frees a merged lane and reuses it for a later, unrelated branch instead of appending a new column", () => {
    // c has two parents (branch); c's two children d/e both converge back on
    // f (merge) — f then branches again into g/h. Without reuse the second
    // branch would land on lane 2; with reuse it lands back on lane 1.
    const dag: GlyphLaneDag = {
      nodes: [
        { id: "c", label: "c", parents: ["d", "e"] },
        { id: "d", label: "d", parents: ["f"] },
        { id: "e", label: "e", parents: ["f"] },
        { id: "f", label: "f", parents: ["g", "h"] },
        { id: "g", label: "g", parents: [] },
        { id: "h", label: "h", parents: [] },
      ],
    };
    const { laneOf, maxLane } = layoutGlyphLaneRows(dag);
    expect(laneOf.get("g")).toBe(0);
    // Mutation: skip reusing the freed lane (always append) -> h lands on
    // lane 2 and maxLane is 2, not 1.
    expect(laneOf.get("h")).toBe(1);
    expect(maxLane).toBe(1);
  });
});

/**
 * MUTATION-CHECK: a long, repeating branch/merge history stays at a bounded
 * lane count only because a merged lane is freed and reused. Build k
 * repeats of "branch into two, then merge them back" and assert the
 * natural (undegraded) width never exceeds 2 lanes, however large k gets.
 * Deleting the free-lane reuse in `layoutGlyphLaneRows` (always appending a
 * new column instead of reusing `lanes.indexOf(null)`) makes `maxLane` grow
 * by one every cycle — this test goes red the moment that happens, which is
 * exactly the "delete the free-lane step and a long history must drift
 * right" property the task calls for.
 */
function repeatingHistory(cycles: number): GlyphLaneDag {
  const nodes: GlyphLaneNode[] = [];
  for (let i = 0; i < cycles; i++) {
    nodes.push({ id: `m${i}`, label: `merge ${i}`, parents: [`x${i}`, `y${i}`] });
    nodes.push({ id: `x${i}`, label: `x ${i}`, parents: [`m${i + 1}`] });
    nodes.push({ id: `y${i}`, label: `y ${i}`, parents: [`m${i + 1}`] });
  }
  nodes.push({ id: `m${cycles}`, label: "root", parents: [] });
  return { nodes };
}

describe("layoutGlyphLaneRows: lane reuse bounds width on a long repeating history", () => {
  it.each([5, 20, 50])("stays at 2 lanes for %i branch/merge cycles", (cycles) => {
    const { maxLane } = layoutGlyphLaneRows(repeatingHistory(cycles));
    expect(maxLane).toBe(1);
  });

  it("grows with the cycle count if lanes are never reused (documents what the reuse step prevents)", () => {
    // A hand-rolled append-only allocator, standing in for the mutation
    // ("skip the free-lane step") the real algorithm must not exhibit.
    function appendOnlyMaxLane(dag: GlyphLaneDag): number {
      const lanes: (string | null)[] = [];
      let maxLane = -1;
      const allocate = (): number => { lanes.push(null); return lanes.length - 1; };
      for (const node of dag.nodes) {
        const arriving: number[] = [];
        for (let i = 0; i < lanes.length; i++) if (lanes[i] === node.id) arriving.push(i);
        const primary = arriving.length ? arriving[0]! : allocate();
        maxLane = Math.max(maxLane, primary);
        const [first, ...rest] = node.parents;
        lanes[primary] = first ?? null;
        for (const i of arriving.slice(1)) lanes[i] = null;
        for (const parentId of rest) { const lane = allocate(); lanes[lane] = parentId; maxLane = Math.max(maxLane, lane); }
      }
      return maxLane;
    }
    expect(appendOnlyMaxLane(repeatingHistory(10))).toBeGreaterThan(5);
    expect(layoutGlyphLaneRows(repeatingHistory(10)).maxLane).toBe(1);
  });
});

// A hand-built 4-lane result (never routed through `layoutGlyphLaneRows`) so
// each lane's activity is exactly known: lane0/1 are touched by every row,
// lane2 by one row (passthrough only), lane3 by two (one as a node's own
// primary lane) — unambiguously the two least-active columns.
function syntheticFourLaneResult(): GlyphLaneRowsResult {
  const node = (id: string): GlyphLaneNode => ({ id, label: id, parents: [] });
  const rows: GlyphLaneRow[] = [
    { type: "node", top: 0, node: node("n0"), lane: 0, passthroughLanes: [1, 2, 3] },
    { type: "node", top: 1, node: node("n1"), lane: 1, passthroughLanes: [0] },
    { type: "node", top: 2, node: node("n2"), lane: 0, passthroughLanes: [1] },
    { type: "node", top: 3, node: node("n3"), lane: 3, passthroughLanes: [0] },
  ];
  return { rows, maxLane: 3, laneOf: new Map([["n0", 0], ["n1", 1], ["n2", 0], ["n3", 3]]) };
}

describe("applyGlyphLaneCap", () => {
  it("collapses the least-active original lanes into one shared overflow column and remaps everything else densely", () => {
    const natural = syntheticFourLaneResult(); // activity: lane0=4, lane1=3, lane2=1, lane3=2 -> least active are lane2, lane3
    const capped = applyGlyphLaneCap(natural, 3); // budget: 2 dense lanes + 1 shared overflow column = 3 total
    expect(capped.columns).toBe(3);
    expect(capped.collapsedLaneIndices).toEqual([2, 3]);
    expect(capped.collapsedNodeIds).toEqual(["n3"]); // only n3 had a collapsed lane as its OWN primary lane
    for (const row of capped.rows) {
      if (row.type === "node") expect(row.lane).toBeLessThan(capped.columns);
      else if (row.type === "connector") for (const lane of [row.hubLane, ...row.mergeLanes, ...row.branchLanes, ...row.passthroughLanes, ...row.untouchedLanes]) expect(lane).toBeLessThan(capped.columns);
    }
    // n0 and n1 (lanes 0/1, the two most active) keep distinct dense columns.
    const n0Row = capped.rows.find((r) => r.type === "node" && r.node.id === "n0") as { lane: number };
    const n1Row = capped.rows.find((r) => r.type === "node" && r.node.id === "n1") as { lane: number };
    expect(n0Row.lane).not.toBe(n1Row.lane);
  });

  it("is a no-op when the cap already covers every lane", () => {
    const natural = layoutGlyphLaneRows(GIT_STYLE);
    const capped = applyGlyphLaneCap(natural, natural.maxLane + 1);
    expect(capped.rows).toBe(natural.rows);
    expect(capped.collapsedLaneIndices).toEqual([]);
  });
});

describe("layoutGlyphLaneRows: truncated windows", () => {
  const WINDOW: GlyphLaneDag = {
    truncated: true,
    nodes: [
      { id: "m", label: "merge", parents: ["a", "side"] },
      { id: "a", label: "a", parents: ["old1"] },
      { id: "side", label: "side", parents: ["old2"] },
    ],
  };

  it("ends with one continuation row listing every lane still waiting on an absent parent", () => {
    // Mutation: drop the trailing continuation push -> no such row -> red.
    const { rows } = layoutGlyphLaneRows(WINDOW);
    const last = rows[rows.length - 1]!;
    expect(last).toMatchObject({ type: "continuation", lanes: [0, 1] });
    expect(rows.filter((r) => r.type === "continuation")).toHaveLength(1);
    expect(last.top).toBe(rows.length - 1);
  });

  it("emits no continuation for a complete history", () => {
    expect(layoutGlyphLaneRows(GIT_STYLE).rows.some((r) => r.type === "continuation")).toBe(false);
  });

  it("pre-opens one lane per incoming id under a leading continuation row, and resolves them at their node", () => {
    // Mutation: ignore options.incoming -> no leading row, lanes unopened -> red.
    const dag: GlyphLaneDag = { nodes: [{ id: "x", label: "x", parents: ["y"] }, { id: "y", label: "y", parents: [] }] };
    const { rows, laneOf } = layoutGlyphLaneRows(dag, { incoming: [{ id: "y", source: "a" }, { id: "y", source: "b" }] });
    expect(rows[0]).toMatchObject({ type: "continuation", top: 0, lanes: [0, 1] });
    expect(rows.map((r) => r.type)).toEqual(["continuation", "node", "connector", "node"]);
    // x takes a fresh lane (2) since both pre-opened lanes wait for y; y then merges all three.
    expect(laneOf.get("x")).toBe(2);
    expect(laneOf.get("y")).toBe(0);
    const merge = rows.find((r) => r.type === "connector");
    expect(merge).toMatchObject({ hubLane: 0, mergeLanes: [1, 2] });
  });

  it("remaps and dedupes a continuation row's lanes when the cap collapses lanes", () => {
    // Mutation: drop the continuation branch of applyGlyphLaneCap -> the row falls through to connector remapping, lanes undefined -> red.
    const wide: GlyphLaneDag = {
      truncated: true,
      nodes: [
        { id: "a", label: "a", parents: ["o1", "o2", "o3", "o4"] },
      ],
    };
    const natural = layoutGlyphLaneRows(wide);
    expect(natural.rows[natural.rows.length - 1]).toMatchObject({ type: "continuation", lanes: [0, 1, 2, 3] });
    const capped = applyGlyphLaneCap(natural, 2);
    const last = capped.rows[capped.rows.length - 1]!;
    if (last.type !== "continuation") throw new Error("expected continuation");
    expect(last.lanes.every((l) => l < capped.columns)).toBe(true);
    expect(new Set(last.lanes).size).toBe(last.lanes.length);
    expect(last.lanes.length).toBeLessThan(4);
  });
});

describe("layoutGlyphLaneRows: incoming and continuesFrom", () => {
  it("ignores an incoming id that no node resolves, drawing no phantom continuation", () => {
    // Mutation: drop the present-id filter -> a leading and a trailing continuation appear -> red.
    const dag: GlyphLaneDag = { nodes: [{ id: "a", label: "a", parents: [] }] };
    const { rows } = layoutGlyphLaneRows(dag, { incoming: [{ id: "ghost", source: "s" }] });
    expect(rows.map((r) => r.type)).toEqual(["node"]);
  });

  it("continues the lane named by continuesFrom, not the leftmost arriving lane, and merges the rest from the side", () => {
    // Lane 0 was opened by "p1", lane 1 by "p0"; x continues p0's lane (1).
    // Mutation: ignore options.continuesFrom -> x lands on lane 0 -> red.
    const dag: GlyphLaneDag = {
      nodes: [
        { id: "r", label: "r", parents: ["p1", "p0"] },
        { id: "p1", label: "p1", parents: ["x"] },
        { id: "p0", label: "p0", parents: ["x"] },
        { id: "x", label: "x", parents: [] },
      ],
    };
    expect(layoutGlyphLaneRows(dag).laneOf.get("x")).toBe(0);
    const { laneOf, rows } = layoutGlyphLaneRows(dag, { continuesFrom: new Map([["x", "p0"]]) });
    expect(laneOf.get("x")).toBe(1);
    expect(rows.find((r) => r.type === "connector" && r.mergeLanes.length > 0)).toMatchObject({ hubLane: 1, mergeLanes: [0] });
  });

  it("counts a continuation row toward lane activity, so the cap collapses the right lanes", () => {
    // Lane 2 is touched by one node row plus the continuation, so it ties
    // lane 1 at 2 and survives; without the continuation bump it ties lane 0
    // at 1 and is collapsed in lane 1's place.
    // Mutation: remove the continuation bump in laneActivity -> collapsed is [0, 2] -> red.
    const node = (id: string): GlyphLaneNode => ({ id, label: id, parents: [] });
    const rows: GlyphLaneRow[] = [
      { type: "node", top: 0, node: node("a"), lane: 1, passthroughLanes: [2] },
      { type: "node", top: 1, node: node("b"), lane: 1, passthroughLanes: [] },
      { type: "node", top: 2, node: node("c"), lane: 0, passthroughLanes: [] },
      { type: "continuation", top: 3, lanes: [2], waitingFor: ["old"] },
    ];
    const capped = applyGlyphLaneCap({ rows, maxLane: 2, laneOf: new Map() }, 2);
    expect(capped.collapsedLaneIndices).toEqual([0, 1]);
  });
});
