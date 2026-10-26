import { expect, it } from "vitest";
import { createGlyphMapGroundIndex } from "./groundIndex";
import { glyphMapWaterContains } from "./waterTerrain";

it("retains all closed-edge hits in original order across overlaps and grid boundaries", () => {
  const items = Array.from({ length: 64 }, (_, i) => ({ id: i,
    bounds: { west: i % 8 - 4, east: i % 8 - 2, south: (i >> 3) - 4, north: (i >> 3) - 2 } }));
  // A floor can overlap every bucket, but must never precede a target tile.
  items.push({ id: 64, bounds: { west: -180, east: 180, south: -90, north: 90 } });
  const candidates = createGlyphMapGroundIndex(items);
  for (let lon = -5; lon <= 6; lon += 0.25) for (let lat = -5; lat <= 6; lat += 0.25) {
    const matches = (a: typeof items | readonly typeof items[number][]) => a.filter(c => glyphMapWaterContains(c.bounds, lon, lat));
    expect(matches(candidates(lon, lat))).toEqual(matches(items));
  }
  expect(candidates(NaN, 0)).toBe(items);
  expect(candidates(0, Infinity)).toBe(items);
  expect(candidates(181, 0)).toHaveLength(0);
  expect(candidates(-180, -90)).toContain(items[64]);
});

it("new snapshots replace candidate membership, with invalid bounds falling back", () => {
  const a = { bounds: { west: 0, east: 1, south: 0, north: 1 } };
  const b = { bounds: { west: 2, east: 3, south: 2, north: 3 } };
  expect(createGlyphMapGroundIndex([a, b])(0.5, 0.5)).toEqual([a]);
  expect(createGlyphMapGroundIndex([b, a])(0.5, 0.5)).toEqual([a]);
  const invalid = [a, { bounds: { west: 5, east: 4, south: 0, north: 1 } }];
  expect(createGlyphMapGroundIndex(invalid)(0, 0)).toBe(invalid);
});
