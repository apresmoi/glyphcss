/**
 * A projection transition must never change APPARENT SIZE by more than the
 * two endpoints themselves differ — not mid-flight, and not across the two
 * ENDPOINT-OBJECT SWAPS at `t=0` and `t=1` (`glyphMapProjectionTransition`
 * returns the exact endpoint objects there, so the very first and very last
 * frame each cross from a blended surface to a different code path).
 *
 * `widget.transitionAnchor.test.ts` samples the same quantity over a real
 * timer at 0.1-ish steps and only for globe<->equirectangular; that is too
 * coarse and too narrow to see either failure this file exists for:
 *
 * - **The last 1% of a flight.** Both halves of the camera are interpolated
 *   LINEARLY while the geometry's own world scale is not, so the residual
 *   between them collapses over the last few percent of `t` rather than
 *   spreading evenly — a jump right as the animation lands.
 * - **Sheet<->sheet pairs that do NOT share a world scale.** Equirectangular
 *   and Mercator both put one world unit on one degree, so lerping their
 *   positions is well behaved; ORTHOGRAPHIC puts the whole visible hemisphere
 *   in ~1 world unit, ~57x smaller per degree. Blending it against either of
 *   the others used to inflate apparent size 15.7x mid-flight and collapse it
 *   again in the final percent (measured through this harness).
 *
 * Time is DRIVEN, not awaited: `requestAnimationFrame` is stubbed to a manual
 * queue so a frame can be delivered at any exact `t`, which is the only way to
 * sample either boundary finely. `stubMonospaceMetrics` is load-bearing for
 * the same reason as `widget.renderMode.test.ts`'s — happy-dom has no layout,
 * so without it the measured cell and the camera's own fallback cell disagree.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator, glyphMapOrthographic } from "./projection";
import type { GlyphMapProjection } from "./projection";

const VIEW_COLS = 160;
const VIEW_ROWS = 64;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
const DURATION = 1000;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

const stubbedHosts = new Set<HTMLElement>();
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(VIEW_COLS * CELL_W, VIEW_ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

let frameQueue: ((now: number) => void)[] = [];
function installDrivenClock(): void {
  frameQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => { frameQueue.push(cb); return frameQueue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}
/** Deliver one frame at `now` ms. The first one a transition sees becomes its `startTime`, so this must be called with `0` first. */
function frame(now: number): void {
  const pending = frameQueue;
  frameQueue = [];
  for (const cb of pending) cb(now);
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Fine at BOTH ends (the endpoint-object swaps and the last-percent collapse),
 * coarse through the middle where nothing structural happens.
 */
const SAMPLE_TS: readonly number[] = [
  0, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.07,
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
  0.93, 0.95, 0.97, 0.98, 0.99, 0.995, 0.998, 0.999, 0.9995, 1,
];

interface Sample { readonly t: number; readonly lon: number; readonly lat: number; readonly wide: number; readonly tall: number }

/**
 * Two scales, because they fail independently.
 *
 * `lon`/`lat` are the screen-cell distance from the view centre to a point
 * ONE degree east / north of it — apparent size, what `camera.zoom` controls.
 *
 * `wide`/`tall` span a quarter-view east/west and an eighth of one
 * north/south of the centre, so they read the blend's SHAPE rather than its
 * scale: a morph that holds one endpoint's shape for most of the flight and
 * snaps into the other's at the end leaves `lon`/`lat` perfectly flat (the
 * camera is fitted to the centre) while these move all at once. Both axes,
 * because they carry different information — equirectangular and Mercator
 * differ ONLY north/south, and only away from the equator.
 */
function measure(map: ReturnType<typeof createGlyphMap>, center: readonly [number, number], wideDeg: number, tallDeg: number): { lon: number; lat: number; wide: number; tall: number } {
  const a = map.project(center);
  const east = map.project([center[0] + 1, center[1]]);
  const north = map.project([center[0], center[1] + 1]);
  const wideW = map.project([center[0] - wideDeg, center[1]]);
  const wideE = map.project([center[0] + wideDeg, center[1]]);
  const tallS = map.project([center[0], center[1] - tallDeg]);
  const tallN = map.project([center[0], center[1] + tallDeg]);
  return {
    lon: Math.hypot(east.col - a.col, east.row - a.row),
    lat: Math.hypot(north.col - a.col, north.row - a.row),
    wide: Math.hypot(wideE.col - wideW.col, wideE.row - wideW.row),
    tall: Math.hypot(tallN.col - tallS.col, tallN.row - tallS.row),
  };
}

function flight(from: GlyphMapProjection, to: GlyphMapProjection, center: [number, number], span: number, tilt: number): readonly Sample[] {
  return flightWith(from, to, center, span, tilt).samples;
}

/** `flight`, plus whatever else the caller wants read off the SETTLED widget before it is torn down. */
function flightWith(
  from: GlyphMapProjection,
  to: GlyphMapProjection,
  center: [number, number],
  span: number,
  tilt: number,
  atSettle: (map: ReturnType<typeof createGlyphMap>) => void = () => {},
): { readonly samples: readonly Sample[] } {
  const wideDeg = span / 4;
  const tallDeg = span / 8;
  installDrivenClock();
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, { view: { center, span, cols: VIEW_COLS, rows: VIEW_ROWS }, projection: from, tilt });
  void map.setProjection(to, { durationMs: DURATION });
  const samples: Sample[] = [];
  for (const t of SAMPLE_TS) {
    frame(t * DURATION);
    const m = measure(map, center, wideDeg, tallDeg);
    samples.push({ t, lon: m.lon, lat: m.lat, wide: m.wide, tall: m.tall });
  }
  atSettle(map);
  map.destroy();
  host.remove();
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return { samples };
}

