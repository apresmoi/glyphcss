import { expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { glyphDiagramGroupRects } from "./pipeline";
import { computeGlyphDiagramQuality } from "./quality";

const examples = JSON.parse(readFileSync(join(process.cwd(), "fixtures/mermaid-task5.json"), "utf8")) as { name: string; source: string; labels: string[]; options?: { title: string } }[];
it("renders every task 5 example verbatim at 72 columns using both target defaults", async () => {
  const captures: string[] = [], html: string[] = [], summaries: unknown[] = [];
  for (const example of examples) {
    captures.push(`EXAMPLE ${example.name}\nSOURCE\n${example.source}\n`);
    for (const target of ["chat", "web"] as const) {
      const result = await renderGlyphDiagram(example.source, { target, width: 72, ...example.options });
      expect(result.canvas.cols, `${example.name}/${target}`).toBe(72);
      expect(result.text.split("\n").filter(row => row.length).every(row => [...row].length === 72), example.name).toBe(true);
      for (const label of example.labels) expect(result.text, `${example.name}/${target}: ${label}`).toContain(label);
      const node = (id: string) => result.layout.nodes.find(n => n.id === id)!;
      if (example.name === "block-grid-spans-spaces") {
        const gap = node("c").x0 - node("b").x1 - 1;
        expect(node("a").width).toBe(2 * node("b").width + gap);
        expect(node("c").width).toBe(node("a").width);
      }
      if (example.name.startsWith("block-nested")) {
        const frames = glyphDiagramGroupRects(result.layout, { cols: 72, rows: result.canvas.rows });
        const outer = frames.get(example.name === "block-nested" ? "Group" : "Outer")!;
        const [left, right] = example.name === "block-nested" ? ["c", "d"] : ["e", "f"];
        expect([outer.x0, outer.x1]).toEqual([node(left!).x0, node(right!).x1]);
        expect(node(left!).y0).toBe(outer.y1 + 2);
        if (example.name !== "block-nested") {
          const inner = frames.get("Inner")!;
          const last = example.name === "block-nested-local-columns" ? "g" : "d";
          expect([inner.x0, inner.x1]).toEqual([node("c").x0, node(last).x1]);
          expect(node("c").y0).toBe(inner.y1 + 2);
          expect(inner.x0 - outer.x0).toBeGreaterThanOrEqual(2);
          expect(outer.x1 - inner.x1).toBeGreaterThanOrEqual(2);
          expect(inner.y0 - outer.y0).toBe(2);
          expect(outer.y1 - node("c").y1).toBe(2);
        }
        expect(result.report.ledger).toEqual([]);
      }
      if (example.name.startsWith("block-space-only") || example.name === "block-empty") {
        expect(result.text.trim()).toBe(example.options?.title ?? "");
        expect(result.layout.nodes).toEqual([]);
        expect(result.report.ledger.some(note => note.detail?.kind === "block-empty")).toBe(true);
      }
      const quality = computeGlyphDiagramQuality(result, { width: 72, height: target === "chat" ? 24 : 32 });
      expect([quality.wordCuts, quality.crossings, quality.fakeFrames, quality.droppedEdges, quality.droppedLabels], `${example.name}/${target}: quality`).toEqual([0, 0, 0, 0, 0]);
      expect(result.report.unroutable, `${example.name}/${target}`).toEqual([]);
      expect(result.report.ledger.filter(n => ["word-cut", "label-abbreviated", "label-dropped", "route-conflict", "unroutable", "split-panel-dropped"].includes(n.code)), `${example.name}/${target}`).toEqual([]);
      expect(result.routes.every(route => route.cells.every((p, i, cells) => i === 0 || Math.abs(p.x - cells[i - 1]!.x) + Math.abs(p.y - cells[i - 1]!.y) === 1)), example.name).toBe(true);
      captures.push(`${target.toUpperCase()} 72 columns / ${target === "chat" ? "box" : "braille"}\n${result.text}\nLEDGER\n${JSON.stringify(result.report.ledger, null, 2)}\n`);
      summaries.push({ name: example.name, target, panels: result.pages.length, nodes: result.meta.nodes.length, edges: result.meta.edges.length, notes: result.report.ledger.map(n => n.code + (n.detail?.kind ? `:${n.detail.kind}` : "")) });
      const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html.push(`<h2>${escape(example.name)} — ${target}</h2><pre>${target === "web" ? result.html : escape(result.text)}</pre>`);
      expect((await renderGlyphDiagram(glyphGraphFromMermaid(example.source), { target, width: 72, ...example.options })).text).toBe(result.text);
    }
  }
  if (process.env.GLYPH_T5_CAPTURE) {
    mkdirSync(process.env.GLYPH_T5_CAPTURE, { recursive: true });
    writeFileSync(join(process.env.GLYPH_T5_CAPTURE, "t5.txt"), captures.join("\n"));
    writeFileSync(join(process.env.GLYPH_T5_CAPTURE, "t5-summary.json"), JSON.stringify(summaries, null, 2));
    writeFileSync(join(process.env.GLYPH_T5_CAPTURE, "t5-preview.html"), `<!doctype html><meta charset="utf-8"><style>body{background:#141820;color:#e5e7eb;font:14px monospace}pre{font:14px/1 monospace;white-space:pre;border:1px solid #333;width:72ch}h2{font:16px sans-serif}</style>${html.join("\n")}`);
  }
}, 60000);
