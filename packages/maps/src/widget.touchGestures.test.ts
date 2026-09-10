// @vitest-environment happy-dom
/**
 * TOUCH GESTURES — the two-finger vocabulary, and the disambiguation that is
 * the whole of it.
 *
 * A phone has no wheel, no Ctrl key and no right button, so before this the
 * widget gave a touch reader ONE gesture (drag to pan) and no way to zoom,
 * turn or pitch at all. The set added is Google Maps' — pinch, twist,
 * two-finger vertical drag, double-tap, two-finger tap, double-tap-drag — on
 * MapLibre's thresholds, because Google publishes the vocabulary and not one
 * number behind it.
 *
 * The properties this file pins, each with its own way of silently going
 * wrong:
 *
 *  1. **Each gesture moves ONE thing.** A pinch must not turn the map, a
 *     twist must not change the span, and a two-finger vertical drag must do
 *     neither. This is the disambiguation, and it is the failure a reader
 *     feels first: two fingers are never rigid, so a pitch that leaves pinch
 *     and twist live drifts both on every stroke.
 *  2. **The pitch lock is EXCLUSIVE and decided ONCE.** A two-finger drag
 *     recognised as a pitch stays a pitch even when the fingers later spread
 *     far past the zoom threshold — which they will.
 *  3. **The pinch is ANCHORED**: the ground under the midpoint is still under
 *     the midpoint afterwards. Zooming about the view centre instead slides
 *     the map out from under a hand that is holding it.
 *  4. **The mouse is untouched.** Plain drag, Ctrl+drag and the wheel have
 *     their own gates elsewhere; nothing here may reach them.
 *
 * TWO-PHASE STROKES. Every rate assertion here arms the gesture first, READS
 * the state, and only then makes the movement it measures. That is not
 * ceremony: recognition legitimately spends travel (the thresholds are the
 * feature), so a single-phase stroke can only be asserted against a
 * step-count reconstruction of what the recogniser did — which tests the
 * reconstruction, not the rate. After recognition every increment is applied
 * and the whole thing telescopes, so phase two is exact to the last bit.
 *
 * Fixture traps (shared with `widget.tiltGesture.test.ts` /
 * `widget.bearing.test.ts`): happy-dom has no layout, so
 * `getBoundingClientRect` is stubbed to give the widget real cell metrics —
 * including glyphcss's own hidden-`<pre>` cell probe, which the camera and
 * the rasterizer must agree on. Everything settles on `map.idle()`, never on
 * a duration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GLYPH_MAP_DOUBLE_TAP_MAX_MS,
  GLYPH_MAP_TAP_DRAG_ZOOM_LEVELS_PER_PX,
  GLYPH_MAP_TAP_ZOOM_LEVELS,
  GLYPH_MAP_TILT_DRAG_DEG_PER_PX,
  GLYPH_MAP_TOUCH_ROTATE_THRESHOLD_PX,
  createGlyphMap,
} from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

function mount(opts: Parameters<typeof createGlyphMap>[1]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, opts);
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

type Pt = readonly [number, number];
type Pair = readonly [Pt, Pt];

function touch(host: HTMLElement, type: string, id: number, [x, y]: Pt): void {
  host.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: id, pointerType: "touch", bubbles: true, cancelable: true, button: 0,
  }));
}

/** Two fingers `spacing` apart, centred on `(cx, cy)`, the line between them turned `deg` CLOCKWISE. */
function pair(cx: number, cy: number, spacing: number, deg = 0): Pair {
  const r = (deg * Math.PI) / 180, hx = (spacing / 2) * Math.cos(r), hy = (spacing / 2) * Math.sin(r);
  return [[cx - hx, cy - hy], [cx + hx, cy + hy]];
}

/** Both fingers of a pair moved by the same offset. */
function shift([a, b]: Pair, dx: number, dy: number): Pair {
  return [[a[0] + dx, a[1] + dy], [b[0] + dx, b[1] + dy]];
}

function twoFingerDown(host: HTMLElement, [a, b]: Pair): void {
  touch(host, "pointerdown", 1, a);
  touch(host, "pointerdown", 2, b);
}

