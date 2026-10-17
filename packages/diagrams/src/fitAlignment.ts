/** Private fit dimension; the public layout options remain independent of Dagre. */
export const GLYPH_DIAGRAM_DAGRE_ALIGN = Symbol("dagre alignment");
export type GlyphDiagramDagreAlignment = "UL" | "UR" | "DL" | "DR";
export const GLYPH_DIAGRAM_DAGRE_ALIGNMENTS: readonly GlyphDiagramDagreAlignment[] = ["UL", "UR", "DL", "DR"];
