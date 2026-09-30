// @vitest-environment happy-dom
/**
 * `/maps` retired the Terrain layer's render-mode control ("terrain doesn't
 * make sense as anything but solid" — a relief mesh is always rasterized
 * `solid` now, `MAP_SCENE_RENDER_MODE` in `mapsKit.tsx`). The control drove
 * `MapsUrlState.terrainRenderMode`, URL-persisted at token `m` — a link
 * shared before this change can still carry a genuine non-default value
 * there (`m=wireframe`/`m=ink`). This file pins exactly what
 * `readInitialMapsState` does with one today, and mutation-checks the
 * version-dispatch fix that makes it safe.
 *
 * The naive removal (just deleting the `terrainRenderMode` field from
 * `mapsFields`) is a genuine P0: unlike the `"orthographic"` projection
 * value retirement (`mapsUrlState.orthographicLink.test.ts`), there is no
 * enum slot to keep occupied here — the whole FIELD is gone, so
 * `decodePacked`'s "unknown token: stop, keep what's parsed" short-circuit
 * (`urlState.ts`) fires the instant it reaches token `m`, silently
 * reverting every field ordered after it (density, smooth shading,
 * lighting, sun, ...) to schema defaults. `mapsUrlState.ts` fixes this by
 * bumping `MAPS_SCHEMA_VERSION` 2 -> 3 and keeping `mapsCodecLegacyV2` — a
 * decode-only codec bound to version "2" that still recognizes token `m` —
 * dispatched to by `readInitialMapsState` purely on the link's own version
 * tag, mirroring `mapsCodecLegacyV1`'s existing shape.
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
// schema for `{ ...MAPS_URL_DEFAULTS, terrainRenderMode: "wireframe",
// centerLon: 8.2275, centerLat: 46.8182, span: 12.5, palette: "viridis" }` —
// captured before the Terrain "mode" control was retired, exactly as a
// browser would have produced and shared it. `MAPS_SCHEMA_VERSION` has since
// bumped 2 -> 3 for this removal, so a raw decode of this "2"-tagged link
// now goes through `mapsCodecLegacyV2` (the version this link was actually
// written against), not the live `mapsCodec` — `readInitialMapsState`
// (exercised further below) still dispatches to it automatically.
const TERRAIN_MODE_LINK = "p2x54wcdoy5rvh5ks33wbP1m0";

function setUrl(search: string): void {
  window.history.replaceState(null, "", search ? `/maps?${search}` : "/maps");
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("/maps: a legacy terrain-render-mode link decodes safely", () => {
  it("the raw (legacy v2) codec still decodes token \"m\" as terrainRenderMode (the field isn't dropped, only what the page does with it changes)", () => {
    const decoded = mapsCodecLegacyV2.decode(TERRAIN_MODE_LINK);
    expect(decoded.terrainRenderMode).toBe("wireframe");
  });

  it("every OTHER field on the link survives the raw decode — the unknown-token failure mode would have wiped everything ordered after `m`, not just terrainRenderMode", () => {
    const decoded = mapsCodecLegacyV2.decode(TERRAIN_MODE_LINK);
    expect(decoded.centerLon).toBe(8.2275);
    expect(decoded.centerLat).toBe(46.8182);
    expect(decoded.span).toBeCloseTo(12.5, 1);
    expect(decoded.palette).toBe("viridis");
  });

  it("readInitialMapsState dispatches a \"2\"-tagged link to the legacy codec, drops terrainRenderMode from live state, and keeps every other field", () => {
    setUrl(`${MAPS_PARAM}=${TERRAIN_MODE_LINK}`);
    const state = readInitialMapsState();
    expect(state).not.toHaveProperty("terrainRenderMode");
    expect(state.centerLon).toBe(8.2275);
    expect(state.centerLat).toBe(46.8182);
    expect(state.span).toBeCloseTo(12.5, 1);
    expect(state.palette).toBe("viridis");
  });

  it("a link with no terrain-mode token at all is unaffected — still takes schema defaults for everything", () => {
    setUrl("");
    const state = readInitialMapsState();
    expect(state).not.toHaveProperty("terrainRenderMode");
    expect(state.palette).toBe(MAPS_URL_DEFAULTS.palette);
  });

  it("a freshly-written (v3) link is NOT readable by the legacy v2 codec — the version gate routes old vs new, not value sniffing", () => {
    const freshLink = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, centerLon: 8.2275, centerLat: 46.8182 });
    expect(freshLink[1]).not.toBe("2");
    expect(mapsCodecLegacyV2.decode(freshLink)).toEqual({});
  });
});
