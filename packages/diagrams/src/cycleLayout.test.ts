import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
vi.mock("./pipeline", async importOriginal => {
  const real = await importOriginal<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn(real.layoutGlyphGraph) };
});
import { backEdgeIds, measureGlyphGraph, layoutGlyphGraph } from "./pipeline";
import { glyphDiagramCycleLayout } from "./cycleLayout";
import { glyphGraphFromMermaid } from "./mermaid";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
it.each(["galaxy-score-loop", "galaxy-fit-loop-detailed"])("keeps %s's main path in reading order with one outer return", async name => {
  const result = await renderGlyphDiagram(fixture(name), options);
  const back = backEdgeIds(result.layout.nodes, result.layout.edges);
  expect(back.size).toBe(1);
  const returning = result.routes.find(route => back.has(route.edge.id))!;
  const from = result.layout.ports.find(port => port.edgeId === returning.edge.id && port.end === "from")!;
  const to = result.layout.ports.find(port => port.edgeId === returning.edge.id && port.end === "to")!;
  expect([from.side, to.side]).toEqual(["n", "n"]);
  const top = Math.min(...result.layout.nodes.map(node => node.y0));
  expect(Math.min(...returning.cells.map(cell => cell.y))).toBeLessThan(top);
  // All horizontal cells of the return lie above every box.
  returning.cells.forEach((cell, i) => {
    if (returning.cells[i + 1]?.y === cell.y) expect(cell.y).toBeLessThan(top);
  });
  expect(result.canvas.cols).toBe(72);
  expect(result.text).not.toContain("╎");
  expect(result.report.unroutable).toEqual([]);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 0, crossings: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
  if (name === "galaxy-fit-loop-detailed") {
    expect(computeGlyphDiagramQuality(result, options).fakeFrames).toBe(0);
    const search = result.layout.nodes.find(node => node.id === "search")!, knobs = result.layout.nodes.find(node => node.id === "knobs")!;
    expect(knobs.x0).toBeGreaterThan(search.x1);
    expect(knobs.height).toBe(3);
    expect(new Set(result.routes.find(route => route.edge.from === "search")!.cells.map(cell => cell.y)).size).toBe(1);
  }
});
it("declines a second cycle, groups, and an insufficient width", () => {
  const graph = measureGlyphGraph(glyphGraphFromMermaid("flowchart LR\nA --> B\nB --> C\nC --> A\nB --> A"));
  expect(glyphDiagramCycleLayout(graph, { width: 72, gap: 3, margin: 1 })).toBeUndefined();
  const eligible = measureGlyphGraph(glyphGraphFromMermaid(fixture("galaxy-fit-loop-detailed")));
  expect(glyphDiagramCycleLayout(eligible, { width: 200, gap: 3, margin: 1 })).toBeDefined();
  expect(glyphDiagramCycleLayout({ ...eligible, groups: [{ id: "frame", members: ["sky", "nasa"] }] }, { width: 200, gap: 3, margin: 1 })).toBeUndefined();
  expect(glyphDiagramCycleLayout(eligible, { width: 8, gap: 3, margin: 1 })).toBeUndefined();
});

it("preserves an explicit cycle label cap", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-fit-loop-detailed"), { ...options, labelWidth: 3 });
  expect(result.layout.nodes.flatMap(node => node.lines).every(line => line.length <= 3)).toBe(true);
});
it.each([
  [{ engine: "elk" }, "GLYPH_DIAGRAM_ELK_NOT_INSTALLED"],
  [{ engine: "unknown" }, "bad-options"],
  [{ ranksep: 0 }, "bad-options"],
  [{ ranksep: 3.5 }, "bad-options"],
  [{ margin: -1 }, "bad-options"],
  [{ margin: NaN }, "bad-options"],
  [{ nodesep: 1 }, "bad-options"],
] as const)("validates cycle options %j before choosing geometry", async (invalid, code) => {
  await expect(renderGlyphDiagram(fixture("galaxy-fit-loop-detailed"), { ...options, ...invalid } as typeof options))
    .rejects.toMatchObject({ code });
});

