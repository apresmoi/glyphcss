/**
 * COVER, NOT CONTAIN — a SHEET projection's map must always fill the
 * viewport.
 *
 * A sheet projection (equirectangular, Mercator, orthographic — anything
 * WITHOUT `cameraForCenter`, selected by capability exactly like every other
 * projection-aware branch in `widget.ts`) draws a finite piece of world. Left
 * unconstrained, both zoom and pan can walk that piece off the viewport and
 * leave the page background showing around it: `maxWheelSpan` used to clamp
 * only to the projection's own `domain` WIDTH (360deg for equirectangular)
 * with an `maxSpan` escape hatch the `/maps` page set to 720 — twice the
 * world's own width — and `applyDrag` clamped only the CENTRE into the
 * domain, which still lets the map's EDGE come inside the viewport.
 *
 * An ORBIT projection (the globe) is deliberately exempt: it legitimately
 * floats in space with background around it, and a drag through the pole is a
 * feature. The exemption is by CAPABILITY, never by `projection.id`.
 *
 * `mockHostRect` (not `stubMonospaceMetrics`) is what these need: happy-dom
 * has no layout, and with `autoSize` off the widget never measures a font —
 * `projectionGrid()` reads the host rect alone, so a mocked host rect makes
 * `map.project`'s cell coordinates and the widget's own cover math agree on
 * one viewport. This mirrors `widget.test.ts`'s round-trip invariants, which
 * use the same helper for the same reason.
 */
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import type { GlyphMapHandle } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator, glyphMapOrthographic } from "./projection";
import type { GlyphMapProjection } from "./projection";

const HOST_W = 1280;
const HOST_H = 720;
const COLS = 160;
const ROWS = 64;

function mockHostRect(host: HTMLElement, width: number, height: number): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

function firePointer(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}

function dispatchWheel(host: HTMLElement, deltaY: number): void {
  host.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0, cancelable: true, bubbles: true }));
}

function mount(projection: GlyphMapProjection, view: { center: [number, number]; span: number }, extra: Record<string, unknown> = {},
  size: { w: number; h: number } = { w: HOST_W, h: HOST_H }): { host: HTMLElement; map: GlyphMapHandle } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mockHostRect(host, size.w, size.h);
  const map = createGlyphMap(host, {
    view: { center: view.center, span: view.span, cols: COLS, rows: ROWS },
    projection,
    ...extra,
  });
  return { host, map };
}

/**
 * The map's own projected extent, in the SAME screen-cell coordinates
 * `map.project` reports — measured end-to-end through the public API over the
 * projection's whole `domain`, never from the widget's internal cover math,
 * so this is an independent witness rather than a restatement of the fix.
 *
 * An axis-aligned bounding box, matching what the implementation guarantees:
 * a projection whose valid region is not a world-space RECTANGLE
 * (orthographic's disc) can never cover a rectangular viewport's corners at
 * any span, so the contract is over the extent's bbox.
 */
function mapExtentCells(map: GlyphMapHandle, projection: GlyphMapProjection): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  const d = projection.domain;
  const N = 48;
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const lon = d.west + ((d.east - d.west) * i) / N;
      const lat = d.south + ((d.north - d.south) * j) / N;
      const p = map.project([lon, lat]);
      if (!Number.isFinite(p.col) || !Number.isFinite(p.row)) continue;
      minCol = Math.min(minCol, p.col); maxCol = Math.max(maxCol, p.col);
      minRow = Math.min(minRow, p.row); maxRow = Math.max(maxRow, p.row);
    }
  }
  return { minCol, maxCol, minRow, maxRow };
}

