import type { GlyphChartPlotRect, GlyphChartSpec } from "./types";
import type { GlyphChartResolvedScales } from "./scales";

// The ordinary line/text marks share one radial metric; shallow copies retain it.
export const GLYPH_CHART_RADAR_CAPTION_RADIUS = 1.18;
export const GLYPH_CHART_RADAR = Symbol("glyph-chart-radar");
export type GlyphChartRadarSpec = GlyphChartSpec & { readonly [GLYPH_CHART_RADAR]?: true };

export function fitGlyphRadarScales(spec: GlyphChartRadarSpec, scales: GlyphChartResolvedScales, plot: GlyphChartPlotRect, cellAspect: number): GlyphChartResolvedScales {
  if (!spec[GLYPH_CHART_RADAR]) return scales;
  const width = Math.max(1, plot.x1 - plot.x0), height = Math.max(1, plot.y1 - plot.y0);
  const aspect = cellAspect > 0 && Number.isFinite(cellAspect) ? cellAspect : 0.5;
  // Keep the reader's caption reservations while giving a world unit the same physical length on both axes.
  const radius = Math.min(width * aspect / 2.9, height / 2.7);
  const xHalf = width * aspect / (2 * radius), yHalf = height / (2 * radius);
  return {
    x: { ...scales.x, domain: [-xHalf, xHalf], toFraction: (v) => 0.5 + Number(v) / (2 * xHalf) },
    y: { ...scales.y, domain: [-yHalf, yHalf], toFraction: (v) => 0.5 + Number(v) / (2 * yHalf) },
  };
}
