import { describe, expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { glyphDiagramGroupRects, layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, type GlyphDiagramLayout } from "./pipeline";
import { glyphDiagramHasRoutingClearance, routeGlyphGraphEdges } from "./route";
import { glyphDiagramLoopGeometry } from "./loop";
import { glyphDiagramSnakeLayout } from "./snake";

type Rect = { x0: number; y0: number; x1: number; y1: number };
const laidOut = (source: string, options: { nodesep?: number; ranksep?: number } = {}) => layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(glyphGraphFromMermaid(source))), options);
/** Blank cells between a loop (cells and label) and the nearest node that is not its own, across the axis they are separated on. */
const clearance = (layout: GlyphDiagramLayout) => {
  let worst = Infinity;
  for (const g of glyphDiagramLoopGeometry(layout)) for (const n of layout.nodes) {
    if (n.id === g.loop.nodeId) continue;
    worst = Math.min(worst, Math.max(n.x0 - g.bounds.x1, g.bounds.x0 - n.x1, n.y0 - g.bounds.y1, g.bounds.y0 - n.y1) - 1);
  }
  return worst;
};
const inside = (inner: Rect, outer: Rect) => outer.x0 < inner.x0 && outer.y0 < inner.y0 && outer.x1 > inner.x1 && outer.y1 > inner.y1;
const SIBLINGS = "flowchart TB\nr[Root] --> a[Alpha]\nr --> b[Bravo]\na -->|retry later| a\nb -->|again| b";

describe("loop room is exact", () => {
  it.each([3, 4, 6])("leaves one blank cell, no more, between a loop's label and the next sibling at nodesep %i", async (nodesep) => {
    // Mutation: drop `labelpos: "c"` from the self-edge size in layoutGlyphGraph -> dagre adds its 10-cell label offset and the gap grows.
    // Mutation: add 2 to the dummy's width -> the gap grows by 2.
    const layout = await laidOut(SIBLINGS, { nodesep });
    expect(clearance(layout)).toBe(1);
  });

  it("is the same width whatever the nodesep leaves between unrelated siblings", async () => {
    const [three, four] = await Promise.all([laidOut(SIBLINGS, { nodesep: 3 }), laidOut(SIBLINGS, { nodesep: 4 })]);
    expect(four.width - three.width).toBeLessThanOrEqual(1);
  });

  it("costs nothing when the loop fits in the gap nodesep already leaves", async () => {
    // Mutation: always give dagre the self-edge dummy -> its one-cell edgesep widens the layout even though the loop needed nothing.
    const [plain, looped] = await Promise.all([
      laidOut("flowchart TB\nr --> a[Alpha]\nr --> b[Bravo]", { nodesep: 8 }),
      laidOut("flowchart TB\nr --> a[Alpha]\nr --> b[Bravo]\nb -->|x| b", { nodesep: 8 }),
    ]);
    expect(looped.nodes.map((n) => [n.id, n.x0])).toEqual(plain.nodes.map((n) => [n.id, n.x0]));
    expect(looped.width).toBe(plain.width);
    expect(clearance(looped)).toBeGreaterThanOrEqual(1);
  });

  it("fits a two-sibling graph in 50x20 with whole words, one page", async () => {
    // Mutation: restore the over-wide reservation -> the layout needs 53 columns and Alpha/Bravo are cut mid-word.
    const r = await renderGlyphDiagram(SIBLINGS, { target: "chat", width: 50, height: 20, autoDirection: false });
    expect(r.pages).toHaveLength(1);
    expect(r.text).toContain("Alpha");
    expect(r.text).toContain("Bravo");
    expect(r.text).toContain("retry later");
    expect(r.report.unroutable).toEqual([]);
    expect(r.report.ledger.filter((e) => /^(label-|budget-(decoration|duplicates|leaf|split)|split-)/.test(e.code))).toEqual([]);
  });

  it("keeps a three-sibling graph with loops on one page, top-down, labels whole", async () => {
    const r = await renderGlyphDiagram("flowchart TB\nr[Root] --> a[Alpha]\nr --> b[Bravo]\nr --> c[Charlie]\na -->|retry later| a\nb -->|again| b\nc -->|give up| c", { target: "chat", width: 72, height: 24 });
    expect(r.pages).toHaveLength(1);
    expect(r.layout.direction).toBe("TB");
    for (const word of ["Alpha", "Bravo", "Charlie", "retry later", "again", "give up"]) expect(r.text).toContain(word);
    expect(r.report.unroutable).toEqual([]);
  });

  it("does not push the next row down for a left-to-right loop", async () => {
    // Mutation: drop `labelpos: "c"` -> dagre pads the order axis by 10 and Alpha sits far below Bravo.
    const [plain, looped] = await Promise.all([
      laidOut("flowchart LR\nr[Root] --> a[Alpha]\nr --> b[Bravo]\na --> d[Done]\nb --> d"),
      laidOut("flowchart LR\nr[Root] --> a[Alpha]\nr --> b[Bravo]\na --> d[Done]\nb --> d\nb -->|again please| b"),
    ]);
    const gap = (layout: GlyphDiagramLayout) => Math.abs(layout.nodes.find((n) => n.id === "a")!.y0 - layout.nodes.find((n) => n.id === "b")!.y0);
    // The self-edge dummy costs dagre's one-cell `edgesep`, never the 10-cell label offset.
    expect(gap(looped)).toBeLessThanOrEqual(gap(plain) + 1);
    expect(clearance(looped)).toBeGreaterThanOrEqual(1);
  });

  it("wraps a loop label like a node label, so a tight canvas trades its width for rows", async () => {
    // Mutation: offer only the widest loop-label wrap in fitGlyphGraph -> the label cannot shrink and the graph splits or drops it.
    const r = await renderGlyphDiagram("flowchart TB\ns[Start] --> w[Work]\nw -->|retry after the backoff window| w", { target: "chat", width: 30, height: 14, autoDirection: false });
    expect(r.pages).toHaveLength(1);
    const rows = r.labels.filter((l) => l.id.startsWith("edge:") || l.id.startsWith("edge-row:"));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((l) => l.text).join(" ")).toBe("retry after the backoff window");
    expect(r.report.ledger.filter((e) => e.code.startsWith("label-"))).toEqual([]);
    expect(r.report.unroutable).toEqual([]);
  });

  it("keeps a multi-line loop label's rows", () => {
    // Mutation: fold the label as one line -> the break is lost or garbled.
    const graph = glyphGraphFromMermaid("flowchart TB\nA -->|first<br/>second| A");
    expect(measureGlyphGraph(graph).loops[0]).toMatchObject({ lines: ["first", "second"], labelWidth: 6 });
  });

  it("wraps at loopLabelWidth and rejects a bad one", () => {
    const graph = glyphGraphFromMermaid("flowchart TB\nA -->|partial refund issued| A");
    expect(measureGlyphGraph(graph, { loopLabelWidth: 8 }).loops[0]!.lines).toEqual(["partial", "refund", "issued"]);
    expect(measureGlyphGraph(graph).loops[0]!.lines).toEqual(["partial refund issued"]);
    expect(() => measureGlyphGraph(graph, { loopLabelWidth: 0 })).toThrow(expect.objectContaining({ code: "bad-options" }));
  });
});

