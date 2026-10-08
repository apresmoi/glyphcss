import { describe, expect, it } from "vitest";
import { MAPS_URL_DEFAULTS, mapsCodec } from "./mapsUrlState";

/**
 * The camera HEADING's URL field, appended under token `b`.
 *
 * The codec is TOKEN-keyed rather than positional, so the interesting
 * property is not that it was appended — it is that a link written before
 * bearing existed carries no `b` at all and therefore decodes to `0`, north
 * up, which is exactly the map every one of those links already described.
 * No version bump: nothing was retired (contrast `terrainRenderMode`, which
 * needed one).
 */
describe("mapsUrlState — bearing", () => {
  it("defaults to north up", () => {
    expect(MAPS_URL_DEFAULTS.bearing).toBe(0);
  });

  it("omits its token at the default, so a north-up link costs nothing", () => {
    expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).not.toMatch(/(^|~)b/);
  });

  it("a link from before the field existed decodes to north up, with everything else intact", () => {
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, span: 55, tilt: 12, centerLon: -73.5 });
    const decoded = mapsCodec.decode(legacy);
    expect(decoded.bearing ?? MAPS_URL_DEFAULTS.bearing).toBe(0);
    expect(decoded.tilt).toBeCloseTo(12, 6);
    expect(decoded.centerLon).toBeCloseTo(-73.5, 3);
  });

  it("round-trips a heading exactly at the slider's own one-degree step", () => {
    for (const bearing of [1, 45, 90, 179, 180, 271, 359]) {
      const decoded = mapsCodec.decode(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, bearing }));
      expect(decoded.bearing).toBe(bearing);
    }
  });

  it("carries the heading alongside the rest of the view, not instead of it", () => {
    // Non-default projection and palette on purpose: the codec OMITS a field
    // sitting at its default, so a defaulted one would prove nothing about
    // token collisions.
    const state = { ...MAPS_URL_DEFAULTS, bearing: 137, tilt: 55, span: 8, centerLon: 8.5, centerLat: 47.4, projection: "mercator" as const, palette: "viridis" as const };
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded.bearing).toBe(137);
    expect(decoded.tilt).toBeCloseTo(55, 6);
    expect(decoded.centerLon).toBeCloseTo(8.5, 3);
    expect(decoded.centerLat).toBeCloseTo(47.4, 3);
    // `b` must not have shadowed a token already in the schema.
    expect(decoded.projection).toBe(state.projection);
    expect(decoded.palette).toBe(state.palette);
  });
});