/** Uncovered viewport margin, in CELLS, on each of the four sides. All four must be 0 for a sheet. */
function uncoveredCells(map: GlyphMapHandle, projection: GlyphMapProjection): { left: number; right: number; top: number; bottom: number; worstFraction: number } {
  const v = map.getView();
  const e = mapExtentCells(map, projection);
  const left = Math.max(0, e.minCol);
  const right = Math.max(0, v.cols - e.maxCol);
  const top = Math.max(0, e.minRow);
  const bottom = Math.max(0, v.rows - e.maxRow);
  return {
    left, right, top, bottom,
    worstFraction: Math.max((left + right) / v.cols, (top + bottom) / v.rows),
  };
}

/** Half a cell of slack: `mapExtentCells` samples the domain on a finite grid. */
const SLACK = 0.5;

function expectCovered(map: GlyphMapHandle, projection: GlyphMapProjection, label: string): void {
  const u = uncoveredCells(map, projection);
  expect(u.left, `${label}: uncovered LEFT margin (cells)`).toBeLessThanOrEqual(SLACK);
  expect(u.right, `${label}: uncovered RIGHT margin (cells)`).toBeLessThanOrEqual(SLACK);
  expect(u.top, `${label}: uncovered TOP margin (cells)`).toBeLessThanOrEqual(SLACK);
  expect(u.bottom, `${label}: uncovered BOTTOM margin (cells)`).toBeLessThanOrEqual(SLACK);
}

const sheets: readonly (readonly [string, (c: readonly [number, number]) => GlyphMapProjection])[] = [
  ["equirectangular", () => glyphMapEquirectangular()],
  ["mercator", () => glyphMapMercator()],
  ["orthographic", (c) => glyphMapOrthographic({ lon0: c[0], lat0: c[1] })],
];

describe("createGlyphMap — a sheet projection covers the viewport at maximum zoom-out", () => {
  for (const [name, make] of sheets) {
    for (const tilt of [0, 40]) {
      it(`${name} (tilt ${tilt}): 200 wheel-out notches leave no background margin`, () => {
        const center: [number, number] = [0, 0];
        const { host, map } = mount(make(center), { center, span: 40 }, { tilt });
        for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
        expectCovered(map, make(center), `${name} tilt ${tilt} max zoom-out (span ${map.getView().span})`);
        map.destroy(); host.remove();
      });
    }
  }

  /**
   * `maxSpan` is the documented "overview margin around the whole
   * projection" opt-out, and margin is exactly what cover removes — the two
   * cannot both hold. This pins that the opt-out is REAL (a consumer asking
   * for 720 still gets 720, `widget.test.ts`'s J3 notch ladder depends on
   * it) and, by the same token, that a page which wants cover must simply
   * not set it — which is why `/maps` no longer does.
   */
  it("an explicit maxSpan is a real opt-out: it keeps the overview margin cover would remove", () => {
    const center: [number, number] = [0, 0];
    const { host, map } = mount(glyphMapEquirectangular(), { center, span: 40 }, { tilt: 40, maxSpan: 720 });
    for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
    expect(map.getView().span).toBe(720);
    expect(map.getMaxSpan()).toBe(720);
    expect(uncoveredCells(map, glyphMapEquirectangular()).worstFraction).toBeGreaterThan(0.1);
    map.destroy(); host.remove();
  });

  it("getMaxSpan reports the live cover limit for a sheet, and the wheel stops exactly there", () => {
    const { host, map } = mount(glyphMapEquirectangular(), { center: [0, 0], span: 40 }, { tilt: 40 });
    const limit = map.getMaxSpan();
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(360); // the old default — the whole world width, which letterboxed
    for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
    expect(map.getView().span).toBeCloseTo(limit, 9);
    map.destroy(); host.remove();
  });

  /**
   * `domainWidth`'s own non-positive fallback is now invisible through a
   * SHEET's wheel clamp (the cover limit is always the tighter of the two),
   * so this is the sheet half of `widget.test.ts`'s domain-fallback test:
   * a broken domain must still resolve to a finite, positive, covered view
   * rather than collapsing or poisoning `camera.zoom`.
   */
  it("a sheet whose projection declares a non-positive domain width still resolves finite and covered", () => {
    const base = glyphMapEquirectangular();
    const projection = { ...base, domain: { west: 170, east: -170, south: -90, north: 90 } };
    const { host, map } = mount(projection, { center: [0, 0], span: 360 }, { tilt: 40 });
    for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
    expect(map.scene.camera.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(map.getView().span)).toBe(true);
    expect(map.getView().span).toBeGreaterThan(0);
    expectCovered(map, projection, "broken-domain sheet");
    map.destroy(); host.remove();
  });
});

