// @vitest-environment happy-dom
/**
 * `/maps` dropped Braille from the character-mode picker — with Terrain
 * pinned to solid (see `mapsUrlState.terrainRenderModeLink.test.ts`),
 * Braille's binary 2x4 sub-cell dot mask can never carry solid mode's
 * shading ramp, so it's structurally dead weight rather than a real choice.
 * `charMode` is URL-persisted at token `c` (an enum index into
 * `CHAR_MODE_VALUES`) — a link shared before this change can still carry
 * the retired `"braille"` value there. This file pins exactly what
 * `readInitialMapsState` does with one today, and mutation-checks the
 * fallback that makes it safe.
 *
 * The naive removal (just deleting `"braille"` from `CHAR_MODE_VALUES`) is
 * the exact same P0 `mapsUrlState.orthographicLink.test.ts` already proved
 * for `projection`'s `"orthographic"` value: `decodePackedEnum` resolves an
 * enum by INDEX, so deleting `"braille"` (index 1) would shift
 * `"halfblock"`/`"quadrant"` into its old slot, and `charMode` is not this
 * schema's first field, so every field ordered after `c` in the packed
 * string would still decode — just under the WRONG charMode. `mapsUrlState.ts`
 * fixes this the same way it fixed `projection`: `"braille"` stays in
 * `CHAR_MODE_VALUES` as a decode-only legacy value (positional indices
 * undisturbed), and `readInitialMapsState` maps a decoded `"braille"` to
 * the schema default explicitly.
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

import { MAPS_PARAM, MAPS_URL_DEFAULTS, mapsCodec, mapsCodecLegacyV2, readInitialMapsState } from "./mapsUrlState";

// A REAL "2"-tagged link: `mapsCodec.encode()` against the pre-removal (v2)
// schema for `{ ...MAPS_URL_DEFAULTS, charMode: "braille", centerLon: -3.7,
// centerLat: 40.4, span: 30 }` — captured before Braille was dropped from
// the picker, exactly as a browser would have produced and shared it. No
// real link could ever carry `charMode: "braille"` under the CURRENT (v3)
// schema — the UI that produced it predates both the schema bump and the
// removal — so a genuine fixture for this value is necessarily "2"-tagged,
// which also exercises `mapsCodecLegacyV2`'s own dispatch
// (`mapsUrlState.terrainRenderModeLink.test.ts`) along the way.
const BRAILLE_LINK = "p2x6-27axsy5o1wu8s358yc1";

function setUrl(search: string): void {
  window.history.replaceState(null, "", search ? `/maps?${search}` : "/maps");
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("/maps: a legacy braille charMode link decodes safely", () => {
  it("the raw (legacy v2) codec still decodes \"braille\" as the value for token c (the enum index isn't dropped, only what the page does with it changes)", () => {
    const decoded = mapsCodecLegacyV2.decode(BRAILLE_LINK);
    expect(decoded.charMode).toBe("braille");
  });

  it("every OTHER field on the link survives the raw decode", () => {
    const decoded = mapsCodecLegacyV2.decode(BRAILLE_LINK);
    expect(decoded.centerLon).toBe(-3.7);
    expect(decoded.centerLat).toBe(40.4);
    expect(decoded.span).toBeCloseTo(30, 1);
  });

  it("readInitialMapsState falls the charMode back to the schema default and keeps every other field from the link", () => {
    setUrl(`${MAPS_PARAM}=${BRAILLE_LINK}`);
    const state = readInitialMapsState();
    expect(state.charMode).toBe(MAPS_URL_DEFAULTS.charMode);
    expect(state.charMode).not.toBe("braille");
    expect(state.centerLon).toBe(-3.7);
    expect(state.centerLat).toBe(40.4);
    expect(state.span).toBeCloseTo(30, 1);
  });

  it("a link with no charMode token at all is unaffected — still takes the schema default", () => {
    setUrl("");
    expect(readInitialMapsState().charMode).toBe(MAPS_URL_DEFAULTS.charMode);
  });

  it("a link explicitly carrying a still-valid charMode (quadrant) is unaffected by the legacy-value fallback", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, charMode: "quadrant" });
    setUrl(`${MAPS_PARAM}=${packed}`);
    expect(readInitialMapsState().charMode).toBe("quadrant");
  });
});
