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
vi.mock("./paint", async importOriginal => {
  const real = await importOriginal<typeof import("./paint")>();
  return { ...real, paintGlyphDiagram: (...args: Parameters<typeof real.paintGlyphDiagram>) => {
    const painted = real.paintGlyphDiagram(...args);
    return folded(args[0]) && control.reject === "labels" ? { ...painted,
      ledger: [...painted.ledger, { code: "label-dropped", message: "Injected folded-route label loss." }] } : painted;
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
import { computeGlyphDiagramQuality } from "./quality";

const source = readFileSync(resolve(__dirname, "../bench/corpus/galaxy-build-detailed.mmd"), "utf8");
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
afterEach(() => { control.reject = ""; control.probes = 0; control.labels = []; control.lastHeight = Infinity; control.attempts = []; });

it.each(["TB", "BT"])("folds one %s trailing chain without changing its labels or losing edges", async direction => {
  const result = await renderGlyphDiagram(source.replace("TB", direction), options);
  const [head, render, camera] = ["M", "X", "K"].map(id => result.layout.nodes.find(node => node.id === id)!);
  expect(head!.x1).toBeLessThan(render!.x0);
  expect(render!.x1).toBeLessThan(camera!.x0);
  for (const route of result.routes.filter(route => route.edge.from === "M" || route.edge.from === "X")) {
    expect(new Set(route.cells.map(cell => cell.y)).size).toBe(1);
  }
  expect(result.canvas.rows).toBe(32); // The unfurled fit is 48 rows.
  expect(control.probes).toBe(1);
  expect(control.labels.at(-1)).toEqual(control.labels.at(-2));
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ wordCuts: 1, crossings: 0, fakeFrames: 0,
    droppedEdges: 0, droppedLabels: 0, pages: 1 });
  expect((await renderGlyphDiagram(source.replace("TB", direction), options)).text).toBe(result.text);
});

it.each(["crossings", "fakeFrames", "labels"] as const)("rejects the single folded option when it adds %s", async reject => {
  control.reject = reject;
  const result = await renderGlyphDiagram(source, options);
  expect(control.probes).toBe(1);
  expect(folded(result.layout)).toBe(false);
  expect(result.canvas.rows).toBe(48);
});

it("leaves a roomy vertical fit alone", async () => {
  const result = await renderGlyphDiagram(source, { ...options, height: 80 });
  expect(control.probes).toBe(0);
  expect(folded(result.layout)).toBe(false);
});

it("rejects a fold that saves no canvas rows even when the content is tall and narrow", async () => {
  const result = await renderGlyphDiagram("flowchart TB\nM[Start] --> X[Middle]\nX --> K[End]", { ...options, height: 80 });
  expect(result.canvas.rows).toBe(80);
  expect(folded(result.layout)).toBe(false);
  expect(control.probes).toBe(0);
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
  expect(result.canvas.rows).toBe(15);
  expect(control.probes).toBe(0);
  expect(control.attempts.length).toBeGreaterThan(0);
  // The overlapping candidate must be rejected before asking the router.
  expect(control.attempts.some(attempt => overlaps(attempt.layout))).toBe(false);
});

it("rejects the real non-overlapping fold whose incoming port lanes cannot route", async () => {
  const result = await renderGlyphDiagram(`flowchart TB
M[Start] --> X[Middle]
X --> K[End]
A0[Box Box Box] --> B0[end]
B0 --> M
A1[Box Box Box] --> B1[end]
B1 --> M`, narrow);
  const probes = control.attempts.filter(attempt => folded(attempt.layout));
  expect(probes).toHaveLength(1);
  expect(overlaps(probes[0]!.layout)).toBe(false);
  expect(probes[0]!.unroutable).toEqual(['edge:["B0","M","","solid",0]:0']);
  expect(folded(result.layout)).toBe(false);
  expect(result.canvas.rows).toBe(27);
  expect(computeGlyphDiagramQuality(result, narrow)).toMatchObject({ droppedEdges: 0, droppedLabels: 0 });
});
