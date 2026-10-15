import { expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { renderGlyphDiagram } from "./render";

const examples = JSON.parse(readFileSync(join(process.cwd(), "fixtures/mermaid-task3.json"), "utf8")) as { name: string; source: string; labels: string[]; rowOrder?: string[][]; laneOrder?: string[][] }[];
it("renders every task 3 example verbatim at 72 columns for both real target defaults", async () => {
  const captures: string[] = [], html: string[] = [];
  for (const example of examples) {
    captures.push(`EXAMPLE ${example.name}\nSOURCE\n${example.source}\n`);
    for (const target of ["chat", "web"] as const) {
      const result = await renderGlyphDiagram(example.source, { target, width: 72 });
      expect(result.canvas.cols, `${example.name}/${target}`).toBe(72);
      expect(result.pages, `${example.name}/${target}`).toHaveLength(1);
      expect(result.text.split("\n").every(row => [...row].length === 72)).toBe(true);
      for (const label of example.labels) expect(result.text, `${example.name}/${target}: ${label}`).toContain(label);
      const rows = result.text.split("\n");
      for (const siblings of example.rowOrder ?? []) {
        const positions = siblings.map(label => rows.findIndex(row => row.includes(label)));
        expect(positions, `${example.name}/${target}: sibling rows`).toEqual([...positions].sort((a, b) => a - b));
        expect(new Set(positions).size).toBe(siblings.length);
      }
      const columns = (example.laneOrder ?? []).map(ids => {
        const positions = ids.map(id => rows.find(row => row.includes(` ${id} `))!.indexOf("*"));
        expect(new Set(positions).size, `${example.name}/${target}: same branch`).toBe(1);
        return positions[0]!;
      });
      expect(columns, `${example.name}/${target}: branch columns`).toEqual([...columns].sort((a, b) => a - b));
      expect(new Set(columns).size).toBe(columns.length);
      expect(result.report.unroutable).toEqual([]);
      expect(result.report.ledger.filter(n => ["word-cut", "label-abbreviated", "route-conflict", "layout-overflow", "unroutable"].includes(n.code)), example.name).toEqual([]);
      captures.push(`${target.toUpperCase()} 72 columns / ${target === "chat" ? "box" : "braille"}\n${result.text}\nLEDGER\n${JSON.stringify(result.report.ledger, null, 2)}\n`);
      // The renderer returns the content of a pre. Preview it with the actual target's HTML encoding.
      html.push(`<h2>${example.name} — ${target}</h2><pre>${target === "web" ? result.html : result.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`);
    }
  }
  if (process.env.GLYPH_T3_CAPTURE) {
    mkdirSync(process.env.GLYPH_T3_CAPTURE, { recursive: true });
    writeFileSync(join(process.env.GLYPH_T3_CAPTURE, "t3.txt"), captures.join("\n"));
    writeFileSync(join(process.env.GLYPH_T3_CAPTURE, "t3-preview.html"), `<!doctype html><meta charset="utf-8"><style>body{background:#141820;color:#e5e7eb;font:14px monospace}pre{font:14px/1 monospace;white-space:pre;border:1px solid #333;width:72ch}h2{font:16px sans-serif}</style>${html.join("\n")}`);
  }
}, 30000);
