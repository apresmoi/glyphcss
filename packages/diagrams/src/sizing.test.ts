import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { canonicalizeGlyphGraph } from "./pipeline";
import type { GlyphGraph } from "./types";
const families: { name: string; graph: GlyphGraph }[] = [
  {
    name: "chain",
    graph: {
      direction: "LR",
      nodes: [
        { id: "a", label: "Source" },
        { id: "b", label: "Transform" },
        { id: "c", label: "Result" },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "bc", from: "b", to: "c" },
      ],
    },
  },
  {
    name: "fan",
    graph: {
      direction: "TB",
      nodes: [
        { id: "a", label: "Dispatch" },
        { id: "b", label: "First" },
        { id: "c", label: "Second" },
        { id: "d", label: "Third" },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "ac", from: "a", to: "c" },
        { id: "ad", from: "a", to: "d" },
      ],
    },
  },
  {
    name: "return",
    graph: {
      direction: "LR",
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Work" },
        { id: "c", label: "Review" },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "bc", from: "b", to: "c" },
        { id: "ca", from: "c", to: "a" },
      ],
    },
  },
  {
    name: "group",
    graph: {
      direction: "TB",
      nodes: [
        { id: "a", label: "Ingress" },
        { id: "b", label: "Worker" },
        { id: "c", label: "Archive" },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "bc", from: "b", to: "c" },
      ],
      groups: [{ id: "g", label: "Boundary", members: ["b", "c"] }],
    },
  },
];
function preserves(result: Awaited<ReturnType<typeof renderGlyphDiagram>>, graph: GlyphGraph) {
  expect(new Set(result.pages.flatMap((p) => p.layout.nodes.map((n) => n.id)))).toEqual(
    new Set(graph.nodes.map((n) => n.id)),
  );
  expect(new Set(result.pages.flatMap((p) => p.routes.map((r) => r.edge.id)))).toEqual(
    new Set(canonicalizeGlyphGraph(graph).edges.map((e) => e.id)),
  );
  expect(result.report.unroutable).toEqual([]);
}
describe("dynamic graph sizing", () => {
  it.each(Array.from({ length: 12 }, (_, seed) => seed + 1))(
    "preserves generated topology and routes at cell budget %i",
    async (seed) => {
      const count = 2 + seed % 4;
      const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Stage ${seed + i}` }));
      const edges = nodes.slice(1).map((node, i) => ({ id: `e${i}`, from: nodes[i].id, to: node.id }));
      if (seed % 2 === 0) edges.push({ id: "return", from: nodes[count - 1].id, to: nodes[0].id });
      const graph: GlyphGraph = { direction: (["LR", "TB", "RL", "BT"] as const)[seed % 4], nodes, edges };
      const input = JSON.stringify(graph);
      const width = 1 + seed * 17 % 71, height = 1 + seed * 11 % 37;
      const result = await renderGlyphDiagram(graph, { width, height, overflow: "expand", autoDirection: true, detail: "faithful" });
      preserves(result, graph);
      expect(result.pages).toHaveLength(1);
      expect(JSON.stringify(graph)).toBe(input);
      const { cols, rows } = result.canvas.grid;
      expect(cols).toBeGreaterThanOrEqual(width);
      expect(rows).toBeGreaterThanOrEqual(height);
      for (const node of result.layout.nodes) {
        expect(node.x0).toBeGreaterThanOrEqual(0);
        expect(node.y0).toBeGreaterThanOrEqual(0);
        expect(node.x1).toBeLessThan(cols);
        expect(node.y1).toBeLessThan(rows);
      }
      for (const route of result.routes) for (const [i, cell] of route.cells.entries()) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(cols);
        expect(cell.y).toBeLessThan(rows);
        if (i) expect(Math.abs(cell.x - route.cells[i - 1].x) + Math.abs(cell.y - route.cells[i - 1].y)).toBe(1);
      }
    },
    30000,
  );
  it.each(families)(
    "fits $name across arbitrary feasible cell budgets",
    async ({ graph }) => {
      for (const size of [
        { width: 53, height: 29 },
        { width: 67, height: 31 },
        { width: 81, height: 37 },
      ]) {
        const result = await renderGlyphDiagram(graph, { ...size, autoDirection: true, detail: "faithful" });
        preserves(result, graph);
        expect(result.pages).toHaveLength(1);
        for (const page of result.pages) {
          expect(page.canvas.grid.cols).toBe(size.width);
          expect(page.canvas.grid.rows).toBe(size.height);
        }
      }
    },
    30000,
  );
  it.each(families)(
    "expands $name without dropping topology or explicit direction",
    async ({ graph }) => {
      const result = await renderGlyphDiagram(graph, {
        width: 11,
        height: 9,
        overflow: "expand",
        detail: "faithful",
        direction: graph.direction,
      });
      preserves(result, graph);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].layout.direction).toBe(graph.direction);
      expect(result.canvas.grid.cols).toBeGreaterThanOrEqual(11);
      expect(result.canvas.grid.rows).toBeGreaterThanOrEqual(9);
      expect(result.report.ledger).toContainEqual({
        code: "layout-expanded",
        message: expect.any(String),
        detail: { requestedWidth: 11, requestedHeight: 9, canvasWidth: result.canvas.grid.cols, canvasHeight: result.canvas.grid.rows },
      });
    },
    30000,
  );
  it.each([{ width: 1, height: 1 }, { width: 1, height: 100 }, { width: 100, height: 1 }])(
    "keeps the connected graph available when a viewport axis has only one cell %j",
    async (size) => {
      const graph = families[0].graph;
      const result = await renderGlyphDiagram(graph, { ...size, overflow: "expand", detail: "faithful", autoDirection: true });
      preserves(result, graph);
      expect(result.pages).toHaveLength(1);
      expect(result.canvas.grid.cols).toBeGreaterThanOrEqual(size.width);
      expect(result.canvas.grid.rows).toBeGreaterThanOrEqual(size.height);
    },
    30000,
  );
  it.each(families)(
    "is deterministic for reversed $name input",
    async ({ graph }) => {
      const options = { width: 67, height: 31, autoDirection: true, detail: "faithful" as const };
      const first = await renderGlyphDiagram(graph, options);
      const reversed = await renderGlyphDiagram(
        { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
        options,
      );
      expect(reversed.text).toBe(first.text);
      expect(reversed.report).toEqual(first.report);
    },
    30000,
  );
  it("repairs tight gaps in LangGraph at an unlisted budget", async () => {
    const graph = glyphGraphFromMermaid(readFileSync("fixtures/langgraph.mmd", "utf8"));
    const result = await renderGlyphDiagram(graph, {
      width: 74,
      height: 24,
      nodesep: 3,
      ranksep: 3,
      autoDirection: true,
      detail: "faithful",
    });
    preserves(result, graph);
    expect(result.pages).toHaveLength(1);
    expect(result.canvas.grid.cols).toBe(74);
    expect(result.canvas.grid.rows).toBe(24);
  }, 30000);
  it.each([
    { width: 0 },
    { height: -1 },
    { autoDirection: "yes" },
    { overflow: "resize" },
    { labelWidth: 0 },
    { nodesep: 2 },
  ])("rejects invalid sizing options %j", async (options) => {
    await expect(renderGlyphDiagram(families[0].graph, options as never)).rejects.toThrow();
  });
});

it.each([
  { width: 17, height: 13 },
  { width: 23, height: 11 },
  { width: 29, height: 17 },
])(
  "keeps every pagination canvas inside the exact requested budget %j",
  async (size) => {
    const result = await renderGlyphDiagram(families[0].graph, { ...size, overflow: "paginate", detail: "faithful" });
    for (const page of result.pages) {
      expect(page.canvas.grid.cols).toBe(size.width);
      expect(page.canvas.grid.rows).toBe(size.height);
      expect(page.layout.direction).toBe("LR");
    }
    expect(result.report.ledger.some(entry => entry.code === "layout-expanded")).toBe(false);
    for (const route of result.pages.flatMap((page) => page.routes)) {
      for (const cell of route.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(size.width);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(size.height);
      }
    }
  },
  30000,
);

it("detects translation-invariant protected lane collisions before routing", async () => {
  const { layoutGlyphGraph } = await import("./pipeline");
  const { glyphDiagramHasRoutingClearance } = await import("./route");
  const graph = glyphGraphFromMermaid(readFileSync("fixtures/langgraph.mmd", "utf8"));
  const tight = await layoutGlyphGraph(graph, { direction: "LR", nodesep: 3, ranksep: 3 });
  expect(glyphDiagramHasRoutingClearance(tight)).toBe(false);
  const roomy = await layoutGlyphGraph(graph, { direction: "LR", nodesep: 4, ranksep: 4 });
  expect(glyphDiagramHasRoutingClearance(roomy)).toBe(true);
  const shifted = {
    ...tight,
    nodes: tight.nodes.map(node => ({ ...node, x0: node.x0 + 20, x1: node.x1 + 20, y0: node.y0 + 10, y1: node.y1 + 10 })),
    ports: tight.ports.map(port => ({ ...port, anchor: { x: port.anchor.x + 20, y: port.anchor.y + 10 }, escape: { x: port.escape.x + 20, y: port.escape.y + 10 } })),
  };
  expect(glyphDiagramHasRoutingClearance(shifted)).toBe(false);
});
