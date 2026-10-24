/**
 * A tile sweep that resolves the same tiles must not rebuild a
 * `fill-extrusion` layer. The sweep runs ~180 ms after every gesture, and a
 * rebuild re-meshes every building and recompiles the outline topology from
 * scratch — measured as a ~380 ms stall on release on a braille Buenos Aires
 * view, after every drag and every ctrl-rotate.
 *
 * The layer `filter` is the observable: the sweep runs it over the selected
 * features exactly when it hands them to `rebuild`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
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

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
});

function square(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

/** One whole-world tile holding a block of buildings, at every zoom the sweep may pick. */
function buildingsProvider(): GlyphMapVectorProvider {
  const zooms = Array.from({ length: 15 }, (_, z) => ({
    z, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 32, tileRows: 32,
  }));
  const bounds = () => ({ west: -180, east: 180, south: -90, north: 90 });
  const buildings: GlyphMapVectorFeature[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    buildings.push({ id: `b${i}${j}`, geometryType: "polygon", rings: [square(CENTRE[0] + (i - 1.5) * 0.0008, CENTRE[1] + (j - 1.5) * 0.0006, 0.0002)], properties: { render_height: 30 } });
  }
  return {
    id: "sweep-skip-buildings",
    zooms,
    bounds,
    async loadTile(z, x, y) {
      return { z, x, y, bounds: bounds(), layers: { building: buildings }, source: "sweep-skip", simplify: "none" };
    },
  };
}

describe("a fill-extrusion layer across a sweep that resolves the same tiles", () => {
  it("does not rebuild its buildings", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, {
      view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt: 40,
    });
    try {
      let filtered = 0;
      map.addLayer({
        id: "buildings", type: "fill-extrusion", source: buildingsProvider(), sourceLayer: "building",
        color: "#94a3b8", heightProperty: "render_height", outline: "braille", fill: false, blank: true,
        filter: () => { filtered++; return true; },
      });
      await map.idle();
      const afterMount = filtered;
      expect(afterMount).toBeGreaterThan(0);

      map.setView({ center: [CENTRE[0] + SPAN * 0.02, CENTRE[1]] });
      await map.idle();

      expect(filtered).toBe(afterMount);
    } finally {
      map.destroy();
      host.remove();
    }
  });
});
