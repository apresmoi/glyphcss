/**
 * `GlyphMapFeatureFilter` — the per-layer feature predicate.
 *
 * It exists because a real vector-tile schema does NOT ship one source layer
 * per cartographic layer: the Protomaps basemap puts motorways, footpaths and
 * railways in ONE `roads` layer discriminated by a `kind` property, and puts
 * rivers (lines) and lakes (polygons) in ONE `water` layer. `sourceLayer`
 * alone can only say "roads"; it cannot say "motorways", and it cannot say
 * "the line half of water". Without a filter the only alternative is for a
 * caller to pre-split the features into N copies before mounting, which
 * duplicates the data once per rendered layer and makes a provider-backed
 * source impossible to narrow at all (its tiles arrive after mount).
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  return { host, map };
}

const INK = new Set(["‾", "▔", "-", "_", "▏", "|", "▕", "/", "\\"]);

function row(map: ReturnType<typeof createGlyphMap>, r: number): string {
  return ((map.scene.output.textContent ?? "").split("\n")[r]) ?? "";
}
/** Whether the stroke pass inked ANY cell of `r`. Rows, not columns — see AGENTS.md's globe-column caveat. */
function rowInked(map: ReturnType<typeof createGlyphMap>, r: number): boolean {
  return [...row(map, r)].some((c) => INK.has(c));
}

/** Two horizontal lines on DIFFERENT rows, so each one's presence is readable independently. */
const MOTORWAY: GlyphMapVectorFeature = {
  id: "m",
  geometryType: "line",
  properties: { kind: "highway", kind_detail: "motorway" },
  rings: [[[-15, 5], [15, 5]]],
};
const FOOTPATH: GlyphMapVectorFeature = {
  id: "p",
  geometryType: "line",
  properties: { kind: "path", kind_detail: "footway" },
  rings: [[[-15, -5], [15, -5]]],
};
// A 60x24 view at span 40 is aspect-locked to 16 degrees of latitude, so
// lat +5/-5 land on exactly these rows (measured against the real renderer).
const MOTORWAY_ROW = 8;
const FOOTPATH_ROW = 15;

describe("GlyphMapFeatureFilter on a line layer (static collection)", () => {
  it("stamps only the features the filter keeps", () => {
    const { host, map } = mount();
    map.addLayer({
      type: "line",
      id: "roads",
      source: { features: [MOTORWAY, FOOTPATH] },
      color: "#ff0000",
      filter: (f) => f.properties?.kind === "highway",
    });
    map.scene.rerender();
    expect(rowInked(map, MOTORWAY_ROW)).toBe(true);
    expect(rowInked(map, FOOTPATH_ROW)).toBe(false);
    map.destroy();
    host.remove();
  });

  it("keeps every feature when no filter is declared", () => {
    const { host, map } = mount();
    map.addLayer({ type: "line", id: "roads", source: { features: [MOTORWAY, FOOTPATH] }, color: "#ff0000" });
    map.scene.rerender();
    expect(rowInked(map, MOTORWAY_ROW)).toBe(true);
    expect(rowInked(map, FOOTPATH_ROW)).toBe(true);
    map.destroy();
    host.remove();
  });

  it("selects the complementary half when the filter is inverted", () => {
    const { host, map } = mount();
    map.addLayer({
      type: "line",
      id: "paths",
      source: { features: [MOTORWAY, FOOTPATH] },
      color: "#ff0000",
      filter: (f) => f.properties?.kind === "path",
    });
    map.scene.rerender();
    expect(rowInked(map, MOTORWAY_ROW)).toBe(false);
    expect(rowInked(map, FOOTPATH_ROW)).toBe(true);
    map.destroy();
    host.remove();
  });
});

function provider(features: readonly GlyphMapVectorFeature[], layerName = "roads"): GlyphMapVectorProvider {
  const tile = (z: number, x: number, y: number): GlyphMapVectorTile => ({
    z, x, y,
    bounds: { west: -180, east: 180, south: -90, north: 90 },
    layers: { [layerName]: features },
    source: "synthetic",
    simplify: "none",
  });
  return {
    id: "synthetic",
    zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 4096, tileRows: 4096 }],
    bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
    loadTile: async (z, x, y) => tile(z, x, y),
  };
}

describe("GlyphMapFeatureFilter on a provider-backed layer", () => {
  it("narrows tiles that arrive AFTER mount — the case a caller cannot pre-split", async () => {
    const { host, map } = mount();
    map.addLayer({
      type: "line",
      id: "roads",
      source: provider([MOTORWAY, FOOTPATH]),
      sourceLayer: "roads",
      color: "#ff0000",
      filter: (f) => f.properties?.kind === "highway",
    });
    await vi.waitFor(() => {
      map.scene.rerender();
      expect(rowInked(map, MOTORWAY_ROW)).toBe(true);
    });
    expect(rowInked(map, FOOTPATH_ROW)).toBe(false);
    map.destroy();
    host.remove();
  });
});

describe("GlyphMapFeatureFilter on a fill layer", () => {
  const box = (south: number, north: number): [number, number][] =>
    [[-10, south], [10, south], [10, north], [-10, north], [-10, south]];
  const LAKE: GlyphMapVectorFeature = {
    id: "lake", geometryType: "polygon", properties: { kind: "water" },
    rings: [box(2, 6)], polygons: [[box(2, 6)]],
  };
  const PARK: GlyphMapVectorFeature = {
    id: "park", geometryType: "polygon", properties: { kind: "park" },
    rings: [box(-6, -2)], polygons: [[box(-6, -2)]],
  };
  // Measured against the real renderer: the lake fills rows 8-10, the park 14-16.
  const LAKE_ROW = 9;
  const PARK_ROW = 15;

  /** Count of non-blank cells on a row — a filled polygon paints solid glyphs, not stroke ink. */
  function rowFilled(map: ReturnType<typeof createGlyphMap>, r: number): number {
    return [...row(map, r)].filter((c) => c !== " " && c !== "").length;
  }

  it("meshes only the kept polygons from a provider's tiles — the shared feature runtime's OTHER branch", async () => {
    const { host, map } = mount();
    map.addLayer({
      type: "fill",
      id: "water",
      source: provider([LAKE, PARK], "water"),
      sourceLayer: "water",
      color: "#0000ff",
      filter: (f) => f.properties?.kind === "water",
    });
    await vi.waitFor(() => {
      map.scene.rerender();
      expect(rowFilled(map, LAKE_ROW)).toBeGreaterThan(0);
    });
    expect(rowFilled(map, PARK_ROW)).toBe(0);
    map.destroy();
    host.remove();
  });

  it("meshes only the kept polygons", () => {
    const { host, map } = mount();
    map.addLayer({
      type: "fill",
      id: "water",
      source: { features: [LAKE, PARK] },
      color: "#0000ff",
      filter: (f) => f.properties?.kind === "water",
    });
    map.scene.rerender();
    expect(rowFilled(map, LAKE_ROW)).toBeGreaterThan(0);
    expect(rowFilled(map, PARK_ROW)).toBe(0);
    map.destroy();
    host.remove();
  });
});
