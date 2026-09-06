import { describe, expect, it, vi } from "vitest";
import { createGlyphMap, GLYPH_MAP_WHEEL_ZOOM_K, glyphMapNormalizeWheelDelta } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator, glyphMapOrthographic } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import { glyphMapPolygons } from "./mesh";
import { glyphMapCuratedProvider } from "./curated";

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number, elev = 100): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(elev);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

function mountFlat(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 40, rows: 20 },
    projection: glyphMapEquirectangular(),
    ...overrides,
  });
  return { host, map };
}

/** Real (non-zero) host `getBoundingClientRect()` — happy-dom's default is all zeros, and `computeZoomForSpan`'s "host pixel width" invariant only means anything against a real measured width. */
function mockHostRect(host: HTMLElement, width: number, height: number): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

function firePointer(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}

describe("createGlyphMap — view", () => {
  it("getView reflects the constructor view", () => {
    const { host, map } = mountFlat();
    const v = map.getView();
    expect(v.center).toEqual([0, 0]);
    expect(v.span).toBe(40);
    map.destroy();
    host.remove();
  });

  it("setView merges partial updates and emits 'move'/'zoom' correctly", () => {
    const { host, map } = mountFlat();
    const moveEvents: unknown[] = [];
    const zoomEvents: unknown[] = [];
    map.on("move", (e) => moveEvents.push(e));
    map.on("zoom", (e) => zoomEvents.push(e));

    map.setView({ center: [10, 5] });
    expect(moveEvents.length).toBe(1);
    expect(zoomEvents.length).toBe(0);
    expect(map.getView().center).toEqual([10, 5]);
    expect(map.getView().span).toBe(40); // untouched

    map.setView({ span: 20 });
    expect(zoomEvents.length).toBe(1);
    expect(map.getView().span).toBe(20);

    map.destroy();
    host.remove();
  });

  it("fitBounds sets a span covering the full requested box (padding for aspect, never cropping)", () => {
    const { host, map } = mountFlat();
    map.fitBounds({ west: -5, east: 5, south: -20, north: 20 });
    const v = map.getView();
    expect(v.center[0]).toBeCloseTo(0, 10);
    expect(v.center[1]).toBeCloseTo(0, 10);
    // width-derived span is 10; height-derived is 40 * (cols/rows) = 40*2 = 80.
    expect(v.span).toBeCloseTo(80, 10);
    map.destroy();
    host.remove();
  });

  it("resize() does not throw and keeps the view stable", () => {
    const { host, map } = mountFlat();
    const before = map.getView();
    expect(() => map.resize()).not.toThrow();
    expect(map.getView().center).toEqual(before.center);
    host.remove();
    map.destroy();
  });
});

/**
 * Wheel-zoom normalization + exponential step (the "locked in, barely
 * moves" bug report). The old `deltaY * 0.001` linear coefficient ignored
 * `WheelEvent.deltaMode` entirely and read a macOS trackpad's pixel-mode
 * micro-events (`deltaY` ~1-5) as a 0.1-0.5% span change each.
 */
describe("glyphMapNormalizeWheelDelta — deltaMode conversion table", () => {
  it("pixel mode (0) is near-identity: a mouse-wheel-notch-sized deltaY of 100 normalizes to ~25", () => {
    expect(glyphMapNormalizeWheelDelta(100, 0)).toBeCloseTo(25, 1);
  });

  it("line mode (1) scales deltaY up by 20x — a Firefox-style 3-line notch normalizes to 60", () => {
    expect(glyphMapNormalizeWheelDelta(3, 1)).toBeCloseTo(60, 6);
  });

  it("page mode (2) scales deltaY up by 60x", () => {
    expect(glyphMapNormalizeWheelDelta(1, 2)).toBeCloseTo(60, 6);
  });

  it("an unrecognized deltaMode falls back to the pixel-mode ratio instead of throwing", () => {
    expect(glyphMapNormalizeWheelDelta(100, 99)).toBeCloseTo(glyphMapNormalizeWheelDelta(100, 0), 6);
  });

  it("the SAME raw deltaY produces a much larger normalized value in line mode than pixel mode — deltaMode is genuinely read, not ignored", () => {
    const pixel = glyphMapNormalizeWheelDelta(3, 0);
    const line = glyphMapNormalizeWheelDelta(3, 1);
    expect(line).toBeGreaterThan(pixel * 20);
  });

  it("GLYPH_MAP_WHEEL_ZOOM_K is calibrated so a mouse-wheel notch (deltaY 100, pixel mode) is a ~12% span step", () => {
    const normalized = glyphMapNormalizeWheelDelta(100, 0);
    const factor = Math.exp(GLYPH_MAP_WHEEL_ZOOM_K * normalized);
    expect(factor).toBeCloseTo(1.12, 3);
  });
});

describe("createGlyphMap — wheel zoom", () => {
  function dispatchWheel(host: HTMLElement, deltaY: number, deltaMode = 0): void {
    host.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode, cancelable: true, bubbles: true }));
  }

  it("a single mouse-wheel-notch-sized event (deltaY 100, pixel mode) zooms out by ~12%", () => {
    const { host, map } = mountFlat({ view: { center: [0, 0], span: 40, cols: 120, rows: 60 } });
    dispatchWheel(host, 100, 0);
    expect(map.getView().span).toBeCloseTo(40 * 1.12, 1);
    map.destroy();
    host.remove();
  });

  it("an opt-in overview span zooms beyond the projection domain and actually pulls the camera back", () => {
    const { host, map } = mountFlat({
      view: { center: [0, 0], span: 360, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
      maxSpan: 720,
    });
    const fullWorldZoom = map.scene.camera.zoom;

    dispatchWheel(host, 100, 0);
    expect(map.getView().span).toBeGreaterThan(360);
    expect(map.scene.camera.zoom).toBeLessThan(fullWorldZoom);

    map.setView({ span: 720 });
    expect(map.scene.camera.zoom).toBeCloseTo(fullWorldZoom / 2, 6);

    dispatchWheel(host, 100_000, 0);
    expect(map.getView().span).toBe(720);
    map.destroy();
    host.remove();
  });

  it("keeps the projection-domain wheel clamp when maxSpan is omitted", () => {
    const { host, map } = mountFlat({
      view: { center: [0, 0], span: 360, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
    });
    dispatchWheel(host, 100_000, 0);
    expect(map.getView().span).toBe(360);
    map.destroy();
    host.remove();
  });

  it("rejects an invalid maxSpan instead of collapsing or poisoning camera zoom", () => {
    for (const maxSpan of [0, Number.NaN, Number.POSITIVE_INFINITY, 0.0005]) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      expect(() => createGlyphMap(host, {
        view: { center: [0, 0], span: 40, cols: 40, rows: 20 },
        projection: glyphMapEquirectangular(),
        minSpan: 0.001,
        maxSpan,
      })).toThrow(RangeError);
      host.remove();
    }
  });

  // An ORBIT projection, so `domainWidth`'s fallback is the ONLY thing
  // deciding the clamp: a SHEET's ceiling is now the (always tighter) cover
  // limit, which would mask this fallback entirely. The sheet half of this
  // case — a broken domain still resolving finite, positive and covered —
  // lives in `widget.cover.test.ts`.
  it("falls back safely when a custom projection supplies a non-positive domain width", () => {
    const base = glyphMapGlobe();
    const projection = { ...base, domain: { west: 170, east: -170, south: -90, north: 90 } };
    const { host, map } = mountFlat({
      view: { center: [0, 0], span: 360, cols: 120, rows: 60 },
      projection,
    });
    expect(map.scene.camera.zoom).toBeGreaterThan(0);
    dispatchWheel(host, 100_000, 0);
    expect(map.getView().span).toBe(360);
    map.destroy();
    host.remove();
  });

  it("zooming in then out by the SAME raw delta returns to the original span (exponential step is self-inverse)", () => {
    const { host, map } = mountFlat({ view: { center: [0, 0], span: 40, cols: 120, rows: 60 } });
    const original = map.getView().span;
    dispatchWheel(host, -100, 0); // zoom in
    const zoomedIn = map.getView().span;
    expect(zoomedIn).not.toBeCloseTo(original, 6); // sanity: it actually moved
    dispatchWheel(host, 100, 0); // zoom back out by the identical raw delta
    expect(map.getView().span).toBeCloseTo(original, 9);
    map.destroy();
    host.remove();
  });

  it("is symmetric over a longer alternating sequence of zoom-in/zoom-out events, not just a single pair", () => {
    const { host, map } = mountFlat({ view: { center: [0, 0], span: 40, cols: 120, rows: 60 } });
    const original = map.getView().span;
    for (let i = 0; i < 5; i++) dispatchWheel(host, -37, 0);
    for (let i = 0; i < 5; i++) dispatchWheel(host, 37, 0);
    expect(map.getView().span).toBeCloseTo(original, 6);
    map.destroy();
    host.remove();
  });

  it("emits a 'zoom' view event and reschedules the tile update on wheel", () => {
    const { host, map } = mountFlat({ view: { center: [0, 0], span: 40, cols: 120, rows: 60 } });
    const events: string[] = [];
    map.on("zoom", () => events.push("zoom"));
    dispatchWheel(host, 50, 0);
    expect(events).toEqual(["zoom"]);
    map.destroy();
    host.remove();
  });

  it("a trackpad-sized micro-event (deltaY 3, pixel mode) moves the span, unlike the old fixed 0.001 coefficient reading it as noise", () => {
    const { host, map } = mountFlat({ view: { center: [0, 0], span: 40, cols: 120, rows: 60 } });
    const before = map.getView().span;
    dispatchWheel(host, 3, 0);
    const after = map.getView().span;
    expect(after).not.toBe(before);
    // Documented magnitude: normalized ~0.75 -> exp(k*0.75) ~1.0034 (~0.34%).
    expect(after / before).toBeCloseTo(Math.exp(GLYPH_MAP_WHEEL_ZOOM_K * glyphMapNormalizeWheelDelta(3, 0)), 6);
  });
});

