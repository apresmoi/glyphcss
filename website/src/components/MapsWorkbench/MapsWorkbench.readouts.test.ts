// @vitest-environment happy-dom
/**
 * Every layer-card readout is a text INPUT now (`mapsKit.tsx`'s
 * `MapsReadout`, matching the Dock's own type-to-set number rows), so each
 * row's `parse` has to be an exact inverse of its `format`: a reader who
 * focuses a row and blurs it without editing must land back on the value
 * they started from.
 *
 * That is not automatic. `Number.parseFloat` — which is all `SynthWorkbench`'s
 * `EditableReadout` has — reads `"1.2M"` as 1.2 people and `"120 km"` as 120
 * metres, so a bare focus-then-blur on either of those rows would silently
 * destroy the value. These three formats are the ones that need their own
 * inverse; this file is what stops one of them drifting from the other.
 */
import { describe, expect, it, vi } from "vitest";

// Same import-time canvas stub `MapsWorkbench.atlasAvailability.test.ts`
// documents: this module's import chain reaches `useRenderingFolder.ts`,
// which calibrates a ramp against a real canvas at import time.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { formatKm, formatPeople, parseKm, parsePeople, parsePriority } from "./mapsKit";

// The bounds each row actually declares (MapsWorkbench.tsx's LAYER_SLIDERS).
const MODEL_HEIGHT = { min: 20_000, max: 600_000 } as const;
const MIN_POP = { min: 0, max: 10_000_000 } as const;
const PRIORITY = { min: 3, max: 8 } as const; // COUNTRY_PRIORITY_RANGE (countryTilesProvider.ts)

describe("model height — `120 km`", () => {
  const parse = parseKm(MODEL_HEIGHT.min, MODEL_HEIGHT.max);

  it("round-trips its own format, so an unedited blur is a no-op", () => {
    for (const metres of [20_000, 120_000, 350_000, 600_000]) {
      expect(parse(formatKm(metres))).toEqual({ value: metres });
    }
  });

  it("reads a bare number as kilometres, the unit the row prints", () => {
    expect(parse("120")).toEqual({ value: 120_000 });
    expect(parse("120 km")).toEqual({ value: 120_000 });
  });

  it("still accepts an explicit metres suffix, and clamps to the row's bounds", () => {
    expect(parse("50000 m")).toEqual({ value: 50_000 });
    expect(parse("9999 km")).toEqual({ value: 600_000 });
    expect(parse("1 km")).toEqual({ value: 20_000 });
  });

  it("reverts on anything that isn't a height", () => {
    for (const junk of ["", "tall", "12 miles", "1.2 kb"]) expect(parse(junk)).toBeNull();
  });

  it("reads the unit case-insensitively", () => {
    // `M` is metres on this row, not a magnitude suffix — the row's own
    // format never prints one, and its unit letters are m/km.
    expect(parse("120 KM")).toEqual({ value: 120_000 });
    expect(parse("50000M")).toEqual({ value: 50_000 });
  });
});

describe("symbol population — `1.2M` / `500k`", () => {
  const parse = parsePeople(MIN_POP.min, MIN_POP.max);

  it("round-trips its own format at both magnitudes", () => {
    // Below a million the format rounds to whole thousands, so the round trip
    // is exact only on values it can print — which is what a reader sees.
    for (const n of [0, 500_000, 1_200_000, 10_000_000]) {
      expect(parse(formatPeople(n))).toEqual({ value: n });
    }
  });

  it("would have read its own readout as 1.2 people without the suffix rule", () => {
    expect(formatPeople(1_200_000)).toBe("1.2M");
    expect(Number.parseFloat("1.2M")).toBe(1.2); // the trap this parser exists for
    expect(parse("1.2M")).toEqual({ value: 1_200_000 });
  });

  it("accepts a plain head count and clamps to the row's bounds", () => {
    expect(parse("1200000")).toEqual({ value: 1_200_000 });
    expect(parse("99M")).toEqual({ value: 10_000_000 });
    expect(parse("-5")).toEqual({ value: 0 });
  });

  it("reverts on anything that isn't a population", () => {
    for (const junk of ["", "lots", "1.2 billion"]) expect(parse(junk)).toBeNull();
  });
});

describe("symbol prominence — `≥ 3`", () => {
  const parse = parsePriority(PRIORITY.min, PRIORITY.max);

  it("consumes the comparison symbol its format prints", () => {
    expect(Number.parseFloat("≥ 3")).toBeNaN(); // the trap this parser exists for
    expect(parse("≥ 3")).toEqual({ value: 3 });
    expect(parse(">= 7")).toEqual({ value: 7 });
    expect(parse("7")).toEqual({ value: 7 });
  });

  it("rounds and clamps to the tier range", () => {
    expect(parse("6.4")).toEqual({ value: 6 });
    expect(parse("99")).toEqual({ value: 8 });
    expect(parse("0")).toEqual({ value: 3 });
  });

  it("reverts on anything that isn't a tier", () => {
    for (const junk of ["", "top", "≥"]) expect(parse(junk)).toBeNull();
  });
});
