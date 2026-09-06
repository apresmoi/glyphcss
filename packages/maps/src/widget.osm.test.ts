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
 * Why the /maps page's OSM flight levels the tilt (`MAP_OSM_FLY_TILT`,
 * `website/src/components/MapsWorkbench/mapsOsm.ts`) rather than keeping the
 * page's default 40 degrees.
 *
 * `tilt` ADDS to the projection's base orientation, so on an ORBIT
 * projection it rotates the camera by an ABSOLUTE angle while the field of
 * view shrinks with the zoom. That is fine at a global view and fatal at
 * city scale, which is the only scale a city extract is legible at. This
 * pins the arithmetic: if the widget's tilt semantics ever change, the
 * website's levelling can be revisited, and this goes red first.
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
    map.destroy();
    host.remove();
    return p;
  }

  it("keeps the view centre on the grid at a global span, and walks it off as the span shrinks", () => {
    expect(centreCell(360, 40).visible).toBe(true);
    expect(centreCell(40, 40).visible).toBe(false);
    // The span this extract needs. The centre is not merely off screen, it is
    // hundreds of viewports away — no amount of padding recovers it.
    const cityScale = centreCell(0.109, 40);
    expect(cityScale.visible).toBe(false);
    expect(Math.abs(cityScale.row)).toBeGreaterThan(63 * 100);
  });

  it("is exactly on the grid centre at every span once the tilt is levelled", () => {
    for (const span of [360, 40, 0.109]) {
      const p = centreCell(span, 0);
      expect(p.visible).toBe(true);
      expect(p.row).toBeCloseTo(31.5, 6);
    }
  });
});
