// @vitest-environment happy-dom
/**
 * `/maps` retired its `"orthographic"` projection option (the picker now
 * offers only equirectangular/Mercator/globe — `glyphMapOrthographic` stays
 * exported from `@glyphcss/maps` itself; only this PAGE stopped offering
 * it). A link shared before that change can still carry the retired
 * value at token `p`'s encoded index (3) — this file pins exactly what
 * `readInitialMapsState` does with one today, and mutation-checks the
 * fallback that makes it safe.
 *
 * The naive removal (just deleting `"orthographic"` from the codec's own
 * `PROJECTION_VALUES` enum array) was verified empirically to be a genuine
 * P0: `decodePackedEnum` (`urlState.ts`) returns `undefined` for an
 * out-of-range index, and `decodePacked`'s "unknown token: stop, keep
 * what's parsed" short-circuit fires the SAME way for that as for a
 * genuinely unknown token — since `projection` is this schema's very FIRST
 * field, that took `mapsCodec.decode()` from a full, valid partial state
 * down to `{}`, reverting EVERY field on the link (exaggeration, center,
 * span, tilt, palette, lighting, ...) to schema defaults, not just the
 * projection. `mapsUrlState.ts` fixes this by keeping `"orthographic"` in
 * `PROJECTION_VALUES` as a decode-only legacy value (so the enum's
 * positional indices, and so every other field's decode, are undisturbed)
 * and mapping a decoded `"orthographic"` to the real default projection
 * explicitly in `readInitialMapsState`.
 *
 * `happy-dom`, and the `@glyphcss/effects` stub, for the same reason
 * `mapsUrlState.colorEncoding.test.ts` needs both — see that file's doc.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { MAPS_PARAM, MAPS_URL_DEFAULTS, mapsCodec, mapsCodecLegacyV1, readInitialMapsState } from "./mapsUrlState";

// A REAL link: `mapsCodec.encode()` against the pre-removal, pre-precision-fix
// ("1"-tagged) schema, for `{ ...MAPS_URL_DEFAULTS, projection: "orthographic",
// exaggeration: 37, centerLon: 12.3, centerLat: -4.5, span: 55, tilt: 22,
// palette: "viridis" }` — captured before the projection was retired, exactly
// as a browser would have produced and shared it. `MAPS_SCHEMA_VERSION` has
// since bumped 1 -> 2 for the deep-zoom precision fix
// (`mapsUrlState.precision.test.ts`), so a RAW decode of this "1"-tagged
// link now goes through `mapsCodecLegacyV1` (the version this link was
// actually written against), not the live `mapsCodec` — `readInitialMapsState`
// (exercised further below) still dispatches to it automatically.
const ORTHOGRAPHIC_LINK = "p1p3e211x23fy3-19s2fat1mP1";

function setUrl(search: string): void {
  window.history.replaceState(null, "", search ? `/maps?${search}` : "/maps");
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("/maps: a legacy orthographic link decodes safely", () => {
  it("the raw (legacy v1) codec still decodes \"orthographic\" as the value for token p (the enum index isn't dropped, only what the page does with it changes)", () => {
    const decoded = mapsCodecLegacyV1.decode(ORTHOGRAPHIC_LINK);
    expect(decoded.projection).toBe("orthographic");
  });

  it("every OTHER field on the link survives the raw decode — the out-of-range-index failure mode would have wiped all of them, not just projection", () => {
    const decoded = mapsCodecLegacyV1.decode(ORTHOGRAPHIC_LINK);
    expect(decoded).toMatchObject({
      exaggeration: 37,
      centerLon: 12.3,
      centerLat: -4.5,
      span: 55,
      tilt: 22,
      palette: "viridis",
    });
  });

  it("readInitialMapsState falls back the projection to the schema default and keeps every other field from the link", () => {
    setUrl(`${MAPS_PARAM}=${ORTHOGRAPHIC_LINK}`);
    const state = readInitialMapsState();
    expect(state.projection).toBe(MAPS_URL_DEFAULTS.projection);
    expect(state.projection).not.toBe("orthographic");
    expect(state.exaggeration).toBe(37);
    expect(state.centerLon).toBe(12.3);
    expect(state.centerLat).toBe(-4.5);
    expect(state.span).toBe(55);
    expect(state.tilt).toBe(22);
    expect(state.palette).toBe("viridis");
  });

  it("a link with no projection token at all is unaffected — still takes the schema default", () => {
    setUrl("");
    expect(readInitialMapsState().projection).toBe(MAPS_URL_DEFAULTS.projection);
  });

  it("a link explicitly carrying a still-valid projection (globe) is unaffected by the legacy-value fallback", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, projection: "equirectangular" });
    setUrl(`${MAPS_PARAM}=${packed}`);
    expect(readInitialMapsState().projection).toBe("equirectangular");
  });
});
