import type { GlyphCanvasTierName } from "glyphcss";
import type { GlyphGraphNode } from "./types";
import { glyphDiagramText } from "./labels";

/** Presentation state never enters graph labels, metadata or JSON exports. */
export const GLYPH_DIAGRAM_DIAMOND_MARKER = Symbol("diamond marker");
export interface GlyphDiagramPresentationOptions { readonly [GLYPH_DIAGRAM_DIAMOND_MARKER]?: boolean }
const DIAMOND = "◆";
export function glyphDiagramDiamondGlyph(charset?: GlyphCanvasTierName): string { return glyphDiagramText(DIAMOND, charset); }
export function glyphDiagramHasDiamondMarker(node: GlyphGraphNode & GlyphDiagramPresentationOptions,
  options: GlyphDiagramPresentationOptions = {}): boolean {
  return options[GLYPH_DIAGRAM_DIAMOND_MARKER] !== false && node[GLYPH_DIAGRAM_DIAMOND_MARKER] !== false
    && node.shape === "diamond" && Array.from(node.label)[0] !== DIAMOND;
}
/** Measurement reserves the complete painted rows, including the optional marker. */
export function glyphDiagramNodeText(node: GlyphGraphNode & GlyphDiagramPresentationOptions,
  options: GlyphDiagramPresentationOptions & { readonly charset?: GlyphCanvasTierName } = {}): string {
  const text = glyphDiagramHasDiamondMarker(node, options) ? `${DIAMOND} ${node.label}` : node.label;
  return text.split(/\r?\n/).map(line => glyphDiagramText(line, options.charset)).join("\n");
}
