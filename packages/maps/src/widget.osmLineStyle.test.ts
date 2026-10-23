import { readFileSync } from "node:fs";
import path from "node:path";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapHandle, type GlyphMapLineLayer } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { GLYPH_MAP_OPENMAPTILES_LAYERS, glyphMapOpenMapTilesFeatureFilter, glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorFeature, GlyphMapVectorSource } from "./vector/types";
import * as stroke from "./stroke";

const hosts: HTMLElement[] = [], maps: GlyphMapHandle[] = [];
afterEach(() => {
  maps.splice(0).forEach(map => map.destroy());
  hosts.splice(0).forEach(host => host.remove());
  vi.restoreAllMocks();
});
const road = (klass: string, lat = 0): GlyphMapVectorFeature => ({
  geometryType: "line", properties: { class: klass }, rings: [[[-0.01, lat], [0.01, lat]]],
});
const palette = { motorway: "#dbeafe", secondary: "#9fb6cf", tertiary: "#7893af", minor: "#506981", path: "#394d63" };
function mount(layers: readonly GlyphMapLineLayer[], span = 0.04) {
  const host = document.createElement("div"); document.body.append(host); hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span, cols: 139, rows: 77 }, projection: glyphMapEquirectangular(), tilt: 0, layers,
  });
  maps.push(map); return map;
}
function layers(source: GlyphMapVectorSource, extra: Partial<GlyphMapLineLayer> = {}) {
  return glyphMapOpenMapTilesLayers(source, {
    include: ["omt-roads"], roadHierarchy: true, densities: { "omt-roads": extra.density ?? 1 },
    lineOptions: { "omt-roads": { experimentalGlyphStrategy: "box", simplify: "vw", color: "#506981", colorProperty: "class", colors: palette, ...extra } },
  }) as GlyphMapLineLayer[];
}

it("leaves omitted factory options byte-identical to the legacy line layers", async () => {
  const source = { features: [road("minor")] };
  const ids = GLYPH_MAP_OPENMAPTILES_LAYERS.filter(s => s.type === "line").map(s => s.id);
  const actual = glyphMapOpenMapTilesLayers(source, { include: ids }) as GlyphMapLineLayer[];
  const legacy = GLYPH_MAP_OPENMAPTILES_LAYERS.filter(s => s.type === "line").map(spec => ({
    type: "line" as const, id: spec.id, source, sourceLayer: spec.sourceLayer,
    filter: glyphMapOpenMapTilesFeatureFilter({ geometry: spec.geometry, maxAdminLevel: spec.maxAdminLevel,
      excludeBrunnel: spec.excludeBrunnel, excludeService: spec.excludeService, excludeFlags: spec.excludeFlags }),
    color: spec.color,
  }));
  expect(actual.map(l => Object.keys(l))).toEqual(legacy.map(l => Object.keys(l)));
  expect(actual.map(l => l.color)).toEqual(["#5aa9e6", "#e8c988", "#c084fc", "#94a3b8"]);
  const a = mount(actual), b = mount(legacy);
  await a.idle(); await b.idle();
  expect(a.scene.output.textContent?.trim().length).toBeGreaterThan(5);
  expect(a.scene.output.outerHTML).toBe(b.scene.output.outerHTML);
});

it("passes line opt-ins only to line rows and respects a uniform colour override", () => {
  const source = { features: [] };
  const built = glyphMapOpenMapTilesLayers(source, {
    include: ["omt-water", "omt-roads", "omt-boundaries"], roadHierarchy: true,
    colors: { "omt-roads": "#123456" },
    lineOptions: {
      "omt-water": { experimentalGlyphStrategy: "box" },
      "omt-roads": { experimentalGlyphStrategy: "box", simplify: "vw", colorProperty: "class", colors: palette },
      "omt-boundaries": { sharedArcs: true },
    },
  });
  expect(built[0]).not.toHaveProperty("experimentalGlyphStrategy");
  expect(built[1]).toMatchObject({ color: "#123456", experimentalGlyphStrategy: "box", simplify: "vw", filterAtResolution: expect.any(Function) });
  expect(built[1]).not.toHaveProperty("colors");
  expect(built[1]).not.toHaveProperty("colorProperty");
  expect(built[2]).toMatchObject({ sharedArcs: true });
  expect(built[2]).not.toHaveProperty("filterAtResolution");
});

