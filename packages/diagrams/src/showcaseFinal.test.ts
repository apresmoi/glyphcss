import { afterAll, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramGraphLabels } from "./graphLabels";
import { glyphDiagramRouteQuality } from "./routeQuality";

const types = ["requirementDiagram", "block", "stateDiagram", "C4Container", "gitGraph"];
const presets = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { type: string; source: string; height: number }[];
const captures: unknown[] = [];
for (const target of ["chat", "web"] as const) for (const preset of presets.filter(p => types.some(type => p.type.startsWith(type)))) {
  it(`${preset.type} ${target} final showcase`, async () => {
    const options = { target, width: target === "chat" ? 72 : 96, height: target === "chat" ? preset.height : 32, nodesep: 4, ranksep: 4, autoDirection: true, overflow: target === "web" ? "expand" : "paginate" } as const;
    const result = await renderGlyphDiagram(preset.source, options);
    const labels = preset.type === "gitGraph" ? undefined : glyphDiagramGraphLabels(result.layout, { routes: result.routes, unroutable: [], ledger: [] }, { ...options, width: result.canvas.cols, height: result.canvas.rows });
    captures.push({ type: preset.type, source: preset.source, target, width: result.canvas.cols, height: result.canvas.rows, text: result.text, html: result.html, layout: result.layout, routes: result.routes, labels, quality: preset.type === "gitGraph" ? undefined : glyphDiagramRouteQuality(result.layout, result.routes), ledger: result.report.ledger });
    expect(result.canvas.cols).toBe(options.width);
    expect(result.report.unroutable).toEqual([]);
    if (preset.type === "gitGraph") {
      expect(result.text).not.toContain("commit-");
      expect(result.meta.nodes.some(node => /^[0-9a-f]{7}$/.test(node.id))).toBe(true);
      const nodeRows = result.text.split("\n").flatMap((row, i) => row.includes("*") ? [i] : []);
      if (target === "web") expect(nodeRows.at(-1)! - nodeRows[0]!).toBe(31);
      else expect(nodeRows.at(-1)! - nodeRows[0]!).toBe(11);
    } else {
      expect(labels!.dropped).toEqual([]);
      expect(glyphDiagramRouteQuality(result.layout, result.routes)).toMatchObject({ crossings: 0, fakeFrames: 0 });
      if (preset.type.startsWith("block")) {
        const route = result.routes.find(route => route.edge.from === "mobile" && route.edge.to === "api")!;
        expect(result.layout.ports.find(port => port.edgeId === route.edge.id && port.end === "from")!.side).toBe("w");
        expect(glyphDiagramRouteQuality(result.layout, [route]).edges[0]!.bends).toBeLessThanOrEqual(1);
      }
      if (preset.type.startsWith("stateDiagram")) {
        const title = labels!.placed.find(label => label.text === "Payment")!;
        const submit = labels!.placed.find(label => label.text === "submit")!;
        expect(title).toBeDefined(); expect(submit).toBeDefined();
        expect(Math.abs(title.y - submit.y) > 1 || title.x1 + 1 < submit.x0 || submit.x1 + 1 < title.x0).toBe(true);
      }
      if (preset.type === "C4Container") {
        const db = result.layout.nodes.find(node => node.id === "db")!;
        const pays = result.routes.find(route => route.edge.label === "Pays")!;
        for (const cell of pays.cells) expect(Math.max(db.x0 - cell.x, 0, cell.x - db.x1, db.y0 - cell.y, cell.y - db.y1)).toBeGreaterThan(1);
      }
    }
  });
}
afterAll(() => { if (process.env.GLYPH_FINAL_CAPTURE) writeFileSync(process.env.GLYPH_FINAL_CAPTURE, JSON.stringify(captures, null, 2)); });
