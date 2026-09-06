import { describe, expect, it } from "vitest";
import { glyphMapProjectionTransition } from "./transition";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator, glyphMapOrthographic } from "./projection";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapBounds } from "./types";

function stubProjection(opts: {
  readonly id: string;
  readonly domain: GlyphMapBounds;
  readonly project: GlyphMapProjection["project"];
}): GlyphMapProjection {
  return {
    id: opts.id,
    // These stubs' own `project` ignores elevation entirely, so the relief
    // scale is only here to satisfy the interface — `1` (true scale) is the
    // neutral value.
    exaggeration: 1,
    domain: opts.domain,
    project: opts.project,
    unproject() {
      throw new Error("stubProjection.unproject should never be called by these tests");
    },
  };
}

describe("glyphMapProjectionTransition", () => {
  it("t=0 returns the FIRST endpoint object itself (reference-identical, not merely value-equal)", () => {
    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    expect(glyphMapProjectionTransition(a, b, 0)).toBe(a);
  });

  it("t=1 returns the SECOND endpoint object itself (reference-identical)", () => {
    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    expect(glyphMapProjectionTransition(a, b, 1)).toBe(b);
  });

  it("clamps out-of-range t to the nearest endpoint object", () => {
    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    expect(glyphMapProjectionTransition(a, b, -5)).toBe(a);
    expect(glyphMapProjectionTransition(a, b, 5)).toBe(b);
  });

  it("interior t linearly interpolates project() per component", () => {
    const a = stubProjection({ id: "a", domain: { west: -10, east: 10, south: -10, north: 10 }, project: () => [0, 0, 0] });
    const b = stubProjection({ id: "b", domain: { west: -20, east: 20, south: -20, north: 20 }, project: () => [10, 20, 30] });
    const blend = glyphMapProjectionTransition(a, b, 0.25);
    expect(blend.project(0, 0, 0)).toEqual([2.5, 5, 7.5]);
  });

  it("MUTATION-CHECKABLE: either endpoint outside its valid window (NaN) propagates as a full [NaN,NaN,NaN], never a partial lerp or a substituted 0", () => {
    const finite = stubProjection({ id: "finite", domain: { west: -180, east: 180, south: -90, north: 90 }, project: () => [1, 2, 3] });
    const outside = stubProjection({ id: "outside", domain: { west: -180, east: 180, south: -90, north: 90 }, project: () => [NaN, NaN, NaN] });

    const blendBNaN = glyphMapProjectionTransition(finite, outside, 0.5);
    const [x1, y1, z1] = blendBNaN.project(0, 0, 0);
    expect(Number.isNaN(x1)).toBe(true);
    expect(Number.isNaN(y1)).toBe(true);
    expect(Number.isNaN(z1)).toBe(true);

    const blendANaN = glyphMapProjectionTransition(outside, finite, 0.5);
    const [x2, y2, z2] = blendANaN.project(0, 0, 0);
    expect(Number.isNaN(x2)).toBe(true);
    expect(Number.isNaN(y2)).toBe(true);
    expect(Number.isNaN(z2)).toBe(true);
  });

  it("a single non-finite COMPONENT on one endpoint (not the whole triple) still blanks the whole result", () => {
    const finite = stubProjection({ id: "finite", domain: { west: -180, east: 180, south: -90, north: 90 }, project: () => [1, 2, 3] });
    const partiallyBad = stubProjection({ id: "partial", domain: { west: -180, east: 180, south: -90, north: 90 }, project: () => [4, NaN, 6] });
    const blend = glyphMapProjectionTransition(finite, partiallyBad, 0.5);
    const [x, y, z] = blend.project(0, 0, 0);
    expect(Number.isNaN(x)).toBe(true);
    expect(Number.isNaN(y)).toBe(true);
    expect(Number.isNaN(z)).toBe(true);
  });

  it("domain is the UNION of both endpoints' domains for an interior t", () => {
    const a = stubProjection({ id: "a", domain: { west: -10, east: 5, south: -20, north: 15 }, project: () => [0, 0, 0] });
    const b = stubProjection({ id: "b", domain: { west: -30, east: 2, south: -5, north: 40 }, project: () => [0, 0, 0] });
    const blend = glyphMapProjectionTransition(a, b, 0.5);
    expect(blend.domain).toEqual({ west: -30, east: 5, south: -20, north: 40 });
  });

  it("MUTATION-CHECKABLE: unproject() throws a descriptive error for an interior t, never a plausible-looking wrong inverse", () => {
    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    const blend = glyphMapProjectionTransition(a, b, 0.5);
    expect(() => blend.unproject([0, 0, 0])).toThrow(TypeError);
    expect(() => blend.unproject([0, 0, 0])).toThrow(/no closed-form unproject/);
  });

  it("does not expose visible/cameraForCenter/centerForCamera on a blended interior projection", () => {
    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    const blend = glyphMapProjectionTransition(a, b, 0.5);
    expect(blend.visible).toBeUndefined();
    expect(blend.cameraForCenter).toBeUndefined();
    expect(blend.centerForCamera).toBeUndefined();
  });
});

