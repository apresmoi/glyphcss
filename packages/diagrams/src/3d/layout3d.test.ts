import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, type Vec3 } from "glyphcss";
import type { GlyphGraph } from "../types";
import { layoutGlyphGraph } from "../pipeline";
import { layout3d, glyphDiagram3dPlaneAxes, GLYPH_DIAGRAM_3D_CAMERA_ROT_X, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y } from "./layout3d";

/**
 * D2 round 5 acceptance gates for `layout3d`'s `"layered"` path (the plane
 * embedding) and, unchanged, `"force"`. Each `it` names, in a comment, the
 * mutation it is meant to redden.
 */

/**
 * A chain whose EDGES run backward against declaration order (`n4 -> n3 ->
 * ... -> n0`), so rank 0 is `n4` and rank `n-1` is `n0` — the opposite of
 * both id order and `layoutGlyphGraph`'s own node-array (declaration)
 * order. A FORWARD chain can't catch "the plane embeds the wrong axis":
 * each rank there holds exactly one node, so a stable sort on a degenerate
 * axis silently falls back to declaration order, which for a forward chain
 * already equals the correct rank order.
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

/** `(point - center) · axis` — the LOCAL scalar offset along a world unit axis, used throughout to verify a point sits on a node's own `u`/`n`/Z-aligned box face without assuming world-axis alignment. */
function localOffset(point: Vec3, center: Vec3, axis: Vec3): number {
  return (point[0] - center[0]) * axis[0] + (point[1] - center[1]) * axis[1] + (point[2] - center[2]) * axis[2];
}

const Z_HAT: Vec3 = [0, 0, 1];

describe("layout3d — layered (D2 round 5 plane embedding)", () => {
  it("the DEFAULT camera projects every node centre's screen ROW in exact 2D rank order, for a chain of any length (mutation: skew `u` off the analytic zero-row direction) → red", async () => {
    // The brief's own gate, verbatim: "the projected row of every node
    // centre equals its 2D-layout row ordering." A REVERSED chain (see
    // `reverseChainGraph`'s own doc) so declaration order can't
    // coincidentally satisfy this.
    const graph = reverseChainGraph(6);
    const laid2d = await layoutGlyphGraph(graph, { direction: "TB" });
    const laid3d = await layout3d(graph, { direction: "TB" });
    const order2d = [...laid2d.nodes].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1)).map((n) => n.id);
    expect(order2d).toEqual(["n5", "n4", "n3", "n2", "n1", "n0"]); // genuinely reversed, not declaration order

    const camera = createGlyphOrthographicCamera({ rotX: GLYPH_DIAGRAM_3D_CAMERA_ROT_X, rotY: GLYPH_DIAGRAM_3D_CAMERA_ROT_Y, zoom: 10 });
    const byId = new Map(laid3d.nodes.map((n) => [n.id, n]));
    const rows = order2d.map((id) => camera.project(byId.get(id)!.center, 200, 200, 2)[1]);
    // Strictly increasing screen row, in the SAME order 2D ranked them —
    // never merely "close," since the whole point of the analytic solve is
    // EXACT preservation, not an approximation that could drift on a
    // longer chain.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!).toBeGreaterThan(rows[i - 1]!);
  });

  it("nodes sharing a dagre rank sit on the same screen ROW, within ±1 cell (mutation: let a transverse (u-axis) offset leak into the row) → red", async () => {
    const graph: GlyphGraph = {
      direction: "TB",
      nodes: [{ id: "top", label: "Top" }, { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      edges: [{ from: "top", to: "a" }, { from: "top", to: "b" }, { from: "top", to: "c" }],
    };
    const laid = await layout3d(graph, { direction: "TB" });
    const camera = createGlyphOrthographicCamera({ rotX: GLYPH_DIAGRAM_3D_CAMERA_ROT_X, rotY: GLYPH_DIAGRAM_3D_CAMERA_ROT_Y, zoom: 10 });
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const rowOf = (id: string) => camera.project(byId.get(id)!.center, 200, 200, 2)[1]!;
    const rowA = rowOf("a"), rowB = rowOf("b"), rowC = rowOf("c");
    expect(Math.abs(rowA - rowB)).toBeLessThanOrEqual(1);
    expect(Math.abs(rowB - rowC)).toBeLessThanOrEqual(1);
  });

  it("`glyphDiagram3dPlaneAxes` returns an orthonormal ground pair whose `u` has zero row/depth contribution under its own camera (the closed-form identity itself) → red on a broken derivation", () => {
    for (const rotY of [0, 25, 30, 35, 90, -40]) {
      const { u, n } = glyphDiagram3dPlaneAxes(rotY);
      // Orthonormal.
      expect(u[0] * u[0] + u[1] * u[1]).toBeCloseTo(1, 9);
      expect(n[0] * n[0] + n[1] * n[1]).toBeCloseTo(1, 9);
      expect(u[0] * n[0] + u[1] * n[1]).toBeCloseTo(0, 9);
      // `u`'s own row/depth coefficients are exactly zero at ANY pitch —
      // project two points 1 world unit apart along `u` and confirm the
      // row is unchanged (col moves, row/depth don't) at two different pitches.
      for (const rotX of [10, 45, 80]) {
        const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 100 });
        const a = camera.project([0, 0, 0], 400, 400, 2);
        const b = camera.project(u, 400, 400, 2);
        expect(b[1]).toBeCloseTo(a[1], 6); // row unchanged
        expect(b[0]).not.toBeCloseTo(a[0], 3); // col DID move
      }
    }
  });

  it("world Z has zero screen-column contribution at any pitch (mutation: let height leak sideways) → red", () => {
    for (const rotX of [10, 45, 80]) {
      const camera = createGlyphOrthographicCamera({ rotX, rotY: GLYPH_DIAGRAM_3D_CAMERA_ROT_Y, zoom: 100 });
      const a = camera.project([0, 0, 0], 400, 400, 2);
      const b = camera.project([0, 0, 1], 400, 400, 2);
      expect(b[0]).toBeCloseTo(a[0], 9);
    }
  });

  it("every edge is a Manhattan walk in the (u, Z) plane, entirely on the front-face plane n=0 (mutation: leave the 2D route unconverted, or drop the front-plane offset) → red", async () => {
    const laid = await layout3d(groupedGraph(), {});
    const { u, n } = glyphDiagram3dPlaneAxes(GLYPH_DIAGRAM_3D_CAMERA_ROT_Y);
    expect(laid.edges.length).toBeGreaterThan(0);
    for (const edge of laid.edges) {
      for (const p of edge.points) expect(localOffset(p, [0, 0, 0], n)).toBeCloseTo(0, 6);
      for (let i = 0; i < edge.points.length - 1; i++) {
        const a = edge.points[i]!, b = edge.points[i + 1]!;
        const du = localOffset(b, a, u), dz = localOffset(b, a, Z_HAT);
        // Axis-aligned: at most one of (u, Z) genuinely moves per segment.
        expect(Math.abs(du) < 1e-6 || Math.abs(dz) < 1e-6).toBe(true);
      }
    }
  });

  it("an edge endpoint lands exactly on its own node's front face — LOCAL n-offset is exactly -half[1] (never inside the box, never past it) (mutation: anchor edges at the node centre instead of its 2D port) → red", async () => {
    const laid = await layout3d(groupedGraph(), {});
    const { u, n } = glyphDiagram3dPlaneAxes(GLYPH_DIAGRAM_3D_CAMERA_ROT_Y);
    const byId = new Map(laid.nodes.map((nd) => [nd.id, nd]));
    for (const edge of laid.edges) {
      const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
      const p0 = edge.points[0]!, p1 = edge.points[edge.points.length - 1]!;
      for (const [point, node] of [[p0, from], [p1, to]] as const) {
        expect(localOffset(point, node.center, n)).toBeCloseTo(-node.half[1], 6);
        // Also within the node's own u/Z footprint (the 2D port sits
        // somewhere on the node's own rect boundary, never past its corner).
        expect(Math.abs(localOffset(point, node.center, u))).toBeLessThanOrEqual(node.half[0] + 1e-6);
        expect(Math.abs(localOffset(point, node.center, Z_HAT))).toBeLessThanOrEqual(node.half[2] + 1e-6);
      }
    }
  });

  it("a group's recessed backdrop sits BEHIND (farther along n than) every one of its own members (mutation: place the frame at the group's own front instead of past its deepest member) → red", async () => {
    const laid = await layout3d(groupedGraph(), {});
    const { n } = glyphDiagram3dPlaneAxes(GLYPH_DIAGRAM_3D_CAMERA_ROT_Y);
    const group = laid.groups.find((g) => g.id === "agents")!;
    const members = laid.nodes.filter((nd) => ["a", "b", "c"].includes(nd.id));
    const frameN = localOffset(group.min, [0, 0, 0], n); // group.min/.max share the same n offset (group.z)
    for (const m of members) {
      const memberBackN = localOffset(m.center, [0, 0, 0], n) + m.half[1];
      expect(frameN).toBeGreaterThan(memberBackN);
    }
  });

  it("compaction/routing never drops an edge on the reference 4-node graph (mutation: silently swallow an unroutable edge) → red", async () => {
    const laid = await layout3d(groupedGraph(), {});
    expect(laid.edges.length).toBe(4);
    expect(laid.ledger.some((e) => e.code === "unroutable")).toBe(false);
  });
});

