// @vitest-environment happy-dom
/**
 * The OSM card's per-row LABEL ANCHORS on the wire.
 *
 * The card mounts one layer per OpenMapTiles row and each labelled row now
 * carries its own `text-anchor`. That is a per-ROW setting, so it packs the
 * way the per-row densities already do: a fixed-width tuple, positional over
 * {@link MAPS_OSM_SUBLAYER_KEYS}, in a NEW token appended LAST.
 *
 * The three properties that follow from the codec's append-only rule
 * (`MAPS_LAYER_KEYS`' doc), and that this file pins:
 *
 *  - **A mixed card round-trips.** Each row's anchor comes back on the row
 *    it was written for.
 *  - **An untouched card costs nothing.** Every row centred is the schema
 *    default, and `encodePacked` omits a field at its default, so no `l`
 *    appears in the string at all.
 *  - **Every link already shared decodes exactly as it did.** `decodePacked`
 *    is TOKEN-keyed and stops at the first token it does not know, so the
 *    only ways a new token can hurt an old link are a collision with a token
 *    it carries, or a stranded field ordered after it. `l` is a token no
 *    v1/v2/v3 link has ever contained, and it is ordered after everything.
 *
 * The tuple is positional over EVERY row rather than over the labelled ones,
 * for the reason the density tuples are: the labelled SET is a property of
 * `@glyphcss/maps`' row types, which move (`Peaks` became a `symbol` row
 * after this card was written). A wire list keyed on that set would be
 * reinterpreted the next time a row changed type; a slot per row cannot be.
 *
 * `happy-dom` and the `@glyphcss/effects` stub for the same reason every
 * other `mapsUrlState.*` link test needs both — `readInitialMapsState` reads
 * `window.location`, and the module graph reaches a canvas measurement.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import {
  MAPS_OSM_ANCHOR_SLOTS,
  MAPS_OSM_SUBLAYER_KEYS,
  MAPS_PARAM,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsCodecLegacyV1,
  mapsCodecLegacyV2,
  mapsOsmAnchorRecordFromTuple,
  mapsOsmAnchorsFromRecord,
  readInitialMapsState,
} from "./mapsUrlState";
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_LABEL_ANCHORS } from "./mapsOsm";

function setUrl(packed: string): void {
  window.history.replaceState(null, "", `/maps?${MAPS_PARAM}=${packed}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("the wire list and the row list stay the same length", () => {
  it("MAPS_OSM_ANCHOR_SLOTS is the tuple's frozen width, and it covers the row list exactly", () => {
    // A `floatTuple` reads a FIXED number of slots and then hands the cursor
    // to the next token, so its width IS the wire format — the same clause
    // `MAPS_OSM_DENSITY_SLOTS` lives under. A fourteenth OSM row means
    // ANOTHER token, never a wider one; this assertion is what makes that
    // breach loud instead of silent.
    expect(MAPS_OSM_ANCHOR_SLOTS).toBe(13);
    expect(MAPS_OSM_SUBLAYER_KEYS).toHaveLength(MAPS_OSM_ANCHOR_SLOTS);
    expect(MAPS_URL_DEFAULTS.osmLabelAnchors).toHaveLength(MAPS_OSM_ANCHOR_SLOTS);
  });

  it("packs an INDEX into the anchor vocabulary, which is itself append-only", () => {
    // The slot holds `MAP_OSM_LABEL_ANCHORS.indexOf(anchor)`, so that list's
    // ORDER is a wire format too — reordering it silently reinterprets every
    // link that ever carried a non-centred row. Pinned here rather than only
    // in `mapsOsm.labels.test.ts`, because this is the file that says why it
    // may not move.
    expect([...MAP_OSM_LABEL_ANCHORS]).toEqual([
      "center", "left", "right", "top", "bottom",
      "top-left", "top-right", "bottom-left", "bottom-right",
    ]);
  });

  it("defaults to every row centred — so an untouched card costs no token at all", () => {
    expect([...MAPS_URL_DEFAULTS.osmLabelAnchors]).toEqual(Array(MAPS_OSM_ANCHOR_SLOTS).fill(0));
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, palette: "heat" });
    expect(packed).not.toContain("l");
  });
});

describe("record <-> tuple", () => {
  it("packs by MAPS_OSM_SUBLAYER_KEYS position, not by object key order", () => {
    const tuple = mapsOsmAnchorsFromRecord({ "omt-water-labels": "bottom", "omt-places": "left" });
    expect(tuple).toHaveLength(MAPS_OSM_ANCHOR_SLOTS);
    expect(tuple[MAPS_OSM_SUBLAYER_KEYS.indexOf("omt-places")]).toBe(MAP_OSM_LABEL_ANCHORS.indexOf("left"));
    expect(tuple[MAPS_OSM_SUBLAYER_KEYS.indexOf("omt-water-labels")]).toBe(MAP_OSM_LABEL_ANCHORS.indexOf("bottom"));
    // Every row the record does not carry packs at the centred default.
    expect(tuple[MAPS_OSM_SUBLAYER_KEYS.indexOf("omt-roads")]).toBe(0);
  });

  it("round-trips a mixed set — every row keeps its own answer", () => {
    const record = { "omt-places": "left", "omt-peaks": "top", "omt-parks": "bottom-right", "omt-water-labels": "bottom" } as const;
    const back = mapsOsmAnchorRecordFromTuple(mapsOsmAnchorsFromRecord(record));
    for (const key of MAPS_OSM_SUBLAYER_KEYS) {
      expect(back[key], key).toBe((record as Record<string, string>)[key] ?? MAP_OSM_DEFAULT_ANCHOR);
    }
  });

  it("reads a short or out-of-range tuple as centred rather than as garbage", () => {
    // A tuple can be short (a hand-edited link) and a slot can name an index
    // the vocabulary does not have (a link from a future build that appended
    // an anchor). Neither may produce an `undefined` anchor: the widget would
    // then read it as the layer's own default anyway, so resolving it here
    // keeps the page's state honest about what is actually mounted.
    const short = mapsOsmAnchorRecordFromTuple([2]);
    expect(short["omt-places"]).toBe(MAP_OSM_DEFAULT_ANCHOR);
    expect(short[MAPS_OSM_SUBLAYER_KEYS[0]]).toBe("right");
    const bogus = mapsOsmAnchorRecordFromTuple(Array(MAPS_OSM_ANCHOR_SLOTS).fill(99));
    for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(bogus[key], key).toBe(MAP_OSM_DEFAULT_ANCHOR);
  });
});

describe("a mixed card survives a real link", () => {
  it("encodes and decodes through the live codec", () => {
    const state = {
      ...MAPS_URL_DEFAULTS,
      osmLabelAnchors: mapsOsmAnchorsFromRecord({ "omt-places": "left", "omt-water-labels": "bottom" }),
    };
    const packed = mapsCodec.encode(state);
    expect(packed).toContain("l");
    setUrl(packed);
    const read = readInitialMapsState();
    const record = mapsOsmAnchorRecordFromTuple(read.osmLabelAnchors);
    expect(record["omt-places"]).toBe("left");
    expect(record["omt-water-labels"]).toBe("bottom");
    expect(record["omt-peaks"]).toBe("center");
  });

  it("is ordered LAST, so a not-yet-updated build strands nothing", () => {
    // `decodePacked` stops at the first token it does not recognize and
    // defaults the rest. A field ordered before `l` would therefore be lost
    // by an older build reading a link written here; nothing is ordered
    // after it.
    const packed = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      palette: "heat",
      walk: true,
      osmLabelAnchors: mapsOsmAnchorsFromRecord({ "omt-places": "left" }),
    });
    const tokens = [...packed.slice(2)].filter((c) => /[A-Za-z]/.test(c));
    expect(packed.indexOf("l")).toBeGreaterThan(packed.indexOf("w"));
    expect(tokens.length).toBeGreaterThan(0);
  });
});

/**
 * Every packed link vendored across this suite, each captured while its own
 * schema was live, WITH the exact partial its own codec decoded it to before
 * token `l` existed.
 *
 * Adding a token can only hurt one of two ways — a collision with a
 * character the link already carries at a token position, or a field
 * stranded because `decodePacked` stopped early — and neither is a thing an
 * author can eyeball off the string. The snapshots are the check: they were
 * taken from the build immediately before this feature and must come back
 * character-for-character, key-for-key.
 */
