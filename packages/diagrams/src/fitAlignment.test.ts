import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { GLYPH_DIAGRAM_DAGRE_ALIGN, type GlyphDiagramDagreAlignment } from "./fitAlignment";

const control = vi.hoisted(() => ({ forced: undefined as GlyphDiagramDagreAlignment | undefined, routeLimit: Infinity }));
vi.mock("./pipeline", async importOriginal => {
  const real = await importOriginal<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn(real.layoutGlyphGraph) };
});
vi.mock("@dagrejs/dagre", async importOriginal => {
  const real = await importOriginal<typeof import("@dagrejs/dagre")>();
  class Graph extends real.graphlib.Graph {
    setGraph(label: Parameters<InstanceType<typeof real.graphlib.Graph>["setGraph"]>[0]) {
      return super.setGraph(control.forced ? { ...(label as object), align: control.forced } : label);
    }
  }
  return { ...real, graphlib: { ...real.graphlib, Graph } };
});
vi.mock("./route", async importOriginal => {
  const real = await importOriginal<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: vi.fn((...args: Parameters<typeof real.routeGlyphGraphEdges>) => {
    // Fail promptly when the deterministic guard is mutated out; never wait for
    // the original DL search to exhaust its thousands of routing canvases.
    if (vi.mocked(routeGlyphGraphEdges).mock.calls.length > control.routeLimit) throw new Error("routing work exceeded its test bound");
    return real.routeGlyphGraphEdges(...args);
  }) };
});
import { layoutGlyphGraph } from "./pipeline";
import { routeGlyphGraphEdges } from "./route";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const source = () => readFileSync(resolve(__dirname, "../bench/corpus/galaxy-sources-h60.mmd"), "utf8");
const options = { width: 72, height: 60, target: "chat", charset: "box", color: "none", autoDirection: true, detail: "faithful", overflow: "expand" } as const;
const alignments = () => vi.mocked(layoutGlyphGraph).mock.calls.map(([, opts]) =>
  (opts as typeof opts & { [GLYPH_DIAGRAM_DAGRE_ALIGN]?: GlyphDiagramDagreAlignment })?.[GLYPH_DIAGRAM_DAGRE_ALIGN]);
const clear = () => { vi.mocked(layoutGlyphGraph).mockClear(); vi.mocked(routeGlyphGraphEdges).mockClear(); };

