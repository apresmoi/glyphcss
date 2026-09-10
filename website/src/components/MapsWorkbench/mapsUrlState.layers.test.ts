/**
 * The layer-CONTENT half of `/maps`'s URL state.
 *
 * The page's URL already carried every rendering choice — camera, projection,
 * palette, character mode, colour encoding, density, shading, lighting, sun —
 * and none of what was actually ON the map. A shared link restored the exact
 * viewpoint and then showed a different map: terrain and borders, whatever
 * the sender had mounted. These tokens close that.
 *
 * Two of them are BITFIELDS over frozen key lists (`L` layer visibility, `O`
 * OpenStreetMap sublayers). A bitfield is a wire format, so both lists are
 * APPEND-ONLY — the same rule the field-synth schema's key families live
 * under (AGENTS.md, "Stock effects"). The cross-check tests below are what
 * give that rule teeth: they go red if a key is inserted, reordered or
 * dropped rather than appended, because the live lists they compare against
 * (`MAP_OSM_SUBLAYERS`, derived from `@glyphcss/maps`' own OpenMapTiles
 * table) can move without anyone thinking about shared links.
 *
 * `MapsWorkbench.tsx` cannot be mounted in this vitest config, so the
 * state<->URL mapping lives in pure functions here and the tests drive those
 * — the established workaround on this page (`MapsWorkbench.readouts.test.ts`
 * and every `mapsUrlState.*.test.ts` above take the same route).
 */
import { describe, expect, it } from "vitest";
import {
  MAPS_LAYER_DEFAULT_ON,
  MAPS_LAYER_KEYS,
  MAPS_MODEL_SHAPE_VALUES,
  MAPS_OSM_MASK_LINK_DEFAULT,
  MAPS_OSM_MASK_PAGE_DEFAULT,
  MAPS_OSM_SUBLAYER_KEYS,
  MAPS_POINT_DATASET_VALUES,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsCodecLegacyV1,
  mapsCodecLegacyV2,
  mapsLayerMaskFromVisibility,
  mapsLayerVisibilityFromMask,
  mapsOsmMaskFromSublayers,
  mapsOsmSublayersFromMask,
} from "./mapsUrlState";
import { MAP_OSM_DEFAULT_ON, MAP_OSM_SUBLAYERS } from "./mapsOsm";
import { MAP_MODEL_SHAPES } from "./mapPin";
import { MAP_SCENE_RENDER_MODE, POINT_DATASET_DEFAULTS, POINT_DATASET_OPTIONS } from "./mapsKit";

describe("mapsUrlState — the layer bitfields' key lists are a wire format", () => {
  it("the OSM wire list covers exactly the rows the card offers, in the card's own order", () => {
    // Prefix-stable: a row APPENDED to `@glyphcss/maps`' OpenMapTiles table
    // extends this list; a row inserted or reordered shifts every bit after
    // it and silently reinterprets already-shared links. This assertion is
    // the guard — see this file's doc.
    expect([...MAPS_OSM_SUBLAYER_KEYS]).toEqual(MAP_OSM_SUBLAYERS.map((s) => s.id));
  });

  it("the layer wire list covers every toggle the page has", () => {
    expect([...MAPS_LAYER_KEYS]).toEqual([
      "terrain", "borders", "contour", "osm",
      "fill", "symbol", "circle", "heatmap", "fill-extrusion", "model",
    ]);
  });

  it("every wire enum list matches the live option list it stands for", () => {
    expect([...MAPS_MODEL_SHAPE_VALUES]).toEqual([...MAP_MODEL_SHAPES]);
    expect([...MAPS_POINT_DATASET_VALUES]).toEqual(POINT_DATASET_OPTIONS.map((o) => o.value));
  });

  it("the schema's defaults are the page's own, so an absent token is the page's untouched state", () => {
    // `osmMask` is the ONE field this does not hold for, and deliberately: the
    // codec's omission sentinel is what an already-shared link means, so it is
    // frozen at the four rows that were on before `omt-water-labels` was
    // appended, while the page opens on `MAP_OSM_DEFAULT_ON`. See
    // `MAPS_OSM_MASK_LINK_DEFAULT` and
    // `mapsUrlState.osmDefaultLink.test.ts`, which pins both halves.
    expect(MAPS_URL_DEFAULTS.osmMask).toBe(MAPS_OSM_MASK_LINK_DEFAULT);
    expect(MAPS_OSM_MASK_LINK_DEFAULT).toBe(92);
    expect(MAPS_OSM_MASK_PAGE_DEFAULT).toBe(mapsOsmMaskFromSublayers(
      Object.fromEntries(MAP_OSM_SUBLAYERS.map((s) => [s.id, MAP_OSM_DEFAULT_ON.includes(s.id)])),
    ));
    expect(MAPS_URL_DEFAULTS.symbolDataset).toBe(POINT_DATASET_DEFAULTS.symbol);
    expect(MAPS_URL_DEFAULTS.circleDataset).toBe(POINT_DATASET_DEFAULTS.circle);
    expect(MAPS_URL_DEFAULTS.heatmapDataset).toBe(POINT_DATASET_DEFAULTS.heatmap);
    expect(MAPS_URL_DEFAULTS.extrusionRenderMode).toBe(MAP_SCENE_RENDER_MODE);
    expect(MAPS_URL_DEFAULTS.modelRenderMode).toBe(MAP_SCENE_RENDER_MODE);
    expect([...MAPS_LAYER_DEFAULT_ON]).toEqual(["terrain", "borders"]);
  });
});

