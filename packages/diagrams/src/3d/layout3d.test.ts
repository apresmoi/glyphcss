import { describe, expect, it } from "vitest";
import type { Vec3 } from "glyphcss";
import type { GlyphGraph } from "../types";
import { layoutGlyphGraph } from "../pipeline";
import { layout3d, GLYPH_DIAGRAM_3D_NODE_HEIGHT, type GlyphDiagram3dNode } from "./layout3d";

/**
 * Packet D1 (PLAN-3d.md §6, §11) acceptance gates for `layout3d`. Each `it`
 * names, in a comment, the mutation the PLAN requires it to redden.
 */

function chainGraph(n: number): GlyphGraph {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  return { nodes, edges, direction: "TB" };
}

/**
 * A chain whose EDGES run backward against declaration order (`n4 -> n3 ->
 * ... -> n0`), so rank 0 is `n4` and rank `n-1` is `n0` — the opposite of
 * both id order and `layoutGlyphGraph`'s own node-array (declaration) order.
 * `chainGraph`'s forward chain can't catch "map dagre Y onto world X
 * instead of Y": each rank there holds exactly one node, so the X (spread)
 * axis is degenerate (every node centred at the same X) and a stable sort
 * on it silently falls back to declaration order — which for a FORWARD
 * chain already equals the correct rank order, so the mutation is invisible
 * (review finding P2, D1). Reversed, a stable sort on the degenerate X axis
 * reproduces declaration order (`n0..n(n-1)`) while the real rank order is
 * its reverse, so the two diverge and the mutation reddens.
 */
