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
        wordCuts: 0, crossings: 0, bends: { total: 10, max: 2 }, droppedEdges: 0, droppedLabels: 0, pages: 1,
      });
      expect(createHash("sha256").update(result.text).digest("hex"))
        .toBe("86379608bd9352577c00d367121c498fb3224076ff5acf450d08f44627300343");
    } finally { control.routeLimit = Infinity; }
  });

  it("keeps a whole-word default byte-identical without trying extra alignments", async () => {
    clear();
    const text = readFileSync(resolve(__dirname, "../fixtures/event-queue.mmd"), "utf8");
    const result = await renderGlyphDiagram(text, { ...options, width: 60, height: 24 });
    expect(computeGlyphDiagramQuality(result, { width: 60, height: 24 }).wordCuts).toBe(0);
    expect(alignments().every(align => align === undefined)).toBe(true);
    expect(createHash("sha256").update(JSON.stringify(result.pages.map(page => page.text))).digest("hex"))
      .toBe("aea376bd9373c7b14f039fe0fcf010334325872e093e836c5d2fc9676d502932");
  });

  it("recognizes a folded multiline default as a whole-word fit", async () => {
    clear();
    const result = await renderGlyphDiagram("flowchart TB\nA[alpha<br/>beta] --> B[gamma<br/>delta]", options);
    expect(result.layout.nodes[0]!.lines).toEqual(["alpha", "beta"]);
    expect(alignments().every(align => align === undefined)).toBe(true);
  });

  it("tries all four alignments and improves sources without a quality regression", async () => {
    clear();
    const result = await renderGlyphDiagram(source(), options);
    const quality = computeGlyphDiagramQuality(result, options);
    expect(new Set(alignments())).toEqual(new Set([undefined, "UL", "UR", "DL", "DR"]));
    expect(quality.wordCuts).toBe(7);
    expect(result.canvas.grid).toMatchObject({ cols: 72, rows: 71 });
    expect(quality.crossings).toBeLessThanOrEqual(1);
    expect(quality.bends.total).toBeLessThanOrEqual(22);
    expect(quality.bends.max).toBeLessThanOrEqual(6);
    expect(quality.detourRatio.mean).toBeLessThanOrEqual(1.2001887273946097);
    expect(quality.detourRatio.max).toBeLessThanOrEqual(1.8518518518518519);
    expect(quality.whitespaceFraction).toBeLessThanOrEqual(0.863960113960114);
    expect(quality.maxArrowheadsOnSide).toBeLessThanOrEqual(4);
    expect(quality.droppedEdges).toBe(0);
    expect(quality.droppedLabels).toBe(0);
    expect(quality.pages).toBe(1);
    expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThanOrEqual(380);
    expect(createHash("sha256").update(JSON.stringify(result.pages.map(page => page.text))).digest("hex"))
      .toBe("36d558df903ca8fb9a62cc6d6b355c736985375b916a9c780a7a53a0721b10c5");
  }, 30_000);

  it("routes an identical single-node layout only once across BK alignments", async () => {
    clear();
    const result = await renderGlyphDiagram("flowchart TB\nA[abcdefgh]", { ...options, labelWidth: 2 });
    expect(result.layout.nodes[0]!.lines).toEqual(["ab", "cd", "ef", "gh"]);
    expect(routeGlyphGraphEdges).toHaveBeenCalledTimes(1);
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
      expect(result.report.ledger).toContainEqual(expect.objectContaining({ code: "fit-search-limited" }));
      expect(result.pages.flatMap(page => page.routes)).toHaveLength(13);
    } finally { control.forced = undefined; control.routeLimit = Infinity; }
  }, 30_000);
});
