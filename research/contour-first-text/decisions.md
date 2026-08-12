# Decisions

## 2026-08-01 — direction opened

Opened after shipping `mode: "ink"` and `charMode: "braille"` and demoing both on
`/wordart`. User observation, which this direction exists to test: outline modes
"render a lot more than the contours", and braille in particular "should actually
compute the geometry differently — the shapes we need to contour are not the same
as in fill mode".

Baseline measured immediately (bundled Roboto-Bold, `size: 100`, `curveSteps: 3`,
`simplify: 3`):

| case | polys | triangles | unique edges | shared | boundary |
|---|---|---|---|---|---|
| "a" flat (depth 0) | 66 | 144 | 210 | 66 | 144 |
| "a" extruded (depth 20) | 138 | 288 | 282 | 282 | 0 |
| "GLYPH" extruded | 145 | 316 | 303 | 303 | 0 |

Framing recorded: today's ink OUTPUT is correct — interior diagonals are coplanar
and both-front-facing, so they are already dropped. The claim under test is about
COST and FIDELITY, not correctness. Nothing has been ruled in or out yet.

## 2026-08-01 — first spike run: 03 refuted, 04 opened

Ran `experiments/01-curve-steps-vs-ink.mjs` ("GLYPH", Roboto-Bold, 92x26 grid, ink).

**Subpath 03 (per-mode curve decimation) is RULED OUT at normal cell sizes.**

| curveSteps | polys | edges | ink cells | ms/render |
|---|---|---|---|---|
| 3 | 145 | 303 | 480 | 1.94 |
| 6 | 197 | 407 | 482 | 1.92 |
| 12 | 298 | 614 | 495 | 2.59 |

Doubling tessellation doubles geometry and costs +34% time for +3% inked cells, and
the `curveSteps 12` render is arguably noisier (more doubled strokes). The GLYPH GRID
is the limiting resolution, not curve sampling. The premise — "outline modes need
finer curves because the outline shows the error" — does not hold at these cell
sizes. It may return at very high density; not pursued.

**Subpath 04 (hidden-line removal) opened, and it is the real finding.**
Varying extrusion depth at fixed tessellation isolated the actual defect: ink draws
front contour, back contour AND side walls at once, because `rasterizeInk` has no
depth buffer (it passes `null` as `depthSrc`). Extruded text tram-lines; flat text
(`depth 0`) is clean — 297 inked cells vs 482, on the same tessellation.

| depth | polys | edges | ink cells | ms |
|---|---|---|---|---|
| 20 | 197 | 407 | 482 | 2.64 |
| 4 | 197 | 407 | 364 | 2.16 |
| 0 | 88 | 298 | 297 | 1.07 |

This is general to any closed mesh, not text-only, and it REVERSES the direction's
original cost framing: 04 makes ink more expensive (it needs a depth prepass) while
01/02 chase less geometry. Correctness of the picture comes first; revisit after.

## 2026-08-01 — subpath 04 spiked and RULED OUT (flat bias); slope-aware bias is the open door

Implemented hidden-line removal for ink behind internal `__inkHiddenLineRemoval` /
`__inkHiddenLineBias`, reusing the existing `fillDepthTri` triangle-depth rasterizer
(a second caller, not a new one), sampled once per output cell — ink emits one glyph
per cell, so supersampled depth would collapse back to one sample anyway. Measurement
script: `experiments/04-ink-hlr.mjs`.

| case | before | after (bias 0.03) | verdict |
|---|---|---|---|
| GLYPH depth 20 | 482 | 363 | helps (baseline 297) |
| GLYPH depth 4 | 364 | 359 | marginal |
| Cube | 115 | 78 | REGRESSION |
| Icosahedron | 176 | 129 | REGRESSION |
| Sphere (subdiv 2) | 78 | 36 | REGRESSION, worst |

**The insight that kills the flat-bias approach:** convex closed meshes never had a
hidden-line problem in the first place. Ink's front/back-facing classification already
excludes all-back-facing edges BEFORE this pass runs, so every cell HLR removes on a
cube/icosahedron/sphere is self-occlusion acne eating genuine silhouette — 46% of the
sphere's limb at the chosen bias. The sphere is the canary exactly as predicted: a
smooth silhouette lies ON the surface it outlines.

No bias in [0.005, 0.8] separates the cases. That is structural, not a missed constant:
a flat depth-fraction bias is not slope-aware, so it cannot distinguish "this stroke IS
the surface it outlines, viewed at a grazing angle" from "this stroke is genuinely
behind the surface".

Cost was NOT the blocker — GLYPH depth 20 got *faster* (2.2ms -> 1.6ms), because dropping
tram-line segments early skips the expensive tangent-smoothing glyph pick for them.

Spike code reverted from `rasterize.ts` to keep the tree clean; the finding and the
measurement script are the artefacts worth keeping. Re-adding a depth prepass is not
the hard part of a future attempt.

**Open door:** slope-scaled depth bias (standard shadow-map technique) — derive per-cell
bias from the local screen-space depth gradient so grazing silhouette gets a larger
allowance than a head-on crease. Materially different design; not attempted.

