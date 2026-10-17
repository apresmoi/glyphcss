import { afterAll, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const calls = vi.hoisted(() => ({ layouts: 0, routes: 0, limit: 1_000 }));
vi.mock("./pipeline", async original => {
  const real = await original<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: (...args: Parameters<typeof real.layoutGlyphGraph>) => {
    calls.layouts++;
    if (calls.layouts > calls.limit) throw new Error("small-canvas layout work escaped the shared budget");
    return real.layoutGlyphGraph(...args);
  } };
});
vi.mock("./route", async original => {
  const real = await original<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: (...args: Parameters<typeof real.routeGlyphGraphEdges>) => {
    calls.routes++;
    return real.routeGlyphGraphEdges(...args);
  } };
});
import { renderGlyphDiagram } from "./render";
import { renderGlyphSequence } from "./sequence/render";
import { computeGlyphDiagramQuality } from "./quality";
const examples = JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as { owner: string; type: string; source: string }[];
const nativeIds = ["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "crew", "agent-guardrail", "transformer-block", "rag-pipeline", "event-queue"];
const state = readFileSync("../../website/src/features/diagrams/model/diagramsWorkbenchState.ts", "utf8");
const crew = state.match(/const crewSource = `([\s\S]*?)`;/)![1]!;
const presets = [...examples.filter(p => p.owner === "diagrams").map(p => ({ ...p, name: p.type })),
  ...nativeIds.map(id => ({ type: "native", name: `native/${id}`, source: id === "crew" ? crew : readFileSync(`fixtures/${id}.mmd`, "utf8").replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/?(?:p|b|strong|i|em|span)(?:\s[^>]*?)?>/gi, "") }))];
const records: unknown[] = [];
const snapshots = JSON.parse(readFileSync("fixtures/small-canvas.json", "utf8")) as Record<string, { hash: string | null; terminalHash?: string; labels?: string[]; nodes?: string[]; edges?: string[] }>;
it.each(presets.flatMap(preset => (["web", "terminal"] as const).map(target => ({ preset, target, name: preset.name }))))("bounds small canvas $target/$name", async ({ preset, target }) => {
  calls.layouts = 0; calls.routes = 0;
  calls.limit = preset.name === "C4Deployment" ? 200 : preset.name === "flowchart" ? 400 : preset.name === "stateDiagram" ? 250 : 1_000;
  const options = { target, width: 60, height: 24, color: "none" } as const;
  const start = performance.now();
  const result = await (preset.type === "sequenceDiagram" ? renderGlyphSequence(preset.source, options) : renderGlyphDiagram(preset.source, options));
  const ms = performance.now() - start;
  const quality = preset.type === "sequenceDiagram" || preset.type === "gitGraph" ? undefined : computeGlyphDiagramQuality(result as Awaited<ReturnType<typeof renderGlyphDiagram>>, options);
  records.push({ name: preset.name, target, ms, ...calls, text: result.text, quality, ledger: result.report.ledger });
  expect(result.text.trim()).not.toBe("");
  const snapshot = snapshots[preset.name]!;
  const hash = target === "terminal" ? snapshot.terminalHash ?? snapshot.hash : snapshot.hash;
  if (hash) expect(createHash("sha256").update(result.text).digest("hex")).toBe(hash);
  if (snapshot.labels) {
    for (const label of snapshot.labels) expect(result.text).toContain(label);
    const diagram = result as Awaited<ReturnType<typeof renderGlyphDiagram>>;
    const nodes = new Set(diagram.pages.flatMap(page => page.layout.nodes.map(node => node.id)));
    const edges = new Set(diagram.pages.flatMap(page => page.routes.map(route => route.edge.id)));
    for (const id of snapshot.nodes!) expect(nodes.has(id)).toBe(true);
    for (const id of snapshot.edges!) expect(edges.has(id)).toBe(true);
  }
  if (preset.name === "C4Deployment") {
    const diagram = result as Awaited<ReturnType<typeof renderGlyphDiagram>>;
    expect(diagram.report.ledger.some(entry => entry.code === "render-work-limited")).toBe(true);
    expect(diagram.report.unroutable).toEqual([]);
    expect(diagram.pages.flatMap(page => page.routes)).toHaveLength(5);
    expect(new Set(diagram.pages.flatMap(page => page.layout.nodes.map(node => node.id))).size).toBe(6);
    for (const word of ["Buyer", "Customer", "Web app", "React", "Order API", "Worker", "Orders", "Postgres", "Bank", "Payments"]) expect(diagram.text).toContain(word);
  }
});
afterAll(() => { if (process.env.GLYPH_SMALL_CAPTURE) writeFileSync(process.env.GLYPH_SMALL_CAPTURE, JSON.stringify(records, null, 2)); });
