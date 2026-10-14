import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { GlyphDiagramLayout } from "./pipeline";

const control = vi.hoisted(() => ({ reject: "" as "" | "crossings" | "fakeFrames" | "labels", probes: 0,
  lastHeight: Infinity, attempts: [] as { layout: GlyphDiagramLayout; unroutable: readonly string[] }[], labels: [] as (readonly [string, readonly string[]])[][] }));
const folded = (layout: GlyphDiagramLayout) => (layout.direction === "TB" || layout.direction === "BT")
  && layout.ports.some(port => port.nodeId === "X" && port.end === "from" && port.side === "e");
vi.mock("./routeQuality", async importOriginal => {
  const real = await importOriginal<typeof import("./routeQuality")>();
  return { ...real, glyphDiagramRouteQuality: (...args: Parameters<typeof real.glyphDiagramRouteQuality>) => {
    const quality = real.glyphDiagramRouteQuality(...args);
    if (folded(args[0]) && (control.reject === "crossings" || control.reject === "fakeFrames")) {
      return { ...quality, [control.reject]: 100 };
    }
    return quality;
  } };
});
vi.mock("./graphLabels", async importOriginal => {
  const real = await importOriginal<typeof import("./graphLabels")>();
  return { ...real, glyphDiagramGraphLabels: (...args: Parameters<typeof real.glyphDiagramGraphLabels>) => {
    const labels = real.glyphDiagramGraphLabels(...args);
    return folded(args[0]) && control.reject === "labels" ? { ...labels, dropped: [...labels.dropped, "edge:injected"] } : labels;
  } };
});
vi.mock("./route", async importOriginal => {
  const real = await importOriginal<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: (...args: Parameters<typeof real.routeGlyphGraphEdges>) => {
    if (folded(args[0]) && args[0].height < control.lastHeight) control.probes++;
    control.lastHeight = args[0].height;
    control.labels.push(args[0].nodes.map(node => [node.id, node.lines] as const));
    const result = real.routeGlyphGraphEdges(...args);
    control.attempts.push({ layout: args[0], unroutable: result.unroutable });
    return result;
  } };
});
import { renderGlyphDiagram } from "./render";
import { layoutGlyphGraph } from "./pipeline";
import { routeGlyphGraphEdges } from "./route";
import { glyphDiagramFoldTail } from "./fit";
import { computeGlyphDiagramQuality } from "./quality";

const source = readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8");
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
afterEach(() => { control.reject = ""; control.probes = 0; control.labels = []; control.lastHeight = Infinity; control.attempts = []; });

async function trailingAttempt(direction: "TB" | "BT" = "TB") {
  const raw = await layoutGlyphGraph({ direction, nodes: ["M", "X", "K"].map(id => ({ id, label: id })),
    edges: [{ id: "mx", from: "M", to: "X" }, { id: "xk", from: "X", to: "K" }] }, { ranksep: 8, margin: 1 });
  const layout = { ...raw, width: 72 };
  const routing = routeGlyphGraphEdges(layout, { width: 72, height: layout.height });
  control.probes = 0; control.labels = []; control.lastHeight = layout.height; control.attempts = [];
  return { layout, routing, width: 72, height: layout.height, okay: true, fits: true, adjusted: false };
}

it.each(["TB", "BT"] as const)("folds one %s trailing chain without changing its labels or losing edges", async direction => {
  const before = await trailingAttempt(direction);
  const result = glyphDiagramFoldTail(before, { ...options, height: 10 });
  expect(result).not.toBe(before);
  expect(result.height).toBe(10);
  expect(control.probes).toBe(1);
  expect(result.layout.nodes.map(node => node.lines)).toEqual(before.layout.nodes.map(node => node.lines));
  expect(result.routing.unroutable).toEqual([]);
  expect(result.routing.routes.every(route => new Set(route.cells.map(cell => cell.y)).size === 1)).toBe(true);
  expect(result.layout.nodes[0]!.x0).toBe(before.layout.nodes[0]!.x0);
});

it.each(["crossings", "fakeFrames", "labels"] as const)("rejects the single folded option when it adds %s", async reject => {
  const before = await trailingAttempt();
  control.reject = reject;
  expect(glyphDiagramFoldTail(before, { ...options, height: 10 })).toBe(before);
  expect(control.probes).toBe(1);
});

it("folds a trailing chain even inside a roomy canvas", async () => {
  const result = await renderGlyphDiagram(source, { ...options, height: 80 });
  expect(control.probes).toBeGreaterThan(0);
  expect(folded(result.layout)).toBe(true);
});

it("saves occupied rows while keeping the requested canvas height", async () => {
  const result = await renderGlyphDiagram("flowchart TB\nM[Start] --> X[Middle]\nX --> K[End]", { ...options, height: 80 });
  expect(result.canvas.rows).toBe(80);
  expect(folded(result.layout)).toBe(true);
  expect(control.probes).toBeGreaterThan(0);
});

it("centers a folded chain when it fits inside the original height budget", async () => {
  const result = await renderGlyphDiagram("flowchart TB\nM[Start] --> X[Middle]\nX --> K[End]", { ...options, height: 12, autoDirection: false });
  expect(result.canvas.rows).toBe(12);
  expect(result.layout.nodes.map(node => node.y0)).toEqual([4, 4, 4]);
  expect(control.probes).toBe(1);
  expect(computeGlyphDiagramQuality(result, { width: 72, height: 12 })).toMatchObject({ wordCuts: 0, crossings: 0,
    fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});

const overlaps = (layout: GlyphDiagramLayout) => layout.nodes.some((node, i) => layout.nodes.slice(i + 1).some(other =>
  node.x0 <= other.x1 && node.x1 >= other.x0 && node.y0 <= other.y1 && node.y1 >= other.y0));
const narrow = { ...options, width: 40, height: 12, labelWidth: 12, nodesep: 3, ranksep: 3, margin: 1, autoDirection: false };

it("rejects the real trailing fold that would cover the disconnected source box", async () => {
  const result = await renderGlyphDiagram(`flowchart TB
M[Start] --> X[Middle]
X --> K[End]
A0[Box Box Box] --> B0[end]`, narrow);
  expect(folded(result.layout)).toBe(false);
  expect(result.canvas.rows).toBe(13);
  expect(control.probes).toBe(0);
  expect(control.attempts.length).toBeGreaterThan(0);
  // The overlapping candidate must be rejected before asking the router.
  expect(control.attempts.some(attempt => overlaps(attempt.layout))).toBe(false);
});

it("moves the head left to route a previously blocked fold", async () => {
  const result = await renderGlyphDiagram(`flowchart TB
M[Start] --> X[Middle]
X --> K[End]
A0[Box Box Box] --> B0[end]
B0 --> M
A1[Box Box Box] --> B1[end]
B1 --> M`, narrow);
  const probes = control.attempts.filter(attempt => folded(attempt.layout));
  expect(probes).toHaveLength(1);
  expect(probes[0]!.unroutable).toEqual([]);
  expect(control.attempts.every(attempt => !overlaps(attempt.layout))).toBe(true);
  expect(folded(result.layout)).toBe(true);
  expect(result.canvas.rows).toBeLessThanOrEqual(14);
  expect(computeGlyphDiagramQuality(result, narrow)).toMatchObject({ wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 });
});
