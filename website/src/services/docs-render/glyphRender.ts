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

export async function renderGlyphDocs(input: GlyphDocsRenderInput) {
  // Documentation is a web surface: CSS carries color without putting ANSI
  // escape codes in the page. Explicit ANSI choices must fail visibly.
  if (input.options?.color && !["none", "css"].includes(input.options.color)) {
    throw new TypeError("GlyphRender supports color none or css in HTML documentation.");
  }
  const options = {
    target: "chat" as const,
    color: "none" as const,
    ...input.options,
  };
  switch (input.kind) {
    case "diagram":
      return renderGlyphDiagram(input.source, options);
    case "sequence":
      return renderGlyphSequence(input.source, options);
    case "lanes":
      return renderGlyphLaneDag(input.source, options);
    case "chart":
      return renderGlyphChart(input.source, options);
    case "chart-mermaid":
      return renderGlyphChartMermaid(input.source, options);
  }
}
