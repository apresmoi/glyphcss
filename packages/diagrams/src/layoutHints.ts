/** Fitting hints stay internal; public wrap and spacing options retain their contracts. */
export const GLYPH_DIAGRAM_WORD_WIDTH = Symbol("whole node words");
export const GLYPH_DIAGRAM_BRANCH_LABEL = Symbol("exclusive branch label");
export const GLYPH_DIAGRAM_ROUTE_TOUCH = Symbol("prefer route contact");

/** Authored block placement and frame bounds survive in-memory adapter/render boundaries. */
export const GLYPH_MERMAID_BLOCK = Symbol("Mermaid block grid");
export const GLYPH_DIAGRAM_GROUP_BOUNDS = Symbol("authored group bounds");