**Reframing for the direction:** the tram-lines that motivated 04 are specific to
EXTRUDED geometry, where the back contour is a legitimate silhouette that happens to be
occluded by the front face. That is a narrower problem than "ink draws hidden lines",
and subpath 02 (analytic prism silhouette) or simply not extruding for outline modes may
address it without a depth test at all.

## 2026-08-01 — subpath 05: wireframe/braille HLR with SLOPE-SCALED bias works

User found the same missing-depth defect in a second mode: at
`/wordart?text=Glyph%0ACSS&depth=80&mode=wireframe&charmode=braille`, a letter BEHIND
in 3D paints its extrusion side walls over a letter in FRONT. Confirmed in code — the
wireframe path (and braille, its subcell encoding) has ZERO depth references; edges
draw in mesh order, last writer wins the cell.

Spiked opt-in HLR for the wireframe path behind internal flags
(`__wireframeHiddenLineRemoval`, `__wireframeHiddenLineBias`,
`__wireframeHiddenLineSlopeScale`, `__wireframeHiddenLineSubcellDepth`).
Script: `experiments/05-wireframe-hlr.mjs`.

**The decisive result — slope-scaled bias separates the cases where flat bias could not:**

| shape | ground truth | flat bias (ANY magnitude) | slope 0.5 |
|---|---|---|---|
| cube | 115 | 83-104 (-11..-32) REGRESSION | 115 (+0) |
| icosahedron | 177 | 133-172 (-5..-44) REGRESSION | 173-175 (-2..-4) |
| sphere | 431 | 273-419 (-12..-158) REGRESSION | 426-430 (-1..-5) |

`bias + slopeScale * |grad depth|` converges within ~0-4% of ground truth even with a tiny
flat term — the GRADIENT term does the real work. This confirms subpath 04's stated open
door and reverses its ruling: 04 failed because the bias was flat, not because depth
testing is wrong for outline modes.

User's motivating case ("Glyph\nCSS", depth 80, curveSteps 4, wireframe+braille):
inked cells 902 -> 777 with cross-letter side-wall bleed-through removed.

Braille depth resolution: shipped PER-CELL, not per-subcell. Measured 777 vs 786 inked
cells (1.2% difference) for 25% more cost (0.916ms vs 0.733ms) — braille strokes are
already ~1 subcell wide, so a whole glyph can share one occlusion decision.

Cost: base ~0.16ms -> ~0.60ms braille / ~0.43ms ASCII on a 100x34 grid. Large relative,
small absolute; the gradient lookup dominates. NOT re-measured on a heavy scene.

Methodology note worth keeping: the maker's first ground truth was wrong — it leaked
fan-triangulation diagonals and inflated the reference count. Caught by a sanity check
(front-only edges cannot exceed all edges). The corrected ground truth uses real boundary
edges only.

**Status: promising, not ship-ready.** Open before shipping: choose and validate a default
`slopeScale` (0 is actively wrong and must not be the implicit behaviour), decide the
public API shape (user's call per AGENTS.md), mirror React/Vue/custom-element, and
re-measure cost on a heavier scene.

## 2026-08-02 — 06 ruled out; sub-cell buckets LANDED; 04's revival also fails

**Subpath 06 (measured glyph-atlas matching) RULED OUT.** Extended
`measureGlyphInkCoverage` to return an NxM subcell mask, rasterized the contour into the
same grid, picked glyphs by argmin. Worse than the 4-bucket tangent quantizer on all four
cases including the reported head-on text, and 1.1x-3x slower.
Root cause: near-empty punctuation (`.` `'` `,`) trivially minimizes error against a thin
antialiased stroke — `.` alone won 40 of ~120 covered cells. A stroke-only candidate pool
narrowed but did not close the gap. Independent per-cell argmin also broke stroke
continuity (holes in sphere/cube silhouettes that were unbroken before), confirming the
risk the subpath file had flagged as hypothetical. 4x4 atlas was worse than 8x8, not just
cheaper — it collapsed selection to 2-3 glyphs.
Prior-art note: chafa's atlas is HAND-AUTHORED for Terminus (`chafa-symbols-ascii.h`
header says so), and its own source carries `/* This is extremely slow and makes almost no
difference */` over the colour-partition step. Measuring the atlas from the live font is
more general than their approach, and still lost — the problem is the metric, not the atlas.

**Sub-cell tangent buckets LANDED (commit db5703c).** The fix 06's own conclusion pointed
at: give the vertical bucket fractional-COLUMN discrimination (`▏` / `|` / `▕`), mirroring
what horizontal already did with fractional row (`‾` / `-` / `_`). Glyphs verified
font-distinct in Menlo by outline bbox, not assumed: `▏` inks x in [-20,138], `▕` in
[1094,1252], `|` in [530,702] on a 1233-unit advance. Head-on `|   ||/` -> `▏   ▏▕/`.
Diagonals get NO sub-cell variant — none exists in ASCII/Unicode, and a diagonal already
spans its cell corner-to-corner so there is no position left to express. Cube render is
byte-identical (its silhouette at that rotation is all diagonal), confirming the change
perturbs only what it should.

