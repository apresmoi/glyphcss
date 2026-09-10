import { describe, expect, it } from "vitest";
import { decodeGlyphMapTopoJsonArcs, glyphMapTopoJsonFeatures, type TopoJsonTopology } from "./topology";
import { glyphMapSimplifyArc, glyphMapSimplifyArcs, type GlyphMapLonLat } from "./simplify";
import { glyphMapBuildVectorTile, glyphMapDecodeVectorTile, glyphMapVectorTileBounds } from "./tile";
import { GLYPH_MAP_VECTOR_TILE_EXTENT, glyphMapEncodeQuantizedLine, glyphMapQuantizeErrorDeg } from "./quantize";
import { glyphMapClipPolyline } from "./clip";
import type { GlyphMapVectorFeature } from "./types";

/**
 * Two synthetic "countries" sharing one border arc with interior wiggle
 * points — the classic Spain/France-at-the-Pyrenees shape (MAPS.md §6).
 * The shared border (arc 1) runs from P_top=(0,10) to P_bottom=(0,-10).
 * Country A closes via its own PRIVATE western arc (0) from P_bottom back
 * to P_top; country B closes via its own PRIVATE eastern arc (2) from
 * P_top to P_bottom, then needs the shared border the OTHER way
 * (P_bottom -> P_top), i.e. arc 1 REVERSED (`~1`) — matching real TopoJSON
 * topology, where two adjacent polygons reference a shared arc in opposite
 * winding directions.
 */
function twoCountryTopology(): TopoJsonTopology {
  return {
    type: "Topology",
    arcs: [
      // arc 0: A's own private boundary, P_bottom -> P_top via the west.
      // The point near (-0.1, 9.98) is deliberately CLOSE to the P_top
      // junction — its triangle area with P_top and the shared arc's first
      // wiggle point is small, which is what the mutation-check test below
      // needs: per-ring simplification (wrongly) treats P_top as an
      // ordinary removable interior point of A's ring, while arc-level
      // simplification (correctly) never touches it — it's an arc endpoint.
      [[0, -10], [-10, -10], [-0.1, 9.98], [0, 10]],
      // arc 1: the SHARED border, P_top -> P_bottom, with interior wiggle.
      [[0, 10], [0.4, 6], [-0.3, 2], [0.2, -2], [0, -10]],
      // arc 2: B's own private boundary, P_top -> P_bottom via the east.
      [[0, 10], [10, 10], [10, -10], [0, -10]],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "A", properties: { name: "A" }, arcs: [[0, 1]] },
          { type: "Polygon", id: "B", properties: { name: "B" }, arcs: [[2, ~1]] },
        ],
      },
    },
  };
}

/** True if `needle` appears, in order and value-for-value, as a contiguous run inside `haystack` — the actual invariant "both features carry a byte-identical copy of the same simplified shared arc" needs, robust to a closed ring's start/end point legitimately repeating elsewhere. */
function containsSubsequence(haystack: readonly GlyphMapLonLat[], needle: readonly GlyphMapLonLat[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j][0] !== needle[j][0] || haystack[i + j][1] !== needle[j][1]) continue outer;
    }
    return true;
  }
  return false;
}

function reversed(seq: readonly GlyphMapLonLat[]): GlyphMapLonLat[] {
  return [...seq].reverse();
}

