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

  it("no two siblings in a rank share BOTH in-plane coordinates (mutation: collapse the ring to a single line) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), {});
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    const inPlane = (n: typeof a) => [n.center[1], n.center[2]] as const; // LR in-plane = (Y depth, Z vertical)
    const [ay, az] = inPlane(a), [by, bz] = inPlane(b), [cy, cz] = inPlane(c);
    const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);
    expect(dist(ay, az, by, bz)).toBeGreaterThan(0.5);
    expect(dist(by, bz, cy, cz)).toBeGreaterThan(0.5);
    expect(dist(ay, az, cy, cz)).toBeGreaterThan(0.5);
  });

  it("3 siblings form a non-collinear triangle — area above a threshold (mutation: place them on one axis-aligned line) → red", async () => {
    const laid = await layout3d(fanOutGraph("LR"), {});
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

describe("layout3d — force (unchanged by D2 round 7)", () => {
  it("the same seed reproduces a PINNED golden digest (mutation: seed the PRNG from Date.now() instead of the option) → red", async () => {
    const graph = groupedGraph();
    const a = await layout3d(graph, { layout: "force", seed: 42, iterations: 60 });
    const digest = a.nodes.map((nd) => nd.center.map((v) => Math.round(v * 1e6) / 1e6));
    // Re-pinned when the force layout's ideal distance moved from
    // `avgFootprint * 1.5` to `GLYPH_DIAGRAM_3D_FORCE_SPACING` (2.6) and
    // began deriving that footprint from the size a node is actually DRAWN
    // at. Every coordinate here is the previous golden times exactly
    // 2.6/1.5 — a pure uniform scale, so the LAYOUT this pins is unchanged
    // and only its spacing grew; the determinism clauses below are what the
    // test exists for and were never affected.
    expect(digest).toEqual([
      [1.69706, -7.711444, 17.170425],
      [10.710401, 3.051786, -15.501525],
      [-6.795372, 21.935358, -0.53521],
      [1.377869, -32.472922, 48.039576],
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

describe("layout3d — sized-slab rank spacing (CNN layers unreadable in 3D)", () => {
  // Same `size` on both nodes and every axis holds `compressExplicitSizes`
  // at a no-op (raw === max on every axis, so compression's `(raw/max)^0.5`
  // is exactly 1 and no 4x-ratio floor kicks in) — half-extents below are
  // computed directly from `size`, not re-derived from the module's own
  // formula, so this test can't pass by tautology.
  //   size = [2, 10, 6] -> half = [1 (flow, LR), 3 (depth, Y), 5 (cross, Z)]
  //   conservative (screenSafeFlowHalf) = 1 + 5 + 3 = 9 per node
  //   tight (flow + depth only)          = 1 + 3     = 4 per node
  const sizedPairNode = (id: string, label: string): GlyphGraph["nodes"][number] => ({ id, label, size: [2, 10, 6] });

  it("LR: a rank gap where BOTH ranks carry an explicit `size` is spaced by flow+depth half-extents only, dropping cross (mutation: keep summing cross too) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [sizedPairNode("a", "A"), sizedPairNode("b", "B")],
      edges: [{ from: "a", to: "b" }],
    };
    const laid = await layout3d(graph, {});
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!;
    // tight: (1+3) + GAP + (1+3) — GAP is small (module-internal, not
    // exported); assert well under the conservative alternative (9+GAP+9)
    // rather than pin the exact constant, so this test survives a GAP retune.
    const gap = b.center[0] - a.center[0];
    expect(gap).toBeCloseTo(8 + 5, 6); // matches GLYPH_DIAGRAM_3D_RANK_GAP_SIZED = 5 at time of writing
    expect(gap).toBeLessThan(9 + 9 + 1); // well clear of the conservative bound (9+GAP+9 >= 23)
  });

  it("LR: a rank gap touching an UNSIZED neighbour stays on the full conservative bound, even when the other rank is sized (mutation: tighten per-node instead of per-gap) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [sizedPairNode("a", "A"), sizedPairNode("b", "B"), { id: "c", label: "Plain, no size at all so it forces the conservative bound" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    };
    const laid = await layout3d(graph, {});
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!, c = laid.nodes.find((n) => n.id === "c")!;
    const sizedGap = b.center[0] - a.center[0];
    const mixedGap = c.center[0] - b.center[0];
    // b's OWN half-extent contribution must differ by gap: tight (4) into
    // "a", conservative (9) into "c" — a per-node (not per-gap) tightening
    // would make both gaps equal.
    expect(mixedGap).toBeGreaterThan(sizedGap + 4); // conservative adds >= 5 more from b's side alone (9 vs 4)
  });

  it("TB: an all-sized rank pair still uses the FULL conservative bound — the LR/RL-only proof does not extend to a vertical flow (mutation: tighten TB/BT too) → red", async () => {
    const graph: GlyphGraph = {
      direction: "TB",
      nodes: [sizedPairNode("a", "A"), sizedPairNode("b", "B")],
      edges: [{ from: "a", to: "b" }],
    };
    const laid = await layout3d(graph, {});
    const a = laid.nodes.find((n) => n.id === "a")!, b = laid.nodes.find((n) => n.id === "b")!;
    // TB flow axis is Z; flowHalf = height/2 = 5, depthHalf = 3, crossHalf (X) = 1.
    // Conservative: (5+1+3) + GAP + (5+1+3) = 9 + GAP + 9. TB's own flow
    // direction is negative Z, so compare magnitudes.
    const gap = Math.abs(a.center[2] - b.center[2]);
    expect(gap).toBeCloseTo(9 + 5 + 9, 6);
  });

  it("an UNSIZED graph's layout is untouched byte-for-byte by the sized-pair spacing branch (mutation: let the tight branch fire without every node in BOTH ranks actually having a `size`) → red", async () => {
    const graph: GlyphGraph = {
      direction: "LR",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    };
    const laid = await layout3d(graph, {});
    const digest = laid.nodes.map((n) => ({ id: n.id, center: n.center.map((v) => Math.round(v * 1e6) / 1e6) }));
    // Pinned against the pre-existing (pre-this-round) `screenSafeFlowHalf`-only
    // formula — a label-derived chain with default `nodesep`/`ranksep`.
    expect(digest).toEqual([
      { id: "a", center: [10.5, 0, 0] },
      { id: "b", center: [36.5, 0, 0] },
      { id: "c", center: [62.5, 0, 0] },
    ]);
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