it("makes a connected street grid across separate features, including short road stubs, using the class palette", async () => {
  const source = { features: [road("minor"), {
    ...road("minor"), rings: [[[0, -0.008], [0, 0.008]]] as const,
  }] };
  const map = mount(layers(source)); await map.idle();
  const text = map.scene.output.textContent!;
  expect(text).toContain("┼"); expect(text).toContain("───"); expect(text).toContain("│");
  expect(text).not.toMatch(/[·/\\_]/);
  expect(map.scene.output.innerHTML).toContain("#506981");
});

it("cuts road classes at the evidence views' live cell sizes, and refines without replacing the source", async () => {
  const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
  const source = { features: Object.keys(palette).map((c, i) => road(c, i * 0.001)) };
  const map = mount(layers(source), 0.3); await map.idle();
  const colors = () => [...new Set(stamp.mock.calls.map(c => c[2]?.color))];
  expect(colors()).toEqual([palette.motorway, palette.secondary]);
  stamp.mockClear(); map.setView({ span: 0.06 }); await map.idle();
  expect(colors()).toEqual([palette.motorway, palette.secondary, palette.tertiary]);
  stamp.mockClear(); map.setView({ span: 0.04 }); await map.idle();
  expect(colors()).toEqual([palette.motorway, palette.secondary, palette.tertiary, palette.minor]);
  stamp.mockClear(); map.scene.setOptions({ cols: 400, rows: 220 }); await map.idle();
  expect(colors()).toContain(palette.path);
});

it("uses the overlay cell resolution, and preserves explicit line properties with sharedArcs", async () => {
  const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
  const map = mount(layers({ features: [road("minor")] }, { density: 2, sharedArcs: true }), 0.06);
  await map.idle();
  expect(stamp.mock.calls.length).toBeGreaterThan(0);
  expect(stamp.mock.calls.every(c => c[2]?.color === palette.minor)).toBe(true);
});

it("pins every hierarchy threshold and keeps major classes at any cell size", () => {
  const layer = layers({ features: [] })[0]!;
  for (const c of ["motorway", "trunk", "primary"]) expect(layer.filterAtResolution!(road(c), 100)).toBe(true);
  for (const [c, limit] of Object.entries({ secondary: 0.003, rail: 0.003, tertiary: 0.0008, transit: 0.0008,
    minor: 0.00035, service: 0.00012, track: 0.00012, path: 0.00012, unknown: 0.00012 })) {
    expect(layer.filterAtResolution!(road(c), limit)).toBe(true);
    expect(layer.filterAtResolution!(road(c), limit * 1.01)).toBe(false);
    expect(layer.filterAtResolution!(road(c), 0)).toBe(true);
  }
});

it("renders palette fallback and a uniform override through the real line runtime", async () => {
  const source = { features: [road("unknown")] };
  const a = mount(layers(source), 0.01); await a.idle();
  expect(a.scene.output.innerHTML).toContain("#506981");
  const override = glyphMapOpenMapTilesLayers(source, {
    include: ["omt-roads"], colors: { "omt-roads": "#123456" },
    lineOptions: { "omt-roads": { colorProperty: "class", colors: { unknown: "#ffffff" } } },
  }) as GlyphMapLineLayer[];
  const b = mount(override, 0.01); await b.idle();
  expect(b.scene.output.innerHTML).toContain("#123456");
  expect(b.scene.output.innerHTML).not.toContain("#ffffff");
});


it("declutters the real Zurich tile at city resolution and restores minor streets on zoom", async () => {
  const bytes = readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/z14-8579-5736.mvt"));
  const features = glyphMapDecodeMVT(bytes, 14, 8579, 5736).transportation!;
  const source = { features };
  const legacy = mount(glyphMapOpenMapTilesLayers(source, { include: ["omt-roads"] }) as GlyphMapLineLayer[], 0.06);
  const styled = mount(layers(source), 0.06);
  for (const map of [legacy, styled]) map.setView({ center: [8.54, 47.375] });
  await legacy.idle(); await styled.idle();
  const ink = (map: GlyphMapHandle) => map.scene.output.textContent!.replace(/\s/g, "").length;
  expect(ink(styled)).toBeGreaterThan(10);
  expect(ink(styled)).toBeLessThan(ink(legacy) * 0.6);
  expect(styled.scene.output.textContent).not.toMatch(/[·/\\_]/);
  const stamp = vi.spyOn(stroke, "stampGlyphMapPolyline");
  styled.setView({ span: 0.04 }); await styled.idle();
  expect(stamp.mock.calls.some(c => c[2]?.color === palette.minor)).toBe(true);
});
