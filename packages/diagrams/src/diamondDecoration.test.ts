import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { glyphGraphFromMermaid } from "./mermaid";
import { measureGlyphGraph } from "./pipeline";
import { GLYPH_DIAGRAM_DIAMOND_MARKER } from "./presentation";
import { renderGlyphDiagram, renderGlyphDiagramJson } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const source = readFileSync(resolve(__dirname, "../fixtures/event-queue.mmd"), "utf8");
const retry = "flowchart TB\n A{Valid?} -->|yes| B[Save]\n A -->|no| C[Reject]\n B -->|retry later| A";
const clean = "flowchart LR; A{Read item} --> B{Done}";
const notes = (result: Awaited<ReturnType<typeof renderGlyphDiagram>>) => result.report.ledger.filter(entry => entry.code === "diamond-markers-dropped");

it("keeps parser, serialized graph, measured labels and metadata free of presentation decoration", async () => {
  const graph = glyphGraphFromMermaid("flowchart LR; A{Label}");
  expect(graph.nodes).toEqual([{ id: "A", label: "Label", shape: "diamond" }]);
  const serialized = JSON.stringify(graph);
  const measured = measureGlyphGraph(graph);
  expect(measured.nodes[0]).toMatchObject({ label: "Label", lines: ["◆ Label"], width: 11 });
  expect(measured.nodes[0]![GLYPH_DIAGRAM_DIAMOND_MARKER]).toBe(true);
  const result = await renderGlyphDiagram(graph, { target: "chat" });
  expect(result.meta.nodes).toEqual(graph.nodes);
  expect(result.layout.nodes[0]!.label).toBe("Label");
  expect(JSON.stringify(graph)).toBe(serialized);
  const exported = JSON.parse(await renderGlyphDiagramJson(serialized, { target: "chat" }));
  expect(exported.meta.nodes).toEqual(graph.nodes);
  expect(exported.text).toBe(result.text);
});

it.each(["chat", "web"] as const)("retains every padded diamond marker on a clean %s fit", async target => {
  const result = await renderGlyphDiagram(clean, { target, width: 72 });
  expect(result.canvas.tier).toBe(target === "chat" ? "box" : "braille");
  expect(result.layout.nodes.map(node => node.lines)).toEqual([["◆ Read item"], ["◆ Done"]]);
  expect(result.meta.nodes.map(node => node.label)).toEqual(["Read item", "Done"]);
  for (const node of result.layout.nodes) {
    const row = result.text.split("\n")[node.y0 + 1]!;
    expect(row.slice(node.x0 + 1, node.x1)).toBe(` ${node.lines[0]} `);
  }
  expect(notes(result)).toEqual([]);
});

it.each(["chat", "web"] as const)("drops all diamond markers together before accepting extra %s crossings", async target => {
  // 68×32 reaches the marker-free comparison without exhausting the shared work budget.
  const options = { target, width: 68, height: 32, autoDirection: true, overflow: "expand", detail: "faithful" } as const;
  const result = await renderGlyphDiagram(source, options);
  expect(result.layout.nodes.filter(node => node.shape === "diamond").map(node => node.lines)).toEqual([["OK?"], ["OK?"]]);
  expect(result.meta.nodes.filter(node => node.shape === "diamond").map(node => node.label)).toEqual(["OK?", "OK?"]);
  expect(notes(result)).toEqual([expect.objectContaining({ detail: { nodes: ["ok1", "ok2"] } })]);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 2, droppedEdges: 0, droppedLabels: 0 });
});

for (const target of ["chat", "web"] as const) {
  it.each([
    { name: "clean markers", text: clean, width: 72, height: 24 },
    { name: "event-queue at 72 columns", text: source, width: 72, height: 24 },
    { name: "event-queue fallback", text: source, width: 60, height: 24 },
    { name: "28-column retry", text: retry, width: 28, height: 12 },
  ])(`renders source and serialized graph identically for $name (${target})`, async ({ text, width, height }) => {
    const graph = glyphGraphFromMermaid(text);
    const original = JSON.stringify(graph);
    const options = { target, width, height, autoDirection: true, overflow: "expand", detail: "faithful" } as const;
    const direct = await renderGlyphDiagram(text, options);
    const composed = await renderGlyphDiagram(JSON.parse(original), options);
    expect(composed.text).toBe(direct.text);
    expect(composed.html).toBe(direct.html);
    expect(composed.meta).toEqual(direct.meta);
    expect(composed.layout.nodes).toEqual(direct.layout.nodes);
    expect(notes(composed)).toEqual(notes(direct));
    expect(composed.meta.nodes.map(node => [node.id, node.label])).toEqual([...graph.nodes].sort((a, b) => a.id < b.id ? -1 : 1).map(node => [node.id, node.label]));
    expect(JSON.stringify(graph)).toBe(original);
    if (text === retry) {
      expect(composed.labels.map(label => label.text).sort()).toEqual(["no", "retry later", "yes"]);
      expect(notes(composed)).toHaveLength(1);
    }
  });
}

it("removes generated markers in the ordinary simplified decoration step too", async () => {
  const result = await renderGlyphDiagram(clean, { target: "chat", detail: "simplified" });
  expect(result.layout.nodes.map(node => node.label)).toEqual(["Read item", "Done"]);
  expect(result.layout.nodes.map(node => node.lines)).toEqual([["Read item"], ["Done"]]);
  expect(notes(result)).toHaveLength(1);
  expect(result.report.ledger.filter(entry => entry.code === "budget-decoration")).toHaveLength(1);
});

it("preserves authored diamond glyphs and the state choice glyph as content", async () => {
  const graph = glyphGraphFromMermaid('flowchart LR; A{"◆ authored"} --> B{Generated}');
  expect(graph.nodes.map(node => node.label)).toEqual(["◆ authored", "Generated"]);
  const result = await renderGlyphDiagram(graph, { target: "chat", detail: "simplified" });
  expect(result.layout.nodes.map(node => node.lines)).toEqual([["◆ authored"], ["Generated"]]);
  expect(notes(result)).toEqual([expect.objectContaining({ detail: { nodes: ["B"] } })]);
  const state = await renderGlyphDiagram("stateDiagram-v2; state C <<choice>>", { target: "chat", width: 9, height: 5, detail: "faithful" });
  expect(state.layout.nodes[0]!.lines).toEqual(["◆"]);
  expect(notes(state)).toEqual([]);
});