describe("mapsUrlState — bitmask round-trip", () => {
  it("round-trips an arbitrary layer set exactly", () => {
    const visible = {
      terrain: false, borders: true, contour: true, osm: true,
      fill: false, symbol: true, circle: false, heatmap: false, "fill-extrusion": true, model: false,
    };
    expect(mapsLayerVisibilityFromMask(mapsLayerMaskFromVisibility(visible))).toEqual(visible);
  });

  it("round-trips an arbitrary OSM sublayer set exactly", () => {
    const on = Object.fromEntries(MAPS_OSM_SUBLAYER_KEYS.map((id, i) => [id, i % 3 === 0]));
    expect(mapsOsmSublayersFromMask(mapsOsmMaskFromSublayers(on))).toEqual(on);
  });

  it("a missing key packs as off, and an unknown key is ignored — the mask is over the wire list, not over whatever it is handed", () => {
    expect(mapsLayerMaskFromVisibility({ terrain: true, nonsense: true })).toBe(1);
  });

  it("keeps bit ORDER: each key owns the bit at its own index", () => {
    MAPS_LAYER_KEYS.forEach((key, i) => {
      expect(mapsLayerMaskFromVisibility({ [key]: true })).toBe(1 << i);
    });
    MAPS_OSM_SUBLAYER_KEYS.forEach((key, i) => {
      expect(mapsOsmMaskFromSublayers({ [key]: true })).toBe(1 << i);
    });
  });
});

