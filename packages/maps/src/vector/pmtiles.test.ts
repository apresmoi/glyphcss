import { describe, expect, it } from "vitest";
import { PbfWriter } from "pbf";
import { glyphMapDecodeMVT, glyphMapPMTilesProvider } from "./pmtiles";
import { GLYPH_MAP_PROTOMAPS_ATTRIBUTION } from "../attribution";

function pointMvt(): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(3, (_layer, layer) => {
    layer.writeStringField(1, "places");
    layer.writeMessage(2, (_feature, feature) => {
      feature.writeVarintField(1, 7);
      feature.writePackedVarint(2, [0, 0]);
      feature.writeVarintField(3, 1);
      feature.writePackedVarint(4, [9, 4096, 4096]);
    }, null);
    layer.writeStringField(3, "name");
    layer.writeMessage(4, (_value, value) => value.writeStringField(1, "Test City"), null);
    layer.writeVarintField(5, 4096);
    layer.writeVarintField(15, 2);
  }, null);
  return pbf.finish();
}

describe("Protomaps PMTiles provider", () => {
  it("decodes an MVT point and preserves its layer and properties", () => {
    const layers = glyphMapDecodeMVT(pointMvt(), 0, 0, 0);
    expect(layers.places).toHaveLength(1);
    expect(layers.places[0].geometryType).toBe("point");
    expect(layers.places[0].properties?.name).toBe("Test City");
    expect(layers.places[0].rings[0][0]).toEqual([0, 0]);
  });

  it("adapts archive zooms/bounds and applies mandatory OSM/Protomaps attribution", async () => {
    const bytes = pointMvt();
    const provider = await glyphMapPMTilesProvider({
      getHeader: async () => ({ minZoom: 0, maxZoom: 1 }),
      getZxy: async () => ({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }),
    });
    expect(provider.zooms.map((z) => z.z)).toEqual([0, 1]);
    expect(provider.attribution).toEqual(GLYPH_MAP_PROTOMAPS_ATTRIBUTION);
    expect(provider.bounds(1, 0, 0).north).toBeCloseTo(85.0511, 3);
    expect((await provider.loadTile(0, 0, 0)).layers.places[0].properties?.name).toBe("Test City");
  });
});