it("accepts the completed score cycle before repeating ordinary wrapping", async () => {
  vi.mocked(layoutGlyphGraph).mockClear();
  const result = await renderGlyphDiagram(fixture("galaxy-score-loop"), options);
  expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThanOrEqual(1);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, fakeFrames: 0, droppedEdges: 0 });
  expect(result.layout.nodes.find(node => node.id === "I")!.lines).toEqual(["Sky from", "Sun"]);
  expect(result.layout.nodes.find(node => node.id === "F")!.lines).toEqual(["Face-on"]);
  expect(result.layout.nodes.find(node => node.id === "S")!.lines).toEqual(["Edge-on"]);
});
it("stacks side siblings by spine column and merges into the bottom centre without stair steps", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-score-loop"), options);
  const quality = computeGlyphDiagramQuality(result, options);
  expect(quality).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
  expect(quality.bends.max).toBeLessThanOrEqual(2);
  const node = (id: string) => result.layout.nodes.find(node => node.id === id)!;
  const centre = (id: string) => node(id).x0 + Math.floor((node(id).width - 1) / 2);
  const bend = (from: string, to: string) => quality.edges.find(edge => edge.edgeId === result.routes.find(route => route.edge.from === from && route.edge.to === to)!.edge.id)!.bends;
  expect(centre("S")).toBe(centre("K"));
  expect(node("F").x0).toBe(node("I").x0);
  expect(centre("Q")).toBe(centre("N"));
  expect(centre("A")).toBe(centre("N"));
  expect(node("A").y0).toBeGreaterThan(node("Q").y1);
  expect(bend("K", "S")).toBe(0);
  expect(bend("K", "F")).toBe(2);
  expect(bend("I", "Q")).toBe(1);
  expect(bend("F", "A")).toBe(1);
  for (const from of ["A", "Q"]) {
    const edge = result.layout.edges.find(edge => edge.from === from && edge.to === "L")!;
    const port = result.layout.ports.find(port => port.edgeId === edge.id && port.end === "to")!;
    expect(port.side).toBe("s");
    expect(port.anchor.x).toBe(centre("L"));
    expect(bend(from, "L")).toBe(1);
  }
  const joins = result.routes.filter(route => ["A", "Q"].includes(route.edge.from) && route.edge.to === "L");
  const shared = joins[0]!.cells.filter(cell => joins[1]!.cells.some(other => cell.x === other.x && cell.y === other.y));
  expect(shared.length).toBeGreaterThan(1);
  expect(new Set(shared.map(cell => cell.x))).toEqual(new Set([centre("L")]));
  expect(result.text.trim().split("\n")).toHaveLength(18);
  for (const [from, to] of [["K", "I"], ["I", "N"], ["N", "L"], ["L", "O"], ["O", "B"]]) expect(bend(from!, to!)).toBe(0);
});
it("keeps a corridor's rewrapped label within an explicit cap", async () => {
  const measured = measureGlyphGraph(glyphGraphFromMermaid(fixture("galaxy-score-loop")), { labelWidth: 7 });
  const layout = glyphDiagramCycleLayout(measured, { width: 80, gap: 3, margin: 1, labelWidth: 7 })!;
  expect(layout.nodes.find(node => node.id === "I")!.lines).toEqual(["Sky", "from", "Sun"]);
  expect(layout.nodes.flatMap(node => node.lines).every(line => line.length <= 7)).toBe(true);
  const result = await renderGlyphDiagram(fixture("galaxy-score-loop"), { ...options, labelWidth: 7 });
  expect(result.layout.nodes.flatMap(node => node.lines).every(line => line.length <= 7)).toBe(true);
});
it("keeps unequal-height side nodes straight when they share a row", () => {
  const graph = measureGlyphGraph(glyphGraphFromMermaid("flowchart LR\nA --> B\nB --> C\nC --> D\nD --> E\nE --> A\nA --> r[R]\nr --> t[Tall<br/>side<br/>node]\nt --> D\nA --> q[Other]\nq --> D"));
  const layout = glyphDiagramCycleLayout(graph, { width: 100, gap: 3, margin: 1 })!;
  const edge = layout.edges.find(edge => edge.from === "r" && edge.to === "t")!;
  const ports = layout.ports.filter(port => port.edgeId === edge.id);
  expect(ports.map(port => port.side)).toEqual(["e", "w"]);
  expect(ports[0]!.anchor.y).toBe(ports[1]!.anchor.y);
});
it("uses a lateral single side-path join and spends freed columns on cycle labels", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-fit-loop-detailed"), options);
  expect(result.layout.nodes.find(node => node.id === "face")!.lines).toEqual(["Face-on"]);
  expect(result.layout.nodes.find(node => node.id === "sky")!.lines).toEqual(["Sky from", "Sun"]);
  expect(result.layout.nodes.find(node => node.id === "nasa")!.lines).toEqual(["vs NASA", "sky"]);
  const join = result.routes.find(route => route.edge.from === "ngc")!;
  const quality = computeGlyphDiagramQuality(result, options);
  expect(quality.edges.find(edge => edge.edgeId === join.edge.id)!.bends).toBe(1);
  expect(result.layout.ports.find(port => port.edgeId === join.edge.id && port.end === "from")!.side).toBe("e");
});
it("keeps an authored vertical cycle when autoDirection is disabled", async () => {
  const result = await renderGlyphDiagram(fixture("galaxy-fit-loop-detailed").replace("flowchart LR", "flowchart TB"), { ...options, autoDirection: false });
  expect(result.layout.direction).toBe("TB");
});
