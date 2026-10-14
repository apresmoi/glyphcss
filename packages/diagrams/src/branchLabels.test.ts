import { GLYPH_DIAGRAM_BRANCH_LABEL } from "./layoutHints";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramLabelLayout } from "./labels";
vi.mock("./pipeline", async importOriginal => {
  const real = await importOriginal<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn(real.layoutGlyphGraph) };
});
import { layoutGlyphGraph } from "./pipeline";
const options = { target: "chat", width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" } as const;
it("keeps the fetch label over its entire branch and folds the three-box suffix", async () => {
  vi.mocked(layoutGlyphGraph).mockClear();
  const result = await renderGlyphDiagram(readFileSync(resolve(__dirname, "../bench/corpus/telescope-explore-decision.mmd"), "utf8"), options);
  expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThanOrEqual(2);
  const route = result.routes.find(route => route.edge.to === "raw")!;
  const label = result.labels.find(label => label.text === route.edge.label)!;
  expect(label).toBeDefined();
  for (let x = label.x0; x <= label.x1; x++) expect(route.cells.some(cell => cell.x === x && Math.abs(cell.y - label.y) === 1)).toBe(true);
  for (const from of ["out", "exp"]) expect(new Set(result.routes.find(route => route.edge.from === from)!.cells.map(cell => cell.y)).size).toBe(1);
  const occupied = result.text.split("\n").filter(line => line.trim());
  expect(occupied.length).toBeLessThan(24);
});
it("does not float a branch label beyond a short horizontal segment", () => {
  const result = glyphDiagramLabelLayout([{ id: "edge:branch", text: "long label", x: 10, y: 4, [GLYPH_DIAGRAM_BRANCH_LABEL]: true,
    route: [{ x: 10, y: 4 }, { x: 11, y: 4 }, { x: 12, y: 4 }] }], { obstacles: [], viewport: { cols: 40, rows: 10 } });
  expect(result.dropped).toEqual(["edge:branch"]);
});

it("anchors a short fan caption beside its own destination stem", async () => {
  const result = await renderGlyphDiagram(readFileSync(resolve(__dirname, "../bench/corpus/telescope-explore-decision.mmd"), "utf8"), options);
  const route = result.routes.find(route => route.edge.to === "get")!;
  const entry = result.layout.ports.find(port => port.edgeId === route.edge.id && port.end === "to")!;
  const label = result.labels.find(label => label.text === "get --pick N")!;
  expect(Math.abs((label.x0 + label.x1) / 2 - entry.anchor.x)).toBeLessThanOrEqual(label.text.length / 2);
});
