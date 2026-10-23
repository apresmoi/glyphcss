// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { MAPS_URL_DEFAULTS, mapsCodec, readInitialMapsState } from "./mapsUrlState";

afterEach(() => {
  window.history.replaceState(null, "", "/maps/");
  vi.restoreAllMocks();
});
it("defaults fresh maps and old links to snapped pans without changing existing tuples", () => {
  window.history.replaceState(null, "", "/maps/");
  expect(readInitialMapsState().snapPan).toBe(true);
  window.history.replaceState(null, "", "/maps/?m=p3x6-wiwaoy6-h6z89s37j5t10E1O338c");
  const old = readInitialMapsState();
  expect(old.snapPan).toBe(true);
  expect(old.centerLon).toBe(-54.629376);
  expect(old.centerLat).toBe(-28.879065);
  expect(old.tilt).toBe(0);
  const state = {
    ...old,
    snapPan: false,
    osmDensities: MAPS_URL_DEFAULTS.osmDensities.map((_, i) => 1 + i / 10),
    liveWindows: [0, 1, 2, 3],
  };
  const decoded = mapsCodec.decode(mapsCodec.encode(state));
  expect(decoded.snapPan).toBe(false);
  expect(decoded.osmDensities).toEqual(state.osmDensities);
  expect(decoded.liveWindows).toEqual(state.liveWindows);
  expect(decoded.centerLon).toBe(old.centerLon);
  expect(decoded.centerLat).toBe(old.centerLat);
});
it("stores each toggle value and omits the appended token at its default", () => {
  expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).toBe("p3");
  expect(mapsCodec.decode(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, snapPan: false })).snapPan).toBe(false);
  expect(
    mapsCodec.decode(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, snapPan: true })).snapPan ?? MAPS_URL_DEFAULTS.snapPan,
  ).toBe(true);
});
