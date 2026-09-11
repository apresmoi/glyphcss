// @vitest-environment happy-dom
/**
 * The DATASETS card's three URL tokens — `q` (which rows), `r` (their
 * densities), `z` (their label placements) — and the one guarantee that
 * matters more than any of them: **every link already shared decodes to
 * exactly the map it always decoded to.**
 *
 * ## What could go wrong, and what pins each of them
 *
 * 1. **A new token collides with one an old link carries.** `decodePacked`
 *    is token-keyed, so a duplicate would silently reinterpret a field. The
 *    codec asserts uniqueness at construction; this file additionally pins
 *    that the three are the exact characters chosen and that nothing else in
 *    the schema holds them.
 * 2. **A new token is ordered before an existing one.** `decodePacked` stops
 *    at the first token it does not recognize and keeps what it parsed, so a
 *    link written by THIS build and opened by a not-yet-deployed one strands
 *    every field ordered after the first unknown token. Appending last means
 *    nothing is ordered after them, so nothing can be stranded.
 * 3. **The omission default moves.** This is the one that has actually
 *    shipped a break on this page: the OSM card's omission sentinel was
 *    DERIVED from `MAP_OSM_DEFAULT_ON`, so the day a row joined that list,
 *    the real shared link `/maps?m=p3L1b` — which carries no `O` — started
 *    labelling every ocean. Same string, different map. So this card has two
 *    constants from the start: `MAPS_DATASET_MASK_LINK_DEFAULT` (frozen,
 *    what a link means) and `MAP_DATASET_DEFAULT_ON` (free, what a fresh page
 *    opens on), and this file pins that they are separate and that the page
 *    writes an explicit `q` whenever they differ.
 * 4. **A tuple's width changes.** A `floatTuple` reads its declared width and
 *    hands the cursor on, so widening `r`/`z` in place would make every
 *    already-shared link decode the token AFTER it as a density. Pinned
 *    against the row count in `mapsUrlState.layers.test.ts`; pinned as a
 *    literal here.
 *
 * `happy-dom` and the `@glyphcss/effects` stub for the reason every
 * `mapsUrlState.*` test needs both — see `mapsUrlState.legacyLayerLink.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import {
  MAPS_DATASET_LINK_DEFAULT_ON,
  MAPS_DATASET_MASK_LINK_DEFAULT,
  MAPS_DATASET_MASK_PAGE_DEFAULT,
  MAPS_DATASET_ROW_KEYS,
  MAPS_DATASET_SLOTS,
  MAPS_PARAM,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsDatasetAnchorRecordFromTuple,
  mapsDatasetAnchorsFromRecord,
  mapsDatasetDensitiesFromRecord,
  mapsDatasetDensityRecordFromTuple,
  mapsDatasetMaskFromRows,
  mapsDatasetRowsFromMask,
  mapsLayerMaskFromVisibility,
  mapsLayerVisibilityFromMask,
  readInitialMapsState,
} from "./mapsUrlState";
import { MAP_DATASET_DEFAULT_ON } from "./mapsDatasets";

/**
 * A REAL link, captured from the page before the Datasets card existed:
 * `mapsUrlState.osmDefaultLink.test.ts`'s own vendored string. `L1b` is
 * `layerMask` 11 — terrain, borders and the OSM card — so bit 10 is clear and
 * this link's map has no Datasets card in it at all.
 */
const LEGACY_LINK = "p3L1b";

