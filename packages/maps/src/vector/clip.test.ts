import { describe, expect, it } from "vitest";
import { glyphMapClipPolyline, glyphMapSplitAtAntimeridian } from "./clip";
import type { GlyphMapLonLat } from "./simplify";

describe("glyphMapClipPolyline — open lines", () => {
  it("a line fully inside the box passes through unchanged", () => {
    const line: GlyphMapLonLat[] = [[1, 1], [2, 2], [3, 1]];
    const out = glyphMapClipPolyline(line, { west: 0, east: 10, south: 0, north: 10 }, false);
    expect(out).toEqual([line]);
  });

  it("a line fully outside the box clips to nothing", () => {
    const line: GlyphMapLonLat[] = [[100, 100], [101, 101]];
    const out = glyphMapClipPolyline(line, { west: 0, east: 10, south: 0, north: 10 }, false);
    expect(out).toEqual([]);
  });

  it("a line crossing one edge produces one fragment ending exactly on the boundary", () => {
    const line: GlyphMapLonLat[] = [[5, 5], [15, 5]]; // crosses east=10
    const out = glyphMapClipPolyline(line, { west: 0, east: 10, south: 0, north: 10 }, false);
    expect(out.length).toBe(1);
    expect(out[0][0]).toEqual([5, 5]);
    expect(out[0][1]).toEqual([10, 5]);
  });

  it("a line that exits and re-enters the box produces two disjoint fragments (no bogus bridging segment)", () => {
    // A "peak" that pokes out through the NORTH edge (y=10) and comes back
    // in, straddling the box twice — a genuine exit-then-reenter, unlike a
    // straight monotonic line (which can only cross an axis-aligned box's
    // boundary twice, total).
    const line: GlyphMapLonLat[] = [[5, 5], [15, 15], [25, 5]];
    const out = glyphMapClipPolyline(line, { west: 0, east: 30, south: 0, north: 10 }, false);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual([[5, 5], [10, 10]]);
    expect(out[1]).toEqual([[20, 10], [25, 5]]);
  });
});

describe("glyphMapClipPolyline — closed rings", () => {
  it("a ring fully inside the box collapses to one self-closing fragment", () => {
    // GeoJSON/TopoJSON convention: a closed ring's array already repeats
    // its first point as its own last point (see this file's `closed` doc).
    const ring: GlyphMapLonLat[] = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
    const out = glyphMapClipPolyline(ring, { west: 0, east: 10, south: 0, north: 10 }, true);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(ring);
  });

  it("a ring straddling a box (the country's border actually crosses this tile, not just encloses it) clips to open fragments hugging the box edge", () => {
    // A triangle with one vertex outside the box to the east — two of its
    // three edges genuinely cross the box boundary (unlike a ring that
    // merely ENCLOSES the box with no edge passing through it, which
    // correctly clips to nothing — see the two-tile test below for that
    // same triangle split down the middle).
    const ring: GlyphMapLonLat[] = [[-15, -15], [15, 0], [-15, 15], [-15, -15]];
    const out = glyphMapClipPolyline(ring, { west: -30, east: 0, south: -30, north: 30 }, true);
    expect(out.length).toBeGreaterThan(0);
    for (const frag of out) {
      for (const [lon, lat] of frag) {
        expect(lon).toBeGreaterThanOrEqual(-30 - 1e-9);
        expect(lon).toBeLessThanOrEqual(0 + 1e-9);
        expect(lat).toBeGreaterThanOrEqual(-30 - 1e-9);
        expect(lat).toBeLessThanOrEqual(30 + 1e-9);
      }
    }
  });
});

