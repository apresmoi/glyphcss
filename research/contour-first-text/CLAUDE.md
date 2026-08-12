# contour-first-text — agent guide

Parent: [`../CLAUDE.md`](../CLAUDE.md). Exploratory only — nothing here is imported
by packages or the website.

## Goal

Find out whether glyphcss's outline-style render modes (`mode: "ink"`, and
wireframe/`charMode: "braille"`) should build **different geometry** for text than
solid mode does, instead of deriving an outline from a mesh that was triangulated
for filling.

## Why this direction exists

Ink and braille currently consume the SAME extruded, triangulated mesh that solid
mode uses. Measured on the bundled Roboto-Bold, one letter "a" at `depth: 20`,
`curveSteps: 3`, `simplify: 3`:

```
polys 138 | triangles 288 | unique edges 282 | shared 282 | boundary 0
```

`rasterizeInk` walks all 282 edges plus a per-triangle facing test, to draw an
outline whose real information content is two contour loops (outer + counter),
on the order of 40-60 points. The interior triangulation diagonals ARE correctly
dropped (coplanar → no crease, both front-facing → no silhouette), so today's
output is not wrong — the waste is upstream, in building and testing geometry that
provably cannot contribute to the result.

## The key insight

Fill and outline want OPPOSITE decimation:

- solid: interior triangulated; coarse curves are fine, fill hides the error.
- ink/braille: no interior at all; curves must be FINE, the outline shows the error.

One global `curveSteps`/`simplify` cannot serve both. This is why text looks
acceptable filled and chunky in outline at the same settings.

## Constraints

- Any proposal must keep the existing public API shape unless the user approves a
  change (AGENTS.md: architectural changes require approval).
- Byte-identical default output is a hard requirement in shipped code; a research
  spike may break it, but must say so.
- The renderer's one-write-per-`<pre>` invariant is not negotiable.
- Text is the motivating case, but note explicitly whether a finding generalizes to
  arbitrary meshes or is text-only.

## Where things go

Measurements and throwaway scripts under `experiments/`. Candidate approaches get a
file in `subpaths/`. Anything decided or ruled out gets a dated entry in
`decisions.md` — prune stale enthusiasm rather than appending to it.
