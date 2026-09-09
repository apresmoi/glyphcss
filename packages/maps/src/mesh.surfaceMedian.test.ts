import { describe, expect, it } from "vitest";
import { glyphMapPolygons } from "./mesh";
import { glyphMapEquirectangular } from "./projection";
import { GlyphMapClassifiers } from "./classify";
import type { GlyphMapGeoTile } from "./tile";

/**
 * A relief quad's colour is the median of the terrain SURFACE it covers, not
 * of the SAMPLES it covers — `GlyphMapPolygonsOptions.colorSample`'s
 * `"surface-median"`.
 *
 * The rule it replaced took the median of the tile's own vertices over the
 * block a quad covers. That carried a guarantee stated for `n >> 1` ("more
 * than half the covered samples at or above sea level implies the sample at
 * `n >> 1` is too") which is simply FALSE at the resolution a reader actually
 * looks at: at the target tier every relief quad is ONE source cell, so its
 * covered samples are its own four corners and the median degenerates into a
 * 3-of-4 vote that cannot see magnitude. Reported live over Buenos Aires,
 * where the z4 quad under downtown reads (nw -1, ne -1, sw +12, se -1): three
 * estuary samples outvote the city, the quad is painted bathymetric blue, and
 * the straight quad edge running through Retiro and Palermo is visible on
 * screen. 2,756 base cells that OpenStreetMap calls land were painted as
 * water at the reported view.
 *
 * This file pins the rule by DISCRIMINATION rather than by example, because
 * the obvious test — one quad of (-1, -1, 12, -1) expected to come out land —
 * passes under the 4-corner MEAN as well, and the mean is the statistic the
 * record already rejected on measurement (it paints the Andes as ocean).
 * Every row below separates all three candidates: each rejected rule gets the
 * wrong answer on at least one of them, and the test asserts that too, so a
 * future edit cannot quietly satisfy the file with a statistic that only
 * looks right on the reported case.
 */

const classify = GlyphMapClassifiers.etopo1V1.classifyValue!;
const bandColor = (elev: number): string => String(classify(elev));

/** A one-quad tile: the four corners at exactly the vertex spacing a z4 tile ships. */
function quadTile(nw: number, ne: number, sw: number, se: number): GlyphMapGeoTile {
  return {
    bounds: { west: 0, east: 0.125, south: 0, north: 0.125 },
    cols: 1,
    rows: 1,
    elevation: Float32Array.from([nw, ne, sw, se]),
    source: "synthetic",
    sampler: "nearest",
  };
}

/** The candidate this replaced: the median of the covered samples (`values[n >> 1]` of the sorted block). */
function sampleMedian(nw: number, ne: number, sw: number, se: number): number {
  return [nw, ne, sw, se].sort((a, b) => a - b)[2]!;
}

/** The candidate the median replaced: the mean of the quad's own four drawn corners. */
function cornerMean(nw: number, ne: number, sw: number, se: number): number {
  return (nw + ne + sw + se) / 4;
}

/**
 * The reference the shipped rule is measured against, and deliberately NOT
 * how it is computed: a brute-force 64x64 midpoint lattice over the bilinear
 * patch, whose median is the level that splits the drawn surface's AREA in
 * half. The implementation gets the same answer far more cheaply (exactly
 * along each row, midpoint-sampled across rows), so agreement here is a real
 * check rather than a restatement.
 */
function surfaceAreaMedian(nw: number, ne: number, sw: number, se: number, n = 64): number {
  const values: number[] = [];
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    const west = nw + (sw - nw) * v;
    const east = ne + (se - ne) * v;
    for (let i = 0; i < n; i++) values.push(west + (east - west) * ((i + 0.5) / n));
  }
  values.sort((a, b) => a - b);
  return values[values.length >> 1]!;
}

/** Fraction of the drawn surface at or above sea level, same lattice. */
function areaAboveSeaLevel(nw: number, ne: number, sw: number, se: number, n = 64): number {
  let above = 0;
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    const west = nw + (sw - nw) * v;
    const east = ne + (se - ne) * v;
    for (let i = 0; i < n; i++) if (west + (east - west) * ((i + 0.5) / n) >= 0) above++;
  }
  return above / (n * n);
}

