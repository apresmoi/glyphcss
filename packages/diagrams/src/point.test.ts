import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramPointCell } from "./pipeline";
import { glyphDiagramJsonSchema } from "./schema";
import { validateGlyphGraph } from "./validate";
import type { GlyphGraph } from "./types";

const options = { target: "chat" as const, width: 40, height: 20, autoDirection: false };
type Result = Awaited<ReturnType<typeof renderGlyphDiagram>>;
const cell = (r: Result, x: number, y: number) => r.canvas.grid.char[y * r.canvas.cols + x];
const node = (r: Result, id: string) => r.layout.nodes.find((n) => n.id === id)!;
const fan = (direction: GlyphGraph["direction"], outs: number, ins: number): GlyphGraph => ({
  direction,
  nodes: [
    { id: "s", label: "●", kind: "state-start", shape: "point" },
    ...Array.from({ length: Math.max(outs, ins) }, (_, i) => ({ id: `m${i}`, label: `M${i}`, shape: "rounded" as const })),
    { id: "e", label: "◉", kind: "state-end", shape: "point" },
  ],
  edges: [
    ...Array.from({ length: outs }, (_, i) => ({ from: "s", to: `m${i}` })),
    ...Array.from({ length: ins }, (_, i) => ({ from: `m${i}`, to: "e" })),
  ],
});

describe("point nodes", () => {
  it("are a valid shape in the IR and the JSON schema", () => {
    // Mutation: drop "point" from GLYPH_GRAPH_NODE_SHAPES -> validation rejects the node and the schema enum loses it.
    expect(() => validateGlyphGraph({ nodes: [{ id: "a", label: "●", shape: "point" }], edges: [], direction: "TB" })).not.toThrow();
    const nodeSchema = (glyphDiagramJsonSchema() as unknown as { properties: { nodes: { items: { properties: { shape: { enum: string[] } } } } } }).properties.nodes.items.properties.shape;
    expect(nodeSchema.enum).toContain("point");
    expect(() => validateGlyphGraph({ nodes: [{ id: "a", label: "x", shape: "dot" }], edges: [], direction: "TB" })).toThrow(expect.objectContaining({ code: "bad-node" }));
  });

  it("draw a start with one exit as its glyph alone, the edge leaving the very next cell", async () => {
    // Mutation: skip paintPoint in paint.ts -> the glyph and bar are gone.
    const r = await renderGlyphDiagram(fan("TB", 1, 1), options);
    const s = node(r, "s");
    expect(s.x1 - s.x0 + 1).toBe(1);
    expect(cell(r, s.x0, s.y1)).toBe("●");
    expect(cell(r, s.x0, s.y1 + 1)).toBe("│");
    for (let y = s.y0; y < s.y1; y++) expect(cell(r, s.x0, y)).toBe(" ");
    // No border: nothing but the glyph is painted in the node's own rectangle or beside it on the glyph row.
    expect(cell(r, s.x0 - 1, s.y1)).toBe(" ");
    expect(cell(r, s.x0 + 1, s.y1)).toBe(" ");
  });

  it("draw an end with one entry as an arrowhead directly over its glyph", async () => {
    // Mutation: give a point one cell along the flow instead of two -> the arrowhead overwrites the glyph.
    const r = await renderGlyphDiagram(fan("TB", 1, 1), options);
    const e = node(r, "e");
    expect(e.y1 - e.y0 + 1).toBe(2);
    expect(cell(r, e.x0, e.y0)).toBe("▼");
    expect(cell(r, e.x0, e.y1)).toBe("◉");
  });

  it("join several exits to the glyph with a bar of the tier's own junctions", async () => {
    const r = await renderGlyphDiagram(fan("TB", 3, 1), options);
    const s = node(r, "s");
    expect(s.x1 - s.x0 + 1).toBe(5);
    expect([0, 1, 2, 3, 4].map((dx) => cell(r, s.x0 + dx, s.y1))).toEqual(["┌", "─", "●", "─", "┐"]);
    expect(cell(r, s.x0 + 2, s.y1 + 1)).toBe("│");
    expect(r.report.unroutable).toEqual([]);
  });

  it("use plain ascii for the glyphs and the bar", async () => {
    const r = await renderGlyphDiagram(fan("TB", 3, 3), { ...options, charset: "ascii" });
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
    const s = node(r, "s"), e = node(r, "e");
    expect([0, 1, 2, 3, 4].map((dx) => cell(r, s.x0 + dx, s.y1))).toEqual(["+", "-", "*", "-", "+"]);
    expect(cell(r, e.x0 + 2, e.y1)).toBe("@");
    expect(r.report.unroutable).toEqual([]);
  });

  it.each([
    ["TB", { x: 2, y: 1 }], ["BT", { x: 2, y: 0 }], ["LR", { x: 1, y: 2 }], ["RL", { x: 0, y: 2 }],
  ] as const)("put the glyph on the side its edges leave from in a %s graph", (direction, expected) => {
    // Mutation: always take the bottom row -> every direction but TB goes red.
    const box = direction === "TB" || direction === "BT" ? { x0: 0, y0: 0, x1: 4, y1: 1 } : { x0: 0, y0: 0, x1: 1, y1: 4 };
    expect(glyphDiagramPointCell(box, direction)).toEqual(expected);
  });

  it("keep their glyph when the snake lays a left-to-right graph out in rows", async () => {
    // Mutation: give a point one column in the snake's sizes -> its arrowheads overwrite the glyph.
    const source = "stateDiagram-v2\ndirection LR\n[*] --> Alpha\nAlpha --> Bravo\nBravo --> Charlie\nCharlie --> Delta\nDelta --> Echo\nEcho --> [*]";
    const r = await renderGlyphDiagram(source, { target: "chat", width: 44, height: 20, autoDirection: false, overflow: "paginate" });
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    expect(r.report.unroutable).toEqual([]);
    expect(r.pages).toHaveLength(1);
    expect(r.text.split("●").length - 1).toBe(1);
    expect(r.text.split("◉").length - 1).toBe(1);
  });

  it.each(["LR", "BT", "RL"] as const)("keep the glyph visible and the edges routed in a %s graph", async (direction) => {
    const r = await renderGlyphDiagram(fan(direction, 2, 2), options);
    expect(r.report.unroutable).toEqual([]);
    expect(r.text.split("●").length - 1).toBe(1);
    expect(r.text.split("◉").length - 1).toBe(1);
  });
});

