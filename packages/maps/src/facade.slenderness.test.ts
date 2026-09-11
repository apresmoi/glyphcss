/**
 * A facade is window bays and floor bands, so it is a claim that the wall it
 * sits on is a STOREY STACK. The Berlin Fernsehturm is not one, and nothing in
 * the data says so: the live OpenFreeMap `building` layer carries exactly
 * `render_height`, `render_min_height`, `hide_3d` and `colour` — verified on
 * the tile itself, not read off the schema docs — so `building=tower` and
 * `man_made=communications_tower` never reach us and the tower survives only
 * as a `poi` point classed `attraction`.
 *
 * The shape is therefore the only signal, and it separates: measured across
 * three real z14 city tiles, every genuine building is at or under 7.8 times
 * taller than its footprint is wide and the first mast is at 8.5. The numbers
 * below are the real ones from those tiles, so this file goes red if the knee
 * is moved far enough to reclassify either side of it.
 */
import { describe, expect, it } from "vitest";
import { GLYPH_MAP_FACADE_MAX_SLENDERNESS, glyphMapFacadeSuitsBand, glyphMapFootprintWidthMetres } from "./facade";
import { glyphMapVectorMesh } from "./layers";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

/** A square footprint `metres` across, centred on the equator so the cos(lat) factor is 1. */
function squareFootprint(metres: number): GlyphMapVectorFeature {
  const half = metres / 2 / 111320;
  return {
    geometryType: "polygon",
    properties: {},
    rings: [[[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]]],
  };
}

function walls(footprintM: number, heightM: number) {
  const mesh = glyphMapVectorMesh([squareFootprint(footprintM)], glyphMapEquirectangular(), {
    height: () => heightM,
    facade: { texture: "facade" },
  });
  return mesh.polygons.filter((p) => p.texture !== undefined);
}

describe("a facade belongs on a storey stack, not on a mast", () => {
  it("keeps the real buildings measured in the tiles", () => {
    // Houston's tallest measured band: 190 m over a 24.4 m footprint, 7.8.
    expect(glyphMapFacadeSuitsBand(24.4, 190)).toBe(true);
    // Its widest: 305 m over 51.3 m, 5.9.
    expect(glyphMapFacadeSuitsBand(51.3, 305)).toBe(true);
    // An ordinary house.
    expect(glyphMapFacadeSuitsBand(12, 9)).toBe(true);
  });

  it("drops the masts measured in the tiles", () => {
    // Berlin's first mast above the knee: 82 m over 9.7 m, 8.5.
    expect(glyphMapFacadeSuitsBand(9.7, 82)).toBe(false);
    // The Fernsehturm's shaft: 205 m over 11 m, 18.6.
    expect(glyphMapFacadeSuitsBand(11, 205)).toBe(false);
    // Its topmost antenna band: 42 m over 0.8 m, 51.2.
    expect(glyphMapFacadeSuitsBand(0.8, 42)).toBe(false);
  });

  it("sits between the two, so neither side can be reclassified by a rounding", () => {
    expect(GLYPH_MAP_FACADE_MAX_SLENDERNESS).toBeGreaterThan(7.8);
    expect(GLYPH_MAP_FACADE_MAX_SLENDERNESS).toBeLessThan(8.5);
  });

  it("measures the footprint by AREA, so a terrace row keeps its windows", () => {
    // 200 m by 8 m: every extent-based width calls this a mast at 30 m tall.
    const long = 200 / 111320;
    const thin = 8 / 111320;
    const width = glyphMapFootprintWidthMetres([[0, 0], [long, 0], [long, thin], [0, thin], [0, 0]]);
    expect(width).toBeGreaterThan(40);
    expect(glyphMapFacadeSuitsBand(width, 30)).toBe(true);
  });

  it("textures the walls of a building and none of a mast", () => {
    expect(walls(24, 60).length).toBeGreaterThan(0);
    expect(walls(11, 205)).toHaveLength(0);
  });

  it("leaves the mast its geometry — it loses a texture, never a wall", () => {
    const mast = glyphMapVectorMesh([squareFootprint(11)], glyphMapEquirectangular(), { height: () => 205, facade: { texture: "facade" } });
    const bare = glyphMapVectorMesh([squareFootprint(11)], glyphMapEquirectangular(), { height: () => 205 });
    expect(mast.polygons).toHaveLength(bare.polygons.length);
    expect(mast.polygons.map((p) => p.vertices)).toEqual(bare.polygons.map((p) => p.vertices));
  });
});