function reverseChainGraph(n: number): GlyphGraph {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${n - 1 - i}`, to: `n${n - 2 - i}` }));
  return { nodes, edges, direction: "TB" };
}

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

describe("layout3d — layered", () => {
  it("top view (project out Z) reproduces the 2D rank order (mutation: map dagre Y onto world X instead of world Y) → red", async () => {
    const graph = reverseChainGraph(5);
    const laid2d = await layoutGlyphGraph(graph, { direction: "TB" });
    const laid3d = await layout3d(graph, { direction: "TB", zBy: "none" });
    const order2d = [...laid2d.nodes].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1)).map((n) => n.id);
    const order3d = [...laid3d.nodes].sort((a, b) => a.center[1] - b.center[1]).map((n) => n.id);
    // Rank order (n4 first) genuinely differs from both id order and
    // `layoutGlyphGraph`'s declaration order (n0 first) — see
    // `reverseChainGraph`'s own doc for why the forward chain couldn't
    // distinguish a correct mapping from a swapped one.
    expect(order2d).toEqual(["n4", "n3", "n2", "n1", "n0"]);
    expect(order3d).toEqual(order2d);
  });

  it("zBy: group puts every group's members on ONE shared floor, above the ungrouped baseline (mutation: read node.group instead of the smallest containing graph.groups entry) → red", async () => {
    const laid = await layout3d(groupedGraph(), { zBy: "group" });
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const a = byId.get("a")!, b = byId.get("b")!, c = byId.get("c")!, d = byId.get("d")!;
    expect(a.center[2]).toBe(b.center[2]);
    expect(b.center[2]).toBe(c.center[2]);
    expect(a.center[2]).not.toBe(d.center[2]); // d is ungrouped — stays on the baseline floor
    expect(d.center[2]).toBe(0 + GLYPH_DIAGRAM_3D_NODE_HEIGHT / 2); // baseline floor (index 0) + half node height
  });

  it("zBy: none flattens every node onto z=0 + half node height (mutation: fall through to the group branch) → red", async () => {
    const laid = await layout3d(groupedGraph(), { zBy: "none" });
    const zs = new Set(laid.nodes.map((n) => n.center[2]));
    expect(zs.size).toBe(1);
  });

  it("a same-floor edge is a straight 2-point path; a cross-floor edge steps Z at its own XY midpoint (mutation: drop the Z step) → red", async () => {
    const laid = await layout3d(groupedGraph(), { zBy: "group" });
    const sameFloor = laid.edges.find((e) => e.from === "a" && e.to === "b")!; // both on the "agents" floor
    expect(sameFloor.points).toHaveLength(2);
    expect(sameFloor.points[0]![2]).toBe(sameFloor.points[1]![2]);

    const crossFloor = laid.edges.find((e) => e.from === "d" && e.to === "a")!; // d is ungrouped, a is on "agents"
    expect(crossFloor.points.length).toBeGreaterThanOrEqual(4);
    const zs = crossFloor.points.map((p) => p[2]);
    expect(new Set(zs).size).toBeGreaterThan(1); // it actually changes floors
  });

  it("edge endpoints land on the node's own box face, never inside it or floating off it (mutation: return the raw node center instead of clamping to the box) → red", async () => {
    const laid = await layout3d(groupedGraph(), { zBy: "group" });
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    for (const edge of laid.edges) {
      const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
      const p0 = edge.points[0]!, p1 = edge.points[edge.points.length - 1]!;
      for (const [point, node] of [[p0, from], [p1, to]] as const) {
        const dx = Math.abs(point[0] - node.center[0]), dy = Math.abs(point[1] - node.center[1]), dz = Math.abs(point[2] - node.center[2]);
        // On the boundary: every axis within its half-extent (+ epsilon), and at least one axis AT its half-extent.
        expect(dx).toBeLessThanOrEqual(node.half[0] + 1e-6);
        expect(dy).toBeLessThanOrEqual(node.half[1] + 1e-6);
        expect(dz).toBeLessThanOrEqual(node.half[2] + 1e-6);
        const onAnAxis = Math.abs(dx - node.half[0]) < 1e-6 || Math.abs(dy - node.half[1]) < 1e-6 || Math.abs(dz - node.half[2]) < 1e-6;
        expect(onAnAxis).toBe(true);
      }
    }
  });

  it("a circle-shaped node's edge endpoints land on its sphere surface", async () => {
    const graph: GlyphGraph = {
      direction: "TB",
      nodes: [{ id: "a", label: "A", shape: "circle" }, { id: "b", label: "B", shape: "circle" }],
      edges: [{ from: "a", to: "b" }],
    };
    const laid = await layout3d(graph, { zBy: "none" });
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const edge = laid.edges[0]!;
    for (const point of [edge.points[0]!, edge.points[edge.points.length - 1]!]) {
      const node = point === edge.points[0] ? byId.get(edge.from)! : byId.get(edge.to)!;
      const r = Math.max(...node.half);
      const dist = Math.hypot(point[0] - node.center[0], point[1] - node.center[1], point[2] - node.center[2]);
      expect(dist).toBeCloseTo(r, 6);
    }
  });
});

describe("layout3d — force", () => {
  it("the same seed reproduces a PINNED golden digest (mutation: seed the PRNG from Date.now() instead of the option) → red", async () => {
    // Two live runs comparing against EACH OTHER can't catch a `Date.now()`
    // seed: two calls in the same test tick can return the same millisecond
    // (review finding P2, D1) — so this asserts against a digest computed
    // once and pinned here, which a clock-seeded PRNG reproduces only by
    // coincidence.
    const graph = groupedGraph();
    const a = await layout3d(graph, { layout: "force", seed: 42, iterations: 60 });
    const digest = a.nodes.map((n) => n.center.map((v) => Math.round(v * 1e6) / 1e6));
    expect(digest).toEqual([
      [0.979073, -4.44891, 9.906014],
      [6.179078, 1.760646, -8.943187],
      [-3.920407, 12.655014, -0.308775],
      [0.794924, -18.734378, 27.71514],
    ]);
    const b = await layout3d(graph, { layout: "force", seed: 42, iterations: 60 });
    expect(a.nodes.map((n) => n.center)).toEqual(b.nodes.map((n) => n.center));
    expect(a.edges.map((e) => e.points)).toEqual(b.edges.map((e) => e.points));
  });

  it("two different seeds land on different layouts", async () => {
    const graph = groupedGraph();
    const a = await layout3d(graph, { layout: "force", seed: 1, iterations: 60 });
    const b = await layout3d(graph, { layout: "force", seed: 2, iterations: 60 });
    expect(a.nodes.map((n) => n.center)).not.toEqual(b.nodes.map((n) => n.center));
  });

  it("force edge endpoints land on the node's own box face in full 3D (mutation: clamp only the XY axes) → red", async () => {
    const laid = await layout3d(groupedGraph(), { layout: "force", seed: 7, iterations: 80 });
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    for (const edge of laid.edges) {
      const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
      for (const [point, node] of [[edge.points[0]!, from], [edge.points[edge.points.length - 1]!, to]] as const) {
        const dx = Math.abs(point[0] - node.center[0]), dy = Math.abs(point[1] - node.center[1]), dz = Math.abs(point[2] - node.center[2]);
        expect(dx).toBeLessThanOrEqual(node.half[0] + 1e-6);
        expect(dy).toBeLessThanOrEqual(node.half[1] + 1e-6);
        expect(dz).toBeLessThanOrEqual(node.half[2] + 1e-6);
        // "Inside the box" alone passes for the box's own CENTER too — a
        // clamp that just no-ops (or clamps to a point strictly interior)
        // satisfies the three bounds above without ever reaching a face.
        // At least one axis must be genuinely AT its half-extent (review
        // finding P2, D1's own layered-layout test already asserts this;
        // the force path needs the same clause).
        const onAnAxis = Math.abs(dx - node.half[0]) < 1e-6 || Math.abs(dy - node.half[1]) < 1e-6 || Math.abs(dz - node.half[2]) < 1e-6;
        expect(onAnAxis).toBe(true);
      }
    }
  });
});

describe("layout3d — self-loops", () => {
  function selfLoopGraph(shape?: "circle"): GlyphGraph {
    return {
      direction: "TB",
      nodes: [{ id: "a", label: "A", shape }, { id: "b", label: "B", shape }],
      edges: [{ from: "a", to: "a" }, { from: "a", to: "b" }],
    };
  }

  function expectBothEndpointsOnOwnFace(node: GlyphDiagram3dNode, points: readonly Vec3[]) {
    // P1-c (D1 review): a self-loop's `from`/`to` node is the same node, so
    // `nodeSurfaceAnchor`'s degenerate `toward === center` case used to
    // collapse BOTH endpoints onto the node's own center — a self-loop
    // drawn as a single point (mutation: reintroduce that collapse) → red.
    expect(points.length).toBeGreaterThanOrEqual(3);
    const p0 = points[0]!, p1 = points[points.length - 1]!;
    expect(p0).not.toEqual(p1);
    for (const point of [p0, p1]) {
      const dx = Math.abs(point[0] - node.center[0]), dy = Math.abs(point[1] - node.center[1]), dz = Math.abs(point[2] - node.center[2]);
      expect(dx).toBeLessThanOrEqual(node.half[0] + 1e-6);
      expect(dy).toBeLessThanOrEqual(node.half[1] + 1e-6);
      expect(dz).toBeLessThanOrEqual(node.half[2] + 1e-6);
      const onAnAxis = Math.abs(dx - node.half[0]) < 1e-6 || Math.abs(dy - node.half[1]) < 1e-6 || Math.abs(dz - node.half[2]) < 1e-6;
      expect(onAnAxis).toBe(true);
    }
  }

  it("a box node's self-loop leaves and re-enters its own face (layered layout)", async () => {
    const laid = await layout3d(selfLoopGraph(), { zBy: "none" });
    const a = laid.nodes.find((n) => n.id === "a")!;
    const loop = laid.edges.find((e) => e.from === "a" && e.to === "a")!;
    expectBothEndpointsOnOwnFace(a, loop.points);
  });

  it("a sphere node's self-loop leaves and re-enters its own surface (layered layout)", async () => {
    const laid = await layout3d(selfLoopGraph("circle"), { zBy: "none" });
    const a = laid.nodes.find((n) => n.id === "a")!;
    const loop = laid.edges.find((e) => e.from === "a" && e.to === "a")!;
    const p0 = loop.points[0]!, p1 = loop.points[loop.points.length - 1]!;
    expect(p0).not.toEqual(p1);
    const r = Math.max(...a.half);
    for (const point of [p0, p1]) {
      const dist = Math.hypot(point[0] - a.center[0], point[1] - a.center[1], point[2] - a.center[2]);
      expect(dist).toBeCloseTo(r, 6);
    }
  });

  it("a box node's self-loop leaves and re-enters its own face (force layout)", async () => {
    const laid = await layout3d(selfLoopGraph(), { layout: "force", seed: 3, iterations: 40 });
    const a = laid.nodes.find((n) => n.id === "a")!;
    const loop = laid.edges.find((e) => e.from === "a" && e.to === "a")!;
    expectBothEndpointsOnOwnFace(a, loop.points);
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
