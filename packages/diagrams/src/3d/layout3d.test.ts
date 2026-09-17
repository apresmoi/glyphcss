import { describe, expect, it } from "vitest";
import type { GlyphGraph } from "../types";
import { layout3d, GLYPH_DIAGRAM_3D_CAMERA_ROT_X, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y } from "./layout3d";

/**
 * D2 round 7 acceptance gates for `layout3d`'s `"layered"` path (the
 * stage-by-stage triangulated flow — this file's own top-of-file doc has
 * the full derivation) and, unchanged, `"force"`. Each `it` names, in a
 * comment, the mutation it is meant to redden.
 */

function groupedGraph(): GlyphGraph {
  return {
    direction: "TB",
    nodes: [
      { id: "a", label: "Planner" },
      { id: "b", label: "Coder" },
      { id: "c", label: "Reviewer" },
      { id: "d", label: "Orchestrator" },
    ],
    edges: [
      { from: "d", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" },
    ],
    groups: [{ id: "agents", label: "Agents", members: ["a", "b", "c"] }],
  };
}

/** A 3-way fan-out (one rank with 3 siblings) — the shape the "triangulated" gates below exercise. */
function fanOutGraph(direction: GlyphGraph["direction"] = "LR"): GlyphGraph {
  return {
    direction,
    nodes: [
      { id: "in", label: "In" }, { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" },
    ],
    edges: [{ from: "in", to: "a" }, { from: "in", to: "b" }, { from: "in", to: "c" }],
  };
}

describe("layout3d — layered (D2 round 7 triangulated stage-by-stage flow)", () => {
  it("LR: every node's flow coordinate is world X; TB: world Z (mutation: swap the flow axis per direction) → red", async () => {
    const lr = await layout3d(fanOutGraph("LR"), {});
    const tb = await layout3d(fanOutGraph("TB"), {});
    const inLr = lr.nodes.find((n) => n.id === "in")!, aLr = lr.nodes.find((n) => n.id === "a")!;
    expect(aLr.center[0]).not.toBeCloseTo(inLr.center[0], 3); // X (flow) genuinely differs
    const inTb = tb.nodes.find((n) => n.id === "in")!, aTb = tb.nodes.find((n) => n.id === "a")!;
    expect(aTb.center[2]).not.toBeCloseTo(inTb.center[2], 3); // Z (flow) genuinely differs
    expect(aTb.center[2]).toBeLessThan(inTb.center[2]); // TB flows top->bottom: decreasing Z as rank increases
  });

  it("siblings in a rank share the SAME flow-axis coordinate (mutation: let a sibling drift along flow) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), {});
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    expect(a.center[0]).toBeCloseTo(b.center[0], 6);
    expect(b.center[0]).toBeCloseTo(c.center[0], 6);
  });

  // D2 round 9: `rankArrangement: "ring"` explicit — the default is now
  // `"row"` (see the "row arrangement (D2 round 9, the new default)"
  // describe block below), so these two ring-specific gates pin `"ring"`
  // itself, unchanged in strength, rather than testing a mode nothing
  // reaches by default any more.
  it("ring: no two siblings in a rank share BOTH in-plane coordinates (mutation: collapse the ring to a single line) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), { rankArrangement: "ring" });
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    const inPlane = (n: typeof a) => [n.center[1], n.center[2]] as const; // LR in-plane = (Y depth, Z vertical)
    const [ay, az] = inPlane(a), [by, bz] = inPlane(b), [cy, cz] = inPlane(c);
    const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);
    expect(dist(ay, az, by, bz)).toBeGreaterThan(0.5);
    expect(dist(by, bz, cy, cz)).toBeGreaterThan(0.5);
    expect(dist(ay, az, cy, cz)).toBeGreaterThan(0.5);
  });

  it("ring: 3 siblings form a non-collinear triangle — area above a threshold (mutation: place them on one axis-aligned line) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), { rankArrangement: "ring" });
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    const [ay, az] = [a.center[1], a.center[2]], [by, bz] = [b.center[1], b.center[2]], [cy, cz] = [c.center[1], c.center[2]];
    const area = Math.abs((by - ay) * (cz - az) - (bz - az) * (cy - ay)) / 2;
    expect(area).toBeGreaterThan(1);
  });

  it("a single-member rank (a join/merge) stays exactly on the flow axis — both in-plane offsets are zero (mutation: give a lone rank member a nonzero ring offset) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "join", label: "Join" }],
      edges: [{ from: "a", to: "join" }, { from: "b", to: "join" }],
    };
    const laid = await layout3d(graph, {});
    const join = laid.nodes.find((n) => n.id === "join")!;
    expect(join.center[1]).toBeCloseTo(0, 6); // depth (Y)
    expect(join.center[2]).toBeCloseTo(0, 6); // vertical (Z), LR's own cross axis
  });

  it("order within a rank follows dagre's own within-rank (crossing-minimized) order, not declaration order (mutation: assign ring positions in raw input order) → red", async () => {
    // Declared in the order c, a, b — dagre's own within-rank sort should
    // still place them by ITS crossing-minimized order, not this order.
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [{ id: "in", label: "In" }, { id: "c", label: "C" }, { id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "in", to: "a" }, { from: "in", to: "b" }, { from: "in", to: "c" }],
    };
    const laid = await layout3d(graph, {});
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    // All three at DISTINCT ring positions regardless of order — the real
    // gate is "no two collide", already covered above; this just confirms
    // the graph renders with 3 distinct siblings (order itself is an
    // implementation detail of dagre, not independently re-verified here).
    const positions = [a, b, c].map((n) => `${n.center[1].toFixed(3)},${n.center[2].toFixed(3)}`);
    expect(new Set(positions).size).toBe(3);
  });

  it("an edge's endpoints land on the source's/target's own flow-facing face (mutation: anchor edges at the node centre) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), {});
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    for (const edge of laid.edges) {
      const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
      const p0 = edge.points[0]!, p1 = edge.points[edge.points.length - 1]!;
      // Source exit sits on its own +X face (flow forward for LR).
      expect(p0[0]).toBeCloseTo(from.center[0] + from.half[0], 6);
      // Target entry sits on its own -X face.
      expect(p1[0]).toBeCloseTo(to.center[0] - to.half[0], 6);
    }
  });

  it("a group's own AABB contains every one of its members, padded (mutation: compute the group box from a subset of members) → red", async () => {
    const laid = await layout3d(groupedGraph(), {});
    const group = laid.groups.find((g) => g.id === "agents")!;
    const members = laid.nodes.filter((nd) => ["a", "b", "c"].includes(nd.id));
    for (const m of members) {
      for (let axis = 0; axis < 3; axis++) {
        expect(m.center[axis] - m.half[axis]).toBeGreaterThanOrEqual(group.min[axis] - 1e-6);
        expect(m.center[axis] + m.half[axis]).toBeLessThanOrEqual(group.max[axis] + 1e-6);
      }
    }
  });

  it("no edge, in any layout, is ever reported unroutable (mutation: reintroduce 2D A* routing for the layered path) → red", async () => {
    const laid = await layout3d(groupedGraph(), {});
    expect(laid.edges.length).toBe(4);
    expect(laid.ledger.some((e) => e.code === "unroutable")).toBe(false);
  });

  it("the fixed default camera constants are exported and finite (a plain sanity check the render path's own defaults depend on)", () => {
    expect(Number.isFinite(GLYPH_DIAGRAM_3D_CAMERA_ROT_X)).toBe(true);
    expect(Number.isFinite(GLYPH_DIAGRAM_3D_CAMERA_ROT_Y)).toBe(true);
  });

  // The coordinator's own check (D2 round 7 layout-direction follow-up,
  // verbatim): "Use `Merge` + `Side` -> `Output` from the fan-join-split
  // example as the check: `Merge` and `Side` should read as one front, one
  // back, both feeding `Output`." `merge`'s rank has 2 members
  // (`s1`+`s2` -> `merge`, `s3` -> `side`), so the triangulation places
  // them at opposite ends of one ring diameter — one at positive depth
  // ("front"), one at negative ("back") — never side by side on the same
  // depth.
  // Left at the module's own DEFAULT (`rankArrangement: "row"` since D2
  // round 9) rather than pinned to `"ring"`: `GLYPH_DIAGRAM_3D_ROW_AXIS`
  // resolves to world Y for both direction regimes, so a row spread also
  // opposes-sign this 2-member rank exactly the way a ring diameter did —
  // this gate still reddens under a genuine regression either way.
  it("fan-join-split: Merge and Side share the SAME flow coordinate (one rank) but sit at opposite DEPTH signs — front/back, never side by side (mutation: collapse the ring to a single line) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [
        { id: "input", label: "Input" }, { id: "a", label: "Branch A" }, { id: "b", label: "Branch B" }, { id: "c", label: "Branch C" },
        { id: "join", label: "Join" }, { id: "s1", label: "Split 1" }, { id: "s2", label: "Split 2" }, { id: "s3", label: "Split 3" },
        { id: "merge", label: "Merge" }, { id: "side", label: "Side" }, { id: "output", label: "Output" },
      ],
      edges: [
        { from: "input", to: "a" }, { from: "input", to: "b" }, { from: "input", to: "c" },
        { from: "a", to: "join" }, { from: "b", to: "join" }, { from: "c", to: "join" },
        { from: "join", to: "s1" }, { from: "join", to: "s2" }, { from: "join", to: "s3" },
        { from: "s1", to: "merge" }, { from: "s2", to: "merge" }, { from: "s3", to: "side" },
        { from: "merge", to: "output" }, { from: "side", to: "output" },
      ],
    };
    const laid = await layout3d(graph, {});
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const merge = byId.get("merge")!, side = byId.get("side")!, output = byId.get("output")!;
    expect(merge.center[0]).toBeCloseTo(side.center[0], 3); // same rank -> same flow (X) coordinate
    // Opposite DEPTH sign (world Y, always the depth axis per this file's
    // own convention) — a genuine front/back split, not a same-side pair.
    expect(Math.sign(merge.center[1])).not.toBe(Math.sign(side.center[1]));
    expect(Math.abs(merge.center[1])).toBeGreaterThan(0.01);
    expect(Math.abs(side.center[1])).toBeGreaterThan(0.01);
    // Both feed the SAME output node, further along the flow axis.
    expect(Math.abs(output.center[0])).toBeGreaterThan(Math.abs(merge.center[0]));
    expect(laid.ledger.some((e) => e.code === "unroutable")).toBe(false);
  });
});

