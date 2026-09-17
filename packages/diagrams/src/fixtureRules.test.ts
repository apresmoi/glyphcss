import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GLYPH_CANVAS_TIERS } from "glyphcss";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { glyphDiagramRectsOverlap } from "./labels";
import { paintGlyphDiagram } from "./paint";
import { layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, canonicalizeGlyphGraph, glyphDiagramGroupRect } from "./pipeline";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");
const inside = (p: { x: number; y: number }, n: { x0: number; y0: number; x1: number; y1: number }) => p.x >= n.x0 && p.x <= n.x1 && p.y >= n.y0 && p.y <= n.y1;

for (const name of ["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "langgraph-export"]) for (const charset of ["box", "ascii"] as const) {
  it(`${name} ${charset}: all connectors and labels obey the real-engine contract`, async () => {
    const graph = glyphGraphFromMermaid(fixture(name));
    const r = await renderGlyphDiagram(graph, { target: "chat", charset, width: name.startsWith("langgraph") ? 60 : 80, height: name.startsWith("langgraph") ? 20 : 32 });
    expect(r.pages).toHaveLength(1);
    expect(r.routes).toHaveLength(graph.edges.length);
    expect(r.report.unroutable).toEqual([]);
    expect(r.report.ledger).toEqual([]);
    expect(r.layout.nodes).toHaveLength(graph.nodes.length);
    for (const route of r.routes) {
      for (const p of route.cells) expect(r.layout.nodes.some((n) => inside(p, n)), route.edge.id).toBe(false);
      const port = r.layout.ports.find((p) => p.edgeId === route.edge.id && p.end === "to")!;
      const arrow = { n: "s", s: "n", e: "w", w: "e" }[port.side] as "n" | "s" | "e" | "w";
      expect(r.canvas.grid.char[port.anchor.y * r.canvas.grid.cols + port.anchor.x]).toBe(GLYPH_CANVAS_TIERS[charset].arrow[arrow]);
      expect(route.cells.at(-1)).toEqual(port.escape);
    }
    const segments = r.routes.map((route) => route.cells.slice(1).map((b, i) => ({ a: route.cells[i]!, b, horizontal: b.y === route.cells[i]!.y })));
    for (let a = 0; a < segments.length; a++) for (let b = a + 1; b < segments.length; b++) for (const p of segments[a]!) for (const q of segments[b]!) {
      if (p.horizontal !== q.horizontal) continue;
      if (p.horizontal && Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x)) <= Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x))) expect(Math.abs(p.a.y - q.a.y)).toBeGreaterThanOrEqual(2);
      if (!p.horizontal && Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y)) <= Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y))) expect(Math.abs(p.a.x - q.a.x)).toBeGreaterThanOrEqual(2);
    }
    for (const node of r.layout.nodes) {
      const top = node.y0 + Math.floor((node.height - node.lines.length) / 2);
      node.lines.forEach((line, i) => expect(r.canvas.grid.char.slice((top + i) * r.canvas.grid.cols + node.x0 + 1, (top + i) * r.canvas.grid.cols + node.x1).join("")).toContain(line));
    }
    const obstacles = [...r.layout.nodes, ...r.routes.flatMap((route) => route.cells.map((p) => ({ x0: p.x, x1: p.x, y0: p.y, y1: p.y })))];
    r.labels.forEach((label, i) => {
      for (const rect of [...obstacles, ...r.labels.slice(0, i)]) expect(glyphDiagramRectsOverlap(label, rect)).toBe(false);
      expect(r.canvas.grid.char.slice(label.y * r.canvas.grid.cols + label.x, label.y * r.canvas.grid.cols + label.x + label.text.length).join("")).toBe(label.text);
    });
    for (const route of r.routes.filter((route) => route.edge.label)) {
      const label = r.labels.find((l) => l.id === `edge:${route.edge.id}`)!;
      expect(label).toBeDefined();
      expect(route.cells.some((p) => Math.max(label.x0 - p.x, 0, p.x - label.x1) + Math.abs(label.y - p.y) === 1)).toBe(true);
    }
    if (name === "langgraph") {
      const start = r.layout.nodes.find((n) => n.id === "__start__")!, agent = r.layout.nodes.find((n) => n.id === "agent")!;
      expect(start.y1).toBeLessThan(agent.y0);
      expect(start.x0).toBeLessThanOrEqual(agent.x1); expect(start.x1).toBeGreaterThanOrEqual(agent.x0);
      const down = r.routes.find((route) => route.edge.from === "agent" && route.edge.to === "tools")!;
      expect(down.edge.style).toBe("solid");
      const back = r.routes.find((route) => route.edge.from === "tools")!;
      expect(back.cells.some((p) => down.cells.some((q) => p.x === q.x && p.y === q.y))).toBe(false);
      expect(r.routes.find((route) => route.edge.to === "__end__")!.edge).toMatchObject({ style: "dotted", label: "__end__" });
    }
    // Deliberate opt-in: write inspectable output only after every rule above passed.
    if (process.env.GLYPH_DIAGRAM_INSPECT_DIR) {
      writeFileSync(resolve(process.env.GLYPH_DIAGRAM_INSPECT_DIR, `${name}.${charset}.txt`), r.text);
      writeFileSync(resolve(process.env.GLYPH_DIAGRAM_INSPECT_DIR, `${name}.${charset}.json`), JSON.stringify(r));
    }
  });
}