/**
 * `computeZoomForSpan`'s "b1"/"b2" fixes (AGENTS.md's zoom-for-span doc).
 */
describe("createGlyphMap — computeZoomForSpan latitude/horizon fixes (b1/b2)", () => {
  function globeZoomAt(lat: number, span = 10): number {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, lat], span, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
    });
    const zoom = map.scene.camera.zoom;
    map.destroy();
    host.remove();
    return zoom;
  }

  it("globe zoom-out reach is latitude-invariant: the SAME span buys the SAME camera.zoom at any latitude (b1 pinning test)", () => {
    const equator = globeZoomAt(0);
    const lat45 = globeZoomAt(45);
    const lat60 = globeZoomAt(60);
    const lat80 = globeZoomAt(80);
    // Pre-fix this ratio was 1/cos(lat): ~1.41 at 45°, 2.0 at 60°, 5.76 at 80°.
    expect(lat45 / equator).toBeCloseTo(1, 4);
    expect(lat60 / equator).toBeCloseTo(1, 4);
    expect(lat80 / equator).toBeCloseTo(1, 4);
  });

  it("orthographic zoom has no ~2x snap when panned off lon0 and wheeled across the far-hemisphere horizon (b2 pinning test)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [30, 0], span: 100, cols: 120, rows: 60 },
      projection: glyphMapOrthographic({ lon0: 0 }),
    });
    // Sweeps straight through the span-120 horizon crossing for a view
    // centred at lon 30 against lon0 0 (measured live: zoom 4000 -> 1998,
    // a ~x0.50 jump, at exactly this crossing before the fix).
    const zooms: number[] = [];
    for (let span = 110; span <= 130.001; span += 0.5) {
      map.setView({ span });
      zooms.push(map.scene.camera.zoom);
    }
    for (let i = 1; i < zooms.length; i++) {
      const ratio = zooms[i] / zooms[i - 1];
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.3);
    }
    map.destroy();
    host.remove();
  });

  it("stays byte-identical (to finite-difference precision) for a sheet projection that never hits a horizon (equirectangular) — proof the b1/b2 fix left it alone", () => {
    // `glyphMapEquirectangular().project(lon, lat, 0) === [-lat, lon, 0]` —
    // linear in `lon`, so a sheet projection's local-derivative estimate
    // (J3's "always use the derivative, never plus/minus averaging" fix —
    // see `computeZoomForSpan`) is mathematically EXACT here: the finite
    // difference `(project(lon+eps) - project(lon-eps)) / (2*eps)` recovers
    // the true constant slope for any eps. That lets the whole result be
    // checked in CLOSED FORM instead of merely diffed against the widget's
    // own internals: `zoom = cols * cellWidth / span`, independent of
    // centre latitude — with happy-dom's zeroed `getBoundingClientRect()`,
    // `cellWidth` is the documented `50 / cellAspect(2)` fallback, 25.
    // Tolerance loosened from 9 to 6 decimals (both far tighter than
    // anything visually meaningful): unlike the OLD exact plus/minus
    // average, the derivative is computed via floating-point subtraction of
    // two samples ~2e-4 apart (`rateEps = 1e-4`), which carries its own tiny
    // catastrophic-cancellation noise (measured ~1.4e-9 absolute at zoom
    // ~600) — an accepted, negligible cost of J3's fix, not a regression in
    // exactness.
    for (const [lat, span, cols] of [[0, 40, 90], [45, 40, 90], [-60, 20, 90], [80, 5, 120]] as const) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const map = createGlyphMap(host, {
        view: { center: [10, lat], span, cols, rows: 45 },
        projection: glyphMapEquirectangular(),
      });
      expect(map.scene.camera.zoom).toBeCloseTo((cols * 25) / span, 6);
      map.destroy();
      host.remove();
    }
  });
});

/**
 * The two root-cause invariants (jumps.md's diagnosis): `view` and `camera`
 * are two encodings of the same state, but only `syncCameraToView` mapped
 * `view -> camera` — `computeZoomForSpan` secretly also read `grid.cellWidth`
 * (host font size), `view.cols` (frozen under autoSize — never updated when
 * live `cols` changes), `view.center.lat` (clamped globe sample), and
 * `projection` (may be a non-invertible mid-transition blend). Both
 * invariants below FAILED before the fix (x1.28 and exactly x2 respectively)
 * and are the acceptance criteria for the whole fix set — J2a, J2b, and J5
 * are all instances of one or the other.
 */
describe("createGlyphMap — root-cause invariants (view <-> camera round-trip)", () => {
  it("invariant 1: syncCameraToView is idempotent AND a no-op immediately after a drag — re-syncing (map.setView({})) after a globe drag must not move camera.zoom/rotX/rotY/target beyond float noise", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 140, cols: 135, rows: 63 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });

    // A real drag north, crossing the J2a repro's own latitude band (past
    // the old +/-90 sample clamp at center.lat + halfSpanDeg).
    // "drag down increases centre latitude" (grab-and-drag convention,
    // verified elsewhere) — dragging DOWN moves the view NORTH.
    firePointer(host, "pointerdown", 100, 100, 1);
    for (let i = 0; i < 30; i++) firePointer(host, "pointermove", 100, 100 + (i + 1) * 10, 1);
    firePointer(host, "pointerup", 100, 400, 1);

    const before = {
      zoom: map.scene.camera.zoom,
      rotX: map.scene.camera.rotX,
      rotY: map.scene.camera.rotY,
      target: [...map.scene.camera.target],
    };

    // `setView({})` re-invokes `syncCameraToView(view)` against the EXACT
    // view the drag just produced — precisely "running it once right after
    // a drag" (invariant 1's own wording).
    map.setView({});

    const afterOnce = {
      zoom: map.scene.camera.zoom,
      rotX: map.scene.camera.rotX,
      rotY: map.scene.camera.rotY,
      target: [...map.scene.camera.target],
    };
    expect(afterOnce.zoom).toBeCloseTo(before.zoom, 6);
    expect(afterOnce.rotX).toBeCloseTo(before.rotX, 6);
    expect(afterOnce.rotY).toBeCloseTo(before.rotY, 6);
    for (let i = 0; i < 3; i++) expect(afterOnce.target[i]).toBeCloseTo(before.target[i], 6);

    // Idempotent: running it AGAIN changes nothing further.
    map.setView({});
    expect(map.scene.camera.zoom).toBeCloseTo(afterOnce.zoom, 9);
    expect(map.scene.camera.rotX).toBeCloseTo(afterOnce.rotX, 9);
    expect(map.scene.camera.rotY).toBeCloseTo(afterOnce.rotY, 9);

    map.destroy();
    host.remove();
  });

  it("invariant 2: camera.zoom is invariant to cols/rows/cell size for a fixed (view.span, projection, host px width)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [10, 20], span: 60, cols: 80, rows: 40 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });
    const zoomBefore = map.scene.camera.zoom;

    // Simulate a live `cols`/`rows` change independent of `view.cols`/
    // `.rows` — exactly what an autoSize font-size change (a "density"
    // slider) produces underneath the widget's own frozen `view.cols`.
    // Host pixel width is UNCHANGED (still the 1200 mocked above).
    map.scene.setOptions({ cols: 160, rows: 80 });
    map.setView({}); // the next view->camera sync — where the drift used to discharge

    const zoomAfter = map.scene.camera.zoom;
    expect(zoomAfter).toBeCloseTo(zoomBefore, 6);

    map.destroy();
    host.remove();
  });
});

/**
 * J1 (P0): `pixelsPerWorldUnit` used to measure the on-screen length of the
 * hard-coded world Z axis, which is `zoom * |sin(camera.rotX)|` and goes to
 * ZERO exactly as `camera.rotX` approaches 0/180 (`lat = tilt - 90`),
 * diverging `applyDrag`'s orbit drag sensitivity there. Fixed by reading
 * `camera.zoom` directly (constant, orientation-independent for an
 * orthographic camera) instead.
 */
describe("createGlyphMap — globe drag rate has no pole singularity (J1)", () => {
  function dragDeltaLatAt(lat: number, tilt = 40): number {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, lat], span: 140, cols: 135, rows: 63 },
      projection: glyphMapGlobe(),
      tilt,
    });
    firePointer(host, "pointerdown", 100, 100, 1);
    firePointer(host, "pointermove", 100, 105, 1); // a single 5px vertical drag
    const after = map.getView().center[1];
    firePointer(host, "pointerup", 100, 105, 1);
    map.destroy();
    host.remove();
    return Math.abs(after - lat);
  }

  it("drag sensitivity stays bounded and roughly UNIFORM across the whole latitude range, including through lat = tilt - 90 (-50 at the default tilt 40) — pre-fix this reached 140deg at lat -50 from a single 5px drag", () => {
    // The exact repro latitude ladder from the measured diagnosis.
    const lats = [-30, -44, -47, -49.5, -49.9];
    const deltas = lats.map((lat) => dragDeltaLatAt(lat));

    // Pre-fix this ladder was 0.19 / 0.55 / 1.07 / 6.29 / 31.3 (approaching
    // the pole clamp) — a >150x spread. Post-fix, `degPerPx` no longer
    // depends on `camera.rotX` at all, so every entry should be close to
    // the FIRST (least-singular) one.
    const baseline = deltas[0];
    for (const d of deltas) {
      expect(d).toBeGreaterThan(0); // sanity: the drag still does something
      expect(d).toBeLessThan(5); // pre-fix this reached 140 at lat -50.0
      expect(d / baseline).toBeGreaterThan(0.5);
      expect(d / baseline).toBeLessThan(2);
    }
  });

  it("does not blow up AT the exact singular latitude (tilt - 90) either", () => {
    const d = dragDeltaLatAt(-50, 40);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeLessThan(5);
  });
});

