/**
 * Web Mercator addressing — the blocker that kept a hosted OSM basemap out of
 * the widget.
 *
 * `protomaps.test.ts` pins the divergence this exists to close: at z12 the
 * Zurich data sits at Mercator `y = 1434` while the equal-angle sweep asks
 * for `y = 1025`, so a sweep run under the equal-angle indexer would request
 * neither real tile. Everything here is about the SECOND indexer, and about
 * proving the first one is untouched by its existence.
 */
import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_MERCATOR_MAX_LAT,
  glyphMapMercatorTileBounds,
  glyphMapMercatorTileIndex,
  glyphMapMercatorTileRange,
  glyphMapMercatorZooms,
} from "./mercator";
import { glyphMapEqualAngleTileRange, glyphMapTileRangeForLevel } from "../provider";

const level = (z: number, tileResolution = 256) => glyphMapMercatorZooms(0, 14, tileResolution).find((l) => l.z === z)!;

describe("glyphMapMercatorTileIndex", () => {
  it("addresses Zurich at z12 where the data actually is", () => {
    // The exact address `protomaps.test.ts` records for the vendored archive,
    // and the one `https://tiles.openfreemap.org/planet/latest/12/2145/1434.pbf`
    // serves 142 KB of real data from.
    expect(glyphMapMercatorTileIndex(8.54, 47.375, 12)).toEqual({ x: 2145, y: 1434 });
  });

  it("disagrees with the equal-angle indexer in y, which is the whole problem", () => {
    const equalAngle = glyphMapTileRangeForLevel({
      ...level(12, 4096),
      bounds: { west: 8.54, east: 8.54, south: 47.375, north: 47.375 },
    });
    // ~400 rows apart — the same divergence `protomaps.test.ts` pins from
    // the other side. The equal-angle row that Zurich's latitude lands in
    // covers the ARCTIC in Mercator terms.
    expect(equalAngle.y0).toBe(1026);
    expect(glyphMapMercatorTileIndex(8.54, 47.375, 12).y).toBe(1434);
    expect(glyphMapMercatorTileBounds(12, 2145, equalAngle.y0).north).toBeGreaterThan(60);
  });

  it("puts (0,0) at the top-left of the z1 quadrants", () => {
    expect(glyphMapMercatorTileIndex(-179, 80, 1)).toEqual({ x: 0, y: 0 });
    expect(glyphMapMercatorTileIndex(179, 80, 1)).toEqual({ x: 1, y: 0 });
    expect(glyphMapMercatorTileIndex(-179, -80, 1)).toEqual({ x: 0, y: 1 });
    expect(glyphMapMercatorTileIndex(179, -80, 1)).toEqual({ x: 1, y: 1 });
  });

  it("clamps beyond Mercator's own latitude limit instead of returning NaN", () => {
    for (const lat of [90, -90, 89.9, GLYPH_MAP_MERCATOR_MAX_LAT + 1]) {
      const { x, y } = glyphMapMercatorTileIndex(0, lat, 5);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(31);
    }
  });
});

describe("glyphMapMercatorTileBounds", () => {
  it("covers the whole Mercator domain at z0 and nests exactly", () => {
    const root = glyphMapMercatorTileBounds(0, 0, 0);
    expect(root.west).toBe(-180);
    expect(root.east).toBe(180);
    expect(root.north).toBeCloseTo(GLYPH_MAP_MERCATOR_MAX_LAT, 5);
    expect(root.south).toBeCloseTo(-GLYPH_MAP_MERCATOR_MAX_LAT, 5);
    // z1's top row shares the root's north edge; its bottom row the south.
    expect(glyphMapMercatorTileBounds(1, 0, 0).north).toBeCloseTo(root.north, 9);
    expect(glyphMapMercatorTileBounds(1, 0, 1).south).toBeCloseTo(root.south, 9);
    // The equator is the z1 row seam — Mercator's rows are NOT equal-angle.
    expect(glyphMapMercatorTileBounds(1, 0, 0).south).toBeCloseTo(0, 9);
  });

  it("round-trips against the index for every tile of z3", () => {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const b = glyphMapMercatorTileBounds(3, x, y);
        const mid = glyphMapMercatorTileIndex((b.west + b.east) / 2, (b.south + b.north) / 2, 3);
        expect(mid).toEqual({ x, y });
      }
    }
  });
});

