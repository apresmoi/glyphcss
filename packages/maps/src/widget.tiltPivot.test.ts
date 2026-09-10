/**
 * `tilt` pivots about the SURFACE POINT under the view centre, not about the
 * globe's centre.
 *
 * Before this model, an ORBIT projection posed the camera as
 * `rotX = cameraForCenter(lon, lat).rotX + tilt` with `target = [0, 0, 0]`,
 * so the extra pitch swung the whole sphere about its own centre and carried
 * `view.center` straight off the screen: measured through this very harness
 * at the page's default `tilt: 40`, `project(getView().center)` landed at row
 * 8.2 of 63 at a 40-degree span and at row -22,775 of 63 at a 0.11-degree
 * span. Six separate defects on this branch traced to that displacement.
 *
 * The rule now is one rule for both scales and both projection families:
 * PITCH ABOUT THE SURFACE POINT UNDER THE VIEW CENTRE. Under an orthographic
 * camera the pivot's distance along the view axis is unobservable (the camera
 * has no position, only an orientation and the world point at screen centre),
 * so "pivot at the camera's altitude above the surface point" reduces exactly
 * to "the surface point stays at screen centre" — which is what a SHEET
 * projection has always done (`camera.target = project(lon, lat, 0)`), so one
 * implementation serves both and the sheet path is untouched.
 *
 * Fixture traps this file works around: happy-dom has no layout, so the
 * camera's own fallback cell metrics and the widget's measured ones disagree
 * unless `getBoundingClientRect` is stubbed; and `sin(180 - L) === sin(L)`
 * means a far-side point shares its near-side twin's COLUMN, so every
 * assertion about WHERE something landed is keyed on the ROW.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";

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

function fire(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

describe("createGlyphMap — tilt pivots about the surface point under the view centre", () => {
  /**
   * The assertion that has been impossible all session. Spans chosen to
   * bracket the whole usable ladder, including the 0.11-degree span where the
   * old model put the view centre 22,775 rows off a 63-row grid.
   */
  for (const [span, center] of [
    [140, [0, 20]],
    [40, [12, 34]],
    [3, [8.2, 46.5]],
    [0.11, [8.54, 47.37]],
  ] as const) {
    it(`globe: project(getView().center) is at the CENTRE of the grid at span ${span}, tilted`, () => {
      const { map, done } = mount({
        view: { center: [center[0], center[1]], span, cols: COLS, rows: ROWS },
        projection: glyphMapGlobe({ exaggeration: 0 }),
        tilt: 40,
      });
      // A nonzero pitch really is in force — otherwise this passes vacuously.
      expect(Math.abs(map.getTilt())).toBeGreaterThan(1);

      const at = map.project(map.getView().center);
      expect(at.col).toBeCloseTo(COLS / 2, 6);
      expect(at.row).toBeCloseTo(ROWS / 2, 6);
      expect(at.visible).toBe(true);
      done();
    });
  }

  it("globe: the pivot holds across the whole tilt range, at both signs", () => {
    const { map, done } = mount({
      view: { center: [-73.9, 40.7], span: 2, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    for (const t of [-80, -45, -15, 0, 15, 45, 80]) {
      map.setTilt(t);
      const at = map.project(map.getView().center);
      expect(at.row).toBeCloseTo(ROWS / 2, 6);
      expect(at.col).toBeCloseTo(COLS / 2, 6);
    }
    done();
  });

  it("globe: a drag under tilt leaves the NEW view centre at the grid centre (and re-syncing is a no-op)", () => {
    const { map, host, done } = mount({
      view: { center: [0, 20], span: 20, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 40,
    });
    fire(host, "pointerdown", 100, 100, 1);
    for (let i = 0; i < 30; i++) fire(host, "pointermove", 100 + (i + 1) * 3, 100 + (i + 1) * 10, 1);
    fire(host, "pointerup", 190, 400, 1);

    const at = map.project(map.getView().center);
    expect(at.col).toBeCloseTo(COLS / 2, 6);
    expect(at.row).toBeCloseTo(ROWS / 2, 6);

    const before = {
      rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY,
      zoom: map.scene.camera.zoom, target: [...map.scene.camera.target],
    };
    map.setView({});
    expect(map.scene.camera.rotX).toBeCloseTo(before.rotX, 9);
    expect(map.scene.camera.rotY).toBeCloseTo(before.rotY, 9);
    expect(map.scene.camera.zoom).toBeCloseTo(before.zoom, 9);
    for (let i = 0; i < 3; i++) expect(map.scene.camera.target[i]).toBeCloseTo(before.target[i], 9);
    done();
  });

  /**
   * A drag that carries the camera THROUGH the pole leaves `camera.rotX`
   * outside `cameraForCenter`'s own `[0, 180]` branch. The pivot must follow
   * the branch the widget is actually on, not the canonical preimage.
   */
  it("globe: dragging through the pole keeps the view centre at the grid centre", () => {
    const { map, host, done } = mount({
      view: { center: [10, 84], span: 20, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 30,
    });
    fire(host, "pointerdown", 100, 400, 1);
    for (let i = 0; i < 40; i++) fire(host, "pointermove", 100, 400 - (i + 1) * 12, 1);
    fire(host, "pointerup", 100, -80, 1);

    // Past the pole: latitude has turned back down and longitude reflected.
    const at = map.project(map.getView().center);
    expect(at.col).toBeCloseTo(COLS / 2, 6);
    expect(at.row).toBeCloseTo(ROWS / 2, 6);
    done();
  });

  /**
   * A projection transition poses the camera at a lerp of the two endpoints'
   * pitches, and each endpoint has its OWN ceiling — a sheet has no limb and
   * keeps the full 40 degrees where a globe at the same wide view is clamped
   * to ~21. The applied pitch therefore has to be carried through the flight
   * and read back by the drag, not re-derived: if the drag subtracted the
   * sheet's pitch from the globe's pose, `view.center` would drift on every
   * pointer move.
   */
  it("globe: a drag straight after a sheet -> globe transition still reports the centre at the grid centre", () => {
    const { map, host, done } = mount({
      view: { center: [10, 15], span: 200, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 40,
      maxSpan: 720,
    });
    expect(map.getTilt()).toBe(40);

    void map.setProjection(glyphMapGlobe({ exaggeration: 0 }), { durationMs: 0 });
    // The globe's own ceiling at this span is well under the sheet's 40 —
    // otherwise this passes without exercising the hand-over.
    expect(map.getTilt()).toBeLessThan(40);
    expect(map.getTilt()).toBeCloseTo(map.getMaxTilt(), 9);

    fire(host, "pointerdown", 200, 200, 1);
    for (let i = 0; i < 10; i++) fire(host, "pointermove", 200 + (i + 1) * 6, 200 + (i + 1) * 6, 1);
    fire(host, "pointerup", 260, 260, 1);

    const at = map.project(map.getView().center);
    expect(at.col).toBeCloseTo(COLS / 2, 6);
    expect(at.row).toBeCloseTo(ROWS / 2, 6);
    done();
  });

  /**
   * The SHEET path is the degenerate case of the same rule and must not move
   * a hair: `rotX` IS the tilt, `rotY` is 0, and the target is the projected
   * view centre. Those four numbers fully determine an orthographic render,
   * so pinning them exactly IS the byte-identity claim.
   */
  it("sheet: unchanged — rotX is the tilt itself, target is the projected centre, centre at grid centre", () => {
    const projection = glyphMapEquirectangular();
    // A centre well away from the world origin, so the target assertion has
    // real magnitude on both axes rather than passing on zeros.
    const { map, done } = mount({
      view: { center: [-40, 20], span: 120, cols: COLS, rows: ROWS },
      projection,
      tilt: 40,
      maxSpan: 720,
    });
    expect(map.getView().center[0]).not.toBe(0);
    expect(map.getView().center[1]).not.toBe(0);
    for (const t of [0, 10, 40, 60, 85]) {
      map.setTilt(t);
      expect(map.scene.camera.rotX).toBe(t);
      expect(map.scene.camera.rotY).toBe(0);
      expect(map.getTilt()).toBe(t);
      const [lon, lat] = map.getView().center;
      expect([...map.scene.camera.target]).toEqual([...projection.project(lon, lat, 0)]);
      const at = map.project(map.getView().center);
      expect(at.col).toBeCloseTo(COLS / 2, 6);
      expect(at.row).toBeCloseTo(ROWS / 2, 6);
    }
    done();
  });
});

/**
 * The pitch ceiling.
 *
 * Derivation (see `maxTiltFor` in widget.ts): the pitch at which a view
 * direction stops intersecting a sphere of radius `R` from a camera at
 * altitude `h` is the HORIZON ANGLE `asin(R / (R + h))` — the half-angle of
 * the cone of rays tangent to the sphere. An orthographic camera has no
 * altitude, so the view supplies the only length it has: the world-space
 * half-height of its own frame, `h = (rows * cellHeight / 2) / zoom`.
 */
describe("createGlyphMap — the tilt ceiling is the horizon angle at the view's own scale", () => {
  const globeAt = (span: number, tilt = 0) => mount({
    view: { center: [0, 0], span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 0 }),
    tilt,
  });

  it("grows monotonically as the view narrows, and caps at 85 degrees on a locally flat surface", () => {
    const spans = [360, 140, 40, 12, 3, 0.5, 0.05];
    const limits = spans.map((s) => { const m = globeAt(s); const v = m.map.getMaxTilt(); m.done(); return v; });
    for (let i = 1; i < limits.length; i++) expect(limits[i]).toBeGreaterThan(limits[i - 1]);
    expect(limits[0]).toBeLessThan(25);      // planet scale: small
    expect(limits[limits.length - 1]).toBe(85); // locally flat: the cap
    for (const l of limits) expect(l).toBeLessThanOrEqual(85);
  });

  /**
   * The derivation itself, re-measured through the PUBLIC surface instead of
   * restated from `maxTiltFor`'s arithmetic.
   *
   * `h` — the frame's world half-height, the "altitude" the horizon angle is
   * taken at — is recovered here with no reference to `zoom`, `rows` or
   * `cellHeight` at all: at pitch 0 the camera looks straight down the
   * radius through the view centre, so the world point under the TOP-CENTRE
   * cell sits exactly `h` from that axis. Its perpendicular distance from
   * the axis is that `h`, and `asin(R / (R + h))` must then be the ceiling.
   */
  it("IS the horizon angle asin(R / (R + h)) for the frame's own half-height h", () => {
    const projection = glyphMapGlobe({ exaggeration: 0 });
    for (const span of [40, 12, 3]) {
      const { map, done } = mount({
        view: { center: [0, 0], span, cols: COLS, rows: ROWS },
        projection,
        tilt: 0,
      });
      const centre = map.getView().center;
      const p = projection.project(centre[0], centre[1], 0);
      const radius = Math.hypot(p[0], p[1], p[2]);
      const axis = p.map((c) => c / radius);

      const top = map.unproject([COLS / 2, 0.5]);
      expect(top).not.toBeNull();
      const w = projection.project(top![0], top![1], 0);
      const along = w[0] * axis[0] + w[1] * axis[1] + w[2] * axis[2];
      // Perpendicular distance from the view axis = the frame's half-height,
      // less the half-cell the sample sits inside.
      const halfHeight = Math.hypot(w[0] - along * axis[0], w[1] - along * axis[1], w[2] - along * axis[2])
        * (ROWS / 2) / (ROWS / 2 - 0.5);

      const expected = (Math.asin(radius / (radius + halfHeight)) * 180) / Math.PI;
      expect(map.getMaxTilt()).toBeCloseTo(expected, 3);
      done();
    }
  });

  /**
   * What the ceiling is FOR. The reported failure is "80 degrees of pitch at
   * world view aims the camera past the limb at empty space"; the ceiling
   * makes that state unreachable, while the pivot itself stays on the globe
   * at the ceiling at every span (a pitch under 90 degrees can never carry
   * the view centre past its own limb, and `unproject` of the middle cell
   * proves it against the real camera).
   */
  it("makes the reported world-view failure unreachable, and never puts the pivot past the limb", () => {
    for (const span of [360, 40, 3]) {
      const { map, done } = globeAt(span);
      map.setTilt(80);
      if (span === 360) expect(map.getTilt()).toBeLessThan(25);
      const middle = map.unproject([COLS / 2, ROWS / 2]);
      expect(middle).not.toBeNull();
      expect(middle![0]).toBeCloseTo(map.getView().center[0], 3);
      expect(middle![1]).toBeCloseTo(map.getView().center[1], 3);
      done();
    }
  });

  it("setTilt beyond the ceiling clamps, and getTilt reports the pitch the camera actually has", () => {
    const { map, done } = globeAt(360);
    const max = map.getMaxTilt();
    map.setTilt(80);
    expect(map.getTilt()).toBeCloseTo(max, 9);
    expect(map.scene.camera.rotX).toBeCloseTo(90 + max, 9); // cameraForCenter(0,0).rotX === 90
    map.setTilt(-80);
    expect(map.getTilt()).toBeCloseTo(-max, 9);
    done();
  });

  /** Mirrors invariant 2: the ceiling is a property of the host's pixel height and the span, never of the grid shape. */
  it("is invariant to cols/rows/cell size for a fixed host pixel height", () => {
    const { map, done } = globeAt(40);
    const before = map.getMaxTilt();
    map.scene.setOptions({ cols: COLS * 2, rows: ROWS * 2 });
    map.setView({});
    expect(map.getMaxTilt()).toBeCloseTo(before, 6);
    done();
  });

  it("a sheet has no limb, so its ceiling is the flat-surface cap at every span", () => {
    for (const span of [360, 40, 1]) {
      const { map, done } = mount({
        view: { center: [0, 0], span, cols: COLS, rows: ROWS },
        projection: glyphMapEquirectangular(),
        tilt: 40,
        maxSpan: 720,
      });
      expect(map.getMaxTilt()).toBe(85);
      done();
    }
  });
});
