import { describe, expect, it } from "vitest";
import { glyphMapGeoTileVertexLonLat, splitGlyphMapGeoTileAtAntimeridian, type GlyphMapGeoTile } from "./tile";

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number): GlyphMapGeoTile {
  const vcols = cols + 1;
  const vrows = rows + 1;
  const elevation = new Float32Array(vcols * vrows);
  // Encode each vertex's own (col, row) into its "elevation" so a slice's
  // provenance (which source vertex it came from) is directly checkable.
  for (let row = 0; row < vrows; row++) {
    for (let col = 0; col < vcols; col++) elevation[row * vcols + col] = col * 1000 + row;
  }
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

describe("glyphMapGeoTileVertexLonLat", () => {
  it("matches bake-globe.mjs's own per-vertex formula", () => {
    const tile = makeTile({ west: -10, east: 10, south: -5, north: 5 }, 4, 2);
    expect(glyphMapGeoTileVertexLonLat(tile, 0, 0)).toEqual([-10, 5]);
    expect(glyphMapGeoTileVertexLonLat(tile, 4, 2)).toEqual([10, -5]);
    expect(glyphMapGeoTileVertexLonLat(tile, 2, 1)).toEqual([0, 0]);
  });
});

describe("splitGlyphMapGeoTileAtAntimeridian", () => {
  it("passes through a tile that doesn't straddle the seam", () => {
    const tile = makeTile({ west: 0, east: 90, south: -10, north: 10 }, 4, 2);
    const [only, extra] = splitGlyphMapGeoTileAtAntimeridian(tile);
    expect(only).toBe(tile);
    expect(extra).toBeUndefined();
  });

  it("passes through a tile that lands exactly on the seam without straddling it", () => {
    const tile = makeTile({ west: 90, east: 180, south: -10, north: 10 }, 4, 2);
    const [only, extra] = splitGlyphMapGeoTileAtAntimeridian(tile);
    expect(only).toBe(tile);
    expect(extra).toBeUndefined();
  });

  it("splits a straddling tile into two halves that re-cover the same lon/lat range with no overlap or gap", () => {
    // Authored in the unwrapped convention: west=170, east=190 means
    // 170°E through 190°E-unwrapped, i.e. 170°E to 170°W.
    const tile = makeTile({ west: 170, east: 190, south: -10, north: 10 }, 10, 4);
    const [west, east] = splitGlyphMapGeoTileAtAntimeridian(tile);
    expect(west.bounds).toEqual({ west: 170, east: 180, south: -10, north: 10 });
    expect(east.bounds).toEqual({ west: -180, east: -170, south: -10, north: 10 });
    // Together the two halves span the same number of quads as the source.
    expect(west.cols + east.cols).toBe(tile.cols);
    expect(west.rows).toBe(tile.rows);
    expect(east.rows).toBe(tile.rows);
  });

  it("each half's elevation is a literal slice of the source grid — no resampling", () => {
    const tile = makeTile({ west: 170, east: 190, south: -10, north: 10 }, 10, 4);
    const [west, east] = splitGlyphMapGeoTileAtAntimeridian(tile);
    // West half's vertex (0, 0) is the source tile's vertex (0, 0).
    expect(west.elevation[0]).toBe(tile.elevation[0]);
    // West half's last column is the source tile's column at `west.cols`.
    expect(west.elevation[west.cols]).toBe(tile.elevation[west.cols]);
    // East half's vertex (0, 0) continues exactly where west's last column left off.
    expect(east.elevation[0]).toBe(tile.elevation[west.cols]);
  });

  it("throws no error and produces a usable grid at the extreme case (seam at the first/last column)", () => {
    const nearWholeEast = makeTile({ west: -170, east: 190, south: -10, north: 10 }, 12, 2);
    const [west, east] = splitGlyphMapGeoTileAtAntimeridian(nearWholeEast);
    expect(west.cols).toBeGreaterThanOrEqual(1);
    expect(east.cols).toBeGreaterThanOrEqual(1);
    expect(west.cols + east.cols).toBe(nearWholeEast.cols);
  });
});