describe("glyphMapMercatorTileRange", () => {
  it("returns the whole grid when the sweep has no window to offer", () => {
    expect(glyphMapMercatorTileRange(level(2), null)).toEqual({ x0: 0, x1: 3, y0: 0, y1: 3 });
  });

  it("restricts to the tiles the window actually covers", () => {
    const r = glyphMapMercatorTileRange(level(12), { west: 8.5, east: 8.6, south: 47.3, north: 47.4 });
    // Contains the tile the live service actually serves Zurich from, and
    // nothing beyond the handful the window straddles.
    expect(r.x0).toBeLessThanOrEqual(2145);
    expect(r.x1).toBeGreaterThanOrEqual(2145);
    expect(r.y0).toBeLessThanOrEqual(1434);
    expect(r.y1).toBeGreaterThanOrEqual(1434);
    expect((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)).toBeLessThanOrEqual(6);
  });

  it("wraps an antimeridian-crossing window to the whole longitude row instead of falling back to the whole grid", () => {
    // The equal-angle indexer drops a window with `west < -180` and sweeps
    // EVERYTHING. At Mercator z12 that is 16.7 million tiles, so this path
    // has to keep the latitude restriction rather than surrender it.
    const r = glyphMapMercatorTileRange(level(12), { west: -181, east: -179, south: 47.3, north: 47.4 });
    expect(r.x0).toBe(0);
    expect(r.x1).toBe(4095);
    // Latitude is still restricted to the three rows the window straddles —
    // 4096 x 3, not 4096 x 4096.
    expect(r.y0).toBe(1433);
    expect(r.y1).toBe(1435);
  });

  it("reports an EMPTY range for a window entirely past Mercator's latitude limit", () => {
    // There is honestly no data at the poles; the answer is "no tiles", not a
    // NaN index and not the nearest row smeared upward.
    const r = glyphMapMercatorTileRange(level(6), { west: -10, east: 10, south: 86, north: 90 });
    expect(r.y1).toBeLessThan(r.y0);
    const swept: string[] = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) swept.push(`${x}_${y}`);
    expect(swept).toEqual([]);
  });

  it("still serves the top row for a window that only PARTLY overshoots the pole", () => {
    const r = glyphMapMercatorTileRange(level(6), { west: -10, east: 10, south: 80, north: 90 });
    expect(r.y0).toBe(0);
    expect(r.y1).toBeGreaterThanOrEqual(0);
  });
});

describe("glyphMapEqualAngleTileRange", () => {
  it("is the sweep's existing behaviour, unchanged, including the out-of-range fallback", () => {
    const l = level(3, 4096);
    expect(glyphMapEqualAngleTileRange(l, { west: 0, east: 20, south: 0, north: 20 }))
      .toEqual(glyphMapTileRangeForLevel({ ...l, bounds: { west: 0, east: 20, south: 0, north: 20 } }));
    // A window needing antimeridian wraparound falls back to the full grid —
    // the documented pre-existing rule, kept verbatim.
    expect(glyphMapEqualAngleTileRange(l, { west: -181, east: -179, south: 0, north: 20 }))
      .toEqual({ x0: 0, x1: 7, y0: 0, y1: 7 });
    expect(glyphMapEqualAngleTileRange(l, null)).toEqual({ x0: 0, x1: 7, y0: 0, y1: 7 });
  });
});

describe("glyphMapMercatorZooms", () => {
  it("describes a doubling pyramid whose native resolution drives LOD selection", () => {
    const zooms = glyphMapMercatorZooms(0, 14, 256);
    expect(zooms).toHaveLength(15);
    expect(zooms[0]).toMatchObject({ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileCols: 256, tileRows: 256 });
    expect(zooms[14]).toMatchObject({ z: 14, cols: 16384, rows: 16384 });
    expect(zooms[14].tileLonSpan).toBeCloseTo(360 / 16384, 9);
  });
});
