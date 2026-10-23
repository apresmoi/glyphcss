import { expect, it, vi } from "vitest";
import { createGlyphMapWaterCoverage, partitionGlyphMapWaterTerrain, runGlyphMapWaterWork } from "./waterTerrain";
import { glyphMapPolygons, glyphMapTerrainPolygons, prepareGlyphMapTerrainPolygons, type GlyphMapTerrainWaterCache } from "./mesh";
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

it("reuses unaffected cells by identity, and restores only the revoked footprint", () => {
  const tile = { ...source, cols: 2, elevation: new Float32Array(6).fill(-1000) };
  const cache: GlyphMapTerrainWaterCache = new Map();
  const base = glyphMapTerrainPolygons(tile, projection, { color }, [], cache);
  const west = createGlyphMapWaterCoverage({ ...bounds, east: 1 }, []);
  const east = createGlyphMapWaterCoverage({ ...bounds, west: 1 }, []);
  const first = glyphMapTerrainPolygons(tile, projection, { color }, [west], cache);
  expect(first[first.length - 1]).toBe(base[1]);
  const westPolygons = cache.get(0)!.polygons;
  glyphMapTerrainPolygons(tile, projection, { color }, [west, east], cache);
  expect(cache.get(0)!.polygons).toBe(westPolygons);
  const restored = glyphMapTerrainPolygons(tile, projection, { color }, [west], cache);
  expect(cache.get(0)!.polygons).toBe(westPolygons);
  expect(restored[restored.length - 1]).toEqual(base[1]);
});

it("cooperative preparation matches synchronous geometry without exposing partial output", async () => {
  const region = createGlyphMapWaterCoverage({ ...bounds, west: 1 }, []);
  const work = prepareGlyphMapTerrainPolygons(source, projection, { color }, [region]);
  const result = await runGlyphMapWaterWork(work, () => true);
  expect(result).toEqual(glyphMapTerrainPolygons(source, projection, { color }, [region]));
});

it("yields before beginning work, and abandons a superseded preparation", async () => {
  vi.useFakeTimers();
  try {
    let started = false, valid = true;
    function* work() { started = true; yield; valid = false; yield; throw new Error("stale work resumed"); }
    const pending = runGlyphMapWaterWork(work(), () => valid);
    expect(started).toBe(false);
    await vi.runAllTimersAsync();
    expect(await pending).toBeUndefined();
    expect(started).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("partitions crossing water features by their union, retaining their dry holes", () => {
  const rectangle = (west: number, east: number, south: number, north: number) => [[west, south], [east, south], [east, north], [west, north], [west, south]] as const;
  const features = [
    { geometryType: "polygon" as const, rings: [rectangle(0, 1.5, 0, 1), rectangle(.2, .4, .2, .4)], polygons: [[rectangle(0, 1.5, 0, 1), rectangle(.2, .4, .2, .4)]] },
    { geometryType: "polygon" as const, rings: [rectangle(1, 2, .5, 2)] },
  ];
  const coverage = createGlyphMapWaterCoverage(bounds, features);
  const split = partitionGlyphMapWaterTerrain(bounds, [coverage])!;
  const area = split.reduce((sum, { ring }) => sum + Math.abs(ring.reduce((v, p, i) => {
    const q = ring[(i + 1) % ring.length]; return v + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2, 0);
  // Union water area = 1.5 + 1.5 - .25 - .04; complement = 1.29.
  expect(area).toBeCloseTo(1.29, 12);
  expect(split.every(piece => piece.land)).toBe(true);
});


it("keeps fully dry source triangles unsplit and drops fully wet ones", () => {
  const dry = createGlyphMapWaterCoverage(bounds, []);
  expect(partitionGlyphMapWaterTerrain(bounds, [dry])).toEqual([
    { ring: [[0, 2], [0, 0], [2, 0]], land: true },
    { ring: [[0, 2], [2, 0], [2, 2]], land: true },
  ]);
  const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]] as const;
  const wet = createGlyphMapWaterCoverage(bounds, [{ geometryType: "polygon", rings: [ring] }]);
  expect(partitionGlyphMapWaterTerrain(bounds, [wet])).toEqual([]);
});

it("does not split a dry triangle for shoreline edges that only overlap its bbox", () => {
  // The water lies strictly northeast of the shared NW-SE diagonal.
  const ring = [[.6, 1.5], [.9, 1.5], [.9, 1.8], [.6, 1.8], [.6, 1.5]] as const;
  const region = createGlyphMapWaterCoverage(bounds, [{ geometryType: "polygon", rings: [ring] }]);
  const pieces = partitionGlyphMapWaterTerrain(bounds, [region])!;
  expect(pieces).toContainEqual({ ring: [[0, 2], [0, 0], [2, 0]], land: true });
  const area = pieces.reduce((sum, { ring }) => sum + Math.abs(ring.reduce((n, p, i) => {
    const q = ring[(i + 1) % ring.length]; return n + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2, 0);
  expect(area).toBeCloseTo(4 - .3 * .3, 12);
});