describe("layout3d — row arrangement (D2 round 9, the new default: \"clear levels\")", () => {
  it("row is the DEFAULT — omitting rankArrangement matches an explicit \"row\" byte-for-byte (mutation: default to \"ring\" instead) → red", async () => {
    const implicit = await layout3d(fanOutGraph("LR"), {});
    const explicit = await layout3d(fanOutGraph("LR"), { rankArrangement: "row" });
    expect(implicit.nodes.map((n) => n.center)).toEqual(explicit.nodes.map((n) => n.center));
  });

  it("row: every sibling in a rank sits on the SAME single in-plane axis (the other in-plane coordinate is exactly 0) — a deliberate straight line, not a ring (mutation: give a sibling a nonzero offset on the other axis) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), { rankArrangement: "row" });
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    // LR's in-plane pair is (Y depth = "b", Z vertical = "a"); the row
    // axis resolves to "b" (world Y) at this module's own fixed camera —
    // this file's own top-of-file doc has the measured derivation.
    for (const n of [a, b, c]) expect(n.center[2]).toBeCloseTo(0, 6);
    // Still 3 genuinely distinct positions along that one axis.
    const ys = [a.center[1], b.center[1], c.center[1]];
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(3);
  });

  it("row: siblings are centred on the rank's own flow-axis line (mutation: shift the whole row off-centre) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), { rankArrangement: "row" });
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    const ys = [a.center[1], b.center[1], c.center[1]].sort((x, y) => x - y);
    expect(ys[0]! + ys[2]!).toBeCloseTo(0, 6); // symmetric about the centre; ys[1] (the middle sibling) sits exactly on it
    expect(ys[1]).toBeCloseTo(0, 6);
  });

  it("row: a single-member rank still stays exactly on the flow axis (mutation: give a lone rank member a nonzero row offset) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "join", label: "Join" }],
      edges: [{ from: "a", to: "join" }, { from: "b", to: "join" }],
    };
    const laid = await layout3d(graph, { rankArrangement: "row" });
    const join = laid.nodes.find((n) => n.id === "join")!;
    expect(join.center[1]).toBeCloseTo(0, 6);
    expect(join.center[2]).toBeCloseTo(0, 6);
  });

  // Part 1's own "clear levels" DEFINITION OF DONE: adjacent ranks' own
  // projected screen bands (along whichever screen axis the flow axis
  // primarily maps to at this module's fixed default camera — row for
  // TB/BT, column for LR/RL) must never overlap, so a reader can tell
  // "these boxes are one level" from "these are two". A dense multi-rank
  // fan (this graph: input -> 3-way fan -> a 4-way fan -> output) is a
  // harder case than the earlier 3-sibling fixtures — every one of a wide
  // rank's own row-spread members must still clear its neighbour ranks.
  it("row: adjacent ranks' own projected screen bands never overlap, LR (mutation: drop the offset-magnitude term from rank spacing) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [
        { id: "in", label: "In" },
        { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" },
        { id: "w", label: "W" }, { id: "x", label: "X" }, { id: "y", label: "Y" }, { id: "z", label: "Z" },
        { id: "out", label: "Out" },
      ],
      edges: [
        { from: "in", to: "a" }, { from: "in", to: "b" }, { from: "in", to: "c" },
        { from: "a", to: "w" }, { from: "a", to: "x" }, { from: "b", to: "y" }, { from: "c", to: "z" },
        { from: "w", to: "out" }, { from: "x", to: "out" }, { from: "y", to: "out" }, { from: "z", to: "out" },
      ],
    };
    const laid = await layout3d(graph, { rankArrangement: "row" });
    const { createGlyphOrthographicCamera } = await import("glyphcss");
    const { GLYPH_DIAGRAM_3D_CAMERA_ROT_X: rotX, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y: rotY } = await import("./layout3d");
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 50 });
    const cols = 110, rows = 34, aspect = 2.0;
    // Cluster by the raw flow-axis (X, LR) coordinate — same tolerance
    // `layout3d.ts`'s own internal `clusterRanks` uses.
    const byFlow = [...laid.nodes].sort((n1, n2) => n1.center[0] - n2.center[0]);
    const ranks: (typeof laid.nodes[number])[][] = [];
    for (const n of byFlow) {
      const last = ranks[ranks.length - 1];
      if (last && Math.abs(last[0]!.center[0] - n.center[0]) <= 1) last.push(n);
      else ranks.push([n]);
    }
    expect(ranks.length).toBeGreaterThanOrEqual(4); // in, {a,b,c}, {w,x,y,z}, out
    // LR flow is column-dominant at this camera — band along screen COLUMN.
    const bandOf = (rank: typeof ranks[number]) => {
      let min = Infinity, max = -Infinity;
      for (const n of rank) {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const p: [number, number, number] = [n.center[0] + sx * n.half[0], n.center[1] + sy * n.half[1], n.center[2] + sz * n.half[2]];
          const [col] = camera.project(p, cols, rows, aspect);
          min = Math.min(min, col); max = Math.max(max, col);
        }
      }
      return { min, max };
    };
    const bands = ranks.map(bandOf);
    for (let i = 0; i < bands.length - 1; i++) {
      const overlap = bands[i]!.max >= bands[i + 1]!.min && bands[i]!.min <= bands[i + 1]!.max;
      expect(overlap, `rank ${i} band [${bands[i]!.min.toFixed(1)},${bands[i]!.max.toFixed(1)}] vs rank ${i + 1} [${bands[i + 1]!.min.toFixed(1)},${bands[i + 1]!.max.toFixed(1)}]`).toBe(false);
    }
  });
});