describe("loops beside loops", () => {
  const THREE = "flowchart LR\na[A] -->|a very long label for loop| a\na --> b[B]\nb -->|bee loops too| b\nb --> c[C]\nc -->|sea| c";

  it("reserves every loop label's room in the layout itself", async () => {
    // Mutation: drop the rank-axis widening of the self-edge (the `2 * (along + 1) - node.width` term) -> A's label runs into B's loop.
    const layout = await laidOut(THREE);
    expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
    expect(clearance(layout)).toBeGreaterThanOrEqual(1);
    const geometry = glyphDiagramLoopGeometry(layout);
    for (const a of geometry) for (const b of geometry) if (a !== b) expect(a.bounds.x1 < b.bounds.x0 - 1 || b.bounds.x1 < a.bounds.x0 - 1 || a.bounds.y1 < b.bounds.y0 - 1 || b.bounds.y1 < a.bounds.y0 - 1).toBe(true);
  });

  it("draws all three labels, each beside its own loop, none dropped", async () => {
    const r = await renderGlyphDiagram(THREE, { target: "chat", width: 72, height: 24, autoDirection: false });
    expect(r.report.ledger.filter((e) => e.code === "label-dropped")).toEqual([]);
    expect(r.report.unroutable).toEqual([]);
    for (const route of r.routes.filter((x) => x.edge.from === x.edge.to)) {
      const node = r.layout.nodes.find((n) => n.id === route.edge.from)!;
      const rows = r.labels.filter((l) => l.id === `edge:${route.edge.id}` || l.id.startsWith(`edge-row:[${JSON.stringify(route.edge.id)},`));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]!.x0).toBe(Math.max(...route.cells.map((p) => p.x)) + 2);
      expect(rows[0]!.y0).toBe(node.y1 + 2);
    }
    expect(r.text).toContain("bee loops too");
    expect(r.text).toContain("sea");
  });

  it("refuses a layout where one loop's label meets another loop's cells", async () => {
    // Mutation: drop loopsConflict from glyphDiagramHasRoutingClearance -> the crowded layout passes; from the router -> both loops draw.
    const laid = await laidOut("flowchart LR\nA -->|a label long enough| A\nB -->|x| B");
    const move = (layout: GlyphDiagramLayout, id: string, x0: number, y0: number): GlyphDiagramLayout => {
      const n = layout.nodes.find((item) => item.id === id)!, dx = x0 - n.x0, dy = y0 - n.y0;
      return { ...layout,
        nodes: layout.nodes.map((item) => item.id === id ? { ...item, x0: item.x0 + dx, x1: item.x1 + dx, y0: item.y0 + dy, y1: item.y1 + dy } : item),
        ports: layout.ports.map((p) => p.nodeId === id ? { ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } } : p) };
    };
    const base = { ...laid, width: 60, height: 30 };
    const a = move(base, "A", 2, 12).nodes.find((n) => n.id === "A")!;
    // B is one row higher and just right of A, so its loop's rows sit beside A's label row without B's box touching it.
    const crowded = move(move(base, "A", 2, 12), "B", a.x1 + 5, a.y0 - 1);
    expect(glyphDiagramHasRoutingClearance(crowded)).toBe(false);
    expect(routeGlyphGraphEdges(crowded, { width: 60, height: 30 }).unroutable.length).toBeGreaterThan(0);
    const apart = move(crowded, "B", a.x1 + 30, a.y0 - 1);
    expect(glyphDiagramHasRoutingClearance(apart)).toBe(true);
    expect(routeGlyphGraphEdges(apart, { width: 60, height: 30 }).unroutable).toEqual([]);
  });
});

