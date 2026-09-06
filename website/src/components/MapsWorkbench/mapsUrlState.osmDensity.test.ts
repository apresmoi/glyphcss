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
  MAPS_OSM_DENSITY_SLOTS,
  MAPS_OSM_SUBLAYER_KEYS,
  MAPS_PARAM,
  MAPS_URL_DEFAULTS,
  mapsCodec,
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
    expect(MAPS_OSM_SUBLAYER_KEYS).toHaveLength(MAPS_OSM_DENSITY_SLOTS);
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
  it("decodes an osmDensity-carrying link to all ten rows at that value", () => {
    // Exactly what a link shared before `M` existed looks like: `Q` set, no
    // `M` anywhere.
    const legacy = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, osmDensity: 2.9 });
    expect(legacy).toContain("Q");
    expect(legacy).not.toContain("M");

    setUrl(legacy);
    const state = readInitialMapsState();
    const record = mapsOsmDensityRecordFromTuple(state.osmDensities);
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