const SHARED_LINKS: readonly { name: string; link: string; decoded: Record<string, unknown> }[] = [
  { name: "v1 precision A", link: "p1x24gy2hsE1", decoded: { centerLon: 16, centerLat: 64, colorEncoding: "atlas" } },
  { name: "v1 precision B", link: "p1x2-cy2p0s2e4", decoded: { centerLon: -1.2, centerLat: 90, span: 50.8 } },
  {
    name: "v1 orthographic", link: "p1p3e211x23fy3-19s2fat1mP1",
    decoded: { projection: "orthographic", exaggeration: 37, centerLon: 12.3, centerLat: -4.5, span: 55, tilt: 22, palette: "viridis" },
  },
  {
    name: "v2 terrain render mode", link: "p2x54wcdoy5rvh5ks33wbP1m0",
    decoded: { centerLon: 8.2275, centerLat: 46.8182, span: 12.49714227286078, palette: "viridis", terrainRenderMode: "wireframe" },
  },
  {
    name: "v2 braille char mode", link: "p2x6-27axsy5o1wu8s358yc1",
    decoded: { centerLon: -3.7, centerLat: 40.4, span: 29.994079134489695, charMode: "braille" },
  },
  {
    name: "v3 layer content", link: "p3e214x54wcdoy5rvh5ks32w0t21jP1F10L1fO238T1kI2dwR1",
    decoded: {
      exaggeration: 40, centerLon: 8.2275, centerLat: 46.8182, span: 6.501285977333473, tilt: 55,
      palette: "viridis", contourFloor: 0, layerMask: 15, osmMask: 116, terrainDensity: 2,
      contourInterval: 500, contourLabels: true,
    },
  },
  { name: "v3 M-only densities", link: "p3M1a1a1a1a1u1a1a1a1a1a", decoded: { osmDensities: [1, 1, 1, 1, 3, 1, 1, 1, 1, 1] } },
  // The reported real link from the field — a v3 string carrying both
  // density tuples, i.e. the longest wire shape in circulation.
  {
    name: "v3 M + J densities",
    link: "p3x6-yc1ady6-jrafbs36htt14E1b29zL18O34vgM1a1a1a1a1n1a1t1a1a1aJ1a1o1a",
    decoded: {
      centerLon: -57.668485, centerLat: -33.185927, span: 67.25558073863483, tilt: 4,
      colorEncoding: "atlas", bearing: 359, layerMask: 8, osmMask: 6316,
      osmDensities: [1, 1, 1, 1, 2.3, 1, 2.9, 1, 1, 1], osmDensitiesExt: [1, 2.4, 1],
    },
  },
];