/**
 * Follow-on report on this same subsystem, repro `m=p1x2-cy2p0s2e4`
 * (globe, center [-1.2, 89.999 — the clamp's OWN boundary], span 50.8, tilt
 * 40 default): "the globe rotations etc do not work correctly because they
 * are capped on limits ... you cannot keep scrolling in order to see
 * further north." `applyDrag`'s orbit branch used to clamp the TRUE
 * (tilt-subtracted) `rotX` to `[90 - 89.999, 90 + 89.999]` — i.e.
 * `view.center.lat` to `[-89.999, 89.999]` — solely to keep
 * `computeZoomForSpan` away from a near-pole chord that used to collapse to
 * ~0 (measured `camera.zoom` in the millions). The J2a/J7 fix above (an
 * unclamped meridian SAMPLE, letting `glyphMapGlobe.project()`'s own
 * periodicity give a genuine, always-finite chord through and past a pole)
 * already removes that hazard — verified below: `camera.zoom` is
 * bit-identical across latitudes 89 through 130 at a fixed span/tilt, so the
 * clamp had nothing left to protect. Removing it lets `centerForCamera`'s
 * own periodic parametrization do what it already does correctly for ANY
 * real `rotX` (the SAME way `rotY`/longitude was already unclamped): rotate
 * continuously THROUGH the pole and down the far meridian — Google Earth's
 * own behavior, not a sheet-map latitude clamp.
 */
describe("createGlyphMap — globe drag rotates continuously through the pole, not capped at it", () => {
  it("camera.zoom is bit-stable at, and well past, the pole for a fixed span/tilt — the near-pole zoom hazard the clamp existed for is gone", () => {
    const zooms: number[] = [];
    for (const lat of [89, 89.9, 89.99, 89.999, 90, 91, 95, 130]) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      mockHostRect(host, 1200, 600);
      const map = createGlyphMap(host, {
        // `view.center.lat` itself is public API and stays within [-90, 90]
        // (`Math.asin`'s own range) — this probes `computeZoomForSpan`
        // directly at/near/through the pole via the projection, which
        // `applyDrag`'s now-unclamped `trueRotX` can genuinely reach.
        view: { center: [0, Math.min(89.999, lat)], span: 50, cols: 120, rows: 60 },
        projection: glyphMapGlobe(),
        tilt: 40,
      });
      zooms.push(map.scene.camera.zoom);
      map.destroy();
      host.remove();
    }
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]).toBeCloseTo(zooms[0], 6);
  });

  it("dragging continuously north is never capped: it carries the view THROUGH the pole, flipping longitude ~180deg and turning latitude back down the far side — the exact repro's own complaint", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 50, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });

    firePointer(host, "pointerdown", 100, 100, 1);
    let y = 100;
    const centers: (readonly [number, number])[] = [];
    for (let i = 0; i < 400; i++) {
      y += 5;
      firePointer(host, "pointermove", 100, y, 1);
      centers.push(map.getView().center);
    }
    firePointer(host, "pointerup", 100, y, 1);

    // Pre-fix: EVERY center from the moment lat first reaches 89.999 is
    // IDENTICAL — [0, 89.999] repeated for the rest of the drag (the "capped,
    // cannot scroll further" bug, reproduced exactly). Threshold 85, not
    // 89.99: `degPerPx` is a CONSTANT per-step increment (J1's own fix), so
    // the discrete per-step sampling can hop straight over the extremely
    // narrow (< 0.01deg) exact-pole peak without ever landing a sample
    // inside it — pre-fix, the clamp still reaches and freezes at 89.999
    // well before that, so this threshold is just as effective at catching
    // the regression.
    const nearPoleIndex = centers.findIndex((c) => c[1] > 85);
    expect(nearPoleIndex).toBeGreaterThan(0);
    const tail = centers.slice(nearPoleIndex + 20); // well past the old clamp point
    const allIdentical = tail.every((c) => c[0] === tail[0][0] && c[1] === tail[0][1]);
    expect(allIdentical).toBe(false);

    // Post-fix: the drag actually carries THROUGH the pole — longitude
    // flips to the antimeridian and latitude comes back down from 90 on the
    // far side, instead of freezing.
    const last = centers[centers.length - 1];
    expect(Math.abs(last[0])).toBeCloseTo(180, 0);
    expect(last[1]).toBeLessThan(85);
    expect(last[1]).toBeGreaterThan(-90);
    expect(Number.isFinite(map.scene.camera.zoom)).toBe(true);

    map.destroy();
    host.remove();
  });
});

/**
 * J2a/J7 (P1/P2): the ±90 clamp on `computeZoomForSpan`'s meridian SAMPLE
 * (not the geometry — `glyphMapGlobe.project()` is periodic and never NaN)
 * made `halfWorldSpan` silently latitude-dependent the instant
 * `center.lat + halfSpanDeg` crossed 90 (J2a: a snap on the NEXT sync after
 * a drag crosses it) and froze it flat across an entire wheel range beyond
 * that (J7: dead wheel notches). Both are the SAME clamp; removing it fixes
 * both.
 */
describe("createGlyphMap — globe zoom past the meridian +/-90 sample boundary (J2a/J7)", () => {
  it("J2a: a drag that crosses the old +/-90 sample clamp does not snap camera.zoom on the next sync", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 140, cols: 135, rows: 63 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });
    const zoomBeforeDrag = map.scene.camera.zoom;

    // Drag north far enough to cross the repro's own lat 20 -> ~52 band
    // (`center.lat + halfSpanDeg` = 20+70=90 is exactly the old clamp
    // boundary; ending north of 20 crosses it).
    // "drag down increases centre latitude" (grab-and-drag convention,
    // verified elsewhere) — dragging DOWN moves the view NORTH.
    firePointer(host, "pointerdown", 100, 100, 1);
    for (let i = 0; i < 30; i++) firePointer(host, "pointermove", 100, 100 + (i + 1) * 10, 1);
    firePointer(host, "pointerup", 100, 400, 1);
    expect(map.getView().center[1]).toBeGreaterThan(40); // sanity: the drag actually moved north

    const zoomJustAfterDrag = map.scene.camera.zoom; // applyDrag never touches zoom
    expect(zoomJustAfterDrag).toBeCloseTo(zoomBeforeDrag, 9);

    // The next view->camera sync (a wheel notch, matching the repro exactly).
    map.getView(); // no-op read, just documents intent
    map.scene.output.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, deltaMode: 0, cancelable: true, bubbles: true }));
    host.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, deltaMode: 0, cancelable: true, bubbles: true }));
    const zoomAfterSync = map.scene.camera.zoom;

    // Pre-fix this was a x1.277 snap from crossing the clamp alone, on top
    // of whatever the tiny wheel notch itself contributes.
    expect(zoomAfterSync / zoomJustAfterDrag).toBeGreaterThan(0.98);
    expect(zoomAfterSync / zoomJustAfterDrag).toBeLessThan(1.02);

    map.destroy();
    host.remove();
  });

  it("J7: every wheel notch past span ~220 keeps changing span/zoom — no dead zone up to the maxSpan clamp", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 200, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
      tilt: 40,
      maxSpan: 720,
    });

    const zooms: number[] = [map.scene.camera.zoom];
    for (let i = 0; i < 8; i++) {
      host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, deltaMode: 0, cancelable: true, bubbles: true }));
      zooms.push(map.scene.camera.zoom);
    }

    // Pre-fix: 4+ consecutive notches gave EXACTLY the same zoom (both
    // meridian edges saturated at the +/-90 clamp). Post-fix every notch
    // must move zoom by a real, non-trivial amount.
    for (let i = 1; i < zooms.length; i++) {
      expect(zooms[i]).not.toBeCloseTo(zooms[i - 1], 4);
      expect(zooms[i]).toBeLessThan(zooms[i - 1]); // zooming out, monotonically
    }

    map.destroy();
    host.remove();
  });
});

/**
 * J2b (P1): `computeZoomForSpan` used `v.cols * grid.cellWidth`, where
 * `v.cols` is `view`'s OWN `cols` field — frozen wherever `setView` last
 * left it, never updated when the scene's LIVE `cols` changes underneath it
 * (autoSize, or a caller poking `scene.setOptions({ cols, rows })` directly
 * — e.g. a density slider). `grid.cellWidth` DOES track the live value, so
 * the two silently diverged. Fixed by using `grid.cols` (defined as
 * `outputRect.width / grid.cols`, so `grid.cols * grid.cellWidth` always
 * recovers the real host pixel width regardless of `cols`) instead.
 *
 * The SAME staleness also fed `glyphMapDegreesPerCell` (every LOD decision),
 * `fitBounds`' aspect ratio, and the tile-sweep lat window — meaning
 * RAISING DENSITY NEVER MADE THE WIDGET FETCH A FINER ZOOM LEVEL, a real
 * functional bug independent of the zoom-jump. Both are pinned below.
 */
