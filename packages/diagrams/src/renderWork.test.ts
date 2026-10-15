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
    [72, 24, "paginate", "f3032b4c6f951b27e9842b5bd087b05aef43389c3cbcae82d7c6a5d4d41e95de"],
    [143, 57, "expand", "de783948b53706d3581b5b2eca538ef5e82e5caf46a56f5a47511a8995393844"],
    [80, 43, "expand", "60eb573d308f51c0f2ee1afd512f57eade3d616c60df06687518729d048be6ab"],
    [48, 42, "expand", "edaca79ba2defb390bb8ddf0502fd4f26fd6d6eca5b1127157ca816f14f98346"],
    [38, 10, "expand", "af8d301a8b60b50fe217487ad9317d001bec18780f186e3fad8ec59119561ba3"],
    [13, 7, "expand", "f6f0c11743486b84edf4a5b100172aa68c0bc5836739c8458b3ed3731413989c"],
  ] as const)("keeps RAG complete without exhaustion at %s × %s (%s)", async (width, height, overflow, hash) => {
    control.layoutLimit = 1_000; control.routeLimit = 1_000; control.snakeLimit = 10_000;
    const source = readFileSync(resolve(__dirname, "../fixtures/rag-pipeline.mmd"), "utf8");
    const result = await renderGlyphDiagram(source, { target: "chat", width, height, overflow, autoDirection: true, color: "none" });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.layout.nodes).toHaveLength(8);
    expect(result.pages[0]!.routes).toHaveLength(7);
    expect(result.report.unroutable).toEqual([]);
    expect(result.report.ledger.some(entry => entry.code === "render-work-limited")).toBe(false);
    // The 72x24 fit reduces bends from six to four with unchanged cuts/crossings/losses.
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
      .toBe("ec2166eb993aedec7dc3301085b74558482c018905a0dbd455ce826c8b5e652e");
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
