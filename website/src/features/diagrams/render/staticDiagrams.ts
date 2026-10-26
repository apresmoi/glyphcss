import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { GLYPH_MERMAID_DIAGRAM_PRESETS } from "../../mermaid/model/presets";
import { createGlyphDiagramsWorkbenchState } from "../model/diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchRender";

export async function staticDiagrams() {
  const state = createGlyphDiagramsWorkbenchState();
  const initial = await renderGlyphDiagramsWorkbenchState(state);
  if (!initial.ok) throw new Error(initial.error);
  const examples = [];
  for (const preset of GLYPH_MERMAID_DIAGRAM_PRESETS) {
    const options = {
      target: "web",
      color: "css",
      charset: "box",
      width: 96,
      height: preset.height,
      overflow: "expand",
    } as const;
    const result = await (preset.type === "sequenceDiagram"
      ? renderGlyphSequence(preset.source, options)
      : renderGlyphDiagram(preset.source, options));
    examples.push({ title: preset.label, source: preset.source, text: result.text, html: result.html! });
  }
  return {
    initial: { title: state.diagram.title, source: state.mermaid, text: initial.text, html: initial.display },
    examples,
  };
}
