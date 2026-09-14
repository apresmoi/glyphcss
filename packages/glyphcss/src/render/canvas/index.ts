/**
 * The cell canvas — see `docs/design/canvas.md` for the full rationale and
 * AGENTS.md's "Cell canvas" section for the contract. Pure, no browser
 * globals, not imported by (and not importing anything private from) the
 * existing render path.
 */

export { createGlyphCanvas } from "./canvas";
export type {
  GlyphCanvas,
  GlyphCanvasOptions,
  GlyphCanvasFill,
  GlyphCanvasFillOptions,
  GlyphCanvasPoint,
  GlyphCanvasLineStyle,
  GlyphCanvasLineOptions,
  GlyphCanvasTextAlign,
  GlyphCanvasTextOptions,
  GlyphCanvasArrowheadOptions,
  GlyphCanvasDirection,
  GlyphCanvasSurfaceUvRect,
} from "./canvas";

export { glyphCanvasTextureSampler } from "./sampler";
export type { GlyphCanvasTextureSamplerOptions, GlyphCanvasTextureSamplerRect } from "./sampler";

export { glyphInkMask, glyphInkDensity } from "./glyphInk";

export type { GlyphCanvasEdgeOptions } from "./junctions";

export type {
  GlyphCanvasReport,
  GlyphCanvasFoldedGlyph,
  GlyphCanvasRouteConflict,
  GlyphCanvasRouteConflictKind,
} from "./report";

export {
  GLYPH_CANVAS_TIERS,
  GLYPH_CANVAS_DIRECTION_BITS,
  GLYPH_CANVAS_QUADRANT_GLYPHS,
} from "./tiers";
export type {
  GlyphCanvasTier,
  GlyphCanvasTierName,
  GlyphCanvasStraightGlyphs,
  GlyphCanvasArrowGlyphs,
  GlyphCanvasDiagonalGlyphs,
  GlyphCanvasDiagonalKey,
} from "./tiers";

export {
  encodeGlyphCanvasText,
  encodeGlyphCanvasAnsi,
  encodeGlyphCanvasHtml,
  nearestAnsiCanvasColor,
} from "./encode";
export type {
  GlyphCanvasAnsiColorMode,
  GlyphCanvasAnsiOptions,
  GlyphCanvasHtmlOptions,
} from "./encode";
