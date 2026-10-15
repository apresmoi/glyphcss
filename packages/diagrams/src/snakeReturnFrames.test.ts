import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { glyphDiagramSnakeLayout } from "./snake";
import { measureGlyphGraph } from "./pipeline";
import { glyphDiagramLoopGeometry } from "./loop";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { glyphDiagramHasRoutingClearance } from "./route";
import { computeGlyphDiagramQuality } from "./quality";

const examples = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/snake-returns.json"), "utf8")) as { id: string; source: string }[];
const captures: string[] = [], html: string[] = [];
const cases = examples.flatMap(example => [{ ...example, height: 30 }, ...(example.id === "order-branches" ? [{ ...example, height: 24 }] : [])]);

it.each(cases)("clears branched and south-loop return frames: $id at $height rows", async example => {
  captures.push(`EXAMPLE ${example.id}\nSOURCE\n${example.source}\n`);
  for (const target of ["chat", "web"] as const) {
    const options = { target, width: 72, height: example.height, autoDirection: true, detail: "faithful", ...(example.height === 24 ? { overflow: "expand" as const } : {}) } as const;
    const result = await renderGlyphDiagram(example.source, options);
    expect(result.canvas.tier).toBe(target === "chat" ? "box" : "braille");
    expect(result.text.split("\n").every(row => [...row].length === 72)).toBe(true);
    expect(result.canvas.rows).toBe(example.height === 24 ? 25 : 30);
    const quality = computeGlyphDiagramQuality(result, options);
    expect(quality).toMatchObject({
      wordCuts: 0, fakeFrames: 0, crossings: 0, droppedEdges: 0, droppedLabels: 0, pages: 1,
    });
    expect(glyphDiagramHasRoutingClearance(result.layout)).toBe(true);
    expect(result.report.ledger.filter(entry => ["word-cut", "label-dropped", "label-abbreviated", "route-conflict", "render-work-limited"].includes(entry.code))).toEqual([]);
    const source = glyphGraphFromMermaid(example.source);
    for (const node of source.nodes) for (const line of node.label.split("\n")) expect(result.text, node.label).toContain(line);
    for (const edge of result.meta.edges.filter(edge => edge.label)) {
      const rows = result.labels.filter(label => label.id === `edge:${edge.id}` || label.id.startsWith(`edge-row:[${JSON.stringify(edge.id)},`));
      expect(rows.map(row => row.text).join(" ")).toBe(edge.label);
    }
    if (example.id.startsWith("order-")) {
      const node = (id: string) => result.layout.nodes.find(node => node.id === id)!;
      expect(node("backorder").y1).toBeLessThan(node("stock").y0);
      expect(node("charge").x0).toBeGreaterThan(node("ship").x1);
      expect(node("retry").y0).toBeGreaterThan(node("charge").y1);
      for (const [from, to] of [["stock", "charge"], ["pack", "ship"], ["ship", "done"]]) {
        const route = result.routes.find(route => route.edge.from === from && route.edge.to === to)!;
        expect(quality.edges.find(edge => edge.edgeId === route.edge.id)!.bends, `${from}→${to}`).toBe(0);
        if (node(to!).y0 > node(from!).y1) {
          const ports = result.layout.ports.filter(port => port.edgeId === route.edge.id);
          expect(ports[0]!.anchor.x, `${from}→${to} aligned ports`).toBe(ports[1]!.anchor.x);
          expect(new Set(route.cells.map(cell => cell.x)).size).toBe(1);
        }
      }
      if (example.height === 24) expect(result.report.ledger.find(entry => entry.code === "layout-expanded")?.detail).toMatchObject({ requestedHeight: 24, canvasHeight: 25 });
      if (example.id !== "order-opening-branch-loop") {
        const branch = result.routes.find(route => route.edge.from === "stock" && route.edge.to === "backorder")!;
        expect(new Set(branch.cells.map(cell => cell.x)).size).toBe(1);
      }
    }
    captures.push(`${target.toUpperCase()} requested 72x${example.height}, actual 72x${result.canvas.rows} / ${result.canvas.tier}\n${result.text}\nQUALITY ${JSON.stringify(quality)}\nLEDGER ${JSON.stringify(result.report.ledger)}\n`);
    html.push(`<h2>${example.id} / ${target} / ${example.height} rows</h2><pre>${target === "web" ? result.html : result.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`);
  }
  if (process.env.GLYPH_G2_ARTIFACT_DIR) {
    writeFileSync(resolve(process.env.GLYPH_G2_ARTIFACT_DIR, "g2-examples.txt"), captures.join("\n"));
    writeFileSync(resolve(process.env.GLYPH_G2_ARTIFACT_DIR, "g2-web.html"), `<!doctype html><meta charset="utf-8"><style>body{background:#141820;color:#e5e7eb}pre{font:14px/1.2 monospace;white-space:pre;width:72ch}h2{font:16px sans-serif}</style>${html.join("\n")}`);
  }
});

it("repacks a reflected south-loop overhang before assigning ports", () => {
  const graph = glyphGraphFromMermaid(examples.find(example => example.id === "reflected-loop-overhang")!.source);
  const measured = measureGlyphGraph(graph, { direction: "LR", labelWidth: 24 });
  const layout = glyphDiagramSnakeLayout(measured, { width: 72, gap: 4, margin: 1, branchGap: 3, rowGap: 6, reverseRows: true })!;
  expect(layout).toBeDefined();
  const loop = glyphDiagramLoopGeometry(layout)[0]!;
  const tall = layout.nodes.find(node => node.id === "D")!;
  expect(tall.y1).toBeGreaterThanOrEqual(loop.label!.y0);
  expect(tall.x0).toBeGreaterThan(loop.label!.x1 + 1);
  expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
});

it("reserves an upper branch's south-loop depth even at branch gap one", () => {
  const graph = glyphGraphFromMermaid(examples.find(example => example.id === "order-opening-branch-loop")!.source);
  const layout = glyphDiagramSnakeLayout(measureGlyphGraph(graph, { direction: "LR", labelWidth: 24 }),
    { width: 72, gap: 4, margin: 1, branchGap: 1, rowGap: 6, reverseRows: true })!;
  expect(layout).toBeDefined();
  const loop = glyphDiagramLoopGeometry(layout)[0]!;
  const stock = layout.nodes.find(node => node.id === "stock")!;
  expect(stock.y0).toBeGreaterThan(loop.bounds.y1 + 1);
  expect(glyphDiagramHasRoutingClearance(layout)).toBe(true);
});
