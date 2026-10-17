import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { layoutGlyphGraph } from "./pipeline";
import { glyphGraphFromMermaid } from "./mermaid";
import { GLYPH_DIAGRAM_DAGRE_ALIGN, GLYPH_DIAGRAM_DAGRE_ALIGNMENTS } from "./fitAlignment";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const source = readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8");
it.each([undefined, ...GLYPH_DIAGRAM_DAGRE_ALIGNMENTS])("keeps single-target dust sources together before %s positioning", async align => {
  const graph = glyphGraphFromMermaid(source);
  const options = { labelWidth: 9, nodesep: 3, margin: 0, [GLYPH_DIAGRAM_DAGRE_ALIGN]: align };
  const layout = await layoutGlyphGraph(graph, options);
  const row = layout.nodes.filter(node => ["P", "G", "E", "V", "R"].includes(node.id)).sort((a, b) => a.x0 - b.x0);
  expect(row.slice(0, 2).map(node => node.id)).toEqual(["P", "G"]);
  expect(new Set(row.slice(2).map(node => node.id))).toEqual(new Set(["E", "V", "R"]));
  const reversed = await layoutGlyphGraph({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, options);
  expect(reversed.nodes.map(node => [node.id, node.x0, node.y0]).sort()).toEqual(layout.nodes.map(node => [node.id, node.x0, node.y0]).sort());
});

it("routes Vergely directly into its dust cluster without enclosing Galaxia", async () => {
  const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
  const result = await renderGlyphDiagram(source, options);
  const vergely = result.layout.nodes.find(node => node.id === "V")!;
  const galaxia = result.layout.nodes.find(node => node.id === "G")!;
  const route = result.routes.find(route => route.edge.from === "V")!;
  if (result.layout.direction === "LR") {
    expect(vergely.y0).toBeGreaterThan(galaxia.y1);
    expect(route.cells.every(cell => cell.x > vergely.x1 && cell.y > galaxia.y1)).toBe(true);
  } else {
    expect(vergely.x0).toBeGreaterThan(galaxia.x1);
    expect(route.cells.every(cell => cell.y > vergely.y1 && cell.x > galaxia.x1)).toBe(true);
  }
  const quality = computeGlyphDiagramQuality(result, options);
  expect(quality.fakeFrames).toBe(0);
  expect(quality.edges.find(edge => edge.edgeId === route.edge.id)!.bends).toBe(2);
});

const sharedFan = `flowchart TB
s0 --> t2
s0 --> t5
s1 --> t0
s1 --> t5
s2 --> t1
s2 --> t2
s2 --> t5
t0 --> u0
t0 --> u1
t1 --> u0
t1 --> u2
t3 --> u1
t5 --> u0
t6 --> u2`;
it.each([72, 120])("keeps the unconstrained shared-fan order at %s columns when constraints add crossings", async width => {
  const options = { target: "chat", width, height: 80, autoDirection: false, detail: "faithful", overflow: "expand" } as const;
  const result = await renderGlyphDiagram(sharedFan, options);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 4, fakeFrames: 1,
    wordCuts: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

it("places independent photo sources beside the target they feed", async () => {
  const source = readFileSync(resolve(__dirname, "../bench/corpus/galaxy-anchors-detailed.mmd"), "utf8");
  const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
  const result = await renderGlyphDiagram(source, options);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0 });
  for (const id of ["nasa", "ngc"]) {
    const route = result.routes.find(route => route.edge.from === id)!;
    const from = result.layout.nodes.find(node => node.id === id)!, to = result.layout.nodes.find(node => node.id === route.edge.to)!;
    expect(Math.max(from.y0, to.y0)).toBeLessThanOrEqual(Math.min(from.y1, to.y1));
    let bends = 0;
    route.cells.forEach((cell, i) => { const prev = route.cells[i - 1], next = route.cells[i + 1];
      if (prev && next && ((cell.x - prev.x) !== (next.x - cell.x) || (cell.y - prev.y) !== (next.y - cell.y))) bends++;
    });
    expect(bends).toBeLessThanOrEqual(2);
  }
});
