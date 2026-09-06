import { describe, expect, it } from "vitest";
import { glyphMapDecodeGeoTileInt16, glyphMapGeoTileVertexLonLat, splitGlyphMapGeoTileAtAntimeridian, type GlyphMapGeoTile } from "./tile";

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

describe("glyphMapDecodeGeoTileInt16", () => {
  const bounds = { west: -10, east: 10, south: -5, north: 5 };
  const meta = { bounds, cols: 4, rows: 2, source: "etopo1", sampler: "nearest" } as const;

  function encode(samples: readonly number[]): ArrayBuffer {
    const buf = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buf);
    samples.forEach((v, i) => view.setInt16(i * 2, v, true));
    return buf;
  }

  it("round-trips a known sample grid, in row-major (row * (cols+1) + col) order", () => {
    // 4x2 quads -> 5x3 vertices = 15 samples. Distinct values so a
    // transposed or column-major read would visibly disagree.
    const vcols = meta.cols + 1;
    const vrows = meta.rows + 1;
    const samples: number[] = [];
    for (let row = 0; row < vrows; row++) {
      for (let col = 0; col < vcols; col++) samples.push(col * 100 + row);
    }
    const tile = glyphMapDecodeGeoTileInt16(encode(samples), meta);
    expect(tile.bounds).toEqual(bounds);
    expect(tile.cols).toBe(4);
    expect(tile.rows).toBe(2);
    expect(tile.source).toBe("etopo1");
    expect(tile.sampler).toBe("nearest");
    expect(Array.from(tile.elevation)).toEqual(samples);
    // Spot-check the row-major addressing directly: vertex (col=3, row=2).
    expect(tile.elevation[2 * vcols + 3]).toBe(3 * 100 + 2);
  });

  it("decodes negative int16 elevations (below-sea-level bathymetry) correctly", () => {
    const samples = [-10898, -1, 0, 1, 8271, -500, 12, -32768, 32767, 0, 0, 0, 0, 0, 0];
    const tile = glyphMapDecodeGeoTileInt16(encode(samples), meta);
    expect(Array.from(tile.elevation)).toEqual(samples);
  });

  it("carries optional attribution through unchanged", () => {
    const attribution = [{ name: "NOAA NCEI (ETOPO1)", license: "Public domain" }];
    const samples = new Array((meta.cols + 1) * (meta.rows + 1)).fill(0);
    const tile = glyphMapDecodeGeoTileInt16(encode(samples), { ...meta, attribution });
    expect(tile.attribution).toBe(attribution);
  });

  it("throws a descriptive RangeError naming expected vs. actual sample count on a length mismatch", () => {
    const tooFew = encode([1, 2, 3]); // needs 15 samples, only 3 given
    expect(() => glyphMapDecodeGeoTileInt16(tooFew, meta)).toThrow(RangeError);
    expect(() => glyphMapDecodeGeoTileInt16(tooFew, meta)).toThrow(/expected 30 bytes \(15 samples\)/);
    expect(() => glyphMapDecodeGeoTileInt16(tooFew, meta)).toThrow(/has 6 bytes \(3 samples\)/);
  });

  it("throws the same descriptive RangeError on a TOO-LONG payload, not just a too-short one", () => {
    const tooMany = encode(new Array(20).fill(0)); // needs 15 samples, 20 given
    expect(() => glyphMapDecodeGeoTileInt16(tooMany, meta)).toThrow(RangeError);
    expect(() => glyphMapDecodeGeoTileInt16(tooMany, meta)).toThrow(/expected 30 bytes \(15 samples\)/);
    expect(() => glyphMapDecodeGeoTileInt16(tooMany, meta)).toThrow(/has 40 bytes \(20 samples\)/);
  });

  it("reports an ODD byte length as 'not a whole number of int16 samples' instead of a fractional sample count", () => {
    const buf = new ArrayBuffer(7);
    expect(() => glyphMapDecodeGeoTileInt16(buf, meta)).toThrow(/has 7 bytes \(not a whole number of int16 samples\)/);
  });

  it("accepts a Uint8Array view (not just a plain ArrayBuffer)", () => {
    const samples = new Array((meta.cols + 1) * (meta.rows + 1)).fill(0).map((_, i) => i);
    const buf = encode(samples);
    const view = new Uint8Array(buf);
    const tile = glyphMapDecodeGeoTileInt16(view, meta);
    expect(Array.from(tile.elevation)).toEqual(samples);
  });

  it("accepts a Uint8Array view with a non-zero byteOffset into a larger buffer", () => {
    const samples = new Array((meta.cols + 1) * (meta.rows + 1)).fill(0).map((_, i) => i * 7);
    const payload = encode(samples);
    const padded = new Uint8Array(4 + payload.byteLength);
    padded.set(new Uint8Array(payload), 4);
    const view = new Uint8Array(padded.buffer, 4, payload.byteLength);
    const tile = glyphMapDecodeGeoTileInt16(view, meta);
    expect(Array.from(tile.elevation)).toEqual(samples);
  });
});