describe("createGlyphMap — a sheet projection covers the viewport at every corner of the pan range", () => {
  for (const [name, make] of sheets) {
    for (const tilt of [0, 40]) {
      it(`${name} (tilt ${tilt}): dragging hard into all four corners never uncovers an edge`, () => {
        const center: [number, number] = [0, 0];
        const { host, map } = mount(make(center), { center, span: 40 }, { tilt });
        for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
        const corners: readonly (readonly [number, number])[] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
        for (const [sx, sy] of corners) {
          firePointer(host, "pointerdown", 640, 360, 1);
          for (let i = 1; i <= 20; i++) firePointer(host, "pointermove", 640 + sx * i * 200, 360 + sy * i * 200, 1);
          firePointer(host, "pointerup", 640 + sx * 4000, 360 + sy * 4000, 1);
          expectCovered(map, make(center), `${name} tilt ${tilt} corner ${sx},${sy} (center ${map.getView().center})`);
        }
        map.destroy(); host.remove();
      });
    }
  }

  it("a mid-zoom pan is clamped too, not only the fully zoomed-out one", () => {
    const center: [number, number] = [0, 0];
    const { host, map } = mount(glyphMapEquirectangular(), { center, span: 120 }, { tilt: 40 });
    firePointer(host, "pointerdown", 640, 360, 1);
    for (let i = 1; i <= 40; i++) firePointer(host, "pointermove", 640 - i * 300, 360 - i * 120, 1);
    firePointer(host, "pointerup", 640 - 12_000, 360 - 4800, 1);
    expectCovered(map, glyphMapEquirectangular(), "equirectangular mid-zoom pan");
    map.destroy(); host.remove();
  });
});

describe("createGlyphMap — a span that arrives from outside the widget resolves covered, never letterboxed", () => {
  it("a constructor span far past the cover limit (a stale shared link) clamps on read", () => {
    const { host, map } = mount(glyphMapEquirectangular(), { center: [0, 0], span: 5000 }, { tilt: 40 });
    expect(map.getView().span).toBeLessThan(5000);
    expectCovered(map, glyphMapEquirectangular(), "equirectangular hydrated span 5000");
    map.destroy(); host.remove();
  });

  it("setView with an over-wide span clamps instead of letterboxing", () => {
    const { host, map } = mount(glyphMapEquirectangular(), { center: [0, 0], span: 40 }, { tilt: 40 });
    map.setView({ span: 900 });
    expectCovered(map, glyphMapEquirectangular(), "equirectangular setView span 900");
    map.destroy(); host.remove();
  });

  it("fitBounds on a box wider than the world still covers", () => {
    const { host, map } = mount(glyphMapEquirectangular(), { center: [0, 0], span: 40 }, { tilt: 40 });
    map.fitBounds({ west: -180, east: 180, south: -90, north: 90 });
    expectCovered(map, glyphMapEquirectangular(), "equirectangular fitBounds whole world");
    map.destroy(); host.remove();
  });
});

/**
 * Cover is normally always SATISFIABLE — zooming in far enough fills any
 * viewport — so the genuinely uncoverable case needs a floor that stops the
 * zoom before it gets there. `minSpan` is that floor, and a Mercator cropped
 * to a narrow `maxLat` is the shape: its own north/south window is far
 * shorter than a tall viewport needs at the widest span the floor allows, so
 * the vertical axis can never be filled.
 */
