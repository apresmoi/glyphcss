import { renderGlyphChartMermaid } from "@glyphcss/charts";
import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import examples from "../data/examples.json";

export const GLYPH_MERMAID_EXAMPLES = examples;
export type GlyphMermaidExample = (typeof examples)[number];

export async function renderGlyphMermaidExample(example: GlyphMermaidExample) {
  const options = { target: "web" as const, width: 72, height: example.height, color: "css" as const };
  if (example.owner === "charts") return renderGlyphChartMermaid(example.source, options);
  if (example.type === "sequenceDiagram")
    return renderGlyphSequence(example.source, {
      ...options,
      overflow: "expand",
    });
  // Keep source annotations: gitGraph dispatches to lanes and block retains
  // its grid. A graph-JSON round trip would discard those presentation hints.
  return renderGlyphDiagram(example.source, {
    ...options,
    autoDirection: true,
    overflow: "expand",
  });
}