// ── The globe<->sheet unwrap ────────────────────────────────────────────

const GRID: readonly (readonly [number, number])[] = (() => {
  const out: Array<readonly [number, number]> = [];
  for (let lon = -180; lon <= 180; lon += 15) for (let lat = -75; lat <= 75; lat += 15) out.push([lon, lat]);
  return out;
})();

/**
 * The projected surface's true DIAMETER — the largest distance between any
 * two sampled vertices. Deliberately the max pairwise distance rather than a
 * bounding-box diagonal: the unwrap carries the surface between two world
 * frames by a rigid rotation, and a rotation leaves a diameter alone while
 * it visibly swings a bounding box. Measuring a rotation-variant quantity
 * would report a size change where there is none.
 */
function surfaceDiameter(p: GlyphMapProjection): number {
  const pts = GRID.map(([lon, lat]) => p.project(lon, lat, 0)).filter((v) => v.every(Number.isFinite));
  let max = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
      if (d > max) max = d;
    }
  }
  return max;
}

/** World units per degree of arc at the prime meridian — what `createGlyphMap.computeZoomForSpan` inverts to get `camera.zoom`. */
function degreeScale(p: GlyphMapProjection): number {
  const eps = 1e-3;
  const west = p.project(-eps, 0, 0);
  const east = p.project(eps, 0, 0);
  return Math.hypot(east[0] - west[0], east[1] - west[1], east[2] - west[2]) / (2 * eps);
}

/**
 * ON-SCREEN size at blend fraction `t`, up to the host's fixed pixel width.
 *
 * The world diameter of the blended surface times a LINEAR ramp between the
 * two endpoints' own zooms, each proportional to `1 / degreeScale` of its
 * endpoint. That linear ramp is deliberately kept here even though the real
 * caller no longer uses one: `createGlyphMap.applyProjectionFrame` now FITS
 * `camera.zoom` to whatever surface is on screen each frame, precisely
 * because no blend's world scale is linear in `t` and a linear zoom only ever
 * cancelled one particular schedule. Modelling the harder, unforgiving case
 * here is what keeps this a gate on the TRANSITION's own scale schedule
 * rather than on the caller's: the unwrap's reciprocal schedule is what makes
 * this measurement monotonic, and a schedule that needed the caller's help to
 * look right would still show up as a bulge in these numbers.
 */
function apparentSizes(
  a: GlyphMapProjection,
  b: GlyphMapProjection,
  anchor: readonly [number, number] | undefined,
  steps = 20,
): number[] {
  const zoomA = 1 / degreeScale(a);
  const zoomB = 1 / degreeScale(b);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push(surfaceDiameter(glyphMapProjectionTransition(a, b, t, { anchor })) * (zoomA + (zoomB - zoomA) * t));
  }
  return out;
}

