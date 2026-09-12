import { renderGlyphChart, type GlyphChartInput, type GlyphChartRenderOptions, type GlyphChartMeta } from "@glyphcss/charts";
import { buildChartsWorkbenchSpec, chartsWorkbenchRenderOptions, type ChartsWorkbenchState } from "./chartsWorkbenchState";

export type ChartsWorkbenchRender =
  | { ok: true; display: string; isHtml: boolean; text: string; ansi?: string; meta: GlyphChartMeta }
  | { ok: false; error: string; code?: string };

function failure(error: unknown): ChartsWorkbenchRender {
  const e = error as Error & { code?: string };
  return { ok: false, error: e.code ? `${e.code}: ${e.message}` : e.message, code: e.code };
}
function renderSpec(input: GlyphChartInput, options: GlyphChartRenderOptions): ChartsWorkbenchRender {
  try {
    const result = renderGlyphChart(input, options);
    const text = Array.from({ length: result.grid.rows }, (_, row) =>
      result.grid.char.slice(row * result.grid.cols, (row + 1) * result.grid.cols).join("")
    ).join("\n");
    const isHtml = options.target === "web" && result.html !== undefined;
    // NO_COLOR may have suppressed ANSI despite the requested colour depth.
    const ansi = result.text.includes("\x1b[") ? result.text : undefined;
    return { ok: true, display: isHtml ? result.html! : text, isHtml, text, ansi, meta: result.meta };
  } catch (error) { return failure(error); }
}
export function renderChartsWorkbenchSpec(specJson: string, options: GlyphChartRenderOptions): ChartsWorkbenchRender {
  let input: GlyphChartInput;
  try { input = JSON.parse(specJson); }
  catch (error) { return { ok: false, error: `Invalid JSON: ${(error as Error).message}` }; }
  return renderSpec(input, options);
}
export function renderChartsWorkbenchState(state: ChartsWorkbenchState): ChartsWorkbenchRender {
  try { return renderSpec(buildChartsWorkbenchSpec(state), chartsWorkbenchRenderOptions(state)); }
  catch (error) { return failure(error); }
}
