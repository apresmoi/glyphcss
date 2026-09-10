/**
 * Walk mode's STEERING — mouselook, on the parthenon's model.
 *
 * ## The defect
 *
 * "It cannot be steered." Measured, and it is one number: the walker's eye
 * sits `perspective / BASE_TILE` world units BEHIND `camera.target`, which at
 * the default entry is **50 metres**. A heading change used to install a
 * bearing matrix and nothing else (`applyBearingState` -> `syncCameraBearing`),
 * so the view axis swung about a target that stayed put — and the EYE
 * orbited it on a 50 m circle. Measured on the shipped build at Zurich: a
 * 4 degree turn (five pixels of drag) slid the walker **3.49 m** sideways
 * through the world, and a 90 degree turn slid them **70.7 m**, while
 * `getView().center` — where the map believes the walker is standing, and
 * where the ground under their feet is sampled — did not move at all. Take
 * one step and `advanceWalk` re-poses, snapping the eye back. That is not a
 * camera you can aim; it is one that slides out from under you and jumps
 * back.
 *
 * So the property is not "a look changes the heading" (it always did) but
 * **a look turns the head and MOVES NOTHING** — a rotation about the eye,
 * which is what first person means.
 *
 * ## The parthenon's model, reproduced
 *
 * `website/src/pages/examples/parthenon.astro` acquires pointer lock from
 * `pointerdown` rather than from `click`, and says exactly why: a per-frame
 * effect layer rewrites the `<pre>`'s spans, so a mousedown that lands on a
 * glyph has its target detached before mouseup and the browser never fires
 * `click`. Every `@glyphcss/maps` render rewrites the same `<pre>`, so walk
 * mode inherits the fragility verbatim and takes the same route out of it.
 * Touch keeps drag-to-look, which is the same page's other half.
 *
 * Fixture traps: pointer lock does not exist in happy-dom, so what is under
 * test is the WIRING — that a mouse press asks the host for the lock and
 * that a locked `mousemove` steers — never the browser API; and
 * `getBoundingClientRect` is stubbed for cell metrics.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import {
  GLYPH_MAP_WALK_HORIZON_TILT_DEG,
  GLYPH_MAP_WALK_LOOK_DEG_PER_PX,
  GLYPH_MAP_WALK_MAX_PITCH_DEG,
} from "./walk";
import { glyphMapGlobe } from "./projection";
import { metresBetween, walkEye, walkForward } from "./walk.harness";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];

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

/**
 * A host that RECORDS pointer-lock requests instead of performing one.
 * happy-dom has no pointer lock at all, so the element is given the two
 * members the widget calls and the document is given the one it reads.
 */
interface LockableHost extends HTMLElement {
  lockRequests: number;
}
function mount() {
  const host = document.createElement("div") as LockableHost;
  host.lockRequests = 0;
  host.requestPointerLock = function (this: LockableHost) { this.lockRequests++; } as HTMLElement["requestPointerLock"];
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: ZURICH as [number, number], span: 0.01, cols: COLS, rows: ROWS },
  });
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

/** Pretend the browser granted (or released) the lock, and tell the widget the way the browser would. */
function setPointerLock(host: HTMLElement | null): void {
  Object.defineProperty(document, "pointerLockElement", { value: host, configurable: true });
  document.dispatchEvent(new Event("pointerlockchange"));
}

function press(host: HTMLElement, init: Partial<PointerEventInit> = {}): void {
  host.dispatchEvent(new PointerEvent("pointerdown", {
    pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 100, clientY: 100,
    bubbles: true, cancelable: true, ...init,
  }));
}

function release(host: HTMLElement): void {
  host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", bubbles: true }));
}

/** A locked mouse move — `movementX/movementY`, which is the only signal pointer lock gives. */
function look(dx: number, dy: number): void {
  const e = new MouseEvent("mousemove", { bubbles: true });
  Object.defineProperty(e, "movementX", { value: dx });
  Object.defineProperty(e, "movementY", { value: dy });
  document.dispatchEvent(e);
}

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  Object.defineProperty(document, "pointerLockElement", { value: null, configurable: true });
});