describe("shared-arc simplification -> feature resolution (the core gate)", () => {
  it("two adjacent countries simplified at any level share their border EXACTLY — no sliver", () => {
    const topo = twoCountryTopology();
    const decoded = decodeGlyphMapTopoJsonArcs(topo);
    for (const epsilon of [0, 0.001, 0.5, 2, 100]) {
      const simplifiedArcs = glyphMapSimplifyArcs(decoded, epsilon);
      const sharedArc = simplifiedArcs[1];
      const features = glyphMapTopoJsonFeatures(topo, "countries", simplifiedArcs);
      const a = features.find((f) => f.id === "A")!;
      const b = features.find((f) => f.id === "B")!;
      // A used arc 1 FORWARD, B used it REVERSED (`~1`) — both rings must
      // carry the exact same simplified point sequence, just walked in
      // opposite directions.
      expect(containsSubsequence(a.rings[0], sharedArc)).toBe(true);
      expect(containsSubsequence(b.rings[0], reversed(sharedArc))).toBe(true);
    }
  });

  it("mutation check: simplifying each polygon's RING independently (not the shared arc) can diverge the shared border", () => {
    const topo = twoCountryTopology();
    const decoded = decodeGlyphMapTopoJsonArcs(topo);
    const epsilon = 1.5;

    // The CORRECT pipeline: simplify the shared arc ONCE, then resolve rings.
    const correctSharedArc = glyphMapSimplifyArcs(decoded, epsilon)[1];

    // The BUGGY pipeline: resolve rings from UNSIMPLIFIED arcs first, then
    // simplify each whole ring polyline independently — exactly the mistake
    // MAPS.md §6 warns against. Each ring's neighboring context differs (A's
    // own private geometry vs B's own private geometry feeds into the
    // shared segment from either end), so VW's removal decisions for the
    // "same" interior wiggle points are no longer guaranteed to agree.
    const rawFeatures = glyphMapTopoJsonFeatures(topo, "countries", decoded);
    const aRaw = rawFeatures.find((f) => f.id === "A")!;
    const bRaw = rawFeatures.find((f) => f.id === "B")!;
    const aRingSimplified = glyphMapSimplifyArc(aRaw.rings[0], epsilon);
    const bRingSimplified = glyphMapSimplifyArc(bRaw.rings[0], epsilon);

    // The correct pipeline's shared arc is a verbatim subsequence of BOTH
    // rings once resolved from the ALREADY-simplified topology...
    const featuresCorrect = glyphMapTopoJsonFeatures(topo, "countries", glyphMapSimplifyArcs(decoded, epsilon));
    expect(containsSubsequence(featuresCorrect.find((f) => f.id === "A")!.rings[0], correctSharedArc)).toBe(true);
    expect(containsSubsequence(featuresCorrect.find((f) => f.id === "B")!.rings[0], reversed(correctSharedArc))).toBe(true);

    // ...but the buggy (per-ring) pipeline's independently-simplified A and
    // B rings do NOT both still carry that exact shared sequence — at
    // least one of them dropped or kept different interior points because
    // its VW context included the OTHER country's private geometry.
    const bothStillMatch =
      containsSubsequence(aRingSimplified, correctSharedArc) && containsSubsequence(bRingSimplified, reversed(correctSharedArc));
    expect(bothStillMatch).toBe(false);
  });
});

describe("glyphMapBuildVectorTile / glyphMapDecodeVectorTile — round trip", () => {
  it("decoded polylines stay within one quantization step of the simplified input", () => {
    const feature: GlyphMapVectorFeature = {
      id: "X",
      rings: [[[-2, -2], [-1, 1], [0, -0.5], [1, 1], [2, -2], [-2, -2]]],
    };
    const tile = glyphMapBuildVectorTile({ borders: [feature] }, 0, 0, 0, { source: "test", simplify: "none" });
    const decoded = glyphMapDecodeVectorTile(tile);
    const err = glyphMapQuantizeErrorDeg(tile.bounds, tile.extent);
    const line = decoded.layers.borders[0].rings[0];
    for (let i = 0; i < line.length; i++) {
      expect(Math.abs(line[i][0] - feature.rings[0][i][0])).toBeLessThanOrEqual(err + 1e-9);
      expect(Math.abs(line[i][1] - feature.rings[0][i][1])).toBeLessThanOrEqual(err + 1e-9);
    }
  });

  it("a feature entirely outside the tile is dropped, not emitted empty", () => {
    const feature: GlyphMapVectorFeature = { id: "far", rings: [[[100, 80], [101, 81], [100, 81], [100, 80]]] };
    const tile = glyphMapBuildVectorTile({ borders: [feature] }, 2, 0, 0, { source: "test", simplify: "none" });
    expect(tile.layers.borders).toBeUndefined();
  });
});