/**
 * Apparent size never leaves the band its own two endpoints define (times
 * `tol`), on either axis. `tol` is a small allowance for the genuinely
 * non-affine part of a morph — an unwrap really does open a sphere out onto a
 * plane — not room for a bulge: the defect this catches ran 15.7x.
 */
function expectBoundedByEndpoints(samples: readonly Sample[], tol: number, label: string): void {
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  for (const axis of ["lon", "lat"] as const) {
    const lo = Math.min(first[axis], last[axis]) / tol;
    const hi = Math.max(first[axis], last[axis]) * tol;
    for (const s of samples) {
      expect(Number.isFinite(s[axis]), `${label} ${axis} t=${s.t} is not finite`).toBe(true);
      expect(s[axis], `${label} ${axis} t=${s.t}`).toBeGreaterThanOrEqual(lo);
      expect(s[axis], `${label} ${axis} t=${s.t}`).toBeLessThanOrEqual(hi);
    }
  }
}

/**
 * No single sampled step may change apparent size by more than its share of
 * the flight's own total change, times `slack`.
 * The samples straddling `t=0` and `t=1` are the ones that matter most: they
 * cross `glyphMapProjectionTransition`'s endpoint-object swap, where the blend
 * hands over to a different code path entirely.
 */
function expectStepwiseContinuous(samples: readonly Sample[], slack: number, label: string): void {
  for (const axis of ["lon", "lat"] as const) {
    const first = samples[0]![axis];
    const last = samples[samples.length - 1]![axis];
    // What the WHOLE flight changes this axis by. A perfectly paced flight
    // spends `total ** dt` of it on a step of width `dt`, so the budget is
    // that times `slack` — which keeps the tiny steps either side of `t=0`
    // and `t=1` on a near-1.0 budget (a pop there has nowhere to hide) while
    // not calling the coarse mid-flight sampling a discontinuity.
    const total = Math.max(first, last) / Math.max(1e-9, Math.min(first, last));
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i]!.t - samples[i - 1]!.t;
      const prev = samples[i - 1]![axis];
      const next = samples[i]![axis];
      const step = Math.max(prev, next) / Math.max(1e-9, Math.min(prev, next));
      const budget = slack * total ** dt;
      expect(step, `${label} ${axis} step t=${samples[i - 1]!.t}->${samples[i]!.t} (${prev.toFixed(4)} -> ${next.toFixed(4)}, budget ${budget.toFixed(4)})`).toBeLessThanOrEqual(budget);
    }
  }
}