function twoFingerUp(host: HTMLElement, [a, b]: Pair): void {
  touch(host, "pointerup", 1, a);
  touch(host, "pointerup", 2, b);
}

/**
 * Step the fingers along `path(t)` for `t` in `(0, 1]`, one `pointermove`
 * per finger per step — which is how a real device delivers a two-finger
 * move, since a Pointer Event carries exactly one pointer.
 */
function twoFingerPath(host: HTMLElement, path: (t: number) => Pair, steps = 20): void {
  for (let i = 1; i <= steps; i++) {
    const [a, b] = path(i / steps);
    touch(host, "pointermove", 1, a);
    touch(host, "pointermove", 2, b);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pinchPath = (cx: number, cy: number, s0: number, s1: number, deg = 0) =>
  (t: number) => pair(cx, cy, lerp(s0, s1, t), deg);
const twistPath = (cx: number, cy: number, s: number, d0: number, d1: number) =>
  (t: number) => pair(cx, cy, s, lerp(d0, d1, t));
const dragPath = (base: Pair, dx: number, dy: number) =>
  (t: number) => shift(base, dx * t, dy * t);

const GLOBE = { center: [8, 46] as const, span: 12, cols: COLS, rows: ROWS };
const SHEET = { center: [8, 46] as const, span: 40, cols: COLS, rows: ROWS };

/** A big square of ink, so a gesture has something visible to move. */
const patch: GlyphMapVectorFeature = {
  geometryType: "polygon",
  properties: {},
  rings: [[[2, 40], [14, 40], [14, 52], [2, 52], [2, 40]] as [number, number][]],
};
const inkLayers = [{ type: "fill" as const, id: "patch", source: { features: [patch] }, color: "#3b82f6" }];

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

describe("createGlyphMap — two-finger pinch zooms and ONLY zooms", () => {
  it("spreading the fingers by a factor zooms in by exactly that factor, once armed", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 20, bearing: 30 });
    await map.idle();

    twoFingerDown(host, pair(560, 504, 120));
    twoFingerPath(host, pinchPath(560, 504, 120, 150), 6);   // arm
    const span0 = map.getView().span, bearing0 = map.getBearing(), tilt0 = map.getTilt();
    twoFingerPath(host, pinchPath(560, 504, 150, 450), 20);  // measure: x3
    twoFingerUp(host, pair(560, 504, 450));
    await map.idle();

    expect(span0 / map.getView().span).toBeCloseTo(3, 6);
    // ...and nothing else moved.
    expect(map.getBearing()).toBe(bearing0);
    expect(map.getTilt()).toBeCloseTo(tilt0, 10);
    done();
  });

  it("pinching IN zooms out by the same rule", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    twoFingerDown(host, pair(560, 504, 400));
    twoFingerPath(host, pinchPath(560, 504, 400, 350), 6);
    const span0 = map.getView().span;
    twoFingerPath(host, pinchPath(560, 504, 350, 175), 20);
    twoFingerUp(host, pair(560, 504, 175));
    await map.idle();
    expect(map.getView().span / span0).toBeCloseTo(2, 6);
    done();
  });

  it("a pinch under the 2^0.1 threshold moves NOTHING", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    const before = map.getView();
    // 200px -> 210px is a ratio of 1.05, inside 2^0.1 = 1.072.
    twoFingerDown(host, pair(560, 504, 200));
    twoFingerPath(host, pinchPath(560, 504, 200, 210), 10);
    twoFingerUp(host, pair(560, 504, 210));
    await map.idle();
    expect(map.getView().span).toBe(before.span);
    // The centre is unchanged to within float noise rather than bit-exact:
    // a Pointer Event carries ONE finger, so a symmetric pinch's midpoint
    // oscillates by half a step between the two fingers' events and the
    // two-finger PAN (which has no threshold of its own — it is the same
    // gesture as a one-finger drag) tracks it there and back. The round
    // trip telescopes to zero up to the last bits.
    expect(map.getView().center[0]).toBeCloseTo(before.center[0], 6);
    expect(map.getView().center[1]).toBeCloseTo(before.center[1], 6);
    done();
  });

  it("a REAL pinch wobbles, and the arc threshold absorbs it: 8 degrees of incidental turn move the bearing not at all", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), bearing: 60 });
    await map.idle();
    // A hand is not a rigid body: nobody spreads two fingers along an exactly
    // fixed line. 8deg is a realistically sloppy pinch and it is inside the
    // 23.9deg threshold of the narrowest grip in the stroke.
    twoFingerDown(host, pair(560, 504, 120, 0));
    twoFingerPath(host, (t) => pair(560, 504, lerp(120, 400, t), 8 * t), 25);
    twoFingerUp(host, pair(560, 504, 400, 8));
    await map.idle();
    expect(map.getBearing()).toBe(60);
    expect(map.getView().span).toBeLessThan(GLOBE.span / 2);
    done();
  });

  it("a REAL twist wobbles too, and the ratio threshold absorbs it: 5% of incidental spread moves the span not at all", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), bearing: 0 });
    await map.idle();
    const span0 = map.getView().span;
    // 5% of spread is inside the 7.2% the pinch threshold asks for.
    twoFingerDown(host, pair(560, 504, 240, 0));
    twoFingerPath(host, (t) => pair(560, 504, lerp(240, 252, t), 60 * t), 30);
    twoFingerUp(host, pair(560, 504, 252, 60));
    await map.idle();
    expect(map.getView().span).toBe(span0);
    expect(map.getBearing()).not.toBe(0);
    done();
  });

  it("is ANCHORED: the ground under the midpoint is still under the midpoint", async () => {
    const { map, host, done } = mount({ view: { ...SHEET }, projection: glyphMapEquirectangular() });
    await map.idle();
    // A midpoint well off centre — a centre-anchored zoom would leave this
    // point somewhere else entirely.
    const MX = 300, MY = 200;
    twoFingerDown(host, pair(MX, MY, 120));
    twoFingerPath(host, pinchPath(MX, MY, 120, 150), 6);
    const under = map.unproject([MX / CELL_W, MY / CELL_H])!;
    expect(under).toBeTruthy();
    twoFingerPath(host, pinchPath(MX, MY, 150, 400), 20);
    twoFingerUp(host, pair(MX, MY, 400));
    await map.idle();

    const back = map.project(under);
    expect(back.col * CELL_W).toBeCloseTo(MX, 1);
    expect(back.row * CELL_H).toBeCloseTo(MY, 1);
    // The premise: it really did zoom, so there was something to slide.
    expect(map.getView().span).toBeLessThan(SHEET.span / 2);
    done();
  });
});

