import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { canonicalizeGlyphGraph } from "./pipeline";
import { glyphGraphFromMermaid } from "./mermaid";
import { renderGlyphDiagram } from "./render";
import type { GlyphGraph } from "./types";
import type { GlyphDiagramResult } from "./renderTypes";

function fixture(name: string): GlyphGraph {
  return glyphGraphFromMermaid(readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8"));
}
function expectComplete(result: GlyphDiagramResult, graph: GlyphGraph) {
  expect(result.pages).toHaveLength(1);
  expect(result.report.unroutable).toEqual([]);
  const page = result.pages[0];
  expect(page.layout.nodes.map(({ id }) => id).sort()).toEqual(graph.nodes.map(({ id }) => id).sort());
  const connections = (edges: GlyphGraph["edges"]) =>
    edges.map(({ from, to, label }) => `${from}->${to}:${label ?? ""}`).sort();
  expect(connections(page.routes.map(({ edge }) => edge))).toEqual(connections(graph.edges));
  expect(page.layout.groups).toEqual(canonicalizeGlyphGraph(graph).groups);
  for (const node of graph.nodes) {
    const rendered = page.layout.nodes.find(({ id }) => id === node.id)!;
    expect(rendered.label).toBe(node.label);
    expect(rendered.shape).toBe(node.shape);
  }
}

it.each([
  { width: 38, height: 18 },
  { width: 48, height: 35 },
])(
  "keeps every RAG connection in a natural pan extent at $width × $height",
  async (size) => {
    const graph = fixture("rag-pipeline");
    const result = await renderGlyphDiagram(graph, { target: "web", ...size, autoDirection: true, overflow: "expand" });
    expectComplete(result, graph);
    expect(result.canvas.grid.cols).toBeGreaterThanOrEqual(size.width);
    expect(result.canvas.grid.rows).toBeGreaterThanOrEqual(size.height);
    expect(result.canvas.grid.cols > size.width || result.canvas.grid.rows > size.height).toBe(true);
  },
  15000,
);

it("keeps fixed LR through a natural pan extent without changing fidelity", async () => {
  const graph = fixture("rag-pipeline");
  const result = await renderGlyphDiagram(graph, {
    target: "web",
    width: 38,
    height: 18,
    direction: "LR",
    detail: "auto",
    overflow: "expand",
  });
  expectComplete(result, graph);
  expect(result.meta.description).toContain("LR; 1 panel.");
  expect(result.canvas.grid.cols).toBeGreaterThan(38);
});

it("retains the viewport budget when the complete graph fits", async () => {
  const graph = fixture("rag-pipeline");
  const result = await renderGlyphDiagram(graph, {
    target: "web",
    width: 48,
    height: 42,
    autoDirection: true,
    overflow: "expand",
  });
  expectComplete(result, graph);
  expect(result.canvas.grid).toMatchObject({ cols: 48, rows: 42 });
});

it.each([
  { width: 35, height: 43 },
  { width: 38, height: 43 },
  { width: 35, height: 40 },
  { width: 42, height: 43 },
  { width: 48, height: 33 },
  { width: 35, height: 27 },
  { width: 141, height: 50 },
])(
  "keeps Event queue connected at the sidebar breakpoint's $width × $height budget",
  async (size) => {
    const graph = fixture("event-queue");
    expect(graph.nodes).toHaveLength(9);
    expectComplete(
      await renderGlyphDiagram(graph, { target: "web", ...size, autoDirection: true, overflow: "expand" }),
      graph,
    );
  },
  15000,
);

it.each(["LR", "RL", "TB", "BT"] as const)(
  "keeps Event queue's explicit %s direction while reserving routing space",
  async (direction) => {
    const graph = fixture("event-queue");
    const result = await renderGlyphDiagram(graph, {
      target: "web",
      width: 35,
      height: 27,
      direction,
      detail: "auto",
      overflow: "expand",
    });
    expectComplete(result, graph);
    expect(result.meta.description).toContain(`${direction}; 1 panel.`);
  },
  15000,
);