/**
 * Four quads on which no candidate statistic matches the area rule
 * throughout. The Buenos Aires row is the reported defect and the mean gets
 * it RIGHT, which is the whole reason a Buenos Aires example alone cannot
 * gate this. Row two separates the mean from the other two: a lone high
 * corner is a quarter of the CORNERS but only 47.8% of the AREA, because the
 * surface between two low corners stays low. Rows three and four separate the
 * sample median from the other two, from the opposite side: a lone deep corner
 * gets one vote out of four and takes most of the area with it, and the real
 * quad off the Dutch coastal dune ridge does the same thing with two.
 */
const QUADS = [
  { name: "Buenos Aires downtown (-1, -1, 12, -1)", nw: -1, ne: -1, sw: 12, se: -1 },
  { name: "one high corner over a low shelf (-5, -5, -5, 20)", nw: -5, ne: -5, sw: -5, se: 20 },
  { name: "one deep corner under a low plain (1, 1, 1, -100)", nw: 1, ne: 1, sw: 1, se: -100 },
  { name: "the Dutch dune ridge (-18, 9, -15, 7)", nw: -18, ne: 9, sw: -15, se: 7 },
] as const;

describe("a relief quad's colour is the median of the surface it covers", () => {
  for (const { name, nw, ne, sw, se } of QUADS) {
    it(`${name} takes the band that covers the majority of its drawn surface`, () => {
      const polygons = glyphMapPolygons(quadTile(nw, ne, sw, se), glyphMapEquirectangular(), { color: bandColor });
      expect(polygons.length).toBe(1);
      expect(`${name}: ${polygons[0]!.color}`).toBe(`${name}: ${bandColor(surfaceAreaMedian(nw, ne, sw, se))}`);
    });
  }

  it("the four rows really do discriminate: each rejected statistic gets a different one of them wrong", () => {
    const wrong = (stat: (a: number, b: number, c: number, d: number) => number): string[] =>
      QUADS.filter(({ nw, ne, sw, se }) => bandColor(stat(nw, ne, sw, se)) !== bandColor(surfaceAreaMedian(nw, ne, sw, se))).map((q) => q.name);
    // Not merely "each is wrong somewhere": they are wrong on DIFFERENT rows,
    // so no third statistic can satisfy the set by splitting the difference —
    // and in particular the mean gets the REPORTED row right, which is why a
    // Buenos Aires example on its own proves nothing.
    expect(wrong(sampleMedian)).toEqual([QUADS[0].name, QUADS[2].name, QUADS[3].name]);
    expect(wrong(cornerMean)).toEqual([QUADS[1].name]);
  });

  it("the reported quad really is majority land by area and majority water by sample count", () => {
    const { nw, ne, sw, se } = QUADS[0];
    expect(areaAboveSeaLevel(nw, ne, sw, se)).toBeGreaterThan(0.7);
    expect([nw, ne, sw, se].filter((v) => v >= 0).length).toBe(1);
  });

  /**
   * The block, not the quad. A COARSENED tier's quad spans several source
   * cells, and its colour reads the tile's own full-resolution surface over
   * all of them — the property that keeps a tier's colour fidelity from
   * degrading with its mesh resolution (`glyphMapPolygons`' "Mesh
   * resolution"). This clause is what a fix confined to "the block is 2x2"
   * cannot pass: eight of the nine samples here are one metre below sea
   * level, so every sample vote says water, while the surface those samples
   * describe is 72% land.
   */
  it("a coarsened quad reads the full-resolution surface it stands in for, not its own four corners", () => {
    const tile: GlyphMapGeoTile = {
      bounds: { west: 0, east: 0.25, south: 0, north: 0.25 },
      cols: 2,
      rows: 2,
      elevation: Float32Array.from([-1, -1, -1, -1, 12, -1, -1, -1, -1]),
      source: "synthetic",
      sampler: "nearest",
    };
    const coarse = glyphMapPolygons(tile, glyphMapEquirectangular(), { color: bandColor, resolution: { cols: 1, rows: 1 } });
    expect(coarse.length).toBe(1);
    // The coarse quad's own four corners are all -1: a rule reading the DRAWN
    // coarse chord would say water, and so would every sample vote (8 of 9).
    expect(coarse[0]!.color).toBe("1");
    // ... and the four full-resolution quads it stands in for each say land,
    // so the coarse tier agrees with the fine one rather than contradicting it.
    const fine = glyphMapPolygons(tile, glyphMapEquirectangular(), { color: bandColor });
    expect(fine.map((p) => p.color)).toEqual(["1", "1", "1", "1"]);
  });
});