describe("frames enclose loops", () => {
  const frames = async (source: string) => {
    const r = await renderGlyphDiagram(source, { target: "chat", width: 72, height: 24, autoDirection: false });
    const rects = glyphDiagramGroupRects(r.layout, { cols: r.canvas.cols, rows: r.canvas.rows });
    return { r, rects, loops: glyphDiagramLoopGeometry(r.layout) };
  };
  it.each([
    ["top-down subgraph", "flowchart TB\ns[Start] --> a\nsubgraph g[Group One]\n a[Paid] -->|again and again| a\n a --> b[Done]\nend"],
    ["left-to-right subgraph", "flowchart LR\nsubgraph g[Group]\n a[Paid] -->|again please| a\n a --> b[Done]\nend\ns --> a"],
    ["composite state", "stateDiagram-v2\n[*] --> Active\nstate Active {\n [*] --> Running\n Running --> Running : tick every second\n Running --> Stopped\n}"],
  ])("a %s frame sits outside its members' loops and labels", async (_name, source) => {
    // Mutation: build the frame from the nodes alone in glyphDiagramGroupRects -> the far wall or the label crosses the frame.
    const { r, rects, loops } = await frames(source);
    expect(loops.length).toBeGreaterThan(0);
    const frame = [...rects.values()][0]!;
    for (const g of loops) expect(inside(g.bounds, frame)).toBe(true);
    expect(r.report.ledger.filter((e) => e.code === "group-member-list" || e.code.startsWith("label-"))).toEqual([]);
    // The label's text lies between the frame's side rings on its own row.
    const row = r.text.split("\n")[loops[0]!.label!.y0]!;
    const ring = [...row].map((c, i) => c === "·" ? i : -1).filter((i) => i >= 0);
    expect(Math.min(...ring)).toBeLessThan(row.indexOf(loops[0]!.loop.lines[0]!));
    expect(Math.max(...ring)).toBeGreaterThan(row.indexOf(loops[0]!.loop.lines[0]!) + loops[0]!.loop.labelWidth);
  });

  it("gives a nested frame its own inset, outside the inner frame on every side, even in a canvas exactly as large as the layout", async () => {
    // Mutation: pad a parent frame from its members alone (skip the child frames) -> the two share border columns.
    // Mutation: drop the layout's nesting inset -> in a canvas no larger than the layout, both frames clamp to the same edge.
    const layout = await laidOut("flowchart TB\nsubgraph outer[Outer]\n subgraph inner[Inner]\n  a[One] --> b[Two]\n end\n c[Three]\nend\nb --> c");
    const rects = glyphDiagramGroupRects(layout, { cols: layout.width, rows: layout.height });
    expect(inside(rects.get("inner")!, rects.get("outer")!)).toBe(true);
    const r = await renderGlyphDiagram("flowchart TB\nsubgraph outer[Outer]\n subgraph inner[Inner]\n  a[One] --> b[Two]\n end\n c[Three]\nend\nb --> c", { target: "chat", width: 72, height: 30, autoDirection: false });
    expect(r.report.ledger.filter((e) => e.code === "group-member-list")).toEqual([]);
  });
});