describe("createGlyphMap — a live cols/rows change is reflected everywhere (J2b)", () => {
  it("a density-style cols/rows change (independent of view.cols) advances the fetched LOD, not stuck on the stale view.cols", async () => {
    const zooms: readonly GlyphMapProviderZoomLevel[] = [
      { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 8, tileRows: 8 },
      { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 8, tileRows: 8 },
      { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 8, tileRows: 8 },
    ];
    const loadedZ: number[] = [];
    const tileBounds = (level: GlyphMapProviderZoomLevel, x: number, y: number) => {
      const lonMin = -180 + x * level.tileLonSpan;
      const latMax = 90 - y * level.tileLatSpan;
      return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
    };
    const provider: GlyphMapProvider = {
      id: "density-lod",
      zooms,
      bounds: (z, x, y) => tileBounds(zooms.find((l) => l.z === z)!, x, y),
      loadTile: async (z, x, y) => {
        loadedZ.push(z);
        const level = zooms.find((l) => l.z === z)!;
        return makeTile(tileBounds(level, x, y), level.tileCols, level.tileRows);
      },
    };

    // span=90, cols=45 -> degPerCell=2 -> z0 (native degPerCell at z0 is
    // 360/8=45, z1 180/8=22.5, z2 90/8=11.25 — all coarser than 2, so z0 is
    // picked as the finest AVAILABLE... use a cols large enough that z2 is
    // reachable once cols grows).
    const { host, map } = mountFlat({
      view: { center: [0, 20], span: 90, cols: 45, rows: 22 },
      projection: glyphMapGlobe(),
      layers: [{ type: "raster", source: provider }],
    });
    await vi.waitFor(() => expect(loadedZ.length).toBeGreaterThan(0));
    const initialMaxZ = Math.max(...loadedZ);

    // Simulate a density raise: live cols/rows quadruple, `view.cols`/
    // `.rows` (the widget's own closure field) do NOT change on their own.
    map.scene.setOptions({ cols: 180, rows: 88 });
    map.setView({}); // the "next view->camera sync" a real gesture eventually triggers
    await new Promise((r) => setTimeout(r, 250)); // past scheduleTileUpdate's 180ms debounce

    expect(Math.max(...loadedZ)).toBeGreaterThan(initialMaxZ);

    map.destroy();
    host.remove();
  });

  it("fitBounds' aspect ratio uses the LIVE cols/rows, not the frozen view.cols/.rows", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 40, rows: 20 },
      projection: glyphMapEquirectangular(),
    });
    map.scene.setOptions({ cols: 80, rows: 20 }); // aspect 4:1 instead of the constructed 2:1
    map.fitBounds({ west: -5, east: 5, south: -20, north: 20 });
    // width-derived span is 10; height-derived is 40 * (liveCols/liveRows) = 40*4 = 160.
    expect(map.getView().span).toBeCloseTo(160, 6);
    map.destroy();
    host.remove();
  });
});

/**
 * J3 (P1): the plus/minus-average-when-both-valid, rate-fallback-otherwise
 * ladder is discontinuous exactly AT the boundary where one edge flips from
 * finite to NaN (orthographic's far-hemisphere crop). Fixed by making a
 * SHEET projection always use the local-derivative estimate — it never
 * touches the far edge, so there is no boundary to be discontinuous across.
 */
describe("createGlyphMap — orthographic wheel notches stay smooth through the horizon (J3)", () => {
  it("a real wheel-notch ladder crossing the +/-90 limb never steps by more than the requested ~12% per notch", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [30, 0], span: 100, cols: 120, rows: 60 },
      projection: glyphMapOrthographic({ lon0: 0 }),
      // `maxSpan` explicitly wide (matching the "opt-in overview span"
      // precedent) so the ladder's later notches aren't confounded by the
      // UNRELATED, pre-existing projection-domain wheel clamp (orthographic's
      // own `domain` is a single hemisphere, 180deg) — this test is about
      // the horizon-crossing DISCONTINUITY, not that clamp.
      maxSpan: 720,
    });

    const zooms: number[] = [map.scene.camera.zoom];
    for (let i = 0; i < 10; i++) {
      host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, deltaMode: 0, cancelable: true, bubbles: true }));
      zooms.push(map.scene.camera.zoom);
    }

    for (let i = 1; i < zooms.length; i++) {
      const ratio = zooms[i] / zooms[i - 1];
      // The requested step is exp(K*normalized(100,0)) ~= 1.12 on SPAN;
      // zoom moves roughly inversely. Pre-fix this measured an EXTRA
      // x1.182 zoom-out in one notch at the exact horizon crossing (on top
      // of the requested step) — tightened well below that here.
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.0);
    }
    map.destroy();
    host.remove();
  });
});

/**
 * J4 (P1, "worst single jump") / J5 (P1, "same root as J2a"): both fixed by
 * `setProjection` capturing the camera's CURRENT live framing as a plain
 * tuple once, rather than `applyProjectionFrame` re-deriving a `from`
 * framing via `framingFor(from, view)` on every frame — which, mid-blend,
 * silently took the wrong (sheet) branch (J4), and, even settled, could
 * disagree with the camera's actual live zoom after a drag (J5).
 */
describe("createGlyphMap — setProjection framing tracks the live camera, not a re-derived one (J4/J5)", () => {
  it("J4: interrupting an in-flight transition does not snap the camera", async () => {
    const { host, map } = mountFlat({
      view: { center: [100, 20], span: 140, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });
    const equirect = glyphMapEquirectangular();
    const mercator = glyphMapMercator();

    const done1 = map.setProjection(equirect, { durationMs: 600 });
    await new Promise((r) => setTimeout(r, 300)); // mid-transition, t ~ 0.5
    const before = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom };

    const done2 = map.setProjection(mercator, { durationMs: 600 }); // interrupt
    await new Promise((r) => setTimeout(r, 20)); // the new transition's first frame(s)
    const after = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom };

    // Pre-fix this measured a -35.4deg rotX, -50.5deg rotY, x0.0637 zoom
    // (15.7x) snap in the very next frame after the interrupt.
    expect(Math.abs(after.rotX - before.rotX)).toBeLessThan(5);
    expect(Math.abs(after.rotY - before.rotY)).toBeLessThan(5);
    expect(after.zoom / before.zoom).toBeGreaterThan(0.7);
    expect(after.zoom / before.zoom).toBeLessThan(1.3);

    // `done1` is the INTERRUPTED transition and is deliberately abandoned
    // (`setProjection`'s own doc: "last call wins, no queueing"), so it never
    // settles and must not be awaited. `done2` would settle on `destroy()`
    // (which now resolves whatever is in flight rather than hanging a caller),
    // but this test has already made its assertion and does not need it.
    void done1;
    void done2;
    map.destroy();
    host.remove();
  });

  it("J5: picking a projection after a drag does not replay a zoom snap on the transition's first frame", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 140, cols: 135, rows: 63 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });

    // Drag north — applyDrag never re-syncs camera.zoom, so it stays at
    // whatever it was before the drag while `view.center` moves on.
    // "drag down increases centre latitude" (grab-and-drag convention,
    // verified elsewhere) — dragging DOWN moves the view NORTH.
    firePointer(host, "pointerdown", 100, 100, 1);
    for (let i = 0; i < 30; i++) firePointer(host, "pointermove", 100, 100 + (i + 1) * 10, 1);
    firePointer(host, "pointerup", 100, 400, 1);
    const zoomBeforeSetProjection = map.scene.camera.zoom;

    const equirect = glyphMapEquirectangular();
    const donePromise = map.setProjection(equirect, { durationMs: 600 });
    // The FIRST frame, before any real interpolation has had time to move
    // things far — pre-fix, THIS was already a x1.277 snap on its own.
    await new Promise((r) => setTimeout(r, 16));
    const zoomFirstFrame = map.scene.camera.zoom;

    expect(zoomFirstFrame / zoomBeforeSetProjection).toBeGreaterThan(0.9);
    expect(zoomFirstFrame / zoomBeforeSetProjection).toBeLessThan(1.4); // generous: real interpolation toward equirect's own zoom has legitimately started moving it

    // NOT awaited — `map.destroy()` below cancels the transition's rAF loop
    // before it reaches t=1, so `donePromise` never settles.
    void donePromise;
    map.destroy();
    host.remove();
  });
});

/**
 * J6 (P2): wired but inert at the page's own defaults (`dragDensity: 1` ->
 * `interactiveDownscale` 1 -> `setInteracting` returns immediately) — and
 * J2b's fix removes the residual jump for anyone who LOWERS drag density
 * too, since `computeZoomForSpan` no longer reads the stale `view.cols`.
 * Pinned here as: a wheel-driven `interactiveDownscale` round-trip (cols
 * drop then restore) settles back to the ORIGINAL zoom, not a x2/x0.5
 * drifted one.
 */
