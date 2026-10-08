/** Expose a rendered 2D canvas as a texture without changing its diagram layout. */

import { glyphCanvasTextureSampler, type GlyphCanvasTextureSamplerOptions, type TextureSampler } from "glyphcss";
import type { GlyphDiagramPage } from "./renderTypes";

export type GlyphDiagramTextureSamplerOptions = GlyphCanvasTextureSamplerOptions;

/** `page.canvas` → `TextureSampler`, the whole rendered diagram (nodes, edges, labels) by default. */
export function glyphDiagramTextureSampler(
  page: GlyphDiagramPage,
  options: GlyphDiagramTextureSamplerOptions = {},
): TextureSampler {
  return glyphCanvasTextureSampler(page.canvas, options);
}
