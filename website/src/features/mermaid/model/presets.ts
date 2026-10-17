import examples from "../data/examples.json";

export const GLYPH_MERMAID_PRESETS = examples.map((example) => ({
  ...example,
  id: `mermaid-${example.type}`,
  label: example.type,
}));
export const GLYPH_MERMAID_CHART_PRESETS = GLYPH_MERMAID_PRESETS.filter((preset) => preset.owner === "charts");
export const GLYPH_MERMAID_DIAGRAM_PRESETS = GLYPH_MERMAID_PRESETS.filter((preset) => preset.owner === "diagrams");
