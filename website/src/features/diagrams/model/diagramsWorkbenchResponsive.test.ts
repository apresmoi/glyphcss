import { describe, expect, it } from "vitest";
import {
  buildGlyphDiagramsWorkbenchGraph,
  createGlyphDiagramsWorkbenchState,
  generateGlyphDiagramsWorkbenchSnippets,
  glyphDiagramsWorkbenchChatCharset,
  glyphDiagramsWorkbenchLanesRenderOptions,
  glyphDiagramsWorkbenchRenderOptions,
  glyphDiagramsWorkbenchSequenceRenderOptions,
  glyphDiagramsWorkbenchWebGridSize,
  reduceGlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "../render/diagramsWorkbenchRender";
import { renderGlyphDiagram } from "@glyphcss/diagrams";

const ragState = () =>
  reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
    type: "apply-preset",
    id: "rag-pipeline",
  });

describe("graph relayout", () => {
  it.each(["box", "braille"] as const)(
    "keeps the complete RAG graph in chat's 72 × 24 grid with %s selected",
    async (charset) => {
      const state = { ...ragState(), controls: { target: "chat" as const, overrides: { charset } } };
      const graph = buildGlyphDiagramsWorkbenchGraph(state);
      const result = await renderGlyphDiagramsWorkbenchState(state);
      if (!result.ok) throw new Error(result.error);
      expect(result.grid).toEqual({ cols: 72, rows: 24 });
      expect(result.meta.description).toContain("LR; 1 panel.");
      const requested = glyphDiagramsWorkbenchChatCharset(glyphDiagramsWorkbenchRenderOptions(state));
      expect(requested).toMatchObject({
        width: 72,
        height: 24,
        target: "chat",
        charset: "box",
        autoDirection: true,
        overflow: "paginate",
      });
      const rendered = await renderGlyphDiagram(graph, requested);
      expect(rendered.pages).toHaveLength(1);
      expect(rendered.report.unroutable).toEqual([]);
      expect(rendered.pages[0].layout.nodes.map(({ id }) => id).sort()).toEqual(graph.nodes.map(({ id }) => id).sort());
      expect(rendered.pages[0].routes.map(({ edge }) => `${edge.from}->${edge.to}`).sort()).toEqual(
        graph.edges.map(({ from, to }) => `${from}->${to}`).sort(),
      );
      const lines = result.text.split("\n");
      for (const node of rendered.pages[0].layout.nodes) {
        const original = graph.nodes.find(({ id }) => id === node.id)!;
        expect(node.shape).toBe(original.shape);
        const contents = lines
          .slice(node.y0 + 1, node.y1)
          .map((line) => line.slice(node.x0 + 1, node.x1))
          .join("")
          .replace(/[^\p{L}\p{N}]/gu, "");
        expect(contents).toBe(original.label.replace(/[^\p{L}\p{N}]/gu, ""));
      }
    },
  );

  it.each(["terminal", "chat"] as const)("reflows Auto to the configured %s column budget", async (target) => {
    const state = ragState();
    for (const [width, direction] of [
      [120, "LR"],
      [48, "TB"],
    ] as const) {
      const result = await renderGlyphDiagramsWorkbenchState({
        ...state,
        controls: { target, overrides: { width, height: 48, color: "none" } },
      });
      if (!result.ok) throw new Error(result.error);
      expect(result.grid).toEqual({ cols: width, rows: 48 });
      expect(result.meta.description).toContain(`${direction}; 1 panel.`);
      for (const node of buildGlyphDiagramsWorkbenchGraph(state).nodes) expect(result.text).toContain(node.label);
    }
  });

  it("uses available columns to rearrange the complete RAG graph at normal font size", async () => {
    const state = ragState();
    for (const [viewport, direction, cols, rows] of [
      [{ width: 1092, height: 742 }, "LR", 143, 57],
      [{ width: 612, height: 562 }, "TB", 80, 43],
      [{ width: 366, height: 550 }, "TB", 48, 42],
      [{ width: 1092, height: 742 }, "LR", 143, 57],
    ] as const) {
      const result = await renderGlyphDiagramsWorkbenchState(state, viewport);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.grid).toEqual({ cols, rows });
      expect(result.meta.description).toContain(`${direction}; 1 panel.`);
      for (const node of buildGlyphDiagramsWorkbenchGraph(state).nodes) expect(result.text).toContain(node.label);
    }
  }, 15_000);

  it("reflows labels and spacing without rotating an explicitly selected LR graph", async () => {
    const state = reduceGlyphDiagramsWorkbenchState(ragState(), { type: "set-layout", patch: { direction: "LR" } });
    const result = await renderGlyphDiagramsWorkbenchState(state, { width: 612, height: 562 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.grid).toEqual({ cols: 80, rows: 43 });
    expect(result.meta.description).toContain("LR; 1 panel.");
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const lines = result.text.split("\n");
    for (const hotspot of result.hotspots ?? []) {
      if (hotspot.kind !== "node") continue;
      const content = lines
        .slice(hotspot.y0 + 1, hotspot.y1)
        .map((line) => line.slice(hotspot.x0 + 1, hotspot.x1))
        .join("")
        .replace(/[^\p{L}\p{N}]/gu, "");
      expect(content).toBe(graph.nodes.find((node) => node.id === hotspot.id)!.label.replace(/[^\p{L}\p{N}]/gu, ""));
    }
    expect(result.hotspots?.filter((h) => h.kind === "node")).toHaveLength(8);
    expect(new Set(result.hotspots?.filter((h) => h.kind === "edge").map((h) => `${h.from}->${h.to}`))).toEqual(
      new Set(graph.edges.map((e) => `${e.from}->${e.to}`)),
    );
  }, 15_000);

  it("keeps the widest requested spacing that fits before considering another direction", async () => {
    const state = reduceGlyphDiagramsWorkbenchState(ragState(), {
      type: "set-layout",
      patch: { nodesep: 12, ranksep: 12 },
    });
    const result = await renderGlyphDiagramsWorkbenchState(state, { width: 900, height: 600 });
    if (!result.ok) throw new Error(result.error);
    expect(result.meta.description).toContain("LR; 1 panel.");
    const native = await renderGlyphDiagram(
      buildGlyphDiagramsWorkbenchGraph(state),
      glyphDiagramsWorkbenchRenderOptions(state, { width: 900, height: 600 }),
    );
    const rerank = native.layout.nodes.find(({ id }) => id === "rerank")!;
    const generate = native.layout.nodes.find(({ id }) => id === "generate")!;
    const gap = generate.x0 - rerank.x1 - 1;
    expect(gap).toBeGreaterThan(3);
    expect(gap).toBeLessThan(12);
    expect(result.grid).toEqual({ cols: 118, rows: 46 });
  });

  it("exports the native responsive options that reproduce the live layout", async () => {
    const state = ragState();
    const viewport = { width: 366, height: 550 };
    const result = await renderGlyphDiagramsWorkbenchState(state, viewport);
    if (!result.ok) throw new Error(result.error);
    expect(glyphDiagramsWorkbenchRenderOptions(state, viewport)).toMatchObject({
      autoDirection: true,
      overflow: "expand",
      width: 48,
      height: 42,
    });
    const snippets = generateGlyphDiagramsWorkbenchSnippets(state, viewport);
    const execute = new Function(
      "renderGlyphDiagram",
      `return (async () => {${snippets.typescript.replace(/^import[^\n]+\n/, "")} return diagram;})();`,
    );
    const exported = await execute(renderGlyphDiagram);
    expect(exported.text).toBe(result.text);
    expect(exported.html).toBe(result.display);
    expect(exported.report.unroutable).toEqual([]);
  });
});

