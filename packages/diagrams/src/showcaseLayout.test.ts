import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderGlyphDiagram } from "./render";
import { renderGlyphSequence } from "./sequence/render";
import { computeGlyphDiagramQuality } from "./quality";
import type { GlyphDiagramResult, GlyphDiagramRenderOptions } from "./renderTypes";

interface Example { type: string; owner: string; source: string; height: number; labels: string[] }
const presets = (JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as Example[]).filter(p => p.owner === "diagrams");
const trials = JSON.parse(readFileSync("fixtures/layout-trials.json", "utf8")) as { name: string; source: string }[];
const captures: { type: string; source: string; target: string; text: string; html?: string; quality?: ReturnType<typeof computeGlyphDiagramQuality>; ledger: unknown }[] = [];
const clean = { wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1 };

describe.each([
  { target: "chat" as const, width: 72 },
  { target: "web" as const, width: 72 },
  { target: "web" as const, width: 96 },
])("showcase layout $target/$width", ({ target, width }) => {
  it.each(presets)("renders the complete $type source (class remains an acceptance impasse)", async preset => {
    const options = { target, width, height: width === 96 ? 32 : preset.height, nodesep: 4, ranksep: 4,
      autoDirection: true, overflow: target === "web" ? "expand" : "paginate" } as const;
    const sequence = preset.type === "sequenceDiagram";
    const result = sequence ? await renderGlyphSequence(preset.source, options) : await renderGlyphDiagram(preset.source, options);
    const quality = !sequence && preset.type !== "gitGraph" ? computeGlyphDiagramQuality(result as GlyphDiagramResult, options) : undefined;
    captures.push({ type: preset.type, source: preset.source, target: `${target}/${width}x${options.height}`, text: result.text, html: result.html, quality, ledger: result.report.ledger });
    expect(result.canvas.cols).toBe(width);
    if (!sequence) expect((result as GlyphDiagramResult).report.unroutable).toEqual([]);
    if (preset.type === "classDiagram") {
      // This checks retention, not acceptance: the website's existing zero-defect
      // assertions remain red and the capture records every unresolved loss.
      expect((result as GlyphDiagramResult).meta.nodes).toHaveLength(6);
      expect((result as GlyphDiagramResult).pages.flatMap(page => page.routes)).toHaveLength(8);
      expect(quality!.fakeFrames).toBeLessThanOrEqual(1);
      return;
    }
    for (const label of preset.labels) for (const word of label.split(/\s+/)) expect(result.text).toContain(word);
    if (quality) expect(quality).toMatchObject(clean);
  });
});

describe.each(["chat", "web"] as const)("skill trial %s", target => {
  const options = { target, width: 72, height: 24, autoDirection: true, overflow: "expand" } as const;
  it("stacks all three C4 elements with both captions inside 72x24", async () => {
    const source = trials.find(trial => trial.name === "c4")!.source;
    const result = await renderGlyphDiagram(source, options);
    expect(result.canvas.cols).toBe(72);
    expect(result.canvas.rows).toBe(24);
    expect(result.layout.direction).toBe("TB");
    expect(computeGlyphDiagramQuality(result, options)).toMatchObject(clean);
    for (const text of ["Buyer", "Shop", "Card processor", "Places orders", "Web storefront", "Charges cards", "Orders via", "Charges with"]) expect(result.text).toContain(text);
    captures.push({ type: "skill-c4", source, target: `${target}/72x24`, text: result.text, html: result.html, quality: computeGlyphDiagramQuality(result, options), ledger: result.report.ledger });
  });
  it("gives the association its own port", async () => {
    const source = trials.find(trial => trial.name === "class")!.source;
    const result = await renderGlyphDiagram(source, options);
    const composition = result.layout.edges.find(edge => edge.startHead === "filled-diamond")!;
    const association = result.layout.edges.find(edge => edge.from === "Order" && edge.to === "Payment")!;
    const port = (id: string) => result.layout.ports.find(port => port.edgeId === id && port.end === "from")!;
    expect(port(composition.id).anchor).not.toEqual(port(association.id).anchor);
    const marker = port(composition.id).anchor;
    expect(result.canvas.grid.char[marker.y * result.canvas.cols + marker.x]).toBe("◆");
    expect(result.canvas.cols).toBe(72);
    expect(computeGlyphDiagramQuality(result, options)).toMatchObject(clean);
    captures.push({ type: "skill-class", source, target: `${target}/72x24`, text: result.text, html: result.html, quality: computeGlyphDiagramQuality(result, options), ledger: result.report.ledger });
  });
  it("lands every relation on a target side", async () => {
    const source = trials.find(trial => trial.name === "class")!.source;
    const result = await renderGlyphDiagram(source, options);
    expect(result.routes).toHaveLength(3);
    for (const route of result.routes) {
      const port = result.layout.ports.find(port => port.edgeId === route.edge.id && port.end === "to")!;
      const node = result.layout.nodes.find(node => node.id === port.nodeId)!;
      const horizontal = port.side === "n" || port.side === "s";
      expect(port.offset).toBeGreaterThan(0);
      expect(port.offset).toBeLessThan((horizontal ? node.width : node.height) - 1);
      expect(horizontal ? port.anchor.y : port.anchor.x).toBe(port.side === "n" ? node.y0 : port.side === "s" ? node.y1 : port.side === "w" ? node.x0 : node.x1);
      expect(route.cells.at(-1)).toEqual(port.escape);
    }
  });
});

it("keeps explicit C4 direction authoritative", async () => {
  const source = trials.find(trial => trial.name === "c4")!.source;
  const options: GlyphDiagramRenderOptions = { target: "chat", width: 72, height: 24, autoDirection: false, direction: "LR", overflow: "expand" };
  const result = await renderGlyphDiagram(source, options);
  expect(result.layout.direction).toBe("LR");
});

afterAll(() => {
  const path = process.env.GLYPH_LAYOUT_CAPTURE;
  if (!path) return;
  const stem = path.replace(/\.txt$/, "");
  writeFileSync(path, captures.map(c => `${c.type} · ${c.target} · actual ${[...c.text.split("\n")[0]!].length} columns\nSOURCE\n${c.source}\nRENDER\n${c.text}\n`).join("\n"));
  writeFileSync(`${stem}-ledger.json`, JSON.stringify(captures.map(({ text: _text, html: _html, ...capture }) => capture), null, 2));
  copyFileSync("../../website/public/fonts/glyph-mono.woff2", `${dirname(path)}/glyph-mono.woff2`);
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  writeFileSync(`${stem}.html`, `<!doctype html><meta charset="utf-8"><title>Diagram layout trials</title><style>@font-face{font-family:Glyph;src:url('./glyph-mono.woff2')}body{background:#0c1017;color:#cbd5e1;font:13px monospace}pre{font:13px/1 Glyph,monospace;white-space:pre}.chat pre{font-family:ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace}</style>${captures.map(c => `<article class="${c.target.startsWith("chat") ? "chat" : "web"}"><h2>${escape(c.type)} · ${c.target}</h2><pre>${c.target.startsWith("web") ? c.html : escape(c.text)}</pre></article>`).join("")}`);
});
