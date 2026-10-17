import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, type GlyphDiagramLayout } from "./pipeline";
import { glyphDiagramHasRoutingClearance, routeGlyphGraphEdges } from "./route";
import { glyphDiagramSnakeLayout } from "./snake";
import { glyphDiagramLoopLabelRect } from "./loop";

const chat = { target: "chat" as const };
type Result = Awaited<ReturnType<typeof renderGlyphDiagram>>;
const node = (r: Result, id: string) => r.layout.nodes.find((n) => n.id === id)!;
const loops = (r: Result) => r.routes.filter((route) => route.edge.from === route.edge.to);
const keyOf = (p: { x: number; y: number }) => `${p.x},${p.y}`;
const labelOf = (r: Result, edgeId: string) => r.labels.find((l) => l.id === `edge:${edgeId}`);
const inside = (p: { x: number; y: number }, r: { x0: number; x1: number; y0: number; y1: number }, pad = 0) => p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.y >= r.y0 - pad && p.y <= r.y1 + pad;

describe("self-loops", () => {
  it.each(["L", "L:1", 'L",1]', 'edge-row:["L",1]'])("keeps wrapped row ids distinct from real edges and every row its loop colour (%s)", async (id) => {
    const r = await renderGlyphDiagram({
      direction: "TB",
      nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }],
      edges: [
        { id, from: "A", to: "A", label: "first\nsecond" },
        { id: `${id}:1`, from: "A", to: "B", label: "done" },
      ],
    }, { target: "web", detail: "faithful", overflow: "expand", autoDirection: false, width: 40, height: 20, charset: "box", color: "css", edgeColor: (e) => e.id === id ? "#00ff00" : "#ff0000" });
    expect(r.report.unroutable).toEqual([]);
    expect(r.report.ledger.filter((e) => e.code.startsWith("label-"))).toEqual([]);
    expect(r.labels.map((l) => [l.id, l.text])).toEqual([
      [`edge:${id}`, "first"],
      [`edge-row:${JSON.stringify([id, 1])}`, "second"],
      [`edge:${id}:1`, "done"],
    ]);
    expect(new Set(r.labels.map((l) => l.id)).size).toBe(r.labels.length);
    for (const label of r.labels) for (let x = label.x0; x <= label.x1; x++) {
      expect(r.canvas.grid.color[label.y * r.canvas.cols + x]).toBe(label.text === "done" ? "#ff0000" : "#00ff00");
    }
  });

  it("hugs the right side of a top-down node as a four-cell loop, entering through the node's border", async () => {
    // Mutation: put the loop's ports on the flow sides (n/s) in reserveGlyphGraphPorts -> the route detours and the side/cell assertions go red.
    const r = await renderGlyphDiagram("flowchart TB\na[Paid] -->|partial refund| a\na --> b[Done]", chat);
    const a = node(r, "a"), [loop] = loops(r);
    expect(loop).toBeDefined();
    expect(loop!.cells).toHaveLength(4);
    expect(loop!.cells.every((p) => p.x >= a.x1 + 1 && p.x <= a.x1 + 2 && p.y > a.y0 && p.y < a.y1)).toBe(true);
    const ports = r.layout.ports.filter((p) => p.edgeId === loop!.edge.id);
    expect(ports.map((p) => p.side)).toEqual(["e", "e"]);
    expect(ports.map((p) => p.end).sort()).toEqual(["from", "to"]);
    const entry = ports.find((p) => p.end === "to")!;
    expect(r.canvas.grid.char[entry.anchor.y * r.canvas.cols + entry.anchor.x]).toBe("◀");
    expect(r.report.unroutable).toEqual([]);
  });

  it("puts the label beside the loop with one blank cell between, on the loop's rows, whole", async () => {
    // Mutation: drop the fixed placement in paint.ts -> the generic search touches the label to the loop, or centres it under the loop.
    const r = await renderGlyphDiagram("flowchart TB\na[Paid] -->|partial refund| a\na --> b[Done]", chat);
    const [loop] = loops(r), a = node(r, "a"), label = labelOf(r, loop!.edge.id)!;
    expect(label.text).toBe("partial refund");
    expect(label.x0).toBe(Math.max(...loop!.cells.map((p) => p.x)) + 2);
    expect(label.y0).toBeGreaterThanOrEqual(Math.min(...loop!.cells.map((p) => p.y)));
    expect(label.y0).toBeLessThanOrEqual(Math.max(...loop!.cells.map((p) => p.y)));
    expect(label.x0).toBe(a.x1 + 4);
    // The blank cell really is blank.
    expect(r.canvas.grid.char[label.y0 * r.canvas.cols + label.x0 - 1]).toBe(" ");
    expect(r.text).toContain("partial refund");
    expect(r.report.ledger.filter((e) => e.code.startsWith("label-"))).toEqual([]);
  });

  it("shares no cell with the edge leaving the same node and keeps that edge's label clear of the loop", async () => {
    const r = await renderGlyphDiagram("flowchart TB\na[Paid] -->|partial refund| a\na -->|ship| b[Done]\na -->|refund| c[Refunded]", chat);
    const [loop] = loops(r), a = node(r, "a");
    const others = r.routes.filter((route) => route !== loop);
    expect(others).toHaveLength(2);
    const taken = new Set(loop!.cells.map(keyOf));
    for (const route of others) {
      expect(route.cells.some((p) => taken.has(keyOf(p)))).toBe(false);
      expect(r.layout.ports.filter((p) => p.edgeId === route.edge.id && p.end === "from").map((p) => p.side)).toEqual(["s"]);
    }
    const loopLabel = labelOf(r, loop!.edge.id)!;
    for (const route of others) {
      const label = labelOf(r, route.edge.id)!;
      expect(label.x1 < loopLabel.x0 || label.x0 > loopLabel.x1 || label.y1 < loopLabel.y0 || label.y0 > loopLabel.y1).toBe(true);
      expect(route.cells.some((p) => inside(p, loopLabel))).toBe(false);
    }
    expect(loop!.cells.every((p) => !inside(p, a))).toBe(true);
  });

  it.each([["BT", "e"], ["TB", "e"], ["LR", "s"], ["RL", "s"]] as const)("hangs a %s graph's loop on the %s side, the side no flow edge uses", async (direction, side) => {
    const r = await renderGlyphDiagram(`flowchart ${direction}\na[Paid] -->|retry| a\na --> b[Done]`, chat);
    const [loop] = loops(r);
    expect(r.layout.ports.filter((p) => p.edgeId === loop!.edge.id).map((p) => p.side)).toEqual([side, side]);
    expect(loop!.cells).toHaveLength(4);
    expect(r.report.unroutable).toEqual([]);
    expect(labelOf(r, loop!.edge.id)?.text).toBe("retry");
  });

  it("hangs a left-to-right loop under its node with the label on the loop's outer row", async () => {
    const r = await renderGlyphDiagram("flowchart LR\na[Paid] -->|partial refund| a\na --> b[Done]", chat);
    const [loop] = loops(r), a = node(r, "a"), label = labelOf(r, loop!.edge.id)!;
    expect(loop!.cells.every((p) => p.y >= a.y1 + 1 && p.y <= a.y1 + 2 && p.x > a.x0 && p.x < a.x1)).toBe(true);
    expect(label.y0).toBe(a.y1 + 2);
    expect(label.x0).toBe(Math.max(...loop!.cells.map((p) => p.x)) + 2);
    expect(label.text).toBe("partial refund");
  });

  it("stacks several loops on one node without touching, each with its own label", async () => {
    for (const direction of ["TB", "LR"]) {
      const r = await renderGlyphDiagram(`flowchart ${direction}\na[Worker] -->|retry| a\na -->|backoff the call| a\na --> b[Done]`, chat);
      const found = loops(r);
      expect(found).toHaveLength(2);
      const [first, second] = found;
      for (const p of first!.cells) for (const q of second!.cells) expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y)).toBeGreaterThan(1);
      // Each label is right beside its own loop, not merely somewhere near.
      for (const route of found) {
        const label = labelOf(r, route.edge.id)!, a = node(r, "a");
        expect(label.x0).toBe(Math.max(...route.cells.map((p) => p.x)) + 2);
        expect(label.y0 >= Math.min(...route.cells.map((p) => p.y)) && label.y0 <= Math.max(...route.cells.map((p) => p.y))).toBe(true);
        if (direction === "LR") expect(label.y0).toBe(a.y1 + 2);
      }
      const [l1, l2] = found.map((route) => labelOf(r, route.edge.id)!);
      expect([l1!.text, l2!.text].sort()).toEqual(["backoff the call", "retry"]);
      expect(l1!.x1 < l2!.x0 || l2!.x1 < l1!.x0 || l1!.y1 < l2!.y0 || l2!.y1 < l1!.y0).toBe(true);
      expect(r.report.unroutable).toEqual([]);
      expect(r.report.ledger.filter((e) => e.code.startsWith("label-"))).toEqual([]);
    }
  });

  it("works on a node inside a subgraph", async () => {
    const r = await renderGlyphDiagram("flowchart TB\nsubgraph g[Group]\n a[Paid] -->|again| a\n a --> b[Done]\nend\ns[Start] --> a", chat);
    expect(r.report.unroutable).toEqual([]);
    expect(loops(r)).toHaveLength(1);
    expect(r.text).toContain("again");
  });

  it("renders the committed loop snapshot, whole, run after run", async () => {
    // A pinned render: any change to the loop's shape, label spacing or room moves it. (Replaces a determinism check that compared two runs of the same code.)
    const source = "flowchart TB\na[Paid] -->|partial refund| a\na --> b[Done]";
    const first = await renderGlyphDiagram(source, chat);
    await expect(first.text).toMatchFileSnapshot(resolve(__dirname, "../fixtures/expected/loop.tb.box.chat72x24.txt"));
    expect((await renderGlyphDiagram(source, chat)).text).toBe(first.text);
  });
});

