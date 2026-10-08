/**
 * Composition bridges — the seams that let a 2D chart become a texture on
 * another glyphcss object (CHARTS-RESEARCH `PLAN-3d.md` §7 "A 2D chart as a
 * texture", packet F2). `glyphChartTextureSampler` is the whole of this
 * file: it hands `buildGlyphChart`'s own painted canvas straight to
 * `glyphcss`'s `glyphCanvasTextureSampler`, so it produces exactly what
 * `scene.setTextureSamplers` already knows how to read (AGENTS.md's
 * "Per-cell textures"). Nothing here builds a scene object or a plane mesh
 * — that is packet F4's `glyphChartPlaneObject`.
 */

import { glyphCanvasTextureSampler, type GlyphCanvasTextureSamplerOptions, type TextureSampler } from "glyphcss";
import type { GlyphChartBuild } from "./types";

export interface GlyphChartTextureSamplerOptions extends GlyphCanvasTextureSamplerOptions {
  /**
   * Which of `build`'s two canvases to sample — `"canvas"` (default) is the
   * TEXTURED paint (monochrome series identity, what every plain-text/ASCII
   * exit reads); `"colorCanvas"` is the SOLID-fill paint `regionFill`
   * resolves to when colour is on (AGENTS.md's "Charts" "Series and
   * shading"), and is the exact same object as `canvas` when nothing
   * distinguishes them.
   */
  readonly source?: "canvas" | "colorCanvas";
}

/**
 * `build.canvas`/`build.colorCanvas` → `TextureSampler`. Defaults to the
 * WHOLE canvas (title, axes, legend included — "the chart" as a texture);
 * pass `rect: build.plot` to sample only the plotted data.
 */
export function glyphChartTextureSampler(
  build: GlyphChartBuild,
  options: GlyphChartTextureSamplerOptions = {},
): TextureSampler {
  const { source = "canvas", ...samplerOptions } = options;
  const canvas = source === "colorCanvas" ? build.colorCanvas : build.canvas;
  return glyphCanvasTextureSampler(canvas, samplerOptions);
}
