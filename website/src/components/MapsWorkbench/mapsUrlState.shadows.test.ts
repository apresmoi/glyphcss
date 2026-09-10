import { describe, expect, it } from "vitest";
import { MAPS_URL_DEFAULTS, mapsCodec } from "./mapsUrlState";

/**
 * The cast-shadow toggle's URL field, appended under token `D`.
 *
 * Same property the sun and the bearing fields carry, and the only one worth
 * pinning: the codec is TOKEN-keyed, so a link written before this control
 * existed carries no `D`, decodes to `false`, and describes exactly the map
 * it always did — no version bump, nothing retired. `D` rather than `S`/`s`,
 * both of which the schema already spends (`smoothShading`, `span`), which is
 * what the collision clause below actually checks.
 */
describe("mapsUrlState — shadows", () => {
  it("defaults to off, like the widget's own default", () => {
    expect(MAPS_URL_DEFAULTS.shadows).toBe(false);
  });

  it("omits its token at the default, so a shadowless link costs nothing", () => {
    expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).not.toMatch(/(^|~)D/);
  });

  it("a link from before the field existed decodes to shadows off, with everything else intact", () => {
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, span: 55, tilt: 12, sunMode: "manual" as const });
    const decoded = mapsCodec.decode(legacy);
    expect(decoded.shadows ?? MAPS_URL_DEFAULTS.shadows).toBe(false);
    expect(decoded.tilt).toBeCloseTo(12, 6);
    expect(decoded.sunMode).toBe("manual");
  });

  it("carries shadows alongside the rest of the state, without shadowing a token already spoken for", () => {
    const state = {
      ...MAPS_URL_DEFAULTS,
      shadows: true,
      // `S` and `s` are the two tokens `D` was chosen to avoid; both are set
      // to non-defaults here so the codec has to emit all three.
      smoothShading: true,
      span: 8,
      sunMode: "manual" as const,
    };
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded.shadows).toBe(true);
    expect(decoded.smoothShading).toBe(true);
    expect(decoded.span).toBeCloseTo(8, 3);
    expect(decoded.sunMode).toBe("manual");
  });
});
