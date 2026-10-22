import {
  renderGlyphChart,
  renderGlyphChartMermaid,
  type GlyphChartInput,
  type GlyphChartRenderOptions,
} from "@glyphcss/charts";
import { renderGlyphDiagram, type GlyphGraph, type GlyphDiagramRenderOptions } from "@glyphcss/diagrams";
import { renderGlyphSequence, type GlyphSequence, type GlyphSequenceRenderOptions } from "@glyphcss/diagrams/sequence";
import { renderGlyphLaneDag, type GlyphLaneDag, type GlyphLaneRenderOptions } from "@glyphcss/diagrams/lanes";

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
    case "chart":
      return renderGlyphChart(input.source, options);
    case "chart-mermaid":
      return renderGlyphChartMermaid(normalizeGlyphDocsSource(input.source), options);
  }
}