/**
 * The morph must be PACED by `t`: whatever total change the flight makes to
 * the view's wide shape, no more than `share` of it may be crammed into the
 * first or the last tenth of the flight. A 15%-of-`t` window carrying ~100%
 * of the change is a jump however smooth each individual step is, and it is
 * exactly what a component-wise lerp between two sheets ~57x apart in world
 * scale produces (the orthographic pairs): the larger-scale endpoint's own
 * shape dominates the sum for all but a sliver of `t` at the small-scale end.
 */
function expectPacedByT(samples: readonly Sample[], share: number, label: string): void {
  for (const axis of ["wide", "tall"] as const) {
    const at = (t: number): number => samples.find((s) => s.t === t)![axis];
    const start = at(0);
    const end = at(1);
    const total = Math.abs(end - start);
    // Endpoints whose shape barely differs on this axis have no travel to
    // mis-pace, and the ratio would just amplify float noise. Equirectangular
    // and Mercator are exactly this case east/west at every latitude, and on
    // BOTH axes at the equator.
    if (total <= Math.max(start, end) * 0.05) continue;
    expect(Math.abs(end - at(0.9)) / total, `${label}: share of the ${axis} shape travel spent in the LAST tenth`).toBeLessThanOrEqual(share);
    expect(Math.abs(at(0.1) - start) / total, `${label}: share of the ${axis} shape travel spent in the FIRST tenth`).toBeLessThanOrEqual(share);
  }
}

const CENTER: [number, number] = [0, 20];
/** The `/maps` page's own defaults — the configuration both reports were made against. */
const SPAN = 140;
const TILT = 40;

const globe = (): GlyphMapProjection => glyphMapGlobe({ exaggeration: 24 });
const equi = (): GlyphMapProjection => glyphMapEquirectangular({ exaggeration: 24 });
const merc = (): GlyphMapProjection => glyphMapMercator({ exaggeration: 24 });
const ortho = (c: readonly [number, number]): GlyphMapProjection => glyphMapOrthographic({ lon0: c[0], lat0: c[1], exaggeration: 24 });

describe("createGlyphMap — a projection transition holds apparent size across the whole flight, both boundaries included", () => {
  const pairs: readonly (readonly [string, () => GlyphMapProjection, () => GlyphMapProjection])[] = [
    ["globe->equirectangular", globe, equi],
    ["equirectangular->globe", equi, globe],
    ["globe->mercator", globe, merc],
    ["mercator->globe", merc, globe],
    ["globe->orthographic", globe, () => ortho(CENTER)],
    ["orthographic->globe", () => ortho(CENTER), globe],
    // Sheet<->sheet at DIFFERENT world scales: orthographic frames a whole
    // hemisphere in ~1 world unit, equirectangular/Mercator one unit per
    // degree. This pair is what the second report ("change between Mercator
    // and the other flat ones and they zoom in and zoom out") is about.
    ["equirectangular->orthographic", equi, () => ortho(CENTER)],
    ["orthographic->equirectangular", () => ortho(CENTER), equi],
    ["mercator->orthographic", merc, () => ortho(CENTER)],
    ["orthographic->mercator", () => ortho(CENTER), merc],
  ];

  for (const [label, from, to] of pairs) {
    it(`${label} stays inside its own endpoints and never steps`, () => {
      const samples = flight(from(), to(), CENTER, SPAN, TILT);
      expectBoundedByEndpoints(samples, 1.35, label);
      expectStepwiseContinuous(samples, 1.35, label);
      expectPacedByT(samples, 0.45, label);
    });
  }
});