function setUrl(packed: string): void {
  window.history.replaceState(null, "", `/maps?${MAPS_PARAM}=${packed}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("the three tokens themselves", () => {
  it("are `q`, `r` and `z`, consecutive, with only later-appended fields behind them", () => {
    const tokens = mapsCodec.fields.map((f) => f.token);
    // The rule is APPEND-ONLY, not "these three are for ever last": the
    // Live card's `0`/`1` were appended AFTER this card landed, which is
    // exactly what the rule permits and what keeps a `q`/`r`/`z` link
    // decoding unchanged — `decodePacked` walks the string in schema order,
    // so a field ordered after these three can never strand them. Pinning
    // the whole tail rather than just the triple keeps both halves loud: an
    // INSERTION before `q`, and a reorder inside it, still go red here.
    expect(tokens.slice(-5)).toEqual(["q", "r", "z", "0", "1"]);
    // Nothing else holds them — `createUrlCodec` throws on a duplicate, but
    // an assertion that only fires at import time is easy to lose.
    expect(tokens.filter((t) => t === "q")).toHaveLength(1);
    expect(tokens.filter((t) => t === "r")).toHaveLength(1);
    expect(tokens.filter((t) => t === "z")).toHaveLength(1);
  });

  it("keeps the two per-row tuples at one frozen slot per row", () => {
    expect(MAPS_DATASET_SLOTS).toBe(5);
    expect(MAPS_DATASET_ROW_KEYS).toHaveLength(MAPS_DATASET_SLOTS);
    const r = mapsCodec.fields.find((f) => f.token === "r")!.type as { length: number };
    const z = mapsCodec.fields.find((f) => f.token === "z")!.type as { length: number };
    expect(r.length).toBe(5);
    expect(z.length).toBe(5);
  });

  it("pins the row key order, which is the wire format", () => {
    // LITERALS. Reading this off `MAP_DATASET_ROWS` would move with the card
    // — the cross-check that the two still AGREE lives in
    // `mapsUrlState.layers.test.ts`, and it is the card that has to yield.
    expect([...MAPS_DATASET_ROW_KEYS]).toEqual([
      "ds-regions", "ds-marine", "ds-cables", "ds-datacenters", "ds-dams",
    ]);
  });
});

describe("a link written before the card existed", () => {
  it("decodes to no card, no rows, no densities and no displaced labels", () => {
    setUrl(LEGACY_LINK);
    const state = readInitialMapsState();

    // The link's own map, untouched: terrain, borders and OSM, exactly as
    // `mapsUrlState.osmDefaultLink.test.ts` reads it today.
    expect(mapsLayerVisibilityFromMask(state.layerMask).osm).toBe(true);
    expect(state.osmMask).toBe(92);

    // ...and nothing of this card in it. LITERALS throughout.
    expect(mapsLayerVisibilityFromMask(state.layerMask).datasets).toBe(false);
    expect(state.datasetMask).toBe(0);
    expect(state.datasetDensities).toEqual([1, 1, 1, 1, 1]);
    expect(state.datasetLabelAnchors).toEqual([0, 0, 0, 0, 0]);
  });

  it("still decodes every field ordered before the new tokens", () => {
    // The failure the "append last" rule prevents is a STRANDED TAIL: had
    // `q` been inserted mid-schema, a decoder reading it as an unknown token
    // would stop and default everything after it. Re-decoding a legacy link
    // and finding its own values intact is the check.
    setUrl(LEGACY_LINK);
    const state = readInitialMapsState();
    expect(state.projection).toBe(MAPS_URL_DEFAULTS.projection);
    expect(state.layerMask).toBe(11);
    expect(state.walk).toBe(false);
    expect(state.terrainFloor).toBe(MAPS_URL_DEFAULTS.terrainFloor);
  });

  it("is byte-identical when the page re-encodes it unchanged", () => {
    // The strongest statement available: decode the link, write it back, and
    // get the same string. A new field that encoded even at its default
    // would lengthen every existing link on the first save.
    //
    // Through `mapsCodec` rather than `readInitialMapsState`, because that
    // function applies the FEATURE-DETECTED `colorEncoding` on top (an
    // atlas-capable browser writes an explicit `E1` that the link never
    // carried — see `MAPS_URL_DEFAULTS.colorEncoding`'s own doc). That is
    // pre-existing behaviour about a different field; this assertion is
    // about the three tokens added here adding nothing.
    expect(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(LEGACY_LINK) })).toBe(LEGACY_LINK);
  });
});

describe("the omission default is frozen, and separate from the page's", () => {
  it("is the empty set, spelled out rather than derived", () => {
    expect([...MAPS_DATASET_LINK_DEFAULT_ON]).toEqual([]);
    expect(MAPS_DATASET_MASK_LINK_DEFAULT).toBe(0);
    expect(MAPS_URL_DEFAULTS.datasetMask).toBe(MAPS_DATASET_MASK_LINK_DEFAULT);
  });

  it("is a DIFFERENT constant from the page's opening set, even while the two agree", () => {
    // They are identical today. The property being pinned is that they are
    // two names, so moving the page's opening set cannot move what a shared
    // link means — the exact break `MAP_OSM_DEFAULT_ON` once caused.
    expect(MAPS_DATASET_MASK_PAGE_DEFAULT).toBe(mapsDatasetMaskFromRows(
      Object.fromEntries(MAP_DATASET_DEFAULT_ON.map((id) => [id, true])),
    ));
    expect(MAPS_DATASET_LINK_DEFAULT_ON).not.toBe(MAP_DATASET_DEFAULT_ON);
  });

  it("a link that mounts the CARD but names no rows takes the frozen set", () => {
    // The gap the OSM card's own break lived in: `L` on, `q` omitted. It is
    // reachable by hand today, and it is what a share written now would look
    // like if the page's opening rows ever gained a member while this
    // sentinel stayed put.
    const packed = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      layerMask: mapsLayerMaskFromVisibility({ terrain: true, borders: true, datasets: true }),
    });
    expect(packed).not.toContain("q");
    setUrl(packed);
    const state = readInitialMapsState();
    expect(mapsLayerVisibilityFromMask(state.layerMask).datasets).toBe(true);
    expect(state.datasetMask).toBe(0);
  });

  it("a fresh page with no link at all opens on the page's own rows", () => {
    window.history.replaceState(null, "", "/maps");
    const rows = mapsDatasetRowsFromMask(readInitialMapsState().datasetMask);
    for (const id of MAPS_DATASET_ROW_KEYS) {
      expect(rows[id]).toBe(MAP_DATASET_DEFAULT_ON.includes(id));
    }
  });
});

describe("round-trip", () => {
  it("restores an arbitrary row set, density set and placement set exactly", () => {
    const rows = { "ds-regions": false, "ds-marine": true, "ds-cables": true, "ds-datacenters": false, "ds-dams": true };
    const densities = { "ds-regions": 1, "ds-marine": 3.2, "ds-cables": 2.1, "ds-datacenters": 1, "ds-dams": 1 };
    const anchors = { "ds-regions": "center", "ds-marine": "center", "ds-cables": "center", "ds-datacenters": "center", "ds-dams": "bottom" };

    const packed = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      layerMask: mapsLayerMaskFromVisibility({ terrain: true, datasets: true }),
      datasetMask: mapsDatasetMaskFromRows(rows),
      datasetDensities: mapsDatasetDensitiesFromRecord(densities),
      datasetLabelAnchors: mapsDatasetAnchorsFromRecord(anchors),
    });
    // All three tokens are actually written — a round-trip that encoded
    // nothing would pass vacuously.
    expect(packed).toContain("q");
    expect(packed).toContain("r");
    expect(packed).toContain("z");

    setUrl(packed);
    const state = readInitialMapsState();
    expect(mapsDatasetRowsFromMask(state.datasetMask)).toEqual(rows);
    const back = mapsDatasetDensityRecordFromTuple(state.datasetDensities);
    for (const [id, v] of Object.entries(densities)) expect(back[id]).toBeCloseTo(v, 6);
    expect(mapsDatasetAnchorRecordFromTuple(state.datasetLabelAnchors)["ds-dams"]).toBe("bottom");
  });

  it("omits every token while the card is untouched, so an unused card costs a link nothing", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS });
    expect(packed).toBe("p3");
  });

  it("fills a hand-truncated tuple at the defaults rather than producing holes", () => {
    // A link edited by hand, or written by a build with fewer rows.
    expect(mapsDatasetDensityRecordFromTuple([2])).toEqual({
      "ds-regions": 2, "ds-marine": 1, "ds-cables": 1, "ds-datacenters": 1, "ds-dams": 1,
    });
    // ...and an anchor index the vocabulary does not have resolves to the
    // centred default rather than to `undefined`.
    expect(mapsDatasetAnchorRecordFromTuple([99, 99, 99, 99, 99])["ds-dams"]).toBe("center");
  });
});
