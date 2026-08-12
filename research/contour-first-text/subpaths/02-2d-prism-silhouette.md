# 02 — Analytic 2D silhouette of a flat extruded glyph

**Idea.** For `profile: "flat"`, compute the visible outline analytically in 2D
instead of running a 3D per-triangle facing pass.

**How it works.** A flat extrusion is a prism. Its screen silhouette is the front
contour, the back contour translated by the projected depth vector, and connecting
edges at the contour points where the tangent aligns with the view direction.
No facing test, no shared-edge adjacency map.

**Fit.** Would remove the entire silhouette pass for the most common text case.
Explicitly text-and-flat-profile-only; does not generalize to arbitrary meshes.

**Pros / cons.**
- Pro: potentially the largest win; turns an O(edges) 3D pass into an O(contour) 2D one.
- Pro: exact — no quantization of a discretized silhouette.
- Con: narrow applicability (flat profile only); bevels break the assumption.
- Con: needs careful handling of self-overlapping contours (the same
  nonzero-winding case that broke `groupShapes` and emptied the /wordart tiles).
- Con: a second code path with its own failure modes.

**References.** Prism silhouette prior art not yet surveyed **(unverified)**.

**Verdict.** open — highest ceiling, highest risk; research after 01.