describe("createGlyphMap — two-finger twist turns the heading and ONLY the heading", () => {
  it("a clockwise twist turns the picture clockwise — the bearing DECREASES, 1:1", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), bearing: 90 });
    await map.idle();
    twoFingerDown(host, pair(560, 504, 240, 0));
    twoFingerPath(host, twistPath(560, 504, 240, 0, 20), 20);   // arm past 11.9deg
    const b0 = map.getBearing(), span0 = map.getView().span;
    expect(b0).not.toBe(90);
    twoFingerPath(host, twistPath(560, 504, 240, 20, 60), 20);  // measure: a further 40deg
    twoFingerUp(host, pair(560, 504, 240, 60));
    await map.idle();

    expect(map.getBearing()).toBeCloseTo(b0 - 40, 6);
    // A twist holds the finger distance constant, so the pinch threshold is
    // never crossed and the span is untouched.
    expect(map.getView().span).toBe(span0);
    done();
  });

  it("an anti-clockwise twist turns it the other way, at the same rate", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), bearing: 90 });
    await map.idle();
    twoFingerDown(host, pair(560, 504, 240, 0));
    twoFingerPath(host, twistPath(560, 504, 240, 0, -20), 20);
    const b0 = map.getBearing();
    twoFingerPath(host, twistPath(560, 504, 240, -20, -60), 20);
    twoFingerUp(host, pair(560, 504, 240, -60));
    await map.idle();
    expect(map.getBearing()).toBeCloseTo(b0 + 40, 6);
    done();
  });

  it("a twist under the arc threshold moves nothing", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), bearing: 30 });
    await map.idle();
    // 100px apart is a 28.6deg threshold; 10deg is well inside it.
    twoFingerDown(host, pair(560, 504, 100, 0));
    twoFingerPath(host, twistPath(560, 504, 100, 0, 10), 10);
    twoFingerUp(host, pair(560, 504, 100, 10));
    await map.idle();
    expect(map.getBearing()).toBe(30);
    done();
  });

  it("the threshold is an ARC, not an angle: the twist ignored at a narrow grip is honoured at a wide one", async () => {
    const twist = (spacing: number) => {
      const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), bearing: 0 });
      twoFingerDown(host, pair(560, 504, spacing, 0));
      twoFingerPath(host, twistPath(560, 504, spacing, 0, 15), 15);
      twoFingerUp(host, pair(560, 504, spacing, 15));
      const b = map.getBearing();
      done();
      return b;
    };
    const narrow = (GLYPH_MAP_TOUCH_ROTATE_THRESHOLD_PX / (Math.PI * 100)) * 360;
    const wide = (GLYPH_MAP_TOUCH_ROTATE_THRESHOLD_PX / (Math.PI * 500)) * 360;
    expect(narrow).toBeGreaterThan(15);
    expect(wide).toBeLessThan(15);
    expect(twist(100)).toBe(0);
    expect(twist(500)).not.toBe(0);
  });
});