describe("layout3d — force (unchanged by D2 round 5)", () => {
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

describe("layout3d — self-loops (layered, D2 round 5: routed through the 2D A* router, not a hand-rolled bulge)", () => {
  it("a self-loop routes without throwing and stays on the front-face plane (mutation: reject/drop a from===to edge in the 2D router bridge) → red", async () => {
    const graph: GlyphGraph = {
      direction: "TB",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "a" }, { from: "a", to: "b" }],
    };
    const laid = await layout3d(graph, {});
    const { n } = glyphDiagram3dPlaneAxes(GLYPH_DIAGRAM_3D_CAMERA_ROT_Y);
    const loop = laid.edges.find((e) => e.from === "a" && e.to === "a");
    expect(loop).toBeDefined();
    expect(loop!.points.length).toBeGreaterThanOrEqual(2);
    for (const p of loop!.points) expect(localOffset(p, [0, 0, 0], n)).toBeCloseTo(0, 6);
  });
});

describe("layout3d — size compression (D2 round 4, unaffected by D2 round 5's embedding change)", () => {
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

  it("a node with NO explicit size is untouched by another node's compression, and its default depth/height follow D2 round 6's own (deeper) depth-factor band (mutation: apply compression graph-wide, or use a flat constant depth) → red", async () => {
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
    // D2 round 6 ("the 3D reads too faintly... make depth big enough to show
    // it; 0.35-0.5x min(w,h) may be too shallow at these sizes") raised
    // `GLYPH_DIAGRAM_3D_DEPTH_FACTOR` from round 4/5's 0.35-0.5x band to
    // 0.6x — this node's own default (unfloored, uncompressed) depth is
    // exactly `DEPTH_FACTOR * min(width, height)`.
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

