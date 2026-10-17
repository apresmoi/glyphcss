import { expect, it } from "vitest";
import { GLYPH_CANVAS_TIERS } from "glyphcss";
import { renderGlyphDiagram } from "./render";
import { paintGlyphDiagram } from "./paint";
import { computeGlyphDiagramQuality } from "./quality";
import { glyphGraphFromMermaid } from "./mermaid";
import { measureGlyphGraph } from "./pipeline";
import { glyphDiagramSnakeLayout } from "./snake";
import { routeGlyphGraphEdges } from "./route";

const options = { width: 72, height: 24, target: "chat", charset: "box", detail: "faithful", autoDirection: true, overflow: "expand" } as const;

it.each(["o--o", "---"])("paints the single-cell %s connector below a snake node", async (connector) => {
  const graph = glyphGraphFromMermaid(`flowchart LR\nsrc-->lint-->test-->build-->art-->deploy\nci[CI runner] ${connector} build`);
  const layout = glyphDiagramSnakeLayout(measureGlyphGraph(graph), { width: 72, gap: 4, margin: 1, branchGap: 1, rowGap: 3 })!;
  const routing = routeGlyphGraphEdges(layout, { width: 72, height: 24 });
  const result = paintGlyphDiagram(layout, routing, options);
  const route = result.routes.find((route) => route.edge.from === "ci")!;
  expect(route.cells).toHaveLength(1);
  expect(routing.unroutable).toEqual([]);
  const cell = route.cells[0]!;
  expect(result.canvas.grid.char[cell.y * result.canvas.cols + cell.x]).toBe(GLYPH_CANVAS_TIERS.box.straight.v);
});

it.each(["n", "e", "s", "w"] as const)("paints an isolated connector on its %s port axis", (side) => {
  const edge = { id: "edge", from: "a", to: "b", style: "undirected" as const };
  const cell = { x: 3, y: 3 };
  const port = { edgeId: edge.id, nodeId: "a", end: "from" as const, side, offset: 1, anchor: cell, escape: cell };
  const layout = { nodes: [], edges: [edge], ports: [port], groups: [], loops: [], direction: "TB" as const, width: 7, height: 7, ledger: [] };
  const result = paintGlyphDiagram(layout, { routes: [{ edge, cells: [cell] }], unroutable: [], ledger: [] }, { width: 7, height: 7 });
  expect(result.canvas.grid.char[24]).toBe(GLYPH_CANVAS_TIERS.box.straight[side === "n" || side === "s" ? "v" : "h"]);
});

it.each([
  ["state", "stateDiagram-v2\n[*] --> Draft\nDraft --> Review : submit\nReview --> Draft : changes\nReview --> Published : approve\nPublished --> [*]", "changes"],
  ["flow", "flowchart TB\nA-->B-->C\nC-->|retry| A", "retry"],
])("%s back edge uses transverse ports and stays beside its endpoints", async (_, source, label) => {
  const result = await renderGlyphDiagram(source!, options);
  const route = result.routes.find((route) => route.edge.label === label)!;
  const ports = result.layout.ports.filter((port) => port.edgeId === route.edge.id);
  const vertical = result.layout.direction === "TB" || result.layout.direction === "BT";
  expect(ports[0]!.side).toBe(ports[1]!.side);
  expect(vertical ? ["e", "w"] : ["n", "s"]).toContain(ports[0]!.side);
  const endpoints = result.layout.nodes.filter((node) => node.id === route.edge.from || node.id === route.edge.to);
  const lo = Math.min(...endpoints.map((node) => vertical ? node.y0 : node.x0));
  const hi = Math.max(...endpoints.map((node) => vertical ? node.y1 : node.x1));
  for (const cell of route.cells) expect(vertical ? cell.y : cell.x).toBeGreaterThanOrEqual(lo);
  for (const cell of route.cells) expect(vertical ? cell.y : cell.x).toBeLessThanOrEqual(hi);
  const quality = computeGlyphDiagramQuality(result, options);
  expect(quality.edges.find((edge) => edge.edgeId === route.edge.id)!.detourRatio).toBeLessThanOrEqual(1.5);
  expect(quality.wordCuts).toBe(0);
  expect(quality.crossings).toBe(0);
  expect(quality.droppedEdges).toBe(0);
  expect(quality.droppedLabels).toBe(0);
  const placed = result.labels.find((placed) => placed.id === `edge:${route.edge.id}`)!;
  expect(placed).toBeDefined();
  expect(placed.y0).toBeGreaterThanOrEqual(lo);
  expect(placed.y1).toBeLessThanOrEqual(hi);
});

it.each(["TB", "BT", "LR", "RL"] as const)("reserves transverse back-edge capacity in %s without borrowing self-loop slots", async (direction) => {
  const result = await renderGlyphDiagram(`flowchart ${direction}\nA-->B\nB-->|retry| A\nB-->B`, { ...options, autoDirection: false });
  const back = result.routes.find((route) => route.edge.label === "retry")!;
  const loop = result.routes.find((route) => route.edge.from === route.edge.to)!;
  const port = result.layout.ports.find((port) => port.edgeId === back.edge.id && port.end === "from")!;
  const loopPort = result.layout.ports.find((port) => port.edgeId === loop.edge.id && port.end === "from")!;
  expect(direction === "TB" || direction === "BT" ? ["e", "w"] : ["n", "s"]).toContain(port.side);
  expect(port.side).not.toBe(loopPort.side);
  const occupied = new Set(back.cells.map((cell) => `${cell.x},${cell.y}`));
  expect(loop.cells.some((cell) => occupied.has(`${cell.x},${cell.y}`))).toBe(false);
  expect(result.report.unroutable).toEqual([]);
});
