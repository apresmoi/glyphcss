// @vitest-environment happy-dom
/**
 * BEARING — the compass heading, and the one thing about it that is easy to
 * get wrong.
 *
 * Bearing is a rotation about the SURFACE NORMAL AT THE PIVOT (the point
 * `tilt` already pitches about), NOT a roll about the view axis. The two
 * models are IDENTICAL at zero pitch, which is exactly why the wrong one
 * ships: it only diverges once the camera is tilted, and tilted is the case
 * bearing exists for. A view-axis roll TIPS THE HORIZON — the map leans
 * sideways — and no map product does that.
 *
 * So the first test here is a DISCRIMINATOR, not a smoke test: at a nonzero
 * pitch, applying a bearing must leave the screen-space direction of local
 * "up" at the pivot exactly where it was, while the heading changes. A roll
 * fails the first clause; a rotation about the normal passes both, because
 * `up` IS the rotation's own axis (`M = E * Rot(up, -bearing)` gives
 * `M * up = E * up` identically).
 *
 * The second load-bearing property is the OTHER direction: bearing `0` must
 * be bit-for-bit the map that existed before this feature. That is the
 * overwhelmingly common case, so `camera.useMat` has to stay `false` there
 * and every derived quantity — the render string, `project()`, the cover
 * ceiling, the headlight — has to come out identical.
 *
 * Fixture traps (shared with `widget.tiltGesture.test.ts`): happy-dom has no
 * layout, so `getBoundingClientRect` is stubbed to give the widget real cell
 * metrics; and `sin(180 - L) === sin(L)` means a far-side point shares its
 * near-side twin's COLUMN, so positional assertions are keyed on the ROW.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GLYPH_MAP_BEARING_DRAG_DEG_PER_PX,
  createGlyphMap,
  glyphMapHeadlightDirection,
  glyphMapNormalizeBearing,
} from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator } from "./projection";
import type { GlyphMapProjection } from "./projection";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const CELL_ASPECT = CELL_W / CELL_H;

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

interface FireOpts { readonly ctrlKey?: boolean; readonly button?: number }

function fire(host: HTMLElement, type: string, x: number, y: number, o: FireOpts = {}): void {
  host.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true,
    ctrlKey: o.ctrlKey ?? false, button: o.button ?? 0,
  }));
}

/** One complete drag, `(dx, dy)` pixels, under whatever modifier `o` names. */
function drag(host: HTMLElement, dx: number, dy: number, o: FireOpts = {}): void {
  fire(host, "pointerdown", 400, 300, o);
  fire(host, "pointermove", 400 + dx, 300 + dy, o);
  fire(host, "pointerup", 400 + dx, 300 + dy, o);
}

/**
 * The screen-space direction, in degrees, of LOCAL UP at the view centre.
 *
 * Measured through the projection's own elevation axis (a point one
 * kilometre above the pivot) and glyphcss's real camera — `map.scene.camera`
 * is a documented escape hatch, and the widget's whole bearing mechanism is
 * `camera.mat`, so reading the camera is reading the thing under test rather
 * than a reimplementation of it. Only the DIFFERENCE from the pivot's own
 * projection is used, so the grid metrics cancel.
 */
function upScreenAngle(map: ReturnType<typeof createGlyphMap>, proj: GlyphMapProjection): number {
  const [lon, lat] = map.getView().center;
  const cam = map.scene.camera;
  const base = cam.project(proj.project(lon, lat, 0), COLS, ROWS, CELL_ASPECT);
  const lifted = cam.project(proj.project(lon, lat, 1000), COLS, ROWS, CELL_ASPECT);
  // In PIXELS, not cells: a cell is 8x16 here, so an angle taken straight off
  // (col, row) is squashed by the cell aspect and is not the angle a reader
  // sees. Invariance would survive that distortion; "turns by exactly N
  // degrees" would not.
  return (Math.atan2((lifted[1] - base[1]) * CELL_H, (lifted[0] - base[0]) * CELL_W) * 180) / Math.PI;
}