describe("cross-tile seam continuity — end-to-end through the real bake pipeline", () => {
  it("a border straddling a tile boundary decodes to matching endpoints on both adjacent tiles", () => {
    const topo = twoCountryTopology();
    // Rescale the synthetic topology onto the real z2 tile grid seam near
    // lon=0 so the shared border genuinely crosses a REAL tile boundary
    // (west tile: x=1 at z2 spans lon [-90,0]; east tile: x=2 spans [0,90]).
    const decoded = decodeGlyphMapTopoJsonArcs(topo);
    const simplified = glyphMapSimplifyArcs(decoded, 0.5);
    const features = glyphMapTopoJsonFeatures(topo, "countries", simplified);

    const westBounds = glyphMapVectorTileBounds(2, 1, 1);
    const eastBounds = glyphMapVectorTileBounds(2, 2, 1);
    expect(westBounds.east).toBe(eastBounds.west); // sanity: genuinely adjacent

    const westTile = glyphMapBuildVectorTile({ countries: features }, 2, 1, 1, { source: "test", simplify: "z2" });
    const eastTile = glyphMapBuildVectorTile({ countries: features }, 2, 2, 1, { source: "test", simplify: "z2" });
    const westDecoded = glyphMapDecodeVectorTile(westTile);
    const eastDecoded = glyphMapDecodeVectorTile(eastTile);

    const westBoundaryPts = westDecoded.layers.countries.flatMap((f) => f.rings.flat()).filter((p) => Math.abs(p[0] - 0) < 1e-6);
    const eastBoundaryPts = eastDecoded.layers.countries.flatMap((f) => f.rings.flat()).filter((p) => Math.abs(p[0] - 0) < 1e-6);
    expect(westBoundaryPts.length).toBeGreaterThan(0);
    expect(eastBoundaryPts.length).toBeGreaterThan(0);
    const eastLats = new Set(eastBoundaryPts.map((p) => p[1]));
    for (const p of westBoundaryPts) expect(eastLats.has(p[1])).toBe(true);
  });
});

/**
 * Points are the data path for `symbol`/`circle`/`heatmap`, and they used to
 * fall out of the bake silently: `glyphMapClipPolyline` clips SEGMENTS, and a
 * one-point ring has none, so it correctly returns `[]` for a point — which
 * `glyphMapBuildVectorTile` then read as "this feature doesn't touch the
 * tile" and dropped. Every baked pyramid was therefore point-free no matter
 * what went in.
 */
