# 05 — Wireframe/braille hidden-line removal with slope-scaled bias

**Idea.** Depth-test wireframe (and braille) strokes against a surface depth prepass,
using a SLOPE-SCALED bias so grazing silhouette is not eaten as self-occlusion.

**How it works.** Reuse `fillDepthTri` for a per-output-cell surface depth buffer; each
stroke sample keeps its cell only if nearer than `surfaceDepth + bias + slopeScale *
|grad depth|`. The gradient term is what distinguishes "this stroke IS the surface it
outlines, seen edge-on" (large local depth gradient, large allowance) from "this stroke
is genuinely behind" (flat gradient, small allowance).

**Evidence.** Against corrected ground truth (real boundary edges only):
cube 115 -> 115, icosahedron 177 -> 173-175, sphere 431 -> 426-430 at slopeScale 0.5.
Flat bias regressed at every magnitude (cube -11..-32, sphere -12..-158). User's
extruded "Glyph/CSS" case: 902 -> 777 inked cells, cross-letter bleed-through gone.

**Fit.** General to any closed mesh; opt-in so meshes that never needed it pay nothing.

**Pros / cons.**
- Pro: fixes a real, user-visible defect in both wireframe and braille.
- Pro: validates the technique for ink too (subpath 04 can be revived).
- Con: cost +160-273% relative on the measured grid (0.16ms -> 0.43-0.60ms); absolute
  cost small but NOT measured on a heavy scene.
- Con: needs a sane default `slopeScale` — 0 is actively wrong and must not be implicit.
- Con: adds a public option, which is an architecture decision (AGENTS.md).

**References.** `experiments/05-wireframe-hlr.mjs`; slope-scaled depth bias is the
standard shadow-map technique.

**Verdict.** promising — pending the user's API decision and a heavy-scene cost check.
