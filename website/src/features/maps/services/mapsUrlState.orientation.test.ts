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

  it("restores an explicitly tilted and turned shared view", () => {
    window.history.replaceState(null, "", "/maps");
    const state = { ...readInitialMapsState(), tilt: 12, bearing: 137 };
    window.history.replaceState(null, "", `/maps?m=${mapsCodec.encode(state)}`);
    expect(readInitialMapsState()).toMatchObject({ tilt: 12, bearing: 137 });
  });
});