describe("point labels", () => {
  it("show only their first character, so a longer label cannot spill past the one cell", async () => {
    // Mutation: keep the whole first line in measureGlyphGraph -> the node's single cell carries "Label".
    const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "p", label: "Label", shape: "point" }], edges: [] }, options);
    const p = node(r, "p");
    expect(p.lines).toEqual(["L"]);
    expect(r.text).toContain("L");
    expect(r.text).not.toContain("Label");
    // The cut is reported, not silent (see nodeKindsAndNesting.test.ts).
    expect(r.report.ledger.map((e) => e.code)).toContain("label-abbreviated");
  });
});

describe("point attachment in every direction", () => {
  // Each direction's expected cells are written out, not derived from the painter: [bar cells along the cross axis, arrowhead, node size].
  const ENTRIES = {
    TB: { bar: ["└", "─", "┼", "─", "┘"], arrow: "▼" }, BT: { bar: ["┌", "─", "┼", "─", "┐"], arrow: "▲" },
    LR: { bar: ["┐", "│", "┼", "│", "┘"], arrow: "▶" }, RL: { bar: ["┌", "│", "┼", "│", "└"], arrow: "◀" },
  } as const;
  const EXITS = {
    TB: ["┌", "─", "●", "─", "┐"], BT: ["└", "─", "●", "─", "┘"], LR: ["┌", "│", "●", "│", "└"], RL: ["┐", "│", "●", "│", "┘"],
  } as const;
  /** The cells of a point's rows or columns across the flow, in reading order, for the row/column at distance `t` from its entry side. */
  const lineAt = (r: Result, id: string, direction: GlyphGraph["direction"], t: number) => {
    const n = node(r, id);
    const across = direction === "TB" || direction === "BT";
    const pos = direction === "TB" ? n.y0 + t : direction === "BT" ? n.y1 - t : direction === "LR" ? n.x0 + t : n.x1 - t;
    const cells: string[] = [];
    if (across) for (let x = n.x0; x <= n.x1; x++) cells.push(cell(r, x, pos)); else for (let y = n.y0; y <= n.y1; y++) cells.push(cell(r, pos, y));
    return cells;
  };

  it.each(["TB", "BT", "LR", "RL"] as const)("%s: three entries meet in a bar, one arrowhead joins the bar to the glyph", async (direction) => {
    // Mutation: draw only the exits' bar (the old behaviour) -> the side entries aim at blank cells.
    // Mutation: zero the junction table for this direction -> literal "undefined" or blanks where the bar must be.
    const r = await renderGlyphDiagram(fan(direction, 1, 3), options);
    expect(r.text).not.toContain("undefined");
    expect(lineAt(r, "e", direction, 0)).toEqual(ENTRIES[direction].bar);
    const arrow = lineAt(r, "e", direction, 1), glyph = lineAt(r, "e", direction, 2);
    expect(arrow.filter((c) => c !== " ")).toEqual([ENTRIES[direction].arrow]);
    expect(glyph.filter((c) => c !== " ")).toEqual(["◉"]);
    // The arrowhead and the glyph sit on the same line through the node's middle.
    expect(arrow.findIndex((c) => c !== " ")).toBe(2);
    expect(glyph.findIndex((c) => c !== " ")).toBe(2);
    expect(r.report.unroutable).toEqual([]);
  });

  it.each(["TB", "BT", "LR", "RL"] as const)("%s: every entry's route ends against a drawn cell of the point", async (direction) => {
    const r = await renderGlyphDiagram(fan(direction, 1, 3), options);
    for (const route of r.routes.filter((x) => x.edge.to === "e")) {
      const port = r.layout.ports.find((p) => p.edgeId === route.edge.id && p.end === "to")!;
      const last = route.cells[route.cells.length - 1]!;
      expect(Math.abs(last.x - port.anchor.x) + Math.abs(last.y - port.anchor.y)).toBe(1);
      expect(cell(r, port.anchor.x, port.anchor.y)).not.toBe(" ");
    }
  });

  it.each(["TB", "BT", "LR", "RL"] as const)("%s: one entry's arrowhead is directly beside the glyph", async (direction) => {
    const r = await renderGlyphDiagram(fan(direction, 1, 1), options);
    const port = r.layout.ports.find((p) => p.nodeId === "e" && p.end === "to")!;
    expect(cell(r, port.anchor.x, port.anchor.y)).toBe(ENTRIES[direction].arrow);
    const glyph = glyphDiagramPointCell(node(r, "e"), direction);
    expect(Math.abs(glyph.x - port.anchor.x) + Math.abs(glyph.y - port.anchor.y)).toBe(1);
    expect(cell(r, glyph.x, glyph.y)).toBe("◉");
  });

  it.each(["TB", "BT", "LR", "RL"] as const)("%s: three exits leave through a bar through the glyph", async (direction) => {
    const r = await renderGlyphDiagram(fan(direction, 3, 1), options);
    expect(lineAt(r, "s", direction, 0)).toEqual(EXITS[direction]);
    expect(r.text).not.toContain("undefined");
  });

  it("draws a left-to-right fan-in so every arrow leads to the glyph", async () => {
    const r = await renderGlyphDiagram({ direction: "LR", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "e", label: "◉", shape: "point" }], edges: [{ from: "a", to: "e" }, { from: "b", to: "e" }] }, options);
    const e = node(r, "e");
    expect(e.x1 - e.x0 + 1).toBe(3);
    expect(lineAt(r, "e", "LR", 0)).toEqual(["┐", "├", "┘"]);
    expect(cell(r, e.x0 + 1, e.y0 + 1)).toBe("▶");
    expect(cell(r, e.x0 + 2, e.y0 + 1)).toBe("◉");
  });

  it("keeps entries into a state diagram's end marker in every direction", async () => {
    for (const direction of ["LR", "RL", "TB", "BT"] as const) {
      const r = await renderGlyphDiagram(`stateDiagram-v2\ndirection ${direction}\n[*] --> A\nA --> B\nA --> C\nB --> [*]\nC --> [*]\nA --> [*]`, { ...options, width: 72, height: 60 });
      const end = r.layout.nodes.find((n) => n.kind === "state-end")!;
      const glyph = glyphDiagramPointCell(end, direction);
      expect(cell(r, glyph.x, glyph.y)).toBe("◉");
      const inward = { TB: [0, 1], BT: [0, -1], LR: [1, 0], RL: [-1, 0] }[direction];
      expect(cell(r, glyph.x - inward[0]!, glyph.y - inward[1]!)).toBe(ENTRIES[direction].arrow);
      expect(r.report.unroutable).toEqual([]);
    }
  });

  it("keeps a point's glyph and arrowheads in the snake, one arrowhead for each edge", async () => {
    // Mutation: let the snake assign a north port to a point -> the route enters beside the glyph, not into it.
    const source = "stateDiagram-v2\ndirection LR\n[*] --> Alpha\nAlpha --> Bravo\nBravo --> Charlie\nCharlie --> Delta\nDelta --> Echo\nEcho --> [*]\nEcho --> Foxtrot\nFoxtrot --> [*]";
    const r = await renderGlyphDiagram(source, { target: "chat", width: 40, height: 20, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    expect(r.report.unroutable).toEqual([]);
    const end = r.layout.nodes.find((n) => n.kind === "state-end")!;
    const glyph = glyphDiagramPointCell(end, "LR");
    expect(cell(r, glyph.x, glyph.y)).toBe("◉");
    expect(cell(r, glyph.x - 1, glyph.y)).toBe("▶");
    // Two edges enter it, each through a bar cell of its own.
    const entries = r.layout.ports.filter((p) => p.nodeId === end.id && p.end === "to");
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((p) => `${p.anchor.x},${p.anchor.y}`)).size).toBe(2);
    for (const p of entries) expect(cell(r, p.anchor.x, p.anchor.y)).not.toBe(" ");
  });

  it("leaves a point on its east side in the snake even when its successor is on the next row", async () => {
    // Mutation: choose a point's exit side by where the successor sits -> the exit is on the south side, away from the bar.
    const r = await renderGlyphDiagram("stateDiagram-v2\ndirection LR\n[*] --> Alpha\nAlpha --> Bravo\nBravo --> Charlie\nCharlie --> [*]", { target: "chat", width: 14, height: 30, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    const start = r.layout.nodes.find((n) => n.kind === "state-start")!;
    expect(r.layout.ports.filter((p) => p.nodeId === start.id && p.end === "from").map((p) => p.side)).toEqual(["e"]);
    expect(cell(r, start.x1, start.y0)).toBe("●");
    expect(cell(r, start.x1 + 1, start.y0)).not.toBe(" ");
  });

  it("opens a row of the snake with a point whose entry lane fits, and the arrowhead meets the glyph", async () => {
    // A 24x30 canvas. Mutation: drop the lead columns of a point that starts a row -> its west entry lane runs off the canvas and the snake gives up for panels.
    const source = "stateDiagram-v2\ndirection LR\n[*] --> Alpha\nAlpha --> Bravo\nBravo --> Charlie\nCharlie --> Delta\nDelta --> Echo\nEcho --> [*]";
    const r = await renderGlyphDiagram(source, { target: "chat", width: 24, height: 30, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(r.pages).toHaveLength(1);
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    expect(r.report.unroutable).toEqual([]);
    const end = r.layout.nodes.find((n) => n.kind === "state-end")!;
    const glyph = glyphDiagramPointCell(end, "LR");
    expect(cell(r, glyph.x, glyph.y)).toBe("◉");
    expect(cell(r, glyph.x - 1, glyph.y)).toBe("▶");
    expect(r.layout.ports.find((p) => p.nodeId === end.id && p.end === "to")!.side).toBe("w");
  });
});

describe("every point in the state fixtures is joined to its edges by drawn cells", () => {
  const ARROW = { TB: "▼", BT: "▲", LR: "▶", RL: "◀" } as const;
  const INWARD = { TB: [0, 1], BT: [0, -1], LR: [1, 0], RL: [-1, 0] } as const;
  it.each(["state-order", "state-composite", "state-choice"])("%s, in all four directions, boxed and ascii", async (name) => {
    // Mutation: zero a direction's junction row -> blanks or "undefined" where a bar belongs.
    const source = readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");
    for (const direction of ["TB", "BT", "LR", "RL"] as const) for (const charset of ["box", "ascii"] as const) {
      const r = await renderGlyphDiagram(source.replace(/^\s*direction .*$/m, "").replace("stateDiagram-v2", `stateDiagram-v2\ndirection ${direction}`), { target: "chat", width: 80, height: 60, overflow: "expand", autoDirection: false, detail: "faithful", charset });
      expect(r.text).not.toContain("undefined");
      expect(r.report.unroutable).toEqual([]);
      for (const point of r.layout.nodes.filter((n) => n.shape === "point")) {
        const glyph = glyphDiagramPointCell(point, direction);
        expect(cell(r, glyph.x, glyph.y)).toBe(point.lines[0]);
        const entries = r.layout.ports.filter((p) => p.nodeId === point.id && p.end === "to");
        // Every entry's anchor is a drawn cell, and the cell in front of the glyph is an arrowhead (ascii draws the same glyphs for arrows).
        for (const p of entries) expect(cell(r, p.anchor.x, p.anchor.y)).not.toBe(" ");
        if (entries.length > 0) {
          const [dx, dy] = INWARD[direction];
          expect(cell(r, glyph.x - dx, glyph.y - dy)).toBe(charset === "box" ? ARROW[direction] : { TB: "v", BT: "^", LR: ">", RL: "<" }[direction]);
        }
      }
    }
  });
});

describe("a point is joined to its edges whatever their style, at either end", () => {
  const styles = ["solid", "dotted", "thick", "undirected"] as const;
  const directions = ["TB", "BT", "LR", "RL"] as const;
  const RUN = { TB: "│", BT: "│", LR: "─", RL: "─" } as const;
  const ARROWS = { TB: "▼", BT: "▲", LR: "▶", RL: "◀" } as const;
  const graph = (direction: GlyphGraph["direction"], style: (typeof styles)[number], sources: number, targets: number): GlyphGraph => ({
    direction,
    nodes: [
      { id: "p", label: "*", shape: "point" },
      ...Array.from({ length: sources }, (_, i) => ({ id: `s${i}`, label: `S${i}` })),
      ...Array.from({ length: targets }, (_, i) => ({ id: `t${i}`, label: `T${i}` })),
    ],
    edges: [...Array.from({ length: sources }, (_, i) => ({ from: `s${i}`, to: "p", style })), ...Array.from({ length: targets }, (_, i) => ({ from: "p", to: `t${i}`, style }))],
  });
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

  it.each(styles.flatMap((style) => directions.map((direction) => [style, direction] as const)))("%s, %s: one edge into a point reaches the glyph through a drawn cell", async (style, direction) => {
    // Mutation: skip the undirected branch of the arrowhead pass -> the point's reserved cell is blank and the line stops short of it.
    const r = await renderGlyphDiagram(graph(direction, style, 1, 0), options);
    const p = node(r, "p"), glyph = glyphDiagramPointCell(p, direction), port = r.layout.ports.find((q) => q.nodeId === "p" && q.end === "to")!;
    expect(cell(r, glyph.x, glyph.y)).toBe("*");
    expect(near(port.anchor, glyph)).toBe(true);
    expect(cell(r, port.anchor.x, port.anchor.y)).toBe(style === "undirected" ? RUN[direction] : ARROWS[direction]);
    const route = r.routes[0]!;
    expect(near(route.cells[route.cells.length - 1]!, port.anchor)).toBe(true);
  });

  it.each(styles.flatMap((style) => directions.map((direction) => [style, direction] as const)))("%s, %s: several edges into a point meet in a bar that leads to the glyph", async (style, direction) => {
    const r = await renderGlyphDiagram(graph(direction, style, 3, 0), options);
    const p = node(r, "p"), glyph = glyphDiagramPointCell(p, direction);
    const [dx, dy] = { TB: [0, 1], BT: [0, -1], LR: [1, 0], RL: [-1, 0] }[direction];
    expect(cell(r, glyph.x - dx, glyph.y - dy)).toBe(style === "undirected" ? RUN[direction] : ARROWS[direction]);
    for (const port of r.layout.ports.filter((q) => q.nodeId === "p" && q.end === "to")) expect(cell(r, port.anchor.x, port.anchor.y)).not.toBe(" ");
    expect(r.text).not.toContain("undefined");
  });

  it.each(styles.flatMap((style) => directions.map((direction) => [style, direction] as const)))("%s, %s: edges out of a point leave from a drawn cell next to their first route cell", async (style, direction) => {
    for (const exits of [1, 3]) {
      const r = await renderGlyphDiagram(graph(direction, style, 0, exits), options);
      for (const port of r.layout.ports.filter((q) => q.nodeId === "p" && q.end === "from")) {
        expect(cell(r, port.anchor.x, port.anchor.y)).not.toBe(" ");
        const route = r.routes.find((x) => x.edge.id === port.edgeId)!;
        expect(near(route.cells[0]!, port.anchor)).toBe(true);
      }
      expect(r.report.unroutable).toEqual([]);
    }
  });

  it("joins a point to a point by the same rules, undirected or not", async () => {
    for (const style of styles) for (const direction of directions) {
      const r = await renderGlyphDiagram({ direction, nodes: [{ id: "a", label: "a", shape: "point" }, { id: "b", label: "b", shape: "point" }], edges: [{ from: "a", to: "b", style }] }, options);
      const port = r.layout.ports.find((q) => q.nodeId === "b" && q.end === "to")!;
      expect(cell(r, port.anchor.x, port.anchor.y)).not.toBe(" ");
      expect(cell(r, glyphDiagramPointCell(node(r, "a"), direction).x, glyphDiagramPointCell(node(r, "a"), direction).y)).toBe("a");
    }
  });
});