describe("createGlyphMap — two fingers dragging TOGETHER pitch, and only pitch", () => {
  it("dragging UP raises the pitch at the Ctrl+drag rate, moving neither span nor centre nor bearing", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 10, bearing: 45 });
    await map.idle();
    expect(map.getMaxTilt()).toBeGreaterThan(40);
    const base = pair(560, 504, 200);

    twoFingerDown(host, base);
    twoFingerPath(host, dragPath(base, 0, -6), 3);            // arm
    const t0 = map.getTilt(), span0 = map.getView().span, c0 = map.getView().center;
    twoFingerPath(host, (t) => shift(base, 0, -6 - 40 * t), 20); // measure: 40px up
    twoFingerUp(host, shift(base, 0, -46));
    await map.idle();

    expect(map.getTilt()).toBeCloseTo(t0 + 40 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    expect(map.getBearing()).toBe(45);
    expect(map.getView().span).toBe(span0);
    expect(map.getView().center).toEqual(c0);
    done();
  });

  it("dragging DOWN lowers it, exactly inversely", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 40 });
    await map.idle();
    const base = pair(560, 504, 200);
    twoFingerDown(host, base);
    twoFingerPath(host, dragPath(base, 0, 6), 3);
    const t0 = map.getTilt();
    twoFingerPath(host, (t) => shift(base, 0, 6 + 40 * t), 20);
    twoFingerUp(host, shift(base, 0, 46));
    await map.idle();
    expect(map.getTilt()).toBeCloseTo(t0 - 40 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    done();
  });

  it("the pitch LOCK holds: fingers that spread and twist far past both thresholds mid-stroke still only pitch", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 10, bearing: 0 });
    await map.idle();
    const span0 = map.getView().span;

    // Recognised as a pitch on the first steps (both fingers straight up),
    // then the grip spreads 200px -> 500px (1.32 zoom levels, 13x the
    // threshold) and turns 25deg (2x the threshold at that grip). With no
    // lock this zooms and turns.
    twoFingerDown(host, pair(560, 504, 200, 0));
    twoFingerPath(host, (t) => pair(560, 504 - 12 * t, 200, 0), 4);
    twoFingerPath(host, (t) => pair(560, 492 - 48 * t, 200 + 300 * t, 25 * t), 20);
    twoFingerUp(host, pair(560, 444, 500, 25));
    await map.idle();

    expect(map.getView().span).toBe(span0);
    expect(map.getBearing()).toBe(0);
    expect(map.getTilt()).toBeGreaterThan(10);
    done();
  });

  it("STACKED fingers can never pitch — that grip cannot express one — so the same drag navigates instead", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 10 });
    await map.idle();
    const c0 = map.getView().center;
    const base = pair(560, 504, 200, 90);   // one finger above the other
    twoFingerDown(host, base);
    twoFingerPath(host, dragPath(base, 0, -40), 20);
    twoFingerUp(host, shift(base, 0, -40));
    await map.idle();
    expect(map.getTilt()).toBe(10);
    expect(map.getView().center).not.toEqual(c0);   // it panned
    done();
  });

  it("fingers moving OPPOSITE ways vertically are not a pitch — they are a pinch", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 10 });
    await map.idle();
    const span0 = map.getView().span;
    // Side by side at a fixed x, but one goes UP and the other DOWN: the
    // `isSameDirection` clause fails, and the distance grows 200 -> 233.
    twoFingerDown(host, pair(560, 504, 200, 0));
    twoFingerPath(host, (t) => [[460, 504 - 60 * t], [660, 504 + 60 * t]], 20);
    twoFingerUp(host, [[460, 444], [660, 564]]);
    await map.idle();
    expect(map.getTilt()).toBe(10);
    expect(map.getView().span).not.toBe(span0);
    done();
  });
});

