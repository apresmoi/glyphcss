/**
 * Per-row density on the OpenStreetMap card.
 *
 * The card mounts ONE layer per OpenMapTiles source row, and
 * `glyphMapOpenMapTilesLayers` has always taken a `densities` map keyed by
 * row id — the page was the thing collapsing it to a single number. What is
 * asserted here is the plumbing that opened it back up, plus the two pure
 * functions that still read the record whole (for the LINK, not for a control).
 *
 * The per-row contract, stated once:
 *
 *  - The RECORD is the truth. There is no second "master" value in state,
 *    and since per-row replaced the card's master slider there is no master
 *    CONTROL either.
 *  - A write over every row at once OVERWRITES each of them (never a ratio,
 *    never a clamp on top of an existing spread). Its callers are now a
 *    legacy `Q`-only link's seed and the bench hook, not a slider.
 *  - {@link mapOsmMasterDensity} is what the LINK's legacy `Q` float carries:
 *    the shared value when every row agrees, `null` when they do not, which
 *    the page writes as the default so the codec omits it.
 */
import { describe, expect, it } from "vitest";
import {
  MAP_OSM_DEFAULT_DENSITY,
  MAP_OSM_SUBLAYERS,
  mapOsmDensityRecord,
  mapOsmLayers,
  mapOsmMasterDensity,
} from "./mapsOsm";
import type { GlyphMapVectorProvider } from "@glyphcss/maps";

/** A source is an opaque handle to everything here — nothing in this file fetches. */
const source = { zooms: [{ z: 0, tiles: 1 }], loadTile: async () => ({ layers: {} }) } as unknown as GlyphMapVectorProvider;

const ids = MAP_OSM_SUBLAYERS.map((s) => s.id);

describe("mapOsmDensityRecord — the legacy-link seed and the bench hook's whole-card write", () => {
  it("gives every mapped row the same value", () => {
    const record = mapOsmDensityRecord(2.5);
    expect(Object.keys(record).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(record[id]).toBe(2.5);
  });

  it("defaults to 1x, the value the card opened on before it had per-row control", () => {
    expect(MAP_OSM_DEFAULT_DENSITY).toBe(1);
    for (const id of ids) expect(mapOsmDensityRecord(MAP_OSM_DEFAULT_DENSITY)[id]).toBe(1);
  });
});

describe("mapOsmMasterDensity — the one number the link's legacy Q float carries", () => {
  it("is the shared value while every row agrees", () => {
    expect(mapOsmMasterDensity(mapOsmDensityRecord(3.2))).toBe(3.2);
  });

  it("is null — 'mixed' — as soon as one row differs", () => {
    const mixed = { ...mapOsmDensityRecord(1), "omt-roads": 3 };
    expect(mapOsmMasterDensity(mixed)).toBeNull();
  });

  it("reads a row the record does not carry as the 1x default rather than ignoring it", () => {
    // A record missing a row is the shape a shorter legacy link decodes to.
    // "Every row agrees at 1x" and "nine rows at 3x plus one unset" are
    // different maps, and only the first is uniform.
    const partial = { ...mapOsmDensityRecord(3) };
    delete partial[ids[0]];
    expect(mapOsmMasterDensity(partial)).toBeNull();
    expect(mapOsmMasterDensity({})).toBe(MAP_OSM_DEFAULT_DENSITY);
  });
});

describe("mapOsmLayers — a per-row density reaches THAT row and only that row", () => {
  it("carries each row's own number onto its own mounted layer", () => {
    const layers = mapOsmLayers(source, {
      enabled: ["omt-water", "omt-roads", "omt-buildings"],
      densities: { ...mapOsmDensityRecord(1), "omt-roads": 3, "omt-buildings": 2.4 },
    });
    const byId = new Map(layers.map((l) => [l.id, l]));
    expect(byId.get("omt-roads")!.density).toBe(3);
    expect(byId.get("omt-buildings")!.density).toBe(2.4);
    // The row nobody touched stays at 1x, which glyphcss and
    // `syncViewportOverlayDensities` both treat as "no separate pass".
    expect(byId.get("omt-water")!.density).toBe(1);
  });

  it("does not leak one row's density onto its neighbours", () => {
    const layers = mapOsmLayers(source, {
      enabled: ids,
      densities: { ...mapOsmDensityRecord(1), "omt-roads": 4 },
    });
    for (const layer of layers) {
      expect(layer.density, layer.id).toBe(layer.id === "omt-roads" ? 4 : 1);
    }
  });

  it("a whole-card write reaches every enabled row", () => {
    const layers = mapOsmLayers(source, { enabled: ids, densities: mapOsmDensityRecord(2.2) });
    expect(layers).toHaveLength(ids.length);
    for (const layer of layers) expect(layer.density, layer.id).toBe(2.2);
  });
});
