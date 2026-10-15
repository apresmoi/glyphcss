/** Fitting hints stay internal; public wrap and spacing options retain their contracts. */
export const GLYPH_DIAGRAM_WORD_WIDTH = Symbol("whole node words");
export const GLYPH_DIAGRAM_BRANCH_LABEL = Symbol("exclusive branch label");
export const GLYPH_DIAGRAM_ROUTE_TOUCH = Symbol("prefer route contact");

/** Authored block placement and frame bounds survive in-memory adapter/render boundaries. */
export const GLYPH_MERMAID_BLOCK = Symbol("Mermaid block grid");
export const GLYPH_DIAGRAM_GROUP_BOUNDS = Symbol("authored group bounds");

/** Anonymous concurrent sub-groups use the sequence divider vocabulary, not extra rings. */
export const GLYPH_MERMAID_STATE_REGION = Symbol("Mermaid state region");
export type GlyphMermaidStateRegion = { readonly [GLYPH_MERMAID_STATE_REGION]?: { readonly parent: string; readonly index: number } };

/** One state transition terminates on a concurrent composite, never on all its regions.
 * Node representatives constrain compound ranks only; positioned ports belong to the frame.
 */
export const GLYPH_MERMAID_STATE_FRAME = Symbol("Mermaid state frame endpoint");
export type GlyphMermaidStateFrame = { readonly [GLYPH_MERMAID_STATE_FRAME]?: Partial<Record<"from" | "to", { readonly group: string; readonly nodes: readonly string[] }>> };
