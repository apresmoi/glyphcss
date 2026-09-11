/**
 * The wall cull's DISTANCE PROOF, end to end through the rendered grid.
 *
 * `syncWalls` re-decides which of a `fill-extrusion`'s walls are inside the
 * walker's local horizon on every camera-moving frame, and that decision is
 * the largest single cost in a walking frame. The shipped fast path caches
 * each wall's distance from an ANCHOR — the walker's position when the cache
 * was built — and rules a wall out with one compare whenever
 * `distanceFromAnchor - metresWalkedSince > far`. Great-circle distance is
 * 1-Lipschitz in the viewer, so that lower bound is exact.
 *
 * Exact in the algebra; the way it goes wrong in code is by forgetting the
 * `- metresWalkedSince` term, or by re-basing the anchor too late, and the
 * symptom is silent and asymmetric: buildings in the band between `far` and
 * `far + walked` stop being drawn for a walker who arrived on foot, while a
 * reader who dropped straight in at the same spot sees them. Nothing throws
 * and the picture just quietly loses a row of the skyline.
 *
 * So the gate is the render itself, at one pose reached two ways: WALKED to,
 * and ENTERED at. The two must be the same text, cell for cell.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapLayer } from "./widget";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];
const METRES_PER_DEGREE = GLYPH_MAP_EARTH_RADIUS_M * (Math.PI / 180);
/** The walker's local horizon for every mount here — the widget's own default is 600 m. */
const FAR_M = 600;

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

/** Metres east/north of an origin, as lon/lat. */
function at(east: number, north: number, origin: readonly [number, number]): [number, number] {
  return [
    origin[0] + east / (METRES_PER_DEGREE * Math.cos(origin[1] * (Math.PI / 180))),
    origin[1] + north / METRES_PER_DEGREE,
  ];
}

function building(origin: readonly [number, number], west: number, east: number, south: number, north: number, height: number) {
  return {
    id: `b-${west}-${south}`,
    geometryType: "polygon" as const,
    rings: [[
      at(west, south, origin), at(east, south, origin), at(east, north, origin),
      at(west, north, origin), at(west, south, origin),
    ] as [number, number][]],
    properties: { render_height: height },
  };
}

/**
 * A corridor of blocks running NORTH from the origin, from inside the horizon
 * to well past it. North because that is the way a walker at `bearing: 0`
 * faces: a block the cull wrongly drops has to be somewhere the camera would
 * otherwise have drawn it, or the render cannot see the difference at all.
 * The depth range is what makes the band between `far` and `far + walked`
 * populated, which is the band the `- walked` term exists for.
 */
function city(origin: readonly [number, number]): GlyphMapLayer {
  const features = [];
  for (let n = 60; n <= 1400; n += 40) {
    for (const e of [-90, -30, 30, 90]) {
      features.push(building(origin, e - 12, e + 12, n - 12, n + 12, 14 + (n % 5) * 7));
    }
  }
  return { type: "fill-extrusion", source: { features }, color: "#cccccc", heightProperty: "render_height" };
}

function mount(layers: GlyphMapLayer[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: [...ZURICH] as [number, number], span: 0.01, cols: COLS, rows: ROWS },
    layers,
  });
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

/** The rendered base grid at a pose the map was PUT at while already walking. */
function textAt(map: ReturnType<typeof createGlyphMap>, center: [number, number]): string {
  map.setView({ center });
  map.setBearing(0);
  map.scene.rerender();
  return map.scene.output.textContent ?? "";
}

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
});

describe("walk wall cull — the distance proof never hides a wall the predicate keeps", () => {
  const layer = city(ZURICH);

  it("renders a pose the same whether the walker WALKED there or ENTERED there", () => {
    // Hops of 100 m, each SHORT of the quarter-horizon (150 m) at which the
    // cache re-bases — so the stale anchor is genuinely what answers, and the
    // blocks between `far` and `far + 100` ahead of the walker are exactly
    // the ones only the `- walked` term keeps.
    const hops: [number, number][] = [
      at(0, 100, ZURICH), at(0, 200, ZURICH), at(0, 260, ZURICH), at(0, 340, ZURICH),
    ];

    const walked = mount([layer]);
    walked.map.setWalk({ far: FAR_M, sky: false });
    walked.map.setBearing(0);
    // One map that visits every hop in sequence, so its anchor is always
    // behind the walker.
    const walkedTexts = hops.map((h) => textAt(walked.map, h));
    walked.done();

    for (let i = 0; i < hops.length; i++) {
      const fresh = mount([layer]);
      fresh.map.setWalk({ far: FAR_M, sky: false });
      fresh.map.setBearing(0);
      const entered = textAt(fresh.map, hops[i]!);
      fresh.done();
      expect(walkedTexts[i]).toBe(entered);
    }
  });

  it("draws a skyline at all — the comparison is not two blank grids", () => {
    const { map, done } = mount([layer]);
    map.setWalk({ far: FAR_M, sky: false });
    map.setBearing(0);
    const text = textAt(map, at(0, 200, ZURICH));
    const ink = text.replace(/[\s\n]/g, "").length;
    expect(ink).toBeGreaterThan(50);
    done();
  });

});
