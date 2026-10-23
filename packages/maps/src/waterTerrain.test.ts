import { expect, it } from "vitest";
import { createGlyphMapWaterCoverage, partitionGlyphMapWaterTerrain } from "./waterTerrain";
import { glyphMapPolygons, glyphMapTerrainPolygons } from "./mesh";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";

const bounds = { west: 0, east: 2, south: 0, north: 2 };
const source: GlyphMapGeoTile = { bounds, cols: 1, rows: 1, elevation: new Float32Array(4).fill(-1000), source: "test", sampler: "nearest" };
const projection = glyphMapEquirectangular();
const color = (e: number) => e < 0 ? "#0000ff" : "#00ff00";

it("floors below-datum dry land without an elevation window, and leaves uncovered sea unchanged", () => {
  const coverage = createGlyphMapWaterCoverage({ ...bounds, west: 1 }, []);
  const polygons = glyphMapTerrainPolygons(source, projection, { color }, [coverage]);
  const land = polygons.filter(p => p.color === "#00ff00"), sea = polygons.filter(p => p.color === "#0000ff");
  expect(land.length).toBeGreaterThan(0); expect(sea.length).toBeGreaterThan(0);
  const datum = projection.project(1, 1, 0)[2], seabed = projection.project(1, 1, -1000)[2];
  expect(land.flatMap(p => p.vertices.map(v => v[2]))).toEqual(expect.arrayContaining([datum]));
  expect(land.every(p => p.vertices.every(v => v[2] === datum))).toBe(true);
  expect(sea.every(p => p.vertices.every(v => v[2] === seabed))).toBe(true);
});

it("an absent authority is exactly the legacy mesh, including relief windows and bias", () => {
  for (const options of [{ color }, { color, minElevation: 0, elevationBias: -5 }]) {
    expect(glyphMapTerrainPolygons(source, projection, options, [])).toEqual(glyphMapPolygons(source, projection, options));
  }
});

it("adjacent water tiles share dry island boundaries without cracks or duplicate area", () => {
  const outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]] as const;
  const hole = [[0.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1.5, 0.5], [0.5, 0.5]] as const;
  const features = [{ geometryType: "polygon" as const, rings: [outer, hole], polygons: [[outer, hole]] }];
  const west = createGlyphMapWaterCoverage({ ...bounds, east: 1 }, features);
  const east = createGlyphMapWaterCoverage({ ...bounds, west: 1 }, features);
  const split = partitionGlyphMapWaterTerrain(bounds, [west, east])!;
  const area = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - p[1] * q[0];
  }, 0)) / 2;
  expect(split.every(p => p.land)).toBe(true);
  expect(split.reduce((sum, p) => sum + area(p.ring), 0)).toBeCloseTo(1, 12);
  const seam = (coverage: typeof west) => partitionGlyphMapWaterTerrain(bounds, [coverage])!
    .filter(p => p.land).flatMap(p => p.ring).filter(p => p[0] === 1).map(p => p[1]);
  expect(new Set(seam(west))).toEqual(new Set(seam(east)));
});

it("keeps clipped globe vertices on the shared terrain triangles, avoiding T-junction cracks", () => {
  const globe = glyphMapGlobe();
  const region = createGlyphMapWaterCoverage({ ...bounds, west: 1 }, []);
  const polygons = glyphMapTerrainPolygons(source, globe, { color }, [region]);
  const nw = globe.project(0, 2, 0), se = globe.project(2, 0, 0);
  const midpoint = nw.map((v, i) => (v + se[i]) / 2);
  const land = polygons.filter(p => p.color === "#00ff00");
  expect(land.flatMap(p => p.vertices).some(v => Math.hypot(...v.map((value, i) => value - midpoint[i])) < 1e-14)).toBe(true);
});
