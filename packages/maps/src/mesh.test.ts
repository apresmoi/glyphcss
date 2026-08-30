import { describe, expect, it } from "vitest";
import type { Vec3 } from "glyphcss";
import { glyphMapPolygons } from "./mesh";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator } from "./projection";
import type { GlyphMapGeoTile } from "./tile";

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number, elevationFn: (lon: number, lat: number) => number): GlyphMapGeoTile {
  const vcols = cols + 1;
  const vrows = rows + 1;
  const elevation = new Float32Array(vcols * vrows);
  for (let row = 0; row < vrows; row++) {
    const lat = bounds.north - ((bounds.north - bounds.south) * row) / rows;
    for (let col = 0; col < vcols; col++) {
      const lon = bounds.west + ((bounds.east - bounds.west) * col) / cols;
      elevation[row * vcols + col] = elevationFn(lon, lat);
    }
  }
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

function cross(u: Vec3, v: Vec3): Vec3 {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
function sub(u: Vec3, v: Vec3): Vec3 {
  return [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
}
function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

describe("glyphMapPolygons", () => {
  it("emits one quad per tile cell", () => {
    const tile = makeTile({ west: 0, east: 10, south: 0, north: 10 }, 4, 3, () => 0);
    const polygons = glyphMapPolygons(tile, glyphMapGlobe());
    expect(polygons.length).toBe(4 * 3);
    for (const p of polygons) expect(p.vertices.length).toBe(4);
  });

  it("vertex order is exactly [nw, sw, se, ne]", () => {
    const globe = glyphMapGlobe();
    const tile = makeTile({ west: 10, east: 12, south: 10, north: 12 }, 2, 2, () => 0);
    const polygons = glyphMapPolygons(tile, globe);
    // Cell (col=0, row=0) of a 2x2-quad, 1-degree-per-quad tile spans
    // lon [10, 11], lat [11, 12] (row 0 is the NORTHERNMOST row).
    const [nw, sw, se, ne] = polygons[0].vertices;
    expect(nw).toEqual(globe.project(10, 12, 0));
    expect(sw).toEqual(globe.project(10, 11, 0));
    expect(se).toEqual(globe.project(11, 11, 0));
    expect(ne).toEqual(globe.project(11, 12, 0));
  });

  it("winds CCW-from-outside on the globe (outward-facing normal, checked over BOTH fan triangles)", () => {
    const tile = makeTile({ west: 10, east: 12, south: 10, north: 12 }, 2, 2, () => 0);
    const polygons = glyphMapPolygons(tile, glyphMapGlobe());
    for (const polygon of polygons) {
      const [v0, v1, v2, v3] = polygon.vertices;
      const center: Vec3 = [
        polygon.vertices.reduce((s, v) => s + v[0], 0) / 4,
        polygon.vertices.reduce((s, v) => s + v[1], 0) / 4,
        polygon.vertices.reduce((s, v) => s + v[2], 0) / 4,
      ];
      // For a convex outward-bulging quad on a sphere centered at the
      // origin, an outward-facing fan triangle's normal points the same
      // general direction as the quad's own centroid (both point "away from
      // the sphere's center"). Both triangles of the CCW fan must agree.
      expect(dot(cross(sub(v1, v0), sub(v2, v0)), center)).toBeGreaterThan(0);
      expect(dot(cross(sub(v2, v0), sub(v3, v0)), center)).toBeGreaterThan(0);
    }
  });

  it("winds toward the camera on a flat sheet too (equirectangular/Mercator) — found live on /maps: the naive [nw,sw,se,ne] order is CW, not CCW, as seen from above (+Z looking down -Z), backface-culling the ENTIRE mesh under a non-orbit camera", () => {
    // Independent ground truth, not the fix's own probe: every flat
    // projection in this file returns relief along +Z (`reliefZ`), so the
    // correct outward normal for ANY quad, anywhere, is dot(normal, +Z) > 0
    // — a fact about the projections' shared convention, not about how
    // `glyphMapPolygons` happens to compute it internally.
    const up: Vec3 = [0, 0, 1];
    for (const projection of [glyphMapEquirectangular(), glyphMapMercator()]) {
      const tile = makeTile({ west: 10, east: 12, south: 10, north: 12 }, 2, 2, () => 0);
      const polygons = glyphMapPolygons(tile, projection);
      expect(polygons.length).toBeGreaterThan(0);
      for (const polygon of polygons) {
        const [v0, v1, v2, v3] = polygon.vertices;
        expect(dot(cross(sub(v1, v0), sub(v2, v0)), up)).toBeGreaterThan(0);
        expect(dot(cross(sub(v2, v0), sub(v3, v0)), up)).toBeGreaterThan(0);
      }
    }
  });

  it("colors each quad from its 4 corners' average elevation", () => {
    const tile = makeTile({ west: 0, east: 2, south: 0, north: 2 }, 2, 2, (lon) => (lon < 1 ? -100 : 100));
    const polygons = glyphMapPolygons(tile, glyphMapGlobe(), {
      color: (elev) => (elev < 0 ? "#0000ff" : "#00ff00"),
    });
    expect(polygons.every((p) => p.color === "#0000ff" || p.color === "#00ff00")).toBe(true);
  });

  it("leaves polygons uncolored when no color callback is given", () => {
    const tile = makeTile({ west: 0, east: 1, south: 0, north: 1 }, 1, 1, () => 0);
    const polygons = glyphMapPolygons(tile, glyphMapGlobe());
    expect(polygons[0].color).toBeUndefined();
  });

  it("crops (skips) a quad with any corner outside the projection's valid window, never clamping", () => {
    // A tile straddling Mercator's ±85.0511° cutoff: the northern row of
    // quads has at least one corner beyond the limit.
    const tile = makeTile({ west: 0, east: 10, south: 80, north: 90 }, 2, 2, () => 0);
    const mercator = glyphMapMercator();
    const polygons = glyphMapPolygons(tile, mercator);
    // Only the southernmost row (2 quads) stays fully inside [80, 85.0511...].
    expect(polygons.length).toBeLessThan(2 * 2);
    for (const p of polygons) {
      for (const v of p.vertices) {
        expect(v.every((c) => Number.isFinite(c))).toBe(true);
      }
    }
  });
});
