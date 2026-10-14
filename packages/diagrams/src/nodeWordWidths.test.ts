import { GLYPH_DIAGRAM_WORD_WIDTH } from "./layoutHints";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { measureGlyphGraph } from "./pipeline";
it("reserves each node's own longest word instead of a shared wrap cap", () => {
  const measured = measureGlyphGraph({ direction: "TB", nodes: [{ id: "a", label: "Galaxia populations" }, { id: "b", label: "small words" }], edges: [] }, { labelWidth: 7, [GLYPH_DIAGRAM_WORD_WIDTH]: true });
  expect(measured.nodes[0]!.lines).toEqual(["Galaxia", "populations"]);
  expect(measured.nodes[0]!.width).toBe(15);
  expect(measured.nodes[1]!.width).toBe(9);
});
it("fits populations and makes Papers shorter without increasing the visible height", async () => {
  const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
  const result = await renderGlyphDiagram(readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8"), options);
  expect(result.layout.direction).toBe("TB");
  expect(result.layout.nodes.find(node => node.id === "G")!.lines).toContain("populations");
  expect(result.layout.nodes.find(node => node.id === "P")!.height).toBeLessThan(11);
  expect(result.canvas.cols).toBe(72);
  expect(result.canvas.rows).toBeLessThanOrEqual(28);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

it("trades crowded source widths for a balanced Papers label", async () => {
  const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
  const result = await renderGlyphDiagram(readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8"), options);
  const papers = result.layout.nodes.find(node => node.id === "P")!;
  expect(papers.lines).toEqual(["Papers:", "Reid arms,", "BHG discs,", "Robin hole,", "Bennett zSun"]);
  expect(papers.height).toBe(7);
  expect(result.layout.nodes.find(node => node.id === "X")!.lines).toEqual(["Render: dust", "dimming +", "scattering"]);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

it("keeps a fitting hyphenated token whole when widening an uncapped node", () => {
  const measured = measureGlyphGraph({ direction: "LR", nodes: [{ id: "face", label: "Face-on" }], edges: [] },
    { labelWidth: 5, [GLYPH_DIAGRAM_WORD_WIDTH]: true });
  expect(measured.nodes[0]!.lines).toEqual(["Face-on"]);
});
it("keeps the explicit cap while fitting crowded sources", async () => {
  const result = await renderGlyphDiagram(readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8"),
    { target: "chat", width: 72, height: 24, overflow: "expand", autoDirection: true, detail: "faithful", labelWidth: 7 });
  expect(result.layout.nodes.flatMap(node => node.lines).every(line => line.length <= 7)).toBe(true);
});

it("shrinks a widened tail head's bounds together with its label height", async () => {
  const result = await renderGlyphDiagram(readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-compact.mmd"), "utf8"),
    { target: "chat", width: 72, height: 24, overflow: "expand", autoDirection: true, detail: "faithful" });
  const head = result.layout.nodes.find(node => node.id === "M")!;
  expect(head.lines).toEqual(["3D galaxy"]);
  expect(head.height).toBe(3);
  expect(head.y1 - head.y0 + 1).toBe(3);
});
