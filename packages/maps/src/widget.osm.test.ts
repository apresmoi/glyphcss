/**
 * The OSM path end to end, through the real widget and the real rasterizer:
 * vendored PMTiles archive → `glyphMapProtomapsExtract` → the mapped layers →
 * `createGlyphMap`.
 *
 * The attribution half is legally load-bearing, not cosmetic. OpenStreetMap
 * data is ODbL: anything derived from it must credit "© OpenStreetMap
 * contributors". This package's rule (AGENTS.md / `attribution.ts`) is that
 * the credit is DERIVED from the layers actually mounted — a page never
 * hardcodes it — so the thing worth testing is that mounting an OSM layer
 * makes the credit appear and unmounting it makes the credit go away.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapPMTilesBufferSource } from "./vector/pmtiles";
import { glyphMapProtomapsExtract, glyphMapProtomapsLayers } from "./vector/protomaps";

const FIXTURE = path.resolve(__dirname, "../fixtures/pmtiles/zurich-z12.pmtiles");
const OSM_CREDIT = "OpenStreetMap contributors";

async function zurich() {
  const extract = await glyphMapProtomapsExtract(glyphMapPMTilesBufferSource(readFileSync(FIXTURE), FIXTURE));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    // Framed on the extract's own extent — the only place its data exists.
    view: { center: [8.54, 47.375], span: 0.06, cols: 120, rows: 48 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  return { extract, host, map };
}

describe("mounting an OSM layer credits OpenStreetMap; removing it withdraws the credit", () => {
  it("adds and removes the ODbL credit with the layer", async () => {
    const { extract, host, map } = await zurich();
    expect(map.getAttributions()).toEqual([]);

    const roads = glyphMapProtomapsLayers(extract, { include: ["osm-roads"] })[0];
    map.addLayer(roads);
    const credited = map.getAttributions();
    expect(credited.map((a) => a.name)).toContain(OSM_CREDIT);
    expect(credited.find((a) => a.name === OSM_CREDIT)?.license).toBe("ODbL");

    map.removeLayer("osm-roads");
    expect(map.getAttributions().map((a) => a.name)).not.toContain(OSM_CREDIT);

    map.destroy();
    host.remove();
  });

  it("credits OSM exactly once no matter how many OSM layers are mounted", async () => {
    const { extract, host, map } = await zurich();
    const layers = glyphMapProtomapsLayers(extract);
    expect(layers.length).toBeGreaterThan(4);
    for (const layer of layers) map.addLayer(layer);
    expect(map.getAttributions().filter((a) => a.name === OSM_CREDIT)).toHaveLength(1);

    // Withdrawing all but one keeps the credit; withdrawing the last drops it.
    for (const layer of layers.slice(1)) map.removeLayer(layer.id!);
    expect(map.getAttributions().map((a) => a.name)).toContain(OSM_CREDIT);
    map.removeLayer(layers[0].id!);
    expect(map.getAttributions().map((a) => a.name)).not.toContain(OSM_CREDIT);

    map.destroy();
    host.remove();
  });
});

describe("real OSM geometry reaches the grid", () => {
  it("draws Zurich's roads inside the extract's extent, and nothing outside it", async () => {
    const { extract, host, map } = await zurich();
    const blank = (map.scene.output.textContent ?? "").replace(/[\s\n]/g, "");
    expect(blank).toBe("");

    map.addLayer(glyphMapProtomapsLayers(extract, { include: ["osm-roads"] })[0]);
    map.scene.rerender();
    const inked = (map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length;
    expect(inked).toBeGreaterThan(200);

    // Pan a whole degree east — off the extract entirely. The layer is still
    // mounted and still credited; there is simply no data there, and the
    // renderer draws nothing rather than misbehaving.
    map.setView({ center: [10.0, 47.375] });
    map.scene.rerender();
    expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "")).toBe("");
    expect(map.getAttributions().map((a) => a.name)).toContain(OSM_CREDIT);

    map.destroy();
    host.remove();
  });

  it("mounts every layer the mapping produces, including the hotspot-backed ones", async () => {
    const { extract, host, map } = await zurich();
    // `symbol`/`circle` paint no glyphs — they position DOM hotspots — so the
    // thing to assert is that all nine specs mount, render and unmount
    // cleanly against real data, not that each one inks the grid.
    const layers = glyphMapProtomapsLayers(extract);
    expect(layers.map((l) => l.id)).toEqual([
      "osm-earth", "osm-landuse", "osm-water", "osm-waterway", "osm-roads",
      "osm-buildings", "osm-boundaries", "osm-places", "osm-pois",
    ]);
    for (const layer of layers) map.addLayer(layer);
    map.scene.rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length).toBeGreaterThan(200);
    for (const layer of layers) map.removeLayer(layer.id!);
    map.scene.rerender();
    expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "")).toBe("");
    map.destroy();
    host.remove();
  });

  it("renders the water and building layers the mapping produces", async () => {
    const { extract, host, map } = await zurich();
    for (const id of ["osm-water", "osm-waterway", "osm-buildings"]) {
      const only = glyphMapProtomapsLayers(extract, { include: [id] });
      expect(only).toHaveLength(1);
      map.addLayer(only[0]);
      map.scene.rerender();
      expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length).toBeGreaterThan(0);
      map.removeLayer(id);
      map.scene.rerender();
    }
    map.destroy();
    host.remove();
  });
});

/**
 * Why a /maps camera flight no longer has to LEVEL the tilt.
 *
 * This block used to pin the opposite arithmetic — `tilt` added an ABSOLUTE
 * pitch to the projection's base orientation about the GLOBE'S CENTRE while
 * the field of view shrank with the zoom, so a flight into city scale at the
 * page's default 40 degrees arrived with the destination row -22,775 of a
 * 63-row grid, and `MAP_SEARCH_FLY_TILT` levelled every flight to 0 to
 * survive it. `tilt` now pitches about the SURFACE POINT under the view
 * centre (`widget.tiltPivot.test.ts`), so the centre is at the centre of the
 * grid at every span and every pitch, and the levelling has nothing left to
 * guard. City scale is kept as the case, because it is the only scale a city
 * extract is legible at and the scale the old model failed hardest at.
 */
describe("tilt on an orbit projection at city scale", () => {
  function centreCell(span: number, tilt: number) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [8.54, 47.375], span, cols: 135, rows: 63 },
      projection: glyphMapGlobe(),
      tilt,
    });
    const p = map.project([8.54, 47.375]);
    const applied = map.getTilt();
    map.destroy();
    host.remove();
    return { ...p, applied };
  }

  it("is exactly on the grid centre at every span, tilted or levelled", () => {
    for (const span of [360, 40, 0.109]) {
      for (const tilt of [0, 40]) {
        const p = centreCell(span, tilt);
        expect(p.visible).toBe(true);
        expect(p.row).toBeCloseTo(31.5, 6);
        expect(p.col).toBeCloseTo(67.5, 6);
      }
    }
  });

  it("keeps the full 40 degrees of pitch at city scale — the ceiling only binds at planet scale", () => {
    expect(centreCell(0.109, 40).applied).toBe(40);
    expect(centreCell(40, 40).applied).toBe(40);
    expect(centreCell(360, 40).applied).toBeLessThan(40);
  });
});
