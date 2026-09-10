import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_NIGHT_OPACITY,
  glyphMapDaylightFactor,
  glyphMapSolarAltitudeSin,
  glyphMapSubsolarPoint,
  glyphMapSunDirection,
  stampGlyphMapNight,
} from "./sun";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { CellGrid } from "glyphcss";

/**
 * The solar math is pinned against PUBLISHED reference values, not against
 * itself: the equinox/solstice declinations, both equation-of-time extremes
 * (the term a hand-rolled approximation would drop, worth ±16 min ≈ ±4° of
 * longitude), and a published subsolar point. Everything else in the feature
 * rides on these four numbers being right.
 */
describe("glyphMapSubsolarPoint — declination", () => {
  it("is ~0 at the March 2024 equinox instant", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-03-20T03:06:00Z"));
    expect(Math.abs(s.declinationDeg)).toBeLessThan(0.02);
    expect(s.lat).toBe(s.declinationDeg);
  });

  it("is ~0 at the September 2024 equinox instant", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-09-22T12:44:00Z"));
    expect(Math.abs(s.declinationDeg)).toBeLessThan(0.02);
  });

  it("reaches +23.44 at the June 2024 solstice", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-06-20T20:51:00Z"));
    expect(s.declinationDeg).toBeCloseTo(23.44, 1);
  });

  it("reaches -23.44 at the December 2024 solstice", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-12-21T09:20:00Z"));
    expect(s.declinationDeg).toBeCloseTo(-23.44, 1);
  });
});

describe("glyphMapSubsolarPoint — equation of time", () => {
  // The two published extremes. A subsolar longitude computed WITHOUT this
  // term is wrong by 15 * (16.4 / 60) = 4.1 degrees in early November.
  it("is about -14.2 minutes at its mid-February minimum", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-02-11T12:00:00Z"));
    expect(s.equationOfTimeMin).toBeGreaterThan(-14.7);
    expect(s.equationOfTimeMin).toBeLessThan(-13.7);
  });

  it("is about +16.4 minutes at its early-November maximum", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-11-03T12:00:00Z"));
    expect(s.equationOfTimeMin).toBeGreaterThan(15.9);
    expect(s.equationOfTimeMin).toBeLessThan(16.9);
  });

  it("is folded into the subsolar longitude, not dropped", () => {
    const t = new Date("2024-11-03T12:00:00Z");
    const s = glyphMapSubsolarPoint(t);
    // Without the equation of time the subsolar longitude at 12:00 UTC would
    // be exactly 0. With it, the sun is ~4.1 degrees WEST of Greenwich.
    expect(s.lon).toBeCloseTo(-15 * (s.equationOfTimeMin / 60), 6);
    expect(s.lon).toBeLessThan(-3.9);
    expect(s.lon).toBeGreaterThan(-4.3);
  });
});

describe("glyphMapSubsolarPoint — longitude and its advance", () => {
  it("matches the published subsolar point at the 2024 June solstice noon", () => {
    const s = glyphMapSubsolarPoint(new Date("2024-06-21T12:00:00Z"));
    expect(s.lat).toBeCloseTo(23.43, 1);
    // Tight enough that dropping the equation of time (which would put the
    // sun at exactly 0 at 12:00 UTC) fails here too, not only in the
    // dedicated equation-of-time tests above.
    expect(s.lon).toBeGreaterThan(0.3);
    expect(s.lon).toBeLessThan(0.7);
  });

  it("advances 15 degrees WEST per hour — the terminator actually moves", () => {
    const t0 = Date.UTC(2024, 4, 15, 6, 0, 0);
    const a = glyphMapSubsolarPoint(t0);
    const b = glyphMapSubsolarPoint(t0 + 3_600_000);
    // Longitude decreases (moves west) by 15 degrees, give or take the
    // hour's own tiny equation-of-time drift.
    expect(b.lon - a.lon).toBeGreaterThan(-15.05);
    expect(b.lon - a.lon).toBeLessThan(-14.95);
  });

  it("advances 0.25 degrees per minute", () => {
    const t0 = Date.UTC(2024, 4, 15, 6, 0, 0);
    const a = glyphMapSubsolarPoint(t0);
    const b = glyphMapSubsolarPoint(t0 + 60_000);
    expect(a.lon - b.lon).toBeCloseTo(0.25, 3);
  });

  it("returns to nearly the same longitude one sidereal-free day later", () => {
    const t0 = Date.UTC(2024, 6, 4, 3, 0, 0);
    const a = glyphMapSubsolarPoint(t0);
    const b = glyphMapSubsolarPoint(t0 + 24 * 3_600_000);
    expect(Math.abs(b.lon - a.lon)).toBeLessThan(0.5);
  });

  it("normalizes longitude into -180..180", () => {
    for (let h = 0; h < 24; h++) {
      const s = glyphMapSubsolarPoint(Date.UTC(2024, 0, 9, h, 0, 0));
      expect(s.lon).toBeGreaterThanOrEqual(-180);
      expect(s.lon).toBeLessThanOrEqual(180);
    }
  });

  it("rejects a non-finite instant rather than returning NaN geography", () => {
    expect(() => glyphMapSubsolarPoint(Number.NaN)).toThrow(RangeError);
  });
});

