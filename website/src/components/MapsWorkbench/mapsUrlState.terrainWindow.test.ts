import { describe, expect, it } from "vitest";
import { MAPS_TERRAIN_WINDOW_OFF, MAPS_URL_DEFAULTS, mapsCodec } from "./mapsUrlState";
import { ELEVATION_WINDOW_STEP, terrainWindowOptions } from "./mapsKit";

/**
 * The TERRAIN layer's elevation-window tokens (`f`/`o`). Appended to the live
 * v3 schema rather than bumped to a v4: nothing was retired, and the codec is
 * TOKEN-keyed, so a link written before they existed carries neither and
 * decodes to `MAPS_TERRAIN_WINDOW_OFF` — no window, which `@glyphcss/maps`
 * gates as byte-identical to the pre-window render. Same property the `F`/`C`
 * contour pair and the sun tokens already pin.
 *
 * They go LAST because `decodePacked` stops at the first token it does not
 * recognize: a link written by this build and opened by an older one strands
 * only what is ordered after these, and there is nothing after them.
 */
describe("mapsUrlState — terrain elevation window", () => {
  it("defaults to no window, and costs no characters there", () => {
    expect(MAPS_URL_DEFAULTS.terrainFloor).toBe(MAPS_TERRAIN_WINDOW_OFF.min);
    expect(MAPS_URL_DEFAULTS.terrainCeiling).toBe(MAPS_TERRAIN_WINDOW_OFF.max);
    const encoded = mapsCodec.encode(MAPS_URL_DEFAULTS);
    expect(encoded).not.toMatch(/f/);
    expect(encoded).not.toMatch(/o/);
  });

  it("a link with neither token decodes to no window", () => {
    const decoded = mapsCodec.decode(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, palette: "heat" }));
    expect(decoded.terrainFloor ?? MAPS_URL_DEFAULTS.terrainFloor).toBe(MAPS_TERRAIN_WINDOW_OFF.min);
    expect(decoded.terrainCeiling ?? MAPS_URL_DEFAULTS.terrainCeiling).toBe(MAPS_TERRAIN_WINDOW_OFF.max);
  });

  it("round-trips a floor, a ceiling, and both — exactly, at the control's own granularity", () => {
    for (const state of [
      { ...MAPS_URL_DEFAULTS, terrainFloor: 0 },
      { ...MAPS_URL_DEFAULTS, terrainCeiling: 0 },
      { ...MAPS_URL_DEFAULTS, terrainFloor: 0, terrainCeiling: 2000 },
      { ...MAPS_URL_DEFAULTS, terrainFloor: -4550, terrainCeiling: 6250 },
      // A TYPED value is deliberately not snapped to the slider's 50 m step,
      // so the wire step has to be finer than it.
      { ...MAPS_URL_DEFAULTS, terrainFloor: -20, terrainCeiling: 1230 },
    ]) {
      const decoded = mapsCodec.decode(mapsCodec.encode(state));
      expect(decoded.terrainFloor ?? MAPS_URL_DEFAULTS.terrainFloor).toBe(state.terrainFloor);
      expect(decoded.terrainCeiling ?? MAPS_URL_DEFAULTS.terrainCeiling).toBe(state.terrainCeiling);
    }
  });

  it("the codec's 10m step is finer than the control's own 50m step", () => {
    expect(ELEVATION_WINDOW_STEP % 10).toBe(0);
  });

  it("is ordered after every token that already existed", () => {
    const both = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, palette: "heat", terrainFloor: 0, contourFloor: 0 });
    // `P` (palette) and `F` (contour floor) both predate `f`; `f` must come
    // after them or an older build would strand them.
    expect(both.indexOf("f")).toBeGreaterThan(both.indexOf("P"));
    expect(both.indexOf("f")).toBeGreaterThan(both.indexOf("F"));
  });

  /**
   * A REAL link, shared before these tokens existed: the Aegean framing from
   * `docs/design/maps.md`'s ocean-drape record (`685dcd3`), with the terrain
   * raster and the OSM `omt-water` row both on. It must decode exactly as it
   * did — every field it carries unchanged, and no window.
   */
  const SHARED = "p3x5f8dcgy5n2t9ms32i8t21xE1j26zb1kF21eL1dO33d0T212N1kI31jkR1M1a1a1q1k1n1t1t1a1a1aJ1a2141a";

  it("an already-shared link decodes exactly as it did, and to no terrain window", () => {
    const decoded = mapsCodec.decode(SHARED);
    expect(decoded.terrainFloor).toBeUndefined();
    expect(decoded.terrainCeiling).toBeUndefined();
    // Every token in it still parses — a decode that had stopped early would
    // silently drop the tail (`M`/`J` here) rather than throw.
    expect(Object.keys(decoded).sort()).toEqual([
      "bearing", "centerLat", "centerLon", "colorEncoding", "contourDensity", "contourFloor",
      "contourInterval", "contourLabels", "layerMask", "osmDensities", "osmDensitiesExt",
      "osmMask", "span", "sunDay", "terrainDensity", "tilt",
    ].sort());
    // And re-encoding what it decoded to reproduces it byte for byte.
    expect(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, ...decoded })).toBe(SHARED);
  });
});

describe("terrainWindowOptions — an unset end is OMITTED, never a sentinel", () => {
  it("mounts nothing at all when neither end is set", () => {
    expect(terrainWindowOptions(null, null)).toEqual({});
  });

  it("keeps a floor of 0, which is the whole point of the control", () => {
    expect(terrainWindowOptions(0, null)).toEqual({ minElevation: 0 });
    expect(terrainWindowOptions(null, 0)).toEqual({ maxElevation: 0 });
    expect(terrainWindowOptions(0, 2000)).toEqual({ minElevation: 0, maxElevation: 2000 });
  });
});
