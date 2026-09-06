/**
 * The tilt GESTURE — Ctrl+drag and right-button drag pitch the camera.
 *
 * Tilt existed only as `setTilt`, reachable on `/maps` from one slider inside
 * a collapsible Dock that readers did not find. Every major map (Google,
 * Mapbox, MapLibre, Cesium) converged on the same binding for it, so this is
 * what hands already expect: hold Ctrl (or press the right button) and drag
 * VERTICALLY to pitch.
 *
 * Three properties this file pins, each of which has a way of silently going
 * wrong:
 *
 *  1. The gesture actually pitches, and PLAIN drag still pans/orbits — the
 *     failure mode is a modifier check that swallows the ordinary drag.
 *  2. The ceiling holds LIVE. `getMaxTilt()` is a function of the view's own
 *     scale (~21 degrees at a whole-world span), so a gesture that wrote
 *     `camera.rotX` directly would sail past it and aim the camera at empty
 *     space beyond the limb.
 *  3. The clamp is NON-DESTRUCTIVE across a zoom: a pitch asked for at close
 *     range survives a zoom out that cannot honour it, and comes back on the
 *     way in. This is `setTilt`'s existing `tiltRequest`/`appliedTilt` split
 *     and the gesture has to go through it, not around it.
 *
 * Fixture traps (shared with `widget.tiltPivot.test.ts`): happy-dom has no
 * layout, so `getBoundingClientRect` is stubbed to give the widget real cell
 * metrics; and `sin(180 - L) === sin(L)` means a far-side point shares its
 * near-side twin's COLUMN, so positional assertions are keyed on the ROW.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLYPH_MAP_TILT_DRAG_DEG_PER_PX, createGlyphMap } from "./widget";
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

interface FireOpts { readonly ctrlKey?: boolean; readonly button?: number; readonly pointerId?: number }

function fire(host: HTMLElement, type: string, x: number, y: number, o: FireOpts = {}): PointerEvent {
  const e = new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: o.pointerId ?? 1, bubbles: true, cancelable: true,
    ctrlKey: o.ctrlKey ?? false, button: o.button ?? 0,
  });
  host.dispatchEvent(e);
  return e;
}

/** One complete vertical gesture, `dy` pixels, under whatever modifier `o` names. */
function verticalDrag(host: HTMLElement, dy: number, o: FireOpts = {}): void {
  fire(host, "pointerdown", 400, 300, o);
  fire(host, "pointermove", 400, 300 + dy, o);
  fire(host, "pointerup", 400, 300 + dy, o);
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

describe("createGlyphMap — Ctrl/right-button drag pitches the camera", () => {
  it("Ctrl+drag UP increases pitch by the documented degrees-per-pixel", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    // A 12-degree span has plenty of headroom, so nothing here is clamped.
    expect(map.getMaxTilt()).toBeGreaterThan(40);

    verticalDrag(host, -40, { ctrlKey: true });

    expect(map.getTilt()).toBeCloseTo(40 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    done();
  });

  it("drag DOWN decreases it, and the two are exact inverses", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 30,
    });
    verticalDrag(host, 20, { ctrlKey: true });
    expect(map.getTilt()).toBeCloseTo(30 - 20 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    verticalDrag(host, -20, { ctrlKey: true });
    expect(map.getTilt()).toBeCloseTo(30, 6);
    done();
  });

  it("the RIGHT button drags pitch too, with no modifier held", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    verticalDrag(host, -30, { button: 2 });
    expect(map.getTilt()).toBeCloseTo(30 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    done();
  });

  it("PLAIN drag is untouched: it still pans/orbits and never pitches", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 17,
    });
    const before = map.getView().center;
    verticalDrag(host, -40);
    expect(map.getTilt()).toBe(17);
    // ...and it really did move the map, so this is not passing vacuously.
    expect(map.getView().center[1]).not.toBeCloseTo(before[1], 6);
    done();
  });

  it("a tilt gesture leaves view.center exactly where it was", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    const before = map.getView().center;
    verticalDrag(host, -60, { ctrlKey: true });
    expect(map.getTilt()).toBeGreaterThan(1);
    expect(map.getView().center[0]).toBeCloseTo(before[0], 10);
    expect(map.getView().center[1]).toBeCloseTo(before[1], 10);
    // The pivot still holds: the centre is still AT the centre of the grid.
    const at = map.project(map.getView().center);
    expect(at.row).toBeCloseTo(ROWS / 2, 6);
    done();
  });

  it("the gesture clamps to the LIVE getMaxTilt() at a whole-world view", () => {
    const { map, host, done } = mount({
      view: { center: [0, 20], span: 360, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    const ceiling = map.getMaxTilt();
    // The world view's horizon ceiling is far below the flat-surface cap —
    // otherwise this test would not be testing the clamp at all.
    expect(ceiling).toBeLessThan(40);

    // 600px up asks for 300 degrees of pitch.
    fire(host, "pointerdown", 400, 600, { ctrlKey: true });
    for (let y = 590; y >= 0; y -= 10) fire(host, "pointermove", 400, y, { ctrlKey: true });
    fire(host, "pointerup", 400, 0, { ctrlKey: true });

    expect(map.getTilt()).toBeCloseTo(ceiling, 6);
    expect(map.getTilt()).toBeLessThanOrEqual(ceiling);
    done();
  });

  it("the clamp is non-destructive: a pitch asked for close in survives a zoom out and comes back", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    verticalDrag(host, -100, { ctrlKey: true });
    const asked = map.getTilt();
    expect(asked).toBeCloseTo(50, 6);

    // Out to a whole-world view: the ceiling drops under the ask.
    map.setView({ span: 360 });
    expect(map.getMaxTilt()).toBeLessThan(asked);
    expect(map.getTilt()).toBeCloseTo(map.getMaxTilt(), 6);

    // ...and back in restores it. The request was remembered, not clipped.
    map.setView({ span: 12 });
    expect(map.getTilt()).toBeCloseTo(asked, 6);
    done();
  });

  it("has no DEAD TRAVEL against the ceiling: a downward nudge moves the picture immediately", () => {
    const { map, host, done } = mount({
      view: { center: [0, 20], span: 360, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    const ceiling = map.getMaxTilt();

    // Ask for far more pitch than this view can honour — 300 degrees of it.
    fire(host, "pointerdown", 400, 600, { ctrlKey: true });
    for (let y = 590; y >= 0; y -= 10) fire(host, "pointermove", 400, y, { ctrlKey: true });
    fire(host, "pointerup", 400, 0, { ctrlKey: true });
    expect(map.getTilt()).toBeCloseTo(ceiling, 6);

    // Now nudge DOWN by 10px. If the gesture accumulated from the remembered
    // REQUEST rather than from the pitch actually in force, the request would
    // be sitting at 85 and this stroke would have to walk it 128px back down
    // before anything on screen moved at all.
    verticalDrag(host, 10, { ctrlKey: true });
    expect(map.getTilt()).toBeCloseTo(ceiling - 10 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    done();
  });

  it("works on a SHEET projection too, up to the flat-surface cap", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular({ exaggeration: 0 }),
      tilt: 40,
    });
    expect(map.getMaxTilt()).toBe(85);
    verticalDrag(host, -20, { ctrlKey: true });
    expect(map.getTilt()).toBeCloseTo(40 + 20 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    expect(map.scene.camera.rotX).toBeCloseTo(map.getTilt(), 10);
    done();
  });

  it("`controls.tilt: false` opts out, leaving plain drag working", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 12,
      controls: { tilt: false },
    });
    verticalDrag(host, -40, { ctrlKey: true });
    expect(map.getTilt()).toBe(12);

    const before = map.getView().center[1];
    verticalDrag(host, -40);
    expect(map.getView().center[1]).not.toBeCloseTo(before, 6);
    done();
  });

  it("`controls.drag: false` still allows the tilt gesture — they are separate surfaces", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
      controls: { drag: false },
    });
    const before = map.getView().center[1];
    verticalDrag(host, -40, { ctrlKey: true });
    expect(map.getTilt()).toBeCloseTo(20, 6);
    expect(map.getView().center[1]).toBeCloseTo(before, 10);
    done();
  });

  it("suppresses the context menu over the host, so a right-drag never opens one", () => {
    const { host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
    });
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    host.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    done();
  });

  it("a tilt pointerdown is defaultPrevented, so the drag cannot select text", () => {
    const { host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
    });
    const tilt = fire(host, "pointerdown", 400, 300, { ctrlKey: true });
    expect(tilt.defaultPrevented).toBe(true);
    fire(host, "pointerup", 400, 300, { ctrlKey: true });
    // A plain drag is left alone — `preventDefault` there would be a
    // behaviour change nobody asked for.
    const plain = fire(host, "pointerdown", 400, 300);
    expect(plain.defaultPrevented).toBe(false);
    fire(host, "pointerup", 400, 300);
    done();
  });

  it("a tilt gesture emits `move`, so a host UI showing the pitch can follow it", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    let moves = 0;
    map.on("move", () => { moves += 1; });
    verticalDrag(host, -20, { ctrlKey: true });
    expect(moves).toBeGreaterThan(0);
    done();
  });

  it("a tilt gesture never emits `click`, and never flings the map into a glide", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    let clicks = 0;
    map.on("click", () => { clicks += 1; });
    fire(host, "pointerdown", 400, 300, { ctrlKey: true });
    fire(host, "pointerup", 400, 300, { ctrlKey: true });
    expect(clicks).toBe(0);

    // A fast release must not throw the map: pitch has no inertia.
    const centerBefore = map.getView().center[1];
    verticalDrag(host, -60, { ctrlKey: true });
    const afterRelease = map.getView().center[1];
    expect(afterRelease).toBeCloseTo(centerBefore, 10);
    done();
  });

  it("renders at most one frame per gesture burst — the tilt gesture uses the shared motion loop", () => {
    const { map, host, done } = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    // `requestAnimationFrame` exists in happy-dom, so the motion loop is live
    // and defers the repaint; a second render path would repaint per event.
    const spy = vi.spyOn(map.scene, "rerender");
    fire(host, "pointerdown", 400, 300, { ctrlKey: true });
    for (let i = 1; i <= 20; i += 1) fire(host, "pointermove", 400, 300 - i, { ctrlKey: true });
    expect(spy).not.toHaveBeenCalled();
    // State is still exactly current — only the paint is deferred.
    expect(map.getTilt()).toBeCloseTo(20 * GLYPH_MAP_TILT_DRAG_DEG_PER_PX, 6);
    fire(host, "pointerup", 400, 280, { ctrlKey: true });
    done();
  });
});