describe("createGlyphMap — taps", () => {
  it("a DOUBLE-TAP zooms in exactly one level, anchored on the tapped point", async () => {
    const { map, host, done } = mount({ view: { ...SHEET }, projection: glyphMapEquirectangular() });
    await map.idle();
    const span0 = map.getView().span;
    const TX = 300, TY = 200;
    const under = map.unproject([TX / CELL_W, TY / CELL_H])!;

    touch(host, "pointerdown", 1, [TX, TY]);
    touch(host, "pointerup", 1, [TX, TY]);
    touch(host, "pointerdown", 2, [TX, TY]);
    touch(host, "pointerup", 2, [TX, TY]);
    await map.idle();

    expect(map.getView().span).toBeCloseTo(span0 / Math.pow(2, GLYPH_MAP_TAP_ZOOM_LEVELS), 10);
    const back = map.project(under);
    expect(back.col * CELL_W).toBeCloseTo(TX, 1);
    expect(back.row * CELL_H).toBeCloseTo(TY, 1);
    done();
  });

  it("two taps too far apart in TIME are two single taps, not a zoom", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    const span0 = map.getView().span;
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);
    touch(host, "pointerdown", 1, [400, 300]);
    touch(host, "pointerup", 1, [400, 300]);
    now.mockReturnValue(GLYPH_MAP_DOUBLE_TAP_MAX_MS + 50);
    touch(host, "pointerdown", 2, [400, 300]);
    touch(host, "pointerup", 2, [400, 300]);
    now.mockRestore();
    await map.idle();
    expect(map.getView().span).toBe(span0);
    done();
  });

  it("two taps too far apart in SPACE are two single taps", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    const span0 = map.getView().span;
    touch(host, "pointerdown", 1, [400, 300]);
    touch(host, "pointerup", 1, [400, 300]);
    touch(host, "pointerdown", 2, [400, 400]);
    touch(host, "pointerup", 2, [400, 400]);
    await map.idle();
    expect(map.getView().span).toBe(span0);
    done();
  });

  it("a TWO-FINGER TAP zooms OUT exactly one level", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    const span0 = map.getView().span;
    twoFingerDown(host, pair(560, 480, 120));
    twoFingerUp(host, pair(560, 480, 120));
    await map.idle();
    expect(map.getView().span).toBeCloseTo(span0 * Math.pow(2, GLYPH_MAP_TAP_ZOOM_LEVELS), 10);
    done();
  });

  it("a two-finger gesture that MOVED is not a two-finger tap", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }), tilt: 10 });
    await map.idle();
    const span0 = map.getView().span;
    const base = pair(560, 504, 200);
    twoFingerDown(host, base);
    twoFingerPath(host, dragPath(base, 0, -60), 20);
    twoFingerUp(host, shift(base, 0, -60));
    await map.idle();
    // It pitched, and the release did not additionally zoom out.
    expect(map.getTilt()).toBeGreaterThan(10);
    expect(map.getView().span).toBe(span0);
    done();
  });

  it("DOUBLE-TAP-AND-DRAG is the one-handed zoom: DOWN zooms in at 1/128 of a level per pixel", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    touch(host, "pointerdown", 1, [400, 300]);
    touch(host, "pointerup", 1, [400, 300]);
    touch(host, "pointerdown", 2, [400, 300]);
    touch(host, "pointermove", 2, [400, 310]);          // arm (past the 3px click tolerance)
    const span0 = map.getView().span;
    for (let i = 1; i <= 16; i++) touch(host, "pointermove", 2, [400, 310 + i * 4]);  // measure: 64px down
    touch(host, "pointerup", 2, [400, 374]);
    await map.idle();
    expect(Math.log2(span0 / map.getView().span)).toBeCloseTo(64 * GLYPH_MAP_TAP_DRAG_ZOOM_LEVELS_PER_PX, 6);
    done();
  });

  it("dragging UP after a double-tap zooms OUT", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    const span0 = map.getView().span;
    touch(host, "pointerdown", 1, [400, 300]);
    touch(host, "pointerup", 1, [400, 300]);
    touch(host, "pointerdown", 2, [400, 300]);
    for (let i = 1; i <= 16; i++) touch(host, "pointermove", 2, [400, 300 - i * 4]);
    touch(host, "pointerup", 2, [400, 236]);
    await map.idle();
    expect(map.getView().span).toBeGreaterThan(span0);
    done();
  });

  it("a single tap still emits one map `click`, and a two-finger gesture emits none", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    let clicks = 0;
    map.on("click", () => { clicks++; });
    touch(host, "pointerdown", 1, [400, 300]);
    touch(host, "pointerup", 1, [400, 300]);
    expect(clicks).toBe(1);
    twoFingerDown(host, pair(560, 480, 120));
    twoFingerUp(host, pair(560, 480, 120));
    await map.idle();
    expect(clicks).toBe(1);
    done();
  });
});

