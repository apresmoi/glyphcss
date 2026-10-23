import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapHandle, type GlyphMapLineLayer } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import * as stroke from "./stroke";
import { createGlyphMapLineSimplifier, glyphMapCellEpsilonDeg, glyphMapSimplifyArc, type GlyphMapLonLat } from "./vector/simplify";

const line: readonly GlyphMapLonLat[] = Array.from({ length: 81 }, (_, i) => [-4 + i / 10, i % 2 ? 0.08 : -0.08]);
const hosts: HTMLElement[] = [];
const maps: GlyphMapHandle[] = [];
function mount(options: Partial<GlyphMapLineLayer> = {}, globe = false) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
    projection: globe ? glyphMapGlobe() : glyphMapEquirectangular(), tilt: 0,
    layers: [{ type: "line", id: "border", source: { features: [{ rings: [line] }] }, ...options }],
  });
  maps.push(map);
  return map;
}
afterEach(() => {
  maps.splice(0).forEach(map => map.destroy());
  hosts.splice(0).forEach(host => host.remove());
  vi.restoreAllMocks();
});

describe("live line VW simplification", () => {
  it("derives tolerance from degrees per cell, refines on zoom, and reuses each bucket", () => {
    const simplify = createGlyphMapLineSimplifier();
    const wide = simplify(line, 1);
    expect(wide).toEqual(glyphMapSimplifyArc(line, glyphMapCellEpsilonDeg(1)));
    expect(wide.length).toBeLessThan(line.length / 2);
    expect(simplify(line, 1.1)).toBe(wide);
    const close = simplify(line, 0.1);
    expect(close.length).toBe(line.length);
    expect(simplify(line, 1)).toBe(wide);
    expect(wide[0]).toEqual(line[0]);
    expect(wide.at(-1)).toEqual(line.at(-1));
    expect(line).toHaveLength(81);
    expect(simplify([...line], 1)).not.toBe(wide);
  });

  it("keeps collapsed closed rings and uses the existing latitude correction", () => {
    const simplify = createGlyphMapLineSimplifier();
    const ring: readonly GlyphMapLonLat[] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]];
    expect(simplify(ring, 1)).toBe(ring);
    const polar = line.map(([lon, lat]) => [lon, lat + 80] as const);
    expect(simplify(polar, 1)).toEqual(glyphMapSimplifyArc(polar, 0.5));
    expect(simplify(polar, 1).length).toBeGreaterThan(simplify(line, 1).length);
  });

  it("the real widget follows zoom and grid resolution before stamping", async () => {
    const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
    const map = mount({ simplify: "vw" });
    await map.idle();
    const count = () => stamp.mock.calls.at(-1)![1].length;
    expect(count()).toBeLessThan(line.length / 2);
    map.setView({ span: 6 });
    await map.idle();
    expect(count()).toBe(line.length);
    map.scene.setOptions({ cols: 400, rows: 160 });
    map.setView({ span: 40 });
    await map.idle();
    expect(count()).toBe(line.length);
  });

  it("uses the overlay's cell scale and passes box through without changing the depth path", async () => {
    const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
    const map = mount({ simplify: "vw", density: 8, experimentalGlyphStrategy: "box" });
    await map.idle();
    expect(stamp.mock.calls.at(-1)![1]).toHaveLength(line.length);
    expect(stamp.mock.calls.at(-1)![2]).toEqual({ color: undefined, experimentalGlyphStrategy: "box", boxGraph: { samples: expect.any(Map), paths: expect.any(Array), prior: expect.any(Map), islands: expect.any(Set) } });
  });

  it("does not resimplify an unchanged source while orbiting", async () => {
    const simplify = createGlyphMapLineSimplifier();
    const cached = vi.fn(simplify);
    const factory = vi.spyOn(await import("./vector/simplify"), "createGlyphMapLineSimplifier").mockReturnValue(cached);
    const map = mount({ simplify: "vw" }, true);
    await map.idle();
    expect(factory).toHaveBeenCalledOnce();
    const first = cached.mock.results.at(-1)!.value;
    cached.mockClear();
    map.setView({ center: [10, 10] });
    await map.idle();
    expect(factory).toHaveBeenCalledOnce();
    expect(cached).toHaveBeenCalled();
    expect(cached.mock.results.every(result => result.value === first)).toBe(true);
  });

  it("retains full source detail while walking instead of using the view span", async () => {
    const cached = vi.fn(createGlyphMapLineSimplifier());
    vi.spyOn(await import("./vector/simplify"), "createGlyphMapLineSimplifier").mockReturnValue(cached);
    const map = mount({ simplify: "vw" }, true);
    await map.idle();
    map.setView({ span: 0.001 });
    await map.idle();
    cached.mockClear();
    map.setWalk({});
    await map.idle();
    expect(map.getWalk()).not.toBeNull();
    expect(cached).not.toHaveBeenCalled();
  });

  it("without the opt-in, passes every original vertex and pins the legacy text", async () => {
    const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
    const map = mount();
    await map.idle();
    expect(stamp.mock.calls.at(-1)![1]).toHaveLength(line.length);
    expect(map.scene.output.textContent).toMatchInlineSnapshot(`
      "                                                            
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                              \\\\\\\\\\\\\\\\\\\\\\\\                        
                              ////////////\\                       
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  
                                                                  "
    `);
  });

  it("does not reuse geometry after replacing a line source", async () => {
    const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
    const map = mount({ simplify: "vw" });
    await map.idle();
    map.setLayerSource("border", { features: [{ rings: [[[-3, 2], [3, 2]]] }] });
    await map.idle();
    expect(stamp.mock.calls.at(-1)![1]).toHaveLength(2);
    expect(stamp.mock.calls.at(-1)![1].map(v => v.row)).not.toEqual([12, 12]);
  });
});
