import { renderGlyphChartMermaid } from "@glyphcss/charts";
import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createChartsWorkbenchState, type ChartsWorkbenchState } from "../../charts/model/chartsSpec";
import { reduceChartsWorkbenchState, generateChartsWorkbenchSnippets, chartsWorkbenchRenderOptions } from "../../charts/model/chartsWorkbenchState";
import { renderChartsWorkbenchState } from "../../charts/render/chartsWorkbenchRender";
import { decodeChartsUrlState, encodeChartsUrlState } from "../../charts/services/chartsUrlState";
import { createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState, glyphDiagramsWorkbenchRenderOptions, glyphDiagramsWorkbenchSequenceRenderOptions } from "../../diagrams/model/diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchSequenceState, renderGlyphDiagramsWorkbenchState } from "../../diagrams/render/diagramsWorkbenchRender";
import { GLYPH_MONO_WEB_CELL_ASPECT } from "../../../utils/glyph-metrics/glyphMonoMetrics";
import { GLYPH_MERMAID_PRESETS, GLYPH_MERMAID_CHART_PRESETS, GLYPH_MERMAID_DIAGRAM_PRESETS } from "./presets";

vi.mock("@glyphcss/core", () => import("../../../../../packages/core/src/index"));

const renders: { type: string; target: string; text: string; html?: string; notes: readonly { code: string; message: string }[] }[] = [];
const types = ["flowchart", "graph", "stateDiagram", "sequenceDiagram", "classDiagram", "erDiagram", "mindmap", "gitGraph", "block", "architecture", "requirementDiagram", "C4Context", "C4Container", "C4Component", "C4Deployment", "C4Dynamic", "pie", "xychart", "sankey", "quadrantChart", "gantt", "radar", "treemap", "journey", "timeline", "packet", "kanban"];

