# @glyphcss/fonts — agent guide

Font or text → extruded polygon meshes. General rules are in the root `AGENTS.md`.

## Invariants

- Output meshes are **Z-up**: world Z = letter height, Y = letter width, X = extrusion depth. A camera looking at flat unrotated text needs `rotX: 90`.
- Every polygon carries UVs: planar on the caps, strip-mapped on the walls.
- Reference consumer: `website/src/components/WordArtWorkbench`.
