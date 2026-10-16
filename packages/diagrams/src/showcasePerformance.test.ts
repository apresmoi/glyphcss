import { afterAll, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
vi.mock("./route", async original => {
  const real = await original<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: vi.fn(real.routeGlyphGraphEdges) };
});
vi.mock("./pipeline", async original => {
  const real = await original<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn(real.layoutGlyphGraph) };
});
import { routeGlyphGraphEdges } from "./route";
import { layoutGlyphGraph } from "./pipeline";
import { renderGlyphDiagram } from "./render";
import { renderGlyphSequence } from "./sequence/render";
import { computeGlyphDiagramQuality } from "./quality";

const examples = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { owner: string; type: string; source: string }[];
const nativeIds = ["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "crew", "agent-guardrail", "transformer-block", "rag-pipeline", "event-queue"];
const state = readFileSync("../../website/src/features/diagrams/model/diagramsWorkbenchState.ts", "utf8");
const crew = state.match(/const crewSource = `([\s\S]*?)`;/)![1]!;
const presets = [...examples.filter(p => p.owner === "diagrams").map(p => ({ ...p, name: p.type })),
  ...nativeIds.map(id => ({ type: "native", name: `native/${id}`, source: id === "crew" ? crew : readFileSync(`fixtures/${id}.mmd`, "utf8").replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/?(?:p|b|strong|i|em|span)(?:\s[^>]*?)?\s*>/gi, "") }))];
// [cold routes, cold layouts, warm routes, warm layouts]. Cold bounds catch
// probe explosions even when a cache would conceal them in warm timings.
const bounds: Record<string, readonly [number, number, number, number]> = {
  flowchart: [1, 50, 0, 0], graph: [1, 1, 0, 0], stateDiagram: [1, 26, 0, 0],
  sequenceDiagram: [0, 0, 0, 0], classDiagram: [384, 196, 384, 196], erDiagram: [5, 3, 0, 0],
  mindmap: [1, 4, 0, 0], gitGraph: [0, 0, 0, 0], block: [40, 1, 1, 0], architecture: [1, 21, 0, 0],
  requirementDiagram: [24, 10, 0, 0], C4Context: [8, 24, 0, 0], C4Container: [12, 24, 0, 0],
  C4Component: [10, 24, 0, 0], C4Deployment: [6, 24, 0, 0], C4Dynamic: [16, 28, 0, 0],
  "native/chain": [1, 1, 0, 0], "native/diamond": [2, 1, 0, 0], "native/fan-out": [1, 1, 0, 0],
  "native/cycle": [3, 1, 0, 0], "native/subgraph": [1, 1, 0, 0], "native/langgraph": [1, 1, 0, 0],
  "native/crew": [3, 15, 0, 0], "native/agent-guardrail": [3, 31, 0, 0],
  "native/transformer-block": [1, 1, 0, 0], "native/rag-pipeline": [1, 3, 0, 0], "native/event-queue": [2, 2, 2, 2],
};
const records: unknown[] = [];
const options = { target: "web", width: 96, height: 32, autoDirection: true, nodesep: 4, ranksep: 4, overflow: "expand" } as const;
it.each(presets)("bounds warm showcase work: $name", async preset => {
  const render = () => preset.type === "sequenceDiagram" ? renderGlyphSequence(preset.source, options) : renderGlyphDiagram(preset.source, options);
  vi.mocked(routeGlyphGraphEdges).mockClear(); vi.mocked(layoutGlyphGraph).mockClear();
  let result = await render();
  const coldText = result.text;
  const coldRoutes = vi.mocked(routeGlyphGraphEdges).mock.calls.length, coldLayouts = vi.mocked(layoutGlyphGraph).mock.calls.length;
  const timing = Boolean(process.env.GLYPH_PERF_CAPTURE);
  if (timing) for (let i = 0; i < 2; i++) await render();
  const times: number[] = [];
  for (let i = 0; i < (timing ? 7 : 1); i++) {
    vi.mocked(routeGlyphGraphEdges).mockClear(); vi.mocked(layoutGlyphGraph).mockClear();
    const start = performance.now(); result = await render(); times.push(performance.now() - start);
  }
  const routes = vi.mocked(routeGlyphGraphEdges).mock.calls.length;
  const layouts = vi.mocked(layoutGlyphGraph).mock.calls.length;
  const quality = preset.type === "sequenceDiagram" || preset.type === "gitGraph" ? undefined : computeGlyphDiagramQuality(result as Awaited<ReturnType<typeof renderGlyphDiagram>>, options);
  records.push({ name: preset.name, medianMs: times.sort((a,b) => a-b)[Math.floor(times.length / 2)], routes, layouts, coldRoutes, coldLayouts, quality, text: result.text });
  expect(result.text.trim()).not.toBe("");
  expect(result.text).toBe(coldText);
  const limit = bounds[preset.name]!;
  for (const [i, count] of [coldRoutes, coldLayouts, routes, layouts].entries()) expect(count).toBeLessThanOrEqual(limit[i]!);
  if (quality && preset.type !== "classDiagram" && preset.type !== "native") expect(quality).toMatchObject({
    wordCuts: 0, crossings: 0, fakeFrames: 0, droppedEdges: 0, droppedLabels: 0, pages: 1,
  });
}, 120000);
afterAll(() => { if (process.env.GLYPH_PERF_CAPTURE) writeFileSync(process.env.GLYPH_PERF_CAPTURE, JSON.stringify(records, null, 2)); });
