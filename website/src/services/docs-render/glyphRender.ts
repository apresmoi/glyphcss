import {
  renderGlyphChart,
  renderGlyphChartMermaid,
  type GlyphChartInput,
  type GlyphChartRenderOptions,
} from "@glyphcss/charts";
import {
  glyphChartSurface,
  glyphChartScatter3d,
  glyphChartParametric3d,
  glyphChartBars3d,
  glyphChartLine3d,
  renderGlyphChart3d,
  type GlyphChart3dRenderOptions,
} from "@glyphcss/charts/3d";
import { renderGlyphDiagram, type GlyphGraph, type GlyphDiagramRenderOptions } from "@glyphcss/diagrams";
import { renderGlyphSequence, type GlyphSequence, type GlyphSequenceRenderOptions } from "@glyphcss/diagrams/sequence";
import { renderGlyphLaneDag, type GlyphLaneDag, type GlyphLaneRenderOptions } from "@glyphcss/diagrams/lanes";

type GlyphDocsChart3dSource =
  | { type: "surface"; args: Parameters<typeof glyphChartSurface> }
  | { type: "scatter"; args: Parameters<typeof glyphChartScatter3d> }
  | { type: "parametric"; args: Parameters<typeof glyphChartParametric3d> }
  | { type: "bars"; args: Parameters<typeof glyphChartBars3d> }
  | { type: "line"; args: Parameters<typeof glyphChartLine3d> };

function buildGlyphDocsChart3d(source: GlyphDocsChart3dSource) {
  switch (source.type) {
    case "surface":
      return glyphChartSurface(...source.args);
    case "scatter":
      return glyphChartScatter3d(...source.args);
    case "parametric":
      return glyphChartParametric3d(...source.args);
    case "bars":
      return glyphChartBars3d(...source.args);
    case "line":
      return glyphChartLine3d(...source.args);
  }
}

export function resolveGlyphDocsChart3d(input: Extract<GlyphDocsRenderInput, { kind: "chart-3d" }>) {
  if (input.options?.color && !["none", "css"].includes(input.options.color)) {
    throw new TypeError("GlyphRender supports color none or css in HTML documentation.");
  }
  const mark = buildGlyphDocsChart3d(input.source);
  const options: GlyphChart3dRenderOptions = { target: "chat", color: "css", ...input.options };
  return { mark, options, result: renderGlyphChart3d(mark, options) };
}

export type GlyphDocsRenderInput =
  | {
      kind: "diagram";
      source: string | GlyphGraph;
      options?: GlyphDiagramRenderOptions;
    }
  | {
      kind: "sequence";
      source: string | GlyphSequence;
      options?: GlyphSequenceRenderOptions;
    }
  | {
      kind: "lanes";
      source: string | GlyphLaneDag;
      options?: GlyphLaneRenderOptions;
    }
  | {
      kind: "chart";
      source: GlyphChartInput;
      options?: GlyphChartRenderOptions;
    }
  | {
      kind: "chart-3d";
      source: GlyphDocsChart3dSource;
      options?: GlyphChart3dRenderOptions;
    }
  | {
      kind: "chart-mermaid";
      source: string;
      options?: GlyphChartRenderOptions;
    };

export function normalizeGlyphDocsSource(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^[\t ]*/)![0].length));
  return lines.map((line) => (line.trim() ? line.slice(indent) : "")).join("\n");
}

export async function renderGlyphDocs(input: GlyphDocsRenderInput) {
  // Documentation is a web surface: CSS carries color without putting ANSI
  // escape codes in the page. Explicit ANSI choices must fail visibly.
  if (input.options?.color && !["none", "css"].includes(input.options.color)) {
    throw new TypeError("GlyphRender supports color none or css in HTML documentation.");
  }
  const options = {
    target: "chat" as const,
    color: "css" as const,
    ...input.options,
  };
  switch (input.kind) {
    case "diagram":
      return renderGlyphDiagram(
        typeof input.source === "string" ? normalizeGlyphDocsSource(input.source) : input.source,
        options,
      );
    case "sequence":
      return renderGlyphSequence(
        typeof input.source === "string" ? normalizeGlyphDocsSource(input.source) : input.source,
        options,
      );
    case "lanes":
      return renderGlyphLaneDag(
        typeof input.source === "string" ? normalizeGlyphDocsSource(input.source) : input.source,
        options,
      );
    case "chart-3d":
      return resolveGlyphDocsChart3d(input).result;
    case "chart":
      return renderGlyphChart(input.source, options);
    case "chart-mermaid":
      return renderGlyphChartMermaid(normalizeGlyphDocsSource(input.source), options);
  }
}

export function fitGlyphDocsOutput(result: { text: string; html?: string }, textScale = 1) {
  // Scaled text occupies blank filler rows; keep those reserved cells intact.
  if (textScale > 1) return result;
  const lines = result.text.split("\n");
  const htmlLines = result.html?.split("\n");
  const blank = (index: number) => /^[ \t\u2800]*$/.test(lines[index]!) && !htmlLines?.[index]?.includes("background");
  let start = 0;
  let end = lines.length;
  while (start < end && blank(start)) start++;
  while (end > start && blank(end - 1)) end--;
  return { text: lines.slice(start, end).join("\n"), html: htmlLines?.slice(start, end).join("\n") };
}

// Inked column span of a render: renders pad to their target width, so callers
// crop to `indent`..`indent + cols` to show the art without dead margins.
export function glyphDocsInkBounds(text: string) {
  const lines = text.split("\n");
  const blank = /^[ \u2800]*$/;
  const inked = lines.filter((line) => !blank.test(line));
  if (!inked.length) return { indent: 0, cols: 1, rows: lines.length };
  const indent = Math.min(...inked.map((line) => [...line].findIndex((char) => char !== " " && char !== "\u2800")));
  const width = Math.max(...inked.map((line) => [...line.replace(/[ \u2800]+$/, "")].length));
  return { indent, cols: Math.max(1, width - indent), rows: lines.length };
}
