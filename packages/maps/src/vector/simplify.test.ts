import { describe, expect, it } from "vitest";
import { glyphMapAreaThresholdDeg, glyphMapCellEpsilonDeg, glyphMapSimplifyArc, type GlyphMapLonLat } from "./simplify";

describe("glyphMapAreaThresholdDeg / glyphMapCellEpsilonDeg", () => {
  it("threshold shrinks toward the poles (cos(lat) correction)", () => {
    const eq = glyphMapAreaThresholdDeg(1, 0);
    const t60 = glyphMapAreaThresholdDeg(1, 60);
    const t85 = glyphMapAreaThresholdDeg(1, 85);
    expect(t60).toBeLessThan(eq);
    expect(t85).toBeLessThan(t60);
    // cos(85deg) ~ 0.0872 -> squared ratio ~1/131; matches the documented
    // "over-simplifies by up to ~11x at 85 deg" figure in *linear* (epsilon)
    // terms, i.e. sqrt(eq/t85) ~ 1/cos(85deg) ~ 11.47.
    expect(Math.sqrt(eq / t85)).toBeCloseTo(1 / Math.cos((85 * Math.PI) / 180), 3);
  });

  it("cell epsilon is half the cell's geographic size", () => {
    expect(glyphMapCellEpsilonDeg(2)).toBe(1);
    expect(glyphMapCellEpsilonDeg(0.5)).toBe(0.25);
  });
});

describe("glyphMapSimplifyArc", () => {
  it("never removes the two endpoints, even at a huge epsilon", () => {
    const arc: GlyphMapLonLat[] = [[0, 0], [1, 0.001], [2, -0.001], [3, 0.0005], [4, 0]];
    const out = glyphMapSimplifyArc(arc, 1000);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([4, 0]);
  });

  it("removes near-collinear interior points at a tiny epsilon", () => {
    // Dead straight line, sub-micro-degree jitter — every interior point has
    // ~zero effective area and should collapse to just the two endpoints.
    const arc: GlyphMapLonLat[] = [];
    for (let i = 0; i <= 10; i++) arc.push([i, i * 1e-12]);
    const out = glyphMapSimplifyArc(arc, 0.01);
    expect(out.length).toBe(2);
  });

  it("keeps a genuinely significant bend (large effective area) even under a moderate epsilon", () => {
    // A sharp spike at the midpoint — large triangle area relative to its
    // neighbors, should survive while small jitter around it does not.
    const arc: GlyphMapLonLat[] = [
      [0, 0], [1, 0.0001], [2, 0.0001], [3, 5], [4, -0.0001], [5, -0.0001], [6, 0],
    ];
    const out = glyphMapSimplifyArc(arc, 0.01);
    expect(out.some((p) => p[0] === 3 && p[1] === 5)).toBe(true);
    // The tiny-jitter points should be gone.
    expect(out.length).toBeLessThan(arc.length);
  });

  it("epsilon 0 (or negative) is a documented no-op — returns every point unchanged", () => {
    const arc: GlyphMapLonLat[] = [[0, 0], [1, 1e-9], [2, 0]];
    expect(glyphMapSimplifyArc(arc, 0)).toEqual(arc);
    expect(glyphMapSimplifyArc(arc, -1)).toEqual(arc);
  });

  it("a point survives near the pole at an epsilon that would remove the identical shape at the equator", () => {
    // Same local triangle geometry (a small bump of area ~A), placed once
    // near the equator and once near the pole. Choose epsilon so A sits
    // strictly between the two thresholds.
    const bump = 0.02; // interior point's lat offset -> triangle area ~ bump/2 in degree^2 for this construction
    const equatorArc: GlyphMapLonLat[] = [[0, 0], [1, bump], [2, 0]];
    const poleArc: GlyphMapLonLat[] = [[0, 80], [1, 80 + bump], [2, 80]];
    const epsilon = 0.25; // eq threshold = 0.0625; pole threshold (cos80~0.1736) = 0.0625*0.03014 ~= 0.00188
    const eqOut = glyphMapSimplifyArc(equatorArc, epsilon);
    const poleOut = glyphMapSimplifyArc(poleArc, epsilon);
    expect(eqOut.length).toBe(2); // removed at the equator
    expect(poleOut.length).toBe(3); // kept near the pole
  });

  it("arcs of length <= 2 pass through unchanged", () => {
    const arc: GlyphMapLonLat[] = [[0, 0], [1, 1]];
    expect(glyphMapSimplifyArc(arc, 100)).toEqual(arc);
  });
});
