// @vitest-environment happy-dom
/**
 * The OSM card's per-row densities on the wire.
 *
 * Token `Q` (`osmDensity`) is a SINGLE float and has been in shared links
 * since the layer-content tokens landed. The card now holds one density per
 * row, which no single float can carry, so a new token `M`
 * (`osmDensities`) carries the vector and `Q` stays exactly what it was.
 * The append-only rule (`MAPS_LAYER_KEYS`' doc) then gives the two halves
 * this file asserts:
 *
 *  - **A legacy `Q`-only link still decodes**, and seeds EVERY row with its
 *    value — which is precisely the map that link described, since the value
 *    was applied to every enabled row when it was written.
 *  - **A mixed card round-trips through `M`**, and writes `Q` at whatever
 *    single number is still true (the shared value when uniform, the
 *    schema default when not — there is no honest single number for ten
 *    different ones, and a default costs zero characters).
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
  MAPS_OSM_DENSITY_EXT_SLOTS,
  MAPS_OSM_DENSITY_SLOTS,
  MAPS_OSM_SUBLAYER_KEYS,
  MAPS_PARAM,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsOsmDensitiesExtFromRecord,
  mapsOsmDensitiesFromRecord,
  mapsOsmDensityRecordFromTuple,
  readInitialMapsState,
} from "./mapsUrlState";
import { MAP_OSM_DEFAULT_DENSITY, mapOsmDensityRecord } from "./mapsOsm";

function setUrl(packed: string): void {
  window.history.replaceState(null, "", `/maps?${MAPS_PARAM}=${packed}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("the wire list and the row list stay the same length", () => {
  it("MAPS_OSM_DENSITY_SLOTS is the tuple's frozen width, and the key list has not outgrown it", () => {
    // A `floatTuple` reads a FIXED number of slots and then hands the cursor
    // to the next token, so its width IS the wire format: appending an
    // eleventh OSM row without dealing with this would make every already-
    // shared `M` link decode the following token as a density. The rule is
    // the same append-only one `MAPS_OSM_SUBLAYER_KEYS` already lives under
    // — this assertion is what makes the breach loud instead of silent.
    expect(MAPS_OSM_DENSITY_SLOTS).toBe(10);
    // The row list DID outgrow it — three rows were appended when the
    // mapping grew `park`/`aeroway`/`water_name`. `M` stayed ten wide (a
    // wider one reinterprets every shared link) and the overflow rides in
    // token `J`, so the invariant is that the two frozen widths still cover
    // the row list exactly. Its own block below asserts `J`'s half.
    expect(MAPS_OSM_SUBLAYER_KEYS).toHaveLength(MAPS_OSM_DENSITY_SLOTS + MAPS_OSM_DENSITY_EXT_SLOTS);
    expect(MAPS_URL_DEFAULTS.osmDensities).toHaveLength(MAPS_OSM_DENSITY_SLOTS);
  });

  it("defaults to every row at 1x — so an untouched card costs no token at all", () => {
    expect([...MAPS_URL_DEFAULTS.osmDensities]).toEqual(Array(MAPS_OSM_DENSITY_SLOTS).fill(1));
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, palette: "heat" });
    expect(packed).not.toContain("M");
  });
});

describe("record <-> tuple", () => {
  it("packs by MAPS_OSM_SUBLAYER_KEYS position, not by object key order", () => {
    const tuple = mapsOsmDensitiesFromRecord({ ...mapOsmDensityRecord(1), "omt-roads": 3.5 });
    const roads = MAPS_OSM_SUBLAYER_KEYS.indexOf("omt-roads");
    expect(tuple[roads]).toBe(3.5);
    expect(tuple.filter((v) => v !== 1)).toEqual([3.5]);
  });

  it("unpacks to a complete record over the row list", () => {
    const record = mapsOsmDensityRecordFromTuple(mapsOsmDensitiesFromRecord({ ...mapOsmDensityRecord(2), "omt-pois": 4 }));
    expect(Object.keys(record).sort()).toEqual([...MAPS_OSM_SUBLAYER_KEYS].sort());
    expect(record["omt-pois"]).toBe(4);
    expect(record["omt-water"]).toBe(2);
  });

  it("a row missing from the record packs at the 1x default rather than as a hole", () => {
    const tuple = mapsOsmDensitiesFromRecord({ "omt-roads": 2 });
    expect(tuple).toHaveLength(MAPS_OSM_DENSITY_SLOTS);
    expect(tuple.every((v) => Number.isFinite(v))).toBe(true);
    expect(tuple.filter((v) => v !== MAP_OSM_DEFAULT_DENSITY)).toEqual([2]);
  });
});

describe("a MIXED card round-trips", () => {
  it("preserves every row's own number through encode -> decode", () => {
    const record = {
      ...mapOsmDensityRecord(1),
      "omt-water": 1.5,
      "omt-roads": 3,
      "omt-buildings": 2.4,
      "omt-boundaries": 4,
    };
    const state = { ...MAPS_URL_DEFAULTS, osmDensities: mapsOsmDensitiesFromRecord(record) };
    const packed = mapsCodec.encode(state);
    expect(packed).toContain("M");
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(packed) };
    const back = mapsOsmDensityRecordFromTuple(decoded.osmDensities);
    for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(back[key], key).toBeCloseTo(record[key], 6);
  });

  it("survives being read back through the real entry point, with every OTHER token intact", () => {
    const record = { ...mapOsmDensityRecord(1), "omt-roads": 3, "omt-places": 2.1 };
    setUrl(mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      projection: "mercator",
      palette: "heat",
      osmDensities: mapsOsmDensitiesFromRecord(record),
      contourInterval: 250,
    }));
    const state = readInitialMapsState();
    const back = mapsOsmDensityRecordFromTuple(state.osmDensities);
    expect(back["omt-roads"]).toBeCloseTo(3, 6);
    expect(back["omt-places"]).toBeCloseTo(2.1, 6);
    expect(back["omt-water"]).toBe(1);
    // `M` is appended LAST, so nothing ordered before it can be stranded.
    expect(state.projection).toBe("mercator");
    expect(state.palette).toBe("heat");
    expect(state.contourInterval).toBe(250);
  });
});

describe("a legacy Q-only link seeds every row", () => {
  it("decodes an osmDensity-carrying link to every row at that value", () => {
    // Exactly what a link shared before `M` existed looks like: `Q` set, no
    // `M` anywhere.
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, osmDensity: 2.9 });
    expect(legacy).toContain("Q");
    expect(legacy).not.toContain("M");

    setUrl(legacy);
    const state = readInitialMapsState();
    const record = mapsOsmDensityRecordFromTuple(state.osmDensities, state.osmDensitiesExt);
    for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(record[key], key).toBeCloseTo(2.9, 6);
  });

  it("a link with neither token opens every row at 1x", () => {
    setUrl(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, palette: "heat" }));
    const record = mapsOsmDensityRecordFromTuple(readInitialMapsState().osmDensities);
    for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(record[key], key).toBe(MAP_OSM_DEFAULT_DENSITY);
  });

  it("an explicit M wins over a Q carried beside it — the vector is the truth", () => {
    const record = { ...mapOsmDensityRecord(1), "omt-roads": 3 };
    setUrl(mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      osmDensity: 2.9,
      osmDensities: mapsOsmDensitiesFromRecord(record),
    }));
    const back = mapsOsmDensityRecordFromTuple(readInitialMapsState().osmDensities);
    expect(back["omt-roads"]).toBeCloseTo(3, 6);
    expect(back["omt-water"]).toBe(1);
  });

  it("a REAL pre-M link — the one widget.shadowDensity.test.ts's bug report carried — still decodes, unchanged", () => {
    // `Q` at 2.9 with the buildings/landcover/landuse/roads rows armed.
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, osmDensity: 2.9, osmMask: 0b0100110011 });
    setUrl(legacy);
    const state = readInitialMapsState();
    expect(state.osmDensity).toBeCloseTo(2.9, 6);
    expect(state.osmMask).toBe(0b0100110011);
    const record = mapsOsmDensityRecordFromTuple(state.osmDensities);
    expect(record["omt-roads"]).toBeCloseTo(2.9, 6);
    expect(record["omt-pois"]).toBeCloseTo(2.9, 6);
  });
});

/**
 * ── The ELEVENTH row and beyond: token `J`.
 *
 * `M` is a `floatTuple` of exactly {@link MAPS_OSM_DENSITY_SLOTS} slots, and
 * a `floatTuple` reads its fixed width and then hands the cursor to the next
 * token — so the width IS the wire format. Three new OSM rows (`omt-parks`,
 * `omt-aeroways`, `omt-water-labels`) took the row list past ten. Widening
 * `M` in place would make every already-shared `M` link decode the token
 * AFTER it as a density and strand everything from there on, so the extra
 * slots ride in a NEW token instead and `M` keeps meaning exactly what it
 * meant: the first ten rows, in the first ten rows' order.
 *
 * Which is also why `J` is frozen at three rather than given headroom: an
 * over-wide tuple would decode a shared link's following token as a density
 * the moment anyone appended a fourteenth row, so the width and the row
 * count are asserted EQUAL below and a fourteenth row means another token —
 * loud, not silent.
 */
