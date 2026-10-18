import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { glyphDiagramCatalogueArt, GLYPH_DIAGRAM_CATALOGUE_SHAPES } from "./catalogueShapes";
import { glyphDiagramJsonSchema, GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS } from "./schema";
import { glyphGraphFromMermaid, glyphMermaidNotes } from "./mermaid";
import { glyphMermaidShape } from "./mermaidShapes";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { measureGlyphGraph } from "./pipeline";
import type { GlyphGraph, GlyphGraphNodeShape } from "./types";

const examples = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/catalogue-shapes.json"), "utf8")) as {
  shape: typeof GLYPH_DIAGRAM_CATALOGUE_SHAPES[number]; drawing: string; ascii: string;
}[];
const labelOf = (drawing: string) => drawing.match(/Docs?|Data|Card|Node|Input|Go|Link|Tape|Disk|Note|User/)?.[0] ?? "";
const cropped = (rows: readonly string[]) => rows.map(row => row.trimEnd()).join("\n");
const graph = (shape: GlyphGraphNodeShape, label: string): GlyphGraph => ({ direction: "LR", nodes: [{ id: "N", label, shape }], edges: [] });
const ajv = new Ajv2020({ strict: false });
GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS.forEach(keyword => ajv.addKeyword(keyword));
const validate = ajv.compile(glyphDiagramJsonSchema());

describe("first kept catalogue shapes", () => {
  it("covers every selected default exactly once", () => {
    expect(examples.map(example => example.shape)).toEqual(GLYPH_DIAGRAM_CATALOGUE_SHAPES);
  });
  for (const example of examples) {
    const { shape } = example, label = labelOf(example.drawing);
    for (const charset of ["box", "blocks", "braille", "ascii"] as const) {
      it(`${shape}/${charset} reproduces the approved art and measures its full footprint`, async () => {
        const expected = charset === "ascii" ? example.ascii : example.drawing;
        const result = await renderGlyphDiagram(graph(shape, label), { target: "chat", charset, width: 72, height: 32 });
        const node = result.layout.nodes[0]!;
        const rows = result.text.split("\n").slice(node.y0, node.y1 + 1).map(row => row.slice(node.x0, node.x1 + 1));
        expect(cropped(rows)).toBe(expected);
        expect(node.width).toBe(Math.max(...expected.split("\n").map(row => row.length)));
        expect(node.height).toBe(expected.split("\n").length);
        expect(result.report.unroutable).toEqual([]);
      });
    }
    it(`${shape} accepts JSON/schema, property syntax and all registered aliases`, () => {
      expect(validate(graph(shape, label))).toBe(true);
      const registry = readFileSync(resolve(__dirname, "mermaidShapes.ts"), "utf8");
      const names = [...registry.matchAll(/\["([^\"]+)", "([^\"]+)", false\]/g)].filter(match => match[1] === shape).flatMap(match => match[2]!.split(" "));
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const source = `flowchart LR; N@{shape: ${name}, label: "Read item"}`;
        expect(glyphMermaidShape(name)).toMatchObject({ shape, fallback: false });
        expect(glyphGraphFromMermaid(source).nodes[0]).toMatchObject({ shape, label: "Read item" });
        expect(glyphMermaidNotes(source)).toEqual([]);
      }
    });
    for (const charset of ["box", "braille", "ascii"] as const) {
      it(`${shape}/${charset} keeps its outline with incoming/outgoing edges in four directions`, async () => {
        for (const direction of ["LR", "RL", "TB", "BT"] as const) {
          const source = `flowchart ${direction}; A[In] --> N@{shape: ${shape}, label: "Read item"} --> Z[Out]`;
          const result = await renderGlyphDiagram(source, { target: charset === "braille" ? "web" : "chat", charset, width: 72, height: 32 });
          expect(result.routes).toHaveLength(2);
          expect(result.report.unroutable).toEqual([]);
          expect(result.report.ledger.filter(item => ["word-cut", "label-dropped", "unroutable", "layout-overflow"].includes(item.code))).toEqual([]);
          const node = result.layout.nodes.find(node => node.id === "N")!;
          const art = glyphDiagramCatalogueArt(shape, node.lines, charset, node.width, node.height);
          expect([art.width, art.height]).toEqual([node.width, node.height]);
          const rows = result.text.split("\n");
          art.rows.forEach((row, y) => [...row].forEach((ch, x) => {
            if (ch !== " ") expect(rows[node.y0 + y]![node.x0 + x]).toBe(ch);
          }));
          for (const port of result.layout.ports.filter(port => port.nodeId === "N")) {
            expect(["e", "w"]).toContain(port.side);
            expect(art.portRows).toContain(port.offset);
          }
        }
      });
    }
    it(`${shape} generalises to empty, long and multiline labels without clipping`, () => {
      for (const label of ["", "x", "A longer label here", "First\nSecond\nThird"]) {
        const measured = measureGlyphGraph(graph(shape, label), { labelWidth: 40 });
        const node = measured.nodes[0]!;
        const art = glyphDiagramCatalogueArt(shape, node.lines, "box", node.width, node.height);
        expect(art.rows).toHaveLength(node.height);
        expect(art.rows.every(row => row.length === node.width)).toBe(true);
        for (const line of node.lines.filter(Boolean)) expect(art.rows.some(row => row.includes(line))).toBe(true);
      }
    });
  }
  it.each(["lin-doc", "win-pane", "sl-rect", "folder"])("keeps the unapproved %s fallback", name => {
    expect(glyphMermaidShape(name).fallback).toBe(true);
    expect(glyphMermaidNotes(`flowchart LR; N@{shape: ${name}}`)).not.toEqual([]);
  });
});

// Distinct head styles prevent shared slots and force footprint growth.
it.each(GLYPH_DIAGRAM_CATALOGUE_SHAPES)("%s reserves separated ports for mixed fans and a self-loop", async shape => {
  for (const label of ["Node", ""]) {
    const input: GlyphGraph = { direction: "LR", nodes: [{ id: "a", label: "In" }, { id: "b", label: "In" }, { id: "n", label, shape }, { id: "z", label: "Out" }], edges: [
      { from: "a", to: "n", endHead: "circle" }, { from: "b", to: "n", endHead: "arrow" }, { from: "n", to: "z" }, { from: "n", to: "n", label: "again" },
    ] };
    const result = await renderGlyphDiagram(input, { target: "chat", charset: "box", width: 72, height: 32 });
    expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(4);
    expect(computeGlyphDiagramQuality(result, { width: 72, height: 32 }).crossings).toBe(0);
    const node = result.layout.nodes.find(node => node.id === "n")!;
    const art = glyphDiagramCatalogueArt(shape, node.lines, "box", node.width, node.height);
    expect([art.width, art.height]).toEqual([node.width, node.height]);
    const rows = result.text.split("\n");
    art.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== " ") expect(rows[node.y0 + y]![node.x0 + x]).toBe(ch); }));
  }
});