describe("createGlyphMap — interactiveDownscale round-trip settles back exactly (J6)", () => {
  it("a live cols/rows drop-then-restore around a view sync returns to the original zoom", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [10, 20], span: 60, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
      tilt: 40,
    });
    const original = map.scene.camera.zoom;

    // Downscale (interactiveDownscale-style): halve cols/rows mid-gesture.
    map.scene.setOptions({ cols: 60, rows: 30 });
    map.setView({});
    expect(map.scene.camera.zoom).toBeCloseTo(original, 6); // J2b: no x0.5 drift from the downscale itself

    // Settle: restore full resolution.
    map.scene.setOptions({ cols: 120, rows: 60 });
    map.setView({});
    expect(map.scene.camera.zoom).toBeCloseTo(original, 6);

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — layers", () => {
  const polygonSource = {
    features: [{ geometryType: "polygon" as const, properties: { zone: "a", height: 20 }, rings: [[[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]] as const] }],
  };
  const pointSource = {
    features: [
      { geometryType: "point" as const, properties: { name: "Alpha", population: 8, population_rank: 9 }, rings: [[[0, 0] as const]] },
      { geometryType: "point" as const, properties: { name: "Beta", population: 2, population_rank: 1 }, rings: [[[0.1, 0] as const]] },
    ],
  };

  it("renders fill choropleth geometry", async () => {
    const { host, map } = mountFlat({ tilt: 0, layers: [
      { type: "fill", source: polygonSource, colorProperty: "zone", colors: { a: "#ff0000" } },
    ] });
    await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
    map.destroy(); host.remove();
  });

  it("renders fill-extrusion geometry", async () => {
    const { host, map } = mountFlat({ tilt: 0, layers: [
      { type: "fill-extrusion", source: polygonSource, heightProperty: "height", color: "#00ff00" },
    ] });
    await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
    map.destroy(); host.remove();
  });

  it("renders a model Polygon[] passthrough without a vector source", async () => {
    const projection = glyphMapEquirectangular();
    const polygons = glyphMapPolygons(makeTile({ west: -5, east: 5, south: -5, north: 5 }, 1, 1), projection);
    const { host, map } = mountFlat({ projection, layers: [{ type: "model", polygons }] });
    await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
    map.destroy(); host.remove();
  });

  it("mounts symbol labels with greedy declutter and attribute-sized circles", () => {
    const { host, map } = mountFlat({ layers: [
      { type: "symbol", source: pointSource, textProperty: "name", priorityProperty: "population_rank" },
      { type: "circle", source: pointSource, radiusProperty: "population", color: "#ff00ff" },
    ] });
    expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(2);
    expect([...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")].filter((el) => el.style.opacity === "1")).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".glyph-map-circle")?.style.width).toBe("16px");
    map.destroy(); host.remove();
  });

  it("excludes far-side globe symbols before decluttering", () => {
    const source = { features: [
      { geometryType: "point" as const, properties: { name: "front", population_rank: 1 }, rings: [[[0, 0] as const]] },
      { geometryType: "point" as const, properties: { name: "back", population_rank: 99 }, rings: [[[180, 0] as const]] },
    ] };
    const { host, map } = mountFlat({ projection: glyphMapGlobe(), layers: [{ type: "symbol", source }] });
    const symbols = [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
    expect(symbols.find((el) => el.textContent === "front")?.style.opacity).toBe("1");
    expect(symbols.find((el) => el.textContent === "back")?.style.opacity).toBe("0");
    map.destroy(); host.remove();
  });

  it("hides far-side globe circles on every marker sync", () => {
    const source = { features: [
      { geometryType: "point" as const, properties: { name: "front" }, rings: [[[0, 0] as const]] },
      { geometryType: "point" as const, properties: { name: "back" }, rings: [[[180, 0] as const]] },
    ] };
    const { host, map } = mountFlat({ projection: glyphMapGlobe(), layers: [{ type: "circle", source }] });
    const circles = [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")];
    // `visibility`, not `display` — `display` belongs to glyphcss's own
    // hotspot staging and is rewritten on every committed render (see
    // `widget.ts`'s `setHotspotNearSide`).
    expect(circles[0].style.visibility).toBe("");
    expect(circles[1].style.visibility).toBe("hidden");
    map.setView({ center: [180, 0] });
    expect(circles[0].style.visibility).toBe("hidden");
    expect(circles[1].style.visibility).toBe("");
    map.destroy(); host.remove();
  });

  it("renders heatmap glyphs with weight-independent, bounded physical relief", async () => {
    const base = glyphMapEquirectangular();
    const elevations: number[] = [];
    const projection = { ...base, project(lon: number, lat: number, elev: number) { elevations.push(elev); return base.project(lon, lat, elev); } };
    const source = { features: [{ geometryType: "point" as const, properties: { population: 1_000_000_000 }, rings: [[[0, 0] as const]] }] };
    const { host, map } = mountFlat({ projection, layers: [{ type: "heatmap", source, radius: 2, weightProperty: "population" }] });
    await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
    // glyphMapPolygons probes elevation + 1m to determine outward winding.
    expect(Math.max(...elevations)).toBeLessThanOrEqual(1_001);
    expect(Math.max(...elevations)).toBeGreaterThan(900);
    map.destroy(); host.remove();
  });
  it("addLayer mounts a static raster tile and returns a usable id; removeLayer disposes it", () => {
    const { host, map } = mountFlat();
    const id = map.addLayer({ type: "raster", source: makeTile({ west: -20, east: 20, south: -20, north: 20 }, 2, 2) });
    expect(typeof id).toBe("string");
    expect(() => map.removeLayer(id)).not.toThrow();
    map.destroy();
    host.remove();
  });

  it("addLayer rejects a duplicate explicit id", () => {
    const { host, map } = mountFlat();
    map.addLayer({ type: "background", id: "bg", color: "#111" });
    expect(() => map.addLayer({ type: "background", id: "bg", color: "#222" })).toThrow(RangeError);
    map.destroy();
    host.remove();
  });

  it("background layer sets the scene output's CSS background color; the topmost background wins; removal falls back to the next", () => {
    const { host, map } = mountFlat();
    const first = map.addLayer({ type: "background", color: "rgb(1, 2, 3)" });
    expect(map.scene.output.style.backgroundColor).toBe("rgb(1, 2, 3)");
    const second = map.addLayer({ type: "background", color: "rgb(4, 5, 6)" });
    expect(map.scene.output.style.backgroundColor).toBe("rgb(4, 5, 6)");
    map.removeLayer(second);
    expect(map.scene.output.style.backgroundColor).toBe("rgb(1, 2, 3)");
    map.removeLayer(first);
    expect(map.scene.output.style.backgroundColor).toBe("");
    map.destroy();
    host.remove();
  });

  it("moveLayer rejects an unknown id, and a valid move does not throw", () => {
    const { host, map } = mountFlat();
    const a = map.addLayer({ type: "background", color: "#111" });
    const b = map.addLayer({ type: "background", color: "#222" });
    expect(() => map.moveLayer("nope")).toThrow(RangeError);
    expect(() => map.moveLayer(a, b)).not.toThrow();
    map.destroy();
    host.remove();
  });

  it("a raster layer with a classifier + colors colors its mesh by elevation band (no throw, colors resolve)", () => {
    const { host, map } = mountFlat({
      layers: [
        {
          type: "raster",
          source: makeTile({ west: -20, east: 20, south: -20, north: 20 }, 2, 2, 900),
          classifier: glyphMapBreaks([0, 500, 1000]),
          colors: ["#0000ff", "#00ff00", "#ffff00", "#ff0000"],
        },
      ],
    });
    // No throw during construction is the main assertion — full pixel
    // verification would need a real render pass, out of scope here.
    expect(map.scene.output).toBeTruthy();
    map.destroy();
    host.remove();
  });

  it("a provider-backed raster layer fetches only VISIBLE tiles and mounts them", async () => {
    const loaded: string[] = [];
    const provider: GlyphMapProvider = {
      id: "synthetic",
      zooms: [{ z: 0, cols: 4, rows: 1, tileLonSpan: 90, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: (_z, x) => ({ west: -180 + x * 90, east: -180 + (x + 1) * 90, south: -90, north: 90 }),
      loadTile: async (z, x, y) => {
        loaded.push(`${z}/${x}_${y}`);
        return makeTile({ west: -180 + x * 90, east: -180 + (x + 1) * 90, south: -90, north: 90 }, 2, 2);
      },
    };
    // Centred on lon 0, a narrow span — only the tiles straddling lon 0
    // should be visible (tile x=1: [-90,0), x=2: [0,90)), not the
    // far-side tiles x=0/x=3.
    const { host, map } = mountFlat({
      view: { center: [0, 0], span: 20, cols: 40, rows: 20 },
      layers: [{ type: "raster", source: provider }],
    });
    await vi.waitFor(() => expect(loaded.length).toBeGreaterThan(0));
    expect(loaded).not.toContain("0/0_0");
    expect(loaded).not.toContain("0/3_0");
    map.destroy();
    host.remove();
  });

  /**
   * The bug this regresses: the tile-diff loop used to key its cache/mount
   * set by the REQUESTED tile address, not what `loadTile` actually
   * resolves to. With a degrading (curated) provider, several sibling
   * requests that all miss real curated coverage can resolve to the exact
   * SAME ancestor tile — before the `resolveTile`-based dedupe, each one
   * fetched and mounted that ancestor's mesh separately (measured live: two
   * sibling requests mounting the same ~16,200-polygon mesh twice, at
   * identical world bounds, for zero visual difference).
   */
  it("dedupes an ancestor-degradation across multiple sibling misses — fetches and mounts it ONCE, not once per sibling", async () => {
    const baseLoads: string[] = [];
    const base: GlyphMapProvider = {
      id: "base",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: async (z, x, y) => {
        baseLoads.push(`${z}/${x}_${y}`);
        return makeTile({ west: -180, east: 180, south: -90, north: 90 }, 2, 2);
      },
    };
    // Only the NW quadrant ("0_0") is a real curated tile — the other three
    // z1 quadrants all degrade to the SAME z0 base ancestor.
    const provider = glyphMapCuratedProvider(base, [
      {
        zoom: { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 2, tileRows: 2 },
        tiles: new Set(["0_0"]),
        loadTile: async () => makeTile({ west: -180, east: 0, south: 0, north: 90 }, 2, 2),
      },
    ]);

    const { host, map } = mountFlat({
      view: { center: [0, 0], span: 340, cols: 80, rows: 40 },
      layers: [{ type: "raster", source: provider }],
    });
    await vi.waitFor(() => expect(baseLoads.length).toBeGreaterThan(0));

    // Three of the four z1 quadrants degrade to the identical z0/(0,0)
    // ancestor identity — deduped, that's exactly one fetch, not three.
    expect(baseLoads).toEqual(["0/0_0"]);

    map.destroy();
    host.remove();
  });

  it("stays rendered after fitBounds zooms into ONE tile's interior — found live on /maps (blank render, no error)", async () => {
    // A 2x2 z1-style pyramid (real quadrant tiles, matching the baked
    // ETOPO1 provider's own shape) — each tile spans 180x90 degrees, far
    // larger than the close-up region `fitBounds` below zooms into. None of
    // the destination tile's own 9 corner/edge/centre sample points has to
    // land on-screen for the tile to still cover the viewport (the viewport
    // is nested INSIDE one tile's interior, not straddling a tile edge) —
    // the bug this regresses is `isBoundsVisible` missing exactly that case,
    // which fell through to the "never blank the layer" failsafe (always
    // tile `0_0`, the WRONG tile here) and rendered nothing.
    const provider: GlyphMapProvider = {
      id: "quadrants",
      zooms: [{ z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 4, tileRows: 4 }],
      bounds: (_z, x, y) => {
        const lonMin = -180 + x * 180;
        const latMax = 90 - y * 90;
        return { west: lonMin, east: lonMin + 180, south: latMax - 90, north: latMax };
      },
      loadTile: async (z, x, y) => {
        const lonMin = -180 + x * 180;
        const latMax = 90 - y * 90;
        return makeTile({ west: lonMin, east: lonMin + 180, south: latMax - 90, north: latMax }, 4, 4);
      },
    };

    const host = document.createElement("div");
    // happy-dom's default `getBoundingClientRect()` is all zeros — a real
    // measured host size is load-bearing here (it's what makes
    // `computeZoomForSpan`'s cell-pixel metrics match a real browser's,
    // which is what actually triggers the bug: at a coarse fallback cell
    // size the projected sample points happen to land closer to center).
    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({ width: 1056, height: 819, top: 0, left: 0, right: 1056, bottom: 819, x: 0, y: 0, toJSON() {} }),
    });
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 140, cols: 135, rows: 63 },
      projection: glyphMapGlobe({ exaggeration: 24 }),
      layers: [{ type: "raster", source: provider }],
    });

    function nonSpaceCount(): number {
      return [...(map.scene.output.textContent ?? "")].filter((c) => c !== " " && c !== "\n").length;
    }

    await vi.waitFor(() => expect(nonSpaceCount()).toBeGreaterThan(0));

    // Himalaya-ish box, entirely inside the east quadrant tile (x=1, y=0:
    // lon [0,180] x lat [0,90]) — well away from every corner/edge.
    map.fitBounds({ west: 78, east: 92, south: 25, north: 32 });

    // `setView`'s own synchronous `scene.rerender()` still shows the OLD
    // (pre-fitBounds) tile set for a moment — `vi.waitFor` on non-blank text
    // alone would pass vacuously against that stale frame. The tile SWAP
    // itself is on `scheduleTileUpdate`'s 180ms debounce, so wait past it
    // before asserting on the settled render.
    await new Promise((r) => setTimeout(r, 400));
    expect(nonSpaceCount()).toBeGreaterThan(0);

    map.destroy();
    host.remove();
  });

  /**
   * The second thing the wheel-zoom bug report asks to verify (not assume
   * broken): with the geo-tiles terrain pyramid extended from z0-z1 to
   * z0-z4 (`website/public/data/geo-tiles/manifest.json`), does shrinking
   * `view.span` actually advance `glyphMapTargetLOD` through z2/z3/z4 and
   * make the WIDGET fetch and mount those deeper tiles — not just the pure
   * `glyphMapTargetLOD` function (pinned separately in
   * `provider.test.ts` against these exact real zoom numbers)? This
   * provider mirrors the real manifest's `cols`/`rows`/`tileLonSpan`/
   * `tileLatSpan`/`tileCols`/`tileRows` shape (z0-z4, native degPerCell 2,
   * 1, 0.5, 0.25, 0.125) verbatim, so a regression in the widget's own
   * span -> degPerCell -> LOD -> fetch wiring shows up here even though
   * `glyphMapTargetLOD` itself is correct.
   */
  it("as view.span shrinks, the widget genuinely advances through z0..z4 and fetches/mounts each deeper level's tiles", async () => {
    const zooms: readonly GlyphMapProviderZoomLevel[] = [
      { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 180, tileRows: 90 },
      { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 180, tileRows: 90 },
      { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 180, tileRows: 90 },
      { z: 3, cols: 8, rows: 8, tileLonSpan: 45, tileLatSpan: 22.5, tileCols: 180, tileRows: 90 },
      { z: 4, cols: 16, rows: 16, tileLonSpan: 22.5, tileLatSpan: 11.25, tileCols: 180, tileRows: 90 },
    ];
    const loadedZ: number[] = [];
    const tileBounds = (level: GlyphMapProviderZoomLevel, x: number, y: number) => {
      const lonMin = -180 + x * level.tileLonSpan;
      const latMax = 90 - y * level.tileLatSpan;
      return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
    };
    const provider: GlyphMapProvider = {
      id: "real-shape-geo-tiles",
      zooms,
      bounds: (z, x, y) => tileBounds(zooms.find((l) => l.z === z)!, x, y),
      loadTile: async (z, x, y) => {
        loadedZ.push(z);
        const level = zooms.find((l) => l.z === z)!;
        return makeTile(tileBounds(level, x, y), level.tileCols, level.tileRows);
      },
    };

    // cols=120 matches `provider.test.ts`'s own real-pyramid progression
    // fixture: span 400/150/70/35/15 -> degPerCell 3.33/1.25/0.583/0.292/0.125
    // -> z0/z1/z2/z3/z4.
    const { host, map } = mountFlat({
      view: { center: [0, 20], span: 400, cols: 120, rows: 60 },
      // `maxSpan` explicitly wide (the same precedent the J3 notch ladder
      // sets) so the LOD ladder's own wide end isn't confounded by the
      // UNRELATED cover clamp — this test is about which zoom level a span
      // selects, not about how wide a sheet is allowed to get.
      maxSpan: 400,
      layers: [{ type: "raster", source: provider }],
    });
    await vi.waitFor(() => expect(loadedZ.length).toBeGreaterThan(0));
    expect(Math.max(...loadedZ)).toBe(0);

    const spans = [150, 70, 35, 15];
    const expectedMaxZ = [1, 2, 3, 4];
    for (let i = 0; i < spans.length; i++) {
      map.setView({ span: spans[i] });
      await new Promise((r) => setTimeout(r, 250)); // past scheduleTileUpdate's 180ms debounce
      expect(Math.max(...loadedZ)).toBe(expectedMaxZ[i]);
    }

    map.destroy();
    host.remove();
  });
});

