/**
 * `glyphMapGeoTileElevationAt` — the elevation lookup a `contour` layer (and a
 * heatmap's ground-hugging relief) reads across a tile MOSAIC.
 *
 * The property that matters is CONTINUITY at a shared boundary, and it is
 * reachable exactly rather than approximately: `GlyphMapGeoTile` is
 * vertex-centered and adjacent tiles carry bit-identical values on the vertex
 * row/column they share, so a sampler that reads those vertices agrees on the
 * boundary from either side.
 *
 * The second test measures what the previous, cell-centered lookup did
 * instead, so the mechanism is pinned as a number rather than a story: it
 * derived one value per QUAD (the average of its four corners), placing its
 * outermost sample half a cell inside the tile, and `glyphMapFieldValueAt`
 * clamps past that — so a band one cell wide straddling every boundary is
 * flat-extrapolated from each side's own edge cell, and the two
 * extrapolations disagree.
 */
import { describe, expect, it } from "vitest";
import { glyphMapGeoTileElevationAt, glyphMapGeoTileElevationRange } from "./tile";
import { glyphMapFieldValueAt } from "./sample";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapField } from "./types";

const LON_SPAN = 45, LAT_SPAN = 22.5, TILE_COLS = 18, TILE_ROWS = 9;

/** A gentle, smooth terrain — no feature aligned to any tile boundary. */
const terrainAt = (lon: number, lat: number): number =>
  3000 * Math.sin((lat * Math.PI) / 180) + 800 * Math.cos((lon * Math.PI) / 90) + 5 * lat;

function tileAt(x: number, y: number): GlyphMapGeoTile {
  const west = -180 + x * LON_SPAN, north = 90 - y * LAT_SPAN;
  const bounds = { west, east: west + LON_SPAN, south: north - LAT_SPAN, north };
  const vc = TILE_COLS + 1, vr = TILE_ROWS + 1;
  const elevation = new Float32Array(vc * vr);
  for (let r = 0; r < vr; r++) {
    for (let c = 0; c < vc; c++) {
      elevation[r * vc + c] = terrainAt(west + (c / TILE_COLS) * LON_SPAN, north - (r / TILE_ROWS) * LAT_SPAN);
    }
  }
  return { bounds, cols: TILE_COLS, rows: TILE_ROWS, elevation, source: "analytic", sampler: "nearest" };
}

/** The cell-centered field the contour runtime used to derive per tile: one value per quad, the average of its four vertex corners. */
function cellCenteredFieldOf(tile: GlyphMapGeoTile): GlyphMapField {
  const { cols, rows } = tile;
  const vcols = cols + 1;
  const values = new Float32Array(cols * rows);
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = (tile.elevation[row * vcols + col]! + tile.elevation[row * vcols + col + 1]!
        + tile.elevation[(row + 1) * vcols + col]! + tile.elevation[(row + 1) * vcols + col + 1]!) / 4;
      values[row * cols + col] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { bounds: tile.bounds, cols, rows, values, noData: new Uint8Array(cols * rows), kind: "continuous", min, max };
}

const EPS = 1e-6;

