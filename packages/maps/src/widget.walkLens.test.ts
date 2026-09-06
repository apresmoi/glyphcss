/**
 * Walk mode's LENS.
 *
 * ## What was measured, and what it turned out to be
 *
 * The reported defect was "the FOV of that FPV is super wrong". The obvious
 * suspect was {@link glyphMapWalkLens}' `perspective`, which at the page's
 * default walk entry (Zurich, globe, 140x63 at 8x16 px cells) is
 * **0.00039240307665913503 CSS pixels** — a focal length four orders of
 * magnitude below one pixel, which reads as broken on sight.
 *
 * It is not. Measured through the REAL `project()` — bisecting for the
 * off-axis angle whose ray lands on the last column — that lens produces
 * exactly **70.000 degrees** of horizontal field of view, which is
 * {@link GLYPH_MAP_WALK_FOV_DEG}. The tiny number is forced, not wrong: this
 * package's world unit is an EARTH RADIUS, and the CSS-perspective near
 * plane is `P / BASE_TILE / 100` WORLD units, so the parthenon's literal
 * `perspective: 1000` would put the near plane 1,274 km in front of the eye
 * and clip the entire planet. `P` for a half-metre near plane is
 * `0.5 / 6371000 * 50 / 0.01`, and that is the number above.
 *
 * So this file pins the lens as a PROPERTY of the rendered picture rather
 * than as a constant, which is the only form of the claim that survives the
 * unit system:
 *
 *  1. The horizontal FOV the camera actually produces is the one asked for.
 *  2. **It holds as the rendered width changes.** This is the parthenon's
 *     own `fpvPerspective()` clause (`FPV_REF_WIDTH`, re-applied on
 *     `resize`), and it is where walk mode was genuinely broken: the lens
 *     solves `zoom` against `cols * cellWidth`, and nothing re-solved it
 *     when that width changed. `/maps` never calls `map.resize()` at all —
 *     the scene's own `autoSize` observer re-fits the grid underneath the
 *     widget — so a reader who resized the window, rotated a phone, or
 *     opened a devtools pane while walking kept a lens cut for the OLD
 *     width, in direct proportion: half the width, half the FOV.
 *  3. A near plane a walker can put their face inside of.
 *
 * Fixture trap: happy-dom has no layout, so `getBoundingClientRect` is
 * stubbed to give the widget real cell metrics (shared with
 * `widget.walk.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_WALK_FOV_DEG, GLYPH_MAP_WALK_NEAR_M } from "./walk";
import { glyphMapGlobe } from "./projection";
import { EARTH_RADIUS_M, measuredHorizontalFovDeg, walkEye, walkForward } from "./walk.harness";

const CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
/** host -> the pixel size it currently reports, so a test can RESIZE it mid-walk. */
const hostSizes = new Map<HTMLElement, { w: number; h: number }>();

function stubMonospaceMetrics(host: HTMLElement, cols: number, rows: number): void {
  hostSizes.set(host, { w: cols * CELL_W, h: rows * CELL_H });
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const size = hostSizes.get(el);
    if (size) return rect(size.w, size.h);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

/**
 * The `ResizeObserver` the widget installs while walking, captured so a test
 * can fire it. Pointer lock and layout do not exist in happy-dom, so what is
 * under test here is the WIRING — that a host resize reaches the lens — not
 * the browser's own delivery of it.
 */
let observers: { cb: ResizeObserverCallback; targets: Element[]; disconnected: boolean }[] = [];
class CapturingResizeObserver {
  private readonly record: { cb: ResizeObserverCallback; targets: Element[]; disconnected: boolean };
  constructor(cb: ResizeObserverCallback) {
    this.record = { cb, targets: [], disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element): void { this.record.targets.push(target); }
  unobserve(): void { /* not exercised */ }
  disconnect(): void { this.record.disconnected = true; }
}

function mount(cols: number, rows: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host, cols, rows);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: ZURICH as [number, number], span: 0.01, cols, rows },
  });
  const grid = () => ({ cols, rows, cellWidth: CELL_W, cellHeight: CELL_H });
  return { map, host, grid, done: () => { map.destroy(); host.remove(); } };
}

/** Fire every captured observer, the way the browser would after a host resize. */
function fireResizeObservers(): void {
  for (const o of observers) {
    if (o.disconnected) continue;
    o.cb([] as unknown as ResizeObserverEntry[], null as unknown as ResizeObserver);
  }
}

const realResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  vi.restoreAllMocks();
  hostSizes.clear();
  observers = [];
  globalThis.ResizeObserver = realResizeObserver;
});

describe("walk lens — the field of view the camera actually produces", () => {
  it("is the field of view that was asked for", () => {
    const { map, grid, done } = mount(140, 63);
    map.setWalk({});
    expect(measuredHorizontalFovDeg(map.scene.camera, grid())).toBeCloseTo(GLYPH_MAP_WALK_FOV_DEG, 3);
    done();
  });

  it("is the same field of view on a phone-shaped grid as on a desktop one", () => {
    // The parthenon's `fpvPerspective()` exists because a FIXED focal length
    // reads ~22 deg on a narrow viewport against ~56 deg on a wide one. The
    // map solves `zoom` from the rendered width instead, which is the same
    // guarantee stated exactly rather than anchored to a reference width.
    const wide = mount(200, 60);
    wide.map.setWalk({});
    const wideFov = measuredHorizontalFovDeg(wide.map.scene.camera, wide.grid());
    wide.done();
    const narrow = mount(44, 90);
    narrow.map.setWalk({});
    const narrowFov = measuredHorizontalFovDeg(narrow.map.scene.camera, narrow.grid());
    narrow.done();
    expect(wideFov).toBeCloseTo(GLYPH_MAP_WALK_FOV_DEG, 3);
    expect(narrowFov).toBeCloseTo(GLYPH_MAP_WALK_FOV_DEG, 3);
  });

  it("survives a HOST RESIZE while walking, without the page having to call resize()", () => {
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    const { map, host, done } = mount(140, 63);
    map.setWalk({});
    expect(measuredHorizontalFovDeg(map.scene.camera, { cols: 140, rows: 63, cellWidth: CELL_W, cellHeight: CELL_H }))
      .toBeCloseTo(GLYPH_MAP_WALK_FOV_DEG, 3);
    // The window narrows to a third. `autoSize` is the page's real
    // configuration, so the scene re-fits its own grid; here the grid is
    // fixed and the CELLS shrink, which is the same input to the lens
    // (`cols * cellWidth`) arriving by the other route.
    hostSizes.set(host, { w: 140 * (CELL_W / 3), h: 63 * CELL_H });
    fireResizeObservers();
    expect(measuredHorizontalFovDeg(map.scene.camera, { cols: 140, rows: 63, cellWidth: CELL_W / 3, cellHeight: CELL_H }))
      .toBeCloseTo(GLYPH_MAP_WALK_FOV_DEG, 3);
    done();
  });

  it("stops observing the host on the way out of walk mode, and on destroy", () => {
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    const { map, done } = mount(140, 63);
    map.setWalk({});
    expect(observers.filter((o) => !o.disconnected).length).toBe(1);
    map.setWalk(null);
    expect(observers.every((o) => o.disconnected)).toBe(true);
    map.setWalk({});
    expect(observers.filter((o) => !o.disconnected).length).toBe(1);
    done();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it("puts the near plane closer than a walker can put their face to a wall", () => {
    const { map, done } = mount(140, 63);
    map.setWalk({});
    const camera = map.scene.camera;
    const eye = walkEye(camera);
    const f = walkForward(camera);
    // `eyeDepth` is the SIGNED distance past the near plane, so the near
    // plane is where it crosses zero along the view axis.
    const at = (metres: number) => camera.eyeDepth([
      eye[0] + f[0] * (metres / EARTH_RADIUS_M),
      eye[1] + f[1] * (metres / EARTH_RADIUS_M),
      eye[2] + f[2] * (metres / EARTH_RADIUS_M),
    ]);
    let lo = 0, hi = 10;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) <= 0) lo = mid; else hi = mid;
    }
    // Within a percent of the asked-for near plane (`eyeDepth` clips a hair
    // inside the projection's own plane, by `PERSPECTIVE_CLIP_NEAR_FRACTION`).
    expect((lo + hi) / 2).toBeGreaterThan(GLYPH_MAP_WALK_NEAR_M * 0.98);
    expect((lo + hi) / 2).toBeLessThan(GLYPH_MAP_WALK_NEAR_M * 1.05);
    done();
  });
});
