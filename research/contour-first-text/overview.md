# Overview

## Problem

`mode: "ink"` and wireframe/`charMode: "braille"` render outlines, but consume the
same extruded + triangulated mesh that solid mode fills. For text this is
measurably lopsided: a single extruded "a" yields 282 unique edges and 288
triangles to produce an outline worth ~2 contour loops.

Two distinct costs:

1. **Wasted work** — building fill triangulation, then walking every edge and
   running a per-triangle facing test to discard nearly all of it.
2. **Wrong fidelity knob** — `curveSteps`/`simplify` are tuned once, for fill.
   Outline modes need finer curves and no interior; fill needs the opposite.

## Success criteria

A finding counts as validated when it has:

- a measured cost delta (edges processed, triangles built, wall-clock) on the same
  scene, not an estimate;
- a rendered before/after showing outline quality is equal or better;
- an honest statement of whether it is text-only or generalizes to any mesh;
- an explicit note on whether the shipped default output would change.

Failing to beat the baseline is a perfectly good outcome — record it and rule the
subpath out.

## Abstract approach

Text carries its outline analytically: the font gives contour polylines BEFORE
`earcut` ever runs. Outline modes could consume those directly. For a flat-profile
extrusion the visible silhouette is also analytically describable (front contour,
back contour offset by the projected depth vector, plus connecting edges at the
tangent points), which may remove the 3D silhouette pass entirely for the common case.

## Open questions

- Does the contour-first path generalize past `profile: "flat"` (bevels, rounded
  profiles add real 3D creases)?
- Do triangulation diagonals leak into wireframe/braille today, or does the
  feature-edge angle threshold already drop them? (Believed dropped — verify.)
- Is the cost actually visible in a frame budget, or is it noise next to
  rasterization? Measure before optimizing.
- Would a contour-first path need its own public option, or can it be an internal
  fast path chosen automatically when the mesh is text-like?
