// @vitest-environment node
// The fit probe on its own (`chartsMarkTypeFit.ts`' `chartsBuiltMarkRenders`).
// Everything the ranker offers today
// also passes the build's own checks, so a candidate that validates and
// still draws nothing is injected here: without the probe it would be
// enabled.
import { describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../../packages/core/src/index"));
vi.mock("../tabular/chartCandidates", async (importActual) => {
  const actual = await importActual<typeof import("../tabular/chartCandidates")>();
  const terms = { entropy: 0, structure: 0, coverage: 0, legibility: 0, prior: 0 };
  return {
    ...actual,
    buildChartCandidates: (profile: import("../tabular/dataProfile").DataProfile) => profile.columns.some((c) => c.name === "zero")
      ? [
          { mark: "arc", channels: { y: "zero", fill: "fuel" }, reason: "all-zero shares", score: 0.9, terms },
          { mark: "arc", channels: { y: "twh", fill: "fuel" }, reason: "real shares", score: 0.8, terms },
        ]
      : actual.buildChartCandidates(profile),
  };
});
import type { TabularRow } from "../tabular/tabularParse";
import { chartsBuildBoundMark, chartsBuiltMarkProbe, chartsBuiltMarkRenders, chartsMarkTypeFitTable } from "./chartsMarkTypeFit";

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

  it("a mark the library refuses is `refused`", () => {
    // A bar with no y at all is refused (`missing-xy-channels`); the
    // build's own channel check is what normally stops it before the probe.
    const noY = { mark: { id: 0, type: "bar" as const, dataText: JSON.stringify(rows), channels: { x: "fuel" }, transform: "none" as const, options: {} }, isDate: false, omitted: null };
    expect(chartsBuiltMarkProbe(noY)).toBe("refused");
    expect(chartsBuiltMarkRenders(noY)).toBe(false);
    expect(chartsBuildBoundMark(0, "bar", rows, { channels: { x: "fuel" }, transform: "none" })).toBeNull();
    expect(chartsBuildBoundMark(0, "bar", rows, { channels: { x: "fuel", y: "nope" }, transform: "none" })).toBeNull();
  });

  it("round 3: a mark the library renders but that paints no cell of its own is `blank`, and any cell of its own is `draws`", () => {
    const build = (type: "line" | "area" | "bar" | "dot" | "cell", data: TabularRow[], channels: Record<string, string>) =>
      chartsBuildBoundMark(0, type, data, { channels, transform: "none" })!;
    const one = [{ d: "2024-01-01", v: 5 }];
    expect(chartsBuiltMarkProbe(build("line", one, { x: "d", y: "v" }))).toBe("blank");
    expect(chartsBuiltMarkProbe(build("area", one, { x: "d", y: "v" }))).toBe("blank");
    expect(chartsBuiltMarkProbe(build("dot", one, { x: "d", y: "v" }))).toBe("draws");
    expect(chartsBuiltMarkProbe(build("bar", rows, { x: "fuel", y: "zero" }))).toBe("blank");
    expect(chartsBuiltMarkProbe(build("bar", rows, { x: "fuel", y: "twh" }))).toBe("draws");
    // One point in each of two series is still no segment.
    const split = [{ d: "2024-01-01", v: 5, k: "a" }, { d: "2024-01-02", v: 7, k: "b" }];
    expect(chartsBuiltMarkProbe(build("line", split, { x: "d", y: "v", fill: "k" }))).toBe("blank");
    expect(chartsBuiltMarkProbe(build("line", split, { x: "d", y: "v" }))).toBe("draws");
    const grid = [{ a: "p", b: "q", v: 0 }, { a: "p", b: "r", v: 0 }, { a: "s", b: "q", v: 0 }];
    expect(chartsBuiltMarkProbe(build("cell", grid, { x: "a", y: "b", fill: "v" }))).toBe("blank");
    expect(chartsBuiltMarkProbe(build("cell", grid.map((r, i) => ({ ...r, v: i + 1 })), { x: "a", y: "b", fill: "v" }))).toBe("draws");
  });
});
