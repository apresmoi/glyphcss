// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { mapsCodec, readInitialMapsState } from "./mapsUrlState";

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
});

describe("/maps opening orientation", () => {
  it("opens a fresh map head-on and north-up", () => {
    window.history.replaceState(null, "", "/maps");
    expect(readInitialMapsState()).toMatchObject({ tilt: 0, bearing: 0 });
  });

  it("preserves the straight view when its generated URL is reloaded", () => {
    window.history.replaceState(null, "", "/maps");
    const state = readInitialMapsState();
    window.history.replaceState(null, "", `/maps?m=${mapsCodec.encode(state)}`);
    expect(readInitialMapsState()).toMatchObject({ tilt: 0, bearing: 0 });
  });

  it.each(["p1", "p2", "p3"])("keeps the original orientation of a %s link without a tilt token", (packed) => {
    window.history.replaceState(null, "", `/maps?m=${packed}`);
    expect(readInitialMapsState()).toMatchObject({ tilt: 40, bearing: 0 });
  });

  it.each([
    ["p3x6-yr9j3y6-klm20s4-9v5t21nE1b211L1bO21g", -58.379007, -34.60068, 0.0016740658010686747, 59],
    ["p3x6-yr92ay6-kllnps4-9r4t21vE1b211L1bO21g", -58.378402, -34.600165, 0.0017999435062305911, 67],
  ] as const)("preserves a ground-pivot evidence link: %s", (packed, centerLon, centerLat, span, tilt) => {
    window.history.replaceState(null, "", `/maps?m=${packed}`);
    const state = readInitialMapsState();
    expect(state).toMatchObject({ centerLon, centerLat, tilt, bearing: 37, exaggeration: 12 });
    expect(state.span).toBeCloseTo(span, 12);
    const decoded = mapsCodec.decode(mapsCodec.encode(state));
    expect(decoded).toMatchObject({ centerLon, centerLat, tilt, bearing: 37 });
    expect(decoded.span).toBeCloseTo(span, 12);
  });

  it("restores an explicitly tilted and turned shared view", () => {
    window.history.replaceState(null, "", "/maps");
    const state = { ...readInitialMapsState(), tilt: 12, bearing: 137 };
    window.history.replaceState(null, "", `/maps?m=${mapsCodec.encode(state)}`);
    expect(readInitialMapsState()).toMatchObject({ tilt: 12, bearing: 137 });
  });
});