describe("glyphMapSunDirection — the lit hemisphere", () => {
  const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });

  it("is the outward unit vector at the subsolar point (globe world frame)", () => {
    const t = Date.UTC(2024, 2, 20, 12, 0, 0);
    const sun = glyphMapSubsolarPoint(t);
    const dir = glyphMapSunDirection(globe, t)!;
    expect(dir).not.toBeNull();
    expect(Math.hypot(dir[0], dir[1], dir[2])).toBeCloseTo(1, 12);
    const at = globe.project(sun.lon, sun.lat, 0);
    const len = Math.hypot(at[0], at[1], at[2]);
    expect(dir[0]).toBeCloseTo(at[0] / len, 12);
    expect(dir[1]).toBeCloseTo(at[1] / len, 12);
    expect(dir[2]).toBeCloseTo(at[2] / len, 12);
  });

  it("lights the hemisphere centred on the subsolar point, and only that one", () => {
    const t = Date.UTC(2024, 2, 20, 12, 0, 0);
    const sun = glyphMapSubsolarPoint(t);
    const dir = glyphMapSunDirection(globe, t)!;
    // Lambert term at a surface point = dot(outward normal, light direction).
    const lambertAt = (lon: number, lat: number) => {
      const p = globe.project(lon, lat, 0);
      const l = Math.hypot(p[0], p[1], p[2]);
      return (p[0] / l) * dir[0] + (p[1] / l) * dir[1] + (p[2] / l) * dir[2];
    };
    expect(lambertAt(sun.lon, sun.lat)).toBeCloseTo(1, 10);
    expect(lambertAt(sun.lon + 180, -sun.lat)).toBeCloseTo(-1, 10);
    expect(lambertAt(sun.lon + 90, 0)).toBeLessThan(0.05);
    expect(lambertAt(sun.lon - 90, 0)).toBeLessThan(0.05);
  });

  it("the lit face rotates ~15 degrees of longitude per hour", () => {
    const t0 = Date.UTC(2024, 2, 20, 12, 0, 0);
    const a = glyphMapSunDirection(globe, t0)!;
    const b = glyphMapSunDirection(globe, t0 + 3_600_000)!;
    // Recover each direction's own longitude in the globe's world frame
    // (X = cos(lat)cos(lon), Y = cos(lat)sin(lon)).
    const lonOf = (d: readonly [number, number, number]) => (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    const delta = lonOf(b as [number, number, number]) - lonOf(a as [number, number, number]);
    expect(delta).toBeGreaterThan(-15.05);
    expect(delta).toBeLessThan(-14.95);
    // And the two directions are genuinely different vectors, not a frozen one.
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeGreaterThan(0.2);
  });

  it("is null for a SHEET projection — a directional light cannot express a terminator on one normal", () => {
    expect(glyphMapSunDirection(glyphMapEquirectangular(), Date.now())).toBeNull();
  });
});