describe("layout3d — force (unchanged by D2 round 7)", () => {
  it("the same seed reproduces a PINNED golden digest (mutation: seed the PRNG from Date.now() instead of the option) → red", async () => {
    const graph = groupedGraph();
    const a = await layout3d(graph, { layout: "force", seed: 42, iterations: 60 });
    const digest = a.nodes.map((nd) => nd.center.map((v) => Math.round(v * 1e6) / 1e6));
    expect(digest).toEqual([
      [0.979073, -4.44891, 9.906014],
      [6.179078, 1.760646, -8.943187],
      [-3.920407, 12.655014, -0.308775],
      [0.794924, -18.734378, 27.71514],
    ]);
    const b = await layout3d(graph, { layout: "force", seed: 42, iterations: 60 });
    expect(a.nodes.map((nd) => nd.center)).toEqual(b.nodes.map((nd) => nd.center));
    expect(a.edges.map((e) => e.points)).toEqual(b.edges.map((e) => e.points));
  });

  it("two different seeds land on different layouts", async () => {
    const graph = groupedGraph();
    const a = await layout3d(graph, { layout: "force", seed: 1, iterations: 60 });
    const b = await layout3d(graph, { layout: "force", seed: 2, iterations: 60 });
    expect(a.nodes.map((nd) => nd.center)).not.toEqual(b.nodes.map((nd) => nd.center));
  });

  it("force edge endpoints land on the node's own box face in full 3D (mutation: clamp only the XY axes) → red", async () => {
    const laid = await layout3d(groupedGraph(), { layout: "force", seed: 7, iterations: 80 });
    const byId = new Map(laid.nodes.map((nd) => [nd.id, nd]));
    for (const edge of laid.edges) {
      const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
      for (const [point, node] of [[edge.points[0]!, from], [edge.points[edge.points.length - 1]!, to]] as const) {
        const dx = Math.abs(point[0] - node.center[0]), dy = Math.abs(point[1] - node.center[1]), dz = Math.abs(point[2] - node.center[2]);
        expect(dx).toBeLessThanOrEqual(node.half[0] + 1e-6);
        expect(dy).toBeLessThanOrEqual(node.half[1] + 1e-6);
        expect(dz).toBeLessThanOrEqual(node.half[2] + 1e-6);
        const onAnAxis = Math.abs(dx - node.half[0]) < 1e-6 || Math.abs(dy - node.half[1]) < 1e-6 || Math.abs(dz - node.half[2]) < 1e-6;
        expect(onAnAxis).toBe(true);
      }
    }
  });

  it("a box node's self-loop leaves and re-enters its own face (force layout)", async () => {
    const graph: GlyphGraph = {
      direction: "TB",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "a" }, { from: "a", to: "b" }],
    };
    const laid = await layout3d(graph, { layout: "force", seed: 3, iterations: 40 });
    const a = laid.nodes.find((nd) => nd.id === "a")!;
    const loop = laid.edges.find((e) => e.from === "a" && e.to === "a")!;
    expect(loop.points.length).toBeGreaterThanOrEqual(3);
    const p0 = loop.points[0]!, p1 = loop.points[loop.points.length - 1]!;
    expect(p0).not.toEqual(p1);
    for (const point of [p0, p1]) {
      const dx = Math.abs(point[0] - a.center[0]), dy = Math.abs(point[1] - a.center[1]), dz = Math.abs(point[2] - a.center[2]);
      expect(dx).toBeLessThanOrEqual(a.half[0] + 1e-6);
      expect(dy).toBeLessThanOrEqual(a.half[1] + 1e-6);
      expect(dz).toBeLessThanOrEqual(a.half[2] + 1e-6);
      const onAnAxis = Math.abs(dx - a.half[0]) < 1e-6 || Math.abs(dy - a.half[1]) < 1e-6 || Math.abs(dz - a.half[2]) < 1e-6;
      expect(onAnAxis).toBe(true);
    }
  });
});