/**
 * P2 "a2" fix. A curated raster level deliberately leaves `GlyphMapProviderZoomLevel.bounds`
 * `undefined` (`curated.ts:98` — its effective coverage is global because a
 * miss degrades to an ancestor tile) — this provider mirrors that shape at
 * a real z7-sized (128x128) level, `bounds` omitted, exactly as
 * `glyphMapCuratedProvider` produces. Before the fix the sweep enumerated
 * this level's WHOLE `cols x rows` grid (16,384 candidates); the fix
 * enumerates from the view's own geographic window instead.
 */
describe("createGlyphMap — deep tile sweep candidate bound (a2)", () => {
  it("a deep level with no declared bounds is swept from a candidate range bounded by the VIEW, not level.cols x level.rows", async () => {
    const tileLonSpan = 360 / 128;
    const tileLatSpan = 180 / 128;
    let boundsCalls = 0;
    const provider: GlyphMapProvider = {
      id: "deep-no-bounds",
      zooms: [{ z: 7, cols: 128, rows: 128, tileLonSpan, tileLatSpan, tileCols: 32, tileRows: 32 }],
      bounds: (_z, x, y) => {
        boundsCalls++;
        const lonMin = -180 + x * tileLonSpan;
        const latMax = 90 - y * tileLatSpan;
        return { west: lonMin, east: lonMin + tileLonSpan, south: latMax - tileLatSpan, north: latMax };
      },
      loadTile: async (z, x, y) => makeTile(
        { west: -180 + x * tileLonSpan, east: -180 + (x + 1) * tileLonSpan, south: 90 - (y + 1) * tileLatSpan, north: 90 - y * tileLatSpan },
        32,
        32,
      ),
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [8.5, 47], span: 3, cols: 160, rows: 80 },
      projection: glyphMapEquirectangular(),
      layers: [{ type: "raster", source: provider }],
    });

    await vi.waitFor(() => expect(boundsCalls).toBeGreaterThan(0));

    // Pre-fix this was exactly 128 * 128 = 16,384 (`glyphMapTileRangeForLevel`
    // falling back to the full grid because `level.bounds` is undefined).
    // The view's own ~3deg-span window at this tile size restricts it to a
    // small fraction of that — bounded generously here to avoid overfitting
    // the exact candidate count to the padding formula's own constants.
    expect(boundsCalls).toBeLessThan(1000);
    expect(boundsCalls).toBeGreaterThan(0);

    map.destroy();
    host.remove();
  });
});