describe("createGlyphMap — the gestures move the rendered picture, not only the state", () => {
  it("a pinch, a twist and a two-finger pitch each redraw the `<pre>`", async () => {
    const { map, host, done } = mount({
      view: { ...SHEET }, projection: glyphMapEquirectangular(),
      layers: inkLayers, scene: { mode: "solid", useColors: true },
    });
    await map.idle();
    const ink = (s: string) => s.replace(/[^\S\n]/g, "").length;
    const before = map.scene.output.textContent ?? "";
    expect(ink(before)).toBeGreaterThan(200);

    twoFingerDown(host, pair(560, 504, 120));
    twoFingerPath(host, pinchPath(560, 504, 120, 400), 20);
    twoFingerUp(host, pair(560, 504, 400));
    await map.idle();
    const pinched = map.scene.output.textContent ?? "";
    expect(pinched).not.toBe(before);
    expect(ink(pinched)).toBeGreaterThan(ink(before));   // zoomed IN: more of the patch

    twoFingerDown(host, pair(560, 504, 240, 0));
    twoFingerPath(host, twistPath(560, 504, 240, 0, 50), 25);
    twoFingerUp(host, pair(560, 504, 240, 50));
    await map.idle();
    expect(map.scene.output.textContent).not.toBe(pinched);
    done();
  });
});

describe("createGlyphMap — one finger, and the mouse, are untouched", () => {
  it("ONE finger still pans, and the rendered frame follows", async () => {
    const { map, host, done } = mount({
      view: { ...SHEET }, projection: glyphMapEquirectangular(),
      layers: inkLayers, scene: { mode: "solid", useColors: true },
    });
    await map.idle();
    const before = map.scene.output.textContent;
    const c0 = map.getView().center;
    touch(host, "pointerdown", 1, [400, 300]);
    touch(host, "pointermove", 1, [460, 300]);
    touch(host, "pointerup", 1, [460, 300]);
    await map.idle();
    expect(map.getView().center).not.toEqual(c0);
    expect(map.scene.output.textContent).not.toBe(before);
    done();
  });

  it("a MOUSE drag is unaffected by any of this", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    const c0 = map.getView().center;
    for (const [type, x] of [["pointerdown", 400], ["pointermove", 460], ["pointerup", 460]] as const) {
      host.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: 300, pointerId: 7, pointerType: "mouse", bubbles: true, cancelable: true, button: 0,
      }));
    }
    await map.idle();
    expect(map.getView().center).not.toEqual(c0);
    done();
  });

  it("lifting ONE finger of a pinch hands the stroke back to the other as a pan, with no jump", async () => {
    const { map, host, done } = mount({ view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    await map.idle();
    twoFingerDown(host, pair(560, 504, 200));
    twoFingerPath(host, pinchPath(560, 504, 200, 360), 10);
    touch(host, "pointerup", 1, [380, 504]);
    const afterPinch = map.getView().center;
    // The surviving finger, still exactly where it was: a hand-over that
    // re-based on the wrong point would jump the map here.
    touch(host, "pointermove", 2, [740, 504]);
    expect(map.getView().center).toEqual(afterPinch);
    // ...and then it pans normally.
    touch(host, "pointermove", 2, [780, 504]);
    expect(map.getView().center).not.toEqual(afterPinch);
    touch(host, "pointerup", 2, [780, 504]);
    await map.idle();
    done();
  });
});

