import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import type { GlyphMapLayer } from "./widget";
import { glyphMapEquirectangular, glyphMapMercator } from "./projection";
import type { GlyphMapProjection } from "./projection";
import type { CellGrid } from "glyphcss";
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

async function mount(center: [number, number], extra: GlyphMapLayer[] = [], base: GlyphMapLayer[] = layers, projection: GlyphMapProjection = glyphMapEquirectangular()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMetrics(host);
  const map = createGlyphMap(host, {
    view: { center, span: 20, cols: COLS, rows: ROWS },
    projection,
    tilt: 0,
    layers: [...extra, ...base],
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

// Byte identity, not just render counts: every grid the next frame is built
// from (text, colour AND depth). The first entry is the frame as the sweeps left
// it, so call this once per map, last: its own `setOptions` schedules a repaint.
function snapshot(map: ReturnType<typeof createGlyphMap>): string[] {
  // What the settled map PAINTED, before the re-render below could repair it.
  const grids: string[] = [map.scene.output.parentElement!.innerHTML];
  const keep = (g: CellGrid, kind: string) => grids.push(JSON.stringify({
    kind, cols: g.cols, rows: g.rows, char: g.char, color: g.color,
    depth: Array.from(g.depth, (d) => (Number.isFinite(d) ? d : String(d))),
  }));
  // The map's own hook composites its stroke layers: wrap it, and put it back.
  const own = map.scene.getOptions().transformCells;
  map.scene.setOptions({ transformCells: (g, layer) => {
    const out = own?.(g, layer) ?? g;
    keep(out, layer?.viewport ? "viewport" : layer?.detail ? "detail" : "base");
    return out;
  } });
  map.scene.rerender();
  map.scene.setOptions({ transformCells: own });
  grids.push(map.scene.output.parentElement!.innerHTML);
  return grids;
}

const terrain: GlyphMapProvider = {
  id: "synthetic-terrain",
  zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
  bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
  loadTile: async (): Promise<GlyphMapGeoTile> => ({
    bounds: { west: -180, east: 180, south: -90, north: 90 }, cols: 2, rows: 2,
    elevation: new Float32Array(9).fill(100), source: "synthetic", sampler: "nearest",
  }),
};
const moved: [number, number] = [A[0] + 0.3, A[1]];

describe("createGlyphMap — skipped sweeps leave the frame a fresh map would draw", () => {
  it("after a small move over unchanged tiles", async () => {
    const map = await mount(A);
    map.setView({ center: moved });
    await map.idle();
    const reference = snapshot(await mount(moved));
    const settled = snapshot(map);
    expect(settled.length).toBeGreaterThan(0);
    expect(settled).toEqual(reference);
  });

  it("when a ground arrives under fills whose tile set did not change", async () => {
    const map = await mount(A);
    map.addLayer({ type: "raster", source: terrain });
    map.setView({ center: moved });
    await map.idle();
    const withGround = snapshot(map);
    expect(withGround).toEqual(snapshot(await mount(moved, [{ type: "raster", source: terrain }])));
    expect(withGround).not.toEqual(snapshot(await mount(moved)));
  });

  it("after a layer's source is replaced by one that draws nothing", async () => {
    const map = await mount(A);
    const empty: GlyphMapVectorProvider = { ...provider, id: "empty", loadTile: async (z, x, y) => ({ ...(await provider.loadTile(z, x, y)), layers: {} }) };
    for (const id of ["water", "buildings", "roads"]) map.setLayerSource(id, empty);
    await map.idle();
    const reference = snapshot(await mount(A, [], layers.map((l) => ({ ...l, source: empty }) as GlyphMapLayer)));
    const settled = snapshot(map);
    expect(settled).toEqual(reference);
    expect(map.scene.output.textContent).not.toMatch(/[⠁-⣿]/u);
  });

  it("when a stroke layer's replacement source draws nothing and no other layer repaints", async () => {
    // A static fill underlay never sweeps, so only the road's own sweep can repaint.
    const under: GlyphMapLayer = { type: "fill", id: "under", color: "#2060a0", source: { features: [
      { geometryType: "polygon", rings: [[[-30, 2], [-15, 2], [-15, 20], [-30, 20], [-30, 2]]] }] } };
    const road = layers[2]!;
    const empty: GlyphMapVectorProvider = { ...provider, id: "empty", loadTile: async (z, x, y) => ({ ...(await provider.loadTile(z, x, y)), layers: {} }) };
    const map = await mount(A, [], [under, road]);
    const inked = map.scene.output.parentElement!.innerHTML;
    map.setLayerSource("roads", empty);
    await map.idle();
    const settled = snapshot(map);
    expect(settled).toEqual(snapshot(await mount(A, [], [under, { ...road, source: empty } as GlyphMapLayer])));
    expect(settled[0]).not.toBe(inked);
  });

  it("after a source replacement that keeps a layer's tiles drawable", async () => {
    const map = await mount(A);
    const fatter: GlyphMapVectorProvider = { ...provider, id: "fatter", loadTile: async (z, x, y) => {
      const tile = await provider.loadTile(z, x, y);
      return { ...tile, layers: { ...tile.layers, buildings: tile.layers.buildings!.map((f) => ({ ...f, rings: f.rings.map((r) => r.map(([lon, lat]) => [lon * 1.0, lat * 1.0 + (lat > 0 ? 1 : -1)] as [number, number])) })) } };
    } };
    map.setLayerSource("buildings", fatter);
    map.setView({ center: moved });
    await map.idle();
    const reference = snapshot(await mount(moved, [], layers.map((l) => (l.id === "buildings" ? { ...l, source: fatter } : l) as GlyphMapLayer)));
    expect(snapshot(map)).toEqual(reference);
  });

  it("across a projection change", async () => {
    const map = await mount(A);
    await map.setProjection(glyphMapMercator(), { durationMs: 0 });
    await map.idle();
    map.setView({ center: moved });
    await map.idle();
    const settled = snapshot(map);
    expect(settled).toEqual(snapshot(await mount(moved, [], layers, glyphMapMercator())));
  });
});

describe("createGlyphMap — a filter that closes over mutable state is re-run by every sweep", () => {
  const fill = (keep: { on: boolean }): GlyphMapLayer[] =>
    [{ type: "fill", id: "buildings", source: provider, sourceLayer: "buildings", color: "#a08060", filter: () => keep.on }];
  const line = (keep: { on: boolean }): GlyphMapLayer[] =>
    [layers[0]!, { type: "line", id: "roads", source: provider, sourceLayer: "roads", color: "#ffffff", experimentalGlyphStrategy: "braille", filter: () => keep.on }];
  /** Inked cells over every output `<pre>`: a stroke layer paints its own overlay, not the base text. */
  const ink = (map: ReturnType<typeof createGlyphMap>) => [...(map.scene.output.parentElement!.textContent ?? "")].filter((c) => c.trim() !== "").length;

  // A stroke layer needs a surface to depth-test against, so the line case keeps a fill beneath it.
  for (const [name, make, others] of [["fill", fill, []], ["line", line, [layers[0]!]]] as const) {
    it(`drops the ${name} ink of a layer whose filter turned false, as a fresh map does`, async () => {
      const keep = { on: true };
      const map = await mount(A, [], make(keep));
      const inked = map.scene.output.parentElement!.innerHTML;
      const before = ink(map);
      expect(before).toBeGreaterThan(ink(await mount(A, [], [...others])));
      keep.on = false;
      map.setView({ center: moved });
      await map.idle();
      const settled = snapshot(map);
      expect(settled).toEqual(snapshot(await mount(moved, [], make(keep))));
      expect(settled[0]).not.toBe(inked);
      expect(ink(map)).toBe(ink(await mount(moved, [], [...others])));
      expect(ink(map)).toBeLessThan(before);
    });
  }
});
