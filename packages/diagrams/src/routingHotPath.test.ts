import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { glyphGraphFromMermaid } from "./mermaid";
import { layoutGlyphGraph, type GlyphDiagramLayout } from "./pipeline";
import { routeGlyphGraphEdges, type GlyphDiagramRoutingOptions } from "./route";
import { GLYPH_DIAGRAM_WORK, type GlyphDiagramWork } from "./work";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}`), "utf8");
const snapshots = JSON.parse(fixture("routing-hot-path.json")) as { name: string; hash: string; work: number; workHash: string }[];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sources: Record<string, string> = {
  fan: fixture("six-port.mmd"), groups: fixture("subgraph.mmd"), cycle: fixture("cycle.mmd"),
  mixed: "flowchart TB\nA --> B & C\nA -.-> D\nB & C --> E\nD ==> E\nE --> A",
  state: "stateDiagram-v2\nstate P {\n[*] --> A\nA --> B\n--\n[*] --> C\nC --> D\n}\n[*] --> P\nP --> [*]",
};
const obstacleLayout = (): GlyphDiagramLayout => ({
  direction: "LR", width: 34, height: 15, groups: [], loops: [], ledger: [],
  edges: [{ id: "transit", from: "a", to: "b" }],
  nodes: [
    { id: "a", label: "A", lines: ["A"], width: 5, height: 3, x0: 1, y0: 5, x1: 5, y1: 7 },
    { id: "b", label: "B", lines: ["B"], width: 5, height: 3, x0: 27, y0: 5, x1: 31, y1: 7 },
    { id: "blocker", label: "Blocker", lines: ["Blocker"], width: 7, height: 7, x0: 13, y0: 3, x1: 19, y1: 9 },
  ],
  ports: [
    { edgeId: "transit", nodeId: "a", end: "from", side: "e", offset: 1, anchor: { x: 5, y: 6 }, escape: { x: 6, y: 6 } },
    { edgeId: "transit", nodeId: "b", end: "to", side: "w", offset: 1, anchor: { x: 27, y: 6 }, escape: { x: 26, y: 6 } },
  ],
});
// Transit along the last cell of one row must not block the next row's
// first cell through the flattened grid's numeric neighbour key.
const boundaryLayout = (): GlyphDiagramLayout => ({
  direction: "LR", width: 6, height: 3, groups: [], loops: [], ledger: [], nodes: [],
  edges: [{ id: "a", from: "a0", to: "a1" }, { id: "b", from: "b0", to: "b1" }],
  ports: [
    { edgeId: "a", nodeId: "a0", end: "from", side: "e", offset: 0, anchor: { x: 2, y: 0 }, escape: { x: 3, y: 0 } },
    { edgeId: "a", nodeId: "a1", end: "to", side: "w", offset: 0, anchor: { x: 6, y: 0 }, escape: { x: 5, y: 0 } },
    { edgeId: "b", nodeId: "b0", end: "from", side: "e", offset: 0, anchor: { x: -1, y: 1 }, escape: { x: 0, y: 1 } },
    { edgeId: "b", nodeId: "b1", end: "to", side: "w", offset: 0, anchor: { x: 2, y: 1 }, escape: { x: 1, y: 1 } },
  ],
});
const options: Record<string, GlyphDiagramRoutingOptions> = {
  "fractional obstacle": { obstacles: [{ x0: 10.5, x1: 20.25, y0: 0.5, y1: 10.75 }] },
  blocked: { obstacles: [{ x0: 12, x1: 20, y0: 0, y1: 14 }] },
  sparse: { height: 40000 }, "unsafe numeric bounds": { width: 2 ** 51, height: 15 },
  "row boundary": { stopOnFailure: true }, "fractional ports": { stopOnFailure: true },
  "zero costs": { bendCost: 0, crossingCost: 0, ringParallelCost: 0 },
};

// Main's exact routes AND charge sequence: equivalent pictures alone would
// miss changes to the fitter's deterministic exhaustion boundary.
it.each(snapshots)("preserves routing and work byte-for-byte: $name", async snapshot => {
  const [name, direction, mode] = snapshot.name.split("/");
  let layout = direction ? await layoutGlyphGraph(glyphGraphFromMermaid(sources[name!]!), {
    direction: direction as GlyphDiagramLayout["direction"], nodesep: 6, ranksep: 10,
  }) : obstacleLayout();
  if (name === "row boundary" || name === "fractional ports") {
    layout = boundaryLayout();
    if (name === "fractional ports") layout = { ...layout, ports: layout.ports.map(port => ({ ...port,
      escape: { x: port.escape.x + 0.5, y: port.escape.y + 0.5 },
    })) };
  }
  const calls: [string, number][] = [];
  const work = {
    route() { calls.push(["routings", 1000]); },
    take(kind: string, cost = 1) { calls.push([kind, cost]); },
  } as unknown as GlyphDiagramWork;
  const routingOptions = {
    ...(direction ? { width: layout.width + 12, height: layout.height + 12, stopOnFailure: mode === "probe" } : options[name!]!),
    [GLYPH_DIAGRAM_WORK]: work,
  };
  const result = routeGlyphGraphEdges(layout, routingOptions);
  expect(hash(result)).toBe(snapshot.hash);
  expect(calls).toHaveLength(snapshot.work);
  expect(hash(calls)).toBe(snapshot.workHash);
});