describe("mapsUrlState — a link restores the map's CONTENT", () => {
  it("a link written with a non-default layer set restores that exact set, OSM sublayers included", () => {
    const visible = {
      terrain: true, borders: false, contour: true, osm: true,
      fill: true, symbol: false, circle: true, heatmap: false, "fill-extrusion": false, model: true,
    };
    const osmSublayers = Object.fromEntries(
      MAPS_OSM_SUBLAYER_KEYS.map((id) => [id, id === "omt-buildings" || id === "omt-places"]),
    );
    const state = {
      ...MAPS_URL_DEFAULTS,
      layerMask: mapsLayerMaskFromVisibility(visible),
      osmMask: mapsOsmMaskFromSublayers(osmSublayers),
      osmDensity: 2.5,
      terrainDensity: 1.5,
      borderDensity: 2,
      contourDensity: 3,
      fillDensity: 1.3,
      extrusionDensity: 2.2,
      symbolDataset: "megacities" as const,
      circleDataset: "capitals" as const,
      heatmapDataset: "countries" as const,
      modelShape: "icosahedron",
      contourInterval: 250,
      contourLabels: true,
      extrusionRenderMode: "wireframe" as const,
      modelRenderMode: "ink" as const,
    };
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(mapsCodec.encode(state)) };

    expect(mapsLayerVisibilityFromMask(decoded.layerMask)).toEqual(visible);
    expect(mapsOsmSublayersFromMask(decoded.osmMask)).toEqual(osmSublayers);
    expect(decoded.osmDensity).toBeCloseTo(2.5, 6);
    expect(decoded.terrainDensity).toBeCloseTo(1.5, 6);
    expect(decoded.borderDensity).toBeCloseTo(2, 6);
    expect(decoded.contourDensity).toBeCloseTo(3, 6);
    expect(decoded.fillDensity).toBeCloseTo(1.3, 6);
    expect(decoded.extrusionDensity).toBeCloseTo(2.2, 6);
    expect(decoded.symbolDataset).toBe("megacities");
    expect(decoded.circleDataset).toBe("capitals");
    expect(decoded.heatmapDataset).toBe("countries");
    expect(decoded.modelShape).toBe("icosahedron");
    expect(decoded.contourInterval).toBe(250);
    expect(decoded.contourLabels).toBe(true);
    expect(decoded.extrusionRenderMode).toBe("wireframe");
    expect(decoded.modelRenderMode).toBe("ink");
  });

  it("a link with NONE of the new tokens still decodes to today's defaults", () => {
    // The exact shape a link shared before this change has: every field the
    // codec knew then, none of the ones it did not.
    const before = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, projection: "mercator", palette: "heat", tilt: 0 });
    for (const token of ["L", "O", "T", "B", "N", "Q", "W", "X", "Y", "Z", "H", "G", "I", "R", "U", "V"]) {
      expect(before).not.toContain(token);
    }
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(before) };
    expect(mapsLayerVisibilityFromMask(decoded.layerMask)).toEqual(
      Object.fromEntries(MAPS_LAYER_KEYS.map((k) => [k, MAPS_LAYER_DEFAULT_ON.includes(k)])),
    );
    // The FROZEN link default, not the page's opening rows — an old link's
    // omitted `O` has to keep meaning what it meant when it was written.
    expect(decoded.osmMask).toBe(MAPS_OSM_MASK_LINK_DEFAULT);
    expect(decoded.terrainDensity).toBe(1);
    expect(decoded.borderDensity).toBe(1);
    expect(decoded.contourDensity).toBe(1);
    expect(decoded.osmDensity).toBe(1);
    expect(decoded.fillDensity).toBe(1);
    expect(decoded.extrusionDensity).toBe(1);
    expect(decoded.contourInterval).toBe(1000);
    expect(decoded.contourLabels).toBe(false);
    expect(decoded.modelShape).toBe("pyramid");
    // And the fields it DID carry are untouched — the new tokens are
    // appended, so nothing ordered before them can be stranded.
    expect(decoded.projection).toBe("mercator");
    expect(decoded.palette).toBe("heat");
    expect(decoded.tilt).toBe(0);
  });

  it("the default page still costs zero characters for all sixteen new tokens", () => {
    expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).toBe("p3");
  });

  it("a realistic shared link stays short — the bitfields are what keep it that way", () => {
    // Alps at a regional span, tilted, exaggerated, viridis, contour on with
    // labels and a sea-level floor, OSM on with four rows, terrain 2x. Four
    // layers mounted, a ten-row OSM set and two per-layer values, and the
    // whole thing is 50 characters: `L1f` `O238` `T1k` `I2dw` `R1`, 16 of
    // them. Ten bool tokens for the layer set alone would have cost 8 on
    // this link and 20 on a fully-populated one.
    const link = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      centerLon: 8.2275, centerLat: 46.8182, span: 6.5, tilt: 55,
      exaggeration: 40, palette: "viridis",
      layerMask: mapsLayerMaskFromVisibility({ terrain: true, borders: true, contour: true, osm: true }),
      osmMask: mapsOsmMaskFromSublayers(Object.fromEntries(
        MAPS_OSM_SUBLAYER_KEYS.map((k) => [k, ["omt-water", "omt-roads", "omt-buildings", "omt-boundaries"].includes(k)]),
      )),
      terrainDensity: 2,
      contourInterval: 500,
      contourLabels: true,
      contourFloor: 0,
    });
    expect(link).toBe("p3e214x54wcdoy5rvh5ks32w0t21jP1F10L1fO238T1kI2dwR1");
    expect(link.length).toBe(50);
  });

  it("a v1/v2-tagged link still decodes in full — neither legacy codec has to know these tokens", () => {
    for (const codec of [mapsCodecLegacyV1, mapsCodecLegacyV2]) {
      const decoded = codec.decode(codec.encode({ ...MAPS_URL_DEFAULTS, terrainRenderMode: "ink", palette: "ocean" }));
      expect(decoded.palette).toBe("ocean");
      expect(decoded.terrainRenderMode).toBe("ink");
      expect(decoded.layerMask ?? MAPS_URL_DEFAULTS.layerMask).toBe(MAPS_URL_DEFAULTS.layerMask);
    }
  });
});