describe("createGlyphMap — the cover rule degrades on an axis the map cannot fill", () => {
  const narrow = () => glyphMapMercator({ maxLat: 5 });

  it("centres the uncoverable axis instead of pinning it to an edge, and settles there", () => {
    const { host, map } = mount(narrow(), { center: [0, 4], span: 100 }, { tilt: 0, minSpan: 100 }, { w: 300, h: 1800 });
    // The floor really does hold the view wider than cover would like.
    expect(map.getMaxSpan()).toBe(100);
    expect(map.getView().span).toBe(100);
    // CENTRED on the axis it cannot fill: equal background above and below,
    // rather than the map jammed against one edge.
    expect(map.getView().center[1]).toBeCloseTo(0, 9);
    const e = mapExtentCells(map, narrow());
    const v = map.getView();
    expect(e.minRow - 0).toBeCloseTo(v.rows - e.maxRow, 6);

    // Drag hard north, then hard south, repeatedly: one stable fixed point,
    // never an oscillation between two clamps.
    const settled: number[] = [];
    for (const dir of [1, -1, 1, -1]) {
      firePointer(host, "pointerdown", 150, 900, 1);
      for (let i = 1; i <= 20; i++) firePointer(host, "pointermove", 150, 900 + dir * i * 300, 1);
      firePointer(host, "pointerup", 150, 900 + dir * 6000, 1);
      settled.push(map.getView().center[1]);
    }
    for (const lat of settled) expect(lat).toBeCloseTo(0, 9);
    map.destroy(); host.remove();
  });

  it("the axis it CAN fill is still covered while the other one is centred", () => {
    const { host, map } = mount(narrow(), { center: [0, 4], span: 100 }, { tilt: 0, minSpan: 100 }, { w: 300, h: 1800 });
    firePointer(host, "pointerdown", 150, 900, 1);
    for (let i = 1; i <= 20; i++) firePointer(host, "pointermove", 150 + i * 300, 900, 1);
    firePointer(host, "pointerup", 150 + 6000, 900, 1);
    const v = map.getView();
    const e = mapExtentCells(map, narrow());
    expect(Math.max(0, e.minCol), "uncovered LEFT margin (cells)").toBeLessThanOrEqual(SLACK);
    expect(Math.max(0, v.cols - e.maxCol), "uncovered RIGHT margin (cells)").toBeLessThanOrEqual(SLACK);
    map.destroy(); host.remove();
  });
});

describe("createGlyphMap — an ORBIT projection is exempt (it legitimately floats in space)", () => {
  it("the globe still reaches its own domain-width max span and is not forced to cover", () => {
    const { host, map } = mount(glyphMapGlobe(), { center: [0, 0], span: 40 }, { tilt: 0 });
    for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
    expect(map.getView().span).toBe(360);
    const u = uncoveredCells(map, glyphMapGlobe());
    expect(u.worstFraction).toBeGreaterThan(0.1);
    map.destroy(); host.remove();
  });

  it("the globe still honours an explicit overview maxSpan past its domain width", () => {
    const { host, map } = mount(glyphMapGlobe(), { center: [0, 0], span: 40 }, { tilt: 0, maxSpan: 720 });
    for (let i = 0; i < 200; i++) dispatchWheel(host, 100);
    expect(map.getView().span).toBe(720);
    map.destroy(); host.remove();
  });

  it("a globe drag past the pole is still unclamped", () => {
    const { host, map } = mount(glyphMapGlobe(), { center: [0, 60], span: 40 }, { tilt: 0 });
    firePointer(host, "pointerdown", 640, 360, 1);
    for (let i = 1; i <= 60; i++) firePointer(host, "pointermove", 640, 360 + i * 30, 1);
    firePointer(host, "pointerup", 640, 360 + 1800, 1);
    // Past the pole the centre longitude flips by 180 — the documented
    // through-pole behaviour, which no cover clamp may take away.
    expect(Math.abs(map.getView().center[0])).toBeGreaterThan(100);
    map.destroy(); host.remove();
  });
});