/**
 * Regression for the reported "half of the map does not load" bug
 * (repro `m=p1x1ay2igs29k`: globe, center [1, 66.4], span 34.4, default
 * tilt 40 — nothing in the URL overrides `t`). Two compounding defects in
 * `candidateTileRange`'s pre-fix `view.span`-arithmetic box, both fixed by
 * deriving the box from real unprojected screen samples instead
 * (`orbitCandidateGeoBounds` above):
 *
 * 1. `halfLonSpan` used `view.span / 2` directly as a longitude offset, but
 *    for an ORBIT projection `computeZoomForSpan` samples `span` along the
 *    MERIDIAN so zoom stays latitude-invariant — the same world-chord
 *    half-extent needs MORE than `halfSpanDeg` degrees of longitude away
 *    from the equator (up to `1 / cos(lat)`, worse toward the poles).
 * 2. The box was always centered at `view.center`, but `tilt` ADDS to
 *    `cameraForCenter(lon, lat)`'s own pitch — at a high base latitude
 *    (where `cameraForCenter`'s own pitch is already large) a moderate
 *    `tilt` can shift the screen's actual sub-observer point well away
 *    from `view.center` entirely. Measured for this exact repro: `view
 *    .center` [1, 66.4] itself projects to row -46 on an 80-row grid (off
 *    the TOP of the screen), while the camera actually shows roughly
 *    lon [-20, 20] / lat [10, 40] — nowhere near [1, 66.4]. Defect 1 alone
 *    (a `1 / cos(lat)`-widened box still centered at [1, 66.4]) would not
 *    have caught this; the true visible window is a different PLACE, not
 *    just a wider one.
 */
describe("createGlyphMap — deep tile sweep candidate bound at high latitude + tilt on a globe (b3)", () => {
  it("sweeps edge tiles the camera can actually see once tilt shifts the visible window away from view.center, not just a band around the (now off-screen) center", async () => {
    const tileLonSpan = 360 / 128;
    const tileLatSpan = 180 / 128;
    const boundsXY = new Set<string>();
    const loadedXY = new Set<string>();
    const provider: GlyphMapProvider = {
      id: "deep-no-bounds-globe",
      zooms: [{ z: 7, cols: 128, rows: 128, tileLonSpan, tileLatSpan, tileCols: 8, tileRows: 8 }],
      bounds: (_z, x, y) => {
        boundsXY.add(`${x}_${y}`);
        const lonMin = -180 + x * tileLonSpan;
        const latMax = 90 - y * tileLatSpan;
        return { west: lonMin, east: lonMin + tileLonSpan, south: latMax - tileLatSpan, north: latMax };
      },
      loadTile: async (_z, x, y) => {
        loadedXY.add(`${x}_${y}`);
        const lonMin = -180 + x * tileLonSpan;
        const latMax = 90 - y * tileLatSpan;
        return makeTile({ west: lonMin, east: lonMin + tileLonSpan, south: latMax - tileLatSpan, north: latMax }, 8, 8);
      },
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    // The exact repro's decoded state: projection defaults to "globe",
    // center/span come from the `x`/`y`/`s` URL tokens, tilt is the page's
    // own unoverridden default (40) even though it's a globe view.
    const map = createGlyphMap(host, {
      view: { center: [1, 66.4], span: 34.4, cols: 160, rows: 80 },
      projection: glyphMapGlobe(),
      tilt: 40,
      layers: [{ type: "raster", source: provider }],
    });

    await vi.waitFor(() => expect(boundsXY.size).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 250)); // past scheduleTileUpdate's debounce

    // Ground truth from the widget's OWN camera/projection (`project()`,
    // a completely separate code path from the fix's `unprojectSphere`
    // sampling) — not a hand-derived expectation. `view.center` itself is
    // off-screen under this tilt; these two points near the east/west
    // edges of what's ACTUALLY visible are not.
    const east = map.project([19, 39]);
    const west = map.project([-19, 39]);
    expect(east.visible).toBe(true);
    expect(west.visible).toBe(true);
    const eastKey = `${Math.floor((19 + 180) / tileLonSpan)}_${Math.floor((90 - 39) / tileLatSpan)}`;
    const westKey = `${Math.floor((-19 + 180) / tileLonSpan)}_${Math.floor((90 - 39) / tileLatSpan)}`;

    expect(boundsXY.has(eastKey)).toBe(true);
    expect(loadedXY.has(eastKey)).toBe(true);
    expect(boundsXY.has(westKey)).toBe(true);
    expect(loadedXY.has(westKey)).toBe(true);

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — markers and events", () => {
  it("addMarker positions a hotspot and remove() detaches it", () => {
    const { host, map } = mountFlat();
    const marker = map.addMarker({ at: [5, 5], label: "Test" });
    expect(marker.el.isConnected).toBe(true);
    expect(marker.el.textContent).toContain("Test");
    marker.remove();
    expect(marker.el.isConnected).toBe(false);
    map.destroy();
    host.remove();
  });

  it("on()/off() register and unregister handlers", () => {
    const { host, map } = mountFlat();
    const handler = vi.fn();
    map.on("move", handler);
    map.setView({ center: [1, 1] });
    expect(handler).toHaveBeenCalledTimes(1);
    map.off("move", handler);
    map.setView({ center: [2, 2] });
    expect(handler).toHaveBeenCalledTimes(1);
    map.destroy();
    host.remove();
  });

  it("fires 'load' once, after construction settles (async even with no layers)", async () => {
    const { host, map } = mountFlat();
    const handler = vi.fn();
    map.on("load", handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    map.destroy();
    host.remove();
  });

  it("a listener that throws does not break subsequent listeners or the widget", () => {
    const { host, map } = mountFlat();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    map.on("move", () => { throw new Error("boom"); });
    map.on("move", good);
    expect(() => map.setView({ center: [3, 3] })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — orbit vs sheet gesture (capability, not identity, branch)", () => {
  it("a globe view's centre follows an equivalent camera rotation (cameraForCenter/centerForCamera round-trip via setView)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [10, 10], span: 40, cols: 60, rows: 30 },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    });
    map.setView({ center: [50, -20] });
    const v = map.getView();
    expect(v.center[0]).toBeCloseTo(50, 6);
    expect(v.center[1]).toBeCloseTo(-20, 6);
    map.destroy();
    host.remove();
  });
});

/**
 * Bug 3 (a live-page report, fixed alongside the chirality bugs above):
 * `applyDrag`'s orbit branch had `camera.rotY`/`camera.rotX` incrementing in
 * the WRONG direction relative to the pointer delta — verified via
 * `centerForCamera`, which measures `rotY +10 -> lon +10` and
 * `rotX +10 -> lat -10`, so a `+= dxPx`/`+= dyPx` orbit update moves the
 * centre AWAY from the cursor on both axes. The sheet (non-orbit) branch's
 * own math turned out to already be correct once bugs 1/2's projection sign
 * flip landed — `screenToWorldDelta`'s Jacobian is derived from the (now
 * chirality-correct) projection, so it inherited the fix rather than needing
 * one of its own; this test pins that empirically rather than assuming it,
 * per the task's "determine which empirically" instruction.
 *
 * Grab-and-drag semantics, matching every map library: the world follows
 * the cursor. Drag RIGHT (`dx > 0`) must DECREASE centre longitude (content
 * already under the cursor stays there, i.e. slides right — the pixels to
 * the LEFT of the old cursor position, which are WEST, scroll into view).
 * Drag DOWN (`dy > 0`) must INCREASE centre latitude (content scrolls down,
 * so the NORTHward pixels above the old cursor position scroll into view).
 */
describe("createGlyphMap — drag direction (grab-and-drag: the world follows the cursor)", () => {
  function fire(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
    host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
  }

  it("orbit branch (globe): drag right decreases centre longitude, drag down increases centre latitude", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 30 },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    });

    fire(host, "pointerdown", 100, 100, 1);
    fire(host, "pointermove", 120, 100, 1); // drag right, dx = +20
    const afterRight = map.getView().center;
    fire(host, "pointerup", 120, 100, 1);
    expect(afterRight[0]).toBeLessThan(0);
    expect(afterRight[1]).toBeCloseTo(0, 6);

    fire(host, "pointerdown", 100, 100, 2);
    fire(host, "pointermove", 100, 120, 2); // drag down, dy = +20
    const afterDown = map.getView().center;
    fire(host, "pointerup", 100, 120, 2);
    expect(afterDown[1]).toBeGreaterThan(afterRight[1]);

    map.destroy();
    host.remove();
  });

  it("sheet branch (equirectangular): drag right decreases centre longitude, drag down increases centre latitude", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 30 },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });

    fire(host, "pointerdown", 100, 100, 1);
    fire(host, "pointermove", 120, 100, 1); // drag right, dx = +20
    const afterRight = map.getView().center;
    fire(host, "pointerup", 120, 100, 1);
    expect(afterRight[0]).toBeLessThan(0);

    fire(host, "pointerdown", 100, 100, 2);
    fire(host, "pointermove", 100, 120, 2); // drag down, dy = +20
    const afterDown = map.getView().center;
    fire(host, "pointerup", 100, 120, 2);
    expect(afterDown[1]).toBeGreaterThan(afterRight[1]);

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — setProjection (animated projection transition, MAPS.md §13 slice 4)", () => {
  it("blends camera framing + reprojects mesh geometry frame by frame, degrades unproject() to null mid-transition, and settles EXACTLY on the target (byte-parity with a non-animated construction)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = { center: [20, 10] as [number, number], span: 40, cols: 40, rows: 20 };
    const map = createGlyphMap(host, {
      view,
      projection: glyphMapEquirectangular(),
      layers: [
        { type: "raster", source: makeTile({ west: -60, east: 60, south: -60, north: 60 }, 4, 4) },
        { type: "line", source: { features: [{ rings: [[[10, 5], [30, 15]]] }] } },
      ],
    });

    const probe: readonly [number, number] = [35, 15];
    const startProbe = map.project(probe);
    expect(startProbe.visible).toBe(true);

    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const donePromise = map.setProjection(globe, { durationMs: 150 });

    // Mid-transition: geometry has moved off its starting projection...
    await new Promise((resolve) => setTimeout(resolve, 50));
    const midProbe = map.project(probe);
    expect(Number.isFinite(midProbe.col)).toBe(true);
    expect(midProbe.col).not.toBeCloseTo(startProbe.col, 3);

    // ...and unproject() degrades to null (never throws) for the duration.
    expect(() => map.unproject([view.cols / 2, view.rows / 2])).not.toThrow();
    expect(map.unproject([view.cols / 2, view.rows / 2])).toBeNull();

    await donePromise;

    // Settles EXACTLY on the target: byte-parity against a plain, never-
    // transitioned construction at the same view/tilt/projection.
    const referenceHost = document.createElement("div");
    document.body.appendChild(referenceHost);
    const reference = createGlyphMap(referenceHost, { view, projection: globe, tilt: map.getTilt() });

    expect(map.scene.camera.rotX).toBeCloseTo(reference.scene.camera.rotX, 6);
    expect(map.scene.camera.rotY).toBeCloseTo(reference.scene.camera.rotY, 6);
    expect(map.scene.camera.zoom).toBeCloseTo(reference.scene.camera.zoom, 6);
    expect(map.scene.camera.target).toEqual(reference.scene.camera.target);

    const endProbe = map.project(probe);
    const referenceProbe = reference.project(probe);
    expect(endProbe.col).toBeCloseTo(referenceProbe.col, 4);
    expect(endProbe.row).toBeCloseTo(referenceProbe.row, 4);

    // The end state differs from the mid-transition sample — it kept moving.
    expect(endProbe.col).not.toBeCloseTo(midProbe.col, 3);

    // unproject() works normally again once settled (the globe's own numeric solve).
    expect(map.unproject([view.cols / 2, view.rows / 2])).not.toBeNull();

    map.destroy();
    host.remove();
    reference.destroy();
    referenceHost.remove();
  });

  it("duration 0 (or an identical target) applies synchronously with no animation frame", async () => {
    const { host, map } = mountFlat({ tilt: 0 });
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    await map.setProjection(globe, { durationMs: 0 });
    expect(map.scene.camera.target).toEqual([0, 0, 0]);
    // A second call with the SAME object the projection already settled on
    // is a same-endpoint no-op — resolves immediately, no throw.
    await expect(map.setProjection(globe, { durationMs: 150 })).resolves.toBeUndefined();
    map.destroy();
    host.remove();
  });
});

