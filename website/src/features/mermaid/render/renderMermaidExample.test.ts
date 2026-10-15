import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { GLYPH_MERMAID_EXAMPLES, renderGlyphMermaidExample } from "./renderMermaidExample";

const previews: { type: string; html: string }[] = [];

const types = ["flowchart", "graph", "stateDiagram", "sequenceDiagram", "classDiagram", "erDiagram", "mindmap", "gitGraph", "block", "architecture", "requirementDiagram", "C4Context", "C4Container", "C4Component", "C4Deployment", "C4Dynamic", "pie", "xychart", "sankey", "quadrantChart", "gantt", "radar", "treemap", "journey", "timeline", "packet", "kanban"];

describe("Mermaid workbench examples", () => {
  it("covers every requested header and stays identical to the CLI examples", async () => {
    expect(GLYPH_MERMAID_EXAMPLES.map(example => example.type)).toEqual(types);
    const cli = JSON.parse(await readFile("../packages/compile/src/fixtures/mermaidIntegration.json", "utf8"));
    expect(GLYPH_MERMAID_EXAMPLES).toEqual(cli);
  });
  it.each(GLYPH_MERMAID_EXAMPLES)("$type paints legibly through its public web entry", async example => {
    const result = await renderGlyphMermaidExample(example);
    expect(typeof result.html).toBe("string");
    expect(result.html!.length).toBeGreaterThan(0);
    previews.push({ type: example.type, html: result.html! });
    expect(result.text.trim()).not.toBe("");
    expect(Math.max(...result.text.split("\n").map(line => [...line].length))).toBeLessThanOrEqual(72);
    for (const label of example.labels) expect(result.text).toContain(label);
    expect(result.report.ledger.some(entry => /unroutable|layout-overflow/.test(entry.code))).toBe(false);
    if ("routes" in result) expect(result.report.unroutable).toEqual([]);
  });
});

afterAll(async () => {
  const path = process.env.GLYPH_MERMAID_WEB_ARTIFACT;
  if (!path) return;
  await mkdir(path, { recursive: true });
  await writeFile(`${path}/glyph-mono.woff2`, await readFile("public/fonts/glyph-mono.woff2"));
  await writeFile(`${path}/t8-web.html`, `<!doctype html><html><meta charset="utf-8"><title>Mermaid integration web previews</title><style>
  @font-face { font-family: Glyph; src: url('./glyph-mono.woff2'); }
  body { margin: 12px; background: #0c1017; color: #cbd5e1; font: 12px monospace; }
  main { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
  article { min-width:0; border:1px solid #334155; padding:8px; }
  pre { font:8px/1 Glyph,monospace; margin:0; white-space:pre; }
  </style><main>${previews.map(preview => `<article><h2>${preview.type}</h2><pre>${preview.html}</pre></article>`).join('')}</main></html>`);
});