/** The screen-space direction, in degrees, of NORTH at the view centre. `-90` is straight up the screen. */
function northScreenAngle(map: ReturnType<typeof createGlyphMap>): number {
  const [lon, lat] = map.getView().center;
  const here = map.project([lon, lat]);
  const north = map.project([lon, lat + 1]);
  return (Math.atan2((north.row - here.row) * CELL_H, (north.col - here.col) * CELL_W) * 180) / Math.PI;
}

/** Signed difference between two angles, folded into `(-180, 180]`. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

// ── The discriminator ──────────────────────────────────────────────────────

describe("bearing is a rotation about the pivot's surface normal, not a view-axis roll", () => {
  it("at a NONZERO pitch the horizon stays level while the heading turns", () => {
    // The whole test in one line: a roll about the view axis passes the
    // second assertion and fails the first. Only a rotation about the local
    // up passes both.
    const proj = glyphMapGlobe();
    const { map, done } = mount({
      view: { center: [10, 30], span: 60, cols: COLS, rows: ROWS },
      projection: proj,
      tilt: 40,
    });
    expect(map.getTilt()).toBeGreaterThan(20); // the pitch actually took
    const upBefore = upScreenAngle(map, proj);
    const northBefore = northScreenAngle(map);

    map.setBearing(60);

    // 1. THE HORIZON IS LEVEL: local up at the pivot points exactly where it
    //    did. This is the clause a roll cannot satisfy — a roll rotates every
    //    screen direction, up included, by the bearing.
    expect(Math.abs(angleDelta(upScreenAngle(map, proj), upBefore))).toBeLessThan(1e-6);
    // 2. ...and yet the map really did turn.
    expect(Math.abs(angleDelta(northScreenAngle(map), northBefore))).toBeGreaterThan(30);
    done();
  });

  it("holds across the whole range of headings, at pitch and at the pole-ward latitudes", () => {
    const proj = glyphMapGlobe();
    for (const [lon, lat, tilt] of [[0, 0, 25], [-120, 62, 55], [170, -40, 70]] as const) {
      const { map, done } = mount({
        view: { center: [lon, lat], span: 20, cols: COLS, rows: ROWS },
        projection: proj,
        tilt,
      });
      const level = upScreenAngle(map, proj);
      for (const b of [15, 45, 90, 137, 180, 271, 359]) {
        map.setBearing(b);
        expect(Math.abs(angleDelta(upScreenAngle(map, proj), level))).toBeLessThan(1e-6);
      }
      done();
    }
  });

  it("the pivot stays at the centre of the grid at every heading — one camera model, not two", () => {
    // `tilt` already guarantees this (`widget.tiltPivot.test.ts`); bearing
    // turns about the SAME point, so it must not move it either.
    for (const proj of [glyphMapGlobe(), glyphMapEquirectangular()]) {
      const { map, done } = mount({
        view: { center: [-58, -34], span: 25, cols: COLS, rows: ROWS },
        projection: proj,
        tilt: 35,
      });
      for (const b of [0, 30, 90, 200, 330]) {
        map.setBearing(b);
        const p = map.project(map.getView().center);
        expect(p.col).toBeCloseTo(COLS / 2, 6);
        expect(p.row).toBeCloseTo(ROWS / 2, 6);
      }
      done();
    }
  });
});

// ── What the number means ──────────────────────────────────────────────────

describe("bearing semantics", () => {
  it("90 puts EAST at the top of the screen (MapLibre's own convention)", () => {
    const proj = glyphMapEquirectangular();
    const { map, done } = mount({
      view: { center: [0, 0], span: 60, cols: COLS, rows: ROWS },
      projection: proj,
      tilt: 0,
      maxSpan: 360,
    });
    const centre = map.project([0, 0]);
    map.setBearing(90);
    const east = map.project([5, 0]);
    const north = map.project([0, 5]);
    // East is straight up: same column, smaller row.
    expect(east.col).toBeCloseTo(centre.col, 6);
    expect(east.row).toBeLessThan(centre.row);
    // ...and north has gone to the left, not up.
    expect(north.col).toBeLessThan(centre.col);
    expect(north.row).toBeCloseTo(centre.row, 6);
    done();
  });

  it("at zero pitch the picture turns by exactly the bearing, on a sheet and on a globe alike", () => {
    for (const proj of [glyphMapEquirectangular(), glyphMapGlobe()]) {
      const { map, done } = mount({
        view: { center: [0, 15], span: 40, cols: COLS, rows: ROWS },
        projection: proj,
        tilt: 0,
        maxSpan: 360,
      });
      const level = northScreenAngle(map);
      expect(level).toBeCloseTo(-90, 6); // north up to start with
      for (const b of [30, 90, 175, 300]) {
        map.setBearing(b);
        // Growing bearing turns the PICTURE counter-clockwise, so north's
        // screen angle decreases by exactly that many degrees.
        expect(angleDelta(northScreenAngle(map), level - b)).toBeCloseTo(0, 6);
      }
      done();
    }
  });

  it("is reported normalized to [0, 360), and a full turn is exactly zero", () => {
    const { map, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
    });
    expect(map.getBearing()).toBe(0);
    map.setBearing(-90);
    expect(map.getBearing()).toBe(270);
    map.setBearing(720);
    expect(map.getBearing()).toBe(0);
    expect(Object.is(map.getBearing(), -0)).toBe(false);
    map.setBearing(Number.NaN);
    expect(map.getBearing()).toBe(0);
    done();
  });

  it("glyphMapNormalizeBearing is the same rule, exported for a UI that has to agree with it", () => {
    expect(glyphMapNormalizeBearing(0)).toBe(0);
    expect(glyphMapNormalizeBearing(-0)).toBe(0);
    expect(glyphMapNormalizeBearing(360)).toBe(0);
    expect(glyphMapNormalizeBearing(-1)).toBe(359);
    expect(glyphMapNormalizeBearing(361.5)).toBe(1.5);
    expect(glyphMapNormalizeBearing(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("an opening bearing is honoured from the constructor", () => {
    const { map, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
      bearing: 90,
      maxSpan: 360,
    });
    expect(map.getBearing()).toBe(90);
    const centre = map.project([0, 0]);
    expect(map.project([5, 0]).row).toBeLessThan(centre.row);
    done();
  });
});

// ── Bearing 0 is the map that existed before this feature ──────────────────

describe("bearing 0 is byte-identical", () => {
  const scene = { mode: "wireframe" as const, useColors: false };

  function renderOf(map: ReturnType<typeof createGlyphMap>): string {
    map.scene.rerender();
    return map.scene.output.textContent ?? "";
  }

  it("installs no camera matrix at all — the Euler path is untouched", () => {
    const { map, done } = mount({
      view: { center: [12, 44], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 35,
    });
    expect(map.scene.camera.useMat).toBe(false);
    expect(map.scene.camera.mat).toBeNull();
    map.setBearing(45);
    expect(map.scene.camera.useMat).toBe(true);
    // ...and coming back to north-up puts it away again, rather than leaving
    // an identity matrix on the camera for glyphcss to multiply by forever.
    map.setBearing(360);
    expect(map.scene.camera.useMat).toBe(false);
    expect(map.scene.camera.mat).toBeNull();
    done();
  });

  it("renders the same string, projects the same cells and reports the same limits as a map with no bearing at all", () => {
    const view = { center: [-40, 18] as [number, number], span: 55, cols: COLS, rows: ROWS };
    const plain = mount({ view, projection: glyphMapGlobe(), tilt: 30, scene });
    const zero = mount({ view, projection: glyphMapGlobe(), tilt: 30, bearing: 0, scene });
    // ...and a third that has been all the way round and back, so the zero
    // case is proven to be a STATE, not just an untouched initial value.
    const returned = mount({ view, projection: glyphMapGlobe(), tilt: 30, scene });
    returned.map.setBearing(137);
    returned.map.setBearing(0);

    const probes: [number, number][] = [[-40, 18], [0, 0], [-80, 55], [12, -30], [179, 61]];
    for (const other of [zero, returned]) {
      expect(renderOf(other.map)).toBe(renderOf(plain.map));
      expect(other.map.getMaxSpan()).toBe(plain.map.getMaxSpan());
      expect(other.map.getMaxTilt()).toBe(plain.map.getMaxTilt());
      expect(other.map.getTilt()).toBe(plain.map.getTilt());
      for (const p of probes) expect(other.map.project(p)).toEqual(plain.map.project(p));
      for (const cell of [[0, 0], [70, 31], [139, 62]] as const) {
        expect(other.map.unproject(cell)).toEqual(plain.map.unproject(cell));
      }
    }
    plain.done(); zero.done(); returned.done();
  });

  it("a SHEET's cover ceiling is untouched at bearing 0 and TIGHTENS at 45 — a turned viewport reaches further", () => {
    const { map, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: glyphMapMercator(),
      tilt: 40,
    });
    const level = map.getMaxSpan();
    map.setBearing(0);
    expect(map.getMaxSpan()).toBe(level);
    map.setBearing(45);
    // The AABB of a turned rectangle is strictly larger, so the widest span
    // that still COVERS the viewport is strictly smaller. Without this the
    // rule silently under-covers and the map's own corner comes inside the
    // frame — the letterbox the cover rule exists to remove.
    expect(map.getMaxSpan()).toBeLessThan(level * 0.9);
    map.setBearing(360);
    expect(map.getMaxSpan()).toBe(level);
    done();
  });

  it("at the turned cover ceiling every viewport CORNER still lands on the map", () => {
    const { map, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: glyphMapMercator(),
      tilt: 0,
    });
    map.setBearing(45);
    // A hair inside the ceiling: at exactly the limit the corners land ON the
    // domain edge (measured: lat +/-85.0511... , Mercator's own maxLat), which
    // is the cover rule being exact rather than slack, but leaves no room for
    // a float hair. `unproject` returning non-null IS the domain test — the
    // sheet solve answers `null` for a cell outside it.
    map.setView({ span: map.getMaxSpan() * 0.999 });
    for (const cell of [[0, 0], [COLS, 0], [0, ROWS], [COLS, ROWS]] as const) {
      expect(map.unproject(cell), `corner ${cell[0]},${cell[1]} fell off the map`).not.toBeNull();
    }
    done();
  });
});

// ── The drag has to come back through the bearing ──────────────────────────

describe("a drag under a bearing pans the way the picture looks", () => {
  it("ORBIT: at 90 degrees, dragging right moves the centre NORTH, not west", () => {
    const proj = glyphMapGlobe();
    const { map, host, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: proj,
      tilt: 0,
    });
    drag(host, 40, 0);
    const level = map.getView().center;
    expect(level[0]).toBeLessThan(-1); // west, as always
    expect(Math.abs(level[1])).toBeLessThan(1e-6);

    map.setView({ center: [0, 0] });
    map.setBearing(90);
    drag(host, 40, 0);
    const turned = map.getView().center;
    // The SAME stroke, the same magnitude, now spent entirely on latitude:
    // the raw-pixel version would still have moved longitude and the reader
    // would watch the map slide sideways out from under the cursor.
    expect(Math.abs(turned[0])).toBeLessThan(1e-6);
    expect(turned[1]).toBeCloseTo(-level[0], 9);
    done();
  });

  it("SHEET: the same, through the live camera's own basis (no delta rotation there)", () => {
    const { map, host, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
      maxSpan: 360,
    });
    drag(host, 40, 0);
    const level = map.getView().center;
    expect(level[0]).toBeLessThan(-1);

    map.setView({ center: [0, 0] });
    map.setBearing(90);
    drag(host, 40, 0);
    const turned = map.getView().center;
    expect(Math.abs(turned[0])).toBeLessThan(1e-9);
    expect(turned[1]).toBeCloseTo(-level[0], 9);
    done();
  });

  it("the grabbed point keeps following the cursor at an oblique heading", () => {
    // The strongest statement of the whole correction: whatever the heading,
    // the world point under the pointer must move by the pointer's own
    // delta. Checked in SCREEN space, which is where the reader checks it.
    const { map, host, done } = mount({
      view: { center: [0, 0], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 0,
      bearing: 37,
    });
    const grabbed: [number, number] = [2, -1];
    const before = map.project(grabbed);
    drag(host, 24, -13);
    const after = map.project(grabbed);
    // 1% — the orbit drag's own linearization (`degPerPx` is a flat-screen
    // approximation of a spherical step, and always has been), not anything
    // the bearing adds: the same stroke at bearing 0 misses by the same
    // fraction, checked below.
    expect(after.col - before.col).toBeCloseTo(24 / CELL_W, 1);
    expect(after.row - before.row).toBeCloseTo(-13 / CELL_H, 1);

    const level = mount({
      view: { center: [0, 0], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 0,
    });
    const lb = level.map.project(grabbed);
    drag(level.host, 24, -13);
    const la = level.map.project(grabbed);
    expect(Math.abs((after.col - before.col) - 24 / CELL_W))
      .toBeCloseTo(Math.abs((la.col - lb.col) - 24 / CELL_W), 3);
    level.done();
    done();
  });
});

// ── The gesture ───────────────────────────────────────────────────────────

describe("the orient gesture turns as well as pitches", () => {
  const base = {
    view: { center: [0, 0] as [number, number], span: 40, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
    tilt: 0,
  };

  it("Ctrl+drag HORIZONTAL turns the map, at MapLibre's rate and MapLibre's sign", () => {
    const { map, host, done } = mount(base);
    drag(host, 50, 0, { ctrlKey: true });
    // Drag right turns the picture ANTI-clockwise — the near ground, the
    // lower half of the picture the hand is actually on, follows the hand —
    // which INCREASES the heading.
    expect(map.getBearing()).toBeCloseTo(50 * GLYPH_MAP_BEARING_DRAG_DEG_PER_PX, 9);
    done();
  });

  it("the drag and the Dock's `Bearing °` slider turn the map the SAME way", () => {
    // The slider is the identity on the heading and its handle runs 0..360
    // left to right, so pushing it RIGHT raises the bearing. A right-going
    // DRAG has to land on the same camera, or the two controls in the same
    // view move the map opposite ways — which is the complaint, one control
    // over. Compared through `project()` rather than through `getBearing()`,
    // so it is the PICTURE that has to agree, not the number.
    const dragged = mount(base);
    drag(dragged.host, 50, 0, { ctrlKey: true });
    const slid = mount(base);
    slid.map.setBearing(50 * GLYPH_MAP_BEARING_DRAG_DEG_PER_PX);
    const probe: [number, number] = [12, 7];
    const a = dragged.map.project(probe), b = slid.map.project(probe);
    expect(a.col).toBeCloseTo(b.col, 9);
    expect(a.row).toBeCloseTo(b.row, 9);
    // ...and both genuinely turned: agreeing on a map neither of them moved
    // would pass the clause above for free.
    expect(Math.abs(angleDelta(northScreenAngle(dragged.map), -90))).toBeGreaterThan(30);
    slid.done();
    dragged.done();
  });

  it("right-button drag does the same, since on macOS Ctrl+click IS the secondary click", () => {
    const { map, host, done } = mount(base);
    drag(host, -30, 0, { button: 2 });
    expect(map.getBearing()).toBeCloseTo(glyphMapNormalizeBearing(-30 * GLYPH_MAP_BEARING_DRAG_DEG_PER_PX), 9);
    done();
  });

  it("one diagonal stroke does BOTH — no axis lock", () => {
    const { map, host, done } = mount(base);
    drag(host, 40, -20, { ctrlKey: true });
    expect(map.getTilt()).toBeGreaterThan(0);
    expect(map.getBearing()).toBeCloseTo(40 * GLYPH_MAP_BEARING_DRAG_DEG_PER_PX, 9);
    done();
  });

  it("a diagonal stroke costs ONE `move` per pointer event, not one per axis", () => {
    const { map, host, done } = mount(base);
    let moves = 0;
    map.on("move", () => { moves += 1; });
    fire(host, "pointerdown", 400, 300, { ctrlKey: true });
    for (let i = 1; i <= 6; i++) fire(host, "pointermove", 400 + i * 5, 300 - i * 5, { ctrlKey: true });
    fire(host, "pointerup", 430, 270, { ctrlKey: true });
    expect(moves).toBe(6);
    done();
  });

  it("a PLAIN horizontal drag still pans, and leaves the heading alone", () => {
    const { map, host, done } = mount(base);
    drag(host, 50, 0);
    expect(map.getBearing()).toBe(0);
    expect(map.getView().center[0]).toBeLessThan(-1);
    done();
  });

  it("`controls.tilt: false` opts the whole stroke out — both axes of it", () => {
    const { map, host, done } = mount({ ...base, controls: { tilt: false } });
    drag(host, 60, -40, { ctrlKey: true });
    expect(map.getBearing()).toBe(0);
    expect(map.getTilt()).toBe(0);
    done();
  });

  it("state is live per pointermove while the repaint stays on the one motion loop", () => {
    const { map, host, done } = mount(base);
    const renders: number[] = [];
    const original = map.scene.rerender.bind(map.scene);
    vi.spyOn(map.scene, "rerender").mockImplementation(() => { renders.push(1); original(); });
    fire(host, "pointerdown", 400, 300, { ctrlKey: true });
    for (let i = 1; i <= 20; i++) fire(host, "pointermove", 400 + i * 3, 300, { ctrlKey: true });
    fire(host, "pointerup", 460, 300, { ctrlKey: true });
    // The heading is exact and current the instant the last event returns...
    expect(map.getBearing()).toBeCloseTo(60 * GLYPH_MAP_BEARING_DRAG_DEG_PER_PX, 9);
    // ...and not one of those 20 events painted anything (the motion loop's
    // frame does, and no frame ran).
    expect(renders).toHaveLength(0);
    done();
  });
});

// ── The key light follows the camera it is bolted to ───────────────────────

describe("a headlight sees the bearing", () => {
  it("bearing 0 still answers the Euler formula exactly", () => {
    const { map, done } = mount({
      view: { center: [25, 40], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 30,
      keyLight: "headlight",
    });
    const cam = map.scene.camera;
    expect(map.getKeyLightDirection()).toEqual(glyphMapHeadlightDirection(cam.rotX, cam.rotY));
    done();
  });

  it("a turn about the pivot's normal MOVES the view axis, and the light follows it", () => {
    // This is the audit item that had to be re-checked: a view-axis ROLL
    // leaves the axis alone (so a headlight would be bearing-invariant), but
    // a rotation about the surface normal genuinely swings the camera, so
    // reading `rotX`/`rotY` — which the matrix has left behind — would light
    // the map from where the camera used to be.
    const { map, done } = mount({
      view: { center: [25, 40], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 45,
      keyLight: "headlight",
    });
    const before = map.getKeyLightDirection()!;
    map.setBearing(90);
    const after = map.getKeyLightDirection()!;
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(0.1);
    // Still a unit vector — it is a row of a rotation matrix, by construction.
    expect(Math.hypot(after[0], after[1], after[2])).toBeCloseTo(1, 12);
    done();
  });

  it("at zero pitch it does NOT move — there the two models coincide and a roll leaves the axis alone", () => {
    const { map, done } = mount({
      view: { center: [25, 40], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 0,
      keyLight: "headlight",
    });
    const before = map.getKeyLightDirection()!;
    map.setBearing(120);
    const after = map.getKeyLightDirection()!;
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeLessThan(1e-9);
    done();
  });
});

// ── Composition with everything else the camera already does ──────────────

describe("bearing composes", () => {
  it("survives a projection change, and turns about the NEW projection's pivot", () => {
    const proj = glyphMapEquirectangular();
    const { map, done } = mount({
      view: { center: [8, 47], span: 30, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 30,
      bearing: 70,
    });
    return map.setProjection(proj, { durationMs: 0 }).then(() => {
      expect(map.getBearing()).toBe(70);
      const p = map.project(map.getView().center);
      expect(p.col).toBeCloseTo(COLS / 2, 6);
      expect(p.row).toBeCloseTo(ROWS / 2, 6);
      expect(Math.abs(angleDelta(upScreenAngle(map, proj), -90))).toBeLessThan(1e-6);
      done();
    });
  });

  it("a pitch change re-derives the matrix rather than leaving a stale one on the camera", () => {
    const proj = glyphMapGlobe();
    const { map, done } = mount({
      view: { center: [-70, -20], span: 25, cols: COLS, rows: ROWS },
      projection: proj,
      tilt: 0,
      bearing: 110,
    });
    map.setTilt(50);
    // The heading survives the pitch change, the pivot is still the centre,
    // and the horizon at the NEW pitch is level — i.e. up points exactly
    // where it would with no bearing at all. (Comparing against the pitch-0
    // reading would be meaningless: pitching the camera is SUPPOSED to move
    // the screen direction of up. Only bearing must not.)
    expect(map.getBearing()).toBe(110);
    const turned = upScreenAngle(map, proj);
    map.setBearing(0);
    expect(Math.abs(angleDelta(turned, upScreenAngle(map, proj)))).toBeLessThan(1e-6);
    const p = map.project(map.getView().center);
    expect(p.col).toBeCloseTo(COLS / 2, 6);
    expect(p.row).toBeCloseTo(ROWS / 2, 6);
    done();
  });

  it("a wheel zoom keeps the heading and keeps the horizon level", () => {
    const proj = glyphMapGlobe();
    const { map, host, done } = mount({
      view: { center: [140, -35], span: 60, cols: COLS, rows: ROWS },
      projection: proj,
      tilt: 25,
      bearing: 200,
    });
    const level = upScreenAngle(map, proj);
    host.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, bubbles: true, cancelable: true }));
    expect(map.getView().span).toBeLessThan(60);
    expect(map.getBearing()).toBe(200);
    expect(Math.abs(angleDelta(upScreenAngle(map, proj), level))).toBeLessThan(1e-6);
    done();
  });

  it("survives a flyTo and an inertial glide — every camera-writing path re-derives the matrix", async () => {
    vi.useFakeTimers();
    const proj = glyphMapGlobe();
    const { map, host, done } = mount({
      view: { center: [0, 0], span: 50, cols: COLS, rows: ROWS },
      projection: proj,
      tilt: 30,
      bearing: 250,
    });
    const level = upScreenAngle(map, proj);
    await map.flyTo({ center: [120, -20], span: 15 }, { durationMs: 0 });
    expect(map.getBearing()).toBe(250);
    expect(map.getView().center[0]).toBeCloseTo(120, 6);
    expect(Math.abs(angleDelta(upScreenAngle(map, proj), level))).toBeLessThan(1e-6);
    // ...and through a released drag's glide, which re-enters `applyDragState`
    // from the motion loop rather than from a pointer event.
    fire(host, "pointerdown", 400, 300);
    for (let i = 1; i <= 5; i++) fire(host, "pointermove", 400 + i * 8, 300);
    fire(host, "pointerup", 440, 300);
    vi.advanceTimersByTime(200);
    expect(map.getBearing()).toBe(250);
    expect(Math.abs(angleDelta(upScreenAngle(map, proj), level))).toBeLessThan(1e-6);
    vi.useRealTimers();
    done();
  });

  it("emits `move` so a host readout cannot go stale behind the gesture", () => {
    const { map, done } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
    });
    const seen: string[] = [];
    map.on("move", () => seen.push(String(map.getBearing())));
    map.setBearing(33);
    expect(seen).toContain("33");
    done();
  });
});
