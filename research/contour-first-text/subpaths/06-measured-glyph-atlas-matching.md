# 06 — Measured glyph-shape atlas matching for ink

**Idea.** Stop picking ink glyphs from a quantized tangent angle. Measure each
candidate glyph's SPATIAL coverage in the real font, rasterize the contour into the
same subcell grid per cell, and pick the glyph whose shape best matches.

**Why the current approach wobbles.** `inkGlyphForTangent` folds the smoothed tangent
into four 45-degree buckets (horizontal / `\` / vertical / `/`) and only uses sub-cell
position for the horizontal bucket (`‾`/`-`/`_`). So a vertical stroke at a cell's left
edge and one dead centre both render `|` — sub-cell position is discarded in three of
four buckets. That is visible as instability even when the text is viewed head-on,
with no 3D rotation involved, which is what the user reported.

**Prior art (chafa, LGPL-3.0 — read for mechanism, never copy code or tables).**
Each symbol is stored as an 8x8 bitmap (`CHAFA_SYMBOL_OUTLINE_8X8` in
`chafa/internal/chafa-symbols-ascii.h`) with a precomputed `popcount`; per cell it
picks the symbol minimizing error against the cell's coverage, then derives fg/bg by
partitioning the cell's pixels into the symbol's covered and uncovered sets
(`work_cell_get_dominant_channels_for_symbol` / `work_cell_get_nth_sorted_pixel`).

Two observations that matter for us:
1. Their atlas is HAND-AUTHORED to match one specific font — the header states the
   bitmaps are "a close match to the Terminus font (specifically ter-x14n.pcf)". Quality
   is therefore tied to a font they cannot verify the user has. We can MEASURE the atlas
   from the live font stack, which is strictly more general.
2. Their own source carries `/* This is extremely slow and makes almost no difference */`
   above the dominant-channel step — a warning not to port the colour machinery. Ink is
   one colour per cell and needs none of it.

**How it works for us.** Extend `measureGlyphInkCoverage` (already shipped in
`@glyphcss/effects` for calibrated ramps) from returning ONE scalar to returning an
NxM subcell mask per glyph, measured on the same offscreen canvas. Reuse
`drawSubcellLine` (from braille, currently 2x4) at the atlas resolution to rasterize
the contour per cell. Pick `argmin` over the atlas.

**Fit.** Attacks head-on quality directly, unlike subpaths 01/02/04/05 which are all
about geometry cost or occlusion. Font-aware by construction. Subsumes the tangent
quantizer rather than tuning it.

**Pros / cons.**
- Pro: sub-cell accurate — a stroke near a cell edge can pick `,` or `'` instead of `|`.
- Pro: reuses three things we already have (canvas measurement rig, subcell rasterizer,
  calibration precedent).
- Pro: generalizes to any glyph set the font actually has, not a fixed authored list.
- Con: argmin per cell over an atlas is costlier than a bucket lookup. Atlas is small
  and cacheable, but this needs measuring, not assuming.
- Con: a per-cell independent argmin can pick locally-best but globally-noisy glyphs —
  neighbouring cells may not form a continuous stroke. May need a continuity term.
- Con: measurement is browser-only; a static `compileScene` bake needs the atlas passed
  as data (same constraint calibrated ramps already solved by shipping a string).

**References.** `research/_prior-art/chafa` (clone, depth 1);
`packages/effects/src/calibrateRamp.ts`; `inkGlyphForTangent` and `drawSubcellLine` in
`packages/glyphcss/src/render/rasterize.ts`.

**Verdict.** RULED OUT (2026-08-02). Worse than the tangent quantizer on all four cases
and 1.1x-3x slower; near-empty punctuation wins argmin against thin strokes and per-cell
matching breaks stroke continuity. Its conclusion produced the fix that DID work — sub-cell
column discrimination for the vertical bucket, landed in db5703c. See `../decisions.md`.
