import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { renderGlyphDiagram } from "./render";
import { routeGlyphGraphEdges, glyphDiagramHasRoutingClearance } from "./route";
import type { GlyphDiagramLayout } from "./pipeline";
import type { GlyphGraph, GlyphGraphEdgeHead } from "./types";

const captures: { name: string; input: GlyphGraph; opts: object; text: string }[] = [];
const tiers = ["box", "blocks", "braille", "ascii"] as const;
const heads = ["none", "arrow", "circle", "cross", "triangle", "filled-diamond", "open-diamond", "er-one", "er-zero-one", "er-many", "er-zero-many"] as const;

describe.each(tiers)("hexagon ports / %s", charset => {
  it.each(["LR", "RL", "TB", "BT"] as const)("keeps both sides and places incoming/source heads outside / %s", async direction => {
    for (const head of heads) {
      const input: GlyphGraph = { direction, nodes: [{ id: "a", label: "In" }, { id: "h", label: "Meshes", shape: "hexagon" }, { id: "b", label: "Out" }],
        edges: [{ id: "in", from: "a", to: "h", endHead: head }, { id: "out", from: "h", to: "b", startHead: head }] };
      const opts = { target: "web" as const, charset, width: 72, height: 24 };
      const r = await renderGlyphDiagram(input, opts);
      const node = r.layout.nodes.find(n => n.id === "h")!;
      const at = (x: number, y: number) => r.canvas.grid.char[y * r.canvas.cols + x];
      for (let y = node.y0 + 1; y < node.y1; y++) expect([at(node.x0, y), at(node.x1, y)]).toEqual(charset === "ascii" ? ["<", ">"] : ["❬", "❭"]);
      for (const port of r.layout.ports.filter(p => p.nodeId === "h")) {
        const right = port.side === "e";
        const ascii = charset === "ascii";
        const expected: Record<GlyphGraphEdgeHead, string> = { none: ascii ? "-" : "─", arrow: right ? ascii ? "<" : "◀" : ascii ? ">" : "▶", circle: ascii ? "o" : "●", cross: ascii ? "x" : "✕", triangle: ascii ? "^" : "△", "filled-diamond": ascii ? "*" : "◆", "open-diamond": ascii ? "o" : "◇", "er-one": ascii ? "+" : "┼", "er-zero-one": ascii ? "+" : "┼", "er-many": right ? "<" : ">", "er-zero-many": right ? "<" : ">" };
        expect(port.escape).toEqual({ x: port.anchor.x + (right ? 1 : -1), y: port.anchor.y });
        expect(at(port.escape.x, port.escape.y)).toBe(expected[head]);
        const route = r.routes.find(route => route.edge.id === port.edgeId)!;
        expect(route.cells).toContainEqual(port.escape);
        if (head.startsWith("er-")) expect(at(port.escape.x + (right ? 1 : -1), port.escape.y)).toBe(head.includes("zero") ? ascii ? "o" : "○" : ascii ? "+" : "┼");
      }
      expect(r.report.unroutable).toEqual([]);
      captures.push({ name: `heads/${direction}/${head}/${charset}`, input, opts, text: r.text });
    }
  });
  it("keeps shared fan exits and self-loop entries outside the outline", async () => {
    for (const loop of [false, true]) {
      const input: GlyphGraph = { direction: "LR", nodes: [{ id: "h", label: "Meshes", shape: "hexagon" }, { id: "a", label: "OBJ" }, { id: "b", label: "glTF" }],
        edges: [{ from: "h", to: "a", style: "undirected" }, { from: "h", to: "b", style: "undirected" }, ...(loop ? [{ from: "h", to: "h", label: "retry" }] : [])] };
      const opts = { target: "chat" as const, charset, width: 72, height: 24 };
      const r = await renderGlyphDiagram(input, opts), node = r.layout.nodes.find(n => n.id === "h")!;
      const at = (x: number, y: number) => r.canvas.grid.char[y * r.canvas.cols + x];
      expect(r.layout.ports.some(p => p.nodeId === "h" && p.trunk)).toBe(true);
      for (let y = node.y0 + 1; y < node.y1; y++) expect([at(node.x0, y), at(node.x1, y)]).toEqual(charset === "ascii" ? ["<", ">"] : ["❬", "❭"]);
      if (loop) {
        const port = r.layout.ports.find(p => p.nodeId === "h" && p.end === "to")!;
        expect(at(port.escape.x, port.escape.y)).toBe(charset === "ascii" ? "<" : "◀");
      }
      expect(r.report.unroutable).toEqual([]);
      captures.push({ name: `fan/loop-${loop}/${charset}`, input, opts, text: r.text });
    }
  });
});

// An invisible link still owns its port lane. With transit crossing costs zero,
// no painted route can accidentally act as the reservation under test.
it.each([24, 50000])("reserves the outside head cell against unrelated transit (height %s)", height => {
  const layout: GlyphDiagramLayout = { direction: "LR", width: 30, height, groups: [], loops: [], ledger: [],
    nodes: [{ id: "h", label: "H", shape: "hexagon", lines: ["H"], width: 5, height: 3, x0: 12, x1: 16, y0: 9, y1: 11 }],
    edges: [{ id: "head", from: "left", to: "h", invisible: true }, { id: "transit", from: "top", to: "bottom" }],
    ports: [
      { edgeId: "head", nodeId: "left", end: "from", side: "e", offset: 0, anchor: { x: 1, y: 10 }, escape: { x: 2, y: 10 } },
      { edgeId: "head", nodeId: "h", end: "to", side: "w", offset: 1, anchor: { x: 12, y: 10 }, escape: { x: 11, y: 10 } },
      { edgeId: "transit", nodeId: "top", end: "from", side: "s", offset: 0, anchor: { x: 10, y: 2 }, escape: { x: 10, y: 3 } },
      { edgeId: "transit", nodeId: "bottom", end: "to", side: "n", offset: 0, anchor: { x: 10, y: 18 }, escape: { x: 10, y: 17 } },
    ] };
  expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
  const r = routeGlyphGraphEdges(layout, { crossingCost: 0 });
  expect(r.unroutable).toEqual([]);
  const route = r.routes.find(route => route.edge.id === "transit")!;
  expect(route.cells.length).toBeGreaterThan(15);
  expect(route.cells.every(p => Math.abs(p.x - 11) + Math.abs(p.y - 10) > 1)).toBe(true);
});

afterAll(() => {
  if (process.env.GLYPH_HEXPORT_CAPTURE) writeFileSync(process.env.GLYPH_HEXPORT_CAPTURE, JSON.stringify(captures));
});
