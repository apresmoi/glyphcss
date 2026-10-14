import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { layoutGlyphGraph, type GlyphDiagramLayout } from "./pipeline";

const control = vi.hoisted(() => ({ reject: "" as "" | "crossings" | "fakeFrames" | "labels" | "routing",
  attempts: [] as GlyphDiagramLayout[] }));
// The first folded fit has S=1, C=16, M=15. These are alignment probes only.
const shifted = (layout: GlyphDiagramLayout) => layout.nodes.find(node => node.id === "P")?.x0 === 0
  && layout.ports.some(port => port.nodeId === "X" && port.end === "from" && port.side === "e")
  && layout.nodes.some(node => node.id === "S" && node.x0 !== 1 || node.id === "C" && node.x0 !== 16
    || node.id === "M" && node.x0 !== 15);
vi.mock("./routeQuality", async importOriginal => {
  const real = await importOriginal<typeof import("./routeQuality")>();
  return { ...real, glyphDiagramRouteQuality: (...args: Parameters<typeof real.glyphDiagramRouteQuality>) => {
    const quality = real.glyphDiagramRouteQuality(...args);
    return shifted(args[0]) && (control.reject === "crossings" || control.reject === "fakeFrames")
      ? { ...quality, [control.reject]: 100 } : quality;
  } };
});
vi.mock("./paint", async importOriginal => {
  const real = await importOriginal<typeof import("./paint")>();
  return { ...real, paintGlyphDiagram: (...args: Parameters<typeof real.paintGlyphDiagram>) => {
    const painted = real.paintGlyphDiagram(...args);
    return shifted(args[0]) && control.reject === "labels" ? { ...painted,
      ledger: [...painted.ledger, { code: "label-dropped", message: "Injected alignment label loss." }] } : painted;
  } };
});
vi.mock("./route", async importOriginal => {
  const real = await importOriginal<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: (...args: Parameters<typeof real.routeGlyphGraphEdges>) => {
    control.attempts.push(args[0]);
    const routing = real.routeGlyphGraphEdges(...args);
    return shifted(args[0]) && control.reject === "routing"
      ? { ...routing, unroutable: [args[0].edges[0]!.id] } : routing;
  } };
});
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { glyphDiagramStraightenPorts, type GlyphDiagramAttempt } from "./fit";
import { glyphGraphFromMermaid } from "./mermaid";
import { routeGlyphGraphEdges } from "./route";
import { glyphDiagramRouteQuality } from "./routeQuality";

const source = readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8");
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
afterEach(() => { control.reject = ""; control.attempts = []; });

it("straightens small port offsets in top-down order once, including the moved node's child", async () => {
  const result = await renderGlyphDiagram(source, options);
  const quality = computeGlyphDiagramQuality(result, options);
  expect(quality).toMatchObject({ bends: { total: 10, max: 2 }, crossings: 0, fakeFrames: 0,
    wordCuts: 1, droppedEdges: 0, droppedLabels: 0, pages: 1 });
  expect(result.canvas.rows).toBe(32);
  const probes = control.attempts.filter(shifted);
  expect(probes).toHaveLength(3);
  expect(probes.map(layout => ["S", "C", "M"].map(id => layout.nodes.find(node => node.id === id)!.x0)))
    .toEqual([[1, 17, 15], [2, 17, 15], [2, 17, 17]]);
  for (const [from, to, bends] of [["P", "S", 0], ["G", "S", 2], ["G", "C", 0], ["S", "M", 2], ["C", "M", 0], ["D", "M", 2]] as const) {
    const route = result.routes.find(route => route.edge.from === from && route.edge.to === to)!;
    expect(quality.edges.find(edge => edge.edgeId === route.edge.id)!.bends).toBe(bends);
  }
  expect((await renderGlyphDiagram(source, options)).text).toBe(result.text);
});

it.each(["crossings", "fakeFrames", "labels", "routing"] as const)("keeps the folded fit when alignment adds %s", async reject => {
  control.reject = reject;
  const result = await renderGlyphDiagram(source, options);
  expect(control.attempts.some(shifted)).toBe(true);
  expect(shifted(result.layout)).toBe(false);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ bends: { total: 20 }, crossings: 0,
    fakeFrames: 0, droppedEdges: 0, droppedLabels: 0 });
  expect(result.canvas.rows).toBe(32);
});

// Real measured boxes/ports and routing; explicit positions isolate each guard
// without relying on Dagre choosing that placement in a larger fixture.
async function placedAttempt(source: string, positions: Record<string, readonly [number, number]>, width: number): Promise<GlyphDiagramAttempt> {
  const raw = await layoutGlyphGraph(glyphGraphFromMermaid(source), { margin: 0 });
  const nodes = raw.nodes.map(node => { const [x, y] = positions[node.id]!;
    return { ...node, x0: x, x1: x + node.width - 1, y0: y, y1: y + node.height - 1 }; });
  const ports = raw.ports.map(port => {
    const before = raw.nodes.find(node => node.id === port.nodeId)!, after = nodes.find(node => node.id === port.nodeId)!;
    const dx = after.x0 - before.x0, dy = after.y0 - before.y0;
    return { ...port, anchor: { x: port.anchor.x + dx, y: port.anchor.y + dy }, escape: { x: port.escape.x + dx, y: port.escape.y + dy } };
  });
  const layout = { ...raw, nodes, ports, width, height: 30 };
  const routing = routeGlyphGraphEdges(layout, { width, height: 30 });
  expect(routing.unroutable).toEqual([]);
  control.attempts = [];
  return { layout, routing, width, height: 30, okay: true, fits: true, adjusted: true };
}

it("rejects an aligned port shift past the left margin before rerouting", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[abcdefg]", { A: [1, 1], B: [0, 12] }, 24);
  expect(glyphDiagramStraightenPorts(before, { width: 24, height: 30, margin: 0 })).toBe(before);
  expect(control.attempts).toHaveLength(0);
});

it("rejects an aligned port shift into another box before rerouting", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nC[ghi] --> D[jkl]",
    { A: [5, 1], B: [3, 12], C: [20, 1], D: [11, 12] }, 30);
  expect(glyphDiagramStraightenPorts(before, { width: 30, height: 30, margin: 0 })).toBe(before);
  expect(control.attempts).toHaveLength(0);
});

it("rejects a straight incoming edge when it only transfers its bends to the outgoing edge", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nB --> C[ghi]",
    { A: [5, 1], B: [4, 12], C: [4, 24] }, 24);
  expect(glyphDiagramRouteQuality(before.layout, before.routing.routes).edges.reduce((sum, edge) => sum + edge.bends, 0)).toBe(2);
  expect(glyphDiagramStraightenPorts(before, { width: 24, height: 30, margin: 0 })).toBe(before);
  expect(control.attempts).toHaveLength(1);
});
