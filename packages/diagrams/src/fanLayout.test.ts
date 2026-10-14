import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
const fixture = (name: string) => readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
it.each(["telescope-checkout", "telescope-checkout-edge-label", "telescope-package-workspace-node", "telescope-explore-node-labels", "telescope-export-destinations"])("aligns and packs the terminal fan in %s", async name => {
  const result = await renderGlyphDiagram(fixture(name), options);
  const leaves = result.layout.nodes.filter(node => !result.layout.edges.some(edge => edge.from === node.id)).sort((a, b) => a.y0 - b.y0);
  expect(new Set(leaves.map(node => node.x0)).size).toBe(1);
  for (let i = 1; i < leaves.length; i++) expect(leaves[i]!.y0 - leaves[i - 1]!.y1).toBe(2);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, fakeFrames: 0, droppedEdges: 0 });
});
it("keeps a mixed-style source at label height and separates its buses beyond the exit", async () => {
  const result = await renderGlyphDiagram(fixture("telescope-package-workspace-edge"), options);
  expect(result.layout.nodes.find(node => node.id === "pkg")!.height).toBe(3);
  const exits = result.layout.ports.filter(port => port.nodeId === "pkg");
  expect(exits.map(port => port.side)).toEqual(["e", "e", "e"]);
  expect(new Set(exits.map(port => `${port.anchor.x},${port.anchor.y}`)).size).toBe(1);
  expect(new Set(exits.map(port => port.trunk)).size).toBe(2);
  const dotted = result.routes.find(route => route.edge.style === "dotted")!;
  expect(dotted.cells.some(cell => result.canvas.grid.char[cell.y * result.canvas.cols + cell.x] === "╌")).toBe(true);
  expect(result.labels.find(label => label.text === "--workspace")).toBeDefined();
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0 });
});

it("meets a nearby fan-in source column without a one-cell merge jog", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-sources-h60"), { ...options, height: 60 });
  const route = result.routes.find(route => route.edge.from === "B" && route.edge.to === "S")!;
  expect(new Set(route.cells.map(cell => cell.x)).size).toBe(1);
  const ports = result.layout.ports.filter(port => port.edgeId === route.edge.id);
  expect(ports[0]!.anchor.x).toBe(ports[1]!.anchor.x);
  const stars = result.layout.nodes.find(node => node.id === "S")!;
  expect(ports.find(port => port.end === "to")!.anchor.x).toBe(stars.x0 + Math.floor((stars.width - 1) / 2));
  expect(computeGlyphDiagramQuality(result, { width: 72, height: 60 })).toMatchObject({ crossings: 0, fakeFrames: 1, droppedEdges: 0 });
});
