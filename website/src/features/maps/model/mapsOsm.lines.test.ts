import { afterEach, expect, it, vi } from "vitest";
import type { GlyphMapLineLayer } from "@glyphcss/maps";
import { MAP_OSM_LINE_OPTIONS, MAP_OSM_SUBLAYERS, createOsmSource, mapOsmLayers } from "./mapsOsm";

it("opts every OSM line row into box/VW, and only boundaries into shared polygon arcs", () => {
  const layers = mapOsmLayers(createOsmSource(), { enabled: MAP_OSM_SUBLAYERS.map(s => s.id), densities: {} });
  for (const layer of layers) {
    if (layer.type === "line") {
      expect(layer.experimentalGlyphStrategy, layer.id).toBe("box");
      expect(layer.simplify, layer.id).toBe("vw");
      expect(layer.sharedArcs, layer.id).toBe(layer.id === "omt-boundaries" ? true : undefined);
    } else expect(layer).not.toHaveProperty("experimentalGlyphStrategy");
  }
  const roads = layers.find(l => l.id === "omt-roads") as GlyphMapLineLayer;
  expect(roads.color).toBe("#506981");
  expect(roads.colors).toEqual(MAP_OSM_LINE_OPTIONS["omt-roads"].colors);
  const brightness = (hex: string) => Number.parseInt(hex.slice(1, 3), 16) + Number.parseInt(hex.slice(3, 5), 16) + Number.parseInt(hex.slice(5), 16);
  expect(brightness(roads.colors!.primary)).toBeGreaterThan(brightness(roads.colors!.tertiary));
  expect(brightness(roads.colors!.tertiary)).toBeGreaterThan(brightness(roads.colors!.minor));
  expect(Object.values(roads.colors!)).not.toContain("#e8c988");
  const minor = { geometryType: "line" as const, properties: { class: "minor" }, rings: [] };
  expect(roads.filterAtResolution!(minor, 0.06 / 139)).toBe(false);
  expect(roads.filterAtResolution!(minor, 0.04 / 139)).toBe(true);
});


afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it.each(["", "?lines=braille"])("outlines /maps buildings only in braille mode, URL %s", async search => {
  vi.stubGlobal("location", { search });
  vi.resetModules();
  const { mapOsmLayers, createOsmSource } = await import("./mapsOsm");
  const layers = mapOsmLayers(createOsmSource(), { enabled: ["omt-buildings", "omt-roads"], densities: {} });
  const buildings = layers.find(l => l.type === "fill-extrusion")!;
  expect(buildings).toMatchObject({ facade: true });
  expect((buildings as { outline?: string }).outline).toBe(search ? "braille" : undefined);
  expect((buildings as { fill?: boolean }).fill).toBe(search ? false : undefined);
  expect(layers.find(l => l.type === "line")).toMatchObject({ experimentalGlyphStrategy: search ? "braille" : "box" });
});
