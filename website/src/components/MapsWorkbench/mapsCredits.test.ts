import { describe, expect, it } from "vitest";

import {
  mapCreditNoticeText,
  mapCreditRequiresNotice,
  mapCreditSummary,
  type MapCreditSource,
} from "./mapsCredits";

/**
 * The exact five sources this page mounts with the OSM card on, in the order
 * `createGlyphMap().getAttributions()` returns them — copied from the built
 * page's own credit line, not invented.
 */
const FIVE: readonly MapCreditSource[] = [
  { name: "NOAA NCEI (ETOPO1)", license: "Public domain", date: "2009" },
  { name: "Natural Earth", license: "Public domain", date: "v5.1.1 (via world-atlas)" },
  { name: "OpenStreetMap contributors", license: "ODbL" },
  { name: "OpenMapTiles", license: "CC-BY 4.0" },
  { name: "OpenFreeMap", license: "ODbL" },
];

/** The default page: terrain plus borders, both public domain. */
const TWO: readonly MapCreditSource[] = FIVE.slice(0, 2);

describe("which credits are obligations", () => {
  it("treats public domain as no obligation", () => {
    expect(mapCreditRequiresNotice("Public domain")).toBe(false);
    expect(mapCreditRequiresNotice("public  domain")).toBe(false);
    expect(mapCreditRequiresNotice("CC0-1.0")).toBe(false);
  });

  it("treats ODbL and CC-BY as obligations", () => {
    expect(mapCreditRequiresNotice("ODbL")).toBe(true);
    expect(mapCreditRequiresNotice("CC-BY 4.0")).toBe(true);
  });

  // The safe direction to be wrong in: a provider whose licence string this
  // page has never seen gets NAMED rather than silently compressed away.
  it("treats an unknown or missing licence as an obligation", () => {
    expect(mapCreditRequiresNotice("Some New Licence 2.0")).toBe(true);
    expect(mapCreditRequiresNotice(undefined)).toBe(true);
  });
});

describe("the always-visible line", () => {
  it("names every obligated source on desktop and hides only the courtesy ones", () => {
    const s = mapCreditSummary(FIVE, { maxNames: 3 });
    expect(s.named).toEqual(["OpenStreetMap contributors", "OpenMapTiles", "OpenFreeMap"]);
    expect(s.hiddenCount).toBe(2);
    expect(mapCreditNoticeText(s)).toBe("© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap");
  });

  // The whole point of the compression: no obligated credit may be dropped in
  // favour of a public-domain one just because it was mounted later.
  it("never spends the line on a public-domain source while an obligation is unnamed", () => {
    const s = mapCreditSummary(FIVE, { maxNames: 1 });
    expect(s.named).toEqual(["OpenStreetMap contributors"]);
    expect(s.named).not.toContain("Natural Earth");
    expect(s.named).not.toContain("NOAA NCEI (ETOPO1)");
  });

  it("falls back to naming the sources themselves when nothing is obligated", () => {
    const s = mapCreditSummary(TWO, { maxNames: 3 });
    expect(s.named).toEqual(["NOAA NCEI (ETOPO1)", "Natural Earth"]);
    expect(s.hiddenCount).toBe(0);
    // No obligation, so no copyright mark — these works are not copyrighted.
    expect(s.copyrighted).toBe(false);
    expect(mapCreditNoticeText(s)).toBe("NOAA NCEI (ETOPO1) · Natural Earth");
  });

  it("keeps at least one name however small the budget", () => {
    expect(mapCreditSummary(FIVE, { maxNames: 0 }).named).toHaveLength(1);
    expect(mapCreditSummary(FIVE, { maxNames: -3 }).named).toHaveLength(1);
  });

  it("counts every source behind the affordance, obligated or not", () => {
    const s = mapCreditSummary(FIVE, { maxNames: 1 });
    expect(s.hiddenCount).toBe(4);
    // …and the expanded panel still carries all five, licences and dates.
    expect(s.sources).toHaveLength(5);
    expect(s.sources.map((x) => x.license)).toEqual([
      "Public domain", "Public domain", "ODbL", "CC-BY 4.0", "ODbL",
    ]);
  });

  it("credits one provider once when two layers mount it", () => {
    const s = mapCreditSummary([...FIVE, FIVE[2], FIVE[3]], { maxNames: 3 });
    expect(s.sources).toHaveLength(5);
    expect(s.hiddenCount).toBe(2);
  });
});
