# 04 — Hidden-line removal for ink (depth-tested strokes)

**Idea.** Ink currently draws every silhouette/crease edge it finds, including ones
BEHIND the surface. Depth-test each stroke against a solid depth prepass so only
visible contours survive.

**How it works.** `rasterizeInk` builds `charBuf`/`colorBuf` and calls
`applyCellHook(..., null /* depthSrc */, ...)` — there is no depth buffer at all
(`packages/glyphcss/src/render/rasterize.ts`). Run the solid rasterizer's depth
pass first (front-most surface depth per cell), then when an ink stroke wants a
cell, keep it only if the stroke's own depth is nearer than that surface depth plus
a small bias. Back-face contours and interior side-wall creases disappear.

**Evidence (measured, `experiments/01-curve-steps-vs-ink.mjs`, "GLYPH", Roboto-Bold):**

| depth | polys | edges | ink cells | ms |
|---|---|---|---|---|
| 20 | 197 | 407 | 482 | 2.64 |
| 4  | 197 | 407 | 364 | 2.16 |
| 0  | 88  | 298 | 297 | 1.07 |

Flat text (`depth 0`) renders clean single strokes. Extruded text renders visible
tram-lines — front contour, back contour and side walls drawn together. The ~60%
extra inked cells at depth 20 vs depth 0 are largely strokes that should be hidden.

**Fit.** GENERAL, not text-only — any closed mesh has back-facing silhouettes that
currently draw through. This is the classic hidden-line-removal problem, and it is
what "render the contours, not every shape's contour" actually means.

**Pros / cons.**
- Pro: fixes the dominant visual defect, and fixes it for all meshes.
- Pro: reuses machinery that already exists (the solid depth pass).
- Pro: unlocks the ink/solid hybrid the effects design pass wants (interior cells
  gain real coverage, so effect-driven hatching becomes possible).
- Con: ink stops being a cheap standalone pass — it needs a depth prepass, so cost
  goes UP, not down. Directly opposes subpaths 01/02, which chase less geometry.
- Con: needs a depth bias; too small self-occludes the silhouette, too large leaks
  back edges. Classic acne/peter-panning trade-off.

**References.** `rasterizeInk` and `rasterizeSolid`'s depth buffer in
`packages/glyphcss/src/render/rasterize.ts`.

**Verdict.** RULED OUT as implemented (2026-08-01) — a FLAT depth bias regresses every
convex mesh (cube -32%, icosahedron -27%, sphere -46%) because those never had hidden
lines to begin with; ink's facing test already excluded them, so HLR only eats real
silhouette. Cost was not the blocker (the motivating case got faster). Revisit only
with a SLOPE-AWARE bias. See `../decisions.md`.

**UPDATE 2026-08-01:** the slope-aware bias was tried on the WIREFRAME path and it
works — cube +0, icosahedron -2..-4, sphere -1..-5 against ground truth, where flat
bias regressed at every magnitude. Depth testing for outline modes is therefore NOT
wrong; this subpath's flat bias was. Applying the same slope-scaled bias back to ink
was the obvious follow-up — and it FAILED TOO (2026-08-02): sphere -38..-42% at slope 0.5,
and the slope that rescues the sphere stops fixing extruded text. Structural, not tuning:
wireframe's dense overlapping edges backfill a wrongly-hidden edge, ink's single stroke per
silhouette cell has no such redundancy. A future attempt must change the structure, not the
constants.
