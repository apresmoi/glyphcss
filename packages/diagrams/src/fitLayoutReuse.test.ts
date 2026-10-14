import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("./pipeline", async importOriginal => {
  const real = await importOriginal<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn(real.layoutGlyphGraph) };
});
import { GLYPH_DIAGRAM_EDGE_LABEL_ROOM, layoutGlyphGraph, type GlyphDiagramLayout } from "./pipeline";
import { GLYPH_DIAGRAM_DAGRE_ALIGN, GLYPH_DIAGRAM_DAGRE_ALIGNMENTS } from "./fitAlignment";
import { fitGlyphGraph } from "./fit";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

it("matches fresh flat layouts across alignment, direction, label room and margins", async () => {
  const graph = {
    direction: "TB" as const,
    nodes: ["A", "Long branch", "C", "Joined", "Other leaf"].map((label, i) => ({ id: String(i), label })),
    edges: [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4]].map(([from, to], i) =>
      ({ id: String(i), from: String(from), to: String(to), label: i === 0 ? "branch caption" : undefined })),
  };
  const cache = new Map<string, { raw: GlyphDiagramLayout; pad: number }>();
  const get = Map.prototype.get, set = Map.prototype.set;
  let hits = 0;
  // Keep only the fitter's raw/pad entries across calls so each option boundary
  // exercises the production cache key without exposing a test-only API.
  const cachedFit = async (options: Parameters<typeof fitGlyphGraph>[1]) => {
    const read = vi.spyOn(Map.prototype, "get").mockImplementation(function (this: Map<unknown, unknown>, key) {
      const entry = get.call(cache, key);
      if (entry) { hits++; return entry; }
      return get.call(this, key);
    });
    const write = vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key, value) {
      if (value?.raw && typeof value.pad === "number") set.call(cache, key, value);
      return set.call(this, key, value);
    });
    try { return await fitGlyphGraph(graph, options); }
    finally { read.mockRestore(); write.mockRestore(); }
  };
  const layouts: GlyphDiagramLayout[] = [];
  for (const direction of ["LR", "TB"] as const) {
    for (const align of [undefined, ...GLYPH_DIAGRAM_DAGRE_ALIGNMENTS]) {
      for (const room of [[], ["0"]]) {
        for (const margin of [0, 1, 3]) {
          const options = { width: 120, height: 80, direction, nodesep: 4, ranksep: 4, margin,
            [GLYPH_DIAGRAM_DAGRE_ALIGN]: align, [GLYPH_DIAGRAM_EDGE_LABEL_ROOM]: room };
          const cached = await cachedFit(options);
          const fresh = await fitGlyphGraph(graph, options);
          expect(cached.layout, JSON.stringify({ direction, align, room, margin })).toEqual(fresh.layout);
          layouts.push(fresh.layout);
        }
      }
    }
  }
  expect(hits).toBeGreaterThanOrEqual(40);
  // The graph must distinguish alignments and label-room settings, not merely
  // compare identical geometry under differently named options.
  expect(layouts[0]).not.toEqual(layouts[6]);
  expect(layouts[0]).not.toEqual(layouts[3]);
});

it.each([
  ["galaxy-build-detailed", 24, 36],
  ["galaxy-sources-h60", 60, 33],
] as const)("reuses equivalent flat margin probes in %s", async (name, height, bound) => {
  const source = readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
  vi.mocked(layoutGlyphGraph).mockClear();
  const result = await renderGlyphDiagram(source, {
    target: "chat", width: 72, height, charset: "box", color: "none", autoDirection: true, detail: "faithful", overflow: "expand",
  });
  // Disabling flat reuse gives 71/67 calls; these bounds count actual layouts,
  // with the default alignment search and hyphen handling both enabled.
  expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThanOrEqual(bound);
  expect(computeGlyphDiagramQuality(result, { width: 72, height })).toMatchObject({
    wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1,
  });
  if (name === "galaxy-build-detailed") {
    expect(createHash("sha256").update(result.text).digest("hex")).toBe("a5ab487c4f177a38a6e515640b4e84b93bb5d4c7a20e844c28bb29a0bb8a2ef8");
  }
});
