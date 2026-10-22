import { renderGlyphChart, renderGlyphChartMermaid } from "@glyphcss/charts";
import { GLYPH_MERMAID_CHART_PRESETS } from "../../mermaid/model/presets";
import { CHART_PRESETS, createChartsWorkbenchState } from "../model/chartsSpec";
import { renderChartsWorkbenchState } from "./chartsWorkbenchRender";

export function staticCharts() {
  const state = createChartsWorkbenchState();
  const initial = renderChartsWorkbenchState(state);
  if (!initial.ok) throw new Error(initial.error);
  const options = { target: "web", color: "css", charset: "braille", width: 80, height: 28 } as const;
  const examples = GLYPH_MERMAID_CHART_PRESETS.map((preset) => {
    const result = renderGlyphChartMermaid(preset.source, { ...options, height: preset.height });
    return {
      title: preset.label,
      source: preset.source,
      text: result.text,
      html: result.html!,
    };
  });
  for (const id of ["bar", "area", "donut", "heatmap", "funnel"]) {
    const preset = CHART_PRESETS.find((entry) => entry.id === id)!;
    const result = renderGlyphChart(preset.spec, options);
    examples.push({
      title: preset.label,
      source: JSON.stringify(preset.spec, null, 2),
      text: result.text,
      html: result.html!,
    });
  }
  return {
    initial: {
      title: "Line preset",
      text: initial.text,
      html: initial.display,
      source: JSON.stringify(CHART_PRESETS[0]!.spec, null, 2),
    },
    examples,
  };
}