/**
 * ACCEPTANCE GATE for the globe<->sheet unwrap: the user-reported defect was
 * "the animation from globe to the maps is not good — it's like a zoom in and
 * zoom out", and this is the measurement of it.
 *
 * Pre-fix, with `project()` a per-vertex LERP of the two endpoints, the
 * apparent size of a globe -> equirectangular transition measured (0.1 steps,
 * this file's own `apparentSizes`): 114.59, 2016.98, 3591.56, 4727.94,
 * 5425.43, 5683.91, 5503.31, 4883.64, 3824.86, 2326.98, 390.00 — a 49.6x
 * bulge over the start, 14.6x over the end, peaking dead centre, and
 * symmetric in the reverse direction. That is not a morph a viewer can read
 * as anything but a zoom in and back out.
 *
 * With the unwrap it rises monotonically from 114.59 to 390.00: the globe
 * opening out into the map, and nothing else. The pi-ish total growth is
 * REAL and is the unwrap itself — a great circle of circumference C presents
 * a diameter of C/pi while the same arc laid flat presents its full length —
 * so the assertion is monotonicity, not constancy.
 */
describe("glyphMapProjectionTransition — the globe<->sheet unwrap keeps apparent size MONOTONIC", () => {
  /** The caller's view centre, which is also what engages the unwrap — see the option's own doc. */
  const AT: readonly [number, number] = [0, 0];

  const cases: readonly (readonly [string, GlyphMapProjection, GlyphMapProjection, readonly [number, number]])[] = [
    ["globe -> equirectangular", glyphMapGlobe({ radius: 1, exaggeration: 0 }), glyphMapEquirectangular(), AT],
    ["equirectangular -> globe", glyphMapEquirectangular(), glyphMapGlobe({ radius: 1, exaggeration: 0 }), AT],
    ["globe -> Mercator", glyphMapGlobe({ radius: 1, exaggeration: 0 }), glyphMapMercator(), AT],
    ["Mercator -> globe", glyphMapMercator(), glyphMapGlobe({ radius: 1, exaggeration: 0 }), AT],
    // A 100x world scale on the orbit endpoint: the schedule is defined in
    // terms of each endpoint's MEASURED degree scale, so radius must not
    // appear in the answer at all.
    ["globe(radius 100) -> equirectangular", glyphMapGlobe({ radius: 100, exaggeration: 0 }), glyphMapEquirectangular(), AT],
    // An off-centre anchor — the real caller's normal case.
    ["globe -> equirectangular, anchored at 140E/40N", glyphMapGlobe({ radius: 1, exaggeration: 0 }), glyphMapEquirectangular(), [140, 40]],
  ];

  for (const [name, a, b, anchor] of cases) {
    it(`${name}: no non-monotonic bulge across t`, () => {
      const sizes = apparentSizes(a, b, anchor);
      const rising = sizes[sizes.length - 1] >= sizes[0];
      const trace = sizes.map((s) => s.toFixed(1)).join(", ");
      for (let i = 1; i < sizes.length; i++) {
        const prev = sizes[i - 1];
        const next = sizes[i];
        // A 1e-9 relative slack absorbs float noise in the sampled diameter,
        // nothing more — the defect this gate exists for was 4900% out.
        const slack = Math.abs(prev) * 1e-9;
        const at = `t=${i / 20} after t=${(i - 1) / 20} (sizes: ${trace})`;
        if (rising) expect(next, at).toBeGreaterThanOrEqual(prev - slack);
        else expect(next, at).toBeLessThanOrEqual(prev + slack);
      }
      // ...and it must never bulge past either endpoint either, which a
      // monotonicity check alone would still allow if both ends happened to
      // sit on the same side of an interior extremum.
      const lo = Math.min(sizes[0], sizes[sizes.length - 1]);
      const hi = Math.max(sizes[0], sizes[sizes.length - 1]);
      for (const size of sizes) {
        expect(size, trace).toBeGreaterThanOrEqual(lo * (1 - 1e-9));
        expect(size, trace).toBeLessThanOrEqual(hi * (1 + 1e-9));
      }
    });
  }

  it("MUTATION-CHECKABLE: the pre-unwrap lerp really does bulge — the same measurement on an orbit<->sheet pair with NO anchor", () => {
    // With no anchor the unwrap does not engage (see the option's doc), so
    // this is the OLD behaviour, still reachable, still measurably wrong.
    // It is asserted rather than merely described so that a future change
    // silently altering the lerp path shows up here.
    const sizes = apparentSizes(glyphMapGlobe({ radius: 1, exaggeration: 0 }), glyphMapEquirectangular(), undefined);
    const peak = Math.max(...sizes);
    expect(peak / sizes[0]).toBeGreaterThan(40);
    expect(peak / sizes[sizes.length - 1]).toBeGreaterThan(10);
  });

  it("MUTATION-CHECKABLE: the sheet<->sheet pair still takes the plain lerp — two flat maps are already the same surface at the same scale", () => {
    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    const blend = glyphMapProjectionTransition(a, b, 0.375, { anchor: [140, 40] });
    for (const [lon, lat] of [[0, 0], [30, 45], [-120, -60]] as const) {
      const pa = a.project(lon, lat, 0);
      const pb = b.project(lon, lat, 0);
      const got = blend.project(lon, lat, 0);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(pa[k] + (pb[k] - pa[k]) * 0.375, 12);
    }
  });
});

