import { describe, expect, it } from "vitest";
import { glyphMapDropSmallContourRings, glyphMapGeneralizeContourMosaic, glyphMapMarchContourMosaic, type GlyphMapContourSampleGrid } from "./contourGeometry";

/** A vertex grid over `bounds` sampling `f`, with a bilinear `valueAt` that is NaN outside its own bounds. */
function piece(west: number, east: number, south: number, north: number, n: number, f: (lon: number, lat: number) => number, m = n) {
  const values = new Float64Array((m + 1) * (n + 1));
  for (let r = 0; r <= m; r++) for (let c = 0; c <= n; c++) values[r * (n + 1) + c] = f(west + ((east - west) * c) / n, north - ((north - south) * r) / m);
  const grid: GlyphMapContourSampleGrid = { bounds: { west, east, south, north }, cols: n, rows: m, values };
  const valueAt = (lon: number, lat: number) => {
    if (lon < west || lon > east || lat < south || lat > north) return NaN;
    const x = ((lon - west) / (east - west)) * n, y = ((north - lat) / (north - south)) * m;
    const c = Math.min(n - 1, Math.floor(x)), r = Math.min(m - 1, Math.floor(y)), fx = x - c, fy = y - r;
    const v = (rr: number, cc: number) => values[rr * (n + 1) + cc];
    return (v(r, c) * (1 - fx) + v(r, c + 1) * fx) * (1 - fy) + (v(r + 1, c) * (1 - fx) + v(r + 1, c + 1) * fx) * fy;
  };
  return { grid, valueAt };
}

// A broad hill with high-frequency ripple on it: the ripple is what generalisation removes.
const hill = (lon: number, lat: number) => 1000 - 40 * (lon * lon + lat * lat) + 60 * Math.sin(lon * 9) * Math.cos(lat * 11);

describe("contour generalisation", () => {
  it("smooths away ripple, so a level cuts fewer, longer pieces", () => {
    const one = piece(-4, 4, -4, 4, 160, hill);
    const raw = glyphMapMarchContourMosaic([one.grid], [700]);
    const smooth = glyphMapMarchContourMosaic([glyphMapGeneralizeContourMosaic([one], 0.5)!], [700]);
    expect(smooth.length).toBeLessThan(raw.length / 2);
  });

  it("is the same surface however the mosaic is tiled", () => {
    const whole = glyphMapGeneralizeContourMosaic([piece(-4, 4, -4, 4, 160, hill)], 0.5)!;
    const tiled = glyphMapGeneralizeContourMosaic([piece(-4, 0, -4, 4, 80, hill, 160), piece(0, 4, -4, 4, 80, hill, 160)], 0.5)!;
    expect(tiled.bounds).toEqual(whole.bounds);
    expect(Array.from(tiled.values)).toEqual(Array.from(whole.values));
  });

  it("keeps a hole a hole instead of pulling the surface toward zero", () => {
    const left = piece(-4, 0, -4, 4, 40, () => 500);
    const g = glyphMapGeneralizeContourMosaic([left], 0.5)!;
    for (const v of g.values) if (Number.isFinite(v)) expect(v).toBeCloseTo(500, 9);
  });
});

describe("small ring filter", () => {
  const square = (cx: number, cy: number, h: number, level = 1) => {
    const p = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]] as [number, number][];
    return p.map((a, i) => ({ level, a, b: p[(i + 1) % 4] }));
  };
  it("drops a closed ring under the extent and keeps a larger one", () => {
    const out = glyphMapDropSmallContourRings([...square(0, 0, 0.1), ...square(5, 5, 2)], 1);
    expect(out).toHaveLength(4);
    expect(out.every(s => s.a[0] > 2)).toBe(true);
  });
  it("keeps a short OPEN line, which is part of something larger", () => {
    const open = square(0, 0, 0.1).slice(0, 3);
    expect(glyphMapDropSmallContourRings(open, 1)).toHaveLength(3);
  });
  it("tells levels apart at a shared point", () => {
    const out = glyphMapDropSmallContourRings([...square(0, 0, 0.1, 1), ...square(0, 0, 0.1, 2).slice(0, 3)], 1);
    expect(out.map(s => s.level)).toEqual([2, 2, 2]);
  });
});
