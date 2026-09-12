import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { glyphGraphFromMermaid } from "./mermaid";
import { canonicalizeGlyphGraph, layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, type GlyphDiagramLayout } from "./pipeline";
import { routeGlyphGraphEdges } from "./route";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap } from "./labels";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramCollapseLeaves, glyphDiagramMergeDuplicates, splitGlyphGraph } from "./degrade";
import type { GlyphGraph } from "./types";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");
const pointInside = (p: { x: number; y: number }, n: { x0: number; x1: number; y0: number; y1: number }) => p.x >= n.x0 && p.x <= n.x1 && p.y >= n.y0 && p.y <= n.y1;
function obstacleFixture(): GlyphDiagramLayout {
  const edge = { id: "through-middle", from: "a", to: "b" };
  return { direction: "LR", width: 34, height: 15, groups: [], ledger: [], edges: [edge],
    nodes: [
      { id: "a", label: "A", lines: ["A"], width: 5, height: 3, x0: 1, y0: 5, x1: 5, y1: 7 },
      { id: "b", label: "B", lines: ["B"], width: 5, height: 3, x0: 27, y0: 5, x1: 31, y1: 7 },
      { id: "blocker", label: "Blocker", lines: ["Blocker"], width: 7, height: 7, x0: 13, y0: 3, x1: 19, y1: 9 },
    ], ports: [
      { edgeId: edge.id, nodeId: "a", end: "from", side: "e", offset: 1, anchor: { x: 5, y: 6 }, escape: { x: 6, y: 6 } },
      { edgeId: edge.id, nodeId: "b", end: "to", side: "w", offset: 1, anchor: { x: 27, y: 6 }, escape: { x: 26, y: 6 } },
    ] };
}

describe("diagram routing rules", () => {
  // Mutation: remove layout.nodes from both rectangle and clearance obstacle checks in route.ts.
  it("routes around the node on the shortest geometric transit, with a full clearance ring", () => {
    const layout = obstacleFixture(), result = routeGlyphGraphEdges(layout);
    expect(result.unroutable).toEqual([]); expect(result.routes).toHaveLength(1);
    const cells = result.routes[0]!.cells;
    expect(cells[0]).toEqual({ x: 6, y: 6 }); expect(cells.at(-1)).toEqual({ x: 26, y: 6 });
    for (const p of cells) expect(pointInside(p, layout.nodes[2]!)).toBe(false);
    expect(cells.some((p) => p.y < 2 || p.y > 10)).toBe(true);
    cells.slice(1).forEach((p, i) => expect(Math.abs(p.x - cells[i]!.x) + Math.abs(p.y - cells[i]!.y)).toBe(1));
  });
  // Mutation: bypass reserveGlyphGraphPorts, or replace its 2-cell offsets/minimum dimension with 1-cell spacing.
  it("widens the six-port node before dagre and keeps one blank cell between parallel routes", async () => {
    const graph = glyphGraphFromMermaid(fixture("six-port"));
    const measured = measureGlyphGraph(graph), reserved = reserveGlyphGraphPorts(measured);
    const hubId = graph.edges[0]!.from;
    const hub = reserved.nodes.find((n) => n.id === hubId)!;
    expect(hub.width).toBeGreaterThanOrEqual(13);
    const ports = reserved.ports.filter((p) => p.nodeId === hubId && p.end === "from");
    expect(ports).toHaveLength(6);
    const offsets = ports.map((p) => p.offset).sort((a, b) => a - b);
    offsets.slice(1).forEach((v, i) => expect(v - offsets[i]!).toBeGreaterThanOrEqual(2));
    const layout = await layoutGlyphGraph(reserved, { nodesep: 6, ranksep: 12 });
    const result = routeGlyphGraphEdges(layout, { width: layout.width + 20, height: layout.height + 20 });
    expect(result.unroutable).toEqual([]); expect(result.routes).toHaveLength(6);
    const segments = result.routes.map((r) => r.cells.slice(1).map((b, i) => ({ a: r.cells[i]!, b, horizontal: b.y === r.cells[i]!.y })));
    for (let a = 0; a < segments.length; a++) for (let b = a + 1; b < segments.length; b++) for (const p of segments[a]!) for (const q of segments[b]!) {
      if (p.horizontal !== q.horizontal) continue;
      if (p.horizontal && Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x)) <= Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x))) expect(Math.abs(p.a.y - q.a.y)).toBeGreaterThanOrEqual(2);
      if (!p.horizontal && Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y)) <= Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y))) expect(Math.abs(p.a.x - q.a.x)).toBeGreaterThanOrEqual(2);
    }
  });
  it("rejects negative/non-finite route costs and non-integer bounds before search", () => {
    for (const options of [{ bendCost: -1 }, { crossingCost: Infinity }, { bendCost: NaN }]) expect(() => routeGlyphGraphEdges(obstacleFixture(), options)).toThrow(/bad-options/);
    for (const options of [{ width: Infinity }, { height: 2.5 }, { width: 0 }]) expect(() => routeGlyphGraphEdges(obstacleFixture(), options)).toThrow(/bad-size/);
  });
  it("reports the unroutable edge id and records no transit", () => {
    const result = routeGlyphGraphEdges(obstacleFixture(), { obstacles: [{ x0: 12, y0: 0, x1: 20, y1: 14 }] });
    expect(result.routes).toEqual([]); expect(result.unroutable).toEqual(["through-middle"]);
    expect(result.ledger.join("\n")).toContain('GLYPH_DIAGRAM_UNROUTABLE: edge "through-middle"');
  });
  it("places labels disjoint from every node, route and prior label, within the viewport", async () => {
    const layout = await layoutGlyphGraph(glyphGraphFromMermaid(fixture("diamond")));
    const routing = routeGlyphGraphEdges(layout, { width: 90, height: 40 });
    const obstacles = [...layout.nodes, ...routing.routes.flatMap((r) => r.cells.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })))];
    const result = glyphDiagramLabelLayout([{ id: "a", x: 0, y: 0, text: "a long label", maxWidth: 8 }, { id: "b", x: 0, y: 0, text: "another label" }], { viewport: { cols: 90, rows: 40 }, obstacles, charset: "ascii" });
    expect(result.placed).toHaveLength(2); expect(result.ledger.join()).toContain("abbreviated");
    result.placed.forEach((label, i) => {
      expect(label.x0).toBeGreaterThanOrEqual(0); expect(label.x1).toBeLessThan(90); expect(label.y0).toBeGreaterThanOrEqual(0); expect(label.y1).toBeLessThan(40);
      [...obstacles, ...result.placed.slice(0, i)].forEach((rect) => expect(glyphDiagramRectsOverlap(label, rect)).toBe(false));
    });
  });
  it("drops an edge label when only distant free space remains", () => {
    const route = Array.from({ length: 6 }, (_, i) => ({ x: 5, y: i + 2 }));
    const result = glyphDiagramLabelLayout([{ id: "edge", text: "label", x: 5, y: 4, route }], {
      viewport: { cols: 30, rows: 10 }, obstacles: [{ x0: 3, x1: 7, y0: 0, y1: 9 }],
    });
    expect(result.placed).toEqual([]); expect(result.dropped).toEqual(["edge"]);
  });
  // Mutation: remove canonical sorting before port reservation/dagre; tied sibling and parallel edge ordering changes.
  it("shuffled nodes, edges and groups render identically", async () => {
    for (const name of ["subgraph", "diamond", "six-port"]) {
      const graph = glyphGraphFromMermaid(fixture(name));
      const canonical = canonicalizeGlyphGraph(graph);
      const shuffled = { ...canonical, nodes: [...canonical.nodes].reverse(), edges: [...canonical.edges].reverse(), groups: canonical.groups?.map((g) => ({ ...g, members: [...g.members].reverse() })).reverse() };
      const a = await renderGlyphDiagram(canonical, { width: 120, height: 50 }), b = await renderGlyphDiagram(shuffled, { width: 120, height: 50 });
      expect(b.text).toBe(a.text); expect(b.report).toEqual(a.report); expect(b.meta).toEqual(a.meta);
    }
  });
});

