import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
vi.mock("./pipeline", async real => {
  const module = await real<typeof import("./pipeline")>();
  return { ...module, layoutGlyphGraph: vi.fn(module.layoutGlyphGraph) };
});
import { layoutGlyphGraph } from "./pipeline";
import { glyphParseMermaid } from "./mermaid";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

it.each([
  ["classDiagram-v2\nclass Animal", "classDiagram\nclass Animal"],
  ["flowchart-elk TD\nA --> B", "flowchart TD\nA --> B"],
])("normalizes the header of %s before dispatch and logs substitution", async (source, canonical) => {
  const decorated = `\uFEFF---\r\nconfig:\r\n theme: dark\r\n---\r\n%% prefix\r\n%%{init: {\r\n}}%%\r\n${source.replace(/\n/g, "\r\n")}`;
  const parsed = glyphParseMermaid(decorated);
  expect(parsed.graph).toEqual(glyphParseMermaid(canonical).graph);
  expect(parsed.notes).toContainEqual(expect.objectContaining({ code: "mermaid-degraded", detail: { kind: "layout-substitution" } }));
  for (const target of ["chat", "web"] as const) {
    const result = await renderGlyphDiagram(decorated, { target, width: 72 });
    expect(result.text).toBe((await renderGlyphDiagram(canonical, { target, width: 72 })).text);
  }
});

it("retains the default chat class fixture's output within bounded fitting work", async () => {
  const fixtures = JSON.parse(readFileSync("fixtures/mermaid-task4.json", "utf8")) as { id: string; source: string }[];
  const source = fixtures.find(item => item.id === "class-identifier-forms")!.source;
  vi.mocked(layoutGlyphGraph).mockClear();
  const result = await renderGlyphDiagram(source, { target: "chat" });
  // Real-edge footprint pruning: 24 layouts, versus 1,944 without the bound.
  expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThan(60);
  expect(createHash("sha256").update(result.text).digest("hex")).toBe("d83f7a06ea5f0c565faf324317cf873986ee6cae53e41a2c2d605e506ded9378");
  expect(result.meta.nodes).toHaveLength(5);
  expect(result.report.unroutable).toEqual([]);
  expect(computeGlyphDiagramQuality(result, { width: 72, height: 24 })).toMatchObject({ crossings: 0, droppedEdges: 0, wordCuts: 0 });
});

it("does not emit a relation-review notice for a class with no relations", () => {
  expect(glyphParseMermaid("classDiagram\nclass Animal").notes).toEqual([]);
});

it.each(["flowchart", "graph", "flowchart-elk"])("defaults a bare %s header to TB", header => {
  expect(glyphParseMermaid(`${header}\nA --> B`).graph).toEqual(glyphParseMermaid("flowchart TB\nA --> B").graph);
});