describe("diagram web viewport sizing", () => {
  it("uses the exact available grid on shrink and growth, with defaults only before measurement", () => {
    expect(glyphDiagramsWorkbenchWebGridSize(undefined)).toEqual({
      width: 96,
      height: 32,
    });
    expect(glyphDiagramsWorkbenchWebGridSize({ width: 1, height: 1 })).toEqual({
      width: 1,
      height: 1,
    });
    expect(glyphDiagramsWorkbenchWebGridSize({ width: 761.71875, height: 130 })).toEqual({ width: 100, height: 10 });
    expect(glyphDiagramsWorkbenchWebGridSize({ width: 100, height: 520 })).toEqual({ width: 13, height: 40 });
  });

  it.each([
    glyphDiagramsWorkbenchRenderOptions,
    glyphDiagramsWorkbenchSequenceRenderOptions,
    glyphDiagramsWorkbenchLanesRenderOptions,
  ])("uses the same measured web cell budget for every form while preserving terminal/chat overrides", (options) => {
    const state = createGlyphDiagramsWorkbenchState();
    const small = { width: 100, height: 100 };
    expect(options(state, small)).toMatchObject({ width: 13, height: 7 });
    for (const target of ["terminal", "chat"] as const) {
      const fixed = {
        ...state,
        controls: { target, overrides: { width: 60, height: 20 } },
      };
      expect(options(fixed, small)).toMatchObject({ width: 60, height: 20 });
    }
  });

  it("keeps all RAG nodes and edges in one panel across viewport shrink and growth", async () => {
    const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "apply-preset",
      id: "rag-pipeline",
    });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    expect(graph.nodes).toHaveLength(8);
    for (const viewport of [
      undefined,
      { width: 100, height: 100 },
      { width: 296, height: 130 },
      { width: 761.71875, height: 130 },
      { width: 1523.4375, height: 520 },
      { width: 100, height: 100 },
    ]) {
      const result = await renderGlyphDiagramsWorkbenchState(state, viewport);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.meta.description).toContain("1 panel.");
      expect(
        result.hotspots
          ?.filter((hotspot) => hotspot.kind === "node")
          .map((node) => node.id)
          .sort(),
      ).toEqual(graph.nodes.map((node) => node.id).sort());
      const renderedEdges = new Set(
        result.hotspots?.filter((hotspot) => hotspot.kind === "edge").map((edge) => `${edge.from}->${edge.to}`),
      );
      expect(renderedEdges).toEqual(new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}`)));
      const lines = result.text.split("\n");
      for (const hotspot of result.hotspots ?? []) {
        if (hotspot.kind !== "node") continue;
        const content = lines
          .slice(hotspot.y0 + 1, hotspot.y1)
          .map((line) => line.slice(hotspot.x0 + 1, hotspot.x1))
          .join("")
          .replace(/[^\p{L}\p{N}]/gu, "");
        expect(content).toBe(graph.nodes.find((node) => node.id === hotspot.id)!.label.replace(/[^\p{L}\p{N}]/gu, ""));
      }
    }
  }, 15_000);
});