describe("Mermaid presets in the main workbench pipelines", () => {
  it("covers every requested header; six showcase presets expand the CLI smoke examples", async () => {
    expect(GLYPH_MERMAID_PRESETS.map((preset) => preset.type)).toEqual(types);
    const cli = JSON.parse(await readFile("../packages/compile/src/fixtures/mermaidIntegration.json", "utf8"));
    const expanded = ["gantt", "treemap", "journey", "timeline", "packet", "kanban"];
    for (const { id, label, ...example } of GLYPH_MERMAID_PRESETS) {
      const original = cli.find((entry: { type: string }) => entry.type === example.type);
      expect(original).toBeDefined();
      if (expanded.includes(example.type)) {
        expect(example.owner).toBe(original.owner);
        expect(example.source.split("\n").length).toBeGreaterThan(original.source.split("\n").length * 2);
        expect(example.labels.length).toBeGreaterThan(original.labels.length * 2);
      } else expect(example).toEqual(original);
    }
  });
  describe.each(["chat", "web"] as const)("%s at 72 columns", (target) => {
    it.each(GLYPH_MERMAID_PRESETS)("$type loads its source and paints its labels", async (preset) => {
      const controls = { target, overrides: { width: 72, height: preset.height } };
      const viewport = { width: 72 * 13 * GLYPH_MONO_WEB_CELL_ASPECT, height: preset.height * 13 };
      let result;
      if (preset.owner === "charts") {
        const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-mermaid-preset", id: preset.id });
        expect(state.mermaid).toBe(preset.source);
        result = renderChartsWorkbenchState({ ...state, controls }, viewport);
        const direct = renderGlyphChartMermaid(preset.source, chartsWorkbenchRenderOptions({ ...state, controls }, viewport));
        if (result.ok) { expect(result.text).toBe(direct.text); expect(result.report.ledger).toEqual(direct.report.ledger); }
      } else {
        const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-mermaid-preset", id: preset.id });
        expect(state.form === "sequence" ? state.sequence.mermaid : state.mermaid).toBe(preset.source);
        const render = state.form === "sequence" ? renderGlyphDiagramsWorkbenchSequenceState : renderGlyphDiagramsWorkbenchState;
        result = await render({ ...state, controls }, viewport);
        const direct = state.form === "sequence"
          ? await renderGlyphSequence(preset.source, glyphDiagramsWorkbenchSequenceRenderOptions({ ...state, controls }, viewport))
          : await renderGlyphDiagram(preset.source, glyphDiagramsWorkbenchRenderOptions({ ...state, controls }, viewport));
        if (result.ok) { expect(result.text).toBe(direct.text); expect(result.ledger).toEqual(direct.report.ledger); }
      }
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(result.text.trim()).not.toBe("");
      expect(Math.max(...result.text.split("\n").map((line) => [...line].length))).toBeLessThanOrEqual(72);
      for (const label of preset.labels) expect(result.text).toContain(label);
      if (target === "web") expect(result.isHtml).toBe(true);
      const ledger = "report" in result ? result.report.ledger : result.ledger ?? [];
      expect(ledger.some((entry) => /unroutable|layout-overflow/.test(entry.code))).toBe(false);
      renders.push({ type: preset.type, target, text: result.text, html: result.isHtml ? result.display : undefined, notes: ledger });
    });
  });
  it.each(GLYPH_MERMAID_DIAGRAM_PRESETS)("$type keeps its original source when browsing JSON", (preset) => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-mermaid-preset", id: preset.id });
    for (const editor of ["json", "mermaid"] as const) state = reduceGlyphDiagramsWorkbenchState(state, state.form === "sequence" ? { type: "set-sequence-editor", editor } : { type: "set-editor", editor });
    expect(state.form === "sequence" ? state.sequence.mermaid : state.mermaid).toBe(preset.source);
  });
  it.each(GLYPH_MERMAID_CHART_PRESETS)("$type retains source in links and exports", async (preset) => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-mermaid-preset", id: preset.id });
    const decoded = await decodeChartsUrlState(await encodeChartsUrlState(state));
    expect(decoded?.mermaid).toBe(preset.source);
    expect(renderChartsWorkbenchState(decoded!).ok).toBe(true);
    const snippets = generateChartsWorkbenchSnippets(state);
    expect(snippets.mermaid).toBe(preset.source);
    for (const format of ["typescript", "html", "react", "vue"] as const) expect(snippets[format]).toContain("renderGlyphChartMermaid(source,");
    expect(reduceChartsWorkbenchState(state, { type: "apply-preset", id: "line" }).mermaid).toBeUndefined();
    expect(reduceChartsWorkbenchState(state, { type: "select-3d-dataset", id: "maunga-whau-volcano" }).mermaid).toBeUndefined();
  });
  it("malformed optional source degrades to absent in links", async () => {
    const state = { ...createChartsWorkbenchState(), mermaid: 42 } as unknown as ChartsWorkbenchState;
    expect((await decodeChartsUrlState(await encodeChartsUrlState(state)))?.mermaid).toBeUndefined();
  });
});

afterAll(async () => {
  const path = process.env.GLYPH_MERMAID_WEB_ARTIFACT;
  if (!path) return;
  await mkdir(path, { recursive: true });
  await writeFile(`${path}/w1-renders.txt`, renders.map(({ type, target, text }) => `${type} · ${target} · 72 columns\n${text}\n`).join("\n"));
  await writeFile(`${path}/w1-ledger.json`, JSON.stringify(renders.map(({ type, target, notes }) => ({ type, target, notes })), null, 2));
  await writeFile(`${path}/glyph-mono.woff2`, await readFile("public/fonts/glyph-mono.woff2"));
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await writeFile(`${path}/w1-renders.html`, `<!doctype html><meta charset="utf-8"><title>Mermaid workbench renders</title><style>
    @font-face { font-family: Glyph; src: url('./glyph-mono.woff2'); }
    body { margin:24px; background:#0c1017; color:#cbd5e1; font:13px monospace; }
    main { display:grid; grid-template-columns:repeat(2,max-content); gap:24px; }
    pre { margin:0; white-space:pre; font:13px/1 Glyph,monospace; }
    .chat pre { font-family:ui-monospace,"JetBrains Mono","SF Mono",Menlo,monospace; line-height:1; }
    </style><main>${renders.map((render) => `<article class="${render.target}" id="${render.target}-${render.type}"><h2>${render.type} · ${render.target}</h2><pre>${render.html ?? escape(render.text)}</pre></article>`).join("")}</main>`);
});
