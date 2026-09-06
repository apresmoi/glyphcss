import { describe, expect, it } from "vitest";
import { MAPS_CONTOUR_WINDOW_OFF, MAPS_URL_DEFAULTS, mapsCodec, mapsCodecLegacyV1, mapsCodecLegacyV2 } from "./mapsUrlState";
import { contourWindowTrack, CONTOUR_WINDOW_STEP } from "./mapsKit";

/**
 * The contour layer's elevation-window tokens (`F`/`C`). Appended to the live
 * v3 schema rather than bumped to a v4: nothing was retired, and the codec is
 * TOKEN-keyed, so a link written before they existed carries neither and
 * decodes to `MAPS_CONTOUR_WINDOW_OFF` — no window, the pre-window render
 * exactly (the same property `mapsUrlState.sun.test.ts` pins for the sun
 * tokens).
 */
describe("mapsUrlState — contour elevation window", () => {
  it("defaults to no window, and costs no characters there", () => {
    expect(MAPS_URL_DEFAULTS.contourFloor).toBe(MAPS_CONTOUR_WINDOW_OFF.min);
    expect(MAPS_URL_DEFAULTS.contourCeiling).toBe(MAPS_CONTOUR_WINDOW_OFF.max);
    const encoded = mapsCodec.encode(MAPS_URL_DEFAULTS);
    expect(encoded).not.toMatch(/(^|~)F/);
    expect(encoded).not.toMatch(/(^|~)C/);
  });

  it("a link with neither token decodes to no window", () => {
    const decoded = mapsCodec.decode(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, palette: "heat" }));
    expect(decoded.contourFloor ?? MAPS_URL_DEFAULTS.contourFloor).toBe(MAPS_CONTOUR_WINDOW_OFF.min);
    expect(decoded.contourCeiling ?? MAPS_URL_DEFAULTS.contourCeiling).toBe(MAPS_CONTOUR_WINDOW_OFF.max);
  });

  it("round-trips a floor, a ceiling, and both — exactly, at the control's own granularity", () => {
    for (const state of [
      { ...MAPS_URL_DEFAULTS, contourFloor: 0 },
      { ...MAPS_URL_DEFAULTS, contourCeiling: 0 },
      { ...MAPS_URL_DEFAULTS, contourFloor: 0, contourCeiling: 2000 },
      { ...MAPS_URL_DEFAULTS, contourFloor: -4550, contourCeiling: 6250 },
    ]) {
      const decoded = mapsCodec.decode(mapsCodec.encode(state));
      expect(decoded.contourFloor ?? MAPS_URL_DEFAULTS.contourFloor).toBe(state.contourFloor);
      expect(decoded.contourCeiling ?? MAPS_URL_DEFAULTS.contourCeiling).toBe(state.contourCeiling);
    }
  });

  it("the codec's 10m step is finer than the control's own 50m step, so every offered value survives", () => {
    expect(CONTOUR_WINDOW_STEP % 10).toBe(0);
  });

  it("does not disturb the fields ordered before it", () => {
    const state = { ...MAPS_URL_DEFAULTS, projection: "mercator" as const, sunMode: "realtime" as const, contourFloor: 0 };
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded.projection).toBe("mercator");
    expect(decoded.sunMode).toBe("realtime");
    expect(decoded.contourFloor).toBe(0);
  });

  it("a v1/v2-tagged link still decodes in full — neither legacy codec has to know these tokens", () => {
    for (const codec of [mapsCodecLegacyV1, mapsCodecLegacyV2]) {
      const decoded = codec.decode(codec.encode({ ...MAPS_URL_DEFAULTS, terrainRenderMode: "ink", palette: "ocean" }));
      expect(decoded.palette).toBe("ocean");
      expect(decoded.terrainRenderMode).toBe("ink");
      expect(decoded.contourFloor ?? MAPS_URL_DEFAULTS.contourFloor).toBe(MAPS_CONTOUR_WINDOW_OFF.min);
    }
  });
});

describe("contourWindowTrack — the floor/ceiling sliders' own bounds", () => {
  it("is the field's own data range, rounded out to the control's step", () => {
    expect(contourWindowTrack({ min: -5230, max: 4410 }, [null, null])).toEqual({ min: -5250, max: 4450 });
  });

  it("falls back to the ETOPO1 envelope before a field resolves", () => {
    expect(contourWindowTrack(null, [null, null])).toEqual({ min: -11000, max: 9000 });
  });

  it("widens to contain a value the current field no longer covers, so a handle is never off its track", () => {
    // Floor 0 set at a global view, then zoomed into a wholly submarine one:
    // the track has to keep reaching 0 or the handle becomes unreachable.
    expect(contourWindowTrack({ min: -5000, max: -1000 }, [0, null])).toEqual({ min: -5000, max: 0 });
  });

  it("never returns a zero-width track for a flat field", () => {
    const track = contourWindowTrack({ min: 100, max: 100 }, [null, null]);
    expect(track.max).toBeGreaterThan(track.min);
  });
});
