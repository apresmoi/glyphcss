import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GlyphGraph, GlyphGraphEdge } from "./types";

const control = vi.hoisted(() => ({ routeLimit: 80, layoutLimit: 90, snakeLimit: 600 }));
vi.mock("./route", async importOriginal => {
  const real = await importOriginal<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: vi.fn((...args: Parameters<typeof real.routeGlyphGraphEdges>) => {
    if (vi.mocked(routeGlyphGraphEdges).mock.calls.length > control.routeLimit) throw new Error("render exceeded its routing-count bound");
    return real.routeGlyphGraphEdges(...args);
  }) };
});
vi.mock("./pipeline", async importOriginal => {
  const real = await importOriginal<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn((...args: Parameters<typeof real.layoutGlyphGraph>) => {
    if (vi.mocked(layoutGlyphGraph).mock.calls.length > control.layoutLimit) throw new Error("render exceeded its layout-count bound");
    return real.layoutGlyphGraph(...args);
  }) };
});
vi.mock("./snake", async importOriginal => {
  const real = await importOriginal<typeof import("./snake")>();
  return { ...real, glyphDiagramSnakeLayout: vi.fn((...args: Parameters<typeof real.glyphDiagramSnakeLayout>) => {
    if (vi.mocked(glyphDiagramSnakeLayout).mock.calls.length > control.snakeLimit) throw new Error("render exceeded its snake-count bound");
    return real.glyphDiagramSnakeLayout(...args);
  }) };
});
import { renderGlyphDiagram } from "./render";
import { routeGlyphGraphEdges, type GlyphDiagramRoutingOptions } from "./route";
import { layoutGlyphGraph } from "./pipeline";
import { glyphDiagramSnakeLayout } from "./snake";
import { computeGlyphDiagramQuality } from "./quality";
import { GLYPH_DIAGRAM_WORK, GlyphDiagramWork, GlyphDiagramWorkLimit } from "./work";

