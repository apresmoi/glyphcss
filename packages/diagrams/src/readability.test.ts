import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const source = (name: string) => readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;

it("recovers a lone label's whole word without narrowing other ranks", async () => {
  const result = await renderGlyphDiagram(source("galaxy-build-detailed"), options);
  expect(result.layout.nodes.find(n => n.id === "X")!.lines).toContain("scattering");
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

it("recovers a word in a horizontal fit without adding crossings or pages", async () => {
  const result = await renderGlyphDiagram(source("galaxy-build-compact"), options);
  expect(result.layout.nodes.find(n => n.id === "E")!.lines).toContain("Edenhofer");
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

it.each(["galaxy-anchors-detailed", "galaxy-sources-to-model"])("chooses a crossing-free %s within the original fit's size", async name => {
  const result = await renderGlyphDiagram(source(name), options);
  const quality = computeGlyphDiagramQuality(result, options);
  expect(quality).toMatchObject({ wordCuts: 0, crossings: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
  expect(result.canvas.cols).toBe(72);
  expect(result.canvas.rows).toBeLessThanOrEqual(name === "galaxy-anchors-detailed" ? 33 : 53);
}, 10_000);
