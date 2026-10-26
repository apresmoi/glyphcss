import { expect, it } from "vitest";
import { createGlyphMapWaterCoverage, partitionGlyphMapWaterTerrain } from "./waterTerrain";

it("merges only convex dry fragments within each original terrain triangle", () => {
  const bounds = { west: 0, east: 2, south: 0, north: 2 };
  // The dry bank has two inward corners. Joining every adjacent slab
  // would leave a concave fan that paints across those water notches.
  const ring = [[0, 1], [.5, .5], [1, 1], [1.5, .5], [2, 1], [2, 2], [0, 2], [0, 1]] as const;
  const coverage = createGlyphMapWaterCoverage(bounds, [{ geometryType: "polygon", rings: [ring] }]);
  const pieces = partitionGlyphMapWaterTerrain(bounds, [coverage])!;
  let area = 0;
  for (const { ring, land } of pieces) {
    expect(land).toBe(true);
    expect(ring.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThanOrEqual(-1e-14);
      area += (a[0] * b[1] - b[0] * a[1]) / 2;
    }
    expect(ring.every(([x, y]) => x + y <= 2 + 1e-14)
      || ring.every(([x, y]) => x + y >= 2 - 1e-14)).toBe(true);
  }
  expect(area).toBeCloseTo(1.5, 12);
});
