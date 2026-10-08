/**
 * Per-row LABEL PLACEMENT on the OpenStreetMap card.
 *
 * `GlyphMapSymbolLayer.textAnchor` is MapLibre's `text-anchor` — which part
 * of the label sits on the feature's own point — and it is a LAYER option,
 * not a scene one. The card mounts one layer per OpenMapTiles row, so a
 * reader who wants city names beside their point and lake names on theirs
 * needs the choice PER ROW; one card-wide anchor would be the same mistake
 * the master density slider was.
 *
 * What is asserted here is the plumbing, not the renderer: the record the
 * card holds reaches THAT row's mounted layer and nothing else, and a row
 * left at the default carries no `textAnchor` key at all — which is what
 * makes an untouched card byte-identical rather than merely equivalent
 * (`glyphMapLabelPlacement` returns `null` for a centred, unoffset label and
 * nothing downstream then touches `style.transform`).
 *
 * The rows that GET an anchor are derived from each row's own layer type,
 * never listed: the row list belongs to `@glyphcss/maps` and it has moved
 * twice already (`Peaks` became a labelled `symbol` row, and
 * `Protected areas`/`Water labels` were appended as `symbol` rows later).
 */
import { describe, expect, it } from "vitest";
import {
  MAP_OSM_DEFAULT_ANCHOR,
  MAP_OSM_LABEL_ANCHORS,
  MAP_OSM_SUBLAYERS,
  mapOsmAnchorRecord,
  mapOsmLayers,
} from "./mapsOsm";
import type { GlyphMapVectorProvider } from "@glyphcss/maps";

/** A source is an opaque handle to everything here — nothing in this file fetches. */
const source = { zooms: [{ z: 0, tiles: 1 }], loadTile: async () => ({ layers: {} }) } as unknown as GlyphMapVectorProvider;

const ids = MAP_OSM_SUBLAYERS.map((s) => s.id);
/**
 * The rows that draw labels — stated as the independent claim (`type ===
 * "symbol"`) rather than read off the page's own constant, so the two have
 * to agree instead of one being derived from the other.
 */
const LABEL_ROWS = MAP_OSM_SUBLAYERS.filter((s) => s.type === "symbol");

describe("the label-bearing row set is derived, never listed", () => {
  it("is non-empty and is a strict subset of the card's rows — otherwise every claim below is vacuous", () => {
    expect(LABEL_ROWS.length).toBeGreaterThan(0);
    expect(LABEL_ROWS.length).toBeLessThan(MAP_OSM_SUBLAYERS.length);
  });

  it("covers every symbol row the mapping currently declares, including the three appended after this card was written", () => {
    // Named here so a row LOSING its labels (or a new one gaining them) is a
    // visible diff rather than a silently smaller set.
    expect(LABEL_ROWS.map((s) => s.id)).toEqual(["omt-places", "omt-peaks", "omt-parks", "omt-water-labels"]);
  });
});

describe("MAP_OSM_LABEL_ANCHORS — the vocabulary the card offers", () => {
  it("is MapLibre's own text-anchor list, in the package's order", () => {
    expect([...MAP_OSM_LABEL_ANCHORS]).toEqual([
      "center", "left", "right", "top", "bottom",
      "top-left", "top-right", "bottom-left", "bottom-right",
    ]);
  });

  it("opens centred — the placement a symbol layer has always drawn", () => {
    expect(MAP_OSM_DEFAULT_ANCHOR).toBe("center");
    expect(MAP_OSM_LABEL_ANCHORS[0]).toBe(MAP_OSM_DEFAULT_ANCHOR);
  });
});

describe("mapOsmAnchorRecord — the whole-card seed", () => {
  it("gives every mapped row the same anchor", () => {
    const record = mapOsmAnchorRecord("left");
    expect(Object.keys(record).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(record[id]).toBe("left");
  });
});

describe("mapOsmLayers — a per-row anchor reaches THAT row and only that row", () => {
  it("carries each row's own anchor onto its own mounted symbol layer", () => {
    const layers = mapOsmLayers(source, {
      enabled: ids,
      densities: {},
      anchors: { "omt-places": "left", "omt-water-labels": "bottom" },
    });
    const byId = new Map(layers.map((l) => [l.id, l]));
    expect((byId.get("omt-places") as { textAnchor?: string }).textAnchor).toBe("left");
    expect((byId.get("omt-water-labels") as { textAnchor?: string }).textAnchor).toBe("bottom");
  });

  it("does not leak one row's anchor onto its neighbours", () => {
    const layers = mapOsmLayers(source, {
      enabled: ids,
      densities: {},
      anchors: { "omt-places": "right" },
    });
    for (const layer of layers) {
      const anchor = (layer as { textAnchor?: string }).textAnchor;
      expect(anchor, layer.id).toBe(layer.id === "omt-places" ? "right" : undefined);
    }
  });

  it("omits the key entirely for a row left centred — the default stays byte-identical, not merely equivalent", () => {
    // `glyphMapLabelPlacement` answers `null` for a centred, unoffset label
    // and nothing downstream then touches the element's transform or the
    // arbiter's candidate. Writing `"center"` explicitly renders the same,
    // but writing nothing is what keeps the mounted layer object identical
    // to the one this card mounted before the control existed.
    const layers = mapOsmLayers(source, { enabled: ids, densities: {}, anchors: mapOsmAnchorRecord(MAP_OSM_DEFAULT_ANCHOR) });
    for (const layer of layers) expect(layer, layer.id).not.toHaveProperty("textAnchor");
    // And with no `anchors` at all — the shape every other caller passes.
    const bare = mapOsmLayers(source, { enabled: ids, densities: {} });
    for (const layer of bare) expect(layer, layer.id).not.toHaveProperty("textAnchor");
  });

  it("never puts a textAnchor on a row that draws no labels", () => {
    // The record is positional over EVERY row (the URL packs it that way), so
    // a stray non-symbol entry must be dropped by the builder rather than
    // reaching a `line`/`fill` layer that has no such option.
    const layers = mapOsmLayers(source, {
      enabled: ids,
      densities: {},
      anchors: mapOsmAnchorRecord("top"),
    });
    for (const layer of layers) {
      const anchor = (layer as { textAnchor?: string }).textAnchor;
      if (layer.type === "symbol") expect(anchor, layer.id).toBe("top");
      else expect(anchor, layer.id).toBeUndefined();
    }
  });
});
