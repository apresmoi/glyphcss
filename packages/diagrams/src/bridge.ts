/**
 * Composition bridge — mirrors `@glyphcss/charts`' `bridge.ts` (CHARTS-
 * RESEARCH `PLAN-3d.md` §7, packet F2). `glyphDiagramTextureSampler` hands a
 * rendered `GlyphDiagramPage`'s own painted `canvas` (Packet F1's `grid` →
 * `canvas` rename) to `glyphcss`'s `glyphCanvasTextureSampler`, so a diagram
 * can become a texture on another glyphcss object through the exact same
 * `scene.setTextureSamplers` path a chart uses.
 */

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