describe("glyphMapProjectionTransition — unwrap continuity, placement, cropping and fallback", () => {
  const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
  const equirect = glyphMapEquirectangular();

  /** The largest distance, over the whole sampled graticule, between the blend at `t` and `endpoint`, relative to that endpoint's own diameter. */
  function driftFrom(
    a: GlyphMapProjection,
    b: GlyphMapProjection,
    t: number,
    endpoint: GlyphMapProjection,
    anchor: readonly [number, number],
  ): number {
    const blend = glyphMapProjectionTransition(a, b, t, { anchor });
    const reference = surfaceDiameter(endpoint);
    let worst = 0;
    for (const [lon, lat] of GRID) {
      const got = blend.project(lon, lat, 0);
      const want = endpoint.project(lon, lat, 0);
      worst = Math.max(worst, Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) / reference);
    }
    return worst;
  }

  /**
   * Continuity, stated as CONVERGENCE RATE rather than as one tolerance at
   * one `t`. The blend approaches each endpoint first-order in `t`, and the
   * constant is genuinely large on the sheet side (a degree of the sheet's
   * world is ~57x a degree of the globe's, so a small `t` still moves a long
   * way in absolute world units) — a fixed epsilon would either be so loose
   * it could not tell a pop from convergence, or so tight it would fail on
   * arithmetic that is behaving exactly as intended. Ten times closer in `t`
   * must be at least five times closer in space; a discontinuity does not
   * shrink at all.
   */
  it("converges CONTINUOUSLY onto each endpoint — no pop on the first or last frame", () => {
    for (const anchor of [[0, 0], [140, 40]] as const) {
      for (const [a, b] of [[globe, equirect], [equirect, globe]] as const) {
        for (const near of [true, false]) {
          const endpoint = near ? a : b;
          const ts = near ? [1e-3, 1e-4, 1e-5] : [1 - 1e-3, 1 - 1e-4, 1 - 1e-5];
          const drifts = ts.map((t) => driftFrom(a, b, t, endpoint, anchor));
          const label = `${a.id}->${b.id} near ${endpoint.id} anchor ${anchor} drifts ${drifts.map((d) => d.toExponential(2)).join(", ")}`;
          expect(drifts[0], label).toBeLessThan(0.25);
          expect(drifts[1], label).toBeLessThan(drifts[0] / 5);
          expect(drifts[2], label).toBeLessThan(drifts[1] / 5);
        }
      }
    }
  });

  /**
   * The placement contract the `anchor` exists for: a caller lerps
   * `camera.target` from the orbit endpoint's `[0, 0, 0]` to the sheet
   * endpoint's `project(centre)`, so the blended surface must put the
   * ANCHOR POINT within the sphere's own radius of that lerped target at
   * every `t` — otherwise the camera frames empty space mid-flight, which
   * is exactly what an unanchored unwrap does.
   */
  it("places the anchor point where the caller's linearly-lerped camera.target is looking", () => {
    for (const anchor of [[0, 0], [140, 40], [-75, -60]] as const) {
      const sheetTarget = equirect.project(anchor[0], anchor[1], 0);
      for (let i = 1; i < 20; i++) {
        const t = i / 20;
        const blend = glyphMapProjectionTransition(globe, equirect, t, { anchor });
        const got = blend.project(anchor[0], anchor[1], 0);
        const target = [sheetTarget[0] * t, sheetTarget[1] * t, sheetTarget[2] * t];
        const offset = Math.hypot(got[0] - target[0], got[1] - target[1], got[2] - target[2]);
        // The residual is `(1 - t) * globe.project(anchor)`, i.e. at most the
        // globe's radius — the SAME residual the plain lerp path carries.
        expect(offset, `anchor ${anchor} t=${t} offset ${offset}`).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("relief rides the surface: elevation displaces at every t, and matches each endpoint's own displacement at its own end", () => {
    const reliefGlobe = glyphMapGlobe({ radius: 1, exaggeration: 1 });
    const reliefSheet = glyphMapEquirectangular({ exaggeration: 1 });
    const displacementAt = (t: number): number => {
      const blend = glyphMapProjectionTransition(reliefGlobe, reliefSheet, t, { anchor: [0, 0] });
      const flat = blend.project(20, 35, 0);
      const lifted = blend.project(20, 35, 8_848_000);
      return Math.hypot(lifted[0] - flat[0], lifted[1] - flat[1], lifted[2] - flat[2]);
    };
    for (const t of [1e-4, 0.25, 0.5, 0.75, 1 - 1e-4]) {
      expect(displacementAt(t)).toBeGreaterThan(0);
      expect(Number.isFinite(displacementAt(t))).toBe(true);
    }
    const endpointDisplacement = (p: GlyphMapProjection): number => {
      const flat = p.project(20, 35, 0);
      const lifted = p.project(20, 35, 8_848_000);
      return Math.hypot(lifted[0] - flat[0], lifted[1] - flat[1], lifted[2] - flat[2]);
    };
    expect(displacementAt(1e-6)).toBeCloseTo(endpointDisplacement(reliefGlobe), 9);
    expect(displacementAt(1 - 1e-6)).toBeCloseTo(endpointDisplacement(reliefSheet), 9);
  });

  it("MUTATION-CHECKABLE: a sheet endpoint cropping a point (Mercator past its maxLat) blanks the whole unwrapped vertex, never a partial or origin-clamped one", () => {
    const blend = glyphMapProjectionTransition(glyphMapGlobe(), glyphMapMercator(), 0.5, { anchor: [0, 0] });
    const [x, y, z] = blend.project(10, 89, 0);
    expect(Number.isNaN(x)).toBe(true);
    expect(Number.isNaN(y)).toBe(true);
    expect(Number.isNaN(z)).toBe(true);
    // ...while a point inside BOTH windows still renders.
    expect(blend.project(10, 40, 0).every(Number.isFinite)).toBe(true);
    // Measured, so the claim is honest: the cap arithmetic happens to
    // propagate a NaN endpoint on its own, so DELETING the guard leaves this
    // green. What it does catch is the anti-pattern the guard exists to
    // forbid — substituting 0 for a non-finite component, which drags the
    // vertex onto the surface and draws a garbage strip: that turns this red.
  });

  it("MUTATION-CHECKABLE: an orbit-capable endpoint that is NOT the sphere the unwrap develops falls back to the plain lerp rather than mis-wrapping it", () => {
    // Capability present (so the pair reads as orbit<->sheet), and a
    // perfectly reasonable |project(0,0,0)| — but an ELLIPSOID, so no
    // equirectangular development re-wraps to it and the unwrap would be a
    // discontinuity at t->0 rather than an animation. The east/west radius
    // is what the probe catches; a bare radius check at the prime meridian
    // would not.
    const notASphere: GlyphMapProjection = {
      id: "not-a-sphere",
      exaggeration: 1,
      domain: { west: -180, east: 180, south: -90, north: 90 },
      project: (lon, lat) => {
        const latR = (lat * Math.PI) / 180;
        const lonR = (lon * Math.PI) / 180;
        return [Math.cos(latR) * Math.cos(lonR), 2 * Math.cos(latR) * Math.sin(lonR), Math.sin(latR)];
      },
      unproject: () => [0, 0],
      cameraForCenter: () => ({ rotX: 0, rotY: 0 }),
      centerForCamera: () => [0, 0],
    };
    const sheet = glyphMapEquirectangular();
    const blend = glyphMapProjectionTransition(notASphere, sheet, 0.5, { anchor: [0, 0] });
    for (const [lon, lat] of [[30, 45], [-100, -20]] as const) {
      const pa = notASphere.project(lon, lat, 0);
      const pb = sheet.project(lon, lat, 0);
      const got = blend.project(lon, lat, 0);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo((pa[k] + pb[k]) / 2, 12);
    }
  });

  it("an anchor's LONGITUDE moves the tangency the peel opens around; both endpoints stay reference-identical either way", () => {
    const east = glyphMapProjectionTransition(globe, equirect, 0.5, { anchor: [140, 0] });
    const greenwich = glyphMapProjectionTransition(globe, equirect, 0.5, { anchor: [0, 0] });
    const a = east.project(140, 0, 0);
    const c = greenwich.project(140, 0, 0);
    expect(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])).toBeGreaterThan(1e-3);
    expect(glyphMapProjectionTransition(globe, equirect, 0, { anchor: [140, 0] })).toBe(globe);
    expect(glyphMapProjectionTransition(globe, equirect, 1, { anchor: [140, 0] })).toBe(equirect);
  });

  it("still refuses unproject() and still exposes no visible/cameraForCenter/centerForCamera on the unwrap path", () => {
    const blend = glyphMapProjectionTransition(globe, equirect, 0.5, { anchor: [0, 0] });
    expect(() => blend.unproject([0, 0, 0])).toThrow(/no closed-form unproject/);
    expect(blend.visible).toBeUndefined();
    expect(blend.cameraForCenter).toBeUndefined();
    expect(blend.centerForCamera).toBeUndefined();
  });
});

// ── The scale-normalized sheet<->sheet blend ────────────────────────────

/**
 * A sheet <-> sheet pair only needs the plain component-wise lerp while both
 * endpoints agree about how big a degree is. Orthographic does not agree with
 * anything else: it frames a whole visible hemisphere in ~1 world unit, ~57x
 * smaller per degree than equirectangular or Mercator. Lerping those two
 * positions is numerically dominated by the equirectangular term for all but
 * `t < ~1/58`, so the map holds one endpoint's SHAPE for ~99% of the flight
 * and snaps into the other's inside the last percent — a jump right as the
 * animation lands, and the "change between Mercator and the other flat ones
 * and they zoom in and zoom out" report.
 *
 * `widget.transitionContinuity.test.ts` gates the resulting on-screen
 * behaviour end to end; this pins the construction's own contract.
 */
describe("glyphMapProjectionTransition — a sheet<->sheet pair at DIFFERENT world scales normalizes before it lerps", () => {
  const equirect = glyphMapEquirectangular();
  const ortho = glyphMapOrthographic({ lon0: 0, lat0: 20 });
  const ANCHOR: readonly [number, number] = [0, 20];

  it("t=0 and t=1 still return the endpoint objects themselves", () => {
    expect(glyphMapProjectionTransition(equirect, ortho, 0, { anchor: ANCHOR })).toBe(equirect);
    expect(glyphMapProjectionTransition(equirect, ortho, 1, { anchor: ANCHOR })).toBe(ortho);
  });

  it("is NOT the plain lerp for an interior t — that is the whole point", () => {
    const t = 0.5;
    const blend = glyphMapProjectionTransition(equirect, ortho, t, { anchor: ANCHOR });
    const got = blend.project(30, 40, 0);
    const a = equirect.project(30, 40, 0);
    const b = ortho.project(30, 40, 0);
    const plain = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
    expect(Math.hypot(got[0] - plain[0], got[1] - plain[1], got[2] - plain[2])).toBeGreaterThan(1);
  });

  /**
   * Same convergence-RATE shape as the unwrap's own gate above: ten times
   * closer in `t` must be at least five times closer in space. A pop at
   * either endpoint-object swap would not shrink at all.
   */
  it("converges CONTINUOUSLY onto each endpoint — no pop on the first or last frame", () => {
    for (const [a, b] of [[equirect, ortho], [ortho, equirect]] as const) {
      for (const near of [true, false]) {
        const endpoint = near ? a : b;
        const ts = near ? [1e-3, 1e-4, 1e-5] : [1 - 1e-3, 1 - 1e-4, 1 - 1e-5];
        const reference = surfaceDiameter(endpoint);
        // Only where BOTH endpoints have a position. Orthographic crops its
        // far hemisphere to NaN, and `blendVec3`'s all-or-nothing rule
        // (deliberately, "crop, don't clamp") blanks those vertices at every
        // interior `t` — so the cropped set is not a place a POSITION can
        // converge, and including it would measure the NaN contract rather
        // than this construction's continuity. That set appearing/vanishing
        // at the exact endpoint frame is a known consequence of the same
        // contract on the plain lerp path, not something normalization
        // introduces.
        const drifts = ts.map((t) => {
          const blend = glyphMapProjectionTransition(a, b, t, { anchor: ANCHOR });
          let worst = 0;
          for (const [lon, lat] of GRID) {
            if (!a.project(lon, lat, 0).every(Number.isFinite) || !b.project(lon, lat, 0).every(Number.isFinite)) continue;
            const got = blend.project(lon, lat, 0);
            const want = endpoint.project(lon, lat, 0);
            worst = Math.max(worst, Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) / reference);
          }
          return worst;
        });
        const label = `${a.id}->${b.id} near ${endpoint.id} drifts ${drifts.map((d) => d.toExponential(2)).join(", ")}`;
        expect(drifts[0], label).toBeLessThan(0.25);
        expect(drifts[1], label).toBeLessThan(drifts[0] / 5);
        expect(drifts[2], label).toBeLessThan(drifts[1] / 5);
      }
    }
  });

  /**
   * The same placement contract the unwrap has, for the same reason: the
   * caller lerps `camera.target` between the two endpoints' own
   * `project(centre)`, so the blend must put the ANCHOR POINT exactly there
   * or the camera frames somewhere the map is not.
   */
  it("places the anchor point exactly where the caller's linearly-lerped camera.target is looking", () => {
    const a = equirect.project(ANCHOR[0], ANCHOR[1], 0);
    const b = ortho.project(ANCHOR[0], ANCHOR[1], 0);
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      const got = glyphMapProjectionTransition(equirect, ortho, t, { anchor: ANCHOR }).project(ANCHOR[0], ANCHOR[1], 0);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(a[k] + (b[k] - a[k]) * t, 9);
    }
  });

  it("a cropped endpoint still blanks the whole vertex — never a partial or origin-clamped one", () => {
    // Orthographic's far hemisphere (`cosC < 0`) is NaN; the blend must not
    // paint a garbage strip there just because equirectangular is finite.
    const blend = glyphMapProjectionTransition(equirect, ortho, 0.5, { anchor: ANCHOR });
    expect(blend.project(179, 0, 0)).toEqual([NaN, NaN, NaN]);
  });

  it("MUTATION-CHECKABLE: no anchor means no normalization — the plain lerp is still what an unanchored caller gets", () => {
    const t = 0.5;
    const blend = glyphMapProjectionTransition(equirect, ortho, t);
    const got = blend.project(30, 40, 0);
    const a = equirect.project(30, 40, 0);
    const b = ortho.project(30, 40, 0);
    for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(a[k] + (b[k] - a[k]) * t, 12);
  });
});