describe("token J — the OSM rows past the frozen ten", () => {
  it("J's width and the rows past M's ten are the same number, and together they cover the row list exactly", () => {
    expect(MAPS_OSM_DENSITY_SLOTS).toBe(10);
    expect(MAPS_OSM_DENSITY_EXT_SLOTS).toBe(3);
    expect(MAPS_OSM_SUBLAYER_KEYS).toHaveLength(MAPS_OSM_DENSITY_SLOTS + MAPS_OSM_DENSITY_EXT_SLOTS);
    expect(MAPS_URL_DEFAULTS.osmDensitiesExt).toHaveLength(MAPS_OSM_DENSITY_EXT_SLOTS);
    expect([...MAPS_URL_DEFAULTS.osmDensitiesExt]).toEqual(Array(MAPS_OSM_DENSITY_EXT_SLOTS).fill(1));
  });

  it("carries only the appended rows, and leaves M byte-for-byte what it was", () => {
    // The property that makes this safe: moving a row that lives in `J`
    // must not move one character of `M`, and vice versa.
    const onlyExt = { ...mapOsmDensityRecord(1), "omt-aeroways": 2.5 };
    expect([...mapsOsmDensitiesFromRecord(onlyExt)]).toEqual(Array(MAPS_OSM_DENSITY_SLOTS).fill(1));
    expect(mapsOsmDensitiesExtFromRecord(onlyExt)[MAPS_OSM_SUBLAYER_KEYS.indexOf("omt-aeroways") - MAPS_OSM_DENSITY_SLOTS]).toBe(2.5);

    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, osmDensitiesExt: mapsOsmDensitiesExtFromRecord(onlyExt) });
    expect(packed).toContain("J");
    expect(packed).not.toContain("M");

    const onlyBase = { ...mapOsmDensityRecord(1), "omt-roads": 3 };
    const basePacked = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, osmDensities: mapsOsmDensitiesFromRecord(onlyBase) });
    expect(basePacked).toContain("M");
    expect(basePacked).not.toContain("J");
  });

  it("round-trips a card that is mixed ACROSS the two tokens", () => {
    const record = { ...mapOsmDensityRecord(1), "omt-roads": 3, "omt-parks": 2.2, "omt-water-labels": 1.7 };
    const packed = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      osmDensities: mapsOsmDensitiesFromRecord(record),
      osmDensitiesExt: mapsOsmDensitiesExtFromRecord(record),
    });
    setUrl(packed);
    const state = readInitialMapsState();
    const back = mapsOsmDensityRecordFromTuple(state.osmDensities, state.osmDensitiesExt);
    expect(Object.keys(back).sort()).toEqual([...MAPS_OSM_SUBLAYER_KEYS].sort());
    for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(back[key], key).toBeCloseTo(record[key], 6);
  });

  it("an already-shared M link decodes character-for-character as it did, with the new rows at 1x", () => {
    // A REAL ten-slot `M` string, captured from this codec before `J`
    // existed: `M` followed by ten base36 densities, every row at 1x except
    // `omt-roads` at 3.
    const legacyM = "p3M1a1a1a1a1u1a1a1a1a1a";
    setUrl(legacyM);
    const state = readInitialMapsState();
    const back = mapsOsmDensityRecordFromTuple(state.osmDensities, state.osmDensitiesExt);
    expect(back["omt-roads"]).toBeCloseTo(3, 6);
    for (const key of MAPS_OSM_SUBLAYER_KEYS) {
      if (key === "omt-roads") continue;
      expect(back[key], key).toBe(MAP_OSM_DEFAULT_DENSITY);
    }
  });

  it("a legacy Q-only link seeds the appended rows too — one number applied to every enabled row is what that link meant", () => {
    setUrl(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, osmDensity: 2.9 }));
    const state = readInitialMapsState();
    const record = mapsOsmDensityRecordFromTuple(state.osmDensities, state.osmDensitiesExt);
    for (const key of MAPS_OSM_SUBLAYER_KEYS) expect(record[key], key).toBeCloseTo(2.9, 6);
  });

  it("J is appended LAST, so a build that does not know it strands nothing", () => {
    // `decodePacked` stops at the first unrecognized token. `J` is the final
    // field in the schema, so an older build reading a `J`-carrying link
    // decodes every other token first and then stops with nothing after it.
    const packed = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      palette: "heat",
      walk: true,
      osmDensitiesExt: mapsOsmDensitiesExtFromRecord({ ...mapOsmDensityRecord(1), "omt-parks": 2 }),
    });
    // `w` (walk) was the schema's last field until now, and `P` (palette)
    // is an early one — both are written before `J`, and the link still
    // decodes in full.
    for (const token of ["P", "w"]) expect(packed.indexOf(token)).toBeLessThan(packed.indexOf("J"));
    const decoded = mapsCodec.decode(packed);
    expect(decoded.palette).toBe("heat");
    expect(decoded.walk).toBe(true);
    // And truncating `J` off the end — which is exactly what a build that
    // does not know the token sees — leaves every other field intact.
    const truncated = mapsCodec.decode(packed.slice(0, packed.indexOf("J")));
    expect(truncated.palette).toBe("heat");
    expect(truncated.walk).toBe(true);
    expect(truncated.osmDensitiesExt).toBeUndefined();
  });
});
