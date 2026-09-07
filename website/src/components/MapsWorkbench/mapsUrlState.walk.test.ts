// @vitest-environment happy-dom
/**
 * The walk MODE's URL field, appended under token `w`.
 *
 * ONE token, and the reason there is only one is the point of this file: a
 * walker's POSE is already in the link. `@glyphcss/maps`' walk mode reuses
 * the widget's existing camera state rather than adding any — `view.center`
 * IS where the walker stands (tokens `x`/`y`), `bearing` IS the heading they
 * face (token `b`), and `getTilt()` IS their pitch measured from
 * `GLYPH_MAP_WALK_HORIZON_TILT_DEG`, i.e. 90 (token `t`) — and `/maps` reads
 * all four back off the live widget every view sync (`mapsView.ts`'s
 * `readMapViewState`, which walking drives through the widget's own `move`
 * events). So the only thing a link could not say was that walk mode is ON
 * at all, and a second position/heading/pitch token would be a duplicate of
 * a field that already round-trips.
 *
 * `w` (not `W`, which is `fillDensity`): the token map is case-sensitive,
 * exactly as `M`/`m` already document. Appended LAST, after `M`, for the
 * reason `M`'s own doc gives — `decodePacked` stops at the first token it
 * does not recognize, so a link written here and opened by a not-yet-updated
 * build strands only what is ordered after it, and there is nothing after
 * it.
 *
 * `happy-dom` for `readInitialMapsState`'s `window.location` read, and the
 * `@glyphcss/effects` stub for the reason
 * `mapsUrlState.terrainRenderModeLink.test.ts` gives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { MAPS_PARAM, MAPS_URL_DEFAULTS, mapsCodec, readInitialMapsState } from "./mapsUrlState";

/** `mapsUrlState.terrainRenderModeLink.test.ts` — a real v2 link carrying the retired `m` token. */
const TERRAIN_MODE_LINK = "p2x54wcdoy5rvh5ks33wbP1m0";
/** `mapsUrlState.orthographicLink.test.ts` — a real v1 link carrying the retired `orthographic` projection. */
const ORTHOGRAPHIC_LINK = "p1p3e211x23fy3-19s2fat1mP1";
/** `mapsUrlState.precision.test.ts` — a real v1 link from before the coordinate-precision fix. */
const OLD_LINK_A = "p1x24gy2hsE1";

function setUrl(packed: string): void {
  window.history.replaceState(null, "", `/maps?${MAPS_PARAM}=${packed}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("mapsUrlState — walk", () => {
  it("defaults to off: a reader opens the map, not a street", () => {
    expect(MAPS_URL_DEFAULTS.walk).toBe(false);
  });

  it("omits its token at the default, so a link that never walked costs nothing", () => {
    expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).not.toMatch(/(^|~)w/);
  });

  it("round-trips a whole walker: the flag, and the pose already in the link", () => {
    // A real walk pose: standing in Zurich, facing east-south-east, looking
    // 16 degrees down (`getTilt()` 74 = the horizon's 90 minus 16), with
    // `view.span` at the walker's own footprint (`glyphMapWalkSpan(400)`).
    const state = {
      ...MAPS_URL_DEFAULTS,
      walk: true,
      centerLon: 8.541694,
      centerLat: 47.376888,
      span: 0.0071944,
      tilt: 74,
      bearing: 113,
    };
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded.walk).toBe(true);
    expect(decoded.centerLon).toBeCloseTo(8.541694, 5);
    expect(decoded.centerLat).toBeCloseTo(47.376888, 5);
    expect(decoded.span).toBeCloseTo(0.0071944, 6);
    expect(decoded.tilt).toBeCloseTo(74, 6);
    expect(decoded.bearing).toBeCloseTo(113, 6);
  });

  it("does not shadow `W` (fillDensity) — the token map is case-sensitive", () => {
    const state = { ...MAPS_URL_DEFAULTS, walk: true, fillDensity: 2.7 };
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded.walk).toBe(true);
    expect(decoded.fillDensity).toBeCloseTo(2.7, 6);
  });

  it("is written LAST, so an older build stops at it and keeps everything else", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, walk: true, osmDensities: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    // `M` (the previous append) is present and `w1` is the tail: a bool
    // packs as one character, so this is the whole of "nothing follows it".
    expect(packed).toContain("M");
    expect(packed.endsWith("w1")).toBe(true);
  });

  it("a link from before the field existed decodes to walk off, with everything else intact", () => {
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, span: 55, tilt: 12, bearing: 137, sunMode: "manual" as const });
    const decoded = mapsCodec.decode(legacy);
    expect(decoded.walk ?? MAPS_URL_DEFAULTS.walk).toBe(false);
    expect(decoded.tilt).toBeCloseTo(12, 6);
    expect(decoded.bearing).toBeCloseTo(137, 6);
    expect(decoded.sunMode).toBe("manual");
  });

  /**
   * The real vendored links, decoded through the live reader. Each is
   * checked for the values its OWN test file already pins, plus `walk` at
   * `false` — the whole property an append has to keep.
   */
  it("every already-shared link still decodes to exactly what it decodes to today", () => {
    setUrl(TERRAIN_MODE_LINK);
    const v2 = readInitialMapsState();
    expect(v2.walk).toBe(false);
    expect(v2.projection).toBe("globe");
    expect(v2.centerLon).toBe(8.2275);
    expect(v2.palette).toBe("viridis");

    setUrl(ORTHOGRAPHIC_LINK);
    const ortho = readInitialMapsState();
    expect(ortho.walk).toBe(false);
    expect(ortho.projection).toBe(MAPS_URL_DEFAULTS.projection);
    expect(ortho.exaggeration).toBe(37);

    setUrl(OLD_LINK_A);
    const v1 = readInitialMapsState();
    expect(v1.walk).toBe(false);
    expect(v1.centerLon).toBe(16);
    expect(v1.colorEncoding).toBe("atlas");
  });
});