// USER FEEDBACK, verbatim: "some of the lines that are dotted are hard to
// understand on what is the direction — I think that because we have kind
// of blocks that are dotted and also arrows that are dotted — probably if
// we have a block that is dotted we need some padding around them to show
// it properly, with some spacing around". A regression here means the
// group ring and some other element's route are back to touching, the
// exact ambiguity the padding/clearance change exists to remove.
it.each(["agent-guardrail", "agent-supervisor", "event-queue", "rag-pipeline", "subgraph", "transformer-block"])(
  "%s: a painted group boundary cell never sits orthogonally adjacent to another element's route cell",
  async (name) => {
    const r = await renderGlyphDiagram(fixture(name), { target: "web" });
    expect(r.pages).toHaveLength(1);
    expect(r.layout.groups.length).toBeGreaterThan(0);
    const dot = GLYPH_CANVAS_TIERS[r.canvas.tier].dot;
    const routeCells = new Set(r.routes.flatMap((route) => route.cells.map((p) => `${p.x},${p.y}`)));
    let boundaryCellsSeen = 0;
    for (const group of r.layout.groups) {
      const nodes = r.layout.nodes.filter((n) => group.members.includes(n.id));
      const rect = glyphDiagramGroupRect(nodes, { cols: r.canvas.cols, rows: r.canvas.rows });
      if (!rect) continue;
      for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
        if (x !== rect.x0 && x !== rect.x1 && y !== rect.y0 && y !== rect.y1) continue;
        // Only a cell the painter actually rang with its own dot glyph is a
        // real boundary cell — one it left blank (a crossing, or a label)
        // claims no ring at all, so there is nothing here for a route to be
        // "adjacent to".
        if (r.canvas.grid.char[y * r.canvas.cols + x] !== dot) continue;
        boundaryCellsSeen++;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
          expect(routeCells.has(`${nx},${ny}`), `${group.id} boundary (${x},${y}) touches a route at (${nx},${ny})`).toBe(false);
        }
      }
    }
    // Mutation guard: the fixture must actually paint a real ring, or the
    // loop above would pass vacuously.
    expect(boundaryCellsSeen).toBeGreaterThan(0);
  },
);