describe("Dagre alignment is a private fit dimension", () => {
  it("repairs agent-guardrail's web corridor before exhaustive wrapping", async () => {
    clear();
    control.routeLimit = 15;
    try {
      const text = readFileSync(resolve(__dirname, "../fixtures/agent-guardrail.mmd"), "utf8");
      const result = await renderGlyphDiagram(text, { target: "web" });
      expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThanOrEqual(15);
      expect(computeGlyphDiagramQuality(result, { width: 96, height: 32 })).toMatchObject({
        wordCuts: 0, crossings: 0, bends: { total: 8, max: 2 }, droppedEdges: 0, droppedLabels: 0, pages: 1,
      });
      expect(createHash("sha256").update(result.text).digest("hex"))
        .toBe("573c315691b33ea6a8c25fd11bf5fc34dbd13cbcfafe828634a016fb6cfe6be9");
    } finally { control.routeLimit = Infinity; }
  });

  it("keeps a whole-word default byte-identical without trying extra alignments", async () => {
    clear();
    const text = readFileSync(resolve(__dirname, "../fixtures/event-queue.mmd"), "utf8");
    const result = await renderGlyphDiagram(text, { ...options, width: 60, height: 24 });
    expect(computeGlyphDiagramQuality(result, { width: 60, height: 24 }).wordCuts).toBe(0);
    expect(alignments().every(align => align === undefined)).toBe(true);
    expect(createHash("sha256").update(JSON.stringify(result.pages.map(page => page.text))).digest("hex"))
      .toBe("ed4757e6bdd04a45136ee40352ab5a5b6b268922a5b9ecbe317413ee6fba18db");
  });

  it("recognizes a folded multiline default as a whole-word fit", async () => {
    clear();
    const result = await renderGlyphDiagram("flowchart TB\nA[alpha<br/>beta] --> B[gamma<br/>delta]", options);
    expect(result.layout.nodes[0]!.lines).toEqual(["alpha", "beta"]);
    expect(alignments().every(align => align === undefined)).toBe(true);
  });

  it("keeps the clean folded default without alignment probes", async () => {
    clear();
    const result = await renderGlyphDiagram(source(), options);
    const quality = computeGlyphDiagramQuality(result, options);
    expect(new Set(alignments())).toEqual(new Set([undefined]));
    expect(quality.wordCuts).toBe(0);
    expect(result.canvas.grid).toMatchObject({ cols: 72, rows: 60 });
    expect(quality.crossings).toBe(0);
    expect(quality.bends.total).toBeLessThanOrEqual(24);
    expect(quality.bends.max).toBeLessThanOrEqual(6);
    // Two-cell straight links have the endpoint-inclusive ratio 2 after compaction.
    expect(quality.detourRatio.mean).toBeCloseTo(1.3261622593619746, 12);
    expect(quality.detourRatio.max).toBeLessThanOrEqual(2);
    expect(quality.whitespaceFraction).toBeLessThanOrEqual(0.863960113960114);
    expect(quality.maxArrowheadsOnSide).toBeLessThanOrEqual(4);
    expect(quality.droppedEdges).toBe(0);
    expect(quality.droppedLabels).toBe(0);
    expect(quality.pages).toBe(1);
    expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThanOrEqual(380);
    expect(createHash("sha256").update(JSON.stringify(result.pages.map(page => page.text))).digest("hex"))
      .toBe("a6f5efcd83a5ddb6dd338311c727fdcf29c36a0c60983052693526cf4e775e33");
  }, 30_000);

  it("routes an identical single-node layout only once across BK alignments", async () => {
    clear();
    const result = await renderGlyphDiagram("flowchart TB\nA[abcdefgh]", { ...options, labelWidth: 2 });
    expect(result.layout.nodes[0]!.lines).toEqual(["ab", "cd", "ef", "gh"]);
    expect(routeGlyphGraphEdges).toHaveBeenCalledTimes(1);
  });

  it.each(["galaxy-anchors-detailed", "galaxy-sources-to-model"])("bounds measured-label probes for %s crossings", async name => {
    clear();
    const text = readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
    const result = await renderGlyphDiagram(text, { ...options, height: 24 });
    const probes = vi.mocked(layoutGlyphGraph).mock.calls.filter(([, opts]) =>
      (opts as typeof opts & { [GLYPH_DIAGRAM_DAGRE_ALIGN]?: GlyphDiagramDagreAlignment })?.[GLYPH_DIAGRAM_DAGRE_ALIGN]);
    expect(probes).toHaveLength(0);
    expect(new Set(alignments())).toEqual(new Set([undefined]));
    if (name === "galaxy-anchors-detailed") {
      expect(probes.every(([graph]) => "ports" in graph)).toBe(true);
      expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThanOrEqual(10);
    }
    expect(computeGlyphDiagramQuality(result, { width: 72, height: 24 })).toMatchObject({
      wordCuts: 0, crossings: 0, droppedEdges: 0, droppedLabels: 0, pages: 1,
    });
  });

  it.each(["TB", "BT", "LR", "RL"] as const)("reserves %s gaps by crossing connections, not the largest fan", async direction => {
    const graph = { direction,
      nodes: ["a", "b", "c", "a1", "a2", "b1", "b2", "c1", "c2"].map(id => ({ id, label: id })),
      edges: ["a", "b", "c"].flatMap(from => [1, 2].map(n => ({ from, to: `${from}${n}` }))),
    };
    const layoutOptions = { direction, [GLYPH_DIAGRAM_DAGRE_ALIGN]: "UL" as const };
    const result = await layoutGlyphGraph(graph, layoutOptions);
    const across = direction === "TB" || direction === "BT";
    const primary = (id: string) => {
      const node = result.nodes.find(node => node.id === id)!;
      return across ? [node.y0, node.y1] : [node.x0, node.x1];
    };
    const source = primary("a"), target = primary("a1");
    const gap = source[0]! < target[0]! ? target[0]! - source[1]! - 1 : source[0]! - target[1]! - 1;
    expect(gap).toBeGreaterThanOrEqual(7); // Six crossings plus their turn; every fan is only two.
  });

  it("bounds the formerly explosive DL expansion and reports the shortened search", async () => {
    clear();
    control.forced = "DL"; control.routeLimit = 450;
    try {
      const result = await renderGlyphDiagram(source(), options);
      expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThanOrEqual(450);
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.report.unroutable).toEqual([]);
      expect(result.report.ledger.some(entry => entry.code === "render-work-limited")).toBe(false);
      expect(result.pages.flatMap(page => page.routes)).toHaveLength(13);
    } finally { control.forced = undefined; control.routeLimit = Infinity; }
  }, 30_000);
});