describe("loops in the snake", () => {
  const CHAIN = "flowchart LR\nA[Alpha] --> B[Bravo] --> C[Charlie] --> D[Delta] --> E[Echo] --> F[Foxtrot] --> G[Golf]";

  it("still wraps a left-to-right chain when a node has a loop", async () => {
    // Mutation: bail out of glyphDiagramSnakeLayout when the graph has a loop -> a tall top-down column that overflows 30 rows.
    const plain = await renderGlyphDiagram(CHAIN, { target: "chat", width: 50, height: 30, autoDirection: true, overflow: "paginate" });
    const looped = await renderGlyphDiagram(`${CHAIN}\nC -->|retry| C`, { target: "chat", width: 50, height: 30, autoDirection: true, overflow: "paginate" });
    expect(plain.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    expect(looped.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    expect(looped.pages).toHaveLength(1);
    expect(looped.layout.direction).toBe("LR");
    expect(looped.canvas.rows).toBeLessThanOrEqual(30);
    expect(looped.text).toContain("retry");
    expect(looped.report.unroutable).toEqual([]);
  });

  it("keeps a short chain with a loop on one page in a tight paginated canvas", async () => {
    const r = await renderGlyphDiagram("flowchart LR\nA --> B --> C --> D --> E\nC -->|retry| C", { target: "chat", width: 40, height: 12, autoDirection: false, overflow: "paginate" });
    expect(r.pages).toHaveLength(1);
    expect(r.report.unroutable).toEqual([]);
    for (const name of ["A", "B", "C", "D", "E", "retry"]) expect(r.text).toContain(name);
  });

  it("gives the edge that wraps to the next row a straight turn below a loop, when the canvas has the rows", async () => {
    // Mutation: drop the loop-sized gap floor from the snake's gap search -> the minimum gap is taken and the wrapping edge climbs over the loop's label.
    const r = await renderGlyphDiagram("flowchart LR\nA --> B --> C --> D --> E\nC -->|retry| C", { target: "chat", width: 40, height: 20, autoDirection: false, overflow: "paginate" });
    const wrap = r.routes.find((route) => route.edge.from === "D" && route.edge.to === "E")!;
    expect(wrap.cells.every((p, i) => i === 0 || p.y >= wrap.cells[i - 1]!.y)).toBe(true);
  });

  const snakeRow = (source: string) => glyphDiagramSnakeLayout(measureGlyphGraph(glyphGraphFromMermaid(source), { direction: "LR", labelWidth: 8 }), { width: 120, gap: 4, margin: 1, branchGap: 3, rowGap: 6 })!;

  it("keeps the next box clear of a loop's label when that box reaches down to the label's rows", () => {
    // Mutation: ignore the overhang in the snake's spacing -> the taller neighbour sits in C's label room.
    const layout = snakeRow(`${CHAIN.replace("D[Delta]", "D[Delta<br/>tall<br/>node]")}\nC -->|retry later please| C`);
    const [loop] = glyphDiagramLoopGeometry(layout);
    const d = layout.nodes.find((n) => n.id === "D")!;
    expect(d.y1).toBeGreaterThanOrEqual(loop!.label!.y0 - 1);
    expect(d.x0).toBeGreaterThan(loop!.label!.x1 + 1);
    expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
  });

  it("reserves nothing for the label when the next box ends above its rows", () => {
    // Mutation: always reserve the overhang -> D is pushed right of C's label for nothing.
    const layout = snakeRow(`${CHAIN}\nC -->|retry later please| C`);
    const c = layout.nodes.find((n) => n.id === "C")!, d = layout.nodes.find((n) => n.id === "D")!;
    expect(d.x0 - c.x1 - 1).toBe(4);
    expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
  });

  it("starts a loop node's other bottom exits past the loop and its label", () => {
    // Mutation: drop the `from` offset in assignPorts -> the branch's exit lane runs through the loop's label.
    const measured = measureGlyphGraph(glyphGraphFromMermaid(`${CHAIN}\nC -->|retry| C\nC --> X[Side]`), { direction: "LR", labelWidth: 8 });
    const layout = glyphDiagramSnakeLayout(measured, { width: 120, gap: 4, margin: 1, branchGap: 6, rowGap: 6 })!;
    expect(layout).toBeDefined();
    const [loop] = glyphDiagramLoopGeometry(layout);
    const drop = layout.ports.find((p) => p.nodeId === "C" && p.side === "s" && !layout.loops.some((l) => l.edgeId === p.edgeId))!;
    expect(drop.anchor.x).toBeGreaterThan(loop!.bounds.x1);
    expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
    expect(routeGlyphGraphEdges(layout, { width: layout.width, height: layout.height }).unroutable).toEqual([]);
  });
});
