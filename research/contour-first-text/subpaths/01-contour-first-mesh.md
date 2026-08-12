# 01 — Contour-first mesh (skip fill triangulation for outline modes)

**Idea.** For outline modes, keep the font's contour polylines and extrude only the
side walls; never run the fill triangulation whose diagonals are discarded anyway.

**How it works.** `packages/fonts/src/extrude.ts` already has contours before
`groupShapes`/fill. An outline-oriented mesh builder would emit the contour loops
(front and back) plus quad side walls, skipping the front/back face triangulation.

**Fit.** Directly targets the measured waste (282 edges to draw ~2 loops). Text-only
as stated, though the general principle — "outline modes shouldn't consume fill
triangulation" — may extend to any mesh that carries its own boundary.

**Pros / cons.**
- Pro: strictly less geometry; likely faster and lower memory.
- Pro: removes any chance of triangulation artifacts reaching the outline.
- Con: a second mesh path to keep in sync with the fill path.
- Con: bevelled/rounded profiles have genuine 3D creases that the side-wall-only
  mesh must still represent — may only fully pay off for `profile: "flat"`.
- Con: could change output, which shipped code forbids by default.

**References.** `groupShapes` (`extrude.ts:599`) and the contour → shape step.

**Verdict.** open — most promising, but gated on 00 showing the cost is real.
