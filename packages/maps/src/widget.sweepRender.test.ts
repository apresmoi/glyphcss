import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import type { GlyphMapLayer } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

/**
 * A view change owes the scene ONE render, and a settled sweep owes another
 * only when it changed what is drawn. Three vector layers on a cached tile set
 * used to answer one `setView` with four renders: the view's own, then one per
 * layer's sweep, each frame the picture the first already was.
 */

const COLS = 40, ROWS = 20, CELL_W = 8, CELL_H = 16;
const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const hosts = new Set<HTMLElement>();
const maps: ReturnType<typeof createGlyphMap>[] = [];

function stubMetrics(host: HTMLElement): void {
  hosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (hosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return rect(0, 0);
    const k = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16") / 16;
    return rect(CELL_W * k, CELL_H * k * ((el.textContent ?? "").split("\n").length || 1));
  });
}

afterEach(() => {
  maps.splice(0).forEach((m) => m.destroy());
  hosts.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// One zoom, an 8 x 8 grid of 45 x 22.5 degree tiles; every tile carries a road
// across it and a square park, so all three layers always have something to draw.
const LON_SPAN = 45, LAT_SPAN = 22.5;
const provider: GlyphMapVectorProvider = {
  id: "synthetic-vector",
  zooms: [{ z: 3, cols: 8, rows: 8, tileLonSpan: LON_SPAN, tileLatSpan: LAT_SPAN, tileCols: 8, tileRows: 8 }],
  bounds: (_z, x, y) => {
    const west = -180 + x * LON_SPAN, north = 90 - y * LAT_SPAN;
    return { west, east: west + LON_SPAN, south: north - LAT_SPAN, north };
  },
  async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
    const bounds = provider.bounds(z, x, y);
    const midLon = (bounds.west + bounds.east) / 2, midLat = (bounds.south + bounds.north) / 2;
    const road: GlyphMapVectorFeature = { geometryType: "line", rings: [[[bounds.west, midLat], [midLon, midLat + 3], [bounds.east, midLat]]] };
    const square = (r: number, tag: number): GlyphMapVectorFeature => ({
      geometryType: "polygon", properties: { tag },
      rings: [[[midLon - r, midLat - r], [midLon + r, midLat - r], [midLon + r, midLat + r], [midLon - r, midLat + r], [midLon - r, midLat - r]]],
    });
    return { z, x, y, bounds, source: "synthetic", simplify: "none", layers: { roads: [road], water: [square(4, 0)], buildings: [square(2, 1)] } };
  },
};

const layers: GlyphMapLayer[] = [
  { type: "fill", id: "water", source: provider, sourceLayer: "water", color: "#2060a0" },
  { type: "fill", id: "buildings", source: provider, sourceLayer: "buildings", color: "#a08060" },
  { type: "line", id: "roads", source: provider, sourceLayer: "roads", color: "#ffffff", experimentalGlyphStrategy: "braille" },
];

async function mount(center: [number, number], extra: GlyphMapLayer[] = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMetrics(host);
  const map = createGlyphMap(host, {
    view: { center, span: 20, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    layers: [...extra, ...layers],
  });
  maps.push(map);
  await map.idle();
  return map;
}

const A: [number, number] = [-22.5, 11.25];
const B: [number, number] = [112.5, -33.75];

describe("createGlyphMap — a settled sweep renders only what changed", () => {
  it("settles a view change that resolves the same tiles with the one render setView made", async () => {
    const map = await mount(A);
    const rerender = vi.spyOn(map.scene, "rerender");
    map.setView({ center: [A[0] + 0.3, A[1]] });
    const painted = map.scene.output.textContent;
    expect(rerender).toHaveBeenCalledTimes(1);
    await map.idle();
    expect(rerender).toHaveBeenCalledTimes(1);
    expect(map.scene.output.textContent).toBe(painted);
    expect(painted).toMatch(/[⠁-⣿]/u);
  });

  it("still draws a different tile set, and draws it as a fresh map would", async () => {
    const map = await mount(A);
    map.setView({ center: B });
    await map.idle();
    const fresh = await mount(B);
    expect(map.scene.output.textContent).toBe(fresh.scene.output.textContent);
  });

  it("rebuilds an unchanged tile set's fills only where a ground gives their drape a lift", async () => {
    const rebuilt = async (extra: GlyphMapLayer[]) => {
      const map = await mount(A, extra);
      const add = vi.spyOn(map.scene, "add");
      map.setView({ center: [A[0] + 0.3, A[1]] });
      await map.idle();
      return add.mock.calls.length;
    };
    const terrain: GlyphMapProvider = {
      id: "synthetic-terrain",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: async (): Promise<GlyphMapGeoTile> => ({
        bounds: { west: -180, east: 180, south: -90, north: 90 }, cols: 2, rows: 2,
        elevation: new Float32Array(9).fill(100), source: "synthetic", sampler: "nearest",
      }),
    };
    expect(await rebuilt([])).toBe(0);
    expect(await rebuilt([{ type: "raster", source: terrain }])).toBeGreaterThan(0);
  });
});
