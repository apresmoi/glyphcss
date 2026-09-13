// @vitest-environment node
// The fit probe on its own (`chartsMarkTypeFit.ts`' `chartsBuiltMarkRenders`,
// `docs/design/charts.md`'s round 2). Everything the ranker offers today
// also passes the build's own checks, so a candidate that validates and
// still draws nothing is injected here: without the probe it would be
// enabled.
import { describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../lib/chartCandidates", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/chartCandidates")>();
  const terms = { entropy: 0, structure: 0, coverage: 0, legibility: 0, prior: 0 };
  return {
    ...actual,
    buildChartCandidates: (profile: import("../../lib/dataProfile").DataProfile) => profile.columns.some((c) => c.name === "zero")
      ? [
          { mark: "arc", channels: { y: "zero", fill: "fuel" }, reason: "all-zero shares", score: 0.9, terms },
          { mark: "arc", channels: { y: "twh", fill: "fuel" }, reason: "real shares", score: 0.8, terms },
        ]
      : actual.buildChartCandidates(profile),
  };
});
import type { TabularRow } from "../../lib/tabularParse";
import { chartsBuildBoundMark, chartsBuiltMarkRenders, chartsMarkTypeFitTable } from "./chartsMarkTypeFit";

const rows: TabularRow[] = [{ fuel: "Coal", zero: 0, twh: 14 }, { fuel: "Gas", zero: 0, twh: 31 }, { fuel: "Wind", zero: 0, twh: 9 }];

describe("the fit probe", () => {
  it("a candidate that builds and validates but draws a blank chart is passed over for the next one", () => {
    const zero = chartsBuildBoundMark(0, "arc", rows, { channels: { y: "zero", fill: "fuel" }, transform: "none" })!;
    expect(zero).not.toBeNull();
    expect(chartsBuiltMarkRenders(zero)).toBe(false);
    const fit = chartsMarkTypeFitTable({ rows }).arc;
    expect(fit.fits && fit.binding.channels).toEqual({ y: "twh", fill: "fuel" });
    expect(fit.fits && fit.rank).toBe(1);
  });

  it("a cartesian mark the library refuses is caught without painting", () => {
    // A category x under a numeric y domain that excludes zero is legal; a
    // bar with no y at all is not (`missing-xy-channels`), and the build's
    // own channel check is what normally stops it before the probe.
    const noY = { mark: { id: 0, type: "bar" as const, dataText: JSON.stringify(rows), channels: { x: "fuel" }, transform: "none" as const, options: {} }, isDate: false, omitted: null };
    expect(chartsBuiltMarkRenders(noY)).toBe(false);
    expect(chartsBuildBoundMark(0, "bar", rows, { channels: { x: "fuel" }, transform: "none" })).toBeNull();
    expect(chartsBuildBoundMark(0, "bar", rows, { channels: { x: "fuel", y: "nope" }, transform: "none" })).toBeNull();
  });
});
