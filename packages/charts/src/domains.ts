import { normalizeGlyphChartInput } from "./spec";
import { validateGlyphChartSpec } from "./validate";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import type { GlyphChartInput } from "./types";

/** Actual domains after transforms and scale inference, for partially inferred editor bounds. */
export function glyphChartScaleDomains(input: GlyphChartInput) {
  const spec = validateGlyphChartSpec(normalizeGlyphChartInput(input));
  const scales = resolveGlyphChartScales(resolveGlyphChartSpec(spec), spec.scales);
  return {
    x: { type: scales.x.type, domain: scales.x.domain },
    y: { type: scales.y.type, domain: scales.y.domain },
  };
}