describe("glyphMapClipPolyline — cross-tile seam continuity (the coordinator's explicit gate)", () => {
  it("a segment crossing the boundary between two ADJACENT tiles produces a BIT-IDENTICAL intersection point on both sides", () => {
    // Two side-by-side tiles sharing the exact same longitude boundary,
    // both derived from the same quadtree division (the realistic case —
    // the shared constant is the SAME float64 value on both sides).
    const boundaryLon = -180 + (360 / 4) * 1; // an ordinary z2 tile boundary
    const westTile = { west: boundaryLon - 90, east: boundaryLon, south: -45, north: 45 };
    const eastTile = { west: boundaryLon, east: boundaryLon + 90, south: -45, north: 45 };

    // A border line crossing straight through the seam.
    const line: GlyphMapLonLat[] = [[boundaryLon - 20, 10], [boundaryLon + 15, -8]];

    const westOut = glyphMapClipPolyline(line, westTile, false);
    const eastOut = glyphMapClipPolyline(line, eastTile, false);

    expect(westOut.length).toBe(1);
    expect(eastOut.length).toBe(1);
    const westEnd = westOut[0][westOut[0].length - 1];
    const eastStart = eastOut[0][0];

    // Bit-identical, not merely numerically close — this is what makes the
    // two tiles' rendered strokes line up with zero seam.
    expect(westEnd[0]).toBe(boundaryLon);
    expect(eastStart[0]).toBe(boundaryLon);
    expect(westEnd[1]).toBe(eastStart[1]);
  });

  it("a closed ring (a country border) crossing a shared tile edge leaves matching boundary vertices in both tiles", () => {
    const boundaryLon = 0;
    const westTile = { west: -30, east: boundaryLon, south: -30, north: 30 };
    const eastTile = { west: boundaryLon, east: 30, south: -30, north: 30 };
    // A ring (triangle) straddling the seam.
    const ring: GlyphMapLonLat[] = [[-15, -15], [15, 0], [-15, 15], [-15, -15]];

    const westOut = glyphMapClipPolyline(ring, westTile, true);
    const eastOut = glyphMapClipPolyline(ring, eastTile, true);
    expect(westOut.length).toBeGreaterThan(0);
    expect(eastOut.length).toBeGreaterThan(0);

    const westBoundaryPts = westOut.flat().filter((p) => p[0] === boundaryLon);
    const eastBoundaryPts = eastOut.flat().filter((p) => p[0] === boundaryLon);
    expect(westBoundaryPts.length).toBeGreaterThan(0);
    expect(eastBoundaryPts.length).toBeGreaterThan(0);
    // Every boundary-crossing latitude computed from the west side must
    // appear, bit-identical, from the east side too.
    const eastLats = new Set(eastBoundaryPts.map((p) => p[1]));
    for (const p of westBoundaryPts) expect(eastLats.has(p[1])).toBe(true);
  });
});

describe("glyphMapSplitAtAntimeridian", () => {
  it("returns a polyline with no seam jump BY IDENTITY (every non-wrapping ring bakes byte-identically)", () => {
    const line: GlyphMapLonLat[] = [[-170, 10], [0, 12], [170, 14]];
    const out = glyphMapSplitAtAntimeridian(line, false);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(line); // identity, not a copy
  });

  it("cuts the 359-degree jump a +-180-duplicating source writes, keeping the real geometry on both sides", () => {
    // Natural Earth's Russia shape: the east lobe ends at 179.9 and the ring
    // continues at -180 on the far side of the seam.
    const line: GlyphMapLonLat[] = [[170, 69], [179.9, 69], [-180, 68.9], [-175, 68.8]];
    const out = glyphMapSplitAtAntimeridian(line, false);
    expect(out).toEqual([
      [[170, 69], [179.9, 69]],
      [[-180, 68.9], [-175, 68.8]],
    ]);
  });

  it("cuts a closed ring only at the seam, rejoining the run through the ring's own repeated start vertex", () => {
    // Start point (0, 0) is arbitrary authoring order, not a geometric
    // feature — the ring must come back as ONE run wrapping through it.
    const ring: GlyphMapLonLat[] = [[0, 0], [179, 5], [-180, 6], [-90, 3], [0, 0]];
    const out = glyphMapSplitAtAntimeridian(ring, true);
    expect(out).toEqual([[[-180, 6], [-90, 3], [0, 0], [179, 5]]]);
  });

  it("drops a run left with fewer than two points (a lone vertex draws nothing and clips to nothing)", () => {
    const line: GlyphMapLonLat[] = [[179, 5], [-180, 5], [-179, 5]];
    const out = glyphMapSplitAtAntimeridian(line, false);
    expect(out).toEqual([[[-180, 5], [-179, 5]]]);
  });

  it("leaves a legitimately long segment alone at exactly 180 degrees (the threshold is strict)", () => {
    const line: GlyphMapLonLat[] = [[-90, 0], [90, 0]];
    expect(glyphMapSplitAtAntimeridian(line, false)[0]).toBe(line);
  });
});