describe("glyphMapBuildVectorTile — point features", () => {
  const ZURICH: readonly [number, number] = [8.548064, 47.381934];
  const places: GlyphMapVectorFeature[] = [
    { id: "zurich", geometryType: "point", properties: { name: "Zurich", pop_max: 1_108_000 }, rings: [[ZURICH]] },
  ];

  it("keeps a point in the tile that contains it, with its properties and geometry type", () => {
    // z2/x2 spans lon 0..90, z2/y0 spans lat 45..90 — the tile Zurich is in.
    const bounds = glyphMapVectorTileBounds(2, 2, 0);
    expect(ZURICH[0]).toBeGreaterThanOrEqual(bounds.west);
    expect(ZURICH[0]).toBeLessThan(bounds.east);

    const decoded = glyphMapDecodeVectorTile(glyphMapBuildVectorTile({ places }, 2, 2, 0, { source: "test", simplify: "z2" }));
    expect(decoded.layers.places).toHaveLength(1);
    const feature = decoded.layers.places[0];
    expect(feature.geometryType).toBe("point");
    expect(feature.properties?.name).toBe("Zurich");
    expect(feature.rings).toHaveLength(1);
    expect(feature.rings[0]).toHaveLength(1);
    // Quantization is the only error: at most half a step on the wider axis.
    const tolerance = glyphMapQuantizeErrorDeg(bounds);
    expect(Math.abs(feature.rings[0][0][0] - ZURICH[0])).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(feature.rings[0][0][1] - ZURICH[1])).toBeLessThanOrEqual(tolerance);
  });

  it("does not duplicate a point into a neighbouring tile", () => {
    for (const [x, y] of [[1, 0], [3, 0], [2, 1], [0, 0]] as const) {
      const tile = glyphMapBuildVectorTile({ places }, 2, x, y, { source: "test", simplify: "z2" });
      expect(Object.keys(tile.layers)).toHaveLength(0);
    }
  });

  it("gives a point sitting exactly on a shared tile edge to exactly one tile", () => {
    // The z2 x=1|x=2 seam is lon 0; the y=1|y=2 seam is lat 0.
    const onSeam: GlyphMapVectorFeature[] = [{ geometryType: "point", properties: {}, rings: [[[0, 0]]] }];
    const owners = ([[1, 1], [2, 1], [1, 2], [2, 2]] as const)
      .filter(([x, y]) => Object.keys(glyphMapBuildVectorTile({ p: onSeam }, 2, x, y, { source: "t", simplify: "z2" }).layers).length > 0);
    expect(owners).toHaveLength(1);
  });

  it("keeps a point on the world's own outer edge, which has no neighbouring tile to hand it to", () => {
    const corner: GlyphMapVectorFeature[] = [{ geometryType: "point", properties: {}, rings: [[[180, -90]]] }];
    const tile = glyphMapBuildVectorTile({ p: corner }, 1, 1, 1, { source: "t", simplify: "z1" });
    expect(tile.layers.p).toHaveLength(1);
  });
});

describe("glyphMapBuildVectorTile — antimeridian-spanning source rings", () => {
  /** The Natural Earth shape: real geometry only near +-180, joined by one 359-degree planar jump. */
  const seam: GlyphMapVectorFeature[] = [{
    id: "seam",
    geometryType: "polygon",
    properties: {},
    rings: [[[170, 70], [179, 70], [-180, 70], [-172, 70], [-172, 74], [170, 74], [170, 70]]],
  }];

  it("puts nothing in a tile the feature never reaches, instead of one full-width chord per tile", () => {
    // z3 columns x=2..5 span lon -90..90 — the feature has no vertex there.
    // Before the fix each of these carried a single 45-degree-wide segment
    // at lat 70, which is the polar ring the live page showed.
    for (const x of [2, 3, 4, 5]) {
      const tile = glyphMapBuildVectorTile({ admin0: seam }, 3, x, 0, { source: "t", simplify: "z3" });
      expect(`x=${x}: ${JSON.stringify(Object.keys(tile.layers))}`).toBe(`x=${x}: []`);
    }
  });

  it("still bakes the feature's real geometry on both sides of the seam", () => {
    for (const x of [0, 7]) {
      const tile = glyphMapBuildVectorTile({ admin0: seam }, 3, x, 0, { source: "t", simplify: "z3" });
      expect(tile.layers.admin0?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("bakes a feature with no seam jump byte-identically (the split is a no-op for ordinary geometry)", () => {
    const ring: GlyphMapLonLat[] = [[-20, 40], [20, 40], [20, 60], [-20, 60], [-20, 40]];
    const plain: GlyphMapVectorFeature[] = [{ id: "plain", geometryType: "polygon", properties: {}, rings: [ring] }];
    const bounds = glyphMapVectorTileBounds(2, 1, 1);
    // The expectation is rebuilt from the PRE-FIX formula itself — clip the
    // whole ring against the box and quantize, with no antimeridian step —
    // rather than pinning whatever the current code happens to emit.
    const expected = glyphMapClipPolyline(ring, bounds, true)
      .map((frag) => glyphMapEncodeQuantizedLine(frag, bounds, GLYPH_MAP_VECTOR_TILE_EXTENT));
    expect(expected.length).toBeGreaterThan(0);
    const tile = glyphMapBuildVectorTile({ admin0: plain }, 2, 1, 1, { source: "t", simplify: "z2" });
    expect(tile.layers.admin0?.[0].lines).toEqual(expected);
  });
});
