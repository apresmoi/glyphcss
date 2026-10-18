import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromJson, glyphDiagramJsonSchema } from "./index";
import { glyphParseMermaid } from "./mermaid";
import { computeGlyphDiagramQuality } from "./quality";

const outlines = {
  cloud: { corners: ["╭", "╮", "╰", "╯"], top: "◠", bottom: "◡", sides: ["│", "│"], label: "Maps" },
  bang: { corners: ["*", "*", "*", "*"], top: "╱╲", bottom: "╲╱", sides: ["│", "│"], label: "Fonts" },
  hexagon: { corners: ["╱", "╲", "╲", "╱"], top: "─", bottom: "─", sides: ["❬", "❭"], label: "Meshes" },
} as const;
const captures: { name: string; text: string; html?: string }[] = [];
const shapes = Object.keys(outlines) as (keyof typeof outlines)[];
const tiers = ["box", "blocks", "braille", "ascii"] as const;

describe.each(shapes)("approved %s outline", shape => {
  it("accepts JSON and schema vocabulary", () => {
    expect(glyphGraphFromJson({ nodes: [{ id: "n", label: "Node", shape }], edges: [] }).nodes[0]!.shape).toBe(shape);
    expect(JSON.stringify(glyphDiagramJsonSchema())).toContain(`"${shape}"`);
  });
  it.each(tiers)("preserves exact standalone rules and repeated sides in %s", async charset => {
    const expected = outlines[shape];
    const result = await renderGlyphDiagram({ direction: "LR", nodes: [{ id: "n", label: `${expected.label}\nMore\nRows`, shape }], edges: [] }, { target: "web", charset, width: 72, height: 16 });
    const n = result.layout.nodes[0]!;
    const at = (x: number, y: number) => result.canvas.grid.char[y * result.canvas.cols + x];
    const ascii = charset === "ascii";
    const corners = ascii ? shape === "cloud" ? ["(", ")", "(", ")"] : shape === "bang" ? ["*", "*", "*", "*"] : ["/", "\\", "\\", "/"] : expected.corners;
    const top = ascii ? shape === "bang" ? "/\\" : "-" : expected.top;
    const bottom = ascii ? shape === "bang" ? "\\/" : "-" : expected.bottom;
    const sides = ascii ? shape === "hexagon" ? ["<", ">"] : ["|", "|"] : expected.sides;
    expect([at(n.x0, n.y0), at(n.x1, n.y0), at(n.x0, n.y1), at(n.x1, n.y1)]).toEqual(corners);
    for (let x = n.x0 + 1; x < n.x1; x++) {
      expect(at(x, n.y0)).toBe(top[(x - n.x0 - 1) % top.length]);
      expect(at(x, n.y1)).toBe(bottom[(x - n.x0 - 1) % bottom.length]);
    }
    expect(n.height).toBe(5);
    for (let y = n.y0 + 1; y < n.y1; y++) expect([at(n.x0, y), at(n.x1, y)]).toEqual(sides);
    expect(result.report.unsupportedGlyphs).toEqual([]);
    captures.push({ name: `${shape}/tall/web/${charset}/72x16`, text: result.text, html: result.html });
  });
  it.each(["LR", "RL", "TB", "BT"] as const)("attaches incoming/outgoing edges on interior side rows in %s", async direction => {
    for (const charset of tiers) {
      const result = await renderGlyphDiagram({ direction, nodes: [{ id: "a", label: "In" }, { id: "n", label: outlines[shape].label, shape }, { id: "b", label: "Out" }], edges: [{ from: "a", to: "n" }, { from: "n", to: "b" }] }, { target: "web", charset, width: 72, height: 24 });
      const n = result.layout.nodes.find(n => n.id === "n")!;
      const ports = result.layout.ports.filter(p => p.nodeId === "n");
      expect(ports).toHaveLength(2);
      for (const p of ports) { expect(["e", "w"]).toContain(p.side); expect(p.anchor.y).toBeGreaterThan(n.y0); expect(p.anchor.y).toBeLessThan(n.y1); }
      expect(result.report.unroutable).toEqual([]);
      expect(computeGlyphDiagramQuality(result, { width: 72, height: 24 })).toMatchObject({ crossings: 0, fakeFrames: 0, wordCuts: 0, droppedEdges: 0 });
      captures.push({ name: `${shape}/edges/${direction}/web/${charset}/72x24`, text: result.text, html: result.html });
    }
  });
  it("keeps self-loop ports separate from flow ports", async () => {
    for (const direction of ["LR", "TB"] as const) {
      const result = await renderGlyphDiagram({ direction, nodes: [{ id: "a", label: "In" }, { id: "n", label: outlines[shape].label, shape }, { id: "b", label: "Out" }], edges: [{ from: "a", to: "n" }, { from: "n", to: "b" }, { from: "n", to: "n", label: "retry" }] }, { target: "web", width: 72, height: 24 });
      const ports = result.layout.ports.filter(p => p.nodeId === "n");
      expect(ports).toHaveLength(4);
      expect(new Set(ports.map(p => `${p.anchor.x},${p.anchor.y}`)).size).toBe(4);
      expect(ports.every(p => p.side === "e" || p.side === "w")).toBe(true);
      expect(result.report.unroutable).toEqual([]);
      expect(result.text).toContain("retry");
      captures.push({ name: `${shape}/loop/${direction}/web/default/72x24`, text: result.text, html: result.html });
    }
  });
  it.each(["chat", "web"] as const)("renders its three-row example alone and connected with %s defaults", async target => {
    for (const connected of [false, true]) {
      const result = await renderGlyphDiagram({ direction: "LR", nodes: [{ id: "n", label: outlines[shape].label, shape }, ...(connected ? [{ id: "in", label: "In" }, { id: "out", label: "Out" }] : [])], edges: connected ? [{ from: "in", to: "n" }, { from: "n", to: "out" }] : [] }, { target, width: 72, height: 24 });
      expect(result.layout.nodes.find(n => n.id === "n")!.height).toBe(3);
      expect(result.canvas.cols).toBe(72);
      expect(result.report.unroutable).toEqual([]);
      captures.push({ name: `${shape}/${connected ? "connected" : "alone"}/${target}/default/72x24`, text: result.text, html: result.html });
    }
  });
});
it.each([[')Maps(', 'cloud'], ['))Fonts((', 'bang'], ['{{Meshes}}', 'hexagon']] as const)("keeps mindmap %s without a shape-degradation note", (syntax, shape) => {
  const parsed = glyphParseMermaid(`mindmap\n  n${syntax}`);
  expect(parsed.graph.nodes[0]!.shape).toBe(shape);
  expect(parsed.notes.map(n => n.detail?.kind)).toEqual(["mindmap-layout"]);
});
it.each(["cloud", "bang", "hex", "hexagon", "prepare"])("keeps flowchart %s without degradation", shape => {
  const parsed = glyphParseMermaid(`flowchart LR; n@{shape: ${shape}, label: "Node"}`);
  expect(parsed.graph.nodes[0]!.shape).toBe(shape === "hex" || shape === "prepare" ? "hexagon" : shape);
  expect(parsed.notes).toEqual([]);
});
afterAll(() => {
  if (!process.env.GLYPH_SHAPES_CAPTURE) return;
  writeFileSync(process.env.GLYPH_SHAPES_CAPTURE, captures.map(c => `${c.name}\n${c.text}\n`).join("\n"));
  writeFileSync(`${process.env.GLYPH_SHAPES_CAPTURE}.json`, JSON.stringify(captures));
});
