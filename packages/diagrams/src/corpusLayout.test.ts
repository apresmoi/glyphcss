import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const options = { target: "chat", width: 72, height: 24, overflow: "expand", autoDirection: true, detail: "faithful" } as const;
const fixture = (name: string) => readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
const visibleHeight = (text: string) => text.trimEnd().split("\n").filter((line, i, lines) => line.trim() || lines.slice(0, i).some(row => row.trim())).length;

it.each(["TB", "BT", "LR", "RL"] as const)("keeps the three-edge mixed fan disconnected in %s", async direction => {
  const graph = { direction, nodes: ["Papers", "Galaxia", "Stars", "Colors"].map(id => ({ id, label: id })),
    edges: [{ id: "ps", from: "Papers", to: "Stars" }, { id: "gs", from: "Galaxia", to: "Stars" }, { id: "gc", from: "Galaxia", to: "Colors" }] };
  const result = await renderGlyphDiagram(graph, { ...options, autoDirection: false });
  expect(result.routes).toHaveLength(3);
  expect(result.report.unroutable).toEqual([]);
  const paper = result.routes.find(route => route.edge.id === "ps")!;
  const color = result.routes.find(route => route.edge.id === "gc")!;
  expect(paper.cells.some(cell => color.cells.some(p => p.x === cell.x && p.y === cell.y))).toBe(false);
  // No shared route may connect a source bus to a target bus.
  for (const edge of result.layout.edges) expect(result.layout.ports.filter(port => port.edgeId === edge.id && port.trunk).length).toBeLessThanOrEqual(1);
  expect(result.layout.ports.filter(port => port.nodeId === "Galaxia" && port.end === "from").map(port => port.trunk)).toEqual([undefined, undefined]);
});

it.each(["TB", "BT"] as const)("reserves room beside a %s route for a whole long label", async direction => {
  const label = "abcdefghijklmnopqrstuvwxyz1234";
  const result = await renderGlyphDiagram(`flowchart ${direction}\nA -->|${label}| B`, { ...options, width: 40, height: 16, autoDirection: false });
  expect(result.canvas.cols).toBe(40);
  expect(result.labels.find(item => item.id.startsWith("edge:"))?.text).toBe(label);
  expect(result.report.ledger.filter(entry => ["label-dropped", "label-abbreviated"].includes(entry.code))).toEqual([]);
});

it("keeps build-detailed in its shorter authored orientation", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-build-detailed"), options);
  expect(result.layout.direction).toBe("TB");
  expect(visibleHeight(result.text)).toBeLessThanOrEqual(28);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, fakeFrames: 0, droppedEdges: 0 });
});

it("folds the h60 tail within an existing canvas and keeps its chain links straight", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-sources-h60"), { ...options, height: 60 });
  expect(result.canvas.rows).toBe(60);
  expect(visibleHeight(result.text)).toBeLessThanOrEqual(38);
  for (const from of ["G", "L", "K"]) {
    const route = result.routes.find(route => route.edge.from === from)!;
    expect(new Set(route.cells.map(cell => cell.y)).size).toBe(1);
  }
  expect(computeGlyphDiagramQuality(result, { width: 72, height: 60 }).crossings).toBe(0);
  expect(result.text).not.toContain("╎");
  const chain = ["G", "L", "K", "X"].map(id => result.layout.nodes.find(node => node.id === id)!);
  for (let i = 1; i < chain.length; i++) expect(chain[i]!.x0).toBeGreaterThan(chain[i - 1]!.x1);
});

it("paints continuous dashed workspace strokes through short runs", async () => {
  const result = await renderGlyphDiagram(fixture("telescope-package-workspace-edge"), options);
  const route = result.routes.find(route => route.edge.style === "dotted")!;
  let strokes = 0;
  for (let i = 0; i < route.cells.length; i++) {
    const cell = route.cells[i]!, prev = route.cells[i - 1], next = route.cells[i + 1];
    const vertical = prev && next ? prev.x === next.x : (prev ?? next)!.x === cell.x;
    const horizontal = prev && next ? prev.y === next.y : !vertical;
    if (!vertical && !horizontal) continue;
    const shared = result.routes.some(other => other !== route && other.cells.some(p => p.x === cell.x && p.y === cell.y));
    expect(result.canvas.grid.char[cell.y * result.canvas.cols + cell.x]).toBe(shared ? "─" : vertical ? "╎" : "╌");
    strokes++;
  }
  expect(strokes).toBeGreaterThan(0);
});

it.each(["telescope-explore-edge-labels", "telescope-explore-decision"])("clears parallel route stems by one cell in %s", async name => {
  const result = await renderGlyphDiagram(fixture(name), options);
  expect(result.labels.filter(label => label.id.startsWith("edge:"))).toHaveLength(result.meta.edges.filter(edge => edge.label).length);
  for (const label of result.labels.filter(label => label.id.startsWith("edge:"))) for (const route of result.routes) {
    route.cells.forEach((cell, i) => {
      const prev = route.cells[i - 1], next = route.cells[i + 1];
      const vertical = prev?.x === cell.x || next?.x === cell.x;
      if (vertical && cell.y === label.y) expect(Math.max(label.x0 - cell.x, cell.x - label.x1)).toBeGreaterThanOrEqual(2);
    });
  }
});

it("reserves missing return-label rows without widening the 28-column budget", async () => {
  const result = await renderGlyphDiagram("flowchart TB\n A{Valid?} -->|yes| B[Save]\n A -->|no| C[Reject]\n B -->|retry later| A", { ...options, width: 28, height: 12 });
  expect(result.canvas.cols).toBe(28);
  expect(result.labels.map(label => label.text).sort()).toEqual(["no", "retry later", "yes"]);
  expect(result.report.ledger.filter(entry => entry.code === "label-dropped")).toEqual([]);
});

it("straightens Search to Knobs across the available rank space", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-fit-loop-vertical"), options);
  const route = result.routes.find(route => route.edge.from === "search" && route.edge.to === "knobs")!;
  expect(new Set(route.cells.map(cell => cell.x)).size).toBe(1);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0 });
});

it("straightens every forward five-step-loop link within 72 columns", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-five-step-loop"), options);
  const quality = computeGlyphDiagramQuality(result, options);
  expect(result.canvas.cols).toBe(72);
  expect(quality).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
  expect(quality.bends.total).toBeLessThanOrEqual(2);
  for (const [from, to] of [["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]]) {
    const route = result.routes.find(route => route.edge.from === from && route.edge.to === to)!;
    expect(new Set(route.cells.map(cell => cell.y)).size).toBe(1);
  }
  expect(result.layout.nodes.map(node => node.label)).toEqual([
    "1 Papers + dust maps", "2 Build 3D galaxy", "3 Take 3 photos", "4 Compare to real ones", "5 Score",
  ]);
  expect(result.labels.map(label => label.text)).toContain("adjust knobs");
});