it.each(["TB", "BT", "LR", "RL"] as const)("real dagre %s respects measured cell extents and rank separation", async (direction) => {
  const r = await layoutGlyphGraph(glyphGraphFromMermaid(`graph ${direction}; A[short] --> B[longer label]`), { ranksep: 7, nodesep: 5, margin: 2 });
  const a = r.nodes.find((n) => n.id === "A")!, b = r.nodes.find((n) => n.id === "B")!;
  for (const node of r.nodes) { expect(node.x1 - node.x0 + 1).toBe(node.width); expect(node.y1 - node.y0 + 1).toBe(node.height); }
  const gap = direction === "TB" ? b.y0 - a.y1 - 1 : direction === "BT" ? a.y0 - b.y1 - 1 : direction === "LR" ? b.x0 - a.x1 - 1 : a.x0 - b.x1 - 1;
  expect(gap).toBe(7);
  if (direction === "TB" || direction === "BT") expect(Math.abs((a.x0 + a.x1) - (b.x0 + b.x1))).toBeLessThanOrEqual(1);
  else expect(a.y0 + a.y1).toBe(b.y0 + b.y1);
});

it("reserves both side capacities before centering ports and canonicalizes every id family", () => {
  const graph = glyphGraphFromMermaid("graph TB; Z --> H; H --> A & B & C & D & E & F");
  const reserved = reserveGlyphGraphPorts(measureGlyphGraph(graph));
  const hub = reserved.nodes.find((n) => n.id === "H")!;
  expect(hub.width).toBe(13);
  expect(reserved.ports.find((p) => p.nodeId === "H" && p.end === "to")!.offset).toBe(6);
  const canonical = canonicalizeGlyphGraph({ ...graph, groups: [{ id: "z", members: ["Z", "H"] }, { id: "a", members: ["B", "A"] }] });
  for (const items of [canonical.nodes, canonical.edges, canonical.groups!]) expect(items.map((item) => item.id)).toEqual(items.map((item) => item.id).sort());
  for (const group of canonical.groups!) expect(group.members).toEqual([...group.members].sort());
});

it("a four-node diamond uses all four reserved routes without conflicts or hops", async () => {
  const r = await renderGlyphDiagram("graph TB; A --> B; A --> C; B --> D; C --> D", { width: 60, height: 20 });
  expect(r.pages).toHaveLength(1); expect(r.routes).toHaveLength(4); expect(r.report.ledger).toEqual([]);
  for (const hop of Object.values(GLYPH_CANVAS_TIERS.box.hop)) expect(r.text).not.toContain(hop);
});

it.each(["box", "ascii"] as const)("%s painter distinguishes a real merge from a crossing", (charset) => {
  const horizontal = Array.from({ length: 9 }, (_, x) => ({ x: x + 1, y: 4 }));
  const vertical = Array.from({ length: 7 }, (_, y) => ({ x: 5, y: y + 1 }));
  const first = { id: "a", from: "left", to: "right", style: "undirected" as const };
  const second = { id: "b", from: "top", to: "bottom", style: "undirected" as const };
  const layout = { nodes: [], edges: [first, second], ports: [], groups: [], direction: "TB" as const, width: 12, height: 10, ledger: [] };
  const crossing = paintGlyphDiagram(layout, { routes: [{ edge: first, cells: horizontal }, { edge: second, cells: vertical }], unroutable: [], ledger: [] }, { width: 12, height: 10, charset });
  expect(crossing.canvas.grid.char[4 * 12 + 5]).toBe(GLYPH_CANVAS_TIERS[charset].hop.h);
  expect(crossing.ledger).toEqual([]);
  const mergeCells = [...vertical.slice(0, 4), ...horizontal.slice(5)];
  const merge = paintGlyphDiagram(layout, { routes: [{ edge: first, cells: horizontal }, { edge: { ...second, to: "right" }, cells: mergeCells }], unroutable: [], ledger: [] }, { width: 12, height: 10, charset });
  expect(merge.canvas.grid.char[4 * 12 + 5]).toBe(GLYPH_CANVAS_TIERS[charset].junction[11]);
  expect(merge.ledger).toEqual([]);
});