describe("glyphMapGeoTileElevationAt", () => {
  it("two tiles sharing a MERIDIAN agree exactly along it", () => {
    const west = tileAt(2, 4), east = tileAt(3, 4);
    const lonBoundary = west.bounds.east;
    expect(lonBoundary).toBe(east.bounds.west);
    for (let lat = west.bounds.south; lat <= west.bounds.north; lat += LAT_SPAN / 9) {
      // Sampled exactly ON the boundary, which both tiles' bounds contain.
      expect(glyphMapGeoTileElevationAt(west, lonBoundary, lat))
        .toBe(glyphMapGeoTileElevationAt(east, lonBoundary, lat));
      // And approached from either side, the two sides converge to it — no
      // step, which is the property a contour reads.
      const a = glyphMapGeoTileElevationAt(west, lonBoundary - EPS, lat);
      const b = glyphMapGeoTileElevationAt(east, lonBoundary + EPS, lat);
      expect(Math.abs(b - a)).toBeLessThan(1e-3);
    }
  });

  it("two tiles sharing a PARALLEL agree exactly along it", () => {
    const north = tileAt(2, 3), south = tileAt(2, 4);
    const latBoundary = north.bounds.south;
    expect(latBoundary).toBe(south.bounds.north);
    for (let lon = north.bounds.west; lon <= north.bounds.east; lon += LON_SPAN / 18) {
      expect(glyphMapGeoTileElevationAt(north, lon, latBoundary))
        .toBe(glyphMapGeoTileElevationAt(south, lon, latBoundary));
      const a = glyphMapGeoTileElevationAt(north, lon, latBoundary + EPS);
      const b = glyphMapGeoTileElevationAt(south, lon, latBoundary - EPS);
      expect(Math.abs(b - a)).toBeLessThan(1e-3);
    }
  });

  it("reproduces the true terrain at a vertex, and stays within the quad's own corner range inside it", () => {
    const tile = tileAt(2, 4);
    for (const [c, r] of [[0, 0], [5, 3], [TILE_COLS, TILE_ROWS]] as const) {
      const lon = tile.bounds.west + (c / TILE_COLS) * LON_SPAN;
      const lat = tile.bounds.north - (r / TILE_ROWS) * LAT_SPAN;
      expect(glyphMapGeoTileElevationAt(tile, lon, lat)).toBeCloseTo(terrainAt(lon, lat), 3);
    }
    expect(glyphMapGeoTileElevationAt(tile, tile.bounds.west - 0.001, 0)).toBeNaN();
    expect(glyphMapGeoTileElevationAt(tile, 0, tile.bounds.north + 0.001)).toBeNaN();
  });

  it("range covers the tile's own vertex extremes", () => {
    const tile = tileAt(2, 4);
    const { min, max } = glyphMapGeoTileElevationRange(tile);
    expect(min).toBeLessThan(max);
    for (let i = 0; i < tile.elevation.length; i++) {
      expect(tile.elevation[i]!).toBeGreaterThanOrEqual(min);
      expect(tile.elevation[i]!).toBeLessThanOrEqual(max);
    }
  });

  /**
   * The defect, measured. Not a regression guard on the OLD code — that code
   * is gone — but the reason the new sampler exists, kept as a number so a
   * future "why not just derive a field per tile?" is answered with data.
   */
  it("the cell-centered derivation it replaced STEPS at a shared boundary, symmetrically about the truth", () => {
    const west = cellCenteredFieldOf(tileAt(2, 4)), east = cellCenteredFieldOf(tileAt(3, 4));
    const lonBoundary = west.bounds.east;
    const jumps: number[] = [];
    for (let lat = west.bounds.south + 1; lat <= west.bounds.north - 1; lat += 2) {
      const a = glyphMapFieldValueAt(west, lonBoundary - EPS, lat);
      const b = glyphMapFieldValueAt(east, lonBoundary + EPS, lat);
      jumps.push(b - a);
      // The true value lies BETWEEN the two clamped extrapolations, close to
      // their midpoint — the signature of a symmetric half-cell error on each
      // side, not of two tiles disagreeing about their data. (Not exactly the
      // midpoint: the quad average also smooths the terrain's latitudinal
      // curvature, worth ~14 m here.)
      const truth = terrainAt(lonBoundary, lat);
      expect(truth).toBeGreaterThan(Math.min(a, b));
      expect(truth).toBeLessThan(Math.max(a, b));
      expect(Math.abs((a + b) / 2 - truth)).toBeLessThan(25);
    }
    // Every sample steps, by the same amount (the terrain's longitudinal
    // gradient is constant over this tile pair) — a line, not noise.
    expect(jumps.every((j) => Math.abs(j) > 30)).toBe(true);
    expect(Math.max(...jumps) - Math.min(...jumps)).toBeLessThan(1e-3);
  });
});
