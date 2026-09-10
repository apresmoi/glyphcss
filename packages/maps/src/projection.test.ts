import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_EARTH_RADIUS_M,
  glyphMapEquirectangular,
  glyphMapFromD3Raw,
  glyphMapGlobe,
  glyphMapMercator,
  glyphMapOrthographic,
  type GlyphMapProjection,
} from "./projection";

/**
 * Acceptance gate 2 (MAPS.md §7, §13 slice 2): `project`/`unproject`
 * round-trip within tolerance across each projection's domain, INCLUDING at
 * domain edges (Mercator's ±85°, orthographic's limb).
 */
function expectRoundTrip(projection: GlyphMapProjection, lon: number, lat: number, tolerance = 1e-6) {
  const p = projection.project(lon, lat, 0);
  expect(p.every((c) => Number.isFinite(c))).toBe(true);
  const [rLon, rLat] = projection.unproject(p);
  // Longitude wraps at ±180 — compare via the shortest angular distance so a
  // point authored at exactly -180/180 (or a numerically adjacent value)
  // doesn't fail on the seam.
  const dLon = Math.abs(((rLon - lon + 540) % 360) - 180);
  expect(dLon).toBeLessThan(tolerance);
  expect(rLat).toBeCloseTo(lat, 6);
}

describe("round-trip (acceptance gate 2)", () => {
  const INTERIOR_POINTS: readonly [number, number][] = [
    [0, 0],
    [30, 15],
    [-58.38, -34.6],
    [139.69, 35.69],
    [-0.13, 51.5],
    [45, -45],
  ];

  describe("glyphMapEquirectangular", () => {
    const projection = glyphMapEquirectangular();
    it("round-trips interior points", () => {
      for (const [lon, lat] of INTERIOR_POINTS) expectRoundTrip(projection, lon, lat);
    });
    it("round-trips at the unbounded domain's own edges (±180°, ±90°)", () => {
      expectRoundTrip(projection, -180, -90);
      expectRoundTrip(projection, 180, 90);
      expectRoundTrip(projection, -180, 90);
      expectRoundTrip(projection, 180, -90);
    });
  });

  describe("glyphMapMercator", () => {
    const projection = glyphMapMercator();
    it("round-trips interior points", () => {
      for (const [lon, lat] of INTERIOR_POINTS) expectRoundTrip(projection, lon, lat);
    });
    it("round-trips at the domain edge (±85.0511°)", () => {
      expectRoundTrip(projection, 0, projection.domain.north);
      expectRoundTrip(projection, 0, projection.domain.south);
      expectRoundTrip(projection, -180, projection.domain.north);
      expectRoundTrip(projection, 180, projection.domain.south);
    });
    it("returns NaN past the domain edge (crops, does not clamp)", () => {
      const p = projection.project(0, 89, 0);
      expect(p.every((c) => Number.isNaN(c))).toBe(true);
    });
    it("honors a custom maxLat", () => {
      const custom = glyphMapMercator({ maxLat: 60 });
      expectRoundTrip(custom, 0, 60);
      expect(custom.project(0, 61, 0).every((c) => Number.isNaN(c))).toBe(true);
    });
  });

  describe("glyphMapGlobe", () => {
    const projection = glyphMapGlobe();
    it("round-trips interior points", () => {
      for (const [lon, lat] of INTERIOR_POINTS) expectRoundTrip(projection, lon, lat);
    });
    it("round-trips at the poles and the antimeridian", () => {
      expectRoundTrip(projection, 0, 90, 1e-3);
      expectRoundTrip(projection, 0, -90, 1e-3);
      expectRoundTrip(projection, 180, 0);
      expectRoundTrip(projection, -180, 0);
    });
    it("displaces radius by elevation under exaggeration", () => {
      const exaggerated = glyphMapGlobe({ radius: 1, exaggeration: 1000 });
      const sea = exaggerated.project(0, 0, 0);
      const everest = exaggerated.project(0, 0, 8848);
      const seaR = Math.hypot(...sea);
      const everestR = Math.hypot(...everest);
      expect(everestR).toBeGreaterThan(seaR);
      expect(everestR - seaR).toBeCloseTo((8848 / GLYPH_MAP_EARTH_RADIUS_M) * 1000, 6);
    });
  });

  describe("glyphMapOrthographic", () => {
    const projection = glyphMapOrthographic();
    it("round-trips interior points near the center", () => {
      expectRoundTrip(projection, 0, 0);
      expectRoundTrip(projection, 10, 10);
      expectRoundTrip(projection, -20, 30);
    });
    it("round-trips near the limb", () => {
      expectRoundTrip(projection, 89.9, 0, 1e-3);
      expectRoundTrip(projection, 0, 89.9, 1e-3);
      expectRoundTrip(projection, -89.9, 0, 1e-3);
    });
    it("returns NaN on the far hemisphere (crops, does not clamp)", () => {
      expect(projection.project(179, 0, 0).every((c) => Number.isNaN(c))).toBe(true);
      expect(projection.project(0, 0, 0).every((c) => Number.isFinite(c))).toBe(true);
    });
    it("recenters on lon0/lat0", () => {
      const centered = glyphMapOrthographic({ lon0: 90, lat0: 45 });
      expectRoundTrip(centered, 90, 45);
      expect(centered.project(90, 45, 0).every((c) => Number.isFinite(c))).toBe(true);
      // The point directly opposite the new center is now on the far side.
      expect(centered.project(-90, -45, 0).every((c) => Number.isNaN(c))).toBe(true);
    });
  });

  describe("glyphMapFromD3Raw (acceptance gate 4)", () => {
    it("renders and round-trips at least one d3-geo-projection raw", async () => {
      // devDependency only — never imported by the pure runtime surface
      // (see package.json: `d3-geo-projection` is a devDependency, and
      // `glyphMapFromD3Raw` itself never imports the module).
      const { geoMollweideRaw } = await import("d3-geo-projection");
      const mollweide = glyphMapFromD3Raw(geoMollweideRaw, { id: "mollweide" });
      expect(mollweide.id).toBe("mollweide");
      for (const [lon, lat] of INTERIOR_POINTS) expectRoundTrip(mollweide, lon, lat, 1e-4);
      const p = mollweide.project(0, 0, 0);
      expect(p.every((c) => Number.isFinite(c))).toBe(true);
    });

    it("swaps the raw (x, y) output into this package's (Y, X) = (east/west, north/south) frame", async () => {
      const { geoMollweideRaw } = await import("d3-geo-projection");
      const adapted = glyphMapFromD3Raw(geoMollweideRaw);
      // Mollweide is symmetric about both the equator and the central
      // meridian, so a pure east move (lat held at 0) changes only the raw
      // `x` and a pure north move (lon held at 0) changes only the raw `y`.
      // If the adapter swapped correctly, the east move should show up ONLY
      // in the adapted Y (east/west) and the north move ONLY in the adapted
      // X (north/south) — proving the swap happened, not just that both
      // axes moved together.
      const origin = adapted.project(0, 0, 0);
      const east = adapted.project(10, 0, 0);
      const north = adapted.project(0, 10, 0);
      expect(east[1]).not.toBeCloseTo(origin[1], 3);
      expect(east[0]).toBeCloseTo(origin[0], 6);
      expect(north[0]).not.toBeCloseTo(origin[0], 3);
      expect(north[1]).toBeCloseTo(origin[1], 6);
    });

    it("throws on unproject when the raw projection has no .invert", () => {
      const noInvert = glyphMapFromD3Raw((lambda: number, phi: number) => [lambda, phi] as const);
      expect(() => noInvert.unproject([0, 0, 0])).toThrow(/invert/);
    });
  });
});
