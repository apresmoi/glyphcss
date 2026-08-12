# 00 — Baseline: what ink/braille process vs. what they draw

**Idea.** Before optimizing anything, instrument the real ratio: edges built, edges
tested, edges kept, and wall-clock, for ink and braille on text.

**How it works.** Extend the throwaway probe in `experiments/` to also run the
renderer's own silhouette/crease classification for a given camera, so we get
"kept" and not just "considered". Compare against the contour-loop count the font
provides directly.

**Fit.** Cheapest possible step and it gates every other subpath — if the cost is
noise next to rasterization, subpaths 01/02 are premature optimization and only 03
(fidelity) survives.

**Pros / cons.** Pro: converts opinion into numbers; cheap. Con: none, other than
that it may make the exciting subpaths moot — which is the point.

**References.** `rasterizeInk` in `packages/glyphcss/src/render/rasterize.ts`;
baseline table in `../decisions.md`.

**Verdict.** open — do this first.