describe("self-loop room", () => {
  const room = async (direction: "TB" | "LR") => {
    const graph = glyphGraphFromMermaid(`flowchart ${direction}\nr --> a[Left]\nr --> m[Middle]\nr --> c[Right]\nm -->|loop label here| m`);
    return layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(graph)));
  };

  it("keeps the next sibling clear of a top-down loop and its label, by the layout alone", async () => {
    // Mutation: pass no dummy size for the self-edge in layoutGlyphGraph (spare = 0) -> the right sibling lands inside the label's room.
    const layout = await room("TB");
    const m = layout.nodes.find((n) => n.id === "m")!;
    const label = 15;
    const neighbours = layout.nodes.filter((n) => n.id !== "m" && n.y0 < m.y1 && n.y1 > m.y0 && n.x0 > m.x1);
    expect(neighbours.length).toBeGreaterThan(0);
    for (const n of neighbours) expect(n.x0).toBeGreaterThan(m.x1 + 2 + label + 1);
  });

  it("keeps the next row clear of a left-to-right loop", async () => {
    const graph = glyphGraphFromMermaid("flowchart LR\nr --> a[Top]\nr --> m[Middle]\nr --> c[Bottom]\nm -->|hi| m");
    const layout = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(graph)), { nodesep: 3 });
    const m = layout.nodes.find((n) => n.id === "m")!;
    for (const n of layout.nodes.filter((other) => other.id !== "m" && other.x0 < m.x1 && other.x1 > m.x0 && other.y0 > m.y1)) expect(n.y0).toBeGreaterThanOrEqual(m.y1 + 2 + 2);
  });

  it("counts the loop and its label in the layout's own extent", async () => {
    // Mutation: drop the loop terms from the width/height in layoutGlyphGraph -> the label would be clipped by the canvas.
    const graph = glyphGraphFromMermaid("flowchart TB\na[Solo] -->|a long loop label| a");
    const layout = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(graph)));
    const a = layout.nodes[0]!;
    expect(layout.width).toBeGreaterThanOrEqual(a.x1 + 2 + "a long loop label".length + 1);
    const lr = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph({ ...graph, direction: "LR" })));
    expect(lr.height).toBeGreaterThanOrEqual(lr.nodes[0]!.y1 + 3);
    expect(lr.width).toBeGreaterThanOrEqual(lr.nodes[0]!.x0 + 2 + "a long loop label".length + 1);
  });

  it("fits a loop on the rightmost node into a tight canvas with its label whole", async () => {
    const r = await renderGlyphDiagram("flowchart TB\ns[Start] --> w[Working]\nw -->|retry after the backoff| w", { target: "chat", width: 40, height: 14 });
    expect(r.pages).toHaveLength(1);
    expect(r.report.unroutable).toEqual([]);
    expect(r.text).toContain("retry after the backoff");
    expect(r.report.ledger.filter((e) => e.code.startsWith("label-") || e.code.startsWith("budget-"))).toEqual([]);
  });

  const move = (layout: GlyphDiagramLayout, id: string, x0: number, y0: number): GlyphDiagramLayout => {
    const n = layout.nodes.find((item) => item.id === id)!, dx = x0 - n.x0, dy = y0 - n.y0;
    return { ...layout,
      nodes: layout.nodes.map((item) => item.id === id ? { ...item, x0: item.x0 + dx, x1: item.x1 + dx, y0: item.y0 + dy, y1: item.y1 + dy } : item),
      ports: layout.ports.map((p) => p.nodeId === id ? { ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } } : p) };
  };
  // A sits mid-canvas and P/Q straddle its rows at a chosen column, so P->Q's straight transit crosses whatever A reserved there.
  const straddle = async (dx: number) => {
    const laid = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(glyphGraphFromMermaid("flowchart TB\nA -->|lbl| A\nP --> Q"))));
    const base = { ...laid, width: 40, height: 40 };
    const a = move(base, "A", 1, 14).nodes.find((n) => n.id === "A")!;
    const layout = move(move(move(base, "A", 1, 14), "P", a.x1 + dx, 2), "Q", a.x1 + dx, 26);
    const result = routeGlyphGraphEdges(layout, { width: 40, height: 40 });
    const loop = result.routes.find((route) => route.edge.from === route.edge.to)!;
    const from = layout.ports.find((p) => p.edgeId === loop.edge.id && p.end === "from")!, to = layout.ports.find((p) => p.edgeId === loop.edge.id && p.end === "to")!;
    return { result, loop, slot: glyphDiagramLoopLabelRect(from, to, { lines: ["lbl"], labelWidth: 3 })!, transit: result.routes.find((route) => route.edge.from === "P")! };
  };

  it("keeps another edge out of the label's room", async () => {
    // Mutation: leave the loop labels out of the router's obstacles -> P->Q runs straight through the label's cells.
    const { result, slot, transit } = await straddle(3);
    expect(result.unroutable).toEqual([]);
    expect(transit.cells.some((p) => inside(p, slot))).toBe(false);
    expect(transit.cells.some((p) => p.y >= slot.y0 && p.y <= slot.y1)).toBe(true);
  });

  it("routes another edge around the loop's own cells", async () => {
    // Mutation: drop the other-port lanes from blockedByPortLanes' input in the router -> P->Q runs down the loop's far wall.
    const { result, loop, transit } = await straddle(0);
    expect(result.unroutable).toEqual([]);
    const taken = new Set(loop.cells.map(keyOf));
    expect(transit.cells.some((p) => taken.has(keyOf(p)))).toBe(false);
    expect(transit.cells.some((p) => p.y >= loop.cells[0]!.y && p.y <= loop.cells[3]!.y)).toBe(true);
  });

  it("rejects a layout whose neighbour sits in the loop's label room before any route is searched", async () => {
    // Mutation: drop the loop branch of glyphDiagramHasRoutingClearance -> a crowded layout passes.
    const { slot } = await straddle(3);
    const laid = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(glyphGraphFromMermaid("flowchart TB\nA -->|lbl| A\nB"))));
    const apart = move({ ...laid, width: 40, height: 40 }, "B", 30, 1);
    const a = apart.nodes.find((n) => n.id === "A")!;
    expect(glyphDiagramHasRoutingClearance(apart)).toBe(true);
    expect(slot.x0).toBe(a.x1 + 4);
    // The label is 3 wide (x1+4..x1+6); a neighbour may not come within one cell of it.
    expect(glyphDiagramHasRoutingClearance(move(apart, "B", a.x1 + 7, a.y0))).toBe(false);
    expect(glyphDiagramHasRoutingClearance(move(apart, "B", a.x1 + 8, a.y0))).toBe(true);
  });

  it("measures the label room the way paint will place the label", () => {
    // Mutation: drop the 24-cell cap or the whitespace collapse -> the reserved width disagrees with the painted label.
    const room = (label: string) => measureGlyphGraph(glyphGraphFromMermaid(`flowchart TB\nA -->|${label}| A`)).loops[0]!.labelWidth;
    expect(room("a   b")).toBe(3);
    expect(room("x".repeat(40))).toBe(24);
    expect(measureGlyphGraph(glyphGraphFromMermaid("flowchart TB\nA --> A")).loops[0]!.labelWidth).toBe(0);
  });

  it("reports a loop with no room as unroutable instead of painting over a neighbour", async () => {
    const graph = glyphGraphFromMermaid("flowchart TB\nA -->|lbl| A\nB");
    const laid = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(graph)));
    const a = laid.nodes.find((n) => n.id === "A")!;
    const crowded = { ...laid, nodes: laid.nodes.map((n) => n.id === "B" ? { ...n, x0: a.x1 + 2, x1: a.x1 + 2 + n.width - 1, y0: a.y0, y1: a.y0 + n.height - 1 } : n) };
    const result = routeGlyphGraphEdges(crowded, { width: 60, height: 20 });
    expect(result.routes).toEqual([]);
    expect(result.unroutable).toEqual([crowded.edges[0]!.id]);
    // Mutation: drop the loop-cell check from glyphDiagramLoopsClear -> the fit's pre-filter lets the crowded layout through.
    expect(glyphDiagramHasRoutingClearance(crowded)).toBe(false);
    // With no label to touch, only the loop's own cells are in the way.
    const bare = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(glyphGraphFromMermaid("flowchart TB\nA --> A\nB"))));
    const bareA = bare.nodes.find((n) => n.id === "A")!;
    const bareCrowded = { ...bare, nodes: bare.nodes.map((n) => n.id === "B" ? { ...n, x0: bareA.x1 + 3, x1: bareA.x1 + 3 + n.width - 1, y0: bareA.y0, y1: bareA.y0 + n.height - 1 } : n) };
    expect(glyphDiagramHasRoutingClearance(bareCrowded)).toBe(false);
  });
});