describe("createGlyphMap — sheet<->sheet transitions hold at every view LATITUDE, not just the equator", () => {
  // Equirectangular and Mercator agree at the equator and diverge as
  // 1/cos(lat), so a test centred on [0, 0] proves almost nothing about this
  // pair. The vertical stretch itself is genuine (Mercator IS taller), so the
  // gate is that it arrives MONOTONICALLY between the two endpoints' own
  // values — never overshooting either.
  for (const lat of [0, 30, 45, 60, 75]) {
    it(`equirectangular<->mercator at lat ${lat}`, () => {
      const center: [number, number] = [0, lat];
      const out = flight(equi(), merc(), center, 40, 0);
      expectBoundedByEndpoints(out, 1.05, `equi->merc lat ${lat}`);
      expectStepwiseContinuous(out, 1.35, `equi->merc lat ${lat}`);
      expectPacedByT(out, 0.45, `equi->merc lat ${lat}`);

      const back = flight(merc(), equi(), center, 40, 0);
      expectBoundedByEndpoints(back, 1.05, `merc->equi lat ${lat}`);
      expectStepwiseContinuous(back, 1.35, `merc->equi lat ${lat}`);
      expectPacedByT(back, 0.45, `merc->equi lat ${lat}`);
    });

    it(`globe<->equirectangular at lat ${lat}`, () => {
      // Also a gate on HOW the blend's world scale is measured. A measure
      // that branches on the orbit capability reads the globe one way at
      // `t=0` (the endpoint object) and the blend the other way one frame
      // later, and the two differ by `1 / cos(lat)` — invisible at the
      // equator, a 1.88x first-frame zoom snap at 61N. The equator-only case
      // is exactly the one that cannot see it.
      const center: [number, number] = [0, lat];
      // A 40deg span: at lat 75 a 100deg one puts the view's own north edge
      // past the pole, which is a genuinely degenerate frame to measure a
      // north/south apparent size in, not a transition defect.
      const out = flight(globe(), equi(), center, 40, 0);
      expectBoundedByEndpoints(out, 1.35, `globe->equi lat ${lat}`);
      expectStepwiseContinuous(out, 1.35, `globe->equi lat ${lat}`);
      expectPacedByT(out, 0.45, `globe->equi lat ${lat}`);

      const back = flight(equi(), globe(), center, 40, 0);
      expectBoundedByEndpoints(back, 1.35, `equi->globe lat ${lat}`);
      expectStepwiseContinuous(back, 1.35, `equi->globe lat ${lat}`);
      expectPacedByT(back, 0.45, `equi->globe lat ${lat}`);
    });

    it(`orthographic<->equirectangular at lat ${lat}`, () => {
      const center: [number, number] = [0, lat];
      const out = flight(ortho(center), equi(), center, 100, 0);
      expectBoundedByEndpoints(out, 1.35, `ortho->equi lat ${lat}`);
      expectStepwiseContinuous(out, 1.35, `ortho->equi lat ${lat}`);
      expectPacedByT(out, 0.45, `ortho->equi lat ${lat}`);

      const back = flight(equi(), ortho(center), center, 100, 0);
      expectBoundedByEndpoints(back, 1.35, `equi->ortho lat ${lat}`);
      expectStepwiseContinuous(back, 1.35, `equi->ortho lat ${lat}`);
      expectPacedByT(back, 0.45, `equi->ortho lat ${lat}`);
    });
  }
});

/**
 * ENDPOINTS WITH DIFFERENT SPAN LIMITS.
 *
 * The cover rule (`widget.cover.test.ts`) gives every SHEET projection a
 * maximum span — the widest view that still fills the viewport — and an
 * ORBIT projection none at all, since a globe legitimately floats in space.
 * So a flight can legally START at a span its DESTINATION would never
 * accept: a globe at span 340 landing on equirectangular, whose own ceiling
 * here is ~172.
 *
 * `setProjection` resolves that ONCE, up front, against the destination's
 * limit (`limitProjection` returns the destination for the flight's whole
 * duration, so nothing re-clamps mid-air either). The alternative — clamping
 * when the flight LANDS — would put the entire span change into the last
 * frame, which is the exact defect class `expectStepwiseContinuous` exists
 * to catch at `t = 1`. These cases would fail against that alternative and
 * pass here.
 */