describe("walk steering — a look turns the head and moves nothing", () => {
  it("a mouse press while walking asks the HOST for pointer lock", () => {
    const { map, host, done } = mount();
    press(host);
    expect(host.lockRequests).toBe(0);
    release(host);
    map.setWalk({});
    press(host);
    expect(host.lockRequests).toBe(1);
    done();
  });

  it("routes the request through pointerdown, not click — the <pre> is rewritten every render", () => {
    const { map, host, done } = mount();
    map.setWalk({});
    host.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.lockRequests).toBe(0);
    press(host);
    expect(host.lockRequests).toBe(1);
    done();
  });

  it("a locked mouse move turns the heading, at the first-person rate", () => {
    const { map, host, done } = mount();
    map.setWalk({});
    press(host);
    setPointerLock(host);
    look(20, 0);
    // Mouse right turns the head RIGHT: facing north, the new heading is east
    // of north. (Same sign as the parthenon's `rotY - dx * LOOK_SENS`, which
    // turns the same way.)
    expect(map.getBearing()).toBeCloseTo(20 * GLYPH_MAP_WALK_LOOK_DEG_PER_PX, 6);
    done();
  });

  it("a locked mouse move pitches, and drag DOWN looks DOWN", () => {
    const { map, host, done } = mount();
    map.setWalk({});
    press(host);
    setPointerLock(host);
    look(0, 30);
    expect(map.getWalk()!.pitch).toBeCloseTo(-30 * GLYPH_MAP_WALK_LOOK_DEG_PER_PX, 6);
    look(0, -60);
    expect(map.getWalk()!.pitch).toBeCloseTo(30 * GLYPH_MAP_WALK_LOOK_DEG_PER_PX, 6);
    done();
  });

  it("THE DEFECT: turning the head leaves the eye exactly where it stood", () => {
    const { map, host, done } = mount();
    map.setWalk({});
    const before = walkEye(map.scene.camera);
    press(host);
    setPointerLock(host);
    // Five pixels of the old drag rate was 4 degrees, which used to slide the
    // walker 3.49 m; a quarter turn used to slide them 70.7 m.
    look(27, 0);
    expect(map.getBearing()).toBeGreaterThan(3);
    expect(metresBetween(before, walkEye(map.scene.camera))).toBeLessThan(0.01);
    map.setBearing(90);
    expect(metresBetween(before, walkEye(map.scene.camera))).toBeLessThan(0.01);
    map.setBearing(213.7);
    expect(metresBetween(before, walkEye(map.scene.camera))).toBeLessThan(0.01);
    done();
  });

  it("...and it really is a TURN: the view axis moves by the angle asked for", () => {
    const { map, done } = mount();
    map.setWalk({});
    const before = walkForward(map.scene.camera);
    map.setBearing(90);
    const after = walkForward(map.scene.camera);
    const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
    expect((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI).toBeCloseTo(90, 4);
    done();
  });

  it("clamps the pitch to the neck, and the neck is the parthenon's own", () => {
    const { map, host, done } = mount();
    map.setWalk({});
    press(host);
    setPointerLock(host);
    look(0, -100000);
    expect(map.getWalk()!.pitch).toBeCloseTo(GLYPH_MAP_WALK_MAX_PITCH_DEG, 6);
    // The parthenon clamps `rotX` to 6..174 about the same horizontal this
    // package calls `GLYPH_MAP_WALK_HORIZON_TILT_DEG`, so the two clamps are
    // the same numbers once both are read from it.
    expect(GLYPH_MAP_WALK_HORIZON_TILT_DEG - GLYPH_MAP_WALK_MAX_PITCH_DEG).toBeCloseTo(6, 6);
    expect(GLYPH_MAP_WALK_HORIZON_TILT_DEG + GLYPH_MAP_WALK_MAX_PITCH_DEG).toBeCloseTo(174, 6);
    look(0, 100000);
    expect(map.getWalk()!.pitch).toBeCloseTo(-GLYPH_MAP_WALK_MAX_PITCH_DEG, 6);
    done();
  });

  it("a released lock stops steering, and leaving walk mode releases it", () => {
    const { map, host, done } = mount();
    map.setWalk({});
    press(host);
    setPointerLock(host);
    look(20, 0);
    const turned = map.getBearing();
    setPointerLock(null);
    look(20, 0);
    expect(map.getBearing()).toBeCloseTo(turned, 9);
    done();
  });

  it("steers nothing at all when walk mode is off — the map keeps its own gestures", () => {
    const { map, host, done } = mount();
    press(host);
    setPointerLock(host);
    look(40, 40);
    expect(map.getBearing()).toBe(0);
    expect(map.getTilt()).toBe(0);
    done();
  });
});
