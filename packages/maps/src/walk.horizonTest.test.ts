/**
 * `glyphMapWalkHorizonTest` — the walker-resolved form of
 * {@link glyphMapWalkWithinHorizon}, and the two exact pre-rejects it puts in
 * front of the haversine.
 *
 * This is the hottest predicate in walk mode: a `fill-extrusion`'s wall cull
 * asks it once per wall corner over 45,726 polygons per moving frame, and it
 * was the single largest self-time entry in the CPU profile of the reported
 * street-level scene. The optimisation is a latitude band (`σ >= |Δφ|`) and a
 * longitude band (`sin(σ/2) >= cos φmax · |sin(Δλ/2)|`, valid only once the
 * latitude band has passed) — both LOWER BOUNDS on the same great-circle
 * distance, so a point either fails one and is provably outside, or falls
 * through to the unchanged haversine.
 *
 * The failure mode is silent and one-sided: a bound that is too tight clips
 * geometry that should be drawn, and the picture just has fewer buildings in
 * it. So the gate is AGREEMENT with the bare function, point for point, over
 * a sample dense enough to straddle both bands — including the exact boundary,
 * where any algebraic shortcut would show first.
 */
import { describe, expect, it } from "vitest";
import { glyphMapWalkHorizonTest, glyphMapWalkWithinHorizon } from "./walk";

const R = 6_371_000;
/** Metres per degree of latitude on that sphere. */
const M_PER_DEG = (Math.PI / 180) * R;

/**
 * The bare haversine, restated here, because the shipped
 * `glyphMapWalkWithinHorizon` now DELEGATES to the function under test — so
 * comparing the two would compare it with itself, and a mutation of the
 * bands would move both sides together. This is the independent oracle: the
 * expression exactly as it stood before the walker hoist and the two
 * pre-rejects existed.
 */
function referenceWithinHorizon(
  walkerLon: number, walkerLat: number, lon: number, lat: number, farM: number, radiusM = R,
): boolean {
  const DEG = Math.PI / 180;
  const phi1 = walkerLat * DEG, phi2 = lat * DEG;
  const dPhi = phi2 - phi1;
  const dLambda = (lon - walkerLon) * DEG;
  const sinHalfPhi = Math.sin(dPhi / 2);
  const sinHalfLambda = Math.sin(dLambda / 2);
  const h = sinHalfPhi * sinHalfPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h))) <= farM;
}

describe("glyphMapWalkHorizonTest", () => {
  it("agrees with glyphMapWalkWithinHorizon on a dense grid around the walker", () => {
    for (const [wlon, wlat] of [[8.5417, 47.3769], [0, 0], [-122.4, 37.8], [18.0, -33.9]] as const) {
      for (const far of [120, 600, 5_000, 200_000]) {
        const test = glyphMapWalkHorizonTest(wlon, wlat, far);
        // Reach out to 4x the horizon in each axis so the sample crosses both
        // bands and the haversine's own boundary many times over.
        const reachDeg = (4 * far) / M_PER_DEG;
        for (let i = -20; i <= 20; i++) {
          for (let j = -20; j <= 20; j++) {
            const lat = wlat + (reachDeg * i) / 20;
            const lon = wlon + (reachDeg * j) / (20 * Math.max(0.05, Math.cos((wlat * Math.PI) / 180)));
            expect(test(lon, lat)).toBe(referenceWithinHorizon(wlon, wlat, lon, lat, far));
          }
        }
      }
    }
  });

  it("agrees at the exact boundary, approached from both sides", () => {
    const wlon = 8.5417, wlat = 47.3769, far = 600;
    const test = glyphMapWalkHorizonTest(wlon, wlat, far);
    const farDeg = far / M_PER_DEG;
    // Due north, due south, due east, due west, and a diagonal — each stepped
    // through the horizon in 1-micrometre-scale increments.
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071]] as const) {
      for (let k = -8; k <= 8; k++) {
        const scale = 1 + k * 1e-9;
        const lat = wlat + du * farDeg * scale;
        const lon = wlon + (dv * farDeg * scale) / Math.cos((wlat * Math.PI) / 180);
        expect(test(lon, lat)).toBe(referenceWithinHorizon(wlon, wlat, lon, lat, far));
      }
    }
  });

  it("agrees across the antimeridian and near the poles, where the bands degenerate", () => {
    for (const [wlon, wlat] of [[179.98, 0], [-179.99, 12], [10, 89.5], [10, -89.7]] as const) {
      const far = 50_000;
      const test = glyphMapWalkHorizonTest(wlon, wlat, far);
      for (let i = -12; i <= 12; i++) {
        for (let j = -12; j <= 12; j++) {
          const lat = Math.max(-90, Math.min(90, wlat + i * 0.4));
          const lon = wlon + j * 3;
          expect(test(lon, lat)).toBe(referenceWithinHorizon(wlon, wlat, lon, lat, far));
        }
      }
    }
  });

  it("is what the exported bare function now answers with", () => {
    // The delegation itself, so the public entry point cannot drift away from
    // the form every clause above is checked against.
    for (const lat of [47.3769, 47.38, 47.4, 48, 50]) {
      expect(glyphMapWalkWithinHorizon(8.5417, 47.3769, 8.5417, lat, 600))
        .toBe(referenceWithinHorizon(8.5417, 47.3769, 8.5417, lat, 600));
    }
  });

  it("still answers TRUE and FALSE — the sample is not one-sided", () => {
    const test = glyphMapWalkHorizonTest(8.5417, 47.3769, 600);
    expect(test(8.5417, 47.3769)).toBe(true);
    expect(test(8.5417, 47.3769 + 0.004)).toBe(true);
    expect(test(8.5417, 47.3769 + 0.02)).toBe(false);
    expect(test(8.5417 + 0.03, 47.3769)).toBe(false);
  });

  it("honours a non-default sphere radius the same way the bare function does", () => {
    const test = glyphMapWalkHorizonTest(0, 0, 600, 1000);
    for (let i = -10; i <= 10; i++) {
      const lat = i * 20;
      expect(test(0, lat)).toBe(referenceWithinHorizon(0, 0, 0, lat, 600, 1000));
    }
  });
});