/**
 * J8 (P0, regression against the same hour's "drag through the pole"
 * unclamp): "sometimes when I scroll closer to the pole and then zoom out it
 * jumps around."
 *
 * `projection.cameraForCenter` is a 2-to-1 inverse — `centerForCamera`'s own
 * `n = (sin rotX cos rotY, sin rotX sin rotY, cos rotX)` gives the SAME
 * `(lon, lat)` for `(rotX, rotY)` and `(-rotX, rotY + 180)` (`cos` is even;
 * `nx`/`ny` both flip sign) — but `cameraForCenter(lon, lat)` always answers
 * with the canonical `rotX = 90 - lat` branch, inside `[0, 180]`. With
 * `applyDrag`'s near-pole `rotX` clamp removed (dragging THROUGH the pole is
 * now a feature), a drag can genuinely leave `camera.rotX` outside that
 * range — and the NEXT `syncCameraToView` (a wheel notch, `setView`,
 * `resize`, `setTilt`) then re-derived the OTHER branch. The two branches
 * share a view AXIS but differ by a 180deg ROLL about it (measured at tilt 0:
 * every probe point point-reflected about the screen centre — lon -150/lat 78
 * col 45.6 -> 74.4, lon -180/lat 88 row 52.5 -> 7.5), and once a nonzero
 * `tilt` is ADDED after the branch is chosen they are not even the same axis
 * (measured at the page default tilt 40: rotX 28.663 -> 51.337, rotY 0 ->
 * -180, and lon 0/lat 60 leaving the screen entirely, row 33.2 -> -107.0).
 *
 * The fix is NOT to re-clamp the drag. The widget instead REMEMBERS which
 * preimage branch the camera is on and reuses it whenever it still maps to
 * the requested centre, re-deriving the canonical branch only for a genuinely
 * different centre.
 */
describe("createGlyphMap — a through-pole drag does not flip the camera on the next sync (J8)", () => {
  function mountGlobe(tilt: number) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHostRect(host, 1200, 600);
    const map = createGlyphMap(host, {
      view: { center: [0, 60], span: 50, cols: 120, rows: 60 },
      projection: glyphMapGlobe(),
      tilt,
    });
    return { host, map };
  }

  /** Drags north far enough (200 x 5px) to carry the view PAST the pole and back down the antimeridian. */
  function dragThroughPole(host: HTMLElement): void {
    firePointer(host, "pointerdown", 100, 100, 1);
    let y = 100;
    for (let i = 0; i < 200; i++) { y += 5; firePointer(host, "pointermove", 100, y, 1); }
    firePointer(host, "pointerup", 100, y, 1);
  }

  for (const tilt of [0, 40]) {
    it(`invariant 1 still holds AFTER a drag past the pole (tilt ${tilt}) — setView({}) must not flip rotX/rotY`, () => {
      const { host, map } = mountGlobe(tilt);
      dragThroughPole(host);
      // Sanity: the drag really did carry the view through the pole.
      expect(Math.abs(map.getView().center[0])).toBeCloseTo(180, 0);
      expect(map.getView().center[1]).toBeLessThan(85);

      const before = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom };
      map.setView({});
      // Pre-fix (measured, tilt 40): rotX 28.663 -> 51.337, rotY 0 -> -180.
      expect(map.scene.camera.rotX).toBeCloseTo(before.rotX, 6);
      expect(map.scene.camera.rotY).toBeCloseTo(before.rotY, 6);
      expect(map.scene.camera.zoom).toBeCloseTo(before.zoom, 6);

      map.destroy();
      host.remove();
    });

    it(`a wheel ladder after a through-pole drag stays continuous (tilt ${tilt}) — orientation frozen, zoom monotonic, no screen point-reflection`, () => {
      const { host, map } = mountGlobe(tilt);
      dragThroughPole(host);

      const probes: readonly (readonly [number, number])[] = [[-180, 78], [-150, 78], [-180, 88], [-170, 70]];
      const screenOf = () => probes.map((p) => map.project(p));

      let prev = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom, screen: screenOf(), center: map.getView().center };
      for (let notch = 0; notch < 6; notch++) {
        host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, deltaMode: 0, cancelable: true, bubbles: true }));
        const now = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom, screen: screenOf(), center: map.getView().center };

        // A wheel notch changes span alone: orientation and centre are frozen.
        expect(now.rotX).toBeCloseTo(prev.rotX, 6);
        expect(now.rotY).toBeCloseTo(prev.rotY, 6);
        expect(now.center[0]).toBeCloseTo(prev.center[0], 9);
        expect(now.center[1]).toBeCloseTo(prev.center[1], 9);

        // Zooming OUT: strictly smaller, and never a >1.5x jump in one notch
        // (a ~12% step is what one notch requests).
        expect(now.zoom).toBeLessThan(prev.zoom);
        expect(prev.zoom / now.zoom).toBeLessThan(1.5);

        // Every probe point must move TOWARD the screen centre (the whole
        // point of zooming out), never reflect through it — a branch flip
        // point-reflects the screen, which sends a point on one side of the
        // centre to the other side.
        for (let i = 0; i < probes.length; i++) {
          const a = prev.screen[i], b = now.screen[i];
          expect(Number.isFinite(b.col) && Number.isFinite(b.row)).toBe(true);
          const da = Math.hypot(a.col - 60, a.row - 30);
          const db = Math.hypot(b.col - 60, b.row - 30);
          expect(db).toBeLessThanOrEqual(da + 1e-6);
          if (da > 1) {
            const dot = (a.col - 60) * (b.col - 60) + (a.row - 30) * (b.row - 30);
            expect(dot).toBeGreaterThan(0); // same side of centre: no reflection
          }
        }
        prev = now;
      }

      map.destroy();
      host.remove();
    });
  }
});