describe("diagram fidelity ladder", () => {
  it("over nine nodes triggers ordered ladder stages and a real split retaining all edges", async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: nodes[i]!.id, to: n.id }));
    const result = await renderGlyphDiagram({ nodes, edges, direction: "TB" }, { width: 100, height: 100 });
    const stages = result.report.ledger.filter((s) => /^(decoration|duplicates|leaf-clusters|split):/.test(s)).map((s) => s.split(":")[0]);
    expect(stages).toEqual(["decoration", "duplicates", "leaf-clusters", "split"]);
    expect(result.pages.length).toBeGreaterThan(1);
    expect(new Set(result.pages.flatMap((p) => p.routes.map((r) => r.edge.id)))).toEqual(new Set(edges.map((e) => e.id)));
    expect(result.meta.nodes).toHaveLength(10);
  });
  it("over twelve edges triggers duplicate merging without losing lineage", async () => {
    const graph: GlyphGraph = { direction: "TB", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: Array.from({ length: 13 }, (_, i) => ({ id: `e${i}`, from: "a", to: "b" })) };
    const result = await renderGlyphDiagram(graph, { width: 80, height: 40 });
    expect(result.report.ledger.some((s) => s.startsWith("duplicates: merged"))).toBe(true);
    expect(result.meta.edges).toHaveLength(13); expect(result.routes).toHaveLength(1);
    expect(glyphDiagramMergeDuplicates(graph).graph.edges).toHaveLength(1);
  });
  it("collapses sibling leaves and lists exactly which ids were summarized", () => {
    const graph = glyphGraphFromMermaid(fixture("six-port"));
    const result = glyphDiagramCollapseLeaves(graph);
    expect(result.graph.nodes).toHaveLength(2); expect(result.graph.edges).toHaveLength(1);
    for (const e of graph.edges) expect(result.ledger.join()).toContain(e.to);
  });
  it("split includes isolated nodes and never invents edges", () => {
    const graph = glyphGraphFromMermaid("graph LR; A --> B; C");
    const panels = splitGlyphGraph(graph);
    expect(new Set(panels.flatMap((p) => p.nodes.map((n) => n.id)))).toEqual(new Set(["A", "B", "C"]));
    expect(panels.flatMap((p) => p.edges)).toHaveLength(1);
  });
});
