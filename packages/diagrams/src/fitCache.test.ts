import { expect, it, vi } from "vitest";
vi.mock("./route", async original => {
  const real = await original<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: vi.fn(real.routeGlyphGraphEdges) };
});
import { fitGlyphGraph } from "./fit";
import { routeGlyphGraphEdges } from "./route";
import { glyphGraphFromMermaid } from "./mermaid";
import { GLYPH_DIAGRAM_DIAMOND_MARKER } from "./presentation";
import { GLYPH_MERMAID_ADAPTIVE } from "./mermaidStructured";
import { GLYPH_DIAGRAM_WORK, GlyphDiagramWork } from "./work";

const options = { width: 72, height: 24, charset: "box" as const };
const graph = (id: string) => glyphGraphFromMermaid(`flowchart LR\n${id}[Start] --> B[Finish]`);
it("reuses a complete fit and isolates cached geometry from returned mutations", async () => {
  const input = graph("cacheIsolation");
  const first = await fitGlyphGraph(input, options);
  const saved = first.layout.nodes[0]!.x0;
  // Consumers of the staged API can mutate their returned arrays.
  (first.layout.nodes[0] as { x0: number }).x0 = -100;
  vi.mocked(routeGlyphGraphEdges).mockClear();
  const second = await fitGlyphGraph(input, options);
  expect(vi.mocked(routeGlyphGraphEdges)).not.toHaveBeenCalled();
  expect(second.layout.nodes[0]!.x0).toBe(saved);
  (second.layout.nodes[0] as { x0: number }).x0 = -200;
  expect((await fitGlyphGraph(input, options)).layout.nodes[0]!.x0).toBe(saved);
});
it("keys symbol options, graph hints, dimensions, direction and content", async () => {
  const input = glyphGraphFromMermaid("flowchart LR\ncacheDiamond{Decision} --> E[End]");
  const marked = { ...options, [GLYPH_DIAGRAM_DIAMOND_MARKER]: true };
  await fitGlyphGraph(input, marked);
  for (const [source, opts] of [
    [input, { ...marked, [GLYPH_DIAGRAM_DIAMOND_MARKER]: false }],
    [Object.assign({}, input, { [GLYPH_MERMAID_ADAPTIVE]: true }), marked],
    [input, { ...marked, width: 80 }],
    [input, { ...marked, direction: "TB" as const }],
    [{ ...input, nodes: input.nodes.map(n => ({ ...n, label: `${n.label} edited` })) }, marked],
  ] as const) {
    vi.mocked(routeGlyphGraphEdges).mockClear();
    const result = await fitGlyphGraph(source, opts);
    expect(result.okay).toBe(true);
    expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeGreaterThan(0);
  }
});
it("evicts the least recently used fit after 32 entries", async () => {
  const oldest = graph("cacheEviction0");
  await fitGlyphGraph(oldest, options);
  for (let i = 1; i <= 32; i++) await fitGlyphGraph(graph(`cacheEviction${i}`), options);
  vi.mocked(routeGlyphGraphEdges).mockClear();
  await fitGlyphGraph(oldest, options);
  expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeGreaterThan(0);
});
it("does not reuse a fit once the current render enters terminal work", async () => {
  const input = graph("cacheTerminal");
  await fitGlyphGraph(input, options);
  const work = new GlyphDiagramWork(input, 72, 24);
  work.terminal = true;
  vi.mocked(routeGlyphGraphEdges).mockClear();
  await fitGlyphGraph(input, { ...options, [GLYPH_DIAGRAM_WORK]: work });
  expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeGreaterThan(0);
});
