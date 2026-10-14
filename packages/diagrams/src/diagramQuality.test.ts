import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { glyphDiagramCompactGeometry } from "./compact";
import { layoutGlyphGraph, GLYPH_DIAGRAM_DIRECTIONS } from "./pipeline";
import { routeGlyphGraphEdges } from "./route";
import { glyphDiagramFoldTail } from "./fit";
import type { GlyphDiagramRenderOptions } from "./renderTypes";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;

it.each(["telescope-checkout-edge-label", "telescope-explore-decision", "telescope-explore-edge-labels"])("places every whole edge label in %s", async name => {
  const result = await renderGlyphDiagram(fixture(name), options);
  for (const edge of result.meta.edges.filter(edge => edge.label)) {
    expect(result.labels.find(label => label.id === `edge:${edge.id}`)?.text).toBe(edge.label);
  }
  expect(result.report.ledger.filter(entry => ["label-dropped", "label-abbreviated"].includes(entry.code))).toEqual([]);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

it("compacts blank interiors and pass-through rows while retaining labels, bends, ports and arrow stubs", async () => {
  const raw = await layoutGlyphGraph({ direction: "TB", nodes: [{ id: "A", label: "first" }, { id: "B", label: "last" }], edges: [{ id: "edge", from: "A", to: "B" }] }, { ranksep: 12, margin: 0 });
  const nodes = raw.nodes.map((node, i) => ({ ...node, y0: i * 24, y1: i * 24 + 8, height: 9 }));
  const ports = raw.ports.map(port => {
    const node = nodes.find(node => node.id === port.nodeId)!;
    const anchor = { x: node.x0 + port.offset, y: port.side === "n" ? node.y0 : node.y1 };
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    return { ...port, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y } };
  });
  const layout = { ...raw, nodes, ports, width: 20, height: 40 };
  const routing = routeGlyphGraphEdges(layout, { width: 20, height: 40 });
  expect(routing.unroutable).toEqual([]);
  const label = { id: "edge:edge", text: "whole", abbreviated: false, x: 6, y: 17, x0: 6, x1: 10, y0: 17, y1: 17 };
  const compact = glyphDiagramCompactGeometry(layout, routing, [label], { width: 20, height: 40 });
  expect(compact.height).toBeLessThan(20);
  expect(compact.width).toBeLessThan(20);
  expect(compact.layout.nodes.map(node => node.height)).toEqual([3, 3]);
  expect(compact.labels[0]!.text).toBe("whole");
  for (const port of compact.layout.ports) {
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    expect(port.escape).toEqual({ x: port.anchor.x + delta.x, y: port.anchor.y + delta.y });
    expect(compact.routing.routes[0]!.cells).toContainEqual(port.escape);
  }
  const cells = compact.routing.routes[0]!.cells;
  for (let i = 1; i < cells.length; i++) expect(Math.abs(cells[i]!.x - cells[i - 1]!.x) + Math.abs(cells[i]!.y - cells[i - 1]!.y)).toBe(1);
  expect(glyphDiagramCompactGeometry(compact.layout, compact.routing, compact.labels, compact)).toEqual(compact);
});

it.each([["TB", 40, 0], ["BT", 40, 0], ["TB", 24, 17], ["BT", 24, 17]] as const)("folds a %s tail left-to-right at %d columns without crossings", async (direction, width, dx) => {
  const raw = await layoutGlyphGraph({ direction, nodes: ["A", "B", "C"].map(id => ({ id, label: id })),
    edges: [{ id: "ab", from: "A", to: "B" }, { id: "bc", from: "B", to: "C" }] }, { margin: 1, ranksep: 8 });
  const layout = { ...raw, width, nodes: raw.nodes.map(node => ({ ...node, x0: node.x0 + dx, x1: node.x1 + dx })),
    ports: raw.ports.map(port => ({ ...port, anchor: { ...port.anchor, x: port.anchor.x + dx }, escape: { ...port.escape, x: port.escape.x + dx } })) };
  const routing = routeGlyphGraphEdges(layout, { width, height: layout.height });
  const attempt = { layout, routing, fits: true, okay: true, width, height: layout.height, adjusted: false };
  const folded = glyphDiagramFoldTail(attempt, { ...options, width, height: 8 });
  expect(folded).not.toBe(attempt);
  const head = folded.layout.nodes[0]!;
  expect(head.lines).toEqual(layout.nodes[0]!.lines);
  expect(head.y1 - head.y0).toBe(layout.nodes[0]!.y1 - layout.nodes[0]!.y0);
  expect(head.x0).toBe(dx === 0 ? layout.nodes[0]!.x0 : 4);
  for (let i = 1; i < folded.layout.nodes.length; i++) {
    expect(folded.layout.nodes[i]!.x0).toBeGreaterThan(folded.layout.nodes[i - 1]!.x1);
  }
  expect(folded.routing.unroutable).toEqual([]);
  expect(folded.routing.routes.every(route => new Set(route.cells.map(cell => cell.y)).size === 1)).toBe(true);
});

const corpus = JSON.parse(readFileSync(resolve(__dirname, "../bench/manifest.json"), "utf8")).corpus as string[];
it.each(corpus)("keeps corpus fidelity and topology: %s", async file => {
  const name = file.replace(/\.mmd$/, "");
  const sidecar = JSON.parse(readFileSync(resolve(__dirname, `../bench/corpus/${name}.json`), "utf8"));
  const opts = sidecar.renders[0].options as GlyphDiagramRenderOptions & { width: number; height: number };
  const result = await renderGlyphDiagram(fixture(name), opts);
  const quality = computeGlyphDiagramQuality(result, opts);
  expect(quality.wordCuts).toBe(0);
  expect(quality.crossings).toBe(0);
  const frames = name === "galaxy-sources-h60" ? 1 : 0;
  expect(quality.fakeFrames).toBeLessThanOrEqual(frames);
  expect(quality).toMatchObject({ droppedEdges: 0, droppedLabels: 0, pages: 1 });
  if (name === "galaxy-sources-h60") expect(result.canvas.rows).toBeLessThanOrEqual(60);
}, 15_000);

it("leaves one cell between compacted boxes on both axes", async () => {
  const raw = await layoutGlyphGraph({ direction: "TB", nodes: [{ id: "a", label: "a" }, { id: "b", label: "b" }], edges: [] });
  const nodes = raw.nodes.map((node, i) => ({ ...node, x0: i * 8, x1: i * 8 + 4, y0: i * 8, y1: i * 8 + 2 }));
  const compact = glyphDiagramCompactGeometry({ ...raw, nodes, width: 20, height: 20 }, { routes: [], unroutable: [], ledger: [] }, [], { width: 20, height: 20 });
  const [a, b] = compact.layout.nodes;
  expect(b!.x0 - a!.x1).toBe(2);
  expect(b!.y0 - a!.y1).toBe(2);
});

it.each(["LR", "RL", "TB", "BT"] as const)("shares same-style fan ports and paints real junctions in %s", async direction => {
  const graph = { direction, nodes: ["hub", "a", "b", "c", "join"].map(id => ({ id, label: id })),
    edges: ["a", "b", "c"].flatMap(id => [{ id: `out-${id}`, from: "hub", to: id }, { id: `in-${id}`, from: id, to: "join" }]) };
  const result = await renderGlyphDiagram(graph, { width: 72, height: 24, detail: "faithful", autoDirection: false });
  expect(result.pages).toHaveLength(1);
  expect(result.report.unroutable).toEqual([]);
  expect(result.report.ledger.filter(entry => entry.code === "route-conflict")).toEqual([]);
  for (const [id, end] of [["hub", "from"], ["join", "to"]] as const) {
    const ports = result.layout.ports.filter(port => port.nodeId === id && port.end === end);
    expect(ports).toHaveLength(3);
    expect(new Set(ports.map(port => `${port.anchor.x},${port.anchor.y}`)).size).toBe(1);
    expect(new Set(ports.map(port => port.trunk)).size).toBe(1);
    expect(ports[0]!.trunk).toBeDefined();
    if (end === "from") {
      const expected = { n: "┴", e: "├", s: "┬", w: "┤" }[ports[0]!.side];
      expect(result.canvas.grid.char[ports[0]!.anchor.y * result.canvas.cols + ports[0]!.anchor.x]).toBe(expected);
    }
    const node = result.layout.nodes.find(node => node.id === id)!;
    expect(node.height).toBe(node.lines.length + 2);
    const family = result.routes.filter(route => ports.some(port => port.edgeId === route.edge.id));
    const shared = family[0]!.cells.filter(cell => family.every(route => route.cells.some(p => p.x === cell.x && p.y === cell.y)));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  }
  if (direction === "LR" || direction === "RL") {
    const targets = result.layout.nodes.filter(node => ["a", "b", "c"].includes(node.id)).sort((a, b) => a.y0 - b.y0);
    expect(targets[1]!.y0 - targets[0]!.y1).toBe(2);
    expect(targets[2]!.y0 - targets[1]!.y1).toBe(2);
  }
  expect(result.text).toMatch(/[├┤┬┴┼]/);
  expect(computeGlyphDiagramQuality(result, { width: 72, height: 24 })).toMatchObject({ crossings: 0, maxArrowheadsOnSide: 1, droppedEdges: 0, droppedLabels: 0 });
});

it("keeps different fan styles on separate ports and preserves dotted branches", async () => {
  const result = await renderGlyphDiagram("flowchart LR\n hub --> a\n hub --> b\n hub -.-> c\n hub -.-> d", { width: 72, height: 32, detail: "faithful" });
  const ports = result.layout.ports.filter(port => port.nodeId === "hub");
  const solid = ports.filter(port => result.routes.find(route => route.edge.id === port.edgeId)!.edge.style === "solid");
  const dotted = ports.filter(port => result.routes.find(route => route.edge.id === port.edgeId)!.edge.style === "dotted");
  expect(solid[0]!.anchor).toEqual(solid[1]!.anchor);
  expect(dotted[0]!.anchor).toEqual(dotted[1]!.anchor);
  expect(solid[0]!.anchor).not.toEqual(dotted[0]!.anchor);
  expect(solid[0]!.trunk).not.toBe(dotted[0]!.trunk);
  expect(result.text).toMatch(/[╌╎]/);
  expect(result.report.unroutable).toEqual([]);
  expect(result.routes).toHaveLength(4);
});

it.each(["box", "ascii"] as const)("keeps every fan label on its exclusive branch in %s", async charset => {
  const result = await renderGlyphDiagram(fixture("telescope-explore-edge-labels"), { ...options, charset });
  for (const route of result.routes) {
    const label = result.labels.find(label => label.id === `edge:${route.edge.id}`)!;
    expect(label.text).toBe(route.edge.label);
    const exclusive = route.cells.filter(cell => result.routes.every(other => other === route || !other.cells.some(p => p.x === cell.x && p.y === cell.y)));
    expect(exclusive.some(cell => Math.max(label.x0 - cell.x, 0, cell.x - label.x1) + Math.abs(label.y - cell.y) === 1)).toBe(true);
  }
  if (charset === "ascii") expect(result.text).toContain("+");
});
