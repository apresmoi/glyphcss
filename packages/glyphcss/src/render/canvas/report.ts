/**
 * The cell canvas's shared report shape (CHARTS-RESEARCH Phase 0) — split out
 * of `canvas.ts` so `junctions.ts` (which needs to append to
 * `routeConflicts`) and `canvas.ts` (which needs every field) can both import
 * it without a circular dependency between the two.
 */

/**
 * One `text()` glyph that could not be placed as-authored and was folded
 * (NFD-stripped, or substituted via the punctuation table) to a different,
 * renderable single-cell glyph — as opposed to `unsupportedGlyphs`, where no
 * fold existed and the cell became `?`. In call order, one entry per
 * occurrence.
 */
export interface GlyphCanvasFoldedGlyph {
  /** The original grapheme cluster, before folding. */
  readonly from: string;
  /** The single-cell glyph actually written to the grid. */
  readonly to: string;
  readonly col: number;
  readonly row: number;
}

/**
 * The shape of a logged {@link GlyphCanvasRouteConflict}:
 *
 * - `"parallel"` — two or more groups whose masks are both plain straight
 *   transits on the SAME axis (two coincident `E|W` routes, say) — routes
 *   that overlap without ever sharing a node, as opposed to a `hop`-worthy
 *   crossing, which needs perpendicular axes.
 * - `"corner"` — exactly two groups where at least one is NOT a plain
 *   straight transit (a corner or stub meeting an unrelated transit or
 *   another corner).
 * - `"multi"` — three or more mutually unrelated groups at one cell.
 */
export type GlyphCanvasRouteConflictKind = "parallel" | "corner" | "multi";

/**
 * A junction cell where 2+ edges were present but did not all resolve into
 * one JOIN (so no single glyph describes them) in a shape `resolveJunctions`
 * cannot render without a priority-based choice. The ordinary
 * two-straight-transit crossing on PERPENDICULAR axes (the classic "wires
 * cross in open space" case) is NOT reported here — it is the expected,
 * routine case the hop glyph exists for. A later phase's router is expected
 * to treat a non-empty `routeConflicts` as "avoid this cell for these
 * edges."
 */
export interface GlyphCanvasRouteConflict {
  /** Every edge id present at the cell, in registration order. */
  readonly edgeIds: readonly string[];
  readonly col: number;
  readonly row: number;
  readonly kind: GlyphCanvasRouteConflictKind;
}

export interface GlyphCanvasReport {
  /**
   * Original (pre-fold) glyphs `canvas.text` could not place as a single
   * cell EVEN AFTER folding — the cell became `?`. In call order, one entry
   * per occurrence (not de-duplicated — a label repeating the same
   * unsupported character is a repeated symptom, not one).
   */
  readonly unsupportedGlyphs: string[];
  /** See {@link GlyphCanvasFoldedGlyph}. */
  readonly foldedGlyphs: GlyphCanvasFoldedGlyph[];
  /** See {@link GlyphCanvasRouteConflict}. */
  readonly routeConflicts: GlyphCanvasRouteConflict[];
  /**
   * Free-text notes for a documented no-op or degradation a caller might
   * otherwise mistake for a bug — e.g. `line()`'s `"double"` style has no
   * diagonal analogue and renders solid instead of throwing or silently
   * dropping the style.
   */
  readonly ledger: string[];
}

export function createGlyphCanvasReport(): GlyphCanvasReport {
  return { unsupportedGlyphs: [], foldedGlyphs: [], routeConflicts: [], ledger: [] };
}
