/**
 * A tile sweep that resolves the same tiles must not rebuild a
 * `fill-extrusion` layer. The sweep runs ~180 ms after every gesture, and a
 * rebuild re-meshes every building and recompiles the outline topology from
 * scratch — measured as a ~380 ms stall on release on a braille Buenos Aires
 * view, after every drag and every ctrl-rotate.
 *
 * The observable is the height property read: the mesh build reads it once per
 * feature, and nothing else does. The layer `filter` is NOT an observable of a
 * skip: it may close over mutable state, so every sweep re-runs it and compares
 * the selection it makes.
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
function buildingsProvider(heightReads?: { n: number }): GlyphMapVectorProvider {
  const zooms = Array.from({ length: 15 }, (_, z) => ({
    z, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 32, tileRows: 32,
  }));
  const bounds = () => ({ west: -180, east: 180, south: -90, north: 90 });
  const buildings: GlyphMapVectorFeature[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    buildings.push({ id: `b${i}${j}`, geometryType: "polygon", rings: [square(CENTRE[0] + (i - 1.5) * 0.0008, CENTRE[1] + (j - 1.5) * 0.0006, 0.0002)],
      properties: heightReads ? { get render_height() { heightReads.n++; return 30; } } : { render_height: 30 } });
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

const ink = (map: ReturnType<typeof createGlyphMap>) =>
  [...(map.scene.output.parentElement!.textContent ?? "")].filter((c) => c.trim() !== "").length;

function mountExtrusion(keep: { on: boolean }, heightReads: { n: number }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
    tilt: 40,
  });
  map.addLayer({
    id: "buildings", type: "fill-extrusion", source: buildingsProvider(heightReads), sourceLayer: "building",
    color: "#94a3b8", heightProperty: "render_height", outline: "braille", fill: false, blank: true,
    filter: () => keep.on,
  });
  return { map, dispose: () => { map.destroy(); host.remove(); } };
}

describe("a fill-extrusion layer across a sweep that resolves the same tiles", () => {
  it("does not rebuild its buildings while its filter keeps the same selection", async () => {
    const heightReads = { n: 0 };
    const { map, dispose } = mountExtrusion({ on: true }, heightReads);
    try {
      await map.idle();
      const afterMount = heightReads.n;
      expect(afterMount).toBeGreaterThan(0);

      map.setView({ center: [CENTRE[0] + SPAN * 0.02, CENTRE[1]] });
      await map.idle();

      expect(heightReads.n).toBe(afterMount);
    } finally {
      dispose();
    }
  });

  it("drops buildings whose filter turned false across a pan within the cached tiles", async () => {
    const keep = { on: true };
    const { map, dispose } = mountExtrusion(keep, { n: 0 });
    try {
      await map.idle();
      const before = ink(map);
      expect(before).toBeGreaterThan(0);
      keep.on = false;
      map.setView({ center: [CENTRE[0] + SPAN * 0.02, CENTRE[1]] });
      await map.idle();
      const fresh = mountExtrusion({ on: false }, { n: 0 });
      try {
        await fresh.map.idle();
        expect(ink(map)).toBe(ink(fresh.map));
        expect(ink(map)).toBeLessThan(before);
      } finally {
        fresh.dispose();
      }
    } finally {
      dispose();
    }
  });
});