describe("createGlyphMap — a flight into a projection with a TIGHTER span limit lands covered, without snapping", () => {
  const cases: readonly (readonly [string, () => GlyphMapProjection, () => GlyphMapProjection, number, number])[] = [
    // Globe (no limit at all) -> sheet: the widest gap there is. Its span
    // 340 lands on an equirectangular ceiling of ~172 here — a 2x clamp.
    ["globe(340)->equirectangular", globe, equi, 340, TILT],
    // Mercator's own world is ~square (360x360 world units), so at TILT its
    // ceiling is ~345 — barely under its domain width, and no case at all.
    // A steeper pitch foreshortens the vertical axis until the ceiling
    // genuinely bites (~225 at tilt 60), which is the point: the limit is a
    // function of the live CAMERA and host shape, not a per-projection
    // constant, so a tilt change alone must be enough to create the case.
    ["globe(340)->mercator@tilt60", globe, merc, 340, 60],
    // Orthographic frames a whole hemisphere in ~1 world unit, so its own
    // cover limit is the tightest of the three by a wide margin.
    ["globe(340)->orthographic", globe, () => ortho(CENTER), 340, TILT],
    ["equirectangular(160)->orthographic", equi, () => ortho(CENTER), 160, TILT],
  ];

  for (const [label, from, to, span, tilt] of cases) {
    it(`${label} stays inside its own endpoints and never steps`, () => {
      const samples = flight(from(), to(), CENTER, span, tilt);
      expectBoundedByEndpoints(samples, 1.35, label);
      expectStepwiseContinuous(samples, 1.35, label);
      expectPacedByT(samples, 0.45, label);
    });

    it(`${label} settles exactly where a durationMs:0 call would`, () => {
      let flown: { span: number; zoom: number; center: readonly [number, number] } | null = null;
      flightWith(from(), to(), CENTER, span, tilt, (map) => {
        const v = map.getView();
        flown = { span: v.span, zoom: map.scene.camera.zoom, center: v.center };
        // The destination's own ceiling, and the flight really did land on
        // it — STRICTLY tighter than where the flight started, or this case
        // would not be exercising a differing limit at all.
        expect(v.span).toBeLessThanOrEqual(map.getMaxSpan() + 1e-9);
        expect(v.span).toBeLessThan(span);
      });

      // Same endpoints, no animation: the instant path must agree.
      installDrivenClock();
      const host = document.createElement("div");
      document.body.appendChild(host);
      stubMonospaceMetrics(host);
      const map = createGlyphMap(host, { view: { center: CENTER, span, cols: VIEW_COLS, rows: VIEW_ROWS }, projection: from(), tilt });
      void map.setProjection(to(), { durationMs: 0 });
      const v = map.getView();
      expect(v.span).toBeCloseTo(flown!.span, 9);
      expect(map.scene.camera.zoom).toBeCloseTo(flown!.zoom, 6);
      expect(v.center[0]).toBeCloseTo(flown!.center[0], 9);
      expect(v.center[1]).toBeCloseTo(flown!.center[1], 9);
      map.destroy();
      host.remove();
      document.body.innerHTML = "";
      stubbedHosts.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });
  }

  it("a flight OUT of a sheet into the globe leaves the span alone — an orbit projection has no cover limit to impose", () => {
    installDrivenClock();
    const host = document.createElement("div");
    document.body.appendChild(host);
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, { view: { center: CENTER, span: 120, cols: VIEW_COLS, rows: VIEW_ROWS }, projection: equi(), tilt: TILT });
    const before = map.getView().span;
    void map.setProjection(globe(), { durationMs: DURATION });
    frame(0);
    frame(DURATION);
    expect(map.getView().span).toBe(before);
    map.destroy();
    host.remove();
    document.body.innerHTML = "";
    stubbedHosts.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