function denseGraph(): GlyphGraph {
  let seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const seen = new Set<string>(), edges: GlyphGraphEdge[] = [];
  while (edges.length < 73) {
    const a = Math.floor(random() * 20), b = Math.floor(random() * 20);
    if (a === b) continue;
    const from = String(Math.min(a, b)), to = String(Math.max(a, b)), key = `${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key); edges.push({ from, to, style: "undirected" });
  }
  return { direction: "TB", nodes: Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: String(i) })), edges };
}

beforeEach(() => { vi.clearAllMocks(); control.routeLimit = 80; control.layoutLimit = 90; control.snakeLimit = 600; });

describe("one deterministic render-wide work budget", () => {
  it("wraps long-label dense edge panels before declaring overflow", async () => {
    const dense = denseGraph();
    const graph = { ...dense, nodes: dense.nodes.map(node => ({ ...node, label: "Processing request with additional context ".repeat(3) + node.id })) };
    control.layoutLimit = 160;
    const result = await renderGlyphDiagram(graph, { target: "web", autoDirection: true });
    expect(result.pages).toHaveLength(73);
    expect(result.pages.every(page => page.layout.nodes.length === 2 && page.text.trim().length > 0)).toBe(true);
    expect(result.pages.flatMap(page => page.routes)).toHaveLength(73);
    for (const page of result.pages) for (const node of page.layout.nodes) {
      expect(node.lines.join(" ").replace(/\s+/g, " ")).toBe(node.label.replace(/\s+/g, " "));
    }
    expect(result.report.unroutable).toEqual([]);
    expect(result.report.ledger.some(entry => entry.code === "render-work-limited")).toBe(true);
    expect(result.report.ledger.some(entry => entry.code === "split-panel-dropped")).toBe(false);
  });

  it.each([
    [72, 24, "paginate", "a3e41473b333783898b18272c7d0550760f4724411ac6b42feefed5de2b165af"],
    [143, 57, "expand", "4bb9c280088c9b1e00bec5c5a9a97acfde1ad3432e54d6cdc798477458ab285c"],
    [80, 43, "expand", "05167ad3a6472da1336dfe0df75b764ff341b6f5b5a571be7641b5ca6e3a7ee7"],
    [48, 42, "expand", "aaefb1395d7fc30c6b791c9506f0895a5da675456c877a8cd84cdad7ddce516d"],
    [38, 10, "expand", "f802736ad13af06fc7d44eead0e961d9ac3c7762dc9061a83c648fd78cb706ac"],
    [13, 7, "expand", "fb3436013eba783161c696ae24ba14b2ffab360cfbbf2630521a9ef89212da2c"],
  ] as const)("keeps RAG complete without exhaustion at %s × %s (%s)", async (width, height, overflow, hash) => {
    control.layoutLimit = 1_000; control.routeLimit = 1_000; control.snakeLimit = 10_000;
    const source = readFileSync(resolve(__dirname, "../fixtures/rag-pipeline.mmd"), "utf8");
    const result = await renderGlyphDiagram(source, { target: "chat", width, height, overflow, autoDirection: true, color: "none" });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.layout.nodes).toHaveLength(8);
    expect(result.pages[0]!.routes).toHaveLength(7);
    expect(result.report.unroutable).toEqual([]);
    expect(result.report.ledger.some(entry => entry.code === "render-work-limited")).toBe(false);
    // These hashes come from HEAD, including its complete wrapped labels.
    expect(createHash("sha256").update(result.text).digest("hex")).toBe(hash);
    const budget = (vi.mocked(routeGlyphGraphEdges).mock.calls[0]![1] as GlyphDiagramRoutingOptions & { [GLYPH_DIAGRAM_WORK]: GlyphDiagramWork })[GLYPH_DIAGRAM_WORK];
    expect(budget.counts.layouts).toBeGreaterThan(0);
    expect(budget.limited).toBe(false);
  }, 15_000);

  it.each([undefined, "expand"] as const)("bounds the default web dense graph (%s)", async overflow => {
    const result = await renderGlyphDiagram(denseGraph(), { target: "web", autoDirection: true, overflow });
    expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThanOrEqual(80);
    expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThanOrEqual(90);
    expect(vi.mocked(glyphDiagramSnakeLayout).mock.calls.length).toBeLessThanOrEqual(600);
    expect(computeGlyphDiagramQuality(result, { width: 96, height: 32 })).toMatchObject({ wordCuts: 0, droppedEdges: 0, droppedLabels: 0, pages: 73 });
    expect(result.report.unroutable).toEqual([]);
    const limit = result.report.ledger.find(entry => entry.code === "render-work-limited")!;
    expect(limit).toBeDefined();
    expect(limit.detail!.work).toBeLessThanOrEqual(limit.detail!.workLimit as number);
    if (!overflow) expect(createHash("sha256").update(result.text).digest("hex"))
      .toBe("41bc1ff8ae85e63b67fa211b5d291e887fa3390569781f6b518e858cadab7309");
  });

  it("shares the routing-count bound across directions, ladder rungs and edge panels", async () => {
    // At this size the dense layout reaches routing. Resetting the budget on
    // each fit restarts all four ladder searches and trips the 80-call guard.
    const result = await renderGlyphDiagram(denseGraph(), { target: "web", width: 400, height: 128, autoDirection: true, overflow: "expand" });
    const calls = vi.mocked(routeGlyphGraphEdges).mock.calls;
    expect(calls.length).toBeGreaterThan(73);
    expect(calls.length).toBeLessThanOrEqual(80);
    const budgets = calls.map(([, options]) => (options as GlyphDiagramRoutingOptions & { [GLYPH_DIAGRAM_WORK]: GlyphDiagramWork })[GLYPH_DIAGRAM_WORK]);
    expect(new Set(budgets).size).toBe(1);
    expect(budgets[0]).toBeInstanceOf(GlyphDiagramWork);
    expect(result.pages.flatMap(page => page.routes)).toHaveLength(73);
    expect(result.report.unroutable).toEqual([]);
  });

  it("skips an initial dense layout that cannot be funded", async () => {
    const graph = denseGraph();
    const edges = graph.nodes.flatMap((from, i) => graph.nodes.slice(i + 1).map(to => ({ from: from.id, to: to.id, style: "undirected" as const })));
    control.routeLimit = 191; control.layoutLimit = 191;
    const result = await renderGlyphDiagram({ ...graph, edges }, { target: "web", autoDirection: true });
    expect(vi.mocked(layoutGlyphGraph).mock.calls.every(([panel]) => panel.edges.length === 1)).toBe(true);
    expect(result.pages.flatMap(page => page.routes)).toHaveLength(190);
    expect(result.report.unroutable).toEqual([]);
  });

  it("spends the same budget on A* expansions", async () => {
    const graph: GlyphGraph = { direction: "TB", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] };
    const layout = await layoutGlyphGraph(graph);
    const budget = new GlyphDiagramWork({ ...graph, edges: [], nodes: [] }, 20, 20);
    budget.take("probes", 2_500_000 - 1_001);
    expect(() => routeGlyphGraphEdges(layout, { width: 20, height: 20, [GLYPH_DIAGRAM_WORK]: budget } as GlyphDiagramRoutingOptions)).toThrow(GlyphDiagramWorkLimit);
    expect(budget.counts.expansions).toBe(1);
  });

  it("does not lay out wraps whose minimum rank footprint cannot fit", async () => {
    const graph: GlyphGraph = { direction: "TB", nodes: [{ id: "a", label: "abcdefghijklmnopqrstuvwxyz" }, { id: "b", label: "abcdefghijklmnopqrstuvwxyz" }], edges: [{ from: "a", to: "b" }] };
    const result = await renderGlyphDiagram(graph, { target: "web", width: 14, height: 8, detail: "faithful", autoDirection: false });
    // Default plus four alignments, on the graph and its sole edge panel.
    expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThanOrEqual(10);
    expect(result.report.unroutable).toHaveLength(1);
    expect(routeGlyphGraphEdges).not.toHaveBeenCalled();
  });
});
