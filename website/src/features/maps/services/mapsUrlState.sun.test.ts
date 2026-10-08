import { describe, expect, it } from "vitest";
import { MAPS_URL_DEFAULTS, mapsCodec } from "./mapsUrlState";

/**
 * The sun's three URL fields. The codec is TOKEN-keyed, not positional, so
 * the interesting property is not that they were appended — it is that a
 * link written before they existed carries none of them and therefore
 * decodes to `sunMode: "off"`, i.e. the pre-sun render exactly.
 */
describe("mapsUrlState — sun", () => {
  it("defaults to the pre-existing lighting (sun off)", () => {
    expect(MAPS_URL_DEFAULTS.sunMode).toBe("off");
  });

  it("omits every sun token at the default, so a default link is unchanged", () => {
    const encoded = mapsCodec.encode(MAPS_URL_DEFAULTS);
    expect(encoded).not.toMatch(/(^|~)n/);
    expect(encoded).not.toMatch(/(^|~)j/);
    expect(encoded).not.toMatch(/(^|~)h/);
  });

  it("a link with no sun tokens decodes to the default sun", () => {
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, span: 55, tilt: 12 });
    const decoded = mapsCodec.decode(legacy);
    expect(decoded.sunMode ?? MAPS_URL_DEFAULTS.sunMode).toBe("off");
    // `span` is `"logFloat"`-encoded (mapsUrlState.ts's `SPAN_LOG_STEP` doc):
    // a fixed RELATIVE step, not an exact round-trip for a round number like
    // `tilt`'s plain `"float"` below — worst-case relative error is ~0.025%,
    // i.e. ~0.0138 absolute at 55, well inside `toBeCloseTo(55, 1)`'s 0.05.
    expect(decoded.span).toBeCloseTo(55, 1);
    expect(decoded.tilt).toBeCloseTo(12, 6);
  });

  it("round-trips a realtime sun and a manual sun's day/hour", () => {
    for (const state of [
      { ...MAPS_URL_DEFAULTS, sunMode: "realtime" as const },
      { ...MAPS_URL_DEFAULTS, sunMode: "manual" as const, sunDay: 300, sunHour: 6.25 },
    ]) {
      const decoded = mapsCodec.decode(mapsCodec.encode(state));
      expect(decoded.sunMode).toBe(state.sunMode);
      expect(decoded.sunDay ?? MAPS_URL_DEFAULTS.sunDay).toBe(state.sunDay);
      expect(decoded.sunHour ?? MAPS_URL_DEFAULTS.sunHour).toBeCloseTo(state.sunHour, 6);
    }
  });

  it("does not disturb the fields ordered before it", () => {
    const state = { ...MAPS_URL_DEFAULTS, projection: "mercator" as const, palette: "heat" as const, sunMode: "realtime" as const };
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded.projection).toBe("mercator");
    expect(decoded.palette).toBe("heat");
    expect(decoded.sunMode).toBe("realtime");
  });
});
