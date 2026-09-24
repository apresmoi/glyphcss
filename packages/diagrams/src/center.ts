/**
 * The ONE definition of "centre a diagram's content in the grid it was
 * given", shared by every form in this package.
 *
 * Every form lays out origin-relative and reports its own content extent;
 * the render then offsets that content so it sits centred in the requested
 * `width`/`height`. Before this was shared, the graph pipeline centred in
 * `render.ts`'s own `centered()` while the sequence form did the same
 * arithmetic inside its painter — USER FEEDBACK, verbatim: "check the
 * centering of these diagrams compared to the RAG pipeline and the rest,
 * the centering is completely different!" (measured at 120x30: a graph sat
 * at top 13 / left 21, a sequence at top 0 / left 42).
 *
 * Content LARGER than the grid gets offset 0 on that axis rather than a
 * negative one — a form that overflows is clipped or degraded by its own
 * ladder, never shifted off the top-left edge where the overflow would be
 * invisible.
 */
export interface GlyphDiagramCenterOffset { readonly dx: number; readonly dy: number }

export function glyphDiagramCenterOffset(
  content: { readonly width: number; readonly height: number },
  grid: { readonly width: number; readonly height: number },
): GlyphDiagramCenterOffset {
  return {
    dx: Math.max(0, Math.floor((grid.width - content.width) / 2)),
    dy: Math.max(0, Math.floor((grid.height - content.height) / 2)),
  };
}