describe("createGlyphMap — the controls opt-outs cover touch by CAPABILITY", () => {
  it("`wheel: false` disables the pinch and both tap zooms, and leaves the twist alone", async () => {
    const { map, host, done } = mount({
      view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }),
      bearing: 0, controls: { wheel: false },
    });
    await map.idle();
    const span0 = map.getView().span;

    twoFingerDown(host, pair(560, 504, 120));
    twoFingerPath(host, pinchPath(560, 504, 120, 400), 20);
    twoFingerUp(host, pair(560, 504, 400));
    await map.idle();
    expect(map.getView().span).toBe(span0);

    twoFingerDown(host, pair(560, 504, 240, 0));
    twoFingerPath(host, twistPath(560, 504, 240, 0, 60), 30);
    twoFingerUp(host, pair(560, 504, 240, 60));
    await map.idle();
    expect(map.getBearing()).not.toBe(0);

    twoFingerDown(host, pair(560, 480, 120));
    twoFingerUp(host, pair(560, 480, 120));
    await map.idle();
    expect(map.getView().span).toBe(span0);
    done();
  });

  it("`tilt: false` disables the two-finger pitch AND the twist, and leaves the pinch alone", async () => {
    const { map, host, done } = mount({
      view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 15, bearing: 0, controls: { tilt: false },
    });
    await map.idle();
    const span0 = map.getView().span;
    const base = pair(560, 504, 200);

    twoFingerDown(host, base);
    twoFingerPath(host, dragPath(base, 0, -40), 20);
    twoFingerUp(host, shift(base, 0, -40));
    await map.idle();
    expect(map.getTilt()).toBe(15);

    twoFingerDown(host, pair(560, 504, 240, 0));
    twoFingerPath(host, twistPath(560, 504, 240, 0, 60), 30);
    twoFingerUp(host, pair(560, 504, 240, 60));
    await map.idle();
    expect(map.getBearing()).toBe(0);

    twoFingerDown(host, pair(560, 504, 120));
    twoFingerPath(host, pinchPath(560, 504, 120, 400), 20);
    twoFingerUp(host, pair(560, 504, 400));
    await map.idle();
    expect(map.getView().span).toBeLessThan(span0);
    done();
  });

  it("`drag: false` pins the centre: a pinch still zooms, about the CENTRE", async () => {
    const { map, host, done } = mount({
      view: { ...SHEET }, projection: glyphMapEquirectangular(), controls: { drag: false },
    });
    await map.idle();
    const c0 = map.getView().center, span0 = map.getView().span;
    twoFingerDown(host, pair(300, 200, 120));
    twoFingerPath(host, pinchPath(300, 200, 120, 400), 20);
    twoFingerUp(host, pair(300, 200, 400));
    await map.idle();
    expect(map.getView().span).toBeLessThan(span0);
    expect(map.getView().center).toEqual(c0);
    done();
  });
});

describe("createGlyphMap — the host declares it consumes touches", () => {
  it("sets `touch-action: none` on the host and puts the caller's value back on destroy", () => {
    const host = document.createElement("div");
    host.style.touchAction = "pan-y";
    document.body.appendChild(host);
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, { view: { ...GLOBE }, projection: glyphMapGlobe({ exaggeration: 0 }) });
    expect(host.style.touchAction).toBe("none");
    map.destroy();
    expect(host.style.touchAction).toBe("pan-y");
    host.remove();
  });
});
