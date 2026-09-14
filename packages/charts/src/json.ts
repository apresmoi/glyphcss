/**
 * `renderGlyphChartJson` — the string-in/string-out entry for MCP/skill
 * wrappers and callers reading the CLI's `<spec.json>` file format.
 * The CLI's file path parses JSON and calls the same renderer directly.
 * Takes a JSON-encoded `GlyphChartInput` (a spec or a
 * mark — an accessor-function channel isn't JSON-representable, so JSON
 * callers use field-name channels only) and returns a JSON-encoded result:
 * `{ text, html?, meta, report }` on success, `{ error, code, hint }` on a
 * validation failure — a caller with only strings to pass around never has
 * to catch a thrown error to get a repair hint back.
 */

import { renderGlyphChart } from "./render";
import type { GlyphChartInput, GlyphChartRenderOptions } from "./types";
import { glyphChartRepairHint } from "./validate";

export function renderGlyphChartJson(json: string, options: GlyphChartRenderOptions = {}): string {
  let input: GlyphChartInput;
  try {
    input = JSON.parse(json) as GlyphChartInput;
  } catch (e) {
    return JSON.stringify({ error: `invalid JSON: ${(e as Error).message}`, code: null, hint: "Pass a JSON-encoded spec, mark, or number array." });
  }

  try {
    const result = renderGlyphChart(input, options);
    const { grid: _grid, ...rest } = result;
    return JSON.stringify(rest);
  } catch (e) {
    const error = e as Error & { code?: string };
    const code = error.code ?? null;
    return JSON.stringify({
      error: error.message,
      code,
      hint: (code ? glyphChartRepairHint(code) : undefined) ?? null,
    });
  }
}