**Subpath 04's revival (05's "open door") ALSO FAILS — structural, not tuning.** Applied
the shipped slope-scaled bias to ink at `HLR_BIAS 0.03` / `HLR_SLOPE_SCALE 0.5`:

| shape | show | hide | delta |
|---|---|---|---|
| cube | 115 | 113 | -2 |
| icosahedron | 176 | 175 | -1 |
| sphere (subdiv 2) | 78 | 48 | **-30 (-38.5%)** |
| sphere (subdiv 3) | 78 | 45 | **-33 (-42.3%)** |

The sphere canary fails again at nearly the flat-bias magnitude (-46%). A broad sweep shows
it is structural: slope >=1.5-2.5 rescues the sphere (delta 0..-1) but then the motivating
extruded-text case barely improves (482->474, -1.7%, vs -7.9% at slope 0.5) and the tram-lines
in the "P" loop remain. No single value does both.

**Why it works for wireframe and not ink:** wireframe draws MANY overlapping mesh edges near
a silhouette, so a wrongly-hidden edge is backfilled by a neighbour. Ink draws exactly ONE
non-redundant stroke per silhouette cell — there is no redundancy to absorb the bias's error.
That asymmetry is the finding, and it means a future attempt must change the STRUCTURE (e.g.
a synthetic backup stroke, or width/coverage-based occlusion instead of a single centreline
depth sample), not retry slope-scaled bias with different constants.

`hiddenLines` therefore stays correctly unwired for `mode: "ink"`; the existing "known gap"
wording in AGENTS.md and the website docs remains accurate and needed no change.

## 2026-08-02 — line-glyph census: no new ANGLES exist, but finer SUB-POSITIONS do

Measured every candidate codepoint by rasterizing it in the real font (Menlo, the
website's stack) and taking PCA of the inked pixels — principal-axis angle, eccentricity,
coverage, centroid. Script: `experiments/11-line-glyph-census.mjs`.
Filter for "thin line": coverage 1-20% of the cell, eccentricity > 0.55.

**Angles available are still only four.** 0 deg, ~64 deg, 90 deg, ~115 deg — box-drawing
diagonals (U+2571/2572) measure the same as ASCII `/` and `\`. Arcs (U+256D-2570) come out
71-77 deg but are curves, not lines, and their eccentricity is low (0.73-0.84).

**Two families are simply absent from the font:**
- Symbols for Legacy Computing (U+1FB00-1FBAF): **0** thin-line glyphs — the diagonal
  segments at non-45-degree slopes that motivated checking do not render at all.
- Scan lines (U+23BA-23BD): **0**.
Both were hypotheses worth testing; both are dead in this font stack. Anything relying on
them would need a bundled font, not the user's.

**What IS new is sub-cell position:**

| axis | already used | census found |
|---|---|---|
| horizontal | `‾` `-` `_` | + `▔` (row 0.39), `▁` (row 0.84) |
| vertical | `▏`(col .02) `|`(.31) `▕`(.56) | + `▎`(.06) `▍`(.10) |

So the earlier prediction ("more positions, not more angles") is CONFIRMED by measurement.
The remaining headroom in ink glyph choice is finer sub-cell quantization, not finer angle
quantization.

## 2026-08-02 — prior-art source mining: nothing new for braille or contours

Cloned the permissive prior-art repos to `research/_prior-art/` (depth 1, locally
excluded) and read SOURCE rather than READMEs, after chafa proved README-level survey
misses the actual algorithm.

| repo | licence | mechanism read | new to us? |
|---|---|---|---|
| chafa | LGPL-3.0 | 8x8 hand-authored atlas for Terminus; per-cell argmin + fg/bg pixel partition | technique tried, RULED OUT (subpath 06) |
| mapscii | MIT | `BrailleBuffer.js:32-99` identical 2x4 bitmask, no AA; colour last-write-wins, no depth | no |
| drawille | **AGPL-3.0** | `drawille.py:43-165` textbook bitmask, no colour | no |
| ascii-art (khrome) | MIT | `README:224-277` threshold is a fixed 0-255 cutoff, not adaptive, not dithered | no |

**Bottom line: the braille dot-selection question is a dead end in prior art.** All of them
use the same trivial bitmask we already exceed; mapscii in particular resolves cell colour
by last-write-wins with no depth, which is the exact bug class we fixed in wireframe and ink.

**The two problems we care about are unsolved by everything read:** drawing a continuous
thin line across cells without holes, and choosing among same-weight glyphs by angle. Those
stay our own problem — consistent with the census finding that only four line angles exist
in the font at all.

One incidental technique we lack: mapscii `Canvas.js:94-146` implements Zingl-style
perpendicular-error line THICKENING. Addresses line weight, not continuity. Parked.

Licence note: drawille is AGPL-3.0, the strictest in the survey — mechanism-read only, avoid
even close paraphrase. chafa LGPL-3.0, cfonts/boxes GPL-3.0. Everything taken across this
whole survey has been a concept, never code or data.
