import { afterEach, expect, it, vi } from "vitest";
import { layoutGlyphGraph, type GlyphDiagramLayout } from "./pipeline";

const control = vi.hoisted(() => ({ reject: "" as "" | "crossings" | "fakeFrames" | "labels" | "routing",
  seed: [] as (readonly [string, number])[], attempts: [] as GlyphDiagramLayout[] }));
const shifted = (layout: GlyphDiagramLayout) => control.seed.some(([id, x]) => layout.nodes.find(node => node.id === id)?.x0 !== x);
vi.mock("./routeQuality", async importOriginal => {
  const real = await importOriginal<typeof import("./routeQuality")>();
  return { ...real, glyphDiagramRouteQuality: (...args: Parameters<typeof real.glyphDiagramRouteQuality>) => {
    const quality = real.glyphDiagramRouteQuality(...args);
    return shifted(args[0]) && (control.reject === "crossings" || control.reject === "fakeFrames")
      ? { ...quality, [control.reject]: 100 } : quality;
  } };
});
vi.mock("./graphLabels", async importOriginal => {
  const real = await importOriginal<typeof import("./graphLabels")>();
  return { ...real, glyphDiagramGraphLabels: (...args: Parameters<typeof real.glyphDiagramGraphLabels>) => {
    const labels = real.glyphDiagramGraphLabels(...args);
    return shifted(args[0]) && control.reject === "labels" ? { ...labels, dropped: [...labels.dropped, "edge:injected"] } : labels;
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
import { glyphDiagramStraightenPorts, type GlyphDiagramAttempt } from "./fit";
import { glyphGraphFromMermaid } from "./mermaid";
import { routeGlyphGraphEdges } from "./route";
import { glyphDiagramRouteQuality } from "./routeQuality";

afterEach(() => { control.reject = ""; control.attempts = []; control.seed = []; });

it("straightens small port offsets once, including the moved node's child", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nB --> C[ghi]", { A: [4, 1], B: [5, 12], C: [6, 24] }, 30);
  const result = glyphDiagramStraightenPorts(before, { width: 30, height: 30, margin: 0 });
  expect(result.layout.nodes.map(node => node.x0)).toEqual([4, 4, 4]);
  expect(control.attempts).toHaveLength(2);
  expect(glyphDiagramRouteQuality(result.layout, result.routing.routes)).toMatchObject({ crossings: 0, fakeFrames: 0 });
  expect(result.routing.routes.every(route => new Set(route.cells.map(cell => cell.x)).size === 1)).toBe(true);
});

it.each(["crossings", "fakeFrames", "labels", "routing"] as const)("keeps the fit when alignment adds %s", async reject => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nB --> C[ghi]", { A: [4, 1], B: [5, 12], C: [6, 24] }, 30);
  control.reject = reject;
  expect(glyphDiagramStraightenPorts(before, { width: 30, height: 30, margin: 0 })).toBe(before);
  expect(control.attempts.some(shifted)).toBe(true);
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
  control.seed = nodes.map(node => [node.id, node.x0] as const);
  return { layout, routing, width, height: 30, okay: true, fits: true, adjusted: true };
}

it("rejects an aligned port shift past the left margin before rerouting", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[abcdefg]", { A: [1, 1], B: [0, 12] }, 24);
  expect(glyphDiagramStraightenPorts(before, { width: 24, height: 30, margin: 0 })).toBe(before);
  expect(control.attempts).toHaveLength(0);
});

it("rejects an aligned port shift into another box before rerouting", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nD[jkl]",
    { A: [5, 1], B: [3, 12], D: [11, 12] }, 30);
  expect(glyphDiagramStraightenPorts(before, { width: 30, height: 30, margin: 0 })).toBe(before);
  expect(control.attempts).toHaveLength(0);
});

it("moves the straight outgoing subtree rather than transferring incoming bends", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nB --> C[ghi]",
    { A: [5, 1], B: [4, 12], C: [4, 24] }, 24);
  expect(glyphDiagramRouteQuality(before.layout, before.routing.routes).edges.reduce((sum, edge) => sum + edge.bends, 0)).toBe(2);
  const result = glyphDiagramStraightenPorts(before, { width: 24, height: 30, margin: 0 });
  expect(result.layout.nodes.map(node => node.x0)).toEqual([5, 5, 5]);
  expect(glyphDiagramRouteQuality(result.layout, result.routing.routes).edges.reduce((sum, edge) => sum + edge.bends, 0)).toBe(0);
  expect(control.attempts).toHaveLength(1);
});

it("straightens a large offset by shifting the lower single-input subtree", async () => {
  const before = await placedAttempt("flowchart TB\nA[abc] --> B[def]\nB --> C[ghi]", { A: [2, 1], B: [18, 12], C: [18, 24] }, 36);
  const result = glyphDiagramStraightenPorts(before, { width: 36, height: 30, margin: 0 });
  expect(result.layout.nodes.map(node => node.x0)).toEqual([2, 2, 2]);
  expect(control.attempts).toHaveLength(1);
  expect(result.routing.routes.every(route => new Set(route.cells.map(cell => cell.x)).size === 1)).toBe(true);
  expect(glyphDiagramRouteQuality(result.layout, result.routing.routes)).toMatchObject({ crossings: 0, fakeFrames: 0 });
});