describe("glyphMapDaylightFactor", () => {
  const sun = glyphMapSubsolarPoint(Date.UTC(2024, 2, 20, 12, 0, 0));

  it("is 1 under the sun and 0 at the antipode", () => {
    expect(glyphMapDaylightFactor(sun.lon, sun.lat, sun)).toBeCloseTo(1, 10);
    expect(glyphMapDaylightFactor(sun.lon + 180, -sun.lat, sun)).toBeCloseTo(0, 10);
  });

  it("is ~0.5 on the terminator itself", () => {
    expect(glyphMapDaylightFactor(sun.lon + 90, 0, sun)).toBeCloseTo(0.5, 1);
  });

  it("agrees in sign with the solar altitude", () => {
    expect(glyphMapSolarAltitudeSin(sun.lon, sun.lat, sun)).toBeCloseTo(1, 10);
    expect(glyphMapSolarAltitudeSin(sun.lon + 180, -sun.lat, sun)).toBeCloseTo(-1, 10);
  });
});

function makeGrid(cols: number, rows: number, color: string): CellGrid {
  const n = cols * rows;
  const screenX = new Int32Array(n);
  const screenY = new Int32Array(n);
  for (let i = 0; i < n; i++) { screenX[i] = i % cols; screenY[i] = (i / cols) | 0; }
  return {
    cols,
    rows,
    char: new Array(n).fill("#"),
    color: new Array(n).fill(color),
    depth: new Float64Array(n).fill(1),
    screenX,
    screenY,
  };
}

describe("stampGlyphMapNight — the sheet-projection terminator", () => {
  const sun = glyphMapSubsolarPoint(Date.UTC(2024, 2, 20, 12, 0, 0));

  it("darkens the night side and leaves the day side untouched", () => {
    const grid = makeGrid(4, 1, "#ffffff");
    // col 0 = under the sun, col 3 = the antipode.
    const lons = [sun.lon, sun.lon + 60, sun.lon + 120, sun.lon + 180];
    stampGlyphMapNight(grid, (col) => [lons[col], 0], sun);
    expect(grid.color[0]).toBe("#ffffff");
    const lum = (c: string) => Number.parseInt(c.slice(1, 3), 16);
    expect(lum(grid.color[3]!)).toBeLessThan(lum(grid.color[0]!));
    expect(lum(grid.color[2]!)).toBeLessThan(lum(grid.color[1]!));
    // Full night is dimmed by exactly the night opacity, never to black.
    expect(lum(grid.color[3]!)).toBe(Math.round(255 * (1 - GLYPH_MAP_NIGHT_OPACITY)));
    expect(lum(grid.color[3]!)).toBeGreaterThan(0);
  });

  it("skips empty cells (page background) and cells with no geographic answer", () => {
    const grid = makeGrid(2, 1, "#ffffff");
    grid.depth[0] = -Infinity;
    stampGlyphMapNight(grid, () => [sun.lon + 180, 0], sun);
    expect(grid.color[0]).toBe("#ffffff");
    expect(grid.color[1]).not.toBe("#ffffff");

    const grid2 = makeGrid(1, 1, "#ffffff");
    stampGlyphMapNight(grid2, () => null, sun);
    expect(grid2.color[0]).toBe("#ffffff");
  });

  it("advances with time: the same cell flips from day to night twelve hours later", () => {
    const t0 = Date.UTC(2024, 2, 20, 12, 0, 0);
    const noon = glyphMapSubsolarPoint(t0);
    const midnight = glyphMapSubsolarPoint(t0 + 12 * 3_600_000);
    const at: [number, number] = [noon.lon, 0];

    const dayGrid = makeGrid(1, 1, "#ffffff");
    stampGlyphMapNight(dayGrid, () => at, noon);
    const nightGrid = makeGrid(1, 1, "#ffffff");
    stampGlyphMapNight(nightGrid, () => at, midnight);

    expect(dayGrid.color[0]).toBe("#ffffff");
    expect(Number.parseInt(nightGrid.color[0]!.slice(1, 3), 16)).toBeLessThan(120);
  });

  it("nightOpacity 0 is a no-op", () => {
    const grid = makeGrid(1, 1, "#3366aa");
    stampGlyphMapNight(grid, () => [sun.lon + 180, 0], sun, { nightOpacity: 0 });
    expect(grid.color[0]).toBe("#3366aa");
  });
});
