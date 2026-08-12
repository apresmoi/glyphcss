# contour-first-text

Status: exploring
Goal: decide whether outline modes (ink, wireframe/braille) should build contour
geometry directly for text instead of deriving an outline from a fill-triangulated mesh.
Current best approach: 05 shipped as `hiddenLines` for WIREFRAME/braille. Ink resists every
occlusion approach tried (04, and 05's technique reapplied) — its single stroke per silhouette
cell has no redundancy to absorb bias error. Remaining live leads: 01, 02.

## Subpaths

| # | Approach | Verdict |
|---|---|---|
| [00](./subpaths/00-baseline-measurement.md) | Measure what ink/braille actually process vs. what they draw | open |
| [01](./subpaths/01-contour-first-mesh.md) | Keep font contour polylines; extrude side walls only, skip fill triangulation | open |
| [02](./subpaths/02-2d-prism-silhouette.md) | Compute a flat extruded glyph's outline analytically in 2D, no 3D facing pass | open |
| [03](./subpaths/03-per-mode-decimation.md) | Let `curveSteps`/`simplify` differ per render mode | ruled-out |
| [04](./subpaths/04-hidden-line-removal.md) | Depth-test ink strokes so hidden contours stop drawing through | ruled-out (flat bias); revisit with slope bias |
| [05](./subpaths/05-wireframe-hlr-slope-bias.md) | Depth-test wireframe/braille with slope-scaled bias | LANDED as `hiddenLines` |
| [06](./subpaths/06-measured-glyph-atlas-matching.md) | Measure glyph shapes in the live font; match contour coverage per cell | ruled-out |

## Files

- [`overview.md`](./overview.md) — problem, success criteria, open questions
- [`decisions.md`](./decisions.md) — dated decision log
- [`references.md`](./references.md) — sources
- [`ideas/log.md`](./ideas/log.md) — raw idea log
- [`experiments/`](./experiments/) — throwaway measurement scripts
