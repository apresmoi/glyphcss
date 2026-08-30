import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_VECTOR_TILE_EXTENT,
  glyphMapDecodeQuantizedLine,
  glyphMapDequantizePoint,
  glyphMapEncodeQuantizedLine,
  glyphMapQuantizeErrorDeg,
  glyphMapQuantizePoint,
} from "./quantize";
import type { GlyphMapLonLat } from "./simplify";

const bounds = { west: -10, east: 10, south: -5, north: 5 };

describe("glyphMapQuantizePoint / glyphMapDequantizePoint", () => {
  it("boundary points quantize to EXACTLY 0 or extent (no rounding noise at the edge)", () => {
    expect(glyphMapQuantizePoint(-10, 5, bounds)).toEqual([0, 0]);
    expect(glyphMapQuantizePoint(10, 5, bounds)).toEqual([GLYPH_MAP_VECTOR_TILE_EXTENT, 0]);
    expect(glyphMapQuantizePoint(-10, -5, bounds)).toEqual([0, GLYPH_MAP_VECTOR_TILE_EXTENT]);
  });

  it("center point quantizes to the middle of the extent", () => {
    expect(glyphMapQuantizePoint(0, 0, bounds)).toEqual([GLYPH_MAP_VECTOR_TILE_EXTENT / 2, GLYPH_MAP_VECTOR_TILE_EXTENT / 2]);
  });

  it("round trip stays within one quantization step", () => {
    const [qx, qy] = glyphMapQuantizePoint(3.14159, -1.23456, bounds);
    const [lon, lat] = glyphMapDequantizePoint(qx, qy, bounds);
    const err = glyphMapQuantizeErrorDeg(bounds);
    expect(Math.abs(lon - 3.14159)).toBeLessThanOrEqual(err + 1e-12);
    expect(Math.abs(lat - -1.23456)).toBeLessThanOrEqual(err + 1e-12);
  });

  it("a shared tile boundary quantizes bit-identically from both adjacent tiles' own bounds", () => {
    const boundaryLon = 5;
    const westTile = { west: -5, east: boundaryLon, south: -5, north: 5 };
    const eastTile = { west: boundaryLon, east: 15, south: -5, north: 5 };
    const lat = 1.2345;
    const [, qyWest] = glyphMapQuantizePoint(boundaryLon, lat, westTile);
    const [, qyEast] = glyphMapQuantizePoint(boundaryLon, lat, eastTile);
    // West tile: boundaryLon is its EAST edge -> qx = extent (not checked here).
    // East tile: boundaryLon is its WEST edge -> qx = 0.
    // The lat axis is what must match bit-for-bit since both tiles share
    // the same south/north range at this boundary.
    expect(qyWest).toBe(qyEast);
    const [lonWest] = glyphMapDequantizePoint(GLYPH_MAP_VECTOR_TILE_EXTENT, qyWest, westTile);
    const [lonEast] = glyphMapDequantizePoint(0, qyEast, eastTile);
    expect(lonWest).toBe(boundaryLon);
    expect(lonEast).toBe(boundaryLon);
  });
});

describe("glyphMapEncodeQuantizedLine / glyphMapDecodeQuantizedLine", () => {
  it("round trips a polyline within one quantization step per point", () => {
    const points: GlyphMapLonLat[] = [[-9.9, 4.8], [-3, 1], [0, 0], [4.4, -3.3], [9.9, -4.9]];
    const encoded = glyphMapEncodeQuantizedLine(points, bounds);
    const decoded = glyphMapDecodeQuantizedLine(encoded, bounds);
    expect(decoded.length).toBe(points.length);
    const err = glyphMapQuantizeErrorDeg(bounds);
    for (let i = 0; i < points.length; i++) {
      expect(Math.abs(decoded[i][0] - points[i][0])).toBeLessThanOrEqual(err + 1e-9);
      expect(Math.abs(decoded[i][1] - points[i][1])).toBeLessThanOrEqual(err + 1e-9);
    }
  });

  it("the encoded payload is delta-coded (later entries are typically much smaller in magnitude than absolute coordinates)", () => {
    const points: GlyphMapLonLat[] = [];
    for (let i = 0; i <= 50; i++) points.push([-9.9 + i * 0.2, 4.8 - i * 0.1]);
    const encoded = glyphMapEncodeQuantizedLine(points, bounds);
    // First pair is absolute (can be large); every later pair is a small delta.
    const deltas = encoded.slice(2);
    const maxDelta = Math.max(...deltas.map(Math.abs));
    expect(maxDelta).toBeLessThan(GLYPH_MAP_VECTOR_TILE_EXTENT / 10);
  });
});
