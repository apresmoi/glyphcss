import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapHandle, type GlyphMapLineLayer } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { countries } from "./vector/sharedArcs.fixture";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";
import * as stroke from "./stroke";
import * as arcs from "./vector/sharedArcs";

const maps: GlyphMapHandle[] = [];
const hosts: HTMLElement[] = [];
function mount(layer: Partial<GlyphMapLineLayer> = {}) {
  const host = document.createElement("div");
  document.body.append(host); hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [0.3, 0], span: 80, cols: 80, rows: 40 },
    projection: glyphMapEquirectangular(), tilt: 0,
    layers: [{ type: "line", id: "borders", source: { features: countries }, sharedArcs: true, simplify: "vw", experimentalGlyphStrategy: "box", ...layer }],
  });
  maps.push(map);
  return map;
}
afterEach(() => { maps.splice(0).forEach(map => map.destroy()); hosts.splice(0).forEach(host => host.remove()); vi.restoreAllMocks(); });

describe("line-layer shared arcs", () => {
  it("renders adjacent polygon borders once, including coarse simplification", async () => {
    for (const span of [40, 160]) {
      const map = mount();
      map.setView({ span });
      await map.idle();
      const calls: Parameters<typeof stroke.stampGlyphMapPolyline>[] = [];
      const spy = vi.spyOn(stroke, "stampGlyphMapPolyline");
      map.scene.rerender();
      calls.push(...spy.mock.calls); spy.mockRestore();
      expect(calls).toHaveLength(3);
      const graph = calls[0]![2]!.boxGraph!;
      expect(calls.every(call => call[2]!.boxGraph === graph)).toBe(true);
      const rows = map.scene.output.textContent!.split("\n");
      // Interior of the shared boundary: no other country edges are here.
      const middle = rows.slice(19, 22).map(row => row.slice(38, 42));
      expect(middle.map(row => row.replaceAll(" ", "").length)).toEqual([1, 1, 1]);
      expect(middle.every(row => /│/.test(row))).toBe(true);
      expect(map.scene.output.textContent).toContain("┬");
      expect(map.scene.output.textContent).toContain("┴");
    }
  });

  it("reuses source topology and VW buckets across frames, invalidating on replacement", async () => {
    const factory = arcs.createGlyphMapSharedArcCache;
    const cached = vi.fn(factory());
    vi.spyOn(arcs, "createGlyphMapSharedArcCache").mockReturnValue(cached);
    const map = mount();
    await map.idle();
    const first = cached.mock.results[0]!.value;
    map.setView({ center: [1, 0] });
    await map.idle();
    expect(cached.mock.results.every(result => result.value === first)).toBe(true);
    cached.mockClear(); map.scene.rerender();
    expect(cached).not.toHaveBeenCalled();
    map.setLayerSource("borders", { features: [{ rings: [[[-8, 4], [8, 4]]] }] });
    await map.idle();
    expect(cached.mock.results.at(-1)!.value).not.toBe(first);
    expect(map.scene.output.textContent).not.toMatch(/[┬┴]/);
  });

  it("caches each tile's selected topology and joins paths across a tile seam", async () => {
    const factory = arcs.createGlyphMapSharedArcCache;
    const cached = vi.fn(factory());
    vi.spyOn(arcs, "createGlyphMapSharedArcCache").mockReturnValue(cached);
    const bounds = (_z: number, x: number) => ({ west: x ? 0 : -180, east: x ? 180 : 0, south: -90, north: 90 });
    const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapVectorTile> => ({
      z, x, y, bounds: bounds(z, x), source: "fixture", simplify: "none",
      layers: { borders: [{ rings: x === 0 ? [[[-8, 0], [0, 0]]] : [[[0, 0], [8, 0]], [[0, 0], [0, -6]]] }] },
    }));
    const provider: GlyphMapVectorProvider = {
      id: "two-tiles", zooms: [{ z: 0, cols: 2, rows: 1, tileLonSpan: 180, tileLatSpan: 180, tileCols: 180, tileRows: 180 }], bounds, loadTile,
    };
    const map = mount({ source: provider, sourceLayer: "borders" });
    await map.idle();
    expect(loadTile).toHaveBeenCalledTimes(2);
    expect(cached).toHaveBeenCalledTimes(2);
    expect(map.scene.output.textContent).toContain("┬");
    cached.mockClear();
    map.setView({ center: [1, 0] }); await map.idle();
    expect(cached).not.toHaveBeenCalled();
    map.setLayerSource("borders", { ...provider, loadTile }); await map.idle();
    expect(cached).toHaveBeenCalledTimes(2);
    expect(loadTile).toHaveBeenCalledTimes(4);
  });

  it("omitted and explicit false topology opt-ins preserve the legacy bytes", async () => {
    const legacy = mount({ sharedArcs: undefined, simplify: undefined, experimentalGlyphStrategy: undefined });
    const disabled = mount({ sharedArcs: false, simplify: undefined, experimentalGlyphStrategy: undefined });
    await Promise.all([legacy.idle(), disabled.idle()]);
    expect(disabled.scene.output.textContent).toBe(legacy.scene.output.textContent);
  });
});