describe("no already-shared link changes meaning", () => {
  it("carries the new token in none of them", () => {
    for (const { name, link } of SHARED_LINKS) {
      expect(link.slice(2), name).not.toContain("l");
    }
  });

  it("decodes each one to exactly the partial it decoded to before the token existed", () => {
    for (const { name, link, decoded } of SHARED_LINKS) {
      const codec = link[1] === "1" ? mapsCodecLegacyV1 : link[1] === "2" ? mapsCodecLegacyV2 : mapsCodec;
      expect(codec.decode(link), name).toEqual(decoded);
    }
  });

  it("gives each one every row centred, through the page's own entry point", () => {
    for (const { name, link } of SHARED_LINKS) {
      setUrl(link);
      const state = readInitialMapsState();
      expect([...state.osmLabelAnchors], name).toEqual(Array(MAPS_OSM_ANCHOR_SLOTS).fill(0));
      const record = mapsOsmAnchorRecordFromTuple(state.osmLabelAnchors);
      for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(record[key], `${name} / ${key}`).toBe(MAP_OSM_DEFAULT_ANCHOR);
    }
  });

  it("re-encodes the longest real link to the byte-identical string it decoded from", () => {
    // The strongest form of "unchanged", and it holds exactly for the link
    // that already carries every field the live schema would write for it —
    // decode it, re-encode the decoded state, require the same characters.
    // (The others gain the feature-detected `colorEncoding` on re-encode,
    // which is `MAPS_URL_DEFAULTS.colorEncoding`'s own documented behaviour
    // and predates this token.)
    const { link } = SHARED_LINKS[SHARED_LINKS.length - 1];
    setUrl(link);
    expect(mapsCodec.encode(readInitialMapsState())).toBe(link);
  });
});
