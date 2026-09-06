// @vitest-environment happy-dom
/**
 * The View folder's readout and its Tilt range, driven through the REAL
 * widget — the assertion is what `@glyphcss/maps` actually reports, never a
 * number this file computes for itself.
 *
 * What went wrong before and is pinned here:
 *
 *  - the page held its own `tilt` and never read it back, so after the
 *    widget clamped a request to the view's horizon ceiling the slider
 *    showed 40 while the camera had 21;
 *  - the Tilt slider's ceiling was a literal (`70` / `89`), so most of its
 *    travel did nothing at a wide span.
 *
 * Fixture trap: happy-dom has no layout, so `getBoundingClientRect` is
 * stubbed to give the widget real cell metrics — without it the horizon
 * ceiling is derived from a zero-height frame.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, glyphMapEquirectangular, glyphMapGlobe, type GlyphMapHandle } from "@glyphcss/maps";
import { mapTiltSliderRange, readMapViewState } from "./mapsView";

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

const maps: GlyphMapHandle[] = [];
const hosts: HTMLElement[] = [];

function mount(opts: Parameters<typeof createGlyphMap>[1]): GlyphMapHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, opts);
  maps.push(map);
  return map;
}

afterEach(() => {
  for (const map of maps.splice(0)) map.destroy();
  for (const host of hosts.splice(0)) host.remove();
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

describe("readMapViewState", () => {
  it("reports the APPLIED tilt, not the request the page last wrote", () => {
    const map = mount({
      view: { center: [0, 20], span: 360, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
      tilt: 0,
    });
    map.setTilt(40);
    // A whole-world view cannot honour 40 degrees — this is exactly the case
    // where a page holding its own copy showed a number the camera did not have.
    expect(map.getMaxTilt()).toBeLessThan(40);
    expect(readMapViewState(map).tilt).toBeCloseTo(map.getTilt(), 12);
    expect(readMapViewState(map).tilt).toBeLessThan(40);
  });

  it("re-reads the tilt CEILING on every sync — it moves with the zoom", () => {
    const map = mount({
      view: { center: [8, 46], span: 360, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
    });
    const wide = readMapViewState(map).maxTilt;
    map.setView({ span: 12 });
    const close = readMapViewState(map).maxTilt;
    expect(close).toBeGreaterThan(wide);
    expect(close).toBeCloseTo(map.getMaxTilt(), 12);
  });

  it("reports the rest of the folder's fields off the same live view", () => {
    const map = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
    });
    const r = readMapViewState(map);
    const v = map.getView();
    expect(r.centerLon).toBe(v.center[0]);
    expect(r.centerLat).toBe(v.center[1]);
    expect(r.span).toBe(v.span);
    expect(r.cols).toBe(v.cols);
    expect(r.rows).toBe(v.rows);
    expect(r.maxSpan).toBe(map.getMaxSpan());
    expect(r.degPerCell).toBeCloseTo(v.span / v.cols, 12);
  });
});

describe("mapTiltSliderRange", () => {
  it("an orbit projection gets the widget's live ceiling, signed", () => {
    const map = mount({
      view: { center: [0, 20], span: 360, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
    });
    const wide = mapTiltSliderRange(true, readMapViewState(map).maxTilt);
    expect(wide.max).toBeCloseTo(map.getMaxTilt(), 12);
    expect(wide.min).toBeCloseTo(-map.getMaxTilt(), 12);
    // The literal this replaced. A world view cannot pitch anywhere near it.
    expect(wide.max).toBeLessThan(70);

    map.setView({ span: 12 });
    const close = mapTiltSliderRange(true, readMapViewState(map).maxTilt);
    expect(close.max).toBeGreaterThan(wide.max);
    expect(close.max).toBeCloseTo(map.getMaxTilt(), 12);
  });

  it("every value the orbit slider offers is one the widget will actually apply", () => {
    const map = mount({
      view: { center: [0, 20], span: 360, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ exaggeration: 0 }),
    });
    const range = mapTiltSliderRange(true, readMapViewState(map).maxTilt);
    for (const ask of [range.min, range.min / 2, 0, range.max / 2, range.max]) {
      map.setTilt(ask);
      expect(map.getTilt()).toBeCloseTo(ask, 9);
    }
  });

  it("a sheet keeps its one-sided shape and takes the flat-surface cap", () => {
    const map = mount({
      view: { center: [8, 46], span: 12, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular({ exaggeration: 0 }),
      tilt: 40,
    });
    const range = mapTiltSliderRange(false, readMapViewState(map).maxTilt);
    expect(range).toEqual({ min: 5, max: 85, step: 1 });
    map.setTilt(range.max);
    expect(map.getTilt()).toBeCloseTo(85, 9);
  });
});
