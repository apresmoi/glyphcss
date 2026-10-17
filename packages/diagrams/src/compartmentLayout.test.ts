import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { routeGlyphGraphEdges } from "./route";
import { GLYPH_DIAGRAM_EDGE_WAYPOINTS } from "./layoutHints";

const preset = (JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string }[])
  .find(preset => preset.type === "classDiagram")!;
const options = { target: "web", width: 96, height: 32, nodesep: 4, ranksep: 4, autoDirection: true, overflow: "expand" } as const;

it("keeps the default class charge monotone and every relationship legible", async () => {
  const result = await renderGlyphDiagram(preset.source, options);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, wordCuts: 0, pages: 1 });
  const charges = result.routes.find(route => route.edge.label === "charges")!;
  for (let i = 1; i < charges.cells.length; i++) {
    expect(charges.cells[i]!.x).toBeLessThanOrEqual(charges.cells[i - 1]!.x);
    expect(charges.cells[i]!.y).toBeGreaterThanOrEqual(charges.cells[i - 1]!.y);
  }
  const ports = result.layout.ports.filter(port => port.nodeId === "Payment" && port.end === "to");
  expect(new Set(ports.map(port => port.side)).size).toBeGreaterThan(1);
  expect(result.report.ledger.some(entry => /limited|label-dropped|unroutable/.test(entry.code))).toBe(false);
});

it("keeps reserved corridor coordinates on the final compacted routes", async () => {
  const result = await renderGlyphDiagram(preset.source, options);
  const waypoints = result.layout[GLYPH_DIAGRAM_EDGE_WAYPOINTS]!;
  expect(waypoints).toBeDefined();
  for (const route of result.routes) {
    const points = waypoints[route.edge.id]!;
    for (const point of points.filter((_, i) => points.length > 1 && i % 2 === 1)) expect(route.cells).toContainEqual(point);
    for (let i = 1; i < route.cells.length; i++) expect(Math.abs(route.cells[i]!.x - route.cells[i - 1]!.x) + Math.abs(route.cells[i]!.y - route.cells[i - 1]!.y)).toBe(1);
  }
});

it("honours a reserved exterior lane even when a shorter unreserved corridor exists", async () => {
  const result = await renderGlyphDiagram(preset.source, options);
  const audits = result.routes.find(route => route.edge.label === "audits")!;
  const points = result.layout[GLYPH_DIAGRAM_EDGE_WAYPOINTS]![audits.edge.id]!.map(point => ({ ...point, x: point.x - 3 }));
  const routing = routeGlyphGraphEdges({ ...result.layout, [GLYPH_DIAGRAM_EDGE_WAYPOINTS]: {
    ...result.layout[GLYPH_DIAGRAM_EDGE_WAYPOINTS], [audits.edge.id]: points,
  } }, { width: result.canvas.cols, height: result.canvas.rows });
  expect(routing.unroutable).toEqual([]);
  const route = routing.routes.find(route => route.edge.id === audits.edge.id)!;
  for (const point of points.filter((_, i) => i % 2 === 1)) expect(route.cells).toContainEqual(point);
});

it("keeps the same class geometry through the graph adapter and declaration reordering", async () => {
  const { glyphGraphFromMermaid } = await import("./mermaid");
  const graph = glyphGraphFromMermaid(preset.source);
  const source = await renderGlyphDiagram(preset.source, options);
  const reordered = await renderGlyphDiagram({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, options);
  expect(reordered.text).toBe(source.text);
});
