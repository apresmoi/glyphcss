import { extrudeContours } from "../../../packages/fonts/src/extrude.ts";

// Synthetic "glyph" shape: a simple square outer contour, no holes — stands
// in for one letterform in the type plane (world units), same shape the
// composeText() pipeline hands to extrudeContours() per glyph.
const square = {
  outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
  holes: [],
};

function report(label, polys) {
  const withUv = polys.filter((p) => p.uvs !== undefined).length;
  console.log(`${label}: ${polys.length} polygons, ${withUv} carry uvs`);
}

// Solid-colour text (no material.texture) — the repro's config (color-only,
// no texture URL).
const solid = extrudeContours([square], {
  depth: 10,
  profile: "flat",
  profileSegments: 1,
  maxInset: 4.5,
  stops: [{ at: 0.5, color: "#1d6b3a" }],
  faceUvBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
});
report("solid-color (no texture)", solid);

// Textured stop, for comparison — should already carry uvs before and after.
const textured = extrudeContours([square], {
  depth: 10,
  profile: "flat",
  profileSegments: 1,
  maxInset: 4.5,
  stops: [{ at: 0.5, texture: "data:image/png;base64,x", tile: 0 }],
  faceUvBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
});
report("textured", textured);