describe("layout3d — self-loops (layered, D2 round 7: a straight-segment fallback, not a 2D-routed bulge)", () => {
  it("a self-loop resolves without throwing and both its endpoints sit on the node's own box face", async () => {
    const graph: GlyphGraph = {
      direction: "TB",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "a" }, { from: "a", to: "b" }],
    };
    const laid = await layout3d(graph, {});
    const a = laid.nodes.find((nd) => nd.id === "a")!;
    const loop = laid.edges.find((e) => e.from === "a" && e.to === "a");
    expect(loop).toBeDefined();
    expect(loop!.points.length).toBeGreaterThanOrEqual(2);
    for (const point of [loop!.points[0]!, loop!.points[loop!.points.length - 1]!]) {
      const dx = Math.abs(point[0] - a.center[0]), dy = Math.abs(point[1] - a.center[1]), dz = Math.abs(point[2] - a.center[2]);
      const onAnAxis = Math.abs(dx - a.half[0]) < 1e-6 || Math.abs(dy - a.half[1]) < 1e-6 || Math.abs(dz - a.half[2]) < 1e-6;
      expect(onAnAxis).toBe(true);
    }
  });
});

describe("layout3d — size compression (D2 round 4, unaffected by D2 round 7's layout change)", () => {
  it("explicit per-node `size` is compressed per axis and the largest:smallest ratio is clamped to <= 4x (mutation: use size verbatim) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [
        { id: "big", label: "Big", size: [32, 4, 4] },
        { id: "small", label: "Small", size: [2, 4, 4] },
      ],
      edges: [{ from: "big", to: "small" }],
    };
    const laid = await layout3d(graph, {});
    const big = laid.nodes.find((nd) => nd.id === "big")!, small = laid.nodes.find((nd) => nd.id === "small")!;
    expect(big.half[0] / small.half[0]).toBeLessThanOrEqual(4 + 1e-9);
    expect(small.half[0]).toBeGreaterThan(1);
    expect(big.half[0]).toBeCloseTo(16, 6);
    expect(big.half[2]).toBeCloseTo(small.half[2], 6);
  });

  it("a node with NO explicit size is untouched by another node's compression, and its default depth/height follow the module's own depth-factor band (mutation: apply compression graph-wide, or use a flat constant depth) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [
        { id: "big", label: "Big", size: [32, 4, 4] },
        { id: "plain", label: "Plain" }, // no `size` at all
      ],
      edges: [{ from: "big", to: "plain" }],
    };
    const laid = await layout3d(graph, {});
    const plain = laid.nodes.find((nd) => nd.id === "plain")!;
    const width = plain.half[0] * 2, height = plain.half[2] * 2, depth = plain.half[1] * 2;
    const ratio = depth / Math.min(width, height);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThanOrEqual(0.6 + 1e-9);
  });
});

describe("layout3d — validation", () => {
  it("rejects a non-integer seed and a non-positive iterations count with a tagged error", async () => {
    await expect(layout3d(groupedGraph(), { layout: "force", seed: 1.5 })).rejects.toThrow(/bad-options/);
    await expect(layout3d(groupedGraph(), { layout: "force", iterations: 0 })).rejects.toThrow(/bad-options/);
  });

  it("rejects an unknown layout kind", async () => {
    // @ts-expect-error — deliberately invalid input for the runtime check
    await expect(layout3d(groupedGraph(), { layout: "radial" })).rejects.toThrow(/bad-options/);
  });
});
